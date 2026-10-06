-- Additive pilot only. No curriculum/PDF/legacy OSPE updates or seeds.
CREATE TABLE IF NOT EXISTS practical_image (
  id text PRIMARY KEY, module_id text NOT NULL REFERENCES module(id), study_year integer NOT NULL CHECK (study_year > 0),
  subject text NOT NULL, storage_key text NOT NULL, alt text NOT NULL,
  source_material jsonb NOT NULL, source_page integer NOT NULL CHECK (source_page > 0), markers jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'DRAFT_AI' CHECK (status IN ('DRAFT_AI','REVIEWED','APPROVED')),
  is_fixture boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS practical_question (
  id text PRIMARY KEY, academic_year_id text REFERENCES academic_year(id), study_year integer NOT NULL CHECK (study_year > 0),
  module_id text NOT NULL REFERENCES module(id), subject text NOT NULL, source_lecture_id text REFERENCES lecture(id),
  source_material jsonb NOT NULL, source_page integer NOT NULL CHECK (source_page > 0),
  question_type text NOT NULL CHECK (question_type IN ('LABELED_STRUCTURE','IMAGE_IDENTIFICATION','STRUCTURE_RELATION')),
  answer_format text NOT NULL DEFAULT 'SINGLE_CHOICE' CONSTRAINT practical_single_choice CHECK (answer_format = 'SINGLE_CHOICE'),
  image_id text NOT NULL REFERENCES practical_image(id), marker_ids jsonb NOT NULL DEFAULT '[]',
  group_id text NOT NULL, "order" integer NOT NULL CHECK ("order" >= 0), prompt text NOT NULL, options jsonb NOT NULL,
  correct_option_id text NOT NULL, explanation text NOT NULL, identifying_clue text NOT NULL, common_mistake text NOT NULL, exam_tip text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT_AI' CHECK (status IN ('DRAFT_AI','REVIEWED','APPROVED')), is_fixture boolean NOT NULL DEFAULT false,
  CONSTRAINT practical_correct_option CHECK (options @> jsonb_build_array(jsonb_build_object('id', correct_option_id)))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS practical_progress (
  user_id text NOT NULL REFERENCES "user"(id), question_id text NOT NULL REFERENCES practical_question(id),
  attempts integer NOT NULL DEFAULT 0, correct integer NOT NULL DEFAULT 0, wrong integer NOT NULL DEFAULT 0,
  wrong_remaining boolean NOT NULL DEFAULT false, bookmarked boolean NOT NULL DEFAULT false, difficult boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (user_id, question_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS practical_submission (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), request_id text NOT NULL,
  question_id text NOT NULL REFERENCES practical_question(id), option_id text NOT NULL, correct boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS practical_submission_user_request ON practical_submission(user_id, request_id);
