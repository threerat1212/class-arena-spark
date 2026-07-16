-- Exam System with Proctoring — schema
-- Spec: docs/superpowers/specs/2026-07-16-exam-proctoring-design.md

-- 1. Add 'exam' to app_xp_source enum (reuses XP Ledger)
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'exam';

-- 2. exam_sessions
CREATE TABLE public.exam_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id        uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  host_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title               text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','active','closed')),
  join_code           char(6) NOT NULL UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(4),'hex'),1,6)),
  starts_at           timestamptz,
  ends_at             timestamptz,
  duration_minutes    int  NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 300),
  violation_threshold int  NOT NULL DEFAULT 5 CHECK (violation_threshold BETWEEN 1 AND 20),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_sessions_classroom ON public.exam_sessions (classroom_id, status);

-- 3. exam_questions
CREATE TABLE public.exam_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  idx             int  NOT NULL,
  question_type   text NOT NULL CHECK (question_type IN ('multiple_choice','short_answer')),
  question        text NOT NULL,
  options         jsonb,
  correct_idx     int,
  expected_answer text,
  points          int  NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idx)
);
CREATE INDEX idx_exam_questions_session ON public.exam_questions (session_id, idx);

-- 4. exam_participants
CREATE TABLE public.exam_participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at        timestamptz,
  submitted_at      timestamptz,
  total_score       int,
  violation_count   int  NOT NULL DEFAULT 0,
  auto_submitted    boolean NOT NULL DEFAULT false,
  auto_submit_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_exam_participants_session ON public.exam_participants (session_id);
CREATE INDEX idx_exam_participants_user ON public.exam_participants (user_id);

-- 5. exam_answers
CREATE TABLE public.exam_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL,
  user_id         uuid NOT NULL,
  answer_idx      int,
  answer_text     text,
  is_correct      boolean,
  score_awarded   int,
  graded_by       text CHECK (graded_by IN ('server','ai','teacher') OR graded_by IS NULL),
  graded_at       timestamptz,
  answered_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);
CREATE INDEX idx_exam_answers_session_user ON public.exam_answers (session_id, user_id);

-- 6. exam_proctoring_events (append-only)
CREATE TABLE public.exam_proctoring_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  event_type    text NOT NULL CHECK (event_type IN
                  ('tab_blur','window_blur','fullscreen_exit','copy_attempt','paste_attempt')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_proctoring_session_user
  ON public.exam_proctoring_events (session_id, user_id, created_at DESC);

-- 7. exam_questions_safe view (hide correct_idx + expected_answer unless host/admin/closed)
CREATE OR REPLACE VIEW public.exam_questions_safe
WITH (security_invoker = on) AS
SELECT q.id, q.session_id, q.idx, q.question_type, q.question, q.options,
       q.points, q.created_at,
  CASE
    WHEN s.host_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR s.status = 'closed'
    THEN q.correct_idx ELSE NULL
  END AS correct_idx,
  CASE
    WHEN s.host_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR s.status = 'closed'
    THEN q.expected_answer ELSE NULL
  END AS expected_answer
FROM public.exam_questions q
JOIN public.exam_sessions s ON s.id = q.session_id;

-- 8. RLS policies
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_sessions read classroom" ON public.exam_sessions FOR SELECT TO authenticated
  USING (public.is_classroom_member(classroom_id, auth.uid())
         OR host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "exam_sessions host write" ON public.exam_sessions FOR ALL TO authenticated
  USING (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_questions host only" ON public.exam_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "exam_questions host insert" ON public.exam_questions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "exam_questions host update" ON public.exam_questions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "exam_questions host delete" ON public.exam_questions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

ALTER TABLE public.exam_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_participants read own or host" ON public.exam_participants FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_answers read own or host" ON public.exam_answers FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

ALTER TABLE public.exam_proctoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_proctoring host read" ON public.exam_proctoring_events FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- 9. Realtime hardening: prevent peer answer/violation leaks
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.exam_answers;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.exam_proctoring_events;

-- 10. Grants (writes go through SECURITY DEFINER RPCs)
GRANT SELECT ON public.exam_sessions, public.exam_questions_safe,
                public.exam_participants, public.exam_answers,
                public.exam_proctoring_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_questions TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
