PRAGMA foreign_keys = ON;
CREATE TABLE subscribers (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('pending','subscribed','unsubscribed','suppressed')),
 source TEXT NOT NULL, signup_at INTEGER NOT NULL, confirmed_at INTEGER,
 consent_version TEXT NOT NULL, unsubscribed_at INTEGER, suppression_reason TEXT,
 confirm_hash TEXT UNIQUE, confirm_expires INTEGER, unsubscribe_hash TEXT NOT NULL UNIQUE,
 last_confirmation_at INTEGER NOT NULL,
 consent_evidence TEXT
);
CREATE INDEX subscriber_status ON subscribers(status);
CREATE TABLE campaigns (
 id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, subject TEXT NOT NULL,
 notes TEXT NOT NULL, app_store_url TEXT NOT NULL,
 created_at INTEGER NOT NULL, launched_at INTEGER, public_verified_at INTEGER
);
CREATE TABLE deliveries (
 id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id),
 subscriber_id TEXT REFERENCES subscribers(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('confirmation','announcement','test')),
 payload TEXT, status TEXT NOT NULL DEFAULT 'queued'
 CHECK(status IN ('queued','sending','sent','retry','failed','ambiguous','skipped')),
 attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
 started_at INTEGER, finished_at INTEGER, message_id TEXT, error_code TEXT,
 UNIQUE(campaign_id, subscriber_id, kind)
);
CREATE INDEX delivery_queue ON deliveries(status,available_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE send_reservations (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE INDEX send_reservation_time ON send_reservations(created_at);
CREATE TABLE send_lock (id INTEGER PRIMARY KEY CHECK(id=1), next_at INTEGER NOT NULL);
INSERT INTO send_lock VALUES(1,0);
CREATE TABLE events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, type TEXT NOT NULL);
CREATE TABLE admin_audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL);
