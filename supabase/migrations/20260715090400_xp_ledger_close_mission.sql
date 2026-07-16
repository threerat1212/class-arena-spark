-- RPC ใหม่: ครูปิด mission → ออก XP ทุกคนพร้อมกัน
-- idempotent (กันกดปิดซ้ำ), ตรวจสิทธิ์ครูเจ้าของห้อง
-- Spec: docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md
--
-- NOTE: ลำดับการสร้าง — ต้องรันหลัง award_xp (Task 2: 20260715090100)
-- NOTE: is_classroom_owner(_classroom_id, _user_id) ใช้ 2 args (ไม่ใช่ 1)
-- NOTE: assignments ไม่มี column subject → ส่ง _subject = NULL
-- NOTE: has_role(_user_id, _role) ใช้ 2 args เสมอ (บทเรียนจาก Task 1)

CREATE OR REPLACE FUNCTION public.close_weekly_mission(_mission_id uuid)
RETURNS TABLE(user_id uuid, xp_awarded int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _wm RECORD;
  _mp RECORD;
  _total_xp int;
BEGIN
  SELECT * INTO _wm FROM public.weekly_missions WHERE id = _mission_id;
  IF _wm.id IS NULL THEN
    RAISE EXCEPTION 'mission not found';
  END IF;

  -- สิทธิ์: ครูเจ้าของห้อง หรือ admin
  -- is_classroom_owner ใช้ 2 args: (classroom_id, user_id)
  IF NOT public.is_classroom_owner(_wm.classroom_id, auth.uid())
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปิดภารกิจ';
  END IF;

  -- ต้องอยู่ในสถานะ published (กันปิดซ้ำ — status 'closed' จะติด idempotency ที่ award_xp อยู่แล้ว)
  IF _wm.status != 'published' THEN
    RAISE EXCEPTION 'ภารกิจไม่ได้อยู่ในสถานะที่ปิดได้ (ต้องเป็น published)';
  END IF;

  -- ปิด mission ก่อน (เพื่อให้สถานะเปลี่ยนทันที แม้ award_xp จะติด idempotency อยู่)
  UPDATE public.weekly_missions
    SET status = 'closed', closed_at = now()
    WHERE id = _mission_id;

  -- วนให้ XP ทุกคนที่มี progress และส่งงานแล้ว
  -- เลือกเฉพาะ status ที่แสดงว่ามีส่วนร่วมจริง: submitted / reviewed / completed
  FOR _mp IN
    SELECT * FROM public.mission_progress
      WHERE mission_id = _mission_id
        AND status IN ('submitted', 'reviewed', 'completed')
  LOOP
    _total_xp := COALESCE(_mp.participation_xp_awarded, 0)
               + COALESCE(_mp.quality_xp_awarded, 0)
               + COALESCE(_mp.ai_xp_awarded, 0);

    IF _total_xp > 0 THEN
      -- idempotency_key = per-student (mission_id + user_id) → กดปิดซ้ำไม่ duplicate XP
      PERFORM public.award_xp(
        _user_id         := _mp.user_id,
        _amount          := _total_xp,
        _source          := 'weekly_mission'::public.app_xp_source,
        _source_label    := 'ภารกิจรายสัปดาห์',
        _subject         := NULL,
        _ref_table       := 'mission_progress',
        _ref_id          := _mp.id,
        _classroom_id    := _wm.classroom_id,
        _metadata        := jsonb_build_object(
          'mission_id', _wm.id,
          'participation', _mp.participation_xp_awarded,
          'quality', _mp.quality_xp_awarded,
          'ai', _mp.ai_xp_awarded
        ),
        _idempotency_key := 'mission_close:' || _mission_id::text || ':' || _mp.user_id::text
      );

      RETURN QUERY SELECT _mp.user_id, _total_xp;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_weekly_mission(uuid) TO authenticated;
