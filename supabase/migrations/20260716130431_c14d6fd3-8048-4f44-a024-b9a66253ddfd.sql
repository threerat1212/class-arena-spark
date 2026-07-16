
-- ============= Exam system =============

CREATE TYPE public.exam_status AS ENUM ('draft','scheduled','active','closed');
CREATE TYPE public.exam_question_type AS ENUM ('multiple_choice','short_answer');
CREATE TYPE public.exam_violation_type AS ENUM ('visibility_change','blur','fullscreen_exit','copy_paste','dev_tools','other');
CREATE TYPE public.exam_auto_submit_reason AS ENUM ('violation_threshold','time_up');

-- ---- exam_sessions ----
CREATE TABLE public.exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  violation_threshold int NOT NULL DEFAULT 3 CHECK (violation_threshold >= 0),
  join_code text NOT NULL UNIQUE,
  status public.exam_status NOT NULL DEFAULT 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_sessions_classroom ON public.exam_sessions(classroom_id);
CREATE INDEX idx_exam_sessions_host ON public.exam_sessions(host_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_sessions TO authenticated;
GRANT ALL ON public.exam_sessions TO service_role;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;

-- Host / admin full manage
CREATE POLICY "Host manages own exams" ON public.exam_sessions
  FOR ALL TO authenticated
  USING (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Members of the classroom can see non-draft exams
CREATE POLICY "Members see published exams" ON public.exam_sessions
  FOR SELECT TO authenticated
  USING (
    status <> 'draft' AND EXISTS (
      SELECT 1 FROM public.classroom_members cm
      WHERE cm.classroom_id = exam_sessions.classroom_id AND cm.user_id = auth.uid()
    )
  );

-- ---- exam_questions ----
CREATE TABLE public.exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  idx int NOT NULL,
  question_type public.exam_question_type NOT NULL,
  question text NOT NULL,
  options jsonb,
  correct_idx int,
  expected_answer text,
  points numeric(6,2) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idx)
);
CREATE INDEX idx_exam_questions_session ON public.exam_questions(session_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_questions TO authenticated;
GRANT ALL ON public.exam_questions TO service_role;
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Host manages exam questions" ON public.exam_questions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s
                 WHERE s.id = exam_questions.session_id
                   AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.exam_sessions s
                      WHERE s.id = exam_questions.session_id
                        AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- ---- exam_participants ----
CREATE TABLE public.exam_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz,
  submitted_at timestamptz,
  total_score numeric(8,2),
  violation_count int NOT NULL DEFAULT 0,
  auto_submitted boolean NOT NULL DEFAULT false,
  auto_submit_reason public.exam_auto_submit_reason,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_exam_participants_session ON public.exam_participants(session_id);
CREATE INDEX idx_exam_participants_user ON public.exam_participants(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_participants TO authenticated;
GRANT ALL ON public.exam_participants TO service_role;
ALTER TABLE public.exam_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Self read participant" ON public.exam_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s
                    WHERE s.id = exam_participants.session_id
                      AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

CREATE POLICY "Self insert participant" ON public.exam_participants
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Host/self update participant" ON public.exam_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s
                    WHERE s.id = exam_participants.session_id
                      AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))))
  WITH CHECK (user_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.exam_sessions s
                         WHERE s.id = exam_participants.session_id
                           AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- ---- exam_answers ----
CREATE TABLE public.exam_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.exam_participants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  answer_idx int,
  answer_text text,
  is_correct boolean,
  score_awarded numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, question_id)
);
CREATE INDEX idx_exam_answers_session ON public.exam_answers(session_id);
CREATE INDEX idx_exam_answers_participant ON public.exam_answers(participant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_answers TO authenticated;
GRANT ALL ON public.exam_answers TO service_role;
ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Self / host read answers" ON public.exam_answers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s
                    WHERE s.id = exam_answers.session_id
                      AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- Answers are only written via SECURITY DEFINER RPC; block direct writes
CREATE POLICY "Block direct answer writes" ON public.exam_answers
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ---- exam_proctoring_events ----
CREATE TABLE public.exam_proctoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.exam_participants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type public.exam_violation_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_events_session ON public.exam_proctoring_events(session_id);
GRANT SELECT, INSERT ON public.exam_proctoring_events TO authenticated;
GRANT ALL ON public.exam_proctoring_events TO service_role;
ALTER TABLE public.exam_proctoring_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Self / host read events" ON public.exam_proctoring_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s
                    WHERE s.id = exam_proctoring_events.session_id
                      AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- ---- exam_questions_safe view (mask answers until closed) ----
CREATE OR REPLACE VIEW public.exam_questions_safe
WITH (security_invoker = true)
AS
SELECT
  q.id,
  q.session_id,
  q.idx,
  q.question_type,
  q.question,
  q.options,
  CASE WHEN s.status = 'closed' THEN q.correct_idx ELSE NULL END AS correct_idx,
  CASE WHEN s.status = 'closed' THEN q.expected_answer ELSE NULL END AS expected_answer,
  q.points,
  q.created_at
FROM public.exam_questions q
JOIN public.exam_sessions s ON s.id = q.session_id;
GRANT SELECT ON public.exam_questions_safe TO authenticated;

-- ---- updated_at trigger ----
CREATE TRIGGER exam_sessions_updated_at
BEFORE UPDATE ON public.exam_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= RPCs =============

CREATE OR REPLACE FUNCTION public._gen_exam_code() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  code text;
BEGIN
  LOOP
    code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.exam_sessions WHERE join_code = code);
  END LOOP;
  RETURN code;
