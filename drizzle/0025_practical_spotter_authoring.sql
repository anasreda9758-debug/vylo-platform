-- Migration 0025: Practical Spotter Authoring columns
-- Additive columns supporting the real image spotter authoring flow:
--   SOURCE IMAGE  = original uploaded teaching image (may contain labels).
--   EXAM IMAGE    = cleaned / student-safe version. The exam derivative is a
--                   practical_image row with is_exam_derivative = true and a
--                   source_image_id pointing at the labeled original.
--   TARGET        = verified structure coordinates, stored normalised 0..1 on
--                   BOTH the derivative image and every generated question.
--   QUESTION      = arrow + five options; correct_structure is the admin-
--                   verified ground truth (AI never decides the answer).
--
-- The generated artifact and its image carry authoring state:
--   review_status: DRAFT | NEEDS_REVIEW | APPROVED | REJECTED
-- Only rows whose status = 'APPROVED' AND review_status = 'APPROVED' are
-- student-visible; authorship always starts as DRAFT/NEEDS_REVIEW.
--
-- Depends on 0023 (clinical_case_evaluation / xp protection) and 0024
-- (ai_usage_daily / ai_generation_request with id UUID PK).

-- practical_image: source/exam relationship + authoring columns
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS source_image_id TEXT REFERENCES practical_image(id);
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS exam_image_id TEXT REFERENCES practical_image(id);
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS target_x DOUBLE PRECISION;
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS target_y DOUBLE PRECISION;
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS is_exam_derivative BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS generated_by_ai BOOLEAN NOT NULL DEFAULT false;

-- practical_question: verified structure, coordinates, generation provenance
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS source_image_id TEXT REFERENCES practical_image(id);
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS exam_image_id TEXT REFERENCES practical_image(id);
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS target_x DOUBLE PRECISION;
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS target_y DOUBLE PRECISION;
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS correct_structure TEXT;
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS generation_request_id UUID
    REFERENCES ai_generation_request(id) ON DELETE SET NULL;
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS generated_by_ai BOOLEAN NOT NULL DEFAULT false;

-- Normalised coordinates must stay inside 0..1 (NULL until a target is placed).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practical_image_target_range') THEN
        ALTER TABLE practical_image ADD CONSTRAINT practical_image_target_range
            CHECK (target_x IS NULL OR (target_x >= 0 AND target_x <= 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practical_question_target_range') THEN
        ALTER TABLE practical_question ADD CONSTRAINT practical_question_target_range
            CHECK (target_x IS NULL OR (target_x >= 0 AND target_x <= 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practical_image_target_y_range') THEN
        ALTER TABLE practical_image ADD CONSTRAINT practical_image_target_y_range
            CHECK (target_y IS NULL OR (target_y >= 0 AND target_y <= 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practical_question_target_y_range') THEN
        ALTER TABLE practical_question ADD CONSTRAINT practical_question_target_y_range
            CHECK (target_y IS NULL OR (target_y >= 0 AND target_y <= 1));
    END IF;
END
$$;