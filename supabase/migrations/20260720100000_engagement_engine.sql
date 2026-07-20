-- Gamification Phase 1: Engagement Engine
-- Spec: docs/superpowers/specs/2026-07-20-gamification-engagement-engine-design.md
-- Adds: combo system, perfect bonus, multiplier events, lucky drops
-- All flow through existing award_xp() RPC (rewritten in this migration).

-- =====================================================================
-- 1. Enum additions
-- =====================================================================
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'lucky_drop';
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'perfect_bonus';
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'submission';
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'quiz';

-- =====================================================================
-- 2. combo_state — per-user combo tracking
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.combo_state (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_combo   int  NOT NULL DEFAULT 0,
  max_combo       int  NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_ref_id     uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.combo_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "combo_state read own or admin" ON public.combo_state;
CREATE POLICY "combo_state read own or admin"
  ON public.combo_state FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.combo_state TO authenticated;

-- =====================================================================
-- 3. multiplier_events — time-bounded XP multiplier windows
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.multiplier_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  multiplier   numeric(3,2) NOT NULL DEFAULT 2.00,
  label        text NOT NULL DEFAULT 'Double XP Hour',
  scope        text NOT NULL DEFAULT 'global',
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE CASCADE,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (multiplier >= 1.00 AND multiplier <= 5.00)
);

CREATE INDEX IF NOT EXISTS idx_mult_events_active_window
  ON public.multiplier_events (starts_at, ends_at)
  WHERE is_active = true;

ALTER TABLE public.multiplier_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "multiplier_events read all" ON public.multiplier_events;
CREATE POLICY "multiplier_events read all"
  ON public.multiplier_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "multiplier_events write admin" ON public.multiplier_events;
CREATE POLICY "multiplier_events write admin"
  ON public.multiplier_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.multiplier_events TO authenticated;

-- =====================================================================
-- 4. lucky_drop_log — stochastic post-action rewards
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.lucky_drop_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_ref   text,
  reward_kind  text NOT NULL,
  reward_amount int,
  reward_code  text,
  status       text NOT NULL DEFAULT 'granted',
  granted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('granted', 'pending', 'revoked')),
  CHECK (reward_kind IN ('gold', 'xp', 'cosmetic_voucher', 'rare_title'))
);

CREATE INDEX IF NOT EXISTS idx_lucky_drop_user_time
  ON public.lucky_drop_log (user_id, created_at DESC);

ALTER TABLE public.lucky_drop_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lucky_drop_log read own or admin" ON public.lucky_drop_log;
CREATE POLICY "lucky_drop_log read own or admin"
  ON public.lucky_drop_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.lucky_drop_log TO authenticated;

-- =====================================================================
-- 5. combo_multiplier — pure curve function (tiered)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.combo_multiplier(combo int)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN combo IS NULL THEN 1.00
    WHEN combo >= 10 THEN 2.00
    WHEN combo >= 7  THEN 1.80
    WHEN combo >= 5  THEN 1.50
    WHEN combo >= 3  THEN 1.20
    ELSE 1.00
  END;
$$;

