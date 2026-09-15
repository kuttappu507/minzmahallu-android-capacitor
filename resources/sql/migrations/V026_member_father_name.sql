-- V026: member father name + extended family support.
-- Adds an explicit father_name column so any member (not just the head's
-- children) can record their father — needed for marriage/death/certificate
-- prefills and for extended households where the head's siblings and their
-- children live under the same family record.
ALTER TABLE members ADD COLUMN father_name TEXT;

-- Smart backfill: for members recorded as Son/Daughter of the family head,
-- default father_name to the (male) head of the same family when not set.
UPDATE members
SET father_name = (
  SELECT h.name FROM members h
  WHERE h.family_id = members.family_id
    AND h.is_head = 1 AND h.gender = 'Male'
)
WHERE relationship IN ('Son','Daughter')
  AND (father_name IS NULL OR father_name = '');
