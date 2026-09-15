-- ============================================================================
-- Mahallu Management System (MMS) - SQLite Database Schema
-- Version: 1.0.0
-- Engine: SQLite 3.35+ (required for RETURNING clause)
-- ============================================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA encoding = 'UTF-8';

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);
INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'Initial production schema v1.0.0');

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Administrator','President','Secretary','Treasurer','Imam','Staff','Auditor')),
    email TEXT, phone TEXT, is_active INTEGER NOT NULL DEFAULT 1, is_locked INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT,
    must_change_pwd INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, module TEXT NOT NULL, action TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 0, UNIQUE(role, module, action)
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mahallu_name TEXT NOT NULL DEFAULT 'Minz Mahallu Management', address TEXT, phone TEXT, email TEXT,
    logo_path TEXT, seal_path TEXT, financial_year_start TEXT NOT NULL DEFAULT '04-01', currency_symbol TEXT NOT NULL DEFAULT '₹',
    wakf_reg_no TEXT, society_reg_no TEXT,
    village TEXT, panchayath TEXT, taluk TEXT, district TEXT, pincode TEXT, state TEXT,
    subscription_monthly_amount REAL NOT NULL DEFAULT 100,
    theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')), language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ml')),
    backup_dir TEXT, auto_backup INTEGER NOT NULL DEFAULT 1, backup_interval_hours INTEGER NOT NULL DEFAULT 24,
    receipt_prefix TEXT NOT NULL DEFAULT 'RCP', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT, family_number TEXT NOT NULL UNIQUE, house_name TEXT, house_number TEXT, ward TEXT,
    area TEXT, address TEXT, pincode TEXT, phone TEXT, alternative_phone TEXT,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Archived')), notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_families_ward ON families(ward);
CREATE INDEX IF NOT EXISTS idx_families_status ON families(status);
CREATE INDEX IF NOT EXISTS idx_families_house ON families(house_name);

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT, family_id INTEGER NOT NULL, member_code TEXT UNIQUE, photo_path TEXT,
    name TEXT NOT NULL, arabic_name TEXT, father_name TEXT, gender TEXT NOT NULL CHECK (gender IN ('Male','Female','Other')),
    date_of_birth TEXT, age INTEGER, blood_group TEXT, occupation TEXT, education TEXT,
    marital_status TEXT CHECK (marital_status IN ('Single','Married','Divorced','Widowed')),
    mobile TEXT, email TEXT, nationality TEXT NOT NULL DEFAULT 'Indian', address TEXT, emergency_contact TEXT,
    relationship TEXT, is_head INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Deceased')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_members_family ON members(family_id);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(name);
CREATE INDEX IF NOT EXISTS idx_members_mobile ON members(mobile);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);

CREATE TABLE IF NOT EXISTS subscription_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    -- 'Quarterly' allowed so V021's quarterly plan seed actually lands
    -- (the old CHECK silently rejected it — INSERT OR IGNORE swallows
    -- CHECK violations — so no install ever had the quarterly plan).
    frequency TEXT NOT NULL CHECK (frequency IN ('Monthly','Quarterly','Yearly','OneTime')),
    default_amount REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, description TEXT
);
INSERT OR IGNORE INTO subscription_plans (name, frequency, default_amount) VALUES
 ('Monthly Subscription','Monthly',100),('Yearly Subscription','Yearly',1200),('Special Subscription','OneTime',0);
INSERT OR IGNORE INTO subscription_plans (name, frequency, default_amount, description, is_active) VALUES
 ('Quarterly Subscription','Quarterly',0,'Automatic quarterly household subscription',1);

CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, family_id INTEGER NOT NULL, member_id INTEGER, plan_id INTEGER NOT NULL,
    period_start TEXT, period_end TEXT, amount REAL NOT NULL, amount_paid REAL NOT NULL DEFAULT 0, payment_date TEXT,
    receipt_number TEXT UNIQUE, payment_method TEXT CHECK (payment_method IN ('Cash','Cheque','UPI','Bank Transfer','Card','Other')),
    transaction_ref TEXT, status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Paid','Pending','Overdue','Partial')),
    collected_by INTEGER, remarks TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE RESTRICT, FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id), FOREIGN KEY (collected_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_subs_family ON subscriptions(family_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_period ON subscriptions(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_subs_receipt ON subscriptions(receipt_number);

CREATE TABLE IF NOT EXISTS donation_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, is_active INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO donation_categories (name) VALUES ('General Donation'),('Masjid Donation'),('Building Fund'),('Education Fund'),('Medical Fund');

CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, donor_name TEXT NOT NULL, donor_phone TEXT, donor_address TEXT,
    family_id INTEGER, member_id INTEGER, category_id INTEGER NOT NULL, amount REAL NOT NULL,
    donation_date TEXT NOT NULL DEFAULT (date('now')), receipt_number TEXT UNIQUE, purpose TEXT, remarks TEXT,
    payment_method TEXT CHECK (payment_method IN ('Cash','Cheque','UPI','Bank Transfer','Card','Other')), received_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES donation_categories(id), FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL, FOREIGN KEY (received_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_don_date ON donations(donation_date);
CREATE INDEX IF NOT EXISTS idx_don_category ON donations(category_id);
CREATE INDEX IF NOT EXISTS idx_don_donor ON donations(donor_name);

CREATE TABLE IF NOT EXISTS ledger_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Income','Expense','Asset','Liability')), category TEXT, is_active INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO ledger_accounts (code,name,type,category) VALUES
 ('INC-SUB','Subscription Income','Income','Subscription'),('INC-DON','Donation Income','Income','Donation'),('INC-RENT','Rent Income','Income','Rent'),('INC-OTH','Other Income','Income','Other'),
 ('EXP-SAL','Salary Expense','Expense','Salary'),('EXP-ELC','Electricity Expense','Expense','Electricity'),('EXP-WAT','Water Expense','Expense','Water'),('EXP-MAINT','Maintenance Expense','Expense','Maintenance'),('EXP-WEL','Welfare Expense','Expense','Welfare'),('EXP-OTH','Other Expense','Expense','Other');

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, txn_date TEXT NOT NULL DEFAULT (date('now')), account_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Income','Expense')), amount REAL NOT NULL, payment_method TEXT, reference TEXT,
    description TEXT, linked_module TEXT, linked_id INTEGER, receipt_number TEXT, created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (account_id) REFERENCES ledger_accounts(id), FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_type ON transactions(type);

-- Marriage Register
CREATE TABLE IF NOT EXISTS marriages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, marriage_number TEXT NOT NULL UNIQUE, bride_name TEXT NOT NULL, bride_father TEXT, bride_address TEXT,
    groom_name TEXT NOT NULL, groom_father TEXT, groom_address TEXT, witness1 TEXT, witness2 TEXT, witness3 TEXT, witness4 TEXT, mahar TEXT,
    nikah_date TEXT NOT NULL, registration_date TEXT NOT NULL DEFAULT (date('now')), imam_id INTEGER, place TEXT, remarks TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (imam_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_mrg_number ON marriages(marriage_number);
CREATE INDEX IF NOT EXISTS idx_mrg_date ON marriages(nikah_date);

-- Death Register
CREATE TABLE IF NOT EXISTS deaths (
    id INTEGER PRIMARY KEY AUTOINCREMENT, death_number TEXT NOT NULL UNIQUE, deceased_name TEXT NOT NULL, father_name TEXT, family_id INTEGER,
    gender TEXT, date_of_death TEXT NOT NULL, burial_date TEXT, cause_of_death TEXT, burial_place TEXT, age INTEGER, remarks TEXT,
    place_of_death TEXT, address TEXT, registration_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_dth_number ON deaths(death_number);
CREATE INDEX IF NOT EXISTS idx_dth_date ON deaths(date_of_death);

-- Welfare
CREATE TABLE IF NOT EXISTS welfare_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_number TEXT NOT NULL UNIQUE, applicant_name TEXT NOT NULL, family_id INTEGER,
    category TEXT NOT NULL CHECK (category IN ('Medical Aid','Education Aid','Marriage Assistance','Financial Assistance')),
    amount_requested REAL NOT NULL, amount_approved REAL, reason TEXT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Disbursed','Closed')),
    approved_by INTEGER, disbursed_date TEXT, remarks TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL, FOREIGN KEY (approved_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_wel_status ON welfare_requests(status);
CREATE INDEX IF NOT EXISTS idx_wel_cat ON welfare_requests(category);

-- Certificates
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, certificate_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('Membership','Residence','Marriage','Death','Character','Income')),
    member_id INTEGER, family_id INTEGER, marriage_id INTEGER, death_id INTEGER, issued_to TEXT,
    issued_date TEXT NOT NULL DEFAULT (date('now')), issued_by INTEGER, qr_payload TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL, FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL,
    FOREIGN KEY (marriage_id) REFERENCES marriages(id) ON DELETE SET NULL, FOREIGN KEY (death_id) REFERENCES deaths(id) ON DELETE SET NULL,
    FOREIGN KEY (issued_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cert_type ON certificates(type);
CREATE INDEX IF NOT EXISTS idx_cert_num ON certificates(certificate_number);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, linked_module TEXT NOT NULL, linked_id INTEGER NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL,
    file_type TEXT, file_size INTEGER, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_doc_link ON documents(linked_module, linked_id);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, action TEXT NOT NULL, module TEXT, entity_id INTEGER,
    description TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, started_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT, is_active INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT NOT NULL, message TEXT,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')), is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- Triggers
CREATE TRIGGER IF NOT EXISTS trg_users_updated AFTER UPDATE ON users BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_families_updated AFTER UPDATE ON families BEGIN UPDATE families SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_members_updated AFTER UPDATE ON members BEGIN UPDATE members SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_subs_updated AFTER UPDATE ON subscriptions BEGIN UPDATE subscriptions SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_welfare_updated AFTER UPDATE ON welfare_requests BEGIN UPDATE welfare_requests SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE VIEW IF NOT EXISTS v_defaulters AS
SELECT f.id AS family_id, f.family_number, f.house_name, f.phone, COUNT(s.id) AS pending_count, SUM(s.amount - s.amount_paid) AS due_amount
FROM families f LEFT JOIN subscriptions s ON s.family_id = f.id AND s.status IN ('Pending','Overdue')
WHERE f.status = 'Active' GROUP BY f.id HAVING pending_count > 0;

CREATE VIEW IF NOT EXISTS v_member_directory AS
SELECT m.id AS member_id, m.member_code, m.name, m.arabic_name, m.gender, m.date_of_birth, m.age, m.mobile, m.email, m.occupation, m.blood_group,
       m.marital_status, m.status, f.id AS family_id, f.family_number, f.house_name, f.ward, f.area
FROM members m JOIN families f ON f.id = m.family_id;

DROP VIEW IF EXISTS v_dashboard_summary;
CREATE VIEW IF NOT EXISTS v_dashboard_summary AS
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

-- End of schema.sql
