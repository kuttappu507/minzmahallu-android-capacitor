-- V034: normalize stored Indian WhatsApp numbers to international form (91 + 10 digits).
UPDATE families
SET whatsapp_phone = '91' || whatsapp_phone
WHERE length(whatsapp_phone) = 10
  AND whatsapp_phone GLOB '[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';

UPDATE donations
SET donor_phone = '91' || donor_phone
WHERE length(donor_phone) = 10
  AND donor_phone GLOB '[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';

INSERT OR IGNORE INTO schema_version (version, description)
VALUES (34, 'WhatsApp: normalize existing Indian phone numbers for messaging');
