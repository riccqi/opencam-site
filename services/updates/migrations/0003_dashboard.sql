CREATE TABLE dashboard_codes(id TEXT PRIMARY KEY,digest TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE dashboard_sessions(digest TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE dashboard_settings(id INTEGER PRIMARY KEY CHECK(id=1),postal_address TEXT NOT NULL,daily_limit INTEGER NOT NULL DEFAULT 0);
CREATE TABLE dashboard_drafts(id TEXT PRIMARY KEY,subject TEXT NOT NULL,markdown TEXT NOT NULL,preheader TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,test_hash TEXT,test_delivery_id TEXT,campaign_id TEXT UNIQUE REFERENCES campaigns(id));
ALTER TABLE campaigns ADD COLUMN markdown TEXT;
ALTER TABLE campaigns ADD COLUMN preheader TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN postal_address TEXT;
ALTER TABLE campaigns ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
