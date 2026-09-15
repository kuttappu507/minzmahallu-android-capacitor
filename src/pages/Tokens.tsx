import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import {
  Ticket, CheckCircle2, RefreshCw, FileText, Printer, Loader2,
  Plus, Users, AlertTriangle, Check, Ban, RotateCcw, Trash2,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Dialog, Input, Label, Select, Badge } from "@/components/ui";
import { toast } from "@/lib/toast";
import { formatDate, todayIST } from "@/lib/utils";

type ViewMode = "list" | "select" | "review" | "generated";

interface TokenEvent {
  id: number; event_name: string; event_type: string; event_date: string;
  event_time: string; venue: string; description: string; status: string;
}
interface TokenRow {
  id: number; event_id: number; family_id: number; token_code: string;
  status: string; collected_at: string | null; created_at: string;
  family_number: string; house_name: string; house_number: string;
  ward: string; phone: string; event_date?: string;
}
interface Family {
  id: number; family_number: string; house_name: string; house_number: string;
  ward: string; phone: string; status: string; member_count: number;
}

export function Tokens({ printModeControl }: { printModeControl?: ReactNode } = {}) {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const text = {
    title: ml ? "ടോക്കണുകൾ" : "Tokens",
    subtitle: ml ? "ടോക്കൺ വിതരണം, ശേഖരണം എന്നിവ കൈകാര്യം ചെയ്യുക" : "Token distribution & collection management",
    selectFamilies: ml ? "കുടുംബങ്ങൾ തിരഞ്ഞെടുക്കുക" : "Select Families",
    selected: ml ? "തിരഞ്ഞെടുത്തത്" : "selected",
    new: ml ? "പുതിയത്" : "new",
    already: ml ? "ടോക്കൺ നിലവിലുണ്ട്" : "already have tokens",
    back: t("action_cancel"),
    review: ml ? "തിരഞ്ഞെടുപ്പ് പരിശോധിക്കുക" : "Review Selection",
    searchFamilies: ml ? "കുടുംബങ്ങൾ തിരയുക..." : "Search families...",
    allWards: ml ? "എല്ലാ വാർഡുകളും" : "All wards",
    selectAll: ml ? "സജീവമായവയെല്ലാം തിരഞ്ഞെടുക്കുക" : "Select All Active",
    clear: ml ? "മായ്ക്കുക" : "Clear",
    familyNo: t("family_number"), houseName: t("family_house_name"),
    ward: t("family_ward"), phone: t("family_phone"), members: t("family_members_count"),
    status: t("family_status"), hasToken: ml ? "ടോക്കൺ ഉണ്ട്" : "Has Token",
    newToken: "",
    deleteToken: ml ? "ടോക്കൺ ഇല്ലാതാക്കുക" : "Delete Token",
    deleteAfterEvent: ml ? "ഇവന്റ് കഴിഞ്ഞതിനാൽ ഈ താൽക്കാലിക ടോക്കൺ ഇല്ലാതാക്കാം. ഈ പ്രവർത്തനം തിരിച്ചെടുക്കാനാകില്ല." : "This temporary token can be deleted because the event has ended. This action cannot be undone.",
    reviewSelection: ml ? "തിരഞ്ഞെടുപ്പ് പരിശോധിക്കുക" : "Review Selection",
    selectedFamilies: ml ? "തിരഞ്ഞെടുത്ത കുടുംബങ്ങൾ" : "Selected Families",
    newTokens: ml ? "പുതിയ ടോക്കണുകൾ" : "New Tokens",
    existingTokens: ml ? "നിലവിലുള്ള ടോക്കണുകൾ" : "Already Have Tokens",
    wardDistribution: ml ? "വാർഡ് വിതരണം" : "Ward Distribution",
    skipWarning: ml ? "ചില കുടുംബങ്ങൾക്ക് ഈ ഇവന്റിൽ ടോക്കൺ നിലവിലുണ്ട്. അവ ഒഴിവാക്കും." : "Some families already have tokens for this event. They will be skipped.",
    generateNew: ml ? "പുതിയ ടോക്കണുകൾ സൃഷ്ടിക്കുക" : "Generate New Tokens",
    generatedSuccess: ml ? "ടോക്കണുകൾ വിജയകരമായി സൃഷ്ടിച്ചു" : "Tokens Generated Successfully",
    totalFor: ml ? "ടോക്കണുകൾ" : "tokens",
    total: ml ? "മൊത്തം ടോക്കണുകൾ" : "Total Tokens",
    collected: ml ? "ശേഖരിച്ചത്" : "Collected",
    remaining: ml ? "ശേഷിക്കുന്നത്" : "Remaining",
    rate: ml ? "ശേഖരണ നിരക്ക്" : "Collection Rate",
    generate: ml ? "ടോക്കണുകൾ സൃഷ്ടിക്കുക" : "Generate Tokens",
    tokenPdf: ml ? "ടോക്കൺ PDF" : "Token PDF",
    collectionSheet: ml ? "ശേഖരണ ഷീറ്റ്" : "Collection Sheet",
    searchToken: ml ? "ടോക്കൺ/കുടുംബം തിരയുക..." : "Search token/family...",
    all: t("ui_all"), loading: t("ui_loading"),
    noTokens: ml ? "ടോക്കണുകളൊന്നുമില്ല. സജീവ കുടുംബങ്ങൾക്കായി ടോക്കൺ സൃഷ്ടിക്കുക." : "No tokens yet. Generate tokens for active families.",
    token: ml ? "ടോക്കൺ" : "Token", house: ml ? "വീട്" : "House",
    generated: ml ? "സൃഷ്ടിച്ചത്" : "Generated", actions: ml ? "പ്രവർത്തനങ്ങൾ" : "Actions",
    markCollected: ml ? "ശേഖരിച്ചതായി അടയാളപ്പെടുത്തുക" : "Mark Collected",
    cancelToken: ml ? "ടോക്കൺ റദ്ദാക്കുക" : "Cancel Token",
    replaceToken: ml ? "ടോക്കൺ മാറ്റിസ്ഥാപിക്കുക" : "Replace Token",
    noEvent: ml ? "ഇവന്റ് തിരഞ്ഞെടുത്തിട്ടില്ല" : "No Event Selected",
    selectOrCreate: ml ? "ഇവന്റ് തിരഞ്ഞെടുക്കുക അല്ലെങ്കിൽ പുതിയത് സൃഷ്ടിക്കുക." : "Select an event or create a new one to manage tokens.",
    selectEvent: ml ? "— ഇവന്റ് തിരഞ്ഞെടുക്കുക —" : "— Select Event —",
    newEvent: ml ? "പുതിയ ഇവന്റ്" : "New Event", editEvent: ml ? "ഇവന്റ് തിരുത്തുക" : "Edit Event",
    eventName: ml ? "ഇവന്റ് പേര്" : "Event Name", eventType: ml ? "ഇവന്റ് തരം" : "Event Type",
    date: ml ? "തീയതി" : "Date", time: ml ? "സമയം" : "Time", venue: ml ? "സ്ഥലം" : "Venue",
    description: ml ? "വിവരണം" : "Description", saveEvent: ml ? "ഇവന്റ് സേവ് ചെയ്യുക" : "Save Event",
    general: ml ? "പൊതുവായത്" : "General", eid: ml ? "ഈദ്" : "Eid", ramadan: ml ? "റമദാൻ" : "Ramadan", welfare: ml ? "ക്ഷേമം" : "Welfare",
    reason: ml ? "കാരണം" : "Reason", lostToken: ml ? "നഷ്ടപ്പെട്ട ടോക്കൺ" : "Lost token",
    replacement: ml ? "പകരം ടോക്കൺ സൃഷ്ടിക്കുക" : "Generate Replacement",
  };

  const [events, setEvents] = useState<TokenEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [stats, setStats] = useState({ total: 0, collected: 0, remaining: 0, rate: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [families, setFamilies] = useState<Family[]>([]);
  const [selectedFamilyIds, setSelectedFamilyIds] = useState<Set<number>>(new Set());
  const [familySearch, setFamilySearch] = useState("");
  const [wardFilter, setWardFilter] = useState("All");
  const [existingTokens, setExistingTokens] = useState<Set<number>>(new Set());
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [deleteEventBusy, setDeleteEventBusy] = useState(false);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState({ event_name: "", event_type: "general", event_date: "", event_time: "", venue: "", description: "" });
  const [pdfLoading, setPdfLoading] = useState(false);
  const [collectionSheetLoading, setCollectionSheetLoading] = useState(false);
  const [actionDialog, setActionDialog] = useState<{ type: "cancel" | "replace" | "delete" | "deleteEvent" | null; token: TokenRow | null }>({ type: null, token: null });
  const [actionReason, setActionReason] = useState("");
  // One-shot flag for the ?event= deep link (see loadEvents) so the URL param
  // is honoured exactly once and never fights a manual dropdown pick.
  const requestedEventHandled = useRef(false);

  const selectedEvent = events.find(e => e.id === selectedEventId);
  const canDeleteTokens = !!selectedEvent?.event_date && selectedEvent.event_date < todayIST();
  // A token event can be deleted only after its date is over — a completed
  // event is a spent record (no need to keep), while an upcoming one is
  // protected (enforced in the service layer AND by DB triggers, not just
  // here).
  const canDeleteEvent = canDeleteTokens;

  const loadEvents = useCallback(async () => {
    try {
      const result = await window.mms.tokens.listEvents();
      setEvents(result || []);
      // Deep-link from the Token Events page: “Manage” navigates to
      // /tokens/manage?event=<id>. The app runs on a HashRouter, so the query
      // string lives INSIDE the hash (#/tokens/manage?event=5) —
      // window.location.search is always empty here. Parse it from the hash.
      // Applied only on the FIRST successful load so a later manual pick in the
      // dropdown is never overridden by the URL param again.
      if (!requestedEventHandled.current) {
        requestedEventHandled.current = true;
        const hash = window.location.hash || "";
        const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
        const requestedEventId = Number(new URLSearchParams(hashQuery).get("event") || 0);
        const requested = (result || []).find((e: any) => e.id === requestedEventId);
        if (requested) setSelectedEventId(requested.id);
        else if (result?.length && !selectedEventId) setSelectedEventId(result[0].id);
      } else if (result?.length && !selectedEventId) {
        setSelectedEventId(result[0].id);
      }
    } catch (e: any) { toast.error(e.message || "Failed to load events"); }
  }, [selectedEventId]);

  const loadTokens = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      const filter: any = { eventId: selectedEventId };
      if (statusFilter !== "All") filter.status = statusFilter;
      if (search) filter.search = search;
      const result = await window.mms.tokens.list(filter);
      setTokens(result.rows || []);
      const allResult = await window.mms.tokens.list({ eventId: selectedEventId, pageSize: 100000 });
      const statRows = allResult?.rows || [];
      const total = statRows.filter((r: any) => r.status !== "CANCELLED").length;
      const collected = statRows.filter((r: any) => r.status === "COLLECTED").length;
      const remaining = total - collected;
      setStats({ total, collected, remaining, rate: total ? Math.round((collected / total) * 1000) / 10 : 0 });
    } catch (e: any) { toast.error(e.message || "Failed to load tokens"); }
    finally { setLoading(false); }
  }, [selectedEventId, statusFilter, search]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { if (selectedEventId && viewMode === "list") loadTokens(); }, [selectedEventId, viewMode, loadTokens]);

  const deleteEvent = async () => {
    if (!selectedEventId || deleteEventBusy) return;
    const ev = events.find(e => e.id === selectedEventId);
    if (!ev) return;
    // Use a themed confirm dialog instead of window.confirm.
    setActionDialog({ type: "deleteEvent" as any, token: null });
  };
  const confirmDeleteEvent = async () => {
    if (!selectedEventId || deleteEventBusy || !canDeleteEvent) return;
    setDeleteEventBusy(true);
    try {
      const result = await window.mms.tokens.removeEvent(
        selectedEventId!,
        actionReason.trim() || (ml ? "തെറ്റായി സൃഷ്ടിച്ച ഇവന്റ്" : "Event created by mistake")
      );
      toast.success(
        ml
          ? `ഇവന്റ് ഇല്ലാതാക്കി (${result?.deletedTokens ?? 0} ടോക്കണുകളും)`
          : `Event deleted (with ${result?.deletedTokens ?? 0} tokens)`
      );
      setSelectedEventId(null);
      setTokens([]);
      setStats({ total: 0, collected: 0, remaining: 0, rate: 0 });
      await loadEvents();
      setActionDialog({ type: null, token: null });
      setActionReason("");
    } catch (e: any) {
      toast.error(e.message || (ml ? "ഇവന്റ് ഇല്ലാതാക്കാനായില്ല" : "Failed to delete event"));
    } finally {
      setDeleteEventBusy(false);
    }
  };













































































  const saveEvent = async () => {
    if (!eventForm.event_name.trim() || !eventForm.event_date) {
      toast.error(ml ? "ഇവന്റ് പേരും തീയതിയും ആവശ്യമാണ്" : "Event name and date are required"); return;
    }
    try {
      const payload = { ...eventForm, eventName: eventForm.event_name, eventType: eventForm.event_type, eventDate: eventForm.event_date, eventTime: eventForm.event_time };
      if (editingEventId) {
        await window.mms.tokens.updateEvent(editingEventId, payload);
        toast.success(ml ? "ഇവന്റ് അപ്ഡേറ്റ് ചെയ്തു" : "Event updated");
      } else {
        const result = await window.mms.tokens.createEvent(payload);
        setSelectedEventId(result.id);
        toast.success(ml ? "ഇവന്റ് സൃഷ്ടിച്ചു" : "Event created");
      }
      setEventDialogOpen(false); setEditingEventId(null);
      setEventForm({ event_name: "", event_type: "general", event_date: "", event_time: "", venue: "", description: "" });
      await loadEvents();
    } catch (e: any) { toast.error(e.message || (ml ? "ഇവന്റ് സേവ് ചെയ്യാൻ കഴിഞ്ഞില്ല" : "Failed to save event")); }
  };

  const editEvent = async (id: number) => {
    try {
      const ev = await window.mms.tokens.getEvent(id);
      if (!ev) return;
      setEventForm({ event_name: ev.event_name || "", event_type: ev.event_type || "general", event_date: ev.event_date || "", event_time: ev.event_time || "", venue: ev.venue || "", description: ev.description || "" });
      setEditingEventId(id); setEventDialogOpen(true);
    } catch (e: any) { toast.error(e.message); }
  };

  const startSelection = async () => {
    if (!selectedEventId) { toast.error(ml ? "ആദ്യം ഒരു ഇവന്റ് തിരഞ്ഞെടുക്കുക" : "Please select an event first"); return; }
    try {
      const result = await window.mms.families.list({ status: "Active", pageSize: 10000 });
      setFamilies(result.rows || []);
      // IPC can't serialize a Set, so main.ts returns an Array. Convert it
      // back to a Set because the rest of this component uses existingTokens.has().
      const existing = await window.mms.tokens.checkExisting(selectedEventId);
      setExistingTokens(new Set(Array.isArray(existing) ? existing : []));
      setSelectedFamilyIds(new Set()); setViewMode("select");
    } catch (e: any) { toast.error(e.message || (ml ? "കുടുംബങ്ങൾ ലോഡ് ചെയ്യാൻ കഴിഞ്ഞില്ല" : "Failed to load families")); }
  };

  const filteredFamilies = useMemo(() => families.filter(f => {
    if (wardFilter !== "All" && f.ward !== wardFilter) return false;
    if (!familySearch) return true;
    const q = familySearch.toLowerCase();
    return f.family_number.toLowerCase().includes(q) || f.house_name.toLowerCase().includes(q) || (f.ward || "").toLowerCase().includes(q) || (f.phone || "").includes(q);
  }), [families, familySearch, wardFilter]);
  const wards = useMemo(() => ["All", ...Array.from(new Set(families.map(f => f.ward).filter(Boolean))).sort()], [families]);
  const newCount = Array.from(selectedFamilyIds).filter(id => !existingTokens.has(id)).length;
  const alreadyCount = selectedFamilyIds.size - newCount;
  const wardDistribution = useMemo(() => {
    const out: Record<string, number> = {};
    selectedFamilyIds.forEach(id => { const ward = families.find(f => f.id === id)?.ward || "—"; out[ward] = (out[ward] || 0) + 1; });
    return Object.entries(out);
  }, [selectedFamilyIds, families]);

  const toggleFamily = (id: number) => setSelectedFamilyIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const generate = async () => {
    if (!selectedEventId || !selectedFamilyIds.size) return;
    try {
      const result = await window.mms.tokens.generate(selectedEventId, Array.from(selectedFamilyIds));
      toast.success(ml ? `${result.generated} ടോക്കണുകൾ സൃഷ്ടിച്ചു` : `${result.generated} tokens generated${result.skipped ? ` · ${result.skipped} already existed` : ""}`);
      setViewMode("generated"); await loadTokens();
    } catch (e: any) { toast.error(e.message || (ml ? "ടോക്കണുകൾ സൃഷ്ടിക്കാൻ കഴിഞ്ഞില്ല" : "Failed to generate tokens")); }
  };
  const generatePdf = async (sheet = false) => {
    if (!selectedEventId) return;
    sheet ? setCollectionSheetLoading(true) : setPdfLoading(true);
    try {
      const result = sheet ? await window.mms.tokens.generateCollectionSheet(selectedEventId) : await window.mms.tokens.generateTokenPdf(selectedEventId);
      if (result.success) toast.success(ml ? `${result.count} ടോക്കണുകളുടെ PDF തയ്യാറാക്കി` : `${sheet ? "Collection sheet" : "Token PDF"} generated (${result.count} tokens)`);
      else if (!result.cancelled) toast.error(result.error || (ml ? "PDF തയ്യാറാക്കാൻ കഴിഞ്ഞില്ല" : "Failed to generate PDF"));
    } catch (e: any) { toast.error(e.message || (ml ? "PDF തയ്യാറാക്കാൻ കഴിഞ്ഞില്ല" : "Failed to generate PDF")); }
    finally { sheet ? setCollectionSheetLoading(false) : setPdfLoading(false); }
  };
  const collect = async (id: number) => {
    try { await window.mms.tokens.collect(id); toast.success(ml ? "ടോക്കൺ ശേഖരിച്ചതായി അടയാളപ്പെടുത്തി" : "Token marked as collected"); await loadTokens(); }
    catch (e: any) { toast.error(e.message || (ml ? "ടോക്കൺ ശേഖരിക്കാൻ കഴിഞ്ഞില്ല" : "Failed to collect token")); }
  };
  const cancelToken = async () => {
    if (!actionDialog.token) return;
    try { await window.mms.tokens.cancel(actionDialog.token.id, actionReason || (ml ? "നഷ്ടപ്പെട്ട ടോക്കൺ" : "Lost token")); toast.success(ml ? "ടോക്കൺ റദ്ദാക്കി" : "Token cancelled"); setActionDialog({ type: null, token: null }); setActionReason(""); await loadTokens(); }
    catch (e: any) { toast.error(e.message || (ml ? "ടോക്കൺ റദ്ദാക്കാൻ കഴിഞ്ഞില്ല" : "Failed to cancel token")); }
  };
  const deleteToken = async () => {
    if (!actionDialog.token || !canDeleteTokens) return;
    try {
      await window.mms.tokens.remove(actionDialog.token.id, actionReason || (ml ? "ഇവന്റ് കഴിഞ്ഞതിന് ശേഷം താൽക്കാലിക ടോക്കൺ നീക്കം ചെയ്തു" : "Temporary token removed after event"));
      toast.success(ml ? "ടോക്കൺ ഇല്ലാതാക്കി" : "Token deleted");
      setActionDialog({ type: null, token: null }); setActionReason(""); await loadTokens();
    } catch (e: any) { toast.error(e.message || (ml ? "ടോക്കൺ ഇല്ലാതാക്കാൻ കഴിഞ്ഞില്ല" : "Failed to delete token")); }
  };
  const replaceToken = async () => {
    if (!actionDialog.token) return;
    try { const result = await window.mms.tokens.replace(actionDialog.token.id, actionReason || (ml ? "നഷ്ടപ്പെട്ട ടോക്കൺ" : "Lost token")); toast.success(ml ? `പകരം ടോക്കൺ സൃഷ്ടിച്ചു: ${result.tokenCode}` : `Replacement token generated: ${result.tokenCode}`); setActionDialog({ type: null, token: null }); setActionReason(""); await loadTokens(); }
    catch (e: any) { toast.error(e.message || (ml ? "പകരം ടോക്കൺ സൃഷ്ടിക്കാൻ കഴിഞ്ഞില്ല" : "Failed to replace token")); }
  };

  if (viewMode === "select" || viewMode === "review") return (
    <div className="view view-enter">
      <div className="vhead">
        <span className="modic t-pink"><Ticket size={22} /></span>
        <div><h1>{text.selectFamilies} — {selectedEvent?.event_name}</h1><div className="vs">{selectedFamilyIds.size} {text.selected} · {newCount} {text.new} · {alreadyCount} {text.already}</div></div>
        <div className="vr"><Button variant="secondary" onClick={() => setViewMode("list")}>{text.back}</Button>{viewMode === "select" && <Button onClick={() => setViewMode("review")} disabled={!selectedFamilyIds.size}>{text.review} ({selectedFamilyIds.size})</Button>}</div>
      </div>
      {viewMode === "select" ? <>
        <div className="toolbar">
          <Input className="w-64" placeholder={text.searchFamilies} value={familySearch} onChange={e => setFamilySearch(e.target.value)} />
          <Select value={wardFilter} onChange={e => setWardFilter(e.target.value)} className="w-40">{wards.map(w => <option key={w} value={w}>{w === "All" ? text.allWards : w}</option>)}</Select>
          <Button variant="secondary" onClick={() => setSelectedFamilyIds(new Set(families.map(f => f.id)))}>{text.selectAll}</Button>
          <Button variant="secondary" onClick={() => setSelectedFamilyIds(new Set())}>{text.clear}</Button>
          <span className="count-chip">{selectedFamilyIds.size} / {families.length} {text.selected}</span>
        </div>
        <div className="tbl"><table><thead><tr><th className="token-check-col" /><th>{text.familyNo}</th><th>{text.houseName}</th><th>{text.ward}</th><th>{text.phone}</th><th>{text.members}</th><th>{text.status}</th></tr></thead>
          <tbody>{filteredFamilies.map(f => <tr key={f.id} onClick={() => toggleFamily(f.id)}>
            <td><input type="checkbox" checked={selectedFamilyIds.has(f.id)} onChange={() => toggleFamily(f.id)} /></td><td className="token-family-code">{f.family_number}</td><td>{f.house_name}</td><td>{f.ward || "—"}</td><td>{f.phone || "—"}</td><td><Badge variant="muted">{f.member_count}</Badge></td><td>{existingTokens.has(f.id) ? <Badge variant="warning">{text.hasToken}</Badge> : null}</td>
          </tr>)}</tbody></table></div>
      </> : <div className="card token-review">
        <h3>{text.reviewSelection}</h3>
        <div className="token-review-grid"><div className="stat t-em"><div className="val">{selectedFamilyIds.size}</div><div className="slab">{text.selectedFamilies}</div></div><div className="stat t-gold"><div className="val">{newCount}</div><div className="slab">{text.newTokens}</div></div><div className="stat t-slate"><div className="val">{alreadyCount}</div><div className="slab">{text.existingTokens}</div></div></div>
        <h4>{text.wardDistribution}</h4><div className="token-ward-list">{wardDistribution.map(([w, c]) => <span className="count-chip" key={w}>{w}: {c}</span>)}</div>
        {alreadyCount > 0 && <div className="alert-card t-rose token-warning"><AlertTriangle size={16} /><div><b>{alreadyCount} {text.already}</b><p>{text.skipWarning}</p></div></div>}
        <div className="m-f"><Button variant="secondary" onClick={() => setViewMode("select")}>{text.back}</Button><Button onClick={generate} disabled={!newCount}>{text.generateNew}</Button></div>
      </div>}
    </div>
  );

  if (viewMode === "generated") return (
    <div className="view view-enter"><div className="card token-success"><div className="token-success-icon"><CheckCircle2 size={32} /></div><h2>{text.generatedSuccess}</h2><p>{stats.total} {text.totalFor} — {selectedEvent?.event_name}</p><div className="m-f"><Button variant="secondary" onClick={() => generatePdf(false)} disabled={pdfLoading}>{pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}{text.tokenPdf}</Button><Button variant="secondary" onClick={() => generatePdf(true)} disabled={collectionSheetLoading}>{collectionSheetLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}{text.collectionSheet}</Button>{printModeControl}<Button variant="ghost" onClick={() => setViewMode("list")}>{t("nav_tokens")}</Button></div></div></div>
  );

  return (
    <div className="view view-enter">
      <div className="vhead"><span className="modic t-pink"><Ticket size={22} /></span><div><h1>{text.title}</h1><div className="vs">{text.subtitle}</div></div><div className="vr"><Select value={selectedEventId || ""} onChange={e => setSelectedEventId(Number(e.target.value))} className="w-48"><option value="">{text.selectEvent}</option>{events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_name} ({formatDate(ev.event_date)})</option>)}</Select><Button variant="secondary" onClick={() => { setEditingEventId(null); setEventForm({ event_name: "", event_type: "general", event_date: "", event_time: "", venue: "", description: "" }); setEventDialogOpen(true); }}><Plus size={14} /> {text.newEvent}</Button>{selectedEventId && <><Button variant="secondary" onClick={() => editEvent(selectedEventId)}>{text.editEvent}</Button><Button variant={canDeleteEvent ? "danger" : "secondary"} onClick={deleteEvent} disabled={deleteEventBusy || !canDeleteEvent} title={canDeleteEvent ? undefined : (ml ? "ഇവന്റിന്റെ തീയതി ഇതുവരെ കഴിഞ്ഞിട്ടില്ല — ഇവന്റ് കഴിഞ്ഞ ശേഷം മാത്രമേ ഇത് ഇല്ലാതാക്കാനാകൂ" : "This event's date has not yet passed — it can be deleted only after the event is over")}><Trash2 size={14} /> {ml ? "ഇവന്റ് ഇല്ലാതാക്കുക" : "Delete Event"}</Button></>}</div></div>
      {selectedEventId ? <>
        <div className="stat-grid token-stat-grid"><div className="stat t-em"><div className="srow"><span className="sic"><Ticket size={18} /></span><span className="delta">{stats.rate}%</span></div><div className="val">{stats.total}</div><div className="slab">{text.total}</div></div><div className="stat t-teal"><div className="srow"><span className="sic"><CheckCircle2 size={18} /></span></div><div className="val">{stats.collected}</div><div className="slab">{text.collected}</div></div><div className="stat t-gold"><div className="srow"><span className="sic"><Users size={18} /></span></div><div className="val">{stats.remaining}</div><div className="slab">{text.remaining}</div></div><div className="stat t-sky"><div className="srow"><span className="sic"><RefreshCw size={18} /></span></div><div className="val">{stats.rate}%</div><div className="slab">{text.rate}</div></div></div>
        <div className="toolbar"><Button onClick={startSelection}><Plus size={14} /> {text.generate}</Button><Button variant="secondary" onClick={() => generatePdf(false)} disabled={pdfLoading || !stats.total}>{pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}{text.tokenPdf}</Button><Button variant="secondary" onClick={() => generatePdf(true)} disabled={collectionSheetLoading || !stats.total}>{collectionSheetLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}{text.collectionSheet}</Button>{printModeControl}<span className="toolbar-spacer" /><Input className="w-48" placeholder={text.searchToken} value={search} onChange={e => setSearch(e.target.value)} /><Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-32"><option value="All">{text.all}</option><option value="GENERATED">{ml ? "സൃഷ്ടിച്ചത്" : "GENERATED"}</option><option value="COLLECTED">{ml ? "ശേഖരിച്ചത്" : "COLLECTED"}</option><option value="CANCELLED">{ml ? "റദ്ദാക്കിയത്" : "CANCELLED"}</option></Select><Button variant="ghost" onClick={loadTokens} title={t("action_refresh")}><RefreshCw size={14} /></Button></div>
        <div className="tbl"><table><thead><tr><th>{text.token}</th><th>{text.familyNo}</th><th>{text.house}</th><th>{text.ward}</th><th>{text.status}</th><th>{text.generated}</th><th>{text.collected}</th><th>{text.actions}</th></tr></thead><tbody>
          {loading ? <tr><td colSpan={8} className="tempty">{text.loading}</td></tr> : !tokens.length ? <tr><td colSpan={8} className="tempty">{text.noTokens}</td></tr> : tokens.map(tk => <tr key={tk.id}><td className="token-code">{tk.token_code}</td><td>{tk.family_number}</td><td>{tk.house_name || tk.house_number || "—"}</td><td>{tk.ward || "—"}</td><td><Badge variant={tk.status === "COLLECTED" ? "success" : tk.status === "CANCELLED" ? "danger" : "warning"}>{ml ? ({ GENERATED: "സൃഷ്ടിച്ചത്", COLLECTED: "ശേഖരിച്ചത്", CANCELLED: "റദ്ദാക്കിയത്", ISSUED: "നൽകിയത്" } as Record<string, string>)[tk.status] || tk.status : tk.status}</Badge></td><td>{formatDate(tk.created_at)}</td><td>{tk.collected_at ? formatDate(tk.collected_at) : "—"}</td><td><div className="rowact">{tk.status === "GENERATED" && <button className="act-btn act-edit" onClick={() => collect(tk.id)} title={text.markCollected}><Check size={14} /></button>}{tk.status !== "CANCELLED" && <><button className="act-btn act-del" onClick={() => setActionDialog({ type: "cancel", token: tk })} title={text.cancelToken}><Ban size={14} /></button><button className="act-btn act-view" onClick={() => setActionDialog({ type: "replace", token: tk })} title={text.replaceToken}><RotateCcw size={14} /></button></>}{canDeleteTokens && <button className="act-btn act-del" onClick={() => setActionDialog({ type: "delete", token: tk })} title={text.deleteToken}><Trash2 size={14} /></button>}</div></td></tr>)}
        </tbody></table></div>
      </> : <div className="card token-empty"><Ticket size={40} /><h3>{text.noEvent}</h3><p>{text.selectOrCreate}</p></div>}

      <Dialog open={eventDialogOpen} onClose={() => setEventDialogOpen(false)} title={editingEventId ? text.editEvent : text.newEvent}>
        <div className="m-b"><div className="grid-2"><div><Label>{text.eventName} *</Label><Input value={eventForm.event_name} onChange={e => setEventForm({ ...eventForm, event_name: e.target.value })} /></div><div><Label>{text.eventType}</Label><Select value={eventForm.event_type} onChange={e => setEventForm({ ...eventForm, event_type: e.target.value })}><option value="general">{text.general}</option><option value="eid">{text.eid}</option><option value="ramadan">{text.ramadan}</option><option value="welfare">{text.welfare}</option></Select></div><div><Label>{text.date} *</Label><Input type="date" value={eventForm.event_date} onChange={e => setEventForm({ ...eventForm, event_date: e.target.value })} /></div><div><Label>{text.time}</Label><Input type="time" value={eventForm.event_time} onChange={e => setEventForm({ ...eventForm, event_time: e.target.value })} /></div></div><div className="token-form-row"><Label>{text.venue}</Label><Input value={eventForm.venue} onChange={e => setEventForm({ ...eventForm, venue: e.target.value })} /></div><div className="token-form-row"><Label>{text.description}</Label><Input value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} /></div></div><div className="m-f"><Button variant="secondary" onClick={() => setEventDialogOpen(false)}>{t("action_cancel")}</Button><Button onClick={saveEvent}>{text.saveEvent}</Button></div>
      </Dialog>

      <Dialog open={actionDialog.type !== null} onClose={() => { setActionDialog({ type: null, token: null }); setActionReason(""); }} title={actionDialog.type === "cancel" ? text.cancelToken : actionDialog.type === "delete" ? text.deleteToken : actionDialog.type === "deleteEvent" ? (ml ? "ഇവന്റ് ഇല്ലാതാക്കുക" : "Delete Event") : text.replaceToken} className="modal-sm">
        <div className="m-b">{actionDialog.token && <div className="token-action-summary"><div>{text.token}: <b className="token-code">{actionDialog.token.token_code}</b></div><div>{text.house}: {actionDialog.token.house_name}</div></div>}{actionDialog.type === "deleteEvent" ? <p className="token-help">{ml ? "ഇവന്റിന്റെ തീയതി കഴിഞ്ഞതിനാലാണ് ഇത് ഇല്ലാതാക്കാനാകുന്നത്. ഈ ഇവന്റും അതിലെ എല്ലാ ടോക്കണുകളും എന്നേക്കുമായി ഇല്ലാതാക്കപ്പെടും. ഇത് തിരിച്ചെടുക്കാനാകില്ല." : "This event can be deleted because its date is over — there is no need to keep it. The event and all its tokens will be permanently deleted. This cannot be undone."}</p> : actionDialog.type === "cancel" ? <p className="token-help">{ml ? "ഈ ടോക്കൺ റദ്ദാക്കിയതായി അടയാളപ്പെടുത്തും; ഡാറ്റാബേസിൽ നിന്ന് ഇല്ലാതാക്കില്ല." : "This token will be marked as cancelled; it will not be deleted."}</p> : actionDialog.type === "delete" ? <p className="token-help">{text.deleteAfterEvent}</p> : <p className="token-help">{ml ? "പഴയ ടോക്കൺ റദ്ദാക്കി ഈ കുടുംബത്തിന് പുതിയ കോഡ് സൃഷ്ടിക്കും." : "The old token will be cancelled and a new unique code will be generated for this family."}</p>}<><Label>{text.reason}</Label><Input value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder={actionDialog.type === "deleteEvent" ? (ml ? "തെറ്റായി സൃഷ്ടിച്ച ഇവന്റ്" : "Created by mistake") : text.lostToken} /></></div><div className="m-f"><Button variant="secondary" onClick={() => { setActionDialog({ type: null, token: null }); setActionReason(""); }}>{t("action_cancel")}</Button><Button variant={actionDialog.type === "cancel" || actionDialog.type === "delete" || actionDialog.type === "deleteEvent" ? "danger" : "primary"} onClick={actionDialog.type === "cancel" ? cancelToken : actionDialog.type === "delete" ? deleteToken : actionDialog.type === "deleteEvent" ? confirmDeleteEvent : replaceToken}>{actionDialog.type === "cancel" ? text.cancelToken : actionDialog.type === "delete" ? text.deleteToken : actionDialog.type === "deleteEvent" ? (ml ? "ഇല്ലാതാക്കുക" : "Delete") : text.replacement}</Button></div>
      </Dialog>
    </div>
  );
}
