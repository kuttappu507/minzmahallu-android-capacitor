import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle, RefreshCw, Smartphone, Wifi, WifiOff, Send, ShieldCheck,
  Clock3, Megaphone, ReceiptText, RotateCcw, AlertTriangle, Users, Power, Unlink,
} from "lucide-react";
import { Button, Badge, Textarea } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/lib/utils";

const STATUS_LABELS: Record<string, { en: string; ml: string }> = {
  CONNECTED: { en: "Connected", ml: "കണക്റ്റ് ചെയ്തു" },
  QR_REQUIRED: { en: "Scan QR code", ml: "QR കോഡ് സ്കാൻ ചെയ്യുക" },
  STARTING: { en: "Starting…", ml: "ആരംഭിക്കുന്നു…" },
  OFFLINE: { en: "No internet", ml: "ഇന്റർനെറ്റ് ഇല്ല" },
  DISCONNECTED: { en: "Not connected yet", ml: "ഇതുവരെ കണക്റ്റ് ആയിട്ടില്ല" },
  UNAVAILABLE: { en: "Service unavailable", ml: "സേവനം ലഭ്യമല്ല" },
  ERROR: { en: "Error", ml: "പിശക്" },
};

function statusBadge(status: string) {
  if (status === "CONNECTED") return "success";
  if (status === "QR_REQUIRED" || status === "STARTING") return "warning";
  if (status === "OFFLINE" || status === "ERROR" || status === "UNAVAILABLE") return "danger";
  return "muted";
}

function campaignBadge(status: string) {
  if (status === "COMPLETED") return "success";
  if (status === "PAUSED") return "warning";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "info";
  return "muted";
}

