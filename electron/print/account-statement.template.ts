import { esc } from './utils.js';
import { getAnekMalayalamCss } from './utils.js';
import { getDB } from '../db/connection.js';

interface LedgerRow {
  source_id: number;
  source: string;
  ledger_date: string;
  type: string;
  amount: number;
  description: string;
  category?: string | null;
  payment_method: string;
  transaction_ref: string;
  receipt_number: string;
  status?: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
}

interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  incomeDonations: number;
  incomeSubscriptions: number;
  incomeManual: number;
  expenseWelfare: number;
  expenseSalary: number;
  expenseManual: number;
  entryCount: number;
  period: string;
  from: string | null;
  to: string | null;
}

function activeSettings(): { language: 'en' | 'ml'; mahalluName: string; currencySymbol: string } {
  try {
    const row = getDB().prepare('SELECT language, mahallu_name, currency_symbol FROM settings WHERE id = 1').get() as any;
    return {
      language: row?.language === 'ml' ? 'ml' : 'en',
      mahalluName: String(row?.mahallu_name || 'Minz Mahallu').trim(),
      currencySymbol: String(row?.currency_symbol || '₹'),
    };
  } catch {
    return { language: 'en', mahalluName: 'Minz Mahallu', currencySymbol: '₹' };
  }
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  } catch { return String(d); }
}

