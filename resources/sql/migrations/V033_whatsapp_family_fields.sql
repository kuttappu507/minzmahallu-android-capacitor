-- V033: WhatsApp contact preferences for family-head communication.
ALTER TABLE families ADD COLUMN whatsapp_phone TEXT DEFAULT '';
ALTER TABLE families ADD COLUMN whatsapp_enabled INTEGER NOT NULL DEFAULT 1;

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (33, 'WhatsApp family-head number and communication preference');
