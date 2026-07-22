CREATE OR REPLACE FUNCTION public.delete_exam(_exam_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _host uuid := auth.uid();
BEGIN
  IF _host IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exam_sessions
    WHERE id = _exam_id AND host_id = _host
  ) THEN
    RAISE EXCEPTION 'not host or exam not found';
  END IF;
  DELETE FROM public.exam_sessions WHERE id = _exam_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_exam(uuid) TO authenticated;