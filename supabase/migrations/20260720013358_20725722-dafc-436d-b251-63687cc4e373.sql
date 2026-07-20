CREATE TABLE public.exam_canva_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  url text NOT NULL,
  label text,
  assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exam_canva_links_exam_idx ON public.exam_canva_links(exam_id);
CREATE UNIQUE INDEX exam_canva_links_unique_user_per_exam
  ON public.exam_canva_links(exam_id, assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_canva_links TO authenticated;
GRANT ALL ON public.exam_canva_links TO service_role;

ALTER TABLE public.exam_canva_links ENABLE ROW LEVEL SECURITY;

-- Host (ครูเจ้าของข้อสอบ) จัดการได้ทุกอย่าง
CREATE POLICY "Host manages canva links"
ON public.exam_canva_links
FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.exam_sessions e WHERE e.id = exam_id AND e.host_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.exam_sessions e WHERE e.id = exam_id AND e.host_id = auth.uid())
);

-- นักเรียนอ่านลิงก์ของตัวเองเท่านั้น
CREATE POLICY "Student reads own assigned link"
ON public.exam_canva_links
FOR SELECT
TO authenticated
USING (assigned_to_user_id = auth.uid());

-- RPC: จ่ายลิงก์ให้ผู้ใช้ปัจจุบัน (คืนลิงก์เดิมถ้าเคยได้แล้ว, ไม่งั้นสุ่มลิงก์ว่างมา 1 อัน)
CREATE OR REPLACE FUNCTION public.assign_exam_canva_link(_exam_id uuid)
RETURNS public.exam_canva_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.exam_canva_links;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- ต้องเป็นผู้เข้าสอบของข้อสอบนี้
  IF NOT EXISTS (
    SELECT 1 FROM public.exam_participants
    WHERE exam_id = _exam_id AND user_id = _uid
  ) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  -- ถ้ามีลิงก์ที่ได้แล้ว คืนอันเดิม
  SELECT * INTO _row FROM public.exam_canva_links
  WHERE exam_id = _exam_id AND assigned_to_user_id = _uid
  LIMIT 1;

  IF FOUND THEN
    RETURN _row;
  END IF;

  -- claim ลิงก์ว่างแบบ atomic
  UPDATE public.exam_canva_links
  SET assigned_to_user_id = _uid, assigned_at = now()
  WHERE id = (
    SELECT id FROM public.exam_canva_links
    WHERE exam_id = _exam_id AND assigned_to_user_id IS NULL
    ORDER BY random()
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_link_available';
  END IF;

  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_exam_canva_link(uuid) TO authenticated;