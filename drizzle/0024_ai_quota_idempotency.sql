-- Migration 0024: AI Daily Usage Quota Table + Idempotency
-- Creates ai_usage_daily table for atomic quota enforcement
-- Creates ai_generation_request table for idempotent generation requests
-- NOTE: schema types match src/features/gamification/schema.ts and src/features/ai/schema.ts

-- AI Daily Usage Quota Table (replaces check-then-act with atomic upsert)
CREATE TABLE IF NOT EXISTS ai_usage_daily (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    usage_date TEXT NOT NULL,  -- 'YYYY-MM-DD' (Egypt/Cairo); matches ORM text column
    bucket TEXT NOT NULL DEFAULT 'study_generation',  -- 'study_generation' for flashcards/cases/practical
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_date, bucket)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS ai_usage_daily_user_date_idx
    ON ai_usage_daily (user_id, usage_date);

-- AI Generation Request Table for Idempotent Generation
CREATE TABLE IF NOT EXISTS ai_generation_request (
    idempotency_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    feature TEXT NOT NULL CHECK (feature IN ('flashcard', 'case', 'tutor', 'practical')),
    lecture_id TEXT REFERENCES lecture(id) ON DELETE SET NULL,
    practical_track_id TEXT REFERENCES practical_track(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'duplicate')),
    result_json TEXT,  -- matches ORM text column
    quota_reserved INTEGER NOT NULL DEFAULT 0,  -- matches ORM integer column
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (user_id, idempotency_key)  -- Redundant with PK but useful for queries
);

CREATE INDEX IF NOT EXISTS ai_generation_request_user_feature_idx
    ON ai_generation_request (user_id, feature, lecture_id, practical_track_id);