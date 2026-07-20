-- Allow students who are members of the exam's classroom to read questions
-- when exam is active (to take it) or closed (to review). Host policy already exists.
CREATE POLICY "Members read questions during active/closed"
ON public.exam_questions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.exam_sessions s
    JOIN public.classroom_members cm ON cm.classroom_id = s.classroom_id
    WHERE s.id = exam_questions.session_id
      AND cm.user_id = auth.uid()
      AND s.status IN ('active','closed')
  )
);

-- Ensure the safe view is reachable by clients
GRANT SELECT ON public.exam_questions_safe TO authenticated;