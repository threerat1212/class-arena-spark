CREATE OR REPLACE FUNCTION public.record_exam_violation(
  _exam_id uuid, _event_type text, _payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(violation_count int, auto_submitted boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.record_exam_violation(_exam_id, _event_type::public.exam_violation_type, _payload);
$$;
REVOKE EXECUTE ON FUNCTION public.record_exam_violation(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_exam_violation(uuid,text,jsonb) TO authenticated;