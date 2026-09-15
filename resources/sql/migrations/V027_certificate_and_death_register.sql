-- V027: official certificate support — registration numbers, mahallu location
-- and extended death register fields (matches the SMF death certificate format).
--
-- Settings gains:
--   wakf_reg_no / society_reg_no  → printed on certificates ONLY when filled
--   (affiliation_number stays the SMF reg no and behaves the same way)
--   village/panchayath/taluk/district/pincode/state → mahallu jurisdiction,
--   printed on the death certificate (and available to other certificates).
--
-- Deaths gains:
--   place_of_death    → "Place of death" on the certificate
--   address           → "Permanent address of deceased"
--   registration_date → "Date of Registration" (defaults to created_at date)

ALTER TABLE settings ADD COLUMN wakf_reg_no TEXT;
ALTER TABLE settings ADD COLUMN society_reg_no TEXT;
ALTER TABLE settings ADD COLUMN village TEXT;
ALTER TABLE settings ADD COLUMN panchayath TEXT;
ALTER TABLE settings ADD COLUMN taluk TEXT;
ALTER TABLE settings ADD COLUMN district TEXT;
ALTER TABLE settings ADD COLUMN pincode TEXT;
ALTER TABLE settings ADD COLUMN state TEXT;

ALTER TABLE deaths ADD COLUMN place_of_death TEXT;
ALTER TABLE deaths ADD COLUMN address TEXT;
ALTER TABLE deaths ADD COLUMN registration_date TEXT;

-- Backfill: existing records registered on the day they were created.
UPDATE deaths SET registration_date = COALESCE(registration_date, date(created_at)) WHERE registration_date IS NULL OR registration_date = '';

-- Single-head enforcement cleanup: older data may contain families with TWO OR
-- MORE heads. Keep the earliest registered head and demote every later one to
-- 'Other' so the one-head-per-family invariant holds going forward.
UPDATE members
SET relationship = 'Other', is_head = 0
WHERE (is_head = 1 OR relationship = 'Head')
  AND id NOT IN (
    SELECT MIN(id) FROM members
    WHERE (is_head = 1 OR relationship = 'Head') AND archive_state = 0
    GROUP BY family_id
  );
