-- Migration V002: Add language column to settings table
ALTER TABLE settings ADD COLUMN language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ml'));
