-- Additive Practical generalization. No curriculum, PDF, mapping, billing, or question content changes.
CREATE TABLE IF NOT EXISTS practical_track (
  id text PRIMARY KEY,
  module_id text NOT NULL REFERENCES module(id),
  subject text NOT NULL CHECK (subject IN ('ANATOMY','HISTOLOGY','PATHOLOGY','MICROBIOLOGY','PHYSIOLOGY','BIOCHEMISTRY')),
  subject_slug text NOT NULL,
  display_name_en text NOT NULL,
  display_name_ar text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  sort_order integer NOT NULL DEFAULT 0,
  practice_enabled boolean NOT NULL DEFAULT true,
  ospe_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT practical_track_module_subject_slug UNIQUE (module_id, subject_slug)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS practical_track_module_status_order ON practical_track(module_id, status, sort_order);
--> statement-breakpoint
ALTER TABLE practical_image ADD COLUMN IF NOT EXISTS practical_track_id text REFERENCES practical_track(id);
--> statement-breakpoint
ALTER TABLE practical_question ADD COLUMN IF NOT EXISTS practical_track_id text REFERENCES practical_track(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS practical_image_track_idx ON practical_image(practical_track_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS practical_question_track_idx ON practical_question(practical_track_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS practical_track_ospe_station (
  track_id text NOT NULL REFERENCES practical_track(id) ON DELETE CASCADE,
  answer_key_id text NOT NULL REFERENCES ospe_answer_key(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, answer_key_id)
);
-- Intentionally no OSPE association backfill is performed here. Existing
-- stations stay unchanged and unclassified. A future backfill must use a
-- human-reviewed station -> practical_track decision manifest; folder names,
-- filenames, module slugs, and titles are not acceptable subject evidence.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS practical_track_ospe_answer_key_idx ON practical_track_ospe_station(answer_key_id);
--> statement-breakpoint
ALTER TABLE ospe_exam ADD COLUMN IF NOT EXISTS practical_track_id text REFERENCES practical_track(id);
--> statement-breakpoint
INSERT INTO practical_track (
  id, module_id, subject, subject_slug, display_name_en, display_name_ar,
  status, sort_order, practice_enabled, ospe_enabled
)
SELECT 'practical-track-rau-203-anatomy', id, 'ANATOMY', 'anatomy', 'Anatomy', 'التشريح',
       'PUBLISHED', 0, true, false
FROM module
WHERE slug = 'rau-203'
ON CONFLICT (module_id, subject_slug) DO NOTHING;
--> statement-breakpoint
UPDATE practical_image AS image
SET practical_track_id = track.id
FROM practical_track AS track
WHERE image.practical_track_id IS NULL
  AND image.module_id = track.module_id
  AND track.subject_slug = 'anatomy'
  AND lower(image.subject) = 'anatomy';
--> statement-breakpoint
UPDATE practical_question AS question
SET practical_track_id = track.id
FROM practical_track AS track
WHERE question.practical_track_id IS NULL
  AND question.module_id = track.module_id
  AND track.subject_slug = 'anatomy'
  AND lower(question.subject) = 'anatomy';
