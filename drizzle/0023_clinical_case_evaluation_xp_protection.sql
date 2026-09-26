-- Migration 0023: Clinical Case Evaluation History + XP Protection
-- Creates clinical_case_evaluation table for attempt history
-- Adds unique partial index for case_complete XP protection (equivalent to lecture_complete)

-- Clinical Case Evaluation History Table
CREATE TABLE IF NOT EXISTS clinical_case_evaluation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id TEXT NOT NULL REFERENCES clinical_case(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    answers_json JSONB NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    feedback_json JSONB,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (case_id, user_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS clinical_case_evaluation_case_user_idx 
    ON clinical_case_evaluation (case_id, user_id);

-- Unique partial index for case_complete XP protection
-- Prevents duplicate XP awards for the same clinical case completion
-- Equivalent to xp_log_user_lecture_complete_unique for lecture_complete
CREATE UNIQUE INDEX IF NOT EXISTS xp_log_user_case_complete_unique
    ON xp_log (user_id, reason, reference_id)
    WHERE reason = 'case_complete';