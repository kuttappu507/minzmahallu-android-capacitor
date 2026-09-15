-- V028: dashboard "Collection" card = THIS month's subscription receipts.
-- The view previously summed ALL paid subscriptions ever, so the card
-- disagreed with the collections chart (which is monthly) and with the
-- Accounting page's monthly subscription income. Align all three by
-- scoping the SUM to the current month.
DROP VIEW IF EXISTS v_dashboard_summary;
CREATE VIEW v_dashboard_summary AS
SELECT
 (SELECT COUNT(*) FROM families WHERE status='Active') AS total_families,
 (SELECT COUNT(*) FROM members WHERE status='Active') AS total_members,
 (SELECT COUNT(*) FROM members WHERE status='Active') AS active_members,
 (SELECT COALESCE(SUM(amount_paid),0) FROM subscriptions WHERE status='Paid' AND strftime('%Y-%m', payment_date)=strftime('%Y-%m','now')) AS monthly_collection,
 (SELECT COALESCE(SUM(amount-amount_paid),0) FROM subscriptions WHERE status IN ('Pending','Overdue','Partial') OR amount_paid < amount) AS pending_dues,
 (SELECT COALESCE(SUM(amount),0) FROM donations WHERE strftime('%Y-%m', donation_date)=strftime('%Y-%m','now')) AS monthly_donations,
 (SELECT COUNT(*) FROM welfare_requests WHERE status='Disbursed' AND strftime('%Y', disbursed_date)=strftime('%Y','now')) AS welfare_beneficiaries,
 (SELECT COUNT(*) FROM marriages WHERE strftime('%Y', nikah_date)=strftime('%Y','now')) AS marriages_this_year,
 (SELECT COUNT(*) FROM deaths WHERE strftime('%Y', date_of_death)=strftime('%Y','now')) AS deaths_this_year;
