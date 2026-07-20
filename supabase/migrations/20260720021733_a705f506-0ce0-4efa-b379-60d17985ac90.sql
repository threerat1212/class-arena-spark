CREATE OR REPLACE FUNCTION public.get_exam_questions_for_edit(_exam_id uuid)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  idx int,
  question_type public.exam_question_type,
  question text,
  options jsonb,
  correct_idx int,
  expected_answer text,
  points numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.exam_sessions s
    WHERE s.id = _exam_id
      AND (s.host_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้ไขข้อสอบนี้';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.session_id,
    q.idx,
    q.question_type,
    q.question,
    q.options,
    q.correct_idx,
    q.expected_answer,
    q.points,
    q.created_at
  FROM public.exam_questions q
  WHERE q.session_id = _exam_id
  ORDER BY q.idx ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_exam_questions_for_edit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_questions_for_edit(uuid) TO authenticated;

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
  CASE
    WHEN s.host_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR s.status = 'closed'
    THEN q.correct_idx
    ELSE NULL
  END AS correct_idx,
  CASE
    WHEN s.host_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR s.status = 'closed'
    THEN q.expected_answer
    ELSE NULL
  END AS expected_answer,
  q.points,
  q.created_at
FROM public.exam_questions q
JOIN public.exam_sessions s ON s.id = q.session_id;

GRANT SELECT ON public.exam_questions_safe TO authenticated;