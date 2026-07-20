-- 1) Add extra_time_seconds to exam_participants
ALTER TABLE public.exam_participants
  ADD COLUMN IF NOT EXISTS extra_time_seconds int NOT NULL DEFAULT 0;

-- 2) RPC: use_extra_time_token — adds _minutes to caller's participant row (default 5)
CREATE OR REPLACE FUNCTION public.use_extra_time_token(_exam_id uuid, _minutes int DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  p_row record;
  s_row record;
  new_ends timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _minutes IS NULL OR _minutes <= 0 OR _minutes > 30 THEN
    RAISE EXCEPTION 'invalid minutes';
  END IF;

  SELECT * INTO p_row FROM public.exam_participants
    WHERE session_id = _exam_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบผู้เข้าสอบ'; END IF;
  IF p_row.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'ส่งข้อสอบแล้ว'; END IF;

  SELECT * INTO s_row FROM public.exam_sessions WHERE id = _exam_id;
  IF s_row.status <> 'active' THEN RAISE EXCEPTION 'ข้อสอบยังไม่เปิด/ปิดแล้ว'; END IF;

  -- Consume token from inventory (raises if none)
  PERFORM public.consume_token('extra_time');

  UPDATE public.exam_participants
    SET extra_time_seconds = extra_time_seconds + (_minutes * 60)
    WHERE id = p_row.id
    RETURNING (s_row.ends_at + make_interval(secs => extra_time_seconds)) INTO new_ends;

  RETURN jsonb_build_object(
    'ok', true,
    'minutes_added', _minutes,
    'extra_time_seconds', p_row.extra_time_seconds + (_minutes * 60),
    'new_ends_at', new_ends
  );
END;
$function$;

-- 3) RPC: use_retry_token — clears attempt+progress for a daily quest so the user can redo it
CREATE OR REPLACE FUNCTION public.use_retry_token(_quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  refunded_gold int := 0;
  refunded_xp int := 0;
  a_row record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO a_row FROM public.daily_quest_attempts
    WHERE quest_id = _quest_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ยังไม่ได้ทำ quest นี้'; END IF;

  PERFORM public.consume_token('retry_token');

  -- Reverse gold reward from profile stats (undo the finalize)
  refunded_gold := COALESCE(a_row.gold_awarded, 0);
  refunded_xp := COALESCE(a_row.xp_awarded, 0);

  IF refunded_gold > 0 THEN
    UPDATE public.profiles
      SET gold = GREATEST(0, gold - refunded_gold),
          quests_completed = GREATEST(0, quests_completed - 1)
      WHERE id = uid;
  ELSE
    UPDATE public.profiles
      SET quests_completed = GREATEST(0, quests_completed - 1)
      WHERE id = uid;
  END IF;

  -- Delete the attempt and progress so the user can retake
  DELETE FROM public.daily_quest_attempts WHERE id = a_row.id;
  DELETE FROM public.daily_quest_question_progress
    WHERE user_id = uid AND quest_id = _quest_id;

  RETURN jsonb_build_object('ok', true, 'refunded_gold', refunded_gold, 'refunded_xp', refunded_xp);
END;
$function$;

-- 4) RPC: use_hint_token — returns a partial-answer hint for a specific question index
CREATE OR REPLACE FUNCTION public.use_hint_token(_quest_id uuid, _q_index int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  q_row record;
  question jsonb;
  answer_text text;
  answer_len int;
  reveal_len int;
  hint_text text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _q_index IS NULL OR _q_index < 0 THEN RAISE EXCEPTION 'invalid question index'; END IF;

  SELECT * INTO q_row FROM public.daily_quests WHERE id = _quest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบ quest'; END IF;

  question := q_row.questions -> _q_index;
  IF question IS NULL THEN RAISE EXCEPTION 'ไม่พบคำถามที่ index นี้'; END IF;

  -- Pull answer from any of the known answer keys
  answer_text := COALESCE(
    question->>'answer',
    question->>'expected_answer',
    question->>'correct_answer',
    question->>'answer_key',
    question->>'solution',
    question->>'expected'
  );

  IF answer_text IS NULL OR length(trim(answer_text)) = 0 THEN
    RAISE EXCEPTION 'คำถามนี้ไม่มีเฉลย ให้ใบ้ไม่ได้';
  END IF;

  PERFORM public.consume_token('hint_token');

  answer_len := length(answer_text);
  reveal_len := GREATEST(1, LEAST(answer_len - 1, ceil(answer_len * 0.4)::int));
  hint_text := substring(answer_text from 1 for reveal_len) || repeat('•', answer_len - reveal_len);

  RETURN jsonb_build_object(
    'ok', true,
    'hint', hint_text,
    'chars_revealed', reveal_len,
    'total_chars', answer_len
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.use_extra_time_token(uuid, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.use_retry_token(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.use_hint_token(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_extra_time_token(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_retry_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_hint_token(uuid, int) TO authenticated;