END; $$ SET search_path = public;

-- create_exam
CREATE OR REPLACE FUNCTION public.create_exam(
  _classroom_id uuid, _title text, _duration_minutes int, _violation_threshold int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
  is_owner boolean;
BEGIN
  SELECT (owner_id = auth.uid()) INTO is_owner FROM public.classrooms WHERE id = _classroom_id;
  IF NOT COALESCE(is_owner,false) AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์สร้างข้อสอบในห้องนี้';
  END IF;
  INSERT INTO public.exam_sessions(classroom_id, host_id, title, duration_minutes, violation_threshold, join_code)
  VALUES (_classroom_id, auth.uid(), _title, _duration_minutes, _violation_threshold, public._gen_exam_code())
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_exam(uuid,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam(uuid,text,int,int) TO authenticated;

-- update_exam_questions
CREATE OR REPLACE FUNCTION public.update_exam_questions(_exam_id uuid, _questions jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_host boolean;
  q jsonb;
BEGIN
  SELECT (host_id = auth.uid() OR public.has_role(auth.uid(),'admin')) INTO is_host
  FROM public.exam_sessions WHERE id = _exam_id;
  IF NOT COALESCE(is_host,false) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;

  DELETE FROM public.exam_questions WHERE session_id = _exam_id;
  FOR q IN SELECT * FROM jsonb_array_elements(_questions) LOOP
    INSERT INTO public.exam_questions(session_id, idx, question_type, question, options, correct_idx, expected_answer, points)
    VALUES (
      _exam_id,
      (q->>'idx')::int,
      (q->>'question_type')::public.exam_question_type,
      q->>'question',
      NULLIF(q->'options','null'::jsonb),
      NULLIF(q->>'correct_idx','')::int,
      NULLIF(q->>'expected_answer',''),
      COALESCE(NULLIF(q->>'points','')::numeric, 1)
    );
  END LOOP;
END; $$;
REVOKE EXECUTE ON FUNCTION public.update_exam_questions(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_exam_questions(uuid,jsonb) TO authenticated;

-- publish_exam
CREATE OR REPLACE FUNCTION public.publish_exam(_exam_id uuid, _starts_at timestamptz, _ends_at timestamptz)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.exam_sessions
  SET status='scheduled', starts_at=_starts_at, ends_at=_ends_at
  WHERE id=_exam_id AND (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.publish_exam(uuid,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_exam(uuid,timestamptz,timestamptz) TO authenticated;

-- open_exam
CREATE OR REPLACE FUNCTION public.open_exam(_exam_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.exam_sessions
  SET status='active',
      starts_at = COALESCE(starts_at, now()),
      ends_at = COALESCE(ends_at, now() + (duration_minutes || ' minutes')::interval)
  WHERE id=_exam_id AND (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.open_exam(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_exam(uuid) TO authenticated;

-- close_exam: force-submit all pending participants
CREATE OR REPLACE FUNCTION public.close_exam(_exam_id uuid)
RETURNS TABLE(user_id uuid, auto_submitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.exam_sessions
                 WHERE id=_exam_id AND (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์';
  END IF;

  UPDATE public.exam_sessions SET status='closed', ends_at = COALESCE(ends_at, now()) WHERE id=_exam_id;

  RETURN QUERY
  UPDATE public.exam_participants p
  SET submitted_at = now(),
      auto_submitted = true,
      auto_submit_reason = 'time_up',
      total_score = COALESCE(p.total_score,
        (SELECT COALESCE(SUM(a.score_awarded),0)
         FROM public.exam_answers a WHERE a.participant_id = p.id))
  WHERE p.session_id = _exam_id
    AND p.started_at IS NOT NULL
    AND p.submitted_at IS NULL
  RETURNING p.user_id, p.auto_submitted;
END; $$;
REVOKE EXECUTE ON FUNCTION public.close_exam(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_exam(uuid) TO authenticated;

-- join_exam_by_code
CREATE OR REPLACE FUNCTION public.join_exam_by_code(_code text)
RETURNS TABLE(exam_id uuid, title text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.exam_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.exam_sessions WHERE join_code = upper(_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF s.status = 'draft' THEN RAISE EXCEPTION 'ข้อสอบยังไม่เปิด'; END IF;
  IF s.status = 'closed' THEN RAISE EXCEPTION 'ข้อสอบปิดแล้ว'; END IF;

  -- auto-enroll into classroom if not member
  INSERT INTO public.classroom_members(classroom_id, user_id, role)
  VALUES (s.classroom_id, auth.uid(), 'student')
  ON CONFLICT DO NOTHING;

  -- create participant row if new
  INSERT INTO public.exam_participants(session_id, user_id)
  VALUES (s.id, auth.uid())
  ON CONFLICT DO NOTHING;

  exam_id := s.id;
  title := s.title;
  RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.join_exam_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_exam_by_code(text) TO authenticated;

-- start_exam_attempt
CREATE OR REPLACE FUNCTION public.start_exam_attempt(_exam_id uuid)
RETURNS TABLE(ends_at timestamptz, violation_threshold int, duration_minutes int, started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.exam_sessions%ROWTYPE;
  p_started timestamptz;
BEGIN
  SELECT * INTO s FROM public.exam_sessions WHERE id = _exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'ยังไม่เปิดสอบ'; END IF;

  INSERT INTO public.exam_participants(session_id, user_id, started_at)
  VALUES (s.id, auth.uid(), now())
  ON CONFLICT (session_id, user_id) DO UPDATE
  SET started_at = COALESCE(public.exam_participants.started_at, EXCLUDED.started_at)
  RETURNING public.exam_participants.started_at INTO p_started;

  ends_at := s.ends_at;
  violation_threshold := s.violation_threshold;
  duration_minutes := s.duration_minutes;
  started_at := p_started;
  RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.start_exam_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;

-- submit_exam_answer
CREATE OR REPLACE FUNCTION public.submit_exam_answer(
  _question_id uuid, _answer_idx int, _answer_text text
) RETURNS TABLE(is_correct boolean, score_awarded numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.exam_questions%ROWTYPE;
  s public.exam_sessions%ROWTYPE;
  p public.exam_participants%ROWTYPE;
  v_correct boolean;
  v_score numeric(6,2);
BEGIN
  SELECT * INTO q FROM public.exam_questions WHERE id = _question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบข้อ'; END IF;
  SELECT * INTO s FROM public.exam_sessions WHERE id = q.session_id;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'ข้อสอบไม่พร้อม'; END IF;

  SELECT * INTO p FROM public.exam_participants
    WHERE session_id = s.id AND user_id = auth.uid();
  IF NOT FOUND OR p.started_at IS NULL THEN RAISE EXCEPTION 'ยังไม่ได้เริ่มสอบ'; END IF;
  IF p.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'ส่งข้อสอบไปแล้ว'; END IF;

  IF q.question_type = 'multiple_choice' THEN
    v_correct := (_answer_idx IS NOT NULL AND q.correct_idx IS NOT NULL AND _answer_idx = q.correct_idx);
    v_score := CASE WHEN v_correct THEN q.points ELSE 0 END;
  ELSE
    v_correct := NULL;
    v_score := NULL; -- graded later
  END IF;

  INSERT INTO public.exam_answers(session_id, participant_id, user_id, question_id, answer_idx, answer_text, is_correct, score_awarded)
  VALUES (s.id, p.id, auth.uid(), q.id, _answer_idx, _answer_text, v_correct, v_score)
  ON CONFLICT (participant_id, question_id) DO UPDATE
  SET answer_idx = EXCLUDED.answer_idx,
      answer_text = EXCLUDED.answer_text,
      is_correct = EXCLUDED.is_correct,
      score_awarded = EXCLUDED.score_awarded;

  is_correct := v_correct;
  score_awarded := v_score;
  RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_exam_answer(uuid,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer(uuid,int,text) TO authenticated;

-- record_exam_violation
CREATE OR REPLACE FUNCTION public.record_exam_violation(
  _exam_id uuid, _event_type public.exam_violation_type, _payload jsonb
) RETURNS TABLE(violation_count int, auto_submitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.exam_participants%ROWTYPE;
  s public.exam_sessions%ROWTYPE;
  new_count int;
  should_auto boolean := false;
BEGIN
  SELECT * INTO s FROM public.exam_sessions WHERE id = _exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  SELECT * INTO p FROM public.exam_participants
    WHERE session_id = _exam_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'ยังไม่ได้เข้าสอบ'; END IF;

  INSERT INTO public.exam_proctoring_events(session_id, participant_id, user_id, event_type, payload)
  VALUES (_exam_id, p.id, auth.uid(), _event_type, COALESCE(_payload,'{}'::jsonb));

  UPDATE public.exam_participants
  SET violation_count = violation_count + 1
  WHERE id = p.id
  RETURNING public.exam_participants.violation_count INTO new_count;

  IF new_count >= s.violation_threshold AND p.submitted_at IS NULL THEN
    UPDATE public.exam_participants
    SET submitted_at = now(),
        auto_submitted = true,
        auto_submit_reason = 'violation_threshold',
        total_score = COALESCE(total_score,
          (SELECT COALESCE(SUM(a.score_awarded),0) FROM public.exam_answers a WHERE a.participant_id = p.id))
    WHERE id = p.id;
    should_auto := true;
  END IF;

  violation_count := new_count;
  auto_submitted := should_auto;
  RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_exam_violation(uuid,public.exam_violation_type,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_exam_violation(uuid,public.exam_violation_type,jsonb) TO authenticated;

-- submit_exam
CREATE OR REPLACE FUNCTION public.submit_exam(_exam_id uuid)
RETURNS TABLE(total_score numeric, xp_awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.exam_participants%ROWTYPE;
  v_score numeric(8,2);
BEGIN
  SELECT * INTO p FROM public.exam_participants
    WHERE session_id = _exam_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'ยังไม่ได้เข้าสอบ'; END IF;
  IF p.submitted_at IS NOT NULL THEN
    total_score := p.total_score;
    xp_awarded := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(a.score_awarded),0) INTO v_score
  FROM public.exam_answers a WHERE a.participant_id = p.id;

  UPDATE public.exam_participants
  SET submitted_at = now(), total_score = v_score
  WHERE id = p.id;

  total_score := v_score;
  xp_awarded := 0;
  RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_exam(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid) TO authenticated;
