-- ============================================================================
-- V035: Force password rotation for accounts that still use a password whose
--       PBKDF2 hash was publicly committed to this repository.
--
-- The old demo seed shipped these accounts:
--   admin     / Admin@2026
--   secretary / Demo@2026
--   treasurer / Demo@2026
--   imam      / Demo@2026
-- Anyone who read the source knows those passwords. This migration flags
-- every account whose stored hash matches one of the published hashes with
-- must_change_pwd=1; the login screen then requires a new password before
-- the app can be used. Accounts whose passwords were already changed by the
-- mahallu are matched by nothing and are left untouched (hashes of different
-- passwords cannot collide with these exact strings under PBKDF2-SHA256).
-- ============================================================================

UPDATE users SET must_change_pwd = 1, updated_at = datetime('now')
WHERE password_hash IN (
  'pbkdf2_sha256$200000$zRLKI0xyc2sYKBzQaWXl6w==$qHO4yvos81/Oah+ECzVbh1ZHPz3rEhRHOJT2criWCPg=', -- admin / Admin@2026
  'pbkdf2_sha256$200000$hRTIStQT4VK8ZBjNpWQf7g==$7fR5aF3T+A9EidgDFN2VHmh7G9HQb6hz13/NeZAtP8k=', -- secretary / Demo@2026
  'pbkdf2_sha256$200000$q6CZEKjtV/WgPAhCiSexPw==$ZW2RNRMXVu3hNshy1QRa2vSc0rC4lqxClHuJioP60zA=', -- treasurer / Demo@2026
  'pbkdf2_sha256$200000$gDBUdCewFXQN62ksdP93vQ==$CxBrO1SxhD9PIBy6523wLoyj1+G9uGoG9Ui0o+ho5qI='  -- imam / Demo@2026
);

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (35, 'Force password rotation for accounts with publicly-committed demo passwords');
