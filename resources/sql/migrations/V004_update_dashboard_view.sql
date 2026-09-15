-- V004: Update v_dashboard_summary view
-- Fixes: COLLECTION card (monthly_collection) was filtering by current month
-- and returned 0 when no payments in current month. Now sums ALL 'Paid'
-- subscriptions (all-time total collected).
-- Fixes: DUES card (pending_dues) was excluding 'Partial' status. Now includes
-- all subscriptions where amount_paid < amount (covers Pending, Overdue, Partial).

DROP VIEW IF EXISTS v_dashboard_summary;
CREATE VIEW v_dashboard_summary AS
SELECT
    (SELECT COUNT(*) FROM families WHERE status='Active')      AS total_families,
    (SELECT COUNT(*) FROM members  WHERE status='Active')      AS total_members,
    (SELECT COUNT(*) FROM members  WHERE status='Active')      AS active_members,
    (SELECT COALESCE(SUM(amount_paid),0) FROM subscriptions
        WHERE status = 'Paid')                                 AS monthly_collection,
    (SELECT COALESCE(SUM(amount-amount_paid),0) FROM subscriptions
        WHERE status IN ('Pending','Overdue','Partial')
           OR amount_paid < amount)                            AS pending_dues,
    (SELECT COALESCE(SUM(amount),0) FROM donations
        WHERE strftime('%Y-%m', donation_date) = strftime('%Y-%m','now')) AS monthly_donations,
    (SELECT COUNT(*) FROM welfare_requests WHERE status='Disbursed'
        AND strftime('%Y', disbursed_date)=strftime('%Y','now')) AS welfare_beneficiaries,
    (SELECT COUNT(*) FROM marriages WHERE strftime('%Y', nikah_date)=strftime('%Y','now')) AS marriages_this_year,
    (SELECT COUNT(*) FROM deaths    WHERE strftime('%Y', date_of_death)=strftime('%Y','now')) AS deaths_this_year;