export function WhatsApp() {
  const { isMalayalam } = useI18n();
  const ml = isMalayalam();
  const tx = (en: string, m: string) => (ml ? m : en);

  const [status, setStatus] = useState<any>({ status: "NOT_CONFIGURED", connected: false, internet: true, number: "", name: "", message: "" });
  const [qr, setQr] = useState("");
  const [loading, setLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [subStats, setSubStats] = useState<any>(null);
  const [annStats, setAnnStats] = useState<any>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  // ToS safety notice: the checkbox must be ticked before the FIRST pairing
  // (until `status.tosAcked` comes back true from the main process).
  const [tosCheck, setTosCheck] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.mms.whatsapp.status();
      setStatus(s);
      if (s.status === "QR_REQUIRED") {
        // QR codes rotate — keep the displayed one fresh while pairing.
        try { setQr(await window.mms.whatsapp.qr()); } catch { /* QR not ready yet */ }
      } else {
        setQr("");
      }
    } catch (e: any) {
      setStatus({ status: "ERROR", connected: false, internet: true, number: "", name: "", message: e?.message || "WhatsApp status unavailable" });
    }
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const [c, h, ss, as] = await Promise.all([
        window.mms.whatsapp.listCampaigns(20),
        window.mms.whatsapp.listHistory(40),
        window.mms.whatsapp.recipientStats("SUBSCRIPTION_REMINDER"),
        window.mms.whatsapp.recipientStats("ANNOUNCEMENT"),
      ]);
      setCampaigns(c || []);
      setHistory(h || []);
      setSubStats(ss || null);
      setAnnStats(as || null);
    } catch { /* lists are best-effort */ }
  }, []);

  useEffect(() => {
    refresh();
    refreshLists();
    const timer = window.setInterval(() => { refresh(); refreshLists(); }, 6000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshLists]);

  const connect = async () => {
    setLoading(true);
    try {
      // First-time pairing: persist the safety-notice acknowledgment before
      // the connect call — the main process refuses without it.
      if (!status.tosAcked) await window.mms.whatsapp.ackToS();
      await window.mms.whatsapp.connect({ acknowledged: true });
      toast.success(tx("WhatsApp connection started", "വാട്ട്സ്ആപ്പ് കണക്ഷൻ ആരംഭിച്ചു"));
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || tx("Could not start WhatsApp", "വാട്ട്സ്ആപ്പ് ആരംഭിക്കാനായില്ല"));
    } finally { setLoading(false); }
  };

  const loadQr = async () => {
    try { setQr(await window.mms.whatsapp.qr()); }
    catch (e: any) { toast.error(e?.message || tx("QR code is not ready yet", "QR കോഡ് ഇതുവരെ തയ്യാറായിട്ടില്ല")); }
  };

  // PAUSE — the engine stops but the device stays linked on the phone, so
  // Connect resumes without a new QR scan. (The old Disconnect actually
  // logged the device out — the "logged out after close" surprise.)
  const pause = async () => {
    setLoading(true);
    try {
      await window.mms.whatsapp.disconnect();
      toast.success(tx("WhatsApp paused — pairing kept, Connect resumes it", "വാട്ട്സ്ആപ്പ് താൽക്കാലികമായി നിർത്തി — പെയറിംഗ് നിലനിൽക്കും, കണക്റ്റ് ചെയ്താൽ തുടരും"));
      await refresh();
    } catch (e: any) { toast.error(e?.message || tx("Could not pause WhatsApp", "വാട്ട്സ്ആപ്പ് നിർത്താനായില്ല")); }
    finally { setLoading(false); }
  };

  // UNLINK — removes the device from the phone's Linked Devices and wipes
  // the stored credentials; a fresh QR scan is required afterwards.
  const unlink = async () => {
    setLoading(true);
    try {
      await window.mms.whatsapp.unlink();
      toast.success(tx("Device unlinked — scan the QR code to reconnect", "ഡിവൈസ് വിച്ഛേദിച്ചു — വീണ്ടും കണക്റ്റ് ചെയ്യാൻ QR സ്കാൻ ചെയ്യുക"));
      await refresh();
    } catch (e: any) { toast.error(e?.message || tx("Could not unlink the device", "ഡിവൈസ് വിച്ഛേദിക്കാനായില്ല")); }
    finally { setLoading(false); setUnlinkOpen(false); }
  };

  const sendSubscription = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const c = await window.mms.whatsapp.createSubscriptionCampaign();
      const r = await window.mms.whatsapp.runCampaign(c.campaignId);
      toast.success(tx(`Subscription reminder complete: ${r.sent} sent`, `വരിസംഖ്യ റിമൈൻഡർ പൂർത്തിയായി: ${r.sent} അയച്ചു`));
      await refreshLists();
    } catch (e: any) {
      toast.error(e?.message || tx("Could not send subscription reminders", "വരിസംഖ്യ റിമൈൻഡറുകൾ അയയ്ക്കാനായില്ല"));
    } finally { busy.current = false; setLoading(false); }
  };

  const sendAnnouncement = async () => {
    if (!announcement.trim()) return toast.error(tx("Enter an announcement", "അറിയിപ്പ് നൽകുക"));
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const c = await window.mms.whatsapp.createAnnouncementCampaign(announcement.trim());
      const r = await window.mms.whatsapp.runCampaign(c.campaignId);
      toast.success(tx(`Announcement complete: ${r.sent} sent`, `അറിയിപ്പ് പൂർത്തിയായി: ${r.sent} അയച്ചു`));
      setAnnouncement("");
      await refreshLists();
    } catch (e: any) {
      toast.error(e?.message || tx("Could not send announcement", "അറിയിപ്പ് അയയ്ക്കാനായില്ല"));
    } finally { busy.current = false; setLoading(false); }
  };

  const retryFailed = async (id: number) => {
    try {
      const r = await window.mms.whatsapp.retryFailed(id);
      toast.success(tx(`Retry complete: ${r.sent} sent`, `വീണ്ടും ശ്രമം പൂർത്തിയായി: ${r.sent} അയച്ചു`));
      await refreshLists();
    } catch (e: any) { toast.error(e?.message || tx("Retry failed", "വീണ്ടും ശ്രമം പരാജയപ്പെട്ടു")); }
  };

  const connected = status.status === "CONNECTED";
  const canSend = connected && status.internet;
  const needsTosAck = !connected && !status.tosAcked;
  const statusLabel = STATUS_LABELS[String(status.status)] || { en: "Not connected", ml: "കണക്റ്റ് ചെയ്തിട്ടില്ല" };

  return (
    <div className="view view-enter">
      <div className="vhead">
        <div className="modic t-em"><MessageCircle size={20} /></div>
        <div>
          <h1>{tx("WhatsApp", "വാട്ട്സ്ആപ്പ്")}</h1>
          <div className="vs">{tx("Receipts and family-head communication", "രസീതുകളും കുടുംബനാഥനുള്ള സന്ദേശങ്ങളും")}</div>
        </div>
        <div className="vr">
          <Button variant="secondary" onClick={() => { refresh(); refreshLists(); }}><RefreshCw className="h-4 w-4" />{tx("Refresh", "പുതുക്കുക")}</Button>
        </div>
      </div>

      <div className="wa-grid wa-top">
        <div className="card card-pad-4">
          <div className="ch-head">
            <div>
              <div className="ch-title">{tx("WhatsApp connection", "വാട്ട്സ്ആപ്പ് കണക്ഷൻ")}</div>
              <div className="ch-sub">{tx("Connect the Mahallu WhatsApp / Business account once by scanning a QR code.", "മഹല്ല് വാട്ട്സ്ആപ്പ് / ബിസിനസ് അക്കൗണ്ട് QR കോഡ് സ്കാൻ ചെയ്ത് ഒരിക്കൽ കണക്റ്റ് ചെയ്യുക.")}</div>
            </div>
            <Badge variant={statusBadge(status.status)}>{tx(statusLabel.en, statusLabel.ml)}</Badge>
          </div>

          <div className="wa-meta">
            <span className="gchip">{status.internet ? <Wifi size={13} /> : <WifiOff size={13} />}{status.internet ? tx("Internet available", "ഇന്റർനെറ്റ് ലഭ്യമാണ്") : tx("Internet not connected", "ഇന്റർനെറ്റ് കണക്റ്റ് ചെയ്തിട്ടില്ല")}</span>
            {status.number && <span className="wa-acct">{status.name ? <>{status.name} · </> : null}+{status.number}</span>}
          </div>
          {status.message && <div className="wa-note">{status.message}</div>}

          {status.status === "QR_REQUIRED" && (
            <div className="wa-qr">
              <div className="wa-qr-hint">{tx("Scan with WhatsApp → Linked Devices", "WhatsApp → Linked Devices വഴി സ്കാൻ ചെയ്യുക")}</div>
              {qr
                ? <img src={qr} alt={tx("WhatsApp QR code", "വാട്ട്സ്ആപ്പ് QR കോഡ്")} className="wa-qr-img" />
                : <div className="wa-qr-empty">{tx("QR code will appear here", "QR കോഡ് ഇവിടെ കാണും")}</div>}
              <Button variant="secondary" size="sm" onClick={loadQr}><RefreshCw className="h-4 w-4" />{tx("Refresh QR", "QR പുതുക്കുക")}</Button>
            </div>
          )}

          {/* SAFETY NOTICE — this connection is unofficial automation and
              WhatsApp may ban the paired number. The office must opt in
              knowingly before the first pairing. */}
          {needsTosAck && (
            <div className="wa-tos" data-testid="wa-tos">
              <div className="wa-tos-head"><AlertTriangle size={14} />{tx("Read before connecting", "കണക്റ്റ് ചെയ്യും മുമ്പ് വായിക്കുക")}</div>
              <p>{tx(
                "This app connects to WhatsApp through an unofficial link. WhatsApp does not allow automation like this and may permanently ban the number you pair — use a secondary mahallu number if possible.",
                "ഈ ആപ്പ് WhatsApp-മായി അനൗദ്യോഗികമായ വഴിയിലൂടെയാണ് കണക്റ്റ് ചെയ്യുന്നത്. WhatsApp ഇത്തരം ഓട്ടോമേഷൻ അനുവദിക്കാത്തതിനാൽ പെയർ ചെയ്യുന്ന നമ്പർ ശാശ്വതമായി നിരോധിക്കപ്പെടാം — സാധ്യമെങ്കിൽ മഹല്ലിന്റെ രണ്ടാമത്തെ നമ്പർ ഉപയോഗിക്കുക."
              )}</p>
              <label className="wa-tos-check">
                <input type="checkbox" checked={tosCheck} onChange={(e) => setTosCheck(e.target.checked)} data-testid="wa-tos-check" />
                <span>{tx("I understand the risk and want to connect", "ഈ സാഹചര്യം മനസ്സിലാക്കി ഞാൻ കണക്റ്റ് ചെയ്യാൻ സമ്മതിക്കുന്നു")}</span>
              </label>
            </div>
          )}
          {!needsTosAck && !connected && (
            <div className="wa-note wa-note-safe">{tx("Safety notice accepted — bulk sending is gently paced to protect the number.", "സുരക്ഷാ അറിയിപ്പ് സ്വീകരിച്ചു — നമ്പർ സംരക്ഷിക്കാൻ ബൾക്ക് സന്ദേശങ്ങൾ പതുക്കെ അയയ്ക്കുന്നതാണ്.")}</div>
          )}

          <div className="wa-actions">
            {connected
              ? <>
                  <Button variant="secondary" onClick={pause} disabled={loading}><Power className="h-4 w-4" />{tx("Pause (keeps pairing)", "താൽക്കാലിക നിർത്തുക (പെയറിംഗ് നിലനിൽക്കും)")}</Button>
                  <Button variant="danger" onClick={() => setUnlinkOpen(true)} disabled={loading}><Unlink className="h-4 w-4" />{tx("Unlink phone", "ഫോൺ വിച്ഛേദിക്കുക")}</Button>
                </>
              : <Button onClick={connect} disabled={loading || !status.internet || (needsTosAck && !tosCheck)} data-testid="wa-connect"><Smartphone className="h-4 w-4" />{tx("Connect WhatsApp", "വാട്ട്സ്ആപ്പ് കണക്റ്റ് ചെയ്യുക")}</Button>}
          </div>
          {connected && status.throttle && (
            <div className="wa-note">{tx(
              `Sent today: ${status.throttle.sentToday} message${status.throttle.sentToday === 1 ? "" : "s"}`,
              `ഇന്ന് അയച്ചത്: ${status.throttle.sentToday} സന്ദേശങ്ങൾ`
            )}</div>
          )}
        </div>

        <div className="card card-pad-4">
          <div className="ch-head">
            <div>
              <div className="ch-title">{tx("Built-in safeguards", "സുരക്ഷാ നിയന്ത്രണങ്ങൾ")}</div>
              <div className="ch-sub">{tx("Messaging stays safe and respectful", "സന്ദേശങ്ങൾ സുരക്ഷിതവും ഉചിതവുമായി നിലനിൽക്കുന്നു")}</div>
            </div>
            <span className="sic"><ShieldCheck size={16} /></span>
          </div>
          <ul className="wa-checks">
            <li>✓ <span>{tx("Bulk messages go to the family head only", "ബൾക്ക് സന്ദേശങ്ങൾ കുടുംബനാഥന് മാത്രം")}</span></li>
            <li>✓ <span>{tx("Subscription reminder: once per family per month", "വരിസംഖ്യ റിമൈൻഡർ: കുടുംബത്തിന് മാസത്തിൽ ഒരിക്കൽ")}</span></li>
            <li>✓ <span>{tx("Announcement: one campaign per day", "അറിയിപ്പ്: ദിവസത്തിൽ ഒരു ക്യാമ്പയിൻ")}</span></li>
            <li>✓ <span>{tx("Messages spaced 5–10 s apart with a rest every 20", "സന്ദേശങ്ങൾക്കിടയിൽ 5–10 സെക്കൻഡ് ഇടവേള; ഓരോ 20-നും ദീർഘ ഇടവേള")}</span></li>
            <li>✓ <span>{tx("Campaigns pause automatically if WhatsApp signals a rate limit", "WhatsApp റേറ്റ് ലിമിറ്റ് സൂചിപ്പിച്ചാൽ ക്യാമ്പയിൻ സ്വയം നിർത്തും")}</span></li>
            <li>✓ <span>{tx("Families can opt out — opted-out heads are never messaged", "കുടുംബങ്ങൾക്ക് ഒഴിവാക്കാം — ഒഴിവാക്കിയവർക്ക് അയയ്ക്കില്ല")}</span></li>
            <li>✓ <span>{tx("Missing or invalid numbers are skipped and reported", "നമ്പർ ഇല്ലാത്തത് / തെറ്റായത് അയയ്ക്കില്ല")}</span></li>
            <li>✓ <span>{tx("Archived families are excluded", "ആർക്കൈവ് ചെയ്ത കുടുംബങ്ങൾ ഒഴിവാക്കും")}</span></li>
          </ul>
        </div>
      </div>

      <div className="wa-grid">
        <div className="card card-pad-4">
          <div className="ch-head">
            <div>
              <div className="ch-title"><Clock3 size={15} className="wa-tit-ic" />{tx("Subscription reminder", "വരിസംഖ്യ റിമൈൻഡർ")}</div>
              <div className="ch-sub">{tx("Sends the pending amount to eligible family heads. Uses the family's WhatsApp number, or the family phone when no WhatsApp number is set. Limited to once per family each calendar month.", "യോഗ്യരായ കുടുംബനാഥന്മാർക്ക് ബാക്കി തുക അയയ്ക്കും. കുടുംബത്തിന്റെ വാട്ട്സ്ആപ്പ് നമ്പർ ഉപയോഗിക്കും; ഇല്ലെങ്കിൽ കുടുംബ ഫോൺ നമ്പർ. ഒരു കലണ്ടർ മാസത്തിൽ കുടുംബത്തിന് ഒരിക്കൽ മാത്രം.")}</div>
            </div>
          </div>
          {subStats && (
            <div className="wa-stats">
              <span><b>{subStats.eligible ?? 0}</b> {tx("due families", "കുടിശ്ശിക കുടുംബങ്ങൾ")}</span>
              <span><b>{subStats.willSend ?? 0}</b> {tx("will be messaged", "സന്ദേശം ലഭിക്കും")}</span>
              <span className={subStats.missingWhatsApp ? "wa-stats-warn" : ""}><b>{subStats.missingWhatsApp ?? 0}</b> {tx("missing number", "നമ്പർ ഇല്ല")}</span>
            </div>
          )}
          <div className="wa-actions">
            <Button onClick={sendSubscription} disabled={!canSend || loading}><Send className="h-4 w-4" />{tx("Send subscription reminders", "വരിസംഖ്യ റിമൈൻഡറുകൾ അയയ്ക്കുക")}</Button>
          </div>
        </div>

        <div className="card card-pad-4">
          <div className="ch-head">
            <div>
              <div className="ch-title"><Megaphone size={15} className="wa-tit-ic" />{tx("General announcement", "പൊതു അറിയിപ്പ്")}</div>
              <div className="ch-sub">{tx("One bulk announcement per day", "ദിവസത്തിൽ പരമാവധി ഒരു ബൾക്ക് അറിയിപ്പ്")}</div>
            </div>
          </div>
          <Textarea rows={3} className="mt-2" value={announcement} onChange={(e) => setAnnouncement(e.target.value)} placeholder={tx("Write the message for family heads…", "കുടുംബനാഥന്മാർക്കുള്ള സന്ദേശം എഴുതുക…")} />
          {annStats && (
            <div className="wa-stats">
              <span><b>{annStats.willSend ?? 0}</b> {tx("family heads will receive it", "കുടുംബനാഥന്മാർക്ക് ലഭിക്കും")}</span>
              <span className={annStats.missingWhatsApp ? "wa-stats-warn" : ""}><b>{annStats.missingWhatsApp ?? 0}</b> {tx("missing number", "നമ്പർ ഇല്ല")}</span>
            </div>
          )}
          <div className="wa-actions">
            <Button onClick={sendAnnouncement} disabled={!canSend || loading || !announcement.trim()}><Send className="h-4 w-4" />{tx("Send announcement", "അറിയിപ്പ് അയയ്ക്കുക")}</Button>
          </div>
        </div>
      </div>

      <div className="wa-grid">
        <div className="card card-pad-4">
          <div className="ch-head">
            <div>
              <div className="ch-title"><ReceiptText size={15} className="wa-tit-ic" />{tx("Campaign history", "ക്യാമ്പയിൻ ചരിത്രം")}</div>
              <div className="ch-sub">{tx("Subscription reminders and announcements", "വരിസംഖ്യ റിമൈൻഡറുകളും അറിയിപ്പുകളും")}</div>
            </div>
          </div>
          <div className="wa-list">
            {campaigns.length ? campaigns.map((c: any) => (
              <div key={c.id} className="wa-row">
                <div className="wa-row-main">
                  <b>{c.campaign_type === "SUBSCRIPTION_REMINDER" ? tx("Subscription reminder", "വരിസംഖ്യ റിമൈൻഡർ") : tx("Announcement", "അറിയിപ്പ്")}</b>
                  <small>{formatDateTime(c.created_at)} · {c.total_recipients} {tx("recipients", "സ്വീകർത്താക്കൾ")} · {c.sent_count} {tx("sent", "അയച്ചു")}{c.failed_count ? ` · ${c.failed_count} ${tx("failed", "പരാജയം")}` : ""}</small>
                </div>
                <div className="wa-row-side">
                  <Badge variant={campaignBadge(c.status)}>{c.status}</Badge>
                  {c.status === "PAUSED" && c.pause_reason && <small className="wa-pause-reason" title={c.pause_reason}>{c.pause_reason}</small>}
                  {c.failed_count > 0 && c.status !== "RUNNING" && c.status !== "PENDING" && (
                    <button className="ibtn" title={tx("Retry failed", "പരാജയപ്പെട്ടവ വീണ്ടും ശ്രമിക്കുക")} onClick={() => retryFailed(c.id)}><RotateCcw size={13} /></button>
                  )}
                </div>
              </div>
            )) : (
              <div className="wa-empty"><Users size={18} />{tx("No campaigns yet", "ക്യാമ്പയിനുകൾ ഒന്നുമില്ല")}</div>
            )}
          </div>
        </div>

        <div className="card card-pad-4">
          <div className="ch-head">
            <div>
              <div className="ch-title"><MessageCircle size={15} className="wa-tit-ic" />{tx("Recent messages", "സമീപകാല സന്ദേശങ്ങൾ")}</div>
              <div className="ch-sub">{tx("Individual sends and campaign deliveries", "വ്യക്തിഗത സന്ദേശങ്ങളും ക്യാമ്പയിൻ ഡെലിവറികളും")}</div>
            </div>
          </div>
          <div className="wa-list">
            {history.length ? history.map((m: any) => (
              <div key={m.id} className="wa-row">
                <div className="wa-row-main">
                  <b className="truncate">{m.recipient_name || m.recipient_phone}</b>
                  <small>{m.message_type} · {formatDateTime(m.created_at)}</small>
                </div>
                <div className="wa-row-side">
                  <Badge variant={m.status === "SENT" ? "success" : m.status === "FAILED" ? "danger" : "muted"}>{m.status}</Badge>
                </div>
              </div>
            )) : (
              <div className="wa-empty"><AlertTriangle size={18} />{tx("No messages yet", "സന്ദേശങ്ങൾ ഒന്നുമില്ല")}</div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={unlinkOpen}
        onClose={() => setUnlinkOpen(false)}
        onConfirm={unlink}
        title={tx("Unlink phone", "ഫോൺ വിച്ഛേദിക്കുക")}
        description={tx(
          "Remove this device from the phone's Linked Devices? A new QR scan will be needed to reconnect. If you only want to stop it for now, use Pause instead — that keeps the pairing.",
          "ഫോണിലെ Linked Devices-ൽ നിന്ന് ഈ ഡിവൈസ് നീക്കം ചെയ്യണോ? വീണ്ടും കണക്റ്റ് ചെയ്യാൻ പുതിയ QR സ്കാൻ വേണം. താൽക്കാലികമായി നിർത്താൻ മാത്രമാണെങ്കിൽ Pause ഉപയോഗിക്കുക — അത് പെയറിംഗ് നിലനിർത്തും."
        )}
        confirmLabel={tx("Unlink device", "ഡിവൈസ് വിച്ഛേദിക്കുക")}
      />
    </div>
  );
}
