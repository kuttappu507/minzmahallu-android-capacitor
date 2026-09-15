-- V021 (formerly V013_subscription_frequency): subscription configuration.
-- Renamed from V013 to fix a version-number collision that caused this migration to be
-- silently skipped on existing databases (V013_add_demo_test_data.sql won the
-- alphabetical sort and consumed version 13).
-- Additive only: never deletes or rewrites existing family/member/financial data.
ALTER TABLE settings ADD COLUMN subscription_frequency TEXT NOT NULL DEFAULT 'Monthly';
INSERT OR IGNORE INTO subscription_plans (name, frequency, default_amount, description, is_active) VALUES ('Quarterly Subscription','Quarterly',0,'Automatic quarterly household subscription',1);
INSERT OR IGNORE INTO subscription_plans (name, frequency, default_amount, description, is_active) VALUES ('Monthly Subscription','Monthly',0,'Automatic monthly household subscription',1);
