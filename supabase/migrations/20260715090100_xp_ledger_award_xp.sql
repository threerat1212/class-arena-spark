-- RPC กลางสำหรับให้ XP (source of truth)
-- atomic: INSERT ledger + UPDATE profiles + UPSERT classroom_scores
CREATE OR REPLACE FUNCTION public.award_xp(
  _user_id         uuid,
  _amount          int,
  _source          public.app_xp_source,
  _source_label    text,
  _subject         text    DEFAULT NULL,
  _ref_table       text    DEFAULT NULL,
  _ref_id          uuid    DEFAULT NULL,
  _classroom_id    uuid    DEFAULT NULL,
  _metadata        jsonb   DEFAULT '{}'::jsonb,
  _idempotency_key text    DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid, new_xp int, new_level int, leveled_up boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _current_xp int;
  _old_level int;
  _new_xp int;
  _new_level int;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF _amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero';
  END IF;

  -- 1. Idempotency: ถ้า key ซ้ำ return txn เดิม
  IF _idempotency_key IS NOT NULL THEN
    SELECT t.id, p.xp, p.level
      INTO _existing, _current_xp, _old_level
    FROM public.xp_transactions t
    JOIN public.profiles p ON p.id = t.user_id
    WHERE t.user_id = _user_id AND t.idempotency_key = _idempotency_key
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      RETURN QUERY SELECT _existing, _current_xp, _old_level, false;
      RETURN;
    END IF;
  END IF;

  -- 2. Lock + อ่าน profile ปัจจุบัน
  SELECT xp, level INTO _current_xp, _old_level
    FROM public.profiles
    WHERE id = _user_id
    FOR UPDATE;

  IF _current_xp IS NULL THEN
    RAISE EXCEPTION 'profile not found: %', _user_id;
  END IF;

  -- 3. คำนวณ balance ใหม่ (clamp ที่ 0)
  _new_xp    := GREATEST(0, _current_xp + _amount);
  _new_level := GREATEST(_old_level, 1 + _new_xp / 100);

  -- 4. INSERT ledger + UPDATE profiles (atomic)
  INSERT INTO public.xp_transactions (
    user_id, amount, source, source_label, subject,
    ref_table, ref_id, classroom_id, balance_after,
    metadata, idempotency_key
  ) VALUES (
    _user_id, _amount, _source, _source_label, _subject,
    _ref_table, _ref_id, _classroom_id, _new_xp,
    _metadata, _idempotency_key
  )
  RETURNING id INTO _existing;

  UPDATE public.profiles
    SET xp = _new_xp, level = _new_level
    WHERE id = _user_id;

  -- 5. Sync classroom_scores.xp (ถ้ามี classroom_id และ amount > 0)
  IF _classroom_id IS NOT NULL AND _amount > 0 THEN
    INSERT INTO public.classroom_scores (
      classroom_id, user_id, xp, quests_completed, streak_days, perfect_scores
    ) VALUES (
      _classroom_id, _user_id, _amount, 0, 0, 0
    )
    ON CONFLICT (classroom_id, user_id) DO UPDATE
      SET xp = public.classroom_scores.xp + EXCLUDED.xp,
          updated_at = now();
  END IF;

  RETURN QUERY SELECT _existing, _new_xp, _new_level, (_new_level > _old_level);
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_xp(
  uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text
) TO authenticated;
