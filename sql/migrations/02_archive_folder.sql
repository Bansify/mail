-- Adds 'archive' to the folder CHECK. SQLite cannot alter a CHECK constraint, so the
-- table is rebuilt in one transaction: copy, drop, rename, recreate the indexes.
PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE mail_messages_new (
  id            TEXT PRIMARY KEY,
  to_username   TEXT NOT NULL,
  from_email    TEXT NOT NULL,
  from_name     TEXT,
  to_email      TEXT,
  cc_emails     TEXT NOT NULL DEFAULT '[]',
  bcc_emails    TEXT NOT NULL DEFAULT '[]',
  subject       TEXT,
  snippet       TEXT,
  body_text     TEXT,
  body_html     TEXT,
  body_gzip     BLOB,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  attachments   TEXT NOT NULL DEFAULT '[]',
  folder        TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'archive', 'trash')),
  is_read       INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred    INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  provider_id   TEXT,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO mail_messages_new SELECT * FROM mail_messages;
DROP TABLE mail_messages;
ALTER TABLE mail_messages_new RENAME TO mail_messages;

CREATE INDEX IF NOT EXISTS idx_mail_user_folder
  ON mail_messages (to_username, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_user_starred
  ON mail_messages (to_username, is_starred, received_at DESC) WHERE is_starred = 1;

COMMIT;

PRAGMA foreign_keys = ON;
