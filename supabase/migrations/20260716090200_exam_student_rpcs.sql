-- Exam Student + Proctoring RPCs (SECURITY DEFINER)
-- Spec: docs/superpowers/specs/2026-07-16-exam-proctoring-design.md

-- 1. join_exam_by_code
CREATE OR REPLACE FUNCTION public.join_exam_by_code(_code text)
RETURNS TABLE(exam_id uuid, title text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _s RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE join_code = upper(trim(_code));
  IF _s.id IS NULL THEN RAISE EXCEPTION 'รหัสไม่ถูกต้อง'; END IF;
  IF NOT public.is_classroom_member(_s.classroom_id, _uid) THEN
    RAISE EXCEPTION 'ไม่ได้อยู่ในห้องเรียนนี้';
  END IF;
  IF _s.status NOT IN ('scheduled','active') THEN
    RAISE EXCEPTION 'ยังไม่เปิดสอบหรือปิดไปแล้ว';
  END IF;
  IF _s.status = 'scheduled' OR (_s.starts_at IS NOT NULL AND now() < _s.starts_at) THEN
    RAISE EXCEPTION 'ยังไม่ถึงเวลาสอบ';
  END IF;
  IF _s.ends_at IS NOT NULL AND now() > _s.ends_at THEN
    RAISE EXCEPTION 'หมดเวลาสอบแล้ว';
  END IF;
  INSERT INTO public.exam_participants (session_id, user_id)
    VALUES (_s.id, _uid) ON CONFLICT (session_id, user_id) DO NOTHING;
  RETURN QUERY SELECT _s.id, _s.title;
END $$;
GRANT EXECUTE ON FUNCTION public.join_exam_by_code(text) TO authenticated;

-- 2. start_exam_attempt (returns context for client UI)
CREATE OR REPLACE FUNCTION public.start_exam_attempt(_exam_id uuid)
RETURNS TABLE(ends_at timestamptz, violation_threshold int, duration_minutes int, started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _s RECORD; _p RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_exam_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF _s.status != 'active' THEN RAISE EXCEPTION 'ยังไม่เปิดสอบ'; END IF;
  IF _s.ends_at IS NOT NULL AND now() > _s.ends_at THEN
    RAISE EXCEPTION 'หมดเวลาสอบแล้ว';
  END IF;
  SELECT * INTO _p FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'ยังไม่ได้เข้าร่วมสอบ'; END IF;
  IF _p.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'ส่งข้อสอบแล้ว'; END IF;
  IF _p.started_at IS NULL THEN
    UPDATE public.exam_participants SET started_at=now() WHERE id=_p.id;
    _p.started_at := now();
  END IF;
  RETURN QUERY SELECT _s.ends_at, _s.violation_threshold, _s.duration_minutes, _p.started_at;
END $$;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;

-- 3. submit_exam_answer (auto-save + auto-grade MCQ)
CREATE OR REPLACE FUNCTION public.submit_exam_answer(
  _question_id uuid, _answer_idx int DEFAULT NULL, _answer_text text DEFAULT NULL
) RETURNS TABLE(is_correct boolean, score_awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _q RECORD; _s RECORD;
  _is_correct boolean; _score int; _graded_by text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _q FROM public.exam_questions WHERE id=_question_id;
  IF _q.id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_q.session_id;
  IF _s.status != 'active' THEN RAISE EXCEPTION 'ยังไม่เปิดสอบหรือปิดไปแล้ว'; END IF;
  IF _s.ends_at IS NOT NULL AND now() > _s.ends_at THEN
    RAISE EXCEPTION 'หมดเวลาแล้ว';
  END IF;
  PERFORM 1 FROM public.exam_participants WHERE session_id=_q.session_id AND user_id=_uid AND submitted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ส่งข้อสอบแล้ว ไม่สามารถแก้ไขได้'; END IF;

  IF _q.question_type = 'multiple_choice' THEN
    _is_correct := (_answer_idx = _q.correct_idx);
    _score := CASE WHEN _is_correct THEN _q.points ELSE 0 END;
    _graded_by := 'server';
  ELSE
    -- short_answer: not graded yet (graded_by=NULL, pending AI)
    _is_correct := NULL; _score := NULL; _graded_by := NULL;
  END IF;

  INSERT INTO public.exam_answers
    (question_id, session_id, user_id, answer_idx, answer_text, is_correct, score_awarded, graded_by, graded_at)
  VALUES (_question_id, _q.session_id, _uid, _answer_idx, _answer_text, _is_correct, _score, _graded_by,
          CASE WHEN _graded_by IS NOT NULL THEN now() ELSE NULL END)
  ON CONFLICT (question_id, user_id) DO UPDATE SET
    answer_idx = EXCLUDED.answer_idx,
    answer_text = EXCLUDED.answer_text,
    is_correct = EXCLUDED.is_correct,
    score_awarded = EXCLUDED.score_awarded,
    graded_by = EXCLUDED.graded_by,
    graded_at = EXCLUDED.graded_at,
    answered_at = now();

  RETURN QUERY SELECT _is_correct, _score;
END $$;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer(uuid,int,text) TO authenticated;

-- 4. record_exam_violation (increment + auto-submit on threshold)
CREATE OR REPLACE FUNCTION public.record_exam_violation(
  _exam_id uuid, _event_type text, _payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(violation_count int, auto_submitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _threshold int; _new_count int; _auto boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  -- advisory lock to dedupe simultaneous events
  PERFORM pg_advisory_xact_lock(hashtext('exam_violation:' || _exam_id::text || ':' || _uid::text));

  SELECT violation_threshold INTO _threshold FROM public.exam_sessions WHERE id=_exam_id;
  IF _threshold IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;

  -- skip if already submitted
  PERFORM 1 FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_uid AND submitted_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, false; RETURN;
  END IF;

  INSERT INTO public.exam_proctoring_events (session_id, user_id, event_type, payload)
    VALUES (_exam_id, _uid, _event_type, _payload);

  UPDATE public.exam_participants
    SET violation_count = violation_count + 1
    WHERE session_id=_exam_id AND user_id=_uid
    RETURNING violation_count INTO _new_count;

  IF _new_count >= _threshold THEN
    PERFORM public.auto_submit_exam(_exam_id, _uid, 'violation_threshold');
    _auto := true;
  END IF;

  RETURN QUERY SELECT _new_count, _auto;
END $$;
GRANT EXECUTE ON FUNCTION public.record_exam_violation(uuid,text,jsonb) TO authenticated;

-- 5. submit_exam (manual submit + award XP via award_xp)
CREATE OR REPLACE FUNCTION public.submit_exam(_exam_id uuid)
RETURNS TABLE(total_score int, xp_awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s RECORD; _p RECORD;
  _max_score int; _title text; _classroom_id uuid; _classroom_name text;
  _award RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_exam_id;
  SELECT * INTO _p FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'ยังไม่ได้เข้าร่วมสอบ'; END IF;
  IF _p.submitted_at IS NOT NULL THEN
    -- already submitted — idempotent return
    RETURN QUERY SELECT COALESCE(_p.total_score,0), 0; RETURN;
  END IF;

  -- compute total_score (only graded answers count; ungraded short_answer = 0 for now)
  SELECT COALESCE(SUM(a.score_awarded),0) INTO _p.total_score
    FROM public.exam_answers a WHERE a.session_id=_exam_id AND a.user_id=_uid;
  SELECT COALESCE(SUM(q.points),0) INTO _max_score
    FROM public.exam_questions q WHERE q.session_id=_exam_id;

  UPDATE public.exam_participants
    SET submitted_at=now(), total_score=_p.total_score, auto_submitted=false
    WHERE id=_p.id;

  -- award XP via central ledger
  SELECT name INTO _classroom_name FROM public.classrooms WHERE id=_s.classroom_id;
  SELECT * INTO _award FROM public.award_xp(
    _user_id := _uid,
    _amount := COALESCE(_p.total_score,0),
    _source := 'exam'::public.app_xp_source,
    _source_label := 'สอบ: ' || _s.title,
    _subject := _classroom_name,
    _ref_table := 'exam_participants',
    _ref_id := _p.id,
    _classroom_id := _s.classroom_id,
    _metadata := jsonb_build_object(
      'exam_id', _exam_id, 'max_score', _max_score,
      'violation_count', _p.violation_count
    ),
    _idempotency_key := 'exam_submit:' || _exam_id::text || ':' || _uid::text
  );

  RETURN QUERY SELECT COALESCE(_p.total_score,0), COALESCE(_award.transaction_id IS NOT NULL, false)::int * COALESCE(_p.total_score,0);
END $$;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid) TO authenticated;

-- 6. auto_submit_exam (internal — called by record_exam_violation / close_exam)
CREATE OR REPLACE FUNCTION public.auto_submit_exam(_exam_id uuid, _user_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s RECORD; _p RECORD; _total int; _max int; _title text; _classroom_id uuid; _classroom_name text;
BEGIN
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_exam_id;
  SELECT * INTO _p FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_user_id;
  IF _p.id IS NULL OR _p.submitted_at IS NOT NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(a.score_awarded),0) INTO _total
    FROM public.exam_answers a WHERE a.session_id=_exam_id AND a.user_id=_user_id;
  SELECT COALESCE(SUM(q.points),0) INTO _max
    FROM public.exam_questions q WHERE q.session_id=_exam_id;

  UPDATE public.exam_participants
    SET submitted_at=now(), total_score=_total, auto_submitted=true, auto_submit_reason=_reason
    WHERE id=_p.id;

  SELECT name INTO _classroom_name FROM public.classrooms WHERE id=_s.classroom_id;
  PERFORM public.award_xp(
    _user_id := _user_id,
    _amount := _total,
    _source := 'exam'::public.app_xp_source,
    _source_label := 'สอบ (ส่งอัตโนมัติ): ' || _s.title,
    _subject := _classroom_name,
    _ref_table := 'exam_participants',
    _ref_id := _p.id,
    _classroom_id := _s.classroom_id,
    _metadata := jsonb_build_object(
      'exam_id', _exam_id, 'max_score', _max,
      'violation_count', _p.violation_count, 'auto_submitted', true, 'reason', _reason
    ),
    _idempotency_key := 'exam_submit:' || _exam_id::text || ':' || _user_id::text
  );
END $$;
-- Note: auto_submit_exam is internal; grant only to authenticated (called by other SECURITY DEFINER fns)
GRANT EXECUTE ON FUNCTION public.auto_submit_exam(uuid,uuid,text) TO authenticated;