-- =====================================================================
-- 6. Backfill — every profile starts with combo = 0
-- =====================================================================
INSERT INTO public.combo_state (user_id, current_combo, max_combo)
SELECT id, 0, 0 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================================
-- 7. award_xp — rewritten with combo/multiplier/perfect/lucky logic
-- =====================================================================
-- Must DROP first because the RETURN shape changed (CREATE OR REPLACE
-- cannot change return columns when param types are identical).
DROP FUNCTION IF EXISTS public.award_xp(uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text);

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
RETURNS TABLE(
  transaction_id     uuid,
  new_xp             int,
  new_level          int,
  leveled_up         boolean,
  base_amount        int,
  combo_applied      int,
  multiplier_applied numeric,
  perfect_bonus      int,
  lucky_drop         jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _existing uuid;
  _existing_perfect text;
  _existing_lucky   jsonb;
  _current_xp int;
  _current_gold int;
  _old_level int;
  _new_xp int;
  _new_level int;
  _combo_row RECORD;
  _combo_after int := 0;
  _combo_mult numeric := 1.00;
  _event_row RECORD;
  _event_mult numeric := 1.00;
  _outcome text;
  _base int;
  _total int;
  _perfect_base int := 0;
  _perfect_total int := 0;
  _lucky_chance numeric;
  _lucky_roll numeric;
  _lucky_reward jsonb := NULL;
  _lucky_kind text;
  _lucky_amt int;
  _lucky_status text;
  _lucky_id uuid;
  _txn_id uuid;
  _perfect_txn_id uuid;
  _bonus_meta jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF _amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero';
  END IF;

  -- 1. Idempotency replay
  IF _idempotency_key IS NOT NULL THEN
    SELECT t.id,
           t.metadata->>'perfect_bonus_txn_id',
           t.metadata->'cached_lucky_drop'
      INTO _existing, _existing_perfect, _existing_lucky
    FROM public.xp_transactions t
    WHERE t.user_id = _user_id AND t.idempotency_key = _idempotency_key
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      SELECT p.xp, p.level INTO _current_xp, _old_level
        FROM public.profiles p WHERE p.id = _user_id;
      RETURN QUERY
        SELECT _existing, _current_xp, _old_level, false,
               0, 0, 1.00, 0, _existing_lucky;
      RETURN;
    END IF;
  END IF;

  -- 2. Lock + read profile
  SELECT xp, gold, level INTO _current_xp, _current_gold, _old_level
    FROM public.profiles
    WHERE id = _user_id
    FOR UPDATE;

  IF _current_xp IS NULL THEN
    RAISE EXCEPTION 'profile not found: %', _user_id;
  END IF;

  -- 3. Negative amount → straight deduction (no bonuses)
  IF _amount < 0 THEN
    _new_xp    := GREATEST(0, _current_xp + _amount);
    _new_level := GREATEST(_old_level, 1 + _new_xp / 100);

    INSERT INTO public.xp_transactions (
      user_id, amount, source, source_label, subject,
      ref_table, ref_id, classroom_id, balance_after,
      metadata, idempotency_key
    ) VALUES (
      _user_id, _amount, _source, _source_label, _subject,
      _ref_table, _ref_id, _classroom_id, _new_xp,
      _metadata, _idempotency_key
    ) RETURNING id INTO _txn_id;

    UPDATE public.profiles SET xp = _new_xp, level = _new_level WHERE id = _user_id;

    RETURN QUERY SELECT _txn_id, _new_xp, _new_level, (_new_level > _old_level),
                 _amount, 0, 1.00, 0, NULL::jsonb;
    RETURN;
  END IF;

  -- 4. Read outcome from metadata
  _outcome := _metadata->>'outcome';

  -- 5. Combo tracking (only when outcome is provided)
  IF _outcome IS NOT NULL THEN
    SELECT * INTO _combo_row FROM public.combo_state WHERE user_id = _user_id FOR UPDATE;
    IF _combo_row.user_id IS NULL THEN
      INSERT INTO public.combo_state (user_id, current_combo, max_combo)
        VALUES (_user_id, 0, 0)
        ON CONFLICT (user_id) DO NOTHING;
      SELECT * INTO _combo_row FROM public.combo_state WHERE user_id = _user_id FOR UPDATE;
    END IF;

    -- Decay: 30-min inactivity
    IF _combo_row.last_success_at IS NOT NULL
       AND _combo_row.last_success_at < now() - interval '30 minutes' THEN
      _combo_row.current_combo := 0;
    END IF;
    -- Decay: day rollover (Asia/Bangkok = UTC+7)
    IF _combo_row.last_success_at IS NOT NULL
       AND (now() AT TIME ZONE 'Asia/Bangkok')::date
         > (_combo_row.last_success_at AT TIME ZONE 'Asia/Bangkok')::date THEN
      _combo_row.current_combo := 0;
    END IF;

    IF _outcome IN ('success', 'perfect') THEN
      _combo_after := _combo_row.current_combo + 1;
    ELSIF _outcome = 'fail' THEN
      _combo_after := 0;
    ELSE
      _combo_after := _combo_row.current_combo;
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

  -- 6. Multiplier event (highest active global event wins)
  SELECT * INTO _event_row FROM public.multiplier_events
    WHERE is_active = true
      AND now() BETWEEN starts_at AND ends_at
      AND classroom_id IS NULL
    ORDER BY multiplier DESC
    LIMIT 1;
  IF _event_row.id IS NOT NULL THEN
    _event_mult := _event_row.multiplier;
  END IF;

  -- 7. Compute amounts
  _base := _amount;
  _total := ROUND(_base::numeric * _combo_mult * _event_mult);

  IF _outcome = 'perfect' THEN
    _perfect_base := LEAST(100, FLOOR(_base * 0.50));
    _perfect_total := ROUND(_perfect_base::numeric * _event_mult);
  END IF;

  -- 8. Insert base ledger row (amount = total after multipliers)
  _bonus_meta := jsonb_build_object(
    'base', _base,
    'combo_multiplier', _combo_mult,
    'combo_count', _combo_after,
    'event_multiplier', _event_mult,
    'event_id', _event_row.id,
    'outcome', _outcome
  );

  INSERT INTO public.xp_transactions (
    user_id, amount, source, source_label, subject,
    ref_table, ref_id, classroom_id, balance_after,
    metadata, idempotency_key
  ) VALUES (
    _user_id, _total, _source, _source_label, _subject,
    _ref_table, _ref_id, _classroom_id, _current_xp + _total,
    _metadata || jsonb_build_object('bonus_breakdown', _bonus_meta),
    _idempotency_key
  ) RETURNING id INTO _txn_id;

  _new_xp    := _current_xp + _total;
  _new_level := GREATEST(_old_level, 1 + _new_xp / 100);

  -- 9. Apply perfect bonus as a separate transaction
  IF _perfect_total > 0 THEN
    INSERT INTO public.xp_transactions (
      user_id, amount, source, source_label, subject,
      ref_table, ref_id, classroom_id, balance_after,
      metadata, idempotency_key
    ) VALUES (
      _user_id, _perfect_total, 'perfect_bonus'::public.app_xp_source,
      'โบนัสคะแนนเต็ม', _subject,
      _ref_table, _ref_id, _classroom_id, _new_xp + _perfect_total,
      jsonb_build_object('base_amount', _perfect_base, 'event_multiplier', _event_mult,
                         'parent_txn', _txn_id),
      'perfect_bonus:' || _txn_id::text
    ) RETURNING id INTO _perfect_txn_id;

    _new_xp := _new_xp + _perfect_total;
    _new_level := GREATEST(_new_level, 1 + _new_xp / 100);

    UPDATE public.xp_transactions
      SET metadata = jsonb_set(metadata, '{perfect_bonus_txn_id}', to_jsonb(_perfect_txn_id::text))
      WHERE id = _txn_id;
  END IF;

  -- 10. Update profile (xp + level)
  UPDATE public.profiles
    SET xp = _new_xp, level = _new_level
    WHERE id = _user_id;

  -- 11. Sync classroom_scores (positive amounts only)
  IF _classroom_id IS NOT NULL AND _total > 0 THEN
    INSERT INTO public.classroom_scores (
      classroom_id, user_id, xp, quests_completed, streak_days, perfect_scores
    ) VALUES (
      _classroom_id, _user_id, _total, 0, 0, 0
    )
    ON CONFLICT (classroom_id, user_id) DO UPDATE
      SET xp = public.classroom_scores.xp + EXCLUDED.xp,
          updated_at = now();
  END IF;

  -- 12. Lucky drop (only on success / perfect)
  IF _outcome IN ('success', 'perfect') THEN
    _lucky_chance := 0.08 + GREATEST(0, LEAST(_combo_after - 5, 10)) * 0.02;
    _lucky_roll := random();
    IF _lucky_roll < _lucky_chance THEN
      _lucky_roll := random();
      IF _lucky_roll < 0.60 THEN
        _lucky_kind := 'gold'; _lucky_amt := 10; _lucky_status := 'granted';
      ELSIF _lucky_roll < 0.85 THEN
        _lucky_kind := 'xp'; _lucky_amt := 25; _lucky_status := 'granted';
      ELSIF _lucky_roll < 0.95 THEN
        _lucky_kind := 'xp'; _lucky_amt := 50; _lucky_status := 'granted';
      ELSIF _lucky_roll < 0.99 THEN
        _lucky_kind := 'cosmetic_voucher'; _lucky_amt := NULL; _lucky_status := 'pending';
      ELSE
        _lucky_kind := 'rare_title'; _lucky_amt := NULL; _lucky_status := 'pending';
      END IF;

      INSERT INTO public.lucky_drop_log (
        user_id, source_ref, reward_kind, reward_amount, status, granted_at
      ) VALUES (
        _user_id, COALESCE(_ref_table || ':' || COALESCE(_ref_id::text,''), _source_label),
        _lucky_kind, _lucky_amt, _lucky_status,
        CASE WHEN _lucky_status = 'granted' THEN now() ELSE NULL END
      ) RETURNING id INTO _lucky_id;

      IF _lucky_kind = 'gold' THEN
        UPDATE public.profiles SET gold = gold + _lucky_amt WHERE id = _user_id;
      ELSIF _lucky_kind = 'xp' THEN
        INSERT INTO public.xp_transactions (
          user_id, amount, source, source_label, subject,
          ref_table, ref_id, classroom_id, balance_after,
          metadata, idempotency_key
        ) VALUES (
          _user_id, _lucky_amt, 'lucky_drop'::public.app_xp_source,
          'ลากรับโชค!', _subject,
          NULL, NULL, _classroom_id, _new_xp + _lucky_amt,
          jsonb_build_object('lucky', true, 'lucky_drop_id', _lucky_id),
          'lucky_drop:' || _lucky_id::text
        );
        _new_xp := _new_xp + _lucky_amt;
        _new_level := GREATEST(_new_level, 1 + _new_xp / 100);
        UPDATE public.profiles SET xp = _new_xp, level = _new_level WHERE id = _user_id;
      END IF;

      _lucky_reward := jsonb_build_object(
        'id', _lucky_id, 'kind', _lucky_kind, 'amount', _lucky_amt,
        'status', _lucky_status
      );

      UPDATE public.xp_transactions
        SET metadata = jsonb_set(metadata, '{cached_lucky_drop}', _lucky_reward)
        WHERE id = _txn_id;
    END IF;
  END IF;

  RETURN QUERY SELECT _txn_id, _new_xp, _new_level, (_new_level > _old_level),
              _base, _combo_after, _combo_mult * _event_mult,
              _perfect_total, _lucky_reward;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.award_xp(
  uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text
) TO authenticated;

-- =====================================================================
-- 8. finalize_quest_from_progress — pass outcome + return bonus fields
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finalize_quest_from_progress(_user_id uuid, _quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _q RECORD;
  _total INT := 0;
  _max INT := 0;
  _per JSONB := '[]'::jsonb;
  _answers JSONB := '[]'::jsonb;
  _qcount INT;
  _row RECORD;
  _ratio NUMERIC;
  _xp INT;
  _gold INT;
  _is_perfect BOOLEAN;
  _answered_count INT := 0;
  _today DATE := CURRENT_DATE;
  _prof RECORD;
  _new_streak INT;
  _q_max INT;
  i INT;
  _award RECORD;
  _outcome text;
BEGIN
  SELECT * INTO _q FROM public.daily_quests WHERE id = _quest_id;
  IF _q.id IS NULL THEN RAISE EXCEPTION 'quest not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.daily_quest_attempts WHERE quest_id=_quest_id AND user_id=_user_id) THEN
    RAISE EXCEPTION 'already attempted';
  END IF;

  _qcount := COALESCE(jsonb_array_length(_q.questions), 0);
  FOR i IN 0.._qcount-1 LOOP
    _q_max := COALESCE((_q.questions->i->>'points')::int, (_q.questions->i->>'max_score')::int, 10);
    SELECT * INTO _row FROM public.daily_quest_question_progress
      WHERE user_id=_user_id AND quest_id=_quest_id AND q_index=i;
    IF FOUND AND _row.result IS NOT NULL THEN
      _total := _total + COALESCE((_row.result->>'score')::int, 0);
      _max := _max + COALESCE((_row.result->>'max_score')::int, _q_max);
      _per := _per || jsonb_build_array(_row.result);
      _answers := _answers || jsonb_build_array(COALESCE(_row.answer, ''));
      _answered_count := _answered_count + 1;
    ELSE
      _max := _max + _q_max;
      _per := _per || jsonb_build_array(jsonb_build_object(
        'idx', i, 'score', 0, 'max_score', _q_max, 'correct', false, 'feedback', 'ไม่ได้ตอบ'
      ));
      _answers := _answers || jsonb_build_array('');
    END IF;
  END LOOP;

  IF _answered_count = 0 THEN
    RAISE EXCEPTION 'no answers to finalize';
  END IF;

  _ratio := GREATEST(0, LEAST(1, _total::numeric / NULLIF(_max,0)));
  _xp := ROUND(_q.max_xp_reward * _ratio);
  _gold := ROUND(_q.max_gold_reward * _ratio);
  _is_perfect := (_max > 0 AND _total >= _max);
  _outcome := CASE WHEN _is_perfect THEN 'perfect' WHEN _total > 0 THEN 'success' ELSE 'fail' END;

  INSERT INTO public.daily_quest_attempts(quest_id,user_id,answers,score,max_score,xp_awarded,gold_awarded,ai_feedback,per_question)
  VALUES (_quest_id,_user_id,_answers,_total,_max,_xp,_gold,'สรุปคะแนนจากคำตอบที่ทำไว้',_per);

  SELECT * INTO _prof FROM public.profiles WHERE id=_user_id;
  _new_streak := CASE
    WHEN _prof.last_quest_date = _today THEN _prof.streak_days
    WHEN _prof.last_quest_date = _today - INTERVAL '1 day' THEN _prof.streak_days + 1
    ELSE 1
  END;

  UPDATE public.profiles
  SET gold = gold + _gold,
      quests_completed = quests_completed + 1,
      perfect_scores = perfect_scores + CASE WHEN _is_perfect THEN 1 ELSE 0 END,
      streak_days = _new_streak,
      last_quest_date = _today
  WHERE id=_user_id;

  SELECT * INTO _award FROM public.award_xp(
    _user_id := _user_id,
    _amount := _xp,
    _source := 'daily_quest'::public.app_xp_source,
    _source_label := COALESCE(_q.title, 'ทำควอสต์รายวัน'),
    _ref_table := 'daily_quest_attempts',
    _classroom_id := _q.classroom_id,
    _metadata := jsonb_build_object(
      'quest_id', _quest_id,
      'perfect', _is_perfect,
      'score', _total,
      'max_score', _max,
      'outcome', _outcome
    ),
    _idempotency_key := 'quest_finalize:' || _user_id::text || ':' || _quest_id::text
  );

  INSERT INTO public.classroom_scores (classroom_id, user_id, xp, quests_completed, streak_days, perfect_scores)
  VALUES (_q.classroom_id, _user_id, 0, 1, _new_streak, CASE WHEN _is_perfect THEN 1 ELSE 0 END)
  ON CONFLICT (classroom_id, user_id) DO UPDATE
  SET quests_completed = public.classroom_scores.quests_completed + 1,
      streak_days = GREATEST(public.classroom_scores.streak_days, EXCLUDED.streak_days),
      perfect_scores = public.classroom_scores.perfect_scores + EXCLUDED.perfect_scores,
      updated_at = now();

  DELETE FROM public.daily_quest_question_progress WHERE user_id=_user_id AND quest_id=_quest_id;

  RETURN jsonb_build_object(
    'xp_gained',_xp,'gold_gained',_gold,'gold_awarded',_gold,
    'score',_total,'max_score',_max,
    'total_xp',_award.new_xp,'level',_award.new_level,'streak',_new_streak,'perfect',_is_perfect,
    'combo_applied',_award.combo_applied,
    'multiplier_applied',_award.multiplier_applied,
    'perfect_bonus',_award.perfect_bonus,
    'lucky_drop',_award.lucky_drop
  );
END;
$func$;

-- =====================================================================
-- 9. award_submission_grade trigger — route via award_xp
-- =====================================================================
-- Preserves: late penalty, gold = xp/4, notification, perfect_scores counter,
-- re-grade guard. Adds: combo + multiplier + perfect bonus + lucky drop.
CREATE OR REPLACE FUNCTION public.award_submission_grade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _assignment RECORD;
  _ratio NUMERIC;
  _xp INT;
  _gold INT;
  _is_perfect BOOLEAN;
  _effective_score INT;
  _outcome text;
  _award RECORD;
BEGIN
  -- Only when transitioning into graded state with a score
  IF NEW.graded_at IS NULL OR NEW.score IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.graded_at IS NOT NULL THEN
    RETURN NEW;  -- already graded once; re-grade does not re-award
  END IF;

  SELECT id, max_score, xp_reward, late_penalty_percent, classroom_id
    INTO _assignment
  FROM public.assignments WHERE id = NEW.assignment_id;
  IF _assignment.id IS NULL THEN RETURN NEW; END IF;

  _effective_score := NEW.score;
  IF NEW.is_late AND COALESCE(_assignment.late_penalty_percent, 0) > 0 THEN
    _effective_score := GREATEST(0, ROUND(NEW.score * (1 - _assignment.late_penalty_percent / 100.0))::INT);
  END IF;

  _ratio := GREATEST(0, LEAST(1, _effective_score::NUMERIC / NULLIF(_assignment.max_score, 0)));
  _xp := ROUND(_assignment.xp_reward * _ratio);
  _gold := ROUND(_xp / 4.0);
  _is_perfect := (_effective_score >= _assignment.max_score AND _assignment.max_score > 0);
  _outcome := CASE WHEN _is_perfect THEN 'perfect'
                   WHEN _effective_score > 0 THEN 'success'
                   ELSE 'fail' END;

  -- gold + perfect_scores counter still updated directly (not part of XP ledger)
  UPDATE public.profiles
    SET gold = gold + _gold,
        perfect_scores = perfect_scores + CASE WHEN _is_perfect THEN 1 ELSE 0 END
    WHERE id = NEW.user_id;

  SELECT * INTO _award FROM public.award_xp(
    _user_id := NEW.user_id,
    _amount := _xp,
    _source := 'submission'::public.app_xp_source,
    _source_label := 'ส่งงานได้คะแนน',
    _ref_table := 'submissions',
    _ref_id := NEW.id,
    _classroom_id := _assignment.classroom_id,
    _metadata := jsonb_build_object(
      'outcome', _outcome,
      'score', _effective_score,
      'max_score', _assignment.max_score,
      'assignment_id', NEW.assignment_id,
      'is_late', NEW.is_late
    ),
    _idempotency_key := 'submission_grade:' || NEW.id::text
  );

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (NEW.user_id, '✅ งานถูกตรวจแล้ว',
    'คะแนน ' || _effective_score || '/' || _assignment.max_score ||
    ' • +' || _xp || ' XP, +' || _gold || ' ทอง',
    'grade', '/classrooms');

  RETURN NEW;
END;
$func$;

-- =====================================================================
-- 10. award_attendance_checkin trigger — route via award_xp
-- =====================================================================
-- Preserves: present=15/late=5 XP, gold present=5/late=2, streak update,
-- notification. Adds: combo + multiplier + lucky drop.
CREATE OR REPLACE FUNCTION public.award_attendance_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _xp INT;
  _gold INT;
  _prof RECORD;
  _session RECORD;
  _today DATE := CURRENT_DATE;
  _new_streak INT;
  _award RECORD;
BEGIN
  IF NEW.status NOT IN ('present', 'late') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('present', 'late') THEN RETURN NEW; END IF;

  _xp := CASE WHEN NEW.status = 'present' THEN 15 ELSE 5 END;
  _gold := CASE WHEN NEW.status = 'present' THEN 5 ELSE 2 END;

  SELECT * INTO _session FROM public.attendance_sessions WHERE id = NEW.session_id;
  IF _session.id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO _prof FROM public.profiles WHERE id = NEW.user_id;
  _new_streak := CASE
    WHEN _prof.last_quest_date = _today THEN _prof.streak_days
    WHEN _prof.last_quest_date = _today - INTERVAL '1 day' THEN _prof.streak_days + 1
    ELSE 1
  END;

  UPDATE public.profiles
    SET gold = gold + _gold,
        streak_days = _new_streak,
        last_quest_date = _today
    WHERE id = NEW.user_id;

  SELECT * INTO _award FROM public.award_xp(
    _user_id := NEW.user_id,
    _amount := _xp,
    _source := 'attendance'::public.app_xp_source,
    _source_label := CASE WHEN NEW.status = 'present' THEN 'มาเรียนตรงเวลา' ELSE 'มาเรียนสาย' END,
    _ref_table := 'attendance_records',
    _ref_id := NEW.id,
    _classroom_id := _session.classroom_id,
    _metadata := jsonb_build_object(
      'outcome', 'success',
      'session_id', NEW.session_id,
      'status', NEW.status
    ),
    _idempotency_key := 'attendance:' || NEW.id::text
  );

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (NEW.user_id,
    CASE WHEN NEW.status = 'present' THEN '📚 เช็กชื่อสำเร็จ' ELSE '⏰ เช็กชื่อ (สาย)' END,
    '+' || _xp || ' XP, +' || _gold || ' ทอง • Streak ' || _new_streak || ' วัน',
    'attendance', '/classrooms');

  RETURN NEW;
END;
$func$;

-- =====================================================================
-- 11. finish_quiz_session — route via award_xp (top 3 only)
-- =====================================================================
-- Preserves: rank 1=100/2=60/3=30 XP, gold 50/30/15, notification.
-- Adds: outcome (rank 1 = perfect, 2-3 = success), so combos/multipliers apply.
DROP FUNCTION IF EXISTS public.finish_quiz_session(uuid);
CREATE OR REPLACE FUNCTION public.finish_quiz_session(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _session RECORD;
  _p RECORD;
  _rank INT := 0;
  _xp INT;
  _gold INT;
  _outcome text;
  _award RECORD;
  _results jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quiz_sessions WHERE id = _session_id AND host_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.quiz_sessions SET status='finished', finished_at=now() WHERE id=_session_id;
  SELECT * INTO _session FROM public.quiz_sessions WHERE id = _session_id;

  FOR _p IN
    SELECT user_id, total_score FROM public.quiz_participants
    WHERE session_id = _session_id AND total_score > 0
    ORDER BY total_score DESC LIMIT 3
  LOOP
    _rank := _rank + 1;
    _xp := CASE _rank WHEN 1 THEN 100 WHEN 2 THEN 60 ELSE 30 END;
    _gold := CASE _rank WHEN 1 THEN 50 WHEN 2 THEN 30 ELSE 15 END;
    _outcome := CASE WHEN _rank = 1 THEN 'perfect' ELSE 'success' END;

    UPDATE public.profiles SET gold = gold + _gold WHERE id = _p.user_id;

    SELECT * INTO _award FROM public.award_xp(
      _user_id := _p.user_id,
      _amount := _xp,
      _source := 'quiz'::public.app_xp_source,
      _source_label := 'ควิซสด: ' || COALESCE(_session.title, ''),
      _ref_table := 'quiz_participants',
      _ref_id := NULL,
      _classroom_id := _session.classroom_id,
      _metadata := jsonb_build_object(
        'outcome', _outcome,
        'session_id', _session_id,
        'rank', _rank,
        'score', _p.total_score
      ),
      _idempotency_key := 'quiz_top:' || _session_id::text || ':' || _p.user_id::text
    );

    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (_p.user_id, '🏅 ผลควิซสด',
      'คุณได้อันดับ ' || _rank || '! +' || _xp || ' XP, +' || _gold || ' ทอง',
      'quiz', '/classrooms');

    _results := _results || jsonb_build_array(jsonb_build_object(
      'user_id', _p.user_id, 'rank', _rank, 'xp', _xp, 'gold', _gold,
      'combo_applied', _award.combo_applied,
      'multiplier_applied', _award.multiplier_applied,
      'perfect_bonus', _award.perfect_bonus,
      'lucky_drop', _award.lucky_drop
    ));
  END LOOP;

  RETURN jsonb_build_object('status','ok','results',_results);
END;
$func$;
GRANT EXECUTE ON FUNCTION public.finish_quiz_session(uuid) TO authenticated;
