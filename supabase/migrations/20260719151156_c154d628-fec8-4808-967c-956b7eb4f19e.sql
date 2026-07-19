ALTER TABLE public.exam_answers
  ADD COLUMN IF NOT EXISTS graded_by text
    CHECK (graded_by IN ('server','ai','teacher') OR graded_by IS NULL);
ALTER TABLE public.exam_answers
  ADD COLUMN IF NOT EXISTS graded_at timestamptz;

CREATE OR REPLACE FUNCTION public.grade_short_answer(
  _question_id uuid, _user_id uuid, _is_correct boolean, _score numeric, _graded_by text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _session_id uuid;
  _host uuid := auth.uid();
  _existing_graded_by text;
BEGIN
  SELECT session_id, graded_by INTO _session_id, _existing_graded_by
  FROM public.exam_answers
  WHERE question_id=_question_id AND user_id=_user_id;

  IF _session_id IS NULL THEN RAISE EXCEPTION 'ไม่พบคำตอบ'; END IF;

  IF _graded_by IS DISTINCT FROM 'teacher' AND _existing_graded_by = 'teacher' THEN
    RETURN;
  END IF;

  IF _host IS NOT NULL AND _graded_by='teacher' THEN
    PERFORM 1 FROM public.exam_sessions s WHERE s.id=_session_id
      AND (s.host_id=_host OR public.has_role(_host,'admin'));
    IF NOT FOUND THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ตรวจ'; END IF;
  END IF;

  UPDATE public.exam_answers
    SET is_correct=_is_correct,
        score_awarded=_score,
        graded_by=_graded_by,
        graded_at=now()
    WHERE question_id=_question_id AND user_id=_user_id;

  UPDATE public.exam_participants p SET total_score = (
    SELECT COALESCE(SUM(a.score_awarded), 0) FROM public.exam_answers a
      JOIN public.exam_questions q ON q.id=a.question_id
      WHERE a.session_id=p.session_id AND a.user_id=p.user_id
  ) WHERE p.session_id=_session_id AND p.user_id=_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.grade_short_answer(uuid,uuid,boolean,numeric,text) TO authenticated;