import {
  Area, AreaChart, Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useI18n } from "@/i18n";
import { getCurrencySymbol } from "@/lib/utils";

/**
 * Dashboard charts, isolated in their own lazy-loaded chunk.
 *
 * WHY: recharts is ~300 kB of JS. Keeping it inside Dashboard.tsx put it on the
 * STARTUP path (Dashboard is the landing route), so low-end machines spent
 * extra time parsing it before first paint. Loaded via React.lazy from
 * Dashboard.tsx, the dashboard text/stat cards render first and these charts
 * stream in a moment later.
 */
export default function DashboardCharts({ collections, incomeExpense, displayLocale }: {
  collections: any[];
  incomeExpense: any[];
  displayLocale: string;
}) {
  const { t } = useI18n();

  // Beautify chart month labels: "2026-08" → "Aug 26" (locale-aware).
  const prettyMonth = (m: string) => {
    const d = new Date(`${m}-01T00:00:00`);
    return d.toLocaleDateString(displayLocale, { month: "short", year: "2-digit" });
  };
  const collectionsChart = (collections || []).map((r: any) => ({ ...r, label: prettyMonth(r.month) }));
  const incomeExpenseChart = (incomeExpense || []).map((r: any) => ({ ...r, label: prettyMonth(r.month) }));

  return (
    <div className="chart-grid">
      <div className="card chart-card t-em">
        <div className="ch-head">
          <div>
            <div className="ch-title">{t("dash_collections_chart")}</div>
            <div className="ch-sub">{t("dash_subscription_receipts")} · {t("dash_last_6_months")}</div>
          </div>
          <div className="ch-legend">
            <span className="lg lg-em">{getCurrencySymbol()}</span>
          </div>
        </div>
        <div className="ch-body">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={collectionsChart}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--c-em)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--c-em)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--fnt)" }} stroke="var(--line)" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--fnt)" }} stroke="var(--line)" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12 }} />
              <Area type="monotone" dataKey="amount" stroke="var(--c-em)" strokeWidth={2.6} fill="url(#g1)" dot={{ r: 2.5, fill: "var(--c-em)", strokeWidth: 0 }} activeDot={{ r: 4.5, stroke: "var(--panel)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card chart-card t-gold">
        <div className="ch-head">
          <div>
            <div className="ch-title">{t("dash_income_vs_expense")}</div>
            <div className="ch-sub">{t("dash_financial_year")} · {t("dash_to_date")}</div>
          </div>
          <div className="ch-legend">
            <span className="lg lg-em">{t("dash_income")}</span>
            <span className="lg lg-rose">{t("dash_expense")}</span>
          </div>
        </div>
        <div className="ch-body">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={incomeExpenseChart} barGap={4}>
              <defs>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--c-em)" stopOpacity={1} />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--c-em) 55%, transparent)" />
                </linearGradient>
                <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--c-rose)" stopOpacity={1} />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--c-rose) 55%, transparent)" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--fnt)" }} stroke="var(--line)" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--fnt)" }} stroke="var(--line)" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12 }} cursor={{ fill: "var(--selbg)" }} />
              <Bar dataKey="income" fill="url(#g2)" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" fill="url(#g3)" radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
