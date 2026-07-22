-- Expand lucky_drop_log to accept all reward kinds from Rewards Expansion
ALTER TABLE public.lucky_drop_log
  DROP CONSTRAINT IF EXISTS lucky_drop_log_reward_kind_check;

ALTER TABLE public.lucky_drop_log
  ADD CONSTRAINT lucky_drop_log_reward_kind_check
  CHECK (reward_kind IN (
    'gold', 'xp',
    'cosmetic_voucher', 'rare_title',
    'xp_potion', 'combo_shield', 'streak_freeze',
    'hint_token', 'retry_token', 'extra_time',
    'avatar_frame', 'name_color', 'banner'
  ));

-- Helper table for configurable lucky drop weights/pools
CREATE TABLE IF NOT EXISTS public.lucky_drop_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_kind text NOT NULL,
  reward_code text,
  reward_amount int,
  weight numeric(6,4) NOT NULL DEFAULT 1.0,
  min_combo int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lucky_drop_weights ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.lucky_drop_weights TO authenticated, anon;
GRANT ALL ON public.lucky_drop_weights TO service_role;
DROP POLICY IF EXISTS "lucky_drop_weights public read" ON public.lucky_drop_weights;
CREATE POLICY "lucky_drop_weights public read"
  ON public.lucky_drop_weights FOR SELECT TO authenticated, anon USING (true);

-- Seed default weights if table empty
INSERT INTO public.lucky_drop_weights (reward_kind, reward_code, reward_amount, weight, min_combo)
SELECT * FROM (VALUES
  ('gold', NULL, 10, 8.0, 0),
  ('xp', NULL, 25, 4.0, 0),
  ('xp', NULL, 50, 2.0, 5),
  ('hint_token', 'hint', 1, 2.0, 0),
  ('retry_token', 'retry', 1, 1.5, 0),
  ('extra_time', 'time5', 1, 1.0, 0),
  ('xp_potion', 'potion_1h', 1, 1.0, 3),
  ('combo_shield', 'shield', 1, 0.8, 3),
  ('streak_freeze', 'freeze', 1, 0.6, 0),
  ('avatar_frame', 'bronze', 1, 0.5, 0),
  ('name_color', '#3b82f6', 1, 0.5, 0),
  ('banner', 'sky', 1, 0.4, 0),
  ('cosmetic_voucher', 'voucher', 1, 0.5, 0),
  ('rare_title', 'rare_title', 1, 0.1, 0)
) AS v(reward_kind, reward_code, reward_amount, weight, min_combo)
WHERE NOT EXISTS (SELECT 1 FROM public.lucky_drop_weights);

