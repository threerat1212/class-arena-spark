-- Refactor claim_achievement ให้ XP วิ่งผ่าน award_xp()
-- อ้างอิงฟังก์ชันเดิมจาก 20260528045341_e685579c
-- Spec: docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md
--
-- เปลี่ยนแปลง:
--   - XP ย้ายจาก UPDATE profiles ตรง → PERFORM award_xp(...) (atomic กับ ledger + level)
--   - gold ยังคง update profiles ตรง (gold ไม่ได้ tracking ใน ledger)
--   - eligibility checks / INSERT user_achievements / title grant / notification → เก็บไว้ทั้งหมด
--   - return shape ไม่เปลี่ยน (rewards.tsx อ่าน name/xp_bonus/gold_bonus/title_granted)
--
-- NOTE: ลำดับการสร้าง — ต้องรันหลัง award_xp (Task 2: 20260715090100)
-- NOTE: ไม่แตะ complete_quest (legacy, ไม่มี caller — YAGNI)

CREATE OR REPLACE FUNCTION public.claim_achievement(_achievement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  p record;
  a record;
  player_value int;
  classroom_count int;
  ach_count int;
  title_uuid uuid;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO a FROM public.achievements WHERE id = _achievement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Achievement not found'; END IF;

  IF EXISTS (SELECT 1 FROM public.user_achievements WHERE user_id = _user_id AND achievement_id = a.id) THEN
    RAISE EXCEPTION 'Already claimed';
  END IF;

  SELECT level, xp, gold, quests_completed, streak_days, perfect_scores,
         night_owl_quests, early_bird_quests, weekend_warrior_quests, speed_demon_quests,
         max_perfect_streak, birthday_visited
    INTO p
    FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;

  SELECT COUNT(DISTINCT dq.classroom_id) INTO classroom_count
    FROM public.daily_quest_attempts dqa
    JOIN public.daily_quests dq ON dq.id = dqa.quest_id
    WHERE dqa.user_id = _user_id;

  SELECT COUNT(*) INTO ach_count FROM public.user_achievements WHERE user_id = _user_id;

  player_value := CASE a.criteria_type
    WHEN 'level'              THEN p.level
    WHEN 'xp'                 THEN p.xp
    WHEN 'gold'               THEN p.gold
    WHEN 'quests'             THEN p.quests_completed
    WHEN 'streak'             THEN p.streak_days
    WHEN 'perfect'            THEN p.perfect_scores
    WHEN 'night_owl'          THEN p.night_owl_quests
    WHEN 'early_bird'         THEN p.early_bird_quests
    WHEN 'weekend_warrior'    THEN p.weekend_warrior_quests
    WHEN 'speed_demon'        THEN p.speed_demon_quests
    WHEN 'perfect_streak'     THEN p.max_perfect_streak
    WHEN 'classrooms_quested' THEN classroom_count
    WHEN 'birthday'           THEN CASE WHEN p.birthday_visited THEN 1 ELSE 0 END
    WHEN 'achievement_count'  THEN ach_count
    ELSE 0
  END;

  IF player_value < a.criteria_value THEN
    RAISE EXCEPTION 'Not eligible yet';
  END IF;

  INSERT INTO public.user_achievements (user_id, achievement_id) VALUES (_user_id, a.id);

  -- gold ยังคง update profiles ตรง (ไม่มีใน ledger)
  -- XP + level ย้ายไป award_xp ทั้งหมด
  UPDATE public.profiles
    SET gold = gold + a.gold_bonus
    WHERE id = _user_id;

  -- XP วิ่งผ่าน award_xp (atomic กับ ledger + level)
  -- idempotency_key = achievement + user + achievement_id → กัน double-claim แม้ race condition
  PERFORM public.award_xp(
    _user_id         := _user_id,
    _amount          := a.xp_bonus,
    _source          := 'achievement'::public.app_xp_source,
    _source_label    := COALESCE(a.name, 'ปลดล็อกความสำเร็จ'),
    _subject         := NULL,
    _ref_table       := 'user_achievements',
    _ref_id          := a.id,
    _classroom_id    := NULL,
    _metadata        := jsonb_build_object(
      'achievement_id', a.id,
      'code', a.code,
      'rarity', a.rarity
    ),
    _idempotency_key := 'achievement:' || _user_id::text || ':' || a.id::text
  );

  IF a.grants_title_code IS NOT NULL THEN
    SELECT id INTO title_uuid FROM public.titles WHERE code = a.grants_title_code;
    IF title_uuid IS NOT NULL THEN
      INSERT INTO public.user_titles (user_id, title_id) VALUES (_user_id, title_uuid)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_user_id,
    CASE WHEN a.is_hidden THEN '🎉 ปลดล็อกความลับ: ' ELSE '🏆 ปลดล็อก: ' END || a.name,
    COALESCE(a.description, '') || ' (+'||a.xp_bonus||' XP, +'||a.gold_bonus||' ทอง)',
    'achievement', '/rewards');

  -- return shape เท่าเดิมทุกประการ (rewards.tsx อ่าน name/xp_bonus/gold_bonus/title_granted)
  RETURN jsonb_build_object(
    'name', a.name,
    'xp_bonus', a.xp_bonus,
    'gold_bonus', a.gold_bonus,
    'title_granted', a.grants_title_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_achievement(uuid) TO authenticated;
