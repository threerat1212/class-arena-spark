
CREATE OR REPLACE VIEW public.exam_questions_safe
WITH (security_invoker = false) AS
SELECT
  q.id,
  q.session_id,
  q.idx,
  q.question_type,
  q.question,
  q.options,
  CASE WHEN s.host_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR s.status = 'closed'::exam_status
       THEN q.correct_idx ELSE NULL::integer END AS correct_idx,
  CASE WHEN s.host_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR s.status = 'closed'::exam_status
       THEN q.expected_answer ELSE NULL::text END AS expected_answer,
  q.points,
  q.created_at
FROM public.exam_questions q
JOIN public.exam_sessions s ON s.id = q.session_id
WHERE
  s.host_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    s.status IN ('active'::exam_status, 'closed'::exam_status)
    AND EXISTS (
      SELECT 1 FROM public.classroom_members cm
      WHERE cm.classroom_id = s.classroom_id AND cm.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.exam_questions_safe TO authenticated;
