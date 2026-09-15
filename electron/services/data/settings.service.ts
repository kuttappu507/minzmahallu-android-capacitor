/* Settings module — split out of data.service.ts (public API unchanged via the facade). */

import { one, run } from "../../db/connection.js";

export const settings = {
  load: () => one<any>("SELECT * FROM settings WHERE id = 1"),
  // Partial update: only the fields actually present in `data` are written.
  // Previously this was a full-row UPDATE with `?? ""` fallbacks, which meant
  // any caller that saved a subset (e.g. language persistence on theme/lang
  // change) silently wiped every field it did not pass — affiliation number,
  // reg nos, terms etc. Callers now merge: load() → save({...loaded, ...patch}).
  save: (data: any) => {
    const current = one<any>("SELECT * FROM settings WHERE id = 1") || {};
    const merged = { ...current, ...data };
    return run(
      `UPDATE settings SET
        mahallu_name = ?, address = ?, phone = ?, email = ?,
        financial_year_start = ?, currency_symbol = ?, subscription_monthly_amount = ?, subscription_frequency = ?, theme = ?, language = ?,
        auto_backup = ?, backup_interval_hours = ?, backup_keep_count = ?, receipt_prefix = ?,
        affiliation_number = ?, committee_term_start = ?, committee_term_end = ?,
        wakf_reg_no = ?, society_reg_no = ?, backup_mirror_dir = ?,
        village = ?, panchayath = ?, taluk = ?, district = ?, pincode = ?, state = ?,
        updated_at = datetime('now')
       WHERE id = 1`,
      [
        merged.mahalluName ?? merged.mahallu_name ?? "", merged.address ?? "", merged.phone ?? "", merged.email ?? "",
        merged.financialYearStart ?? merged.financial_year_start ?? "04-01", merged.currencySymbol ?? merged.currency_symbol ?? "₹",
        Number(merged.subscriptionMonthlyAmount ?? merged.subscription_monthly_amount ?? 0),
        // Frequency: prefer an explicit camelCase value; fall back to the row's
        // snake_case value ONLY when the caller didn't pass the field at all.
        (merged.subscriptionFrequency ?? merged.subscription_frequency) === "Quarterly" ? "Quarterly" : "Monthly",
        merged.theme ?? "light", merged.language ?? "en",
        merged.autoBackup ?? merged.auto_backup ? 1 : 0, Number(merged.backupIntervalHours ?? merged.backup_interval_hours ?? 24),
        Math.max(3, Math.min(200, Number(merged.backupKeepCount ?? merged.backup_keep_count ?? 30) || 30)),
        merged.receiptPrefix ?? merged.receipt_prefix ?? "RCP",
        merged.affiliationNumber ?? merged.affiliation_number ?? "", merged.committeeTermStart ?? merged.committee_term_start ?? "",
        merged.committeeTermEnd ?? merged.committee_term_end ?? "",
        merged.wakfRegNo ?? merged.wakf_reg_no ?? "", merged.societyRegNo ?? merged.society_reg_no ?? "",
        String(merged.backupMirrorDir ?? merged.backup_mirror_dir ?? ""),
        merged.village ?? "", merged.panchayath ?? "", merged.taluk ?? "", merged.district ?? "",
        merged.pincode ?? "", merged.state ?? ""
      ]
    );
  },
};
