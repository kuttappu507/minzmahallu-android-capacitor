import { useState } from "react";
import { ScrollText, Eye, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { useList } from "@/hooks/useList";
import { Badge, Select, Button, Dialog } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { formatDateTime } from "@/lib/utils";
import { toast } from "@/lib/toast";

interface AuditEntry {
  id: number;
  created_at: string;
  username: string;
  action: string;
  module: string;
  description: string;
  entity_id: number;
  metadata: string;
  user_id: number;
  prev_hash: string | null;
  entry_hash: string | null;
}

interface VerifyResult {
  intact: boolean;
  verified: number;
  legacyRows: number;
  brokenAtId: number | null;
  eventCount: number;
  anchorMatches: boolean;
  verifiedAt: string;
}

function actionVariant(action: string): "default" | "success" | "warning" | "danger" | "info" | "muted" {
  const a = action?.toUpperCase() || "";
  if (a.includes("CREATE")) return "success";
  if (a.includes("UPDATE")) return "info";
  if (a.includes("DELETE")) return "danger";
  if (a.includes("LOGIN") || a.includes("LOGOUT")) return "muted";
  if (a.includes("APPROVE") || a.includes("DISBURSE")) return "default";
  if (a.includes("REJECT")) return "warning";
  return "muted";
}

export function AuditLog() {
  const { t, isMalayalam } = useI18n();
  const tx = (en: string, ml: string) => isMalayalam() ? ml : en;
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<AuditEntry | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const { rows, total, totalPages, loading } = useList(
    (filter) => window.mms.audit.list(filter),
    { pageSize: 50 }
  );

  const runVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await window.mms.audit.verify();
      setVerifyResult(res);
      if (res?.intact) {
        toast.success(tx(`Audit chain intact — ${res.verified} events verified`, `ഓഡിറ്റ് ശൃംഖല സുരക്ഷിതം — ${res.verified} ഇവന്റുകൾ പരിശോധിച്ചു`));
      } else {
        toast.error(tx("Audit chain BROKEN — a record was modified or deleted!", "ഓഡിറ്റ് ശൃംഖല തകർന്നു — ഒരു രേഖ മാറ്റുകയോ ഇല്ലാതാക്കുകയോ ചെയ്തിട്ടുണ്ട്!"));
      }
    } catch (e: any) {
      toast.error(e.message || tx("Verification failed", "പരിശോധന പരാജയപ്പെട്ടു"));
    } finally {
      setVerifying(false);
    }
  };

  const handleRowDoubleClick = (row: AuditEntry) => {
    setPreviewRow(row);
    setPreviewOpen(true);
  };

  const columns: Column<AuditEntry>[] = [
    { header: t("audit_time"), accessor: (r) => formatDateTime(r.created_at) },
    { header: t("audit_user"), accessor: (r) => <span className="font-medium">{r.username}</span> },
    {
      header: t("audit_action"),
      accessor: (r) => <Badge variant={actionVariant(r.action)}>{r.action}</Badge>,
    },
    { header: t("audit_module"), accessor: (r) => <span className="text-text-secondary">{r.module}</span> },
    { header: t("audit_description"), accessor: (r) => r.description || "—" },
  ];

  const previewDetails = previewRow
    ? [
        { k: t("audit_time"), v: formatDateTime(previewRow.created_at) },
        { k: t("audit_user"), v: previewRow.username || "—" },
        { k: t("audit_action"), v: previewRow.action || "—" },
        { k: t("audit_module"), v: previewRow.module || "—" },
        { k: t("ui_entity_id"), v: previewRow.entity_id != null ? String(previewRow.entity_id) : "—" },
        { k: t("ui_user_id"), v: previewRow.user_id != null ? String(previewRow.user_id) : "—" },
        { k: t("audit_description"), v: previewRow.description || "—", full: true },
        { k: t("ui_metadata"), v: previewRow.metadata || "—", full: true },
        { k: tx("Chain hash", "ശൃംഖല ഹാഷ്"), v: previewRow.entry_hash ? previewRow.entry_hash.slice(0, 24) + "…" : tx("legacy (no hash)", "പഴയ രേഖ"), full: true },
      ]
    : [];

  return (
    <div className="view view-enter">
      <div className="vhead">
        <div className="modic t-em">
          <ScrollText size={20} />
        </div>
        <div>
          <h1>{t("audit_title")}</h1>
          <div className="vs">{t("audit_subtitle")}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows as AuditEntry[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={50}
        totalPages={totalPages}
        onPageChange={setPage}
        searchValue={search}
        onSearchChange={setSearch}
        rowKey={(r) => r.id}
        onRowDoubleClick={handleRowDoubleClick}
        searchPlaceholder="Search by user or description..."
        toolbar={
          <div className="flex items-center gap-2">
            <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-48">
              <option value="All">{t("filter_all")}</option>
              <option>CREATE</option>
              <option>UPDATE</option>
              <option>DELETE</option>
              <option>LOGIN</option>
              <option>LOGOUT</option>
            </Select>
            <Button variant="secondary" onClick={runVerify} disabled={verifying}>
              {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {tx("Verify integrity", "സമഗ്രത പരിശോധിക്കുക")}
            </Button>
          </div>
        }
      />

      {verifyResult && (
        <div className={`mt-3 rounded-lg border px-4 py-3 text-sm flex items-start gap-3 ${verifyResult.intact ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
          {verifyResult.intact ? <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" /> : <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />}
          <div>
            {verifyResult.intact ? (
              <b>{tx("Audit chain intact", "ഓഡിറ്റ് ശൃംഖല സുരക്ഷിതം")} ✓</b>
            ) : (
              <b>{tx("Audit chain BROKEN", "ഓഡിറ്റ് ശൃംഖല തകർന്നു")} — {tx("tampering detected", "കൃത്രിമം കണ്ടെത്തി")}!</b>
            )}
            <div className="opacity-80">
              {tx("Events verified", "പരിശോധിച്ച ഇവന്റുകൾ")}: {verifyResult.verified}
              {verifyResult.legacyRows > 0 && <> · {tx("legacy (pre-hash) rows", "പഴയ രേഖകൾ")}: {verifyResult.legacyRows}</>}
              {verifyResult.brokenAtId != null && <> · {tx("first broken record id", "ആദ്യം തകർന്ന രേഖ ഐഡി")}: {verifyResult.brokenAtId}</>
              } · {tx("checked at", "പരിശോധിച്ച സമയം")}: {formatDateTime(verifyResult.verifiedAt)}
            </div>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewRow(null); }}
        title={t("audit_title")}
      >
        <div className="dlg-pad">
          {previewRow && (
            <>
              <div className="dlg-hero t-em">
                <div className="dlg-hero-ic">
                  <Eye size={20} />
                </div>
                <div className="dlg-hero-body">
                  <div className="dlg-hero-title">
                    {previewRow.action}
                  </div>
                  <div className="dlg-hero-sub">
                    {previewRow.username} · {previewRow.module} · {formatDateTime(previewRow.created_at)}
                  </div>
                </div>
                <Badge variant={actionVariant(previewRow.action)}>{previewRow.action}</Badge>
              </div>
              <div className="det-grid">
                {previewDetails.map((d, i) => (
                  <div key={i} className={`det${d.full ? " full" : ""}`}>
                    <span className="k">{d.k}</span>
                    <span className="v">{d.v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="dlg-actions">
            <Button variant="secondary" onClick={() => { setPreviewOpen(false); setPreviewRow(null); }}>
              {t("ui_close")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
