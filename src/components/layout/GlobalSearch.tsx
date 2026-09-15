import { useEffect, useMemo, useState } from "react";
import { Search, Users, Home, Receipt, Gift, Calculator, Gem, Flower, Activity, Award, Ticket, Briefcase, Users as UsersIcon, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { getCurrencySymbol } from "@/lib/utils";

type Result = { id: number | string; type: string; title: string; subtitle?: string; route: string; icon: any };
const SOURCES = [["families", "/families", Home, "families"],["members", "/members", Users, "members"],["staff", "/staff", Briefcase, "staff"],["committee", "/committee", UsersIcon, "committee"],["subscriptions", "/subscriptions", Receipt, "subscriptions"],["donations", "/donations", Gift, "donations"],["accounting", "/accounting", Calculator, "accounting"],["marriages", "/marriages", Gem, "marriages"],["deaths", "/deaths", Flower, "deaths"],["welfare", "/welfare", Activity, "welfare"],["certificates", "/certificates", Award, "certificates"],["tokens", "/tokens", Ticket, "tokens"]] as const;
const LABELS: Record<string, [string, string]> = {
  families: ["Families", "കുടുംബങ്ങൾ"], members: ["Members", "അംഗങ്ങൾ"], staff: ["Staff", "ജീവനക്കാർ"], committee: ["Committee", "കമ്മിറ്റി"], subscriptions: ["Subscriptions", "വരിസംഖ്യ"], donations: ["Donations", "സംഭാവനകൾ"], accounting: ["Accounting", "അക്കൗണ്ടിംഗ്"], marriages: ["Marriage", "നികാഹ് രജിസ്റ്റർ"], deaths: ["Death", "മരണ രജിസ്റ്റർ"], welfare: ["Welfare", "ക്ഷേമം"], certificates: ["Certificates", "സർട്ടിഫിക്കറ്റുകൾ"], tokens: ["Tokens", "ടോക്കണുകൾ"],
};
function pickTitle(type: string, row: any) {
  if (type === "families") return row.house_name || row.family_number || "Family";
  if (type === "members") return row.name || row.member_code || "Member";
  if (type === "staff") return row.name || row.staff_code || "Staff";
  if (type === "committee") return row.name || row.committee_code || "Committee";
  if (type === "subscriptions") return row.receipt_number || row.family_number || "Subscription";
  if (type === "donations") return row.donor_name || row.receipt_number || "Donation";
  if (type === "accounting") return row.description || row.receipt_number || "Transaction";
  if (type === "marriages") return row.marriage_number || row.groom_name || row.bride_name || "Marriage";
  if (type === "deaths") return row.death_number || row.name || "Death record";
  if (type === "welfare") return row.application_number || row.member_name || "Welfare record";
  if (type === "certificates") return row.certificate_number || row.issued_to || "Certificate";
  if (type === "tokens") return row.token_code || row.token_number || "Token";
  return "Record";
}
function pickSubtitle(type: string, row: any) {
  if (type === "families") return [row.family_number, row.house_number, row.phone].filter(Boolean).join(" · ");
  if (type === "members") return [row.member_code, row.family_number, row.mobile].filter(Boolean).join(" · ");
  if (type === "staff") return [row.staff_code, row.role, row.phone].filter(Boolean).join(" · ");
  if (type === "committee") return [row.committee_code, row.position, row.committee_type].filter(Boolean).join(" · ");
  if (type === "subscriptions") return [row.family_number, row.member_name, row.status].filter(Boolean).join(" · ");
  if (type === "donations") return [row.receipt_number, row.category_name, row.amount != null ? `${getCurrencySymbol()}${row.amount}` : ""].filter(Boolean).join(" · ");
  if (type === "accounting") return [row.receipt_number, row.type, row.amount != null ? `${getCurrencySymbol()}${row.amount}` : ""].filter(Boolean).join(" · ");
  if (type === "marriages") return [row.marriage_number, row.groom_name, row.bride_name].filter(Boolean).join(" · ");
  if (type === "deaths") return [row.death_number, row.date_of_death].filter(Boolean).join(" · ");
  if (type === "welfare") return [row.application_number, row.status].filter(Boolean).join(" · ");
  if (type === "certificates") return [row.certificate_number, row.type, row.issued_date].filter(Boolean).join(" · ");
  if (type === "tokens") return [row.token_code, row.event_name].filter(Boolean).join(" · ");
  return "";
}
export function GlobalSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const ml = lang === "ml";
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const api: any = (window as any).mms;
        const found: Result[] = [];
        await Promise.all(SOURCES.map(async ([type, route, Icon]) => {
          try {
            const result = await api[type].list({ search: q, page: 1, pageSize: 5 });
            for (const row of (result?.rows || []).slice(0, 5)) found.push({ id: row.id, type, title: pickTitle(type, row), subtitle: pickSubtitle(type, row), route, icon: Icon });
          } catch { /* one unavailable module must not break global search */ }
        }));
        if (!cancelled) { setResults(found.slice(0, 15)); setOpen(true); }
      } finally { if (!cancelled) setLoading(false); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value]);
  const grouped = useMemo(() => results.reduce<Record<string, Result[]>>((acc, item) => { (acc[item.type] ||= []).push(item); return acc; }, {}), [results]);
  const close = () => { setOpen(false); onChange(""); };
  const select = (item: Result) => { setOpen(false); onChange(""); navigate(item.route); };
  return <div className="global-search" data-global-search>
    <Search className="global-search-icon" size={16} strokeWidth={2} />
    <input value={value} onChange={e => onChange(e.target.value)} onFocus={() => value.trim().length >= 2 && setOpen(true)} placeholder={ml ? "കുടുംബം, അംഗം, സർട്ടിഫിക്കറ്റ്..." : "Search families, members, certificates..."} aria-label={ml ? "തിരയുക" : "Global search"} />
    {value && <button className="global-search-clear" type="button" onClick={close} aria-label={t("ui_clear")}><X size={14} /></button>}
    {open && <div className="global-search-results">
      {loading && <div className="global-search-empty">{ml ? "തിരയുന്നു..." : "Searching..."}</div>}
      {!loading && results.length === 0 && <div className="global-search-empty">{ml ? "രേഖകൾ കണ്ടെത്തിയില്ല" : "No matching records"}</div>}
      {!loading && Object.entries(grouped).map(([type, items]) => <section key={type} className="global-search-group">
        <div className="global-search-group-title">{ml ? LABELS[type][1] : LABELS[type][0]}</div>
        {items.map(item => { const Icon = item.icon; return <button key={`${type}-${item.id}`} className="global-search-result" type="button" onMouseDown={e => e.preventDefault()} onClick={() => select(item)}><div className="global-search-result-icon"><Icon size={15} /></div><div className="global-search-result-body"><b>{item.title}</b><span>{item.subtitle}</span></div></button>; })}
      </section>)}
    </div>}
  </div>;
}
