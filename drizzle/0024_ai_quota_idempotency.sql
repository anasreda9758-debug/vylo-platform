-- Migration 0024: AI Daily Usage Quota Table + User-Scoped Idempotency
-- NOTE: NOT applied to live. This WIP migration is free to be edited until it
-- ships. Schema types mirror src/features/gamification/schema.ts.
--
-- ai_usage_daily.usage_date is a real SQL DATE. The application computes the
-- Cairo-local YYYY-MM-DD string (usageDateKey) and Postgres stores it as DATE.
--
-- ai_generation_request idempotency is USER-SCOPED: the global unique
-- constraint lives on (user_id, idempotency_key), NOT on idempotency_key
-- alone. Different users may reuse the same idempotency key independently.

-- AI Daily Usage Quota Table (atomic per-day counter)
CREATE TABLE IF NOT EXISTS ai_usage_daily (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,  -- Cairo-local YYYY-MM-DD, computed in application code
    bucket TEXT NOT NULL DEFAULT 'study_generation',  -- 'study_generation' for flashcards/cases/practical
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_date, bucket)
);

CREATE INDEX IF NOT EXISTS ai_usage_daily_user_date_idx
    ON ai_usage_daily (user_id, usage_date);

-- AI Generation Request Table for Idempotent Generation
CREATE TABLE IF NOT EXISTS ai_generation_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    feature TEXT NOT NULL CHECK (feature IN ('flashcard', 'case', 'tutor', 'practical')),
    lecture_id TEXT REFERENCES lecture(id) ON DELETE SET NULL,
    practical_track_id TEXT REFERENCES practical_track(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'duplicate')),
    result_json TEXT,
    quota_reserved INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (user_id, idempotency_key)  -- idempotency is user-scoped, not global
);

CREATE INDEX IF NOT EXISTS ai_generation_request_user_feature_idx
    ON ai_generation_request (user_id, feature, lecture_id, practical_track_id);