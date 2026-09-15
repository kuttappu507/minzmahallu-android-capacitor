import { useEffect, useState } from "react";
import { CalendarDays, Ticket, ArrowRight, RefreshCw, Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/i18n";
import { Button, Badge, Dialog, Input, Label, Textarea, Select } from "@/components/ui";
import { toast } from "@/lib/toast";
import { formatDate, todayIST } from "@/lib/utils";

type EventForm = {
  eventName: string;
  eventType: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  description: string;
};

const emptyForm: EventForm = {
  eventName: "", eventType: "general", eventDate: "", eventTime: "", venue: "", description: "",
};

export function TokenEvents() {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const navigate = useNavigate();
  const [events, setEvents] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EventForm>(emptyForm);
  // Delete-event dialog state: a themed confirm + reason dialog replaces
  // window.confirm, because deletion now needs a reason (audited secure action).
  const [delEvent, setDelEvent] = useState<any | null>(null);
  const [delReason, setDelReason] = useState("");
  const [delBusy, setDelBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await window.mms.tokens.listEvents();
      setEvents(rows || []);
      const pairs = await Promise.all((rows || []).map(async (event: any) => {
        try {
          const result = await window.mms.tokens.list({ eventId: event.id, pageSize: 100000 });
          return [event.id, result?.rows?.filter((r: any) => r.status !== "CANCELLED").length || 0] as const;
        } catch { return [event.id, 0] as const; }
      }));
      setCounts(Object.fromEntries(pairs));
    } catch (e: any) {
      toast.error(e.message || (ml ? "ഇവന്റുകൾ ലോഡ് ചെയ്യാനായില്ല" : "Failed to load events"));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (event: any) => {
    setEditingId(event.id);
    setForm({
      eventName: event.event_name || "",
      eventType: event.event_type || "general",
      eventDate: event.event_date || "",
      eventTime: event.event_time || "",
      venue: event.venue || "",
      description: event.description || "",
    });
    setDialogOpen(true);
  };

  const saveEvent = async () => {
    if (!form.eventName.trim() || !form.eventDate) {
      toast.error(ml ? "ഇവന്റ് പേരും തീയതിയും ആവശ്യമാണ്" : "Event name and date are required");
      return;
    }
    setSaving(true);
    try {
      // The Electron service API uses camelCase payload keys. The old form
      // used snake_case, so create/update received undefined values and failed
      // at the IPC/SQLite boundary.
      if (editingId) await window.mms.tokens.updateEvent(editingId, form);
      else await window.mms.tokens.createEvent(form);
      toast.success(ml ? "ഇവന്റ് സേവ് ചെയ്തു" : "Event saved");
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || (ml ? "ഇവന്റ് സേവ് ചെയ്യാനായില്ല" : "Failed to save event"));
    } finally { setSaving(false); }
  };

  // An event can be deleted only after its date is over — a completed
  // event is a spent record (no need to keep), while an upcoming one is
  // protected (the service layer and DB triggers enforce the same rule
  // server-side).
  const eventIsOver = (ev: any) => !!ev?.event_date && String(ev.event_date) < todayIST();

  const askDeleteEvent = (event: any) => {
    setDelReason("");
    setDelEvent(event);
  };

  const confirmDeleteEvent = async () => {
    if (!delEvent || delBusy) return;
    if (!eventIsOver(delEvent)) {
      toast.error(ml ? "ഇവന്റിന്റെ തീയതി ഇതുവരെ കഴിഞ്ഞിട്ടില്ല — ഇവന്റ് കഴിഞ്ഞ ശേഷം മാത്രമേ ഇത് ഇല്ലാതാക്കാനാകൂ" : "This event's date has not yet passed — it can be deleted only after the event is over");
      setDelEvent(null);
      return;
    }
    setDelBusy(true);
    try {
      const result = await window.mms.tokens.removeEvent(
        delEvent.id,
        delReason.trim() || (ml ? "തെറ്റായി സൃഷ്ടിച്ച ഇവന്റ്" : "Event created by mistake")
      );
      toast.success(
        ml
          ? `ഇവന്റ് ഇല്ലാതാക്കി (${result?.deletedTokens ?? 0} ടോക്കണുകളും)`
          : `Event deleted (with ${result?.deletedTokens ?? 0} tokens)`
      );
      setDelEvent(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || (ml ? "ഇവന്റ് ഇല്ലാതാക്കാനായില്ല" : "Failed to delete event"));
    } finally {
      setDelBusy(false);
    }
  };

  return <div className="view view-enter">
    <div className="vhead">
      <span className="modic t-pink"><CalendarDays size={22} /></span>
      <div><h1>{ml ? "ടോക്കൺ ഇവന്റുകൾ" : "Token Events"}</h1><div className="vs">{ml ? "ഇവന്റ് തിരഞ്ഞെടുക്കുകയും അതിന്റെ ടോക്കണുകൾ കൈകാര്യം ചെയ്യുകയും ചെയ്യുക" : "Choose an event, then manage its issued tokens."}</div></div>
      <div className="vr"><Button onClick={openCreate}><Plus size={14} />{ml ? "പുതിയ ഇവന്റ്" : "New Event"}</Button><Button variant="secondary" onClick={load}><RefreshCw size={14} />{t("action_refresh")}</Button></div>
    </div>

    <div className="card" style={{ overflow: "hidden" }}><div className="tbl"><table><thead><tr><th>{ml ? "ഇവന്റ്" : "Event"}</th><th>{ml ? "തീയതി" : "Date"}</th><th>{ml ? "തരം" : "Type"}</th><th>{ml ? "സ്ഥലം" : "Venue"}</th><th>{ml ? "ടോക്കണുകൾ" : "Tokens"}</th><th>{ml ? "സ്ഥിതി" : "Status"}</th><th>{ml ? "പ്രവർത്തനങ്ങൾ" : "Actions"}</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="tempty">{t("ui_loading")}</td></tr> : !events.length ? <tr><td colSpan={7} className="tempty">{ml ? "ഇവന്റുകളൊന്നുമില്ല" : "No token events yet."}</td></tr> : events.map((event: any) => <tr key={event.id}><td><b>{event.event_name}</b></td><td>{formatDate(event.event_date)}</td><td><Badge variant="muted">{event.event_type}</Badge></td><td>{event.venue || "—"}</td><td><span className="token-code">{counts[event.id] || 0}</span></td><td>{event.status || "ACTIVE"}</td><td><div className="flex gap-2"><Button variant="secondary" onClick={() => navigate(`/tokens/manage?event=${event.id}`)}><Ticket size={14} />{ml ? "ടോക്കണുകൾ" : "Manage"}<ArrowRight size={14} /></Button><Button variant="secondary" onClick={() => openEdit(event)} title={ml ? "തിരുത്തുക" : "Edit"}><Pencil size={14} /></Button><Button variant={eventIsOver(event) ? "danger" : "secondary"} onClick={() => askDeleteEvent(event)} disabled={!eventIsOver(event)} title={eventIsOver(event) ? (ml ? "ഇല്ലാതാക്കുക" : "Delete") : (ml ? "ഇവന്റിന്റെ തീയതി ഇതുവരെ കഴിഞ്ഞിട്ടില്ല — ഇവന്റ് കഴിഞ്ഞ ശേഷം മാത്രമേ ഇത് ഇല്ലാതാക്കാനാകൂ" : "This event's date has not yet passed — it can be deleted only after the event is over")}><Trash2 size={14} /></Button></div></td></tr>)}
    </tbody></table></div></div>

    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingId ? (ml ? "ഇവന്റ് തിരുത്തുക" : "Edit Event") : (ml ? "പുതിയ ഇവന്റ്" : "New Event")}>
      <div className="dlg-pad space-y-4">
        <div><Label>{ml ? "ഇവന്റ് പേര്" : "Event Name"}</Label><Input value={form.eventName} onChange={e => setForm({ ...form, eventName: e.target.value })} autoFocus /></div>
        <div><Label>{ml ? "ഇവന്റ് തരം" : "Event Type"}</Label><Select value={form.eventType} onChange={e => setForm({ ...form, eventType: e.target.value })}><option value="general">{ml ? "പൊതുവായത്" : "General"}</option><option value="eid">{ml ? "ഈദ്" : "Eid"}</option><option value="ramadan">{ml ? "റമദാൻ" : "Ramadan"}</option><option value="welfare">{ml ? "ക്ഷേമം" : "Welfare"}</option><option value="other">{ml ? "മറ്റുള്ളവ" : "Other"}</option></Select></div>
        <div className="grid grid-cols-2 gap-3"><div><Label>{ml ? "തീയതി" : "Date"}</Label><Input type="date" value={form.eventDate} onChange={e => setForm({ ...form, eventDate: e.target.value })} /></div><div><Label>{ml ? "സമയം" : "Time"}</Label><Input type="time" value={form.eventTime} onChange={e => setForm({ ...form, eventTime: e.target.value })} /></div></div>
        <div><Label>{ml ? "സ്ഥലം" : "Venue"}</Label><Input value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} /></div>
        <div><Label>{ml ? "വിവരണം" : "Description"}</Label><Textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="dlg-actions"><Button variant="secondary" onClick={() => setDialogOpen(false)} disabled={saving}>{t("action_cancel")}</Button><Button onClick={saveEvent} disabled={saving}>{saving ? t("ui_saving") : (ml ? "സേവ്" : "Save Event")}</Button></div>
      </div>
    </Dialog>

    <Dialog open={!!delEvent} onClose={() => { if (!delBusy) { setDelEvent(null); setDelReason(""); } }} title={ml ? "ഇവന്റ് ഇല്ലാതാക്കുക" : "Delete Event"} className="modal-sm">
      <div className="dlg-pad space-y-4">
        <div className="token-action-summary"><div><b>{delEvent?.event_name}</b> · {delEvent ? formatDate(delEvent.event_date) : ""}</div><div>{ml ? `ടോക്കണുകൾ: ${counts[delEvent?.id] || 0}` : `Tokens: ${counts[delEvent?.id] || 0}`}</div></div>
        <p className="token-help">{ml ? "ഇവന്റിന്റെ തീയതി കഴിഞ്ഞതിനാലാണ് ഇത് ഇല്ലാതാക്കാനാകുന്നത്. ഈ ഇവന്റും അതിലെ എല്ലാ ടോക്കണുകളും എന്നേക്കുമായി ഇല്ലാതാക്കപ്പെടും. ഇത് തിരിച്ചെടുക്കാനാകില്ല." : "This event can be deleted because its date is over — there is no need to keep it. The event and all its tokens will be permanently deleted. This cannot be undone."}</p>
        <div><Label>{ml ? "കാരണം" : "Reason"}</Label><Input value={delReason} onChange={e => setDelReason(e.target.value)} placeholder={ml ? "തെറ്റായി സൃഷ്ടിച്ച ഇവന്റ്" : "Created by mistake"} autoFocus /></div>
        <div className="dlg-actions"><Button variant="secondary" onClick={() => { setDelEvent(null); setDelReason(""); }} disabled={delBusy}>{t("action_cancel")}</Button><Button variant="danger" onClick={confirmDeleteEvent} disabled={delBusy}>{delBusy ? (ml ? "ഇല്ലാതാക്കുന്നു…" : "Deleting…") : (ml ? "ഇല്ലാതാക്കുക" : "Delete")}</Button></div>
      </div>
    </Dialog>
  </div>;
}
