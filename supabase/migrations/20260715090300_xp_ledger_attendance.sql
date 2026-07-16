-- Refactor self_check_in ให้มอบ XP จริง (present=+15, late=+5)
-- รองรับ re-grade (late→present หรือ present→late) ผ่าน delta logic
-- Spec: docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md
--
-- Breaking change: return type เพิ่มคอลัมน์ xp_gained int
--   เดิม: TABLE(session_id uuid, status text)
--   ใหม่: TABLE(session_id uuid, status text, xp_gained int)
--
-- XP delta matrix:
--   new=present, old=NULL     -> +15
--   new=present, old=late     -> +10
--   new=present, old=present  ->  0
--   new=late,    old=NULL     ->  +5
--   new=late,    old=present  -> -10
--   new=late,    old=late     ->   0
--
-- ไม่ใส่ _idempotency_key เพราะ re-grade ต้องการ ledger entries หลายตัว
-- (delta ต่างกันแต่ละครั้ง ไม่สามารถ dedupe ด้วย key เดียวกันได้)

CREATE OR REPLACE FUNCTION public.self_check_in(p_code text)
RETURNS TABLE(session_id uuid, status text, xp_gained int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session record;
  v_status attendance_status;
  v_minutes int;
  v_old_status attendance_status;
  v_xp_delta int;
  v_label text;
  v_classroom_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ';
  END IF;

  SELECT * INTO v_session FROM public.attendance_sessions s
    WHERE s.check_in_code = trim(p_code)
      AND s.check_in_expires_at > now()
    LIMIT 1;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'รหัสไม่ถูกต้องหรือหมดอายุ';
  END IF;

  IF NOT public.is_classroom_member(v_session.classroom_id, auth.uid()) THEN
    RAISE EXCEPTION 'คุณไม่ได้อยู่ในห้องเรียนนี้';
  END IF;

  -- Concurrency guard: serialize concurrent check-ins สำหรับ (session, user) เดียวกัน
  -- ป้องกัน double-XP จาก double-click: request ที่ 2 จะรอจน request ที่ 1 commit
  -- แล้ว re-read v_old_status เพื่อเห็นสถานะใหม่ → delta ถูกต้อง (มักเป็น 0)
  PERFORM pg_advisory_xact_lock(
    hashtext('self_check_in:' || v_session.id::text || ':' || auth.uid()::text)
  );

  v_minutes := EXTRACT(EPOCH FROM (now() - v_session.check_in_opens_at)) / 60;
  v_status := CASE WHEN v_minutes > 5 THEN 'late'::attendance_status ELSE 'present'::attendance_status END;

  -- เก็บสถานะเดิมก่อน upsert เพื่อคำนวณ delta ที่ถูกต้อง
  -- (re-read หลัง advisory lock รับประกันว่าเห็น commit ของ request ก่อนหน้า)
  SELECT status INTO v_old_status FROM public.attendance_records
    WHERE session_id = v_session.id AND user_id = auth.uid();

  INSERT INTO public.attendance_records AS ar (session_id, user_id, status)
    VALUES (v_session.id, auth.uid(), v_status)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET status = EXCLUDED.status, marked_at = now();

  -- คำนวณ XP delta (รองรับการ re-grade)
  v_xp_delta := CASE
    WHEN v_status = 'present' AND v_old_status IS DISTINCT FROM 'present'::attendance_status THEN
      CASE WHEN v_old_status = 'late'::attendance_status THEN 10 ELSE 15 END
    WHEN v_status = 'late' AND v_old_status IS DISTINCT FROM 'late'::attendance_status THEN
      CASE WHEN v_old_status = 'present'::attendance_status THEN -10 ELSE 5 END
    ELSE 0
  END;

  IF v_xp_delta != 0 THEN
    v_label := CASE WHEN v_status = 'present' THEN 'มาเรียนตรงเวลา' ELSE 'มาเรียนสาย' END;

    SELECT name INTO v_classroom_name FROM public.classrooms WHERE id = v_session.classroom_id;

    PERFORM public.award_xp(
      _user_id         := auth.uid(),
      _amount          := v_xp_delta,
      _source          := 'attendance'::public.app_xp_source,
      _source_label    := v_label,
      _subject         := v_classroom_name,
      _ref_table       := 'attendance_records',
      _classroom_id    := v_session.classroom_id,
      _metadata        := jsonb_build_object(
        'session_id', v_session.id,
        'status', v_status::text,
        'old_status', v_old_status::text
      )
      -- _idempotency_key intentionally NULL — re-grade ต้องสร้าง delta entries หลายตัว
    );
  END IF;

  RETURN QUERY SELECT v_session.id, v_status::text, v_xp_delta;
END;
$function$;

-- GRANT ไม่ต้องทำซ้ำ: signature (text) เท่าเดิม → privilege คงอยู่
-- (CREATE OR REPLACE เป็นการแทนที่ body เท่านั้น ไม่มีผลต่อ grants)
