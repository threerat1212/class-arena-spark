-- Exam Teacher RPCs (SECURITY DEFINER)
-- Spec: docs/superpowers/specs/2026-07-16-exam-proctoring-design.md

-- 1. create_exam
CREATE OR REPLACE FUNCTION public.create_exam(
  _classroom_id uuid, _title text,
  _duration_minutes int DEFAULT 60, _violation_threshold int DEFAULT 5
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _host uuid := auth.uid();
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  IF NOT public.is_classroom_owner(_classroom_id, _host) AND NOT public.has_role(_host, 'admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์สร้างข้อสอบในห้องนี้';
  END IF;
  INSERT INTO public.exam_sessions (classroom_id, host_id, title, duration_minutes, violation_threshold)
  VALUES (_classroom_id, _host, _title, _duration_minutes, _violation_threshold)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_exam(uuid,text,int,int) TO authenticated;

-- 2. update_exam_questions (bulk upsert, draft only)
CREATE OR REPLACE FUNCTION public.update_exam_questions(_exam_id uuid, _questions jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text; q jsonb; _idx int;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF _status != 'draft' THEN RAISE EXCEPTION 'แก้ข้อสอบได้เฉพาะตอน draft'; END IF;
  PERFORM 1 FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF NOT FOUND AND NOT public.has_role(_host,'admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์';
  END IF;
  DELETE FROM public.exam_questions WHERE session_id=_exam_id;
  FOR q IN SELECT * FROM jsonb_array_elements(_questions) LOOP
    _idx := (q->>'idx')::int;
    INSERT INTO public.exam_questions (session_id, idx, question_type, question, options, correct_idx, expected_answer, points)
    VALUES (
      _exam_id, _idx,
      q->>'question_type', q->>'question',
      q->'options', (q->>'correct_idx')::int, q->>'expected_answer',
      COALESCE((q->>'points')::int, 1)
    );
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.update_exam_questions(uuid,jsonb) TO authenticated;

-- 3. publish_exam (draft → scheduled)
CREATE OR REPLACE FUNCTION public.publish_exam(
  _exam_id uuid, _starts_at timestamptz, _ends_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  IF _starts_at >= _ends_at THEN RAISE EXCEPTION 'เวลาเริ่มต้องก่อนเวลาหมด'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบหรือไม่มีสิทธิ์'; END IF;
  IF _status != 'draft' THEN RAISE EXCEPTION 'ต้องเป็น draft เท่านั้น'; END IF;
  UPDATE public.exam_sessions SET status='scheduled', starts_at=_starts_at, ends_at=_ends_at
    WHERE id=_exam_id;
END $$;
GRANT EXECUTE ON FUNCTION public.publish_exam(uuid,timestamptz,timestamptz) TO authenticated;

-- 4. open_exam (scheduled → active)
CREATE OR REPLACE FUNCTION public.open_exam(_exam_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบหรือไม่มีสิทธิ์'; END IF;
  IF _status != 'scheduled' THEN RAISE EXCEPTION 'ต้องเป็น scheduled เท่านั้น'; END IF;
  UPDATE public.exam_sessions SET status='active' WHERE id=_exam_id;
END $$;
GRANT EXECUTE ON FUNCTION public.open_exam(uuid) TO authenticated;

-- 5. grade_short_answer (called by AI edge function or teacher)
CREATE OR REPLACE FUNCTION public.grade_short_answer(
  _question_id uuid, _user_id uuid, _is_correct boolean, _score int, _graded_by text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _session_id uuid; _host uuid := auth.uid();
BEGIN
  -- Edge function calls this with service_role (auth.uid() is null but service_role bypasses RLS)
  -- For teacher calls, enforce host check
  SELECT session_id INTO _session_id FROM public.exam_questions WHERE id=_question_id;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF _host IS NOT NULL AND _graded_by='teacher' THEN
    PERFORM 1 FROM public.exam_sessions s WHERE s.id=_session_id
      AND (s.host_id=_host OR public.has_role(_host,'admin'));
    IF NOT FOUND THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ตรวจ'; END IF;
  END IF;
  UPDATE public.exam_answers
    SET is_correct=_is_correct, score_awarded=_score, graded_by=_graded_by, graded_at=now()
    WHERE question_id=_question_id AND user_id=_user_id;
  -- recompute participant total_score
  UPDATE public.exam_participants p SET total_score = (
    SELECT COALESCE(SUM(a.score_awarded), 0) FROM public.exam_answers a
      JOIN public.exam_questions q ON q.id=a.question_id
      WHERE a.session_id=p.session_id AND a.user_id=p.user_id
  ) WHERE p.session_id=_session_id AND p.user_id=_user_id;
END $$;
GRANT EXECUTE ON FUNCTION public.grade_short_answer(uuid,uuid,boolean,int,text) TO authenticated;

-- 6. close_exam (active → closed + force-submit unsubmitted + return summary)
CREATE OR REPLACE FUNCTION public.close_exam(_exam_id uuid)
RETURNS TABLE(user_id uuid, auto_submitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text; _p RECORD;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบหรือไม่มีสิทธิ์'; END IF;
  IF _status != 'active' THEN RAISE EXCEPTION 'ต้องเป็น active เท่านั้น'; END IF;
  UPDATE public.exam_sessions SET status='closed' WHERE id=_exam_id;
  -- force-submit unsubmitted participants
  FOR _p IN SELECT * FROM public.exam_participants WHERE session_id=_exam_id AND submitted_at IS NULL LOOP
    PERFORM public.auto_submit_exam(_exam_id, _p.user_id, 'exam_closed');
    RETURN QUERY SELECT _p.user_id, true;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.close_exam(uuid) TO authenticated;