-- Rewrite the lucky drop section of award_xp to grant the new kinds into inventory
-- We patch only the drop logic; everything else is kept identical.
CREATE OR REPLACE FUNCTION public.award_xp(
  _user_id uuid, _amount integer, _source app_xp_source, _source_label text,
  _subject text DEFAULT NULL::text, _ref_table text DEFAULT NULL::text,
  _ref_id uuid DEFAULT NULL::uuid, _classroom_id uuid DEFAULT NULL::uuid,
  _metadata jsonb DEFAULT '{}'::jsonb, _idempotency_key text DEFAULT NULL::text
)
RETURNS TABLE(
  transaction_id uuid, new_xp integer, new_level integer, leveled_up boolean,
  base_amount integer, combo_applied integer, multiplier_applied numeric,
  perfect_bonus integer, lucky_drop jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _existing uuid; _existing_perfect text; _existing_lucky jsonb;
  _current_xp int; _current_gold int; _old_level int;
  _new_xp int; _new_level int;
  _combo_row RECORD; _combo_after int := 0; _combo_mult numeric := 1.00;
  _event_row RECORD; _event_mult numeric := 1.00;
  _potion_row RECORD; _potion_mult numeric := 1.00;
  _shield_row RECORD; _shield_used boolean := false;
  _would_reset boolean := false;
  _outcome text; _base int; _total int;
  _perfect_base int := 0; _perfect_total int := 0;
  _lucky_chance numeric; _lucky_roll numeric; _lucky_reward jsonb := NULL;
  _lucky_kind text; _lucky_amt int; _lucky_status text; _lucky_id uuid;
  _lucky_code text; _lucky_pool RECORD; _lucky_total_weight numeric;
  _txn_id uuid; _perfect_txn_id uuid; _bonus_meta jsonb;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF _amount = 0 THEN RAISE EXCEPTION 'amount must be non-zero'; END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT t.id, t.metadata->>'perfect_bonus_txn_id', t.metadata->'cached_lucky_drop'
      INTO _existing, _existing_perfect, _existing_lucky
    FROM public.xp_transactions t
    WHERE t.user_id = _user_id AND t.idempotency_key = _idempotency_key LIMIT 1;
    IF _existing IS NOT NULL THEN
      SELECT p.xp, p.level INTO _current_xp, _old_level FROM public.profiles p WHERE p.id = _user_id;
      RETURN QUERY SELECT _existing, _current_xp, _old_level, false, 0, 0, 1.00, 0, _existing_lucky;
      RETURN;
    END IF;
  END IF;

  SELECT xp, gold, level INTO _current_xp, _current_gold, _old_level
    FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF _current_xp IS NULL THEN RAISE EXCEPTION 'profile not found: %', _user_id; END IF;

  IF _amount < 0 THEN
    _new_xp := GREATEST(0, _current_xp + _amount);
    _new_level := GREATEST(_old_level, 1 + _new_xp / 100);
    INSERT INTO public.xp_transactions (user_id, amount, source, source_label, subject, ref_table, ref_id, classroom_id, balance_after, metadata, idempotency_key)
    VALUES (_user_id, _amount, _source, _source_label, _subject, _ref_table, _ref_id, _classroom_id, _new_xp, _metadata, _idempotency_key)
    RETURNING id INTO _txn_id;
    UPDATE public.profiles SET xp = _new_xp, level = _new_level WHERE id = _user_id;
    RETURN QUERY SELECT _txn_id, _new_xp, _new_level, (_new_level > _old_level), _amount, 0, 1.00, 0, NULL::jsonb;
    RETURN;
  END IF;

  _outcome := _metadata->>'outcome';

  IF _outcome IS NOT NULL THEN
    SELECT * INTO _combo_row FROM public.combo_state WHERE user_id = _user_id FOR UPDATE;
    IF _combo_row.user_id IS NULL THEN
      INSERT INTO public.combo_state (user_id, current_combo, max_combo) VALUES (_user_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
      SELECT * INTO _combo_row FROM public.combo_state WHERE user_id = _user_id FOR UPDATE;
    END IF;

    _would_reset := false;
    IF _combo_row.last_success_at IS NOT NULL
       AND _combo_row.last_success_at < now() - interval '30 minutes' THEN _would_reset := true; END IF;
    IF _combo_row.last_success_at IS NOT NULL
       AND (now() AT TIME ZONE 'Asia/Bangkok')::date > (_combo_row.last_success_at AT TIME ZONE 'Asia/Bangkok')::date THEN _would_reset := true; END IF;
    IF _outcome = 'fail' THEN _would_reset := true; END IF;

    IF _would_reset AND _combo_row.current_combo > 0 THEN
      SELECT * INTO _shield_row FROM public.boost_effects
        WHERE user_id = _user_id AND effect_kind = 'combo_shield' AND consumed_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        UPDATE public.boost_effects SET consumed_at = now() WHERE id = _shield_row.id;
        _shield_used := true;
        _would_reset := false;
      END IF;
    END IF;

    IF _would_reset THEN _combo_row.current_combo := 0; END IF;

    IF _outcome IN ('success', 'perfect') THEN _combo_after := _combo_row.current_combo + 1;
    ELSIF _outcome = 'fail' THEN _combo_after := _combo_row.current_combo;
    ELSE _combo_after := _combo_row.current_combo;
    END IF;

    _combo_mult := public.combo_multiplier(_combo_after);

    UPDATE public.combo_state
      SET current_combo = _combo_after,
          max_combo = GREATEST(max_combo, _combo_after),
          last_success_at = CASE WHEN _outcome IN ('success','perfect') THEN now() ELSE last_success_at END,
          last_ref_id = _ref_id,
          updated_at = now()
      WHERE user_id = _user_id;
  END IF;

  SELECT * INTO _event_row FROM public.multiplier_events
    WHERE is_active = true AND now() BETWEEN starts_at AND ends_at AND classroom_id IS NULL
    ORDER BY multiplier DESC LIMIT 1;
  IF _event_row.id IS NOT NULL THEN _event_mult := _event_row.multiplier; END IF;

  SELECT * INTO _potion_row FROM public.boost_effects
    WHERE user_id = _user_id AND effect_kind = 'xp_potion' AND consumed_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY multiplier DESC NULLS LAST, created_at ASC LIMIT 1;
  IF FOUND AND _potion_row.multiplier IS NOT NULL THEN _potion_mult := _potion_row.multiplier; END IF;

  _base := _amount;
  _total := ROUND(_base::numeric * _combo_mult * _event_mult * _potion_mult);

  IF _outcome = 'perfect' THEN
    _perfect_base := LEAST(100, FLOOR(_base * 0.50));
    _perfect_total := ROUND(_perfect_base::numeric * _event_mult * _potion_mult);
  END IF;

  _bonus_meta := jsonb_build_object(
    'base', _base, 'combo_multiplier', _combo_mult, 'combo_count', _combo_after,
    'event_multiplier', _event_mult, 'event_id', _event_row.id,
    'potion_multiplier', _potion_mult,
    'combo_shield_used', _shield_used,
    'outcome', _outcome
  );

  INSERT INTO public.xp_transactions (user_id, amount, source, source_label, subject, ref_table, ref_id, classroom_id, balance_after, metadata, idempotency_key)
  VALUES (_user_id, _total, _source, _source_label, _subject, _ref_table, _ref_id, _classroom_id, _current_xp + _total,
          _metadata || jsonb_build_object('bonus_breakdown', _bonus_meta), _idempotency_key)
  RETURNING id INTO _txn_id;

  _new_xp := _current_xp + _total;
  _new_level := GREATEST(_old_level, 1 + _new_xp / 100);

  IF _perfect_total > 0 THEN
    INSERT INTO public.xp_transactions (user_id, amount, source, source_label, subject, ref_table, ref_id, classroom_id, balance_after, metadata, idempotency_key)
    VALUES (_user_id, _perfect_total, 'perfect_bonus'::public.app_xp_source, 'โบนัสคะแนนเต็ม', _subject,
            _ref_table, _ref_id, _classroom_id, _new_xp + _perfect_total,
            jsonb_build_object('base_amount', _perfect_base, 'event_multiplier', _event_mult, 'potion_multiplier', _potion_mult, 'parent_txn', _txn_id),
            'perfect_bonus:' || _txn_id::text)
    RETURNING id INTO _perfect_txn_id;
    _new_xp := _new_xp + _perfect_total;
    _new_level := GREATEST(_new_level, 1 + _new_xp / 100);
    UPDATE public.xp_transactions SET metadata = jsonb_set(metadata, '{perfect_bonus_txn_id}', to_jsonb(_perfect_txn_id::text)) WHERE id = _txn_id;
  END IF;

  UPDATE public.profiles SET xp = _new_xp, level = _new_level WHERE id = _user_id;

  IF _classroom_id IS NOT NULL AND _total > 0 THEN
    INSERT INTO public.classroom_scores (classroom_id, user_id, xp, quests_completed, streak_days, perfect_scores)
      VALUES (_classroom_id, _user_id, _total, 0, 0, 0)
    ON CONFLICT (classroom_id, user_id) DO UPDATE
      SET xp = public.classroom_scores.xp + EXCLUDED.xp, updated_at = now();
  END IF;

  -- Lucky drop: weighted pool from lucky_drop_weights
  IF _outcome IN ('success', 'perfect') THEN
    _lucky_chance := 0.08 + GREATEST(0, LEAST(_combo_after - 5, 10)) * 0.02;
    _lucky_roll := random();
    IF _lucky_roll < _lucky_chance THEN
      SELECT COALESCE(SUM(weight),0) INTO _lucky_total_weight
        FROM public.lucky_drop_weights
        WHERE is_active AND min_combo <= _combo_after;

      IF _lucky_total_weight > 0 THEN
        _lucky_roll := random() * _lucky_total_weight;
        _lucky_total_weight := 0;
        FOR _lucky_pool IN
          SELECT * FROM public.lucky_drop_weights
          WHERE is_active AND min_combo <= _combo_after
          ORDER BY weight DESC
        LOOP
          _lucky_total_weight := _lucky_total_weight + _lucky_pool.weight;
          IF _lucky_roll <= _lucky_total_weight THEN
            _lucky_kind := _lucky_pool.reward_kind;
            _lucky_code := _lucky_pool.reward_code;
            _lucky_amt := _lucky_pool.reward_amount;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      _lucky_status := CASE
        WHEN _lucky_kind IN ('avatar_frame','name_color','banner','title','cosmetic_voucher','rare_title') THEN 'pending'
        ELSE 'granted'
      END;

      INSERT INTO public.lucky_drop_log (user_id, source_ref, reward_kind, reward_amount, reward_code, status, granted_at)
      VALUES (_user_id, COALESCE(_ref_table || ':' || COALESCE(_ref_id::text,''), _source_label),
              _lucky_kind, _lucky_amt, _lucky_code,
              _lucky_status,
              CASE WHEN _lucky_status = 'granted' THEN now() ELSE NULL END)
      RETURNING id INTO _lucky_id;

      -- Grant immediately for consumable/currency kinds
      IF _lucky_kind = 'gold' THEN
        UPDATE public.profiles SET gold = gold + _lucky_amt WHERE id = _user_id;
      ELSIF _lucky_kind = 'xp' THEN
        INSERT INTO public.xp_transactions (user_id, amount, source, source_label, subject, ref_table, ref_id, classroom_id, balance_after, metadata, idempotency_key)
        VALUES (_user_id, _lucky_amt, 'lucky_drop'::public.app_xp_source, 'ลากรับโชค!', _subject, NULL, NULL, _classroom_id, _new_xp + _lucky_amt,
                jsonb_build_object('lucky', true, 'lucky_drop_id', _lucky_id), 'lucky_drop:' || _lucky_id::text);
        _new_xp := _new_xp + _lucky_amt;
        _new_level := GREATEST(_new_level, 1 + _new_xp / 100);
        UPDATE public.profiles SET xp = _new_xp, level = _new_level WHERE id = _user_id;
      ELSIF _lucky_kind IN ('xp_potion','combo_shield','streak_freeze','hint_token','retry_token','extra_time','avatar_frame','name_color','banner') THEN
        PERFORM public.grant_inventory_item(_user_id, _lucky_kind, COALESCE(_lucky_code, _lucky_kind), GREATEST(1, COALESCE(_lucky_amt,1)), 'lucky_drop:' || _lucky_id::text);
      END IF;

      _lucky_reward := jsonb_build_object(
        'id', _lucky_id, 'kind', _lucky_kind, 'amount', _lucky_amt,
        'code', _lucky_code, 'status', _lucky_status
      );

      UPDATE public.xp_transactions
        SET metadata = jsonb_set(metadata, '{cached_lucky_drop}', _lucky_reward)
        WHERE id = _txn_id;
    END IF;
  END IF;

  RETURN QUERY SELECT _txn_id, _new_xp, _new_level, (_new_level > _old_level),
                      _base, _combo_after, _combo_mult * _event_mult * _potion_mult,
                      _perfect_total, _lucky_reward;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.award_xp(
  uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text
) TO authenticated;
