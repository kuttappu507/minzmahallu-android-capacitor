import { lazy, Suspense } from "react";
import { useAsync } from "@/hooks/useList";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import {
  Home, Users, UserCheck, Wallet, AlertCircle,
  Gift, Gem, Flower, TrendingUp,
  Plus, User, BarChart3, RefreshCw, Clock, Database, ShieldCheck,
  ArrowUpRight, ArrowDownRight, ReceiptText, HeartHandshake, CalendarClock,
} from "lucide-react";

// Charts (recharts ~300 kB) live in their own lazy chunk so the dashboard
// paints before the chart library is parsed — faster startup on low-end PCs.
const DashboardCharts = lazy(() => import("./dashboard/DashboardCharts"));

export function Dashboard() {
  const { t, isMalayalam } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const displayLocale = isMalayalam() ? "ml-IN" : "en-IN";
  const ml = (en: string, m: string) => (isMalayalam() ? m : en);

  const { data: summary, refresh: refreshSummary } = useAsync(() => window.mms.dashboard.summary(), []);
  const { data: balance } = useAsync(() => window.mms.dashboard.balance(), []);
  const { data: collections } = useAsync(() => window.mms.dashboard.monthlyCollections(6), []);
  const { data: incomeExpense } = useAsync(() => window.mms.dashboard.incomeVsExpense(6), []);
  const { data: recentActivity, refresh: refreshActivity } = useAsync(() => window.mms.dashboard.recentActivity(8), []);
  const { data: alerts } = useAsync(() => window.mms.dashboard.alerts(), []);
  const { data: glance, refresh: refreshGlance } = useAsync(() => window.mms.dashboard.todayAtGlance(), []);

  // Compute real deltas from available data instead of using hardcoded strings.
  // For financial stats, compute month-over-month % change from the 6-month
  // collections/incomeExpense arrays. For count stats, use descriptive labels.
  const thisMonthColl = (collections && collections.length > 0) ? Number(collections[collections.length - 1]?.amount || 0) : 0;
  const lastMonthColl = (collections && collections.length > 1) ? Number(collections[collections.length - 2]?.amount || 0) : 0;
  const collDelta = lastMonthColl > 0 ? Math.round(((thisMonthColl - lastMonthColl) / lastMonthColl) * 100) : null;

  const balanceVal = balance ?? glance?.fundBalance ?? 0;
  const thisMonthIncome = (incomeExpense && incomeExpense.length > 0) ? Number(incomeExpense[incomeExpense.length - 1]?.income || 0) : 0;
  const thisMonthExpense = (incomeExpense && incomeExpense.length > 0) ? Number(incomeExpense[incomeExpense.length - 1]?.expense || 0) : 0;
  const netThisMonth = thisMonthIncome - thisMonthExpense;
  const lastMonthNet = (incomeExpense && incomeExpense.length > 1) ? (Number(incomeExpense[incomeExpense.length - 2]?.income || 0) - Number(incomeExpense[incomeExpense.length - 2]?.expense || 0)) : 0;
  const balDelta = lastMonthNet !== 0 ? Math.round(((netThisMonth - lastMonthNet) / Math.abs(lastMonthNet)) * 100) : null;

  // Real backup chip: healthy when auto-backup is on and a backup exists within
  // the configured interval; otherwise surface a warning instead of "Backup OK".
  const backupHealthy = (() => {
    if (!glance) return null;
    if (!glance.backupEnabled) return false;
    if (!glance.lastBackup) return false;
    return glance.nextBackup ? new Date(glance.nextBackup).getTime() > Date.now() + 10 * 60 * 1000 : true;
  })();

  // Format the next auto-backup time for the glance card.
  const nextBackupLabel = (() => {
    if (!glance?.backupEnabled) return ml("Off", "ഓഫ്");
    if (!glance.nextBackup) return "—";
    const t = new Date(glance.nextBackup);
    if (t.getTime() <= Date.now()) return ml("Soon", "ഉടൻ");
    const dd = String(t.getDate()).padStart(2, "0");
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const yyyy = t.getFullYear();
    const time = t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const sameDay = t.toDateString() === new Date().toDateString();
    return sameDay ? time : `${dd}-${mm}-${yyyy} ${time}`;
  })();

  // Headline date is always dd-mm-yyyy (the app's display convention).
  const today = new Date();
  const todayLabel = `${today.toLocaleDateString(displayLocale, { weekday: "long" })}, ${String(today.getDate()).padStart(2, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${today.getFullYear()}`;

  const stats = [
    { label: t("dash_total_families"), value: summary?.total_families ?? 0, icon: Home, tint: "t-em", delta: t("dash_active") },
    { label: t("dash_total_members"), value: summary?.total_members ?? 0, icon: Users, tint: "t-teal", delta: t("dash_total_registered") },
    { label: t("dash_active_members"), value: summary?.active_members ?? 0, icon: UserCheck, tint: "t-sky", delta: t("dash_active") },
    { label: t("dash_monthly_collection"), value: formatCurrency(summary?.monthly_collection ?? 0), icon: Wallet, tint: "t-gold", delta: collDelta !== null ? `${collDelta >= 0 ? "+" : ""}${collDelta}%` : t("dash_this_month"), dir: collDelta },
    { label: t("dash_pending_dues"), value: formatCurrency(summary?.pending_dues ?? 0), icon: AlertCircle, tint: "t-rose", delta: t("dash_overdue") },
    { label: t("dash_donations_month"), value: formatCurrency(summary?.monthly_donations ?? 0), icon: Gift, tint: "t-pink", delta: t("dash_this_month") },
    { label: t("dash_marriages_year"), value: summary?.marriages_this_year ?? 0, icon: Gem, tint: "t-orange", delta: t("dash_this_year") },
    { label: t("dash_deaths_year"), value: summary?.deaths_this_year ?? 0, icon: Flower, tint: "t-slate", delta: t("dash_this_year") },
  ];

  const quickActions = [
    { label: t("dash_qa_add_family"), icon: Plus, action: "families" },
    { label: t("dash_qa_add_member"), icon: User, action: "members" },
    { label: t("dash_qa_record_payment"), icon: Wallet, action: "subscriptions" },
    { label: t("dash_qa_add_donation"), icon: Gift, action: "donations" },
    { label: t("dash_qa_generate_report"), icon: BarChart3, action: "reports" },
  ];

  return (
    <div className="view view-enter">
      {/* ===== Hero bento: greeting card + fund spotlight + mini P&L ===== */}
      <div className="hero-row">
        <div className="hero t-em">
          <div className="overline">{t("app_name")} · {todayLabel}</div>
          <h1>{t("dash_greeting")} <span className="text-em">{user?.fullName}</span></h1>
          <p className="sub">{t("dash_subtitle")}</p>
          <div className="gchips">
            <span className="gchip t-gold"><Clock size={13} /> {t("dash_week")} {Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))} · {t("dash_day")} {Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (24 * 60 * 60 * 1000))}</span>
            <span className="gchip t-sky"><Wallet size={13} /> {t("dash_fy")} {new Date().getFullYear()}-{String(new Date().getFullYear() + 1).slice(-2)} · Q{Math.floor(new Date().getMonth() / 3) + 1}</span>
            <span className={`gchip ${backupHealthy === false ? "t-rose" : "t-em"}`}><Database size={13} /> {backupHealthy === null ? t("dash_backup_ok") : backupHealthy ? t("dash_backup_ok") : ml("Backup attention needed", "ബാക്കപ്പ് ശ്രദ്ധ ആവശ്യമുണ്ട്")}</span>
          </div>
        </div>
        <div className="hero-side">
          <div className="card dash-spot t-gold">
            <div className="hs-top">
              <span className="hs-ic"><TrendingUp size={18} /></span>
              <span className="hs-lab">{t("dash_fund_balance_short")}</span>
            </div>
            <div className="hs-val">{formatCurrency(balanceVal)}</div>
            <div className="hs-foot">
              <span className={`delta ${balDelta === null ? "" : balDelta >= 0 ? "pos" : "neg"}`}>
                {balDelta !== null && (balDelta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />)}
                {balDelta !== null ? `${Math.abs(balDelta)}%` : t("dash_all_funds")}
              </span>
              <span className="hs-hint">{ml("vs last month", "കഴിഞ്ഞ മാസവുമായി താരതമ്യം")}</span>
            </div>
          </div>
          <div className="card dash-mini t-em">
            <div className="dm-row"><span>{t("dash_income")}</span><b>{formatCurrency(thisMonthIncome)}</b></div>
            <div className="dm-row"><span>{t("dash_expense")}</span><b>{formatCurrency(thisMonthExpense)}</b></div>
            <div className="dm-row dm-net"><span>{ml("Net this month", "ഈ മാസം അറ്റാദായം")}</span><b>{formatCurrency(netThisMonth)}</b></div>
          </div>
        </div>
      </div>

      {/* ===== Quick action strip ===== */}
      <div className="qa-strip">
        {quickActions.map((qa, i) => {
          const Icon = qa.icon;
          return (
            <button key={i} className="qa" onClick={() => navigate(`/${qa.action}`)}>
              <span className="qic"><Icon size={15} /></span>
              <b>{qa.label}</b>
            </button>
          );
        })}
      </div>

      {/* ===== Alerts banner ===== */}
      {alerts && alerts.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {alerts.map((a: any, i: number) => (
            <button key={i} onClick={() => navigate(a.route)} className="alert-chip" style={{ cursor: "pointer" }}>
              <AlertCircle size={14} />
              <span>
                {a.type === "committee_ending" && ml(`${a.count} committee ${a.count === 1 ? "term" : "terms"} ending soon`, `${a.count} കമ്മിറ്റി കാലാവധി അടുത്തു`)}
                {a.type === "subscriptions_overdue" && ml(`${a.count} overdue subscription${a.count === 1 ? "" : "s"}`, `${a.count} കുടിശ്ശിക വരിസംഖ്യ`)}
                {a.type === "welfare_pending" && ml(`${a.count} welfare request${a.count === 1 ? "" : "s"} pending`, `${a.count} ക്ഷേമ അപേക്ഷ തീർപ്പാക്കാനുണ്ട്`)}
                {a.type === "receipt_gaps" && ml(`${a.count} missing receipt number${a.count === 1 ? "" : "s"} — check Receipts`, `രസീത് ശ്രേണിയിൽ ${a.count} വിടവ് — പരിശോധിക്കുക`)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ===== Stat tiles ===== */}
      <div className="stat-grid">
        {stats.map((s: any, i: number) => {
          const Icon = s.icon;
          const dir = typeof s.dir === "number" ? s.dir : null;
          return (
            <div key={i} className={`stat ${s.tint}`}>
              <div className="slab">{s.label}</div>
              <div className="val">{s.value}</div>
              <div className="srow">
                <span className="sic"><Icon size={16} /></span>
                <span className={`delta ${dir === null ? "" : dir >= 0 ? "pos" : "neg"}`}>
                  {dir !== null && (dir >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />)}
                  {s.delta}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== Charts — lazy chunk (recharts); skeleton keeps the grid height stable ===== */}
      <Suspense fallback={
        <div className="chart-grid">
          <div className="card chart-card"><div className="skel skel-line skel-line-lg" /></div>
          <div className="card chart-card"><div className="skel skel-line skel-line-lg" /></div>
        </div>
      }>
        <DashboardCharts collections={collections || []} incomeExpense={incomeExpense || []} displayLocale={displayLocale} />
      </Suspense>

      {/* ===== Bottom split: audit trail + today rail ===== */}
      <div className="dash-bottom">
        <div className="card card-pad-4 db-activity">
          <div className="ch-head">
            <div>
              <div className="ch-title">{t("dash_recent_activity")}</div>
              <div className="ch-sub">{t("dash_last_audit")}</div>
            </div>
            <button className="btn bs bg" onClick={() => { refreshSummary(); refreshActivity(); refreshGlance(); }}>
              <RefreshCw size={13} /> {t("action_refresh")}
            </button>
          </div>
          <div className="tbl tbl-flat mt-2">
            <table>
              <thead>
                <tr>
                  <th>{t("audit_time")}</th>
                  <th>{t("audit_user")}</th>
                  <th>{t("audit_action")}</th>
                  <th>{t("audit_description")}</th>
                </tr>
              </thead>
              <tbody>
                {(recentActivity || []).length === 0 ? (
                  <tr><td colSpan={4} className="tempty">{t("dash_no_activity")}</td></tr>
                ) : (
                  (recentActivity || []).slice(0, 6).map((a: any) => (
                    <tr key={a.id}>
                      <td><span className="recent-time">{new Date(a.created_at).toLocaleTimeString(displayLocale, { hour: "2-digit", minute: "2-digit" })}</span></td>
                      <td>{a.username}</td>
                      <td><span className="pill t-slate">{a.action}</span></td>
                      <td><span className="recent-desc">{a.description}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="db-side">
          <div className="glance">
            <b>{t("dash_today_glance")}</b>
            <div className="g-row t-em"><span className="g-ic"><ReceiptText size={13} /></span><span>{t("dash_receipts_today")}</span><b>{glance?.receiptsToday ?? 0}</b></div>
            <div className="g-row t-pink"><span className="g-ic"><HeartHandshake size={13} /></span><span>{t("dash_welfare_pending")}</span><b>{glance?.welfarePending ?? 0}</b></div>
            <div className="g-row t-gold"><span className="g-ic"><CalendarClock size={13} /></span><span>{t("dash_next_backup")}</span><b>{nextBackupLabel}</b></div>
          </div>
          <div className={`db-backup ${backupHealthy === false ? "t-rose" : "t-em"}`}>
            <span className="db-backup-ic"><ShieldCheck size={17} /></span>
            <div>
              <b>{ml("Data protection", "ഡാറ്റ സംരക്ഷണം")}</b>
              <small>{backupHealthy === null ? ml("Backup status unknown", "ബാക്കപ്പ് നില അറിയില്ല") : backupHealthy ? ml("Auto-backup active", "ഓട്ടോ ബാക്കപ്പ് സജീവം") : ml("Backup attention needed", "ബാക്കപ്പ് ശ്രദ്ധ ആവശ്യമുണ്ട്")}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
