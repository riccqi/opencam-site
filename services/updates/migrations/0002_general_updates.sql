ALTER TABLE campaigns ADD COLUMN campaign_type TEXT NOT NULL DEFAULT 'release' CHECK(campaign_type IN ('release','update'));