function fmtMoney(n: number, sym: string): string {
  return `${sym}${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SOURCE_LABELS: Record<string, { en: string; ml: string }> = {
  transactions: { en: 'Manual Entry', ml: 'മാനുവൽ' },
  donations: { en: 'Donation', ml: 'സംഭാവന' },
  subscriptions: { en: 'Subscription', ml: 'വരിസംഖ്യ' },
  welfare: { en: 'Welfare', ml: 'ക്ഷേമം' },
  salary: { en: 'Salary', ml: 'ശമ്പളം' },
};

const PERIOD_LABELS: Record<string, { en: string; ml: string }> = {
  all: { en: 'All Time', ml: 'എല്ലാ കാലവും' },
  this_month: { en: 'This Month', ml: 'ഈ മാസം' },
  last_month: { en: 'Last Month', ml: 'കഴിഞ്ഞ മാസം' },
  this_quarter: { en: 'This Quarter', ml: 'ഈ ത്രൈമാസികം' },
  last_quarter: { en: 'Last Quarter', ml: 'കഴിഞ്ഞ ത്രൈമാസികം' },
  this_year: { en: 'This Year', ml: 'ഈ വർഷം' },
  last_year: { en: 'Last Year', ml: 'കഴിഞ്ഞ വർഷം' },
  custom: { en: 'Custom Range', ml: 'ഇഷ്ടാനുസൃതം' },
};

export function buildAccountStatementHtml(rows: LedgerRow[], summary: Summary, filter: any = {}): string {
  const settings = activeSettings();
  const ml = settings.language === 'ml';
  const sym = settings.currencySymbol;
  const anekCss = getAnekMalayalamCss();

  const periodKey = filter.period || 'all';
  const periodLabel = (PERIOD_LABELS[periodKey] || PERIOD_LABELS.all)[ml ? 'ml' : 'en'];
  const rangeText = summary.from && summary.to
    ? `${fmtDate(summary.from)} — ${fmtDate(summary.to)}`
    : (periodKey === 'all' ? (ml ? 'എല്ലാ കാലവും' : 'All Time') : '');

  const L = ml ? {
    title: 'അക്കൗണ്ടിംഗ് സ്റ്റേറ്റ്മെന്റ്',
    date: 'തീയതി',
    source: 'ഉറവിടം',
    type: 'തരം',
    description: 'വിവരണം',
    receipt: 'രസീത്',
    method: 'അടവ് രീതി',
    status: 'നില',
    amount: 'തുക',
    income: 'വരുമാനം',
    expense: 'ചെലവ്',
    balance: 'ബാലൻസ്',
    breakdown: 'ഉറവിട വിവരണം',
    incomeDonations: 'സംഭാവനകളിൽ നിന്ന്',
    incomeSubscriptions: 'വരിസംഖ്യകളിൽ നിന്ന്',
    incomeManual: 'മാനുവൽ വരുമാനം',
    expenseWelfare: 'ക്ഷേമ വിതരണം',
    expenseSalary: 'ശമ്പളം നൽകിയത്',
    expenseManual: 'മാനുവൽ ചെലവ്',
    entries: 'രേഖകൾ',
    generated: 'തയ്യാറാക്കിയത്',
    noEntries: 'ഈ കാലയളവിൽ രേഖകളൊന്നുമില്ല.',
    system: 'മഹല്ല് മാനേജ്മെന്റ് സിസ്റ്റം',
  } : {
    title: 'Account Statement',
    date: 'Date',
    source: 'Source',
    type: 'Type',
    description: 'Description',
    category: 'Category',
    receipt: 'Receipt',
    method: 'Method',
    status: 'Status',
    amount: 'Amount',
    income: 'Income',
    expense: 'Expense',
    balance: 'Balance',
    breakdown: 'Source Breakdown',
    incomeDonations: 'Income from Donations',
    incomeSubscriptions: 'Income from Subscriptions',
    incomeManual: 'Manual Income',
    expenseWelfare: 'Welfare Disbursed',
    expenseSalary: 'Salary Paid',
    expenseManual: 'Manual Expense',
    entries: 'entries',
    generated: 'Generated',
    noEntries: 'No entries in this period.',
    system: 'Mahallu Management System',
  };

  // Build table rows
  const tableRows = rows.length ? rows.map((r, i) => {
    const srcLabel = (SOURCE_LABELS[r.source] || { en: r.source, ml: r.source })[ml ? 'ml' : 'en'];
    const isIn = r.type === 'Income';
    const amt = fmtMoney(r.amount, sym);
    const bgColor = i % 2 === 0 ? '#fff' : '#f8faf8';
    return `<tr style="background:${bgColor}">
      <td style="padding:7px 8px;text-align:center;white-space:nowrap">${esc(fmtDate(r.ledger_date))}</td>
      <td style="padding:7px 8px;text-align:center">${esc(srcLabel)}</td>
      <td style="padding:7px 8px;text-align:center;font-weight:600;color:${isIn ? '#0eab7f' : '#e8556e'}">${esc(r.type)}</td>
      <td style="padding:7px 8px">${esc(r.description || '—')}</td>
      <td style="padding:7px 8px;text-align:center">${esc(r.category || '—')}</td>
      <td style="padding:7px 8px;text-align:center;font-family:monospace;font-size:9pt">${esc(r.receipt_number || '—')}</td>
      <td style="padding:7px 8px;text-align:center">${esc(r.payment_method || '—')}</td>
      <td style="padding:7px 8px;text-align:center">${r.status === 'Void'
        ? `<span style="color:#b02a37;font-weight:700;letter-spacing:1px">VOID</span>${r.void_reason ? `<div style="font-size:7pt;color:#b02a37">${esc(String(r.void_reason).slice(0, 40))}${String(r.void_reason).length > 40 ? '…' : ''}</div>` : ''}`
        : '<span style="color:#64748b">—</span>'}</td>
      <td style="padding:7px 8px;text-align:right;font-weight:600;color:${isIn ? '#0eab7f' : '#e8556e'};white-space:nowrap">${isIn ? '+' : '−'}${amt}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" style="padding:30px;text-align:center;color:#94a3b8">${esc(L.noEntries)}</td></tr>`;

  return `<!doctype html><html lang="${ml ? 'ml' : 'en'}"><head><meta charset="utf-8"><title>${esc(L.title)}</title><style>
${anekCss}
@page{size:A4 portrait;margin:12mm}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:210mm;background:#fff}
body{font-family:${ml ? '"Anek Malayalam Variable",' : ''}Poppins,"Anek Malayalam Variable","Segoe UI",Arial,sans-serif;color:#1e293b;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0eab7f;padding-bottom:10px;margin-bottom:12px}
.header-left h1{font-size:16px;font-weight:700;color:#0eab7f;letter-spacing:-0.01em}
.header-left p{font-size:9px;color:#64748b;margin-top:2px}
.header-right{text-align:right}
.header-right .period{font-size:12px;font-weight:600;color:#1e293b}
.header-right .range{font-size:9px;color:#64748b;margin-top:2px}
.header-right .gen{font-size:8px;color:#94a3b8;margin-top:4px}
.summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}
.sum-card{border:1px solid #e6ede7;border-radius:8px;padding:10px 12px;background:#f8faf8}
.sum-card.income{border-left:4px solid #0eab7f}
.sum-card.expense{border-left:4px solid #e8556e}
.sum-card.balance{border-left:4px solid #2b9be0}
.sum-card .lbl{font-size:8px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#64748b}
.sum-card .val{font-size:16px;font-weight:700;margin-top:4px}
.sum-card.income .val{color:#0eab7f}
.sum-card.expense .val{color:#e8556e}
.sum-card.balance .val{color:#2b9be0}
.breakdown{margin-bottom:12px}
.breakdown h3{font-size:10px;font-weight:600;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px}
.bd-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bd-col{border:1px solid #e6ede7;border-radius:8px;padding:8px 10px}
.bd-col h4{font-size:9px;font-weight:600;margin-bottom:4px}
.bd-col.income h4{color:#0eab7f}
.bd-col.expense h4{color:#e8556e}
.bd-row{display:flex;justify-content:space-between;font-size:9.5px;padding:2px 0;color:#475569}
.bd-row b{font-weight:600;color:#1e293b;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;border:1px solid #e6ede7;border-radius:6px;overflow:hidden}
thead th{background:#f1f5f1;padding:8px;font-size:8.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#475569;border-bottom:2px solid #0eab7f;text-align:left}
thead th.center{text-align:center}
thead th.right{text-align:right}
tbody td{border-top:1px solid #e6ede7;font-size:9.5px}
.footer{margin-top:14px;padding-top:8px;border-top:1px solid #e6ede7;text-align:center;font-size:8px;color:#94a3b8}
</style></head><body>
<div class="header">
  <div class="header-left">
    <h1>${esc(settings.mahalluName)}</h1>
    <p>${esc(L.system)}</p>
  </div>
  <div class="header-right">
    <div class="period">${esc(L.title)} · ${esc(periodLabel)}</div>
    <div class="range">${esc(rangeText)}</div>
    <div class="gen">${esc(L.generated)}: ${fmtDate(new Date().toISOString())} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
  </div>
</div>

<div class="summary">
  <div class="sum-card income"><div class="lbl">${esc(L.income)}</div><div class="val">${fmtMoney(summary.totalIncome, sym)}</div></div>
  <div class="sum-card expense"><div class="lbl">${esc(L.expense)}</div><div class="val">${fmtMoney(summary.totalExpense, sym)}</div></div>
  <div class="sum-card balance"><div class="lbl">${esc(L.balance)}</div><div class="val">${fmtMoney(summary.balance, sym)}</div></div>
</div>

<div class="breakdown">
  <h3>${esc(L.breakdown)} · ${summary.entryCount} ${esc(L.entries)}</h3>
  <div class="bd-grid">
    <div class="bd-col income">
      <h4>${esc(L.income)}</h4>
      <div class="bd-row"><span>${esc(L.incomeDonations)}</span><b>${fmtMoney(summary.incomeDonations, sym)}</b></div>
      <div class="bd-row"><span>${esc(L.incomeSubscriptions)}</span><b>${fmtMoney(summary.incomeSubscriptions, sym)}</b></div>
      <div class="bd-row"><span>${esc(L.incomeManual)}</span><b>${fmtMoney(summary.incomeManual, sym)}</b></div>
    </div>
    <div class="bd-col expense">
      <h4>${esc(L.expense)}</h4>
      <div class="bd-row"><span>${esc(L.expenseWelfare)}</span><b>${fmtMoney(summary.expenseWelfare, sym)}</b></div>
      <div class="bd-row"><span>${esc(L.expenseSalary)}</span><b>${fmtMoney(summary.expenseSalary, sym)}</b></div>
      <div class="bd-row"><span>${esc(L.expenseManual)}</span><b>${fmtMoney(summary.expenseManual, sym)}</b></div>
    </div>
  </div>
</div>

<table>
  <thead><tr>
    <th class="center">${esc(L.date)}</th>
    <th class="center">${esc(L.source)}</th>
    <th class="center">${esc(L.type)}</th>
    <th>${esc(L.description)}</th>
    <th class="center">${esc(L.category)}</th>
    <th class="center">${esc(L.receipt)}</th>
    <th class="center">${esc(L.method)}</th>
    <th class="center">${esc(L.status)}</th>
    <th class="right">${esc(L.amount)}</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>

<div class="footer">${esc(settings.mahalluName)} · ${esc(L.system)} · ${fmtDate(new Date().toISOString())}</div>
</body></html>`;
}
