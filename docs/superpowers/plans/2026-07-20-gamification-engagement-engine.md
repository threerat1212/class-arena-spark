# Gamification Phase 1 — Engagement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add combo system, perfect-score bonus, multiplier events, and lucky drops to Scholar Hall's XP system — all flowing through the existing `award_xp()` RPC. Make every action feel different and rewarding.

**Architecture:** Extend the existing `award_xp()` RPC (single source of truth) with new metadata-driven behavior. Add 3 new tables (`combo_state`, `multiplier_events`, `lucky_drop_log`), 2 new enum values, and fold 3 legacy trigger-based XP paths (submissions, attendance, quiz) into the central RPC. Frontend adds 4 new components and wires them into quest/exam/quiz/dashboard surfaces.

**Tech Stack:** Supabase Postgres (plpgsql RPC + RLS), TanStack Start + React 19 + TypeScript, shadcn/ui + Radix + motion + sonner, i18next (Thai-first).

**Spec:** `docs/superpowers/specs/2026-07-20-gamification-engagement-engine-design.md`

**Testing reality:** This project has **no test framework** (no vitest/jest). Verification is by `bun run typecheck`, `bun run check`, `bun run build`, plus manual `psql` smoke tests against a local Supabase. Each task's verification step is one of these.

---

## File map

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260720100000_engagement_engine.sql` | All schema + RPC + trigger changes (single atomic migration) |
| `src/components/gamification/combo-badge.tsx` | Animated combo pill |
| `src/components/gamification/multiplier-event-banner.tsx` | Dismissible event banner |
| `src/components/gamification/bonus-breakdown.tsx` | Math breakdown renderer |
| `src/components/gamification/lucky-drop-toast.tsx` | Sonner wrapper for lucky drops |
| `src/lib/gamification.types.ts` | TypeScript types for new return fields + tables |
| `src/routes/_authenticated/admin/multiplier-events.tsx` | Admin CRUD page for events |
| `supabase/functions/spawn-weekly-multiplier/index.ts` | Weekly auto-spawn edge function |

### Modified files

| Path | Reason |
|---|---|
| `src/integrations/supabase/types.ts` | Regenerated via `supabase gen types` after migration |
| `src/routes/_authenticated/quests.tsx` | Wire bonus breakdown into result screen |
| `src/routes/_authenticated/exam.$examId.report.tsx` | Wire bonus breakdown into exam report |
| `src/routes/_authenticated/quiz.$sessionId.tsx` | Combo badge per question batch |
| `src/components/gamification-status-panel.tsx` | Show combo + event banner |
| `src/components/app-sidebar.tsx` | Add admin multiplier-events nav (admin role only) |
| `src/i18n.ts` | Add Thai + English strings for new UI |
| `src/routes/_authenticated/rewards.tsx` | New "กิจกรรม" (Events) tab |

---

## Task ordering

The tasks are grouped by layer. Each task is self-contained and independently committable.

- **Tasks 1-3: Database layer** — migration + types regen
- **Tasks 4-7: Trigger/RPC migration** — fold legacy paths into `award_xp`
- **Tasks 8-12: Frontend components** — isolated, build-first
- **Tasks 13-16: Wire components into pages**
- **Task 17: Admin UI**
- **Task 18: Edge function + schedule**
- **Task 19: i18n + final polish + build verify**

---

### Task 1: Create the engagement engine migration (schema only)

**Files:**
- Create: `supabase/migrations/20260720100000_engagement_engine.sql`

This task creates ONLY the tables, enum values, and the `combo_multiplier()` helper. The `award_xp` rewrite and trigger migrations are separate tasks (2, 4, 5) so each can be verified independently.

- [ ] **Step 1: Write the migration file header + enum additions**

Create `supabase/migrations/20260720100000_engagement_engine.sql` with this exact content:

```sql
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
```

- [ ] **Step 2: Add `combo_state` table**

Append to the same migration file:

```sql
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
```

- [ ] **Step 3: Add `multiplier_events` table**

Append:

```sql
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
```

- [ ] **Step 4: Add `lucky_drop_log` table**

Append:

```sql
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
```

- [ ] **Step 5: Add `combo_multiplier()` helper function**

Append:

```sql
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
```

- [ ] **Step 6: Backfill `combo_state` for all existing users**

Append:

```sql
-- =====================================================================
-- 6. Backfill — every profile starts with combo = 0
-- =====================================================================
INSERT INTO public.combo_state (user_id, current_combo, max_combo)
SELECT id, 0, 0 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
```

- [ ] **Step 7: Verify syntax with local Supabase**

Run:
```bash
bunx supabase db reset --linked
```
(If no linked project, run against local: `bunx supabase start && bunx supabase db reset`)

Expected: migration applies without errors. If you see `has_role` not found, check that the helper exists (it is used elsewhere — search migrations for `CREATE FUNCTION has_role`).

Alternative if no local Supabase: skip; the migration will be exercised when Task 2's `award_xp` rewrite is loaded together.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): add combo/multiplier/lucky-drop schema

Tables: combo_state, multiplier_events, lucky_drop_log
Enum values: lucky_drop, perfect_bonus, submission, quiz
Helper: combo_multiplier(int) — tiered curve 1x..2x

Spec: docs/superpowers/specs/2026-07-20-gamification-engagement-engine-design.md"
```

---

### Task 2: Rewrite `award_xp()` with multipliers, perfect bonus, lucky drops

**Files:**
- Modify: `supabase/migrations/20260720100000_engagement_engine.sql` (append to existing file)

This task appends the new `award_xp()` body to the migration created in Task 1. Keeping it in the same migration keeps the deployment atomic.

- [ ] **Step 1: Append the new `award_xp` definition**

Append to `supabase/migrations/20260720100000_engagement_engine.sql`:

```sql
-- =====================================================================
-- 7. award_xp — rewritten with combo/multiplier/perfect/lucky logic
-- =====================================================================
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
AS $$
DECLARE
  -- idempotency
  _existing uuid;
  _existing_perfect int;
  _existing_lucky   jsonb;
  -- profile state
  _current_xp int;
  _current_gold int;
  _old_level int;
  _new_xp int;
  _new_level int;
  -- combo state
  _combo_row RECORD;
  _combo_after int;
  _combo_mult numeric := 1.00;
  -- multiplier event
  _event_row RECORD;
  _event_mult numeric := 1.00;
  -- outcome
  _outcome text;
  -- math
  _base int;
  _total int;
  _perfect_base int := 0;
  _perfect_total int := 0;
  -- lucky drop
  _lucky_roll numeric;
  _lucky_chance numeric;
  _lucky_reward jsonb := NULL;
  _lucky_kind text;
  _lucky_amt int;
  _lucky_code text;
  _lucky_status text;
  _lucky_id uuid;
  -- misc
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

  -- ============================================================
  -- 1. Idempotency replay
  -- ============================================================
  IF _idempotency_key IS NOT NULL THEN
    SELECT t.id,
           COALESCE((t.metadata->>'perfect_bonus_txn_id')::int, 0),
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
               COALESCE((_existing_perfect), 0), 0, 1.00, 0, _existing_lucky;
      RETURN;
    END IF;
  END IF;

  -- ============================================================
  -- 2. Lock + read profile
  -- ============================================================
  SELECT xp, gold, level INTO _current_xp, _current_gold, _old_level
    FROM public.profiles
    WHERE id = _user_id
    FOR UPDATE;

  IF _current_xp IS NULL THEN
    RAISE EXCEPTION 'profile not found: %', _user_id;
  END IF;

  -- ============================================================
  -- 3. Negative amount → straight deduction (no bonuses)
  -- ============================================================
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

  -- ============================================================
  -- 4. Read outcome from metadata
  -- ============================================================
  _outcome := _metadata->>'outcome';

  -- ============================================================
  -- 5. Combo tracking (only when outcome is provided)
  -- ============================================================
  IF _outcome IS NOT NULL THEN
    SELECT * INTO _combo_row FROM public.combo_state WHERE user_id = _user_id FOR UPDATE;

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
  ELSE
    _combo_after := 0;
    _combo_mult := 1.00;
  END IF;

  -- ============================================================
  -- 6. Multiplier event (highest active wins; global only in Phase 1)
  -- ============================================================
  SELECT * INTO _event_row FROM public.multiplier_events
    WHERE is_active = true
      AND now() BETWEEN starts_at AND ends_at
      AND classroom_id IS NULL
    ORDER BY multiplier DESC
    LIMIT 1;
  IF _event_row.id IS NOT NULL THEN
    _event_mult := _event_row.multiplier;
  END IF;

  -- ============================================================
  -- 7. Compute amounts
  -- ============================================================
  _base := _amount;
  _total := ROUND(_base::numeric * _combo_mult * _event_mult);

  -- Perfect bonus (additive, separate transaction, multiplied by event only)
  IF _outcome = 'perfect' THEN
    _perfect_base := LEAST(100, FLOOR(_base * 0.50));
    _perfect_total := ROUND(_perfect_base::numeric * _event_mult);
  END IF;

  -- ============================================================
  -- 8. Insert base ledger row (amount = total after multipliers)
  -- ============================================================
  _bonus_meta := jsonb_build_object(
    'base', _base,
    'combo_multiplier', _combo_mult,
    'combo_count', _combo_after,
    'event_multiplier', _event_mult,
    'event_id', _event_row.id,
    'outcome', _outcome
  );
  -- Annotate with pointers for idempotent replay
  IF _perfect_total > 0 OR _lucky_reward IS NOT NULL THEN
    _bonus_meta := _bonus_meta || jsonb_build_object(
      'has_perfect_bonus', _perfect_total > 0,
      'cached_lucky_drop', NULL
    );
  END IF;

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

  -- ============================================================
  -- 9. Apply perfect bonus as a separate transaction
  -- ============================================================
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

    -- Link back so idempotency replay can find it
    UPDATE public.xp_transactions
      SET metadata = jsonb_set(metadata, '{perfect_bonus_txn_id}', to_jsonb(_perfect_txn_id::text))
      WHERE id = _txn_id;
  END IF;

  -- ============================================================
  -- 10. Update profile (xp + level)
  -- ============================================================
  UPDATE public.profiles
    SET xp = _new_xp, level = _new_level
    WHERE id = _user_id;

  -- ============================================================
  -- 11. Sync classroom_scores (positive amounts only, base amount)
  -- ============================================================
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

  -- ============================================================
  -- 12. Lucky drop (only on success / perfect)
  -- ============================================================
  IF _outcome IN ('success', 'perfect') THEN
    _lucky_chance := 0.08 + GREATEST(0, LEAST(_combo_after - 5, 10)) * 0.02;
    _lucky_roll := random();
    IF _lucky_roll < _lucky_chance THEN
      _lucky_roll := random();  -- re-roll for reward tier
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
        user_id, source_ref, reward_kind, reward_amount, reward_code, status, granted_at
      ) VALUES (
        _user_id, COALESCE(_ref_table || ':' || COALESCE(_ref_id::text,''), _source_label),
        _lucky_kind, _lucky_amt, _lucky_code, _lucky_status,
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

      -- Cache for idempotency replay
      UPDATE public.xp_transactions
        SET metadata = jsonb_set(metadata, '{cached_lucky_drop}', _lucky_reward)
        WHERE id = _txn_id;
    END IF;
  END IF;

  RETURN QUERY SELECT _txn_id, _new_xp, _new_level, (_new_level > _old_level),
              _base, _combo_after, _combo_mult * _event_mult,
              _perfect_total, _lucky_reward;
END;
$$;

DROP FUNCTION IF EXISTS public.award_xp(uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text);
GRANT EXECUTE ON FUNCTION public.award_xp(
  uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text
) TO authenticated;
```

> Note on the `DROP FUNCTION IF EXISTS` line: the old `award_xp` had identical parameter types but a different RETURN shape. We need to drop the old signature before the new one can take its place. Since we use `CREATE OR REPLACE FUNCTION` with the same param types, Postgres will fail unless the return type also matches. We use `DROP FUNCTION IF EXISTS` first as a safety net; if `CREATE OR REPLACE` succeeds on its own, the DROP is a no-op.

Wait — `CREATE OR REPLACE FUNCTION` in Postgres **requires the same return type** if signature matches. Since we changed RETURN columns, we MUST drop first. Fix the order: `DROP` must come BEFORE `CREATE`. This is corrected in Step 2 below.

- [ ] **Step 2: Fix the order — DROP must precede CREATE**

Edit the migration to put the `DROP FUNCTION IF EXISTS` BEFORE the `CREATE OR REPLACE FUNCTION`. Replace the block:

```sql
CREATE OR REPLACE FUNCTION public.award_xp(
  _user_id         uuid,
  ...
$$;

DROP FUNCTION IF EXISTS public.award_xp(uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text);
GRANT EXECUTE ...
```

with:

```sql
DROP FUNCTION IF EXISTS public.award_xp(uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.award_xp(
  _user_id         uuid,
  ...
$$;

GRANT EXECUTE ON FUNCTION public.award_xp(
  uuid, int, public.app_xp_source, text, text, text, uuid, uuid, jsonb, text
) TO authenticated;
```

- [ ] **Step 3: Verify SQL loads**

If local Supabase is available:
```bash
bunx supabase db reset
```
Expected: completes without error. If `combo_state` / `multiplier_events` / `lucky_drop_log` already exist (from Task 1 running twice), the `IF NOT EXISTS` clauses protect you.

If no local Supabase, skip; the migration is exercised when you push to a linked project.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): rewrite award_xp with combo/multiplier/perfect/lucky

Extends award_xp() to apply: combo multiplier (1x..2x), active event
multiplier (1x..5x), perfect-score bonus (separate txn), and lucky
drop roll (gold/xp/cosmetic/title). All gated by _metadata.outcome.
Negative amounts skip bonuses entirely. Idempotent replays return
cached results without re-rolling lucky drops.

Spec: docs/superpowers/specs/2026-07-20-gamification-engagement-engine-design.md"
```

---

### Task 3: Regenerate Supabase types

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated, not hand-edited)

- [ ] **Step 1: Regenerate types**

Run:
```bash
bunx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

If `--linked` fails or no linked project:
```bash
bunx supabase gen types typescript --local > src/integrations/supabase/types.ts
```

If neither works (no Supabase available), manually append to `src/integrations/supabase/types.ts` in the appropriate sections. Search for existing `XpTransaction` type and add fields; search for `award_xp` RPC return type and replace. The minimal manual additions:

In the `xp_transactions` row type, no schema change needed (we use metadata).
Add new tables to the `Database["public"]["Tables"]` interface: `combo_state`, `multiplier_events`, `lucky_drop_log` — each with their `Row`, `Insert`, `Update`, `Relationships` per the schema in Task 1.
Update the `award_xp` RPC return type if it's typed; otherwise leave (TS code reads it loosely).

- [ ] **Step 2: Typecheck**

Run:
```bash
bun run typecheck
```
Expected: zero errors related to new tables/RPC. Pre-existing errors are acceptable to carry forward.

- [ ] **Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regenerate Supabase types for engagement engine

Adds combo_state, multiplier_events, lucky_drop_log tables and the
new award_xp() return shape."
```

---

### Task 4: Migrate `finalize_quest_from_progress` + `submit_exam` to pass outcome

**Files:**
- Modify: `supabase/migrations/20260720100000_engagement_engine.sql` (append)

These callers already route through `award_xp`. We only need to add `outcome` to their `_metadata` so combo/perfect/lucky logic activates.

- [ ] **Step 1: Append migration section**

Append to `supabase/migrations/20260720100000_engagement_engine.sql`:

```sql
-- =====================================================================
-- 8. Update finalize_quest_from_progress to pass outcome
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finalize_quest_from_progress(_user_id uuid, _quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
```

- [ ] **Step 2: Update `submit_exam` to pass outcome**

The current `submit_exam` lives in `supabase/migrations/20260716090200_exam_student_rpcs.sql`. We append a replacement to our new migration (do not edit the old one — migrations are immutable history).

Append to `supabase/migrations/20260720100000_engagement_engine.sql`:

```sql
-- =====================================================================
-- 9. Update submit_exam to pass outcome
-- =====================================================================
CREATE OR REPLACE FUNCTION public.submit_exam(_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _s RECORD;
  _p RECORD;
  _max int;
  _total int;
  _classroom_name text;
  _outcome text;
  _award RECORD;
BEGIN
  SELECT * INTO _s FROM public.exam_sessions WHERE id = _exam_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'exam not found'; END IF;

  SELECT * INTO _p FROM public.exam_participants
    WHERE exam_id = _exam_id AND user_id = _uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'not a participant'; END IF;
  IF _p.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'already submitted'; END IF;

  SELECT COALESCE(SUM(eq.points), 0) INTO _max
    FROM public.exam_questions eq WHERE eq.exam_id = _exam_id;
  SELECT COALESCE(_p.total_score, 0) INTO _total;

  SELECT c.name INTO _classroom_name FROM public.classrooms c WHERE c.id = _s.classroom_id;

  _outcome := CASE WHEN _max > 0 AND _total >= _max THEN 'perfect'
                   WHEN _total > 0 THEN 'success'
                   ELSE 'fail' END;

  UPDATE public.exam_participants
    SET submitted_at = now(), status = 'submitted'
    WHERE id = _p.id;

  SELECT * INTO _award FROM public.award_xp(
    _user_id := _uid,
    _amount := _total,
    _source := 'exam'::public.app_xp_source,
    _source_label := 'สอบ: ' || _s.title,
    _subject := _classroom_name,
    _ref_table := 'exam_participants',
    _ref_id := _p.id,
    _classroom_id := _s.classroom_id,
    _metadata := jsonb_build_object(
      'exam_id', _exam_id, 'max_score', _max, 'score', _total,
      'violation_count', COALESCE(_p.violation_count, 0),
      'outcome', _outcome
    ),
    _idempotency_key := 'exam_submit:' || _exam_id::text || ':' || _uid::text
  );

  RETURN jsonb_build_object(
    'status','ok',
    'score', _total,
    'max_score', _max,
    'xp_gained', _award.base_amount,
    'total_xp', _award.new_xp,
    'level', _award.new_level,
    'combo_applied', _award.combo_applied,
    'multiplier_applied', _award.multiplier_applied,
    'perfect_bonus', _award.perfect_bonus,
    'lucky_drop', _award.lucky_drop
  );
END;
$$;
```

> Note: the original `submit_exam` reads columns like `total_score`, `violation_count`. Verify those columns exist by searching `supabase/migrations/20260716090000_exam_schema.sql`. If column names differ, adjust accordingly. The structure is: load participant, compute outcome, call `award_xp` with metadata.outcome.

- [ ] **Step 3: Verify column names match**

Run this search to confirm `exam_participants` columns:
```bash
grep -A 30 "CREATE TABLE public.exam_participants" supabase/migrations/20260716090000_exam_schema.sql
```
If `violation_count` or `total_score` is named differently, fix the Step 2 snippet before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): quest + exam callers pass outcome to award_xp

finalize_quest_from_progress and submit_exam now annotate _metadata.outcome
so combos, perfect bonuses, and lucky drops activate. Return payloads
include bonus breakdown for UI rendering."
```

---

### Task 5: Fold `award_submission_grade` trigger into `award_xp`

**Files:**
- Modify: `supabase/migrations/20260720100000_engagement_engine.sql` (append)

- [ ] **Step 1: Read the current trigger body**

Read `supabase/migrations/20260527031735_d8e3e649-5ecf-44f1-83dd-92540e20ab68.sql` lines 1-65 to understand the existing trigger logic and XP formula. Note the formula so we preserve it.

- [ ] **Step 2: Append replacement trigger function**

Append to `supabase/migrations/20260720100000_engagement_engine.sql`:

```sql
-- =====================================================================
-- 10. Migrate award_submission_grade trigger → route via award_xp
-- =====================================================================
CREATE OR REPLACE FUNCTION public.award_submission_grade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _xp int;
  _max_score int;
  _ratio numeric;
  _outcome text;
  _classroom_id uuid;
  _classroom_name text;
  _award RECORD;
BEGIN
  -- Only fire when grade is being recorded
  IF NEW.graded_at IS NULL THEN RETURN NEW; END IF;
  -- Skip re-grades that don't change score (idempotency key handles dupes anyway)
  IF TG_OP = 'UPDATE' AND NEW.score IS NOT DISTINCT FROM OLD.score
     AND NEW.graded_at IS NOT DISTINCT FROM OLD.graded_at THEN
    RETURN NEW;
  END IF;

  _max_score := COALESCE(NEW.max_score, 100);
  IF NEW.score IS NULL THEN RETURN NEW; END IF;

  -- Preserve legacy formula: 1 XP per point scored (capped at max_score)
  _xp := LEAST(COALESCE(NEW.score, 0), _max_score);

  SELECT c.id, c.name INTO _classroom_id, _classroom_name
    FROM public.assignments a
    LEFT JOIN public.classrooms c ON c.id = a.classroom_id
    WHERE a.id = NEW.assignment_id;

  _ratio := NEW.score::numeric / NULLIF(_max_score, 0);
  _outcome := CASE WHEN _ratio >= 1.0 THEN 'perfect'
                   WHEN _ratio >= 0.5 THEN 'success'
                   ELSE 'fail' END;

  SELECT * INTO _award FROM public.award_xp(
    _user_id := NEW.student_id,
    _amount := _xp,
    _source := 'submission'::public.app_xp_source,
    _source_label := 'ส่งงานได้คะแนน',
    _subject := _classroom_name,
    _ref_table := 'submissions',
    _ref_id := NEW.id,
    _classroom_id := _classroom_id,
    _metadata := jsonb_build_object(
      'outcome', _outcome,
      'score', NEW.score,
      'max_score', _max_score,
      'assignment_id', NEW.assignment_id
    ),
    _idempotency_key := 'submission_grade:' || NEW.id::text || ':' || COALESCE(NEW.graded_at::text,'')
  );

  RETURN NEW;
END;
$$;
```

- [ ] **Step 3: Verify the trigger is still wired**

The existing migration `20260527031735...sql` lines 58-61 wires the trigger. We don't need to re-wire. Confirm:
```bash
grep -n "submissions_award_xp" supabase/migrations/*.sql
```
Expected: at least one `CREATE TRIGGER submissions_award_xp` definition in the historical migrations.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): route submission XP through award_xp

award_submission_grade trigger now calls award_xp with source='submission'
and outcome derived from score ratio. Combos + perfect bonus + lucky
drops apply to graded assignments. Idempotency key uses submission id +
graded_at timestamp."
```

---

### Task 6: Fold `award_attendance_checkin` trigger into `award_xp`

**Files:**
- Modify: `supabase/migrations/20260720100000_engagement_engine.sql` (append)

- [ ] **Step 1: Read current trigger body**

Read `supabase/migrations/20260527031735_d8e3e649-5ecf-44f1-83dd-92540e20ab68.sql` lines 65-115 for the attendance formula. Preserve the present/late XP values.

- [ ] **Step 2: Append replacement trigger function**

Append:

```sql
-- =====================================================================
-- 11. Migrate award_attendance_checkin trigger → route via award_xp
-- =====================================================================
CREATE OR REPLACE FUNCTION public.award_attendance_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _xp int;
  _session RECORD;
  _classroom_name text;
  _award RECORD;
BEGIN
  -- Only fire on present/late (skip absent/excused)
  IF NEW.status NOT IN ('present', 'late') THEN RETURN NEW; END IF;
  -- Skip if no status change
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _session FROM public.attendance_sessions WHERE id = NEW.session_id;
  IF _session.id IS NULL THEN RETURN NEW; END IF;

  _xp := CASE WHEN NEW.status = 'present' THEN 20 WHEN NEW.status = 'late' THEN 10 ELSE 0 END;
  IF _xp = 0 THEN RETURN NEW; END IF;

  SELECT c.name INTO _classroom_name FROM public.classrooms c WHERE c.id = _session.classroom_id;

  SELECT * INTO _award FROM public.award_xp(
    _user_id := NEW.student_id,
    _amount := _xp,
    _source := 'attendance'::public.app_xp_source,
    _source_label := CASE WHEN NEW.status = 'present' THEN 'มาเรียนตรงเวลา' ELSE 'มาเรียนสาย' END,
    _subject := _classroom_name,
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

  RETURN NEW;
END;
$$;
```

> Verify the legacy formula by reading the original trigger. The above assumes present=20 XP, late=10 XP — confirm against the original migration and adjust if different.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): route attendance XP through award_xp

award_attendance_checkin trigger now calls award_xp with source='attendance'
and outcome='success'. Combos and lucky drops apply to attendance check-ins.
Re-grades are handled via idempotency key (one row per attendance_record id)."
```

---

### Task 7: Fold `finish_quiz_session` into `award_xp`

**Files:**
- Modify: `supabase/migrations/20260720100000_engagement_engine.sql` (append)

- [ ] **Step 1: Read current `finish_quiz_session` body**

Read `supabase/migrations/20260525171445_527ef7a6-dfd1-4dae-9c24-04978d770877.sql` lines 159-230 to understand the existing top-3 reward logic and column names.

- [ ] **Step 2: Append replacement function**

Append (adjust column names from Step 1 if different):

```sql
-- =====================================================================
-- 12. Migrate finish_quiz_session → route via award_xp
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finish_quiz_session(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session RECORD;
  _classroom_name text;
  _ranked RECORD;
  _rank int := 0;
  _xp int;
  _outcome text;
  _award RECORD;
  _results jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO _session FROM public.quiz_sessions WHERE id = _session_id;
  IF _session.id IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;

  SELECT c.name INTO _classroom_name FROM public.classrooms c WHERE c.id = _session.classroom_id;

  FOR _ranked IN
    SELECT user_id, score,
           ROW_NUMBER() OVER (ORDER BY score DESC) AS rn
      FROM public.quiz_participants
      WHERE session_id = _session_id AND score IS NOT NULL
      ORDER BY score DESC
      LIMIT 3
  LOOP
    _rank := _ranked.rn::int;
    _xp := CASE _rank WHEN 1 THEN 50 WHEN 2 THEN 30 WHEN 3 THEN 20 ELSE 0 END;
    IF _xp = 0 THEN CONTINUE; END IF;

    _outcome := CASE WHEN _rank = 1 THEN 'perfect' ELSE 'success' END;

    SELECT * INTO _award FROM public.award_xp(
      _user_id := _ranked.user_id,
      _amount := _xp,
      _source := 'quiz'::public.app_xp_source,
      _source_label := 'ตอบคำถามรอบ ' || _session.title,
      _subject := _classroom_name,
      _ref_table := 'quiz_participants',
      _ref_id := _ranked.user_id,  -- best available ref; quiz_participants may not have separate id
      _classroom_id := _session.classroom_id,
      _metadata := jsonb_build_object(
        'outcome', _outcome,
        'session_id', _session_id,
        'rank', _rank,
        'score', _ranked.score
      ),
      _idempotency_key := 'quiz_top:' || _session_id::text || ':' || _ranked.user_id::text
    );

    _results := _results || jsonb_build_array(jsonb_build_object(
      'user_id', _ranked.user_id, 'rank', _rank, 'xp', _xp,
      'combo_applied', _award.combo_applied,
      'multiplier_applied', _award.multiplier_applied,
      'lucky_drop', _award.lucky_drop
    ));
  END LOOP;

  RETURN jsonb_build_object('status','ok','results',_results);
END;
$$;
```

- [ ] **Step 3: Verify the `quiz_participants` schema**

Run:
```bash
grep -A 15 "CREATE TABLE public.quiz_participants" supabase/migrations/*.sql | head -25
```
Adjust column names in Step 2 if `user_id`, `score`, `session_id` differ.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): route quiz top-3 rewards through award_xp

finish_quiz_session now calls award_xp per top-3 participant with
source='quiz'. Rank 1 gets outcome='perfect' (eligibility for perfect
bonus), ranks 2-3 get outcome='success'. Idempotency key uses session
id + user id to dedupe re-finishes."
```

---

### Task 8: Create TypeScript types for new return shape + tables

**Files:**
- Create: `src/lib/gamification.types.ts`

- [ ] **Step 1: Write the types file**

Create `src/lib/gamification.types.ts`:

```typescript
// Types for the Engagement Engine gamification layer.
// Mirrors the award_xp() return shape and the new tables added in
// supabase/migrations/20260720100000_engagement_engine.sql

export type AwardOutcome = "success" | "perfect" | "fail" | null;

export interface LuckyDropReward {
  id: string;
  kind: "gold" | "xp" | "cosmetic_voucher" | "rare_title";
  amount: number | null;
  status: "granted" | "pending" | "revoked";
}

/** Return shape of the rewritten award_xp() RPC. */
export interface AwardXpResult {
  transaction_id: string;
  new_xp: number;
  new_level: number;
  leveled_up: boolean;
  base_amount: number;
  combo_applied: number;
  multiplier_applied: number;
  perfect_bonus: number;
  lucky_drop: LuckyDropReward | null;
}

/** Bonus math for UI rendering. */
export interface BonusBreakdown {
  base: number;
  combo_multiplier: number;
  combo_count: number;
  event_multiplier: number;
  event_id: string | null;
  outcome: AwardOutcome;
}

/** combo_state row. */
export interface ComboStateRow {
  user_id: string;
  current_combo: number;
  max_combo: number;
  last_success_at: string | null;
  last_ref_id: string | null;
  updated_at: string;
}

/** multiplier_events row. */
export interface MultiplierEventRow {
  id: string;
  starts_at: string;
  ends_at: string;
  multiplier: number;
  label: string;
  scope: "global" | "classroom";
  classroom_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/** lucky_drop_log row. */
export interface LuckyDropLogRow {
  id: string;
  user_id: string;
  source_ref: string | null;
  reward_kind: "gold" | "xp" | "cosmetic_voucher" | "rare_title";
  reward_amount: number | null;
  reward_code: string | null;
  status: "granted" | "pending" | "revoked";
  granted_at: string | null;
  created_at: string;
}

/** Combo tier metadata for UI styling. */
export interface ComboTier {
  min: number;
  multiplier: number;
  label: string;          // i18n key suffix
  glowClass: string;      // tailwind classes
}

export const COMBO_TIERS: ComboTier[] = [
  { min: 0,  multiplier: 1.0,  label: "warm",   glowClass: "" },
  { min: 3,  multiplier: 1.2,  label: "spark",  glowClass: "text-amber-500" },
  { min: 5,  multiplier: 1.5,  label: "blaze",  glowClass: "text-orange-500" },
  { min: 7,  multiplier: 1.8,  label: "inferno",glowClass: "text-red-500 animate-pulse" },
  { min: 10, multiplier: 2.0,  label: "max",    glowClass: "text-fuchsia-500 animate-pulse" },
];

export function comboTierFor(combo: number): ComboTier {
  let tier = COMBO_TIERS[0];
  for (const t of COMBO_TIERS) {
    if (combo >= t.min) tier = t;
  }
  return tier;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/gamification.types.ts
git commit -m "feat(gamification): add TypeScript types for engagement engine

Mirrors award_xp() return shape, combo_state, multiplier_events,
lucky_drop_log tables. Includes ComboTier styling metadata for UI."
```

---

### Task 9: Create `<ComboBadge>` component

**Files:**
- Create: `src/components/gamification/combo-badge.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/components/gamification/combo-badge.tsx
import { motion, AnimatePresence } from "motion/react";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { comboTierFor } from "@/lib/gamification.types";
import { useTranslation } from "react-i18next";

interface ComboBadgeProps {
  combo: number;
  multiplier?: number;
  className?: string;
  /** Compact mode for inline use (no text label). */
  compact?: boolean;
}

export function ComboBadge({ combo, multiplier, className, compact }: ComboBadgeProps) {
  const { t } = useTranslation();
  const tier = comboTierFor(combo);

  if (combo <= 0) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={combo}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          "bg-card",
          tier.glowClass || "text-muted-foreground",
          tier.min >= 7 && "border-red-300",
          className,
        )}
      >
        <Flame className={cn("h-3.5 w-3.5", tier.min >= 7 && "animate-pulse")} />
        <span>
          {compact
            ? `×${combo}`
            : t(`gamification.combo.tier.${tier.label}`, { count: combo })}
        </span>
        {multiplier && multiplier > 1 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {multiplier.toFixed(2)}×
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Verify file compiles**

```bash
bun run typecheck 2>&1 | grep combo-badge || echo "no errors for combo-badge"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/gamification/combo-badge.tsx
git commit -m "feat(gamification): add ComboBadge component

Animated pill showing combo count + multiplier. Tiers: warm → spark →
blaze → inferno → max. Pulses at tier ≥ 7. Hidden when combo = 0."
```

---

### Task 10: Create `<MultiplierEventBanner>` component

**Files:**
- Create: `src/components/gamification/multiplier-event-banner.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/components/gamification/multiplier-event-banner.tsx
import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { th, enUS } from "date-fns/locale";
import type { MultiplierEventRow } from "@/lib/gamification.types";
import { useTranslation } from "react-i18next";

interface Props {
  event: MultiplierEventRow;
  className?: string;
  /** Persist dismissal in localStorage keyed by event id. */
  dismissible?: boolean;
}

export function MultiplierEventBanner({ event, className, dismissible = true }: Props) {
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const storageKey = `mult-event-dismissed:${event.id}`;

  useEffect(() => {
    if (dismissible && typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    }
  }, [storageKey, dismissible]);

  if (dismissed) return null;

  const locale = i18n.language === "th" ? th : enUS;
  const remaining = formatDistanceToNowStrict(new Date(event.ends_at), { locale });

  const dismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5",
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        <span className="font-medium">{event.label}</span>{" "}
        <span className="text-muted-foreground">
          {t("gamification.multiplier.active", {
            multiplier: event.multiplier.toFixed(2),
            remaining,
          })}
        </span>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.dismiss")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | grep multiplier-event-banner || echo "no errors"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/gamification/multiplier-event-banner.tsx
git commit -m "feat(gamification): add MultiplierEventBanner component

Dismissible banner showing active multiplier event with countdown.
Dismissal persists in localStorage keyed by event id."
```

---

### Task 11: Create `<BonusBreakdown>` component

**Files:**
- Create: `src/components/gamification/bonus-breakdown.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/components/gamification/bonus-breakdown.tsx
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface BonusBreakdownProps {
  base: number;
  comboCount?: number;
  comboMultiplier?: number;
  eventMultiplier?: number;
  perfectBonus?: number;
  luckyGold?: number;
  luckyXp?: number;
  className?: string;
}

export function BonusBreakdown({
  base,
  comboCount = 0,
  comboMultiplier = 1,
  eventMultiplier = 1,
  perfectBonus = 0,
  luckyGold = 0,
  luckyXp = 0,
  className,
}: BonusBreakdownProps) {
  const { t } = useTranslation();
  const total = Math.round(base * comboMultiplier * eventMultiplier) + perfectBonus + luckyXp;

  return (
    <div className={cn("rounded-md border bg-muted/30 p-3 text-sm", className)}>
      <div className="mb-1 font-medium">{t("gamification.breakdown.title")}</div>
      <div className="space-y-0.5 text-muted-foreground">
        <Row label={t("gamification.breakdown.base")} value={`+${base}`} />
        {comboMultiplier > 1 && (
          <Row
            label={t("gamification.breakdown.combo", { count: comboCount })}
            value={`×${comboMultiplier.toFixed(2)}`}
          />
        )}
        {eventMultiplier > 1 && (
          <Row
            label={t("gamification.breakdown.event")}
            value={`×${eventMultiplier.toFixed(2)}`}
          />
        )}
        {perfectBonus > 0 && (
          <Row
            label={t("gamification.breakdown.perfect")}
            value={`+${perfectBonus}`}
            highlight
          />
        )}
        {luckyXp > 0 && (
          <Row
            label={t("gamification.breakdown.luckyXp")}
            value={`+${luckyXp}`}
            highlight
          />
        )}
        {luckyGold > 0 && (
          <Row
            label={t("gamification.breakdown.luckyGold")}
            value={`+${luckyGold}`}
            highlight
          />
        )}
      </div>
      <div className="mt-2 border-t pt-2 font-semibold">
        {t("gamification.breakdown.total")}: +{total} XP
        {(luckyGold > 0) && ` +${luckyGold} 🪙`}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("flex justify-between", highlight && "text-primary font-medium")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | grep bonus-breakdown || echo "no errors"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/gamification/bonus-breakdown.tsx
git commit -m "feat(gamification): add BonusBreakdown component

Shows the math: base × combo × event + perfect + lucky. Used on quest
result, exam report, and quiz scoreboard to make rewards legible."
```

---

### Task 12: Create `<LuckyDropToast>` helper

**Files:**
- Create: `src/components/gamification/lucky-drop-toast.tsx`

- [ ] **Step 1: Write the helper**

```typescript
// src/components/gamification/lucky-drop-toast.tsx
import { toast } from "sonner";
import { Sparkles, Coins, Gift, Crown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LuckyDropReward } from "@/lib/gamification.types";

/** Fire a toast for a lucky drop. Call from any mutation's onSuccess. */
export function announceLuckyDrop(drop: LuckyDropReward | null | undefined) {
  if (!drop) return;
  // t cannot be used outside component; static strings are fine for sonner.
  const cfg = {
    gold: { icon: Coins, color: "text-amber-500", msg: `ลากรับโชค! +${drop.amount} 🪙` },
    xp: { icon: Sparkles, color: "text-blue-500", msg: `ลากรับโชค! +${drop.amount} XP` },
    cosmetic_voucher: { icon: Gift, color: "text-fuchsia-500", msg: "ลากรับโชค! ได้ Voucher (เปิดใช้ในเร็ว ๆ นี้)" },
    rare_title: { icon: Crown, color: "text-yellow-500", msg: "ลากรับโชค! ได้ฉายาหายาก! (เปิดใช้ในเร็ว ๆ นี้)" },
  }[drop.kind];

  const Icon = cfg.icon;
  toast(cfg.msg, {
    icon: <Icon className={`h-4 w-4 ${cfg.color}`} />,
    duration: drop.kind === "rare_title" || drop.kind === "cosmetic_voucher" ? 6000 : 4000,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | grep lucky-drop-toast || echo "no errors"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/gamification/lucky-drop-toast.tsx
git commit -m "feat(gamification): add LuckyDropToast helper

sonner-based toast announcing lucky drops. Static Thai strings (sonner
fires outside React tree). Rare drops stay visible 6s, others 4s."
```

---

### Task 13: Wire bonus breakdown into quest result page

**Files:**
- Modify: `src/routes/_authenticated/quests.tsx`

- [ ] **Step 1: Read the existing quest finalization path**

Read `src/routes/_authenticated/quests.tsx` around lines 320-420 (the `finalizePartial` and full submit paths). Identify where the RPC response is consumed and where the result UI is rendered.

- [ ] **Step 2: Capture the bonus fields from RPC response**

The RPC `award_quest_attempt` returns `finalize_quest_from_progress`'s payload. In Task 4 we added `combo_applied`, `multiplier_applied`, `perfect_bonus`, `lucky_drop` to that payload. Find the spot where `xp_gained` / `total_xp` are read from the response and add:

```typescript
// After existing destructuring of the RPC response
const comboApplied = result.combo_applied ?? 0;
const multiplierApplied = result.multiplier_applied ?? 1;
const perfectBonus = result.perfect_bonus ?? 0;
const luckyDrop = result.lucky_drop;
```

- [ ] **Step 3: Render breakdown + lucky toast in the result view**

In the result screen (after the existing "ได้รับ XP" message), add:

```tsx
<BonusBreakdown
  base={xpGained}
  comboCount={comboApplied}
  comboMultiplier={multiplierApplied}
  perfectBonus={perfectBonus}
  luckyXp={luckyDrop?.kind === "xp" ? (luckyDrop.amount ?? 0) : 0}
  luckyGold={luckyDrop?.kind === "gold" ? (luckyDrop.amount ?? 0) : 0}
/>
<ComboBadge combo={comboApplied} multiplier={multiplierApplied} />
```

Add imports at top of file:
```typescript
import { BonusBreakdown } from "@/components/gamification/bonus-breakdown";
import { ComboBadge } from "@/components/gamification/combo-badge";
import { announceLuckyDrop } from "@/components/gamification/lucky-drop-toast";
```

After setting the result state, fire the lucky toast:
```typescript
if (luckyDrop) announceLuckyDrop(luckyDrop);
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck 2>&1 | grep quests.tsx | head -20
```
Fix any errors. Common gotcha: the existing code may use `(supabase.rpc as any)(...)` so types are loose — that's fine, our destructuring with `?? 0` is safe.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/quests.tsx
git commit -m "feat(gamification): show bonus breakdown + combo on quest result

Reads combo_applied/multiplier_applied/perfect_bonus/lucky_drop from
the finalize_quest_from_progress payload and renders BonusBreakdown +
ComboBadge. Fires lucky drop toast when applicable."
```

---

### Task 14: Wire bonus breakdown into exam report

**Files:**
- Modify: `src/routes/_authenticated/exam.$examId.report.tsx`

- [ ] **Step 1: Read the exam report page**

Read `src/routes/_authenticated/exam.$examId.report.tsx` to find where the exam submission result is displayed (the score / XP / level section).

- [ ] **Step 2: Add the same wiring as Task 13**

If the exam submission RPC (`submit_exam`) was called from this page (vs. from the take-exam page), capture the bonus fields here. If it was called from `exam.$examId.tsx` (take-exam page), the bonus payload needs to be passed via route state or refetched.

Check where `submit_exam` is invoked:

```bash
grep -n "submit_exam" src/routes/_authenticated/exam.*.tsx
```

Then add the same destructuring + `<BonusBreakdown>` + `<ComboBadge>` + `announceLuckyDrop` in whichever page renders the post-exam summary.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep exam | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/exam.*.tsx
git commit -m "feat(gamification): show bonus breakdown on exam result

Reads bonus fields from submit_exam payload and renders BonusBreakdown +
ComboBadge. Fires lucky drop toast when applicable."
```

---

### Task 15: Add combo + event banner to dashboard panel

**Files:**
- Modify: `src/components/gamification-status-panel.tsx`

- [ ] **Step 1: Read the current panel**

Read `src/components/gamification-status-panel.tsx` to understand its structure (level ring, stats, mission board).

- [ ] **Step 2: Add combo state query + display**

Near the existing queries in the component, add:

```typescript
const { data: comboState } = useQuery({
  queryKey: ["combo-state"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("combo_state")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  refetchInterval: 30_000,  // refresh combo decay
});

const { data: activeEvent } = useQuery({
  queryKey: ["active-multiplier-event"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("multiplier_events")
      .select("*")
      .eq("is_active", true)
      .gte("ends_at", new Date().toISOString())
      .order("multiplier", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  refetchInterval: 60_000,
});
```

Add at the top of the panel render:
```tsx
{activeEvent && <MultiplierEventBanner event={activeEvent} className="mb-3" />}
{comboState && comboState.current_combo > 0 && (
  <div className="mb-3 flex items-center gap-2">
    <ComboBadge combo={comboState.current_combo} />
    {comboState.max_combo > comboState.current_combo && (
      <span className="text-xs text-muted-foreground">
        สูงสุด: ×{comboState.max_combo}
      </span>
    )}
  </div>
)}
```

Imports to add:
```typescript
import { useQuery } from "@tanstack/react-query";
import { ComboBadge } from "@/components/gamification/combo-badge";
import { MultiplierEventBanner } from "@/components/gamification/multiplier-event-banner";
import { supabase } from "@/integrations/supabase/client";
```

> If `userId` isn't already in scope, derive it from the auth hook (`useAuth().user.id`).

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep gamification-status-panel | head
```

- [ ] **Step 4: Commit**

```bash
git add src/components/gamification-status-panel.tsx
git commit -m "feat(gamification): show combo + multiplier event on dashboard

Adds combo_state query (30s refresh) and active multiplier_events query
(60s refresh). Renders MultiplierEventBanner (dismissible) and ComboBadge
at the top of the Weekly Pulse panel."
```

---

### Task 16: Add "กิจกรรม" (Events) tab to Rewards page

**Files:**
- Modify: `src/routes/_authenticated/rewards.tsx`

- [ ] **Step 1: Read the rewards page tab structure**

Read `src/routes/_authenticated/rewards.tsx` to find the existing `<Tabs>` / `<TabsList>` / `<TabsTrigger>` block.

- [ ] **Step 2: Add a new tab for events + recent lucky drops**

Add a new `<TabsTrigger value="events">กิจกรรม</TabsTrigger>` and corresponding `<TabsContent value="events">` showing:
- Upcoming + past multiplier events (last 30 days)
- Lucky drop history (last 30 entries from `lucky_drop_log`)

```tsx
<TabsContent value="events">
  <div className="space-y-4">
    <h3 className="text-lg font-semibold">กิจกรรมพิเศษ</h3>
    <MultiplierEventsList />
    <h3 className="text-lg font-semibold pt-4">ประวัติลากรับโชค</h3>
    <LuckyDropHistory />
  </div>
</TabsContent>
```

Implement the two small components inline in the same file (or split if they grow):

```tsx
function MultiplierEventsList() {
  const { data } = useQuery({
    queryKey: ["multiplier-events-history"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await supabase
        .from("multiplier_events")
        .select("*")
        .gte("starts_at", since.toISOString())
        .order("starts_at", { ascending: false });
      return data ?? [];
    },
  });
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่มีกิจกรรม</p>;
  }
  return (
    <div className="space-y-2">
      {data.map((e) => (
        <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
          <div>
            <div className="font-medium">{e.label}</div>
            <div className="text-xs text-muted-foreground">
              {new Date(e.starts_at).toLocaleString("th-TH")} —{" "}
              {new Date(e.ends_at).toLocaleString("th-TH")}
            </div>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            ×{Number(e.multiplier).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LuckyDropHistory() {
  const { data } = useQuery({
    queryKey: ["lucky-drop-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("lucky_drop_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่เคยลากได้อะไร — ไปทำควอสต์ก่อน!</p>;
  }
  return (
    <div className="space-y-1">
      {data.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-muted/50">
          <span>
            {d.reward_kind === "gold" && `🪙 +${d.reward_amount} ทอง`}
            {d.reward_kind === "xp" && `✨ +${d.reward_amount} XP`}
            {d.reward_kind === "cosmetic_voucher" && `🎁 Voucher (รอเปิดใช้)`}
            {d.reward_kind === "rare_title" && `👑 ฉายาหายาก (รอเปิดใช้)`}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(d.created_at).toLocaleString("th-TH")}
          </span>
        </div>
      ))}
    </div>
  );
}
```

Imports: `useQuery` from `@tanstack/react-query`, `supabase` from `@/integrations/supabase/client`.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep rewards.tsx | head
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/rewards.tsx
git commit -m "feat(gamification): add Events tab to Rewards page

Shows past 30 days of multiplier events and last 30 lucky drops.
Pending cosmetic/title drops display 'รอเปิดใช้' until Phase 3
redemption UI ships."
```

---

### Task 17: Admin page for multiplier events

**Files:**
- Create: `src/routes/_authenticated/admin/multiplier-events.tsx`
- Modify: `src/components/app-sidebar.tsx` (add nav entry)

- [ ] **Step 1: Create the admin page**

```typescript
// src/routes/_authenticated/admin/multiplier-events.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export const Route = createFileRoute("/_authenticated/admin/multiplier-events")();

export default function AdminMultiplierEventsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    label: "ชั่วโมงพิเศษ!",
    multiplier: "2.00",
    startsAt: "",
    endsAt: "",
  });

  const { data: events } = useQuery({
    queryKey: ["admin-multiplier-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("multiplier_events")
        .select("*")
        .order("starts_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("multiplier_events").insert({
        label: form.label,
        multiplier: parseFloat(form.multiplier),
        starts_at: new Date(form.startsAt).toISOString(),
        ends_at: new Date(form.endsAt).toISOString(),
        scope: "global",
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "สร้างกิจกรรมสำเร็จ" });
      qc.invalidateQueries({ queryKey: ["admin-multiplier-events"] });
      qc.invalidateQueries({ queryKey: ["active-multiplier-event"] });
    },
    onError: (e) => toast({ title: "ผิดพลาด", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-6">
      <h1 className="text-2xl font-bold">จัดการกิจกรรม XP ×</h1>

      <Card>
        <CardHeader>
          <CardTitle>สร้างกิจกรรมใหม่</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>ชื่อกิจกรรม</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>เริ่ม</Label>
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </div>
            <div>
              <Label>สิ้นสุด</Label>
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>ตัวคูณ (1.00 - 5.00)</Label>
            <Input
              type="number"
              step="0.25"
              min="1"
              max="5"
              value={form.multiplier}
              onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
            />
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.startsAt || !form.endsAt || createMutation.isPending}
          >
            สร้าง
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>กิจกรรมล่าสุด</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {events?.map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b pb-2 text-sm">
                <div>
                  <div className="font-medium">{e.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.starts_at).toLocaleString("th-TH")} —{" "}
                    {new Date(e.ends_at).toLocaleString("th-TH")}
                  </div>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  ×{Number(e.multiplier).toFixed(2)}
                </span>
              </div>
            ))}
            {events?.length === 0 && (
              <p className="text-sm text-muted-foreground">ยังไม่มีกิจกรรม</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

> Verify the path of `useToast` hook: search for `use-toast` in `src/hooks/`. If it's named differently (e.g. `use-sonner`), adjust import.

- [ ] **Step 2: Add nav entry to sidebar**

In `src/components/app-sidebar.tsx`, find the admin section (search for `admin/users` or similar) and add:

```typescript
{
  title: "กิจกรรม XP",
  href: "/admin/multiplier-events",
  icon: Sparkles,
},
```

Add the import: `import { Sparkles } from "lucide-react";` (likely already present).

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep "multiplier-events\|app-sidebar" | head
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/admin/multiplier-events.tsx src/components/app-sidebar.tsx
git commit -m "feat(gamification): admin page for multiplier events

Admins can create and view XP multiplier events. Form: label, start,
end, multiplier (1-5x). Nav entry added under admin section."
```

---

### Task 18: Auto-spawn weekly multiplier edge function

**Files:**
- Create: `supabase/functions/spawn-weekly-multiplier/index.ts`

- [ ] **Step 1: Read an existing edge function for the pattern**

Read `supabase/functions/personal-tutor/index.ts` (or any existing function) to learn the Deno + Supabase client pattern this project uses.

- [ ] **Step 2: Write the function**

```typescript
// supabase/functions/spawn-weekly-multiplier/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function bangkokDate(d: Date): Date {
  // shift UTC to Bangkok (UTC+7) for "what day is it locally" decisions
  return new Date(d.getTime() + 7 * 60 * 60 * 1000);
}

function randomWeekdayHour(): { startsAt: Date; endsAt: Date } {
  const now = new Date();
  const bkNow = bangkokDate(now);
  // pick a random day in the next 7 days, Monday-Friday only
  let offset = 1 + Math.floor(Math.random() * 7);
  let candidate = new Date(bkNow);
  candidate.setDate(candidate.getDate() + offset);
  // retry until weekday
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    offset = 1 + Math.floor(Math.random() * 7);
    candidate = new Date(bkNow);
    candidate.setDate(candidate.getDate() + offset);
  }
  // random hour 12:00-17:00 Bangkok time, 1-hour duration
  const hour = 12 + Math.floor(Math.random() * 5);
  candidate.setUTCHours(hour - 7, 0, 0, 0); // convert back to UTC
  const endsAt = new Date(candidate.getTime() + 60 * 60 * 1000);
  return { startsAt: candidate, endsAt };
}

Deno.serve(async () => {
  // Skip if an event already exists in the upcoming 7 days
  const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { data: existing } = await supabase
    .from("multiplier_events")
    .select("id")
    .gte("starts_at", new Date().toISOString())
    .lte("starts_at", weekAhead.toISOString())
    .eq("is_active", true);

  if (existing && existing.length > 0) {
    return new Response(JSON.stringify({ skipped: "event already scheduled" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { startsAt, endsAt } = randomWeekdayHour();
  const { error } = await supabase.from("multiplier_events").insert({
    label: "ชั่วโมงพิเศษ!",
    multiplier: 2.0,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    scope: "global",
    is_active: true,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 50% chance: spawn a smaller midweek 1.5×/30-min event
  if (Math.random() < 0.5) {
    const midStart = new Date(startsAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const midEnd = new Date(midStart.getTime() + 30 * 60 * 1000);
    await supabase.from("multiplier_events").insert({
      label: "ฮอต 30 นาที!",
      multiplier: 1.5,
      starts_at: midStart.toISOString(),
      ends_at: midEnd.toISOString(),
      scope: "global",
      is_active: true,
    });
  }

  return new Response(JSON.stringify({ spawned: true, starts_at: startsAt.toISOString() }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 3: Schedule via Supabase cron (manual SQL)**

Document in the migration's comments (no code change) that this function should be called by Supabase's scheduled functions / pg_cron weekly. Add a comment block at the end of the migration:

Append to `supabase/migrations/20260720100000_engagement_engine.sql`:

```sql
-- =====================================================================
-- 13. Scheduling note: weekly auto-spawn of multiplier event
-- =====================================================================
-- The edge function `spawn-weekly-multiplier` should be invoked weekly
-- via Supabase's scheduled functions dashboard (UI) or pg_cron:
--
--   SELECT cron.schedule(
--     'spawn-multiplier-weekly',
--     '0 6 * * 1',                              -- every Monday 06:00 UTC = 13:00 Bangkok
--     $$SELECT net.http_post(
--       url := 'https://<project>.functions.supabase.co/spawn-weekly-multiplier',
--       headers := jsonb_build_object('Content-Type', 'application/json'),
--       body := '{}'::jsonb
--     )$$
--   );
--
-- This is intentionally NOT executed in the migration because pg_cron +
-- pg_net extension availability varies per Supabase plan. Configure via
-- dashboard → Database → Cron schedules after deploying this migration.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/spawn-weekly-multiplier/index.ts supabase/migrations/20260720100000_engagement_engine.sql
git commit -m "feat(gamification): weekly auto-spawn multiplier event edge function

Deno function: idempotent weekly spawner. Picks a random weekday
(Mon-Fri) + random 12:00-17:00 Bangkok hour, 1-hour 2× event. 50%
chance to add a 30-min 1.5× midweek boost. Scheduling instructions
documented in migration comments (requires pg_cron + pg_net or the
Supabase scheduled-functions dashboard)."
```

---

### Task 19: i18n strings + final build verification

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Add Thai + English strings**

In `src/i18n.ts`, search for an existing top-level key (e.g. `"common"`) and add a new `gamification` section to both `th` and `en` translation objects:

```typescript
gamification: {
  combo: {
    tier: {
      warm: "combo {{count}}",
      spark: "combo {{count}} 🔥",
      blaze: " combo {{count}} 🔥🔥",
      inferno: "INFERNO ×{{count}}",
      max: "MAX ×{{count}}",
    },
  },
  multiplier: {
    active: "XP ×{{multiplier}} อีก {{remaining}}",
  },
  breakdown: {
    title: "รายละเอียดโบนัส",
    base: "พื้นฐาน",
    combo: "combo ×{{count}}",
    event: "กิจกรรม",
    perfect: "โบนัสคะแนนเต็ม",
    luckyXp: "ลากได้ XP",
    luckyGold: "ลากได้ทอง",
    total: "รวม",
  },
},
```

For English, add the equivalent section with English strings:
```typescript
gamification: {
  combo: {
    tier: {
      warm: "combo {{count}}",
      spark: "combo {{count}} 🔥",
      blaze: "combo {{count}} 🔥🔥",
      inferno: "INFERNO ×{{count}}",
      max: "MAX ×{{count}}",
    },
  },
  multiplier: {
    active: "XP ×{{multiplier}} for {{remaining}} more",
  },
  breakdown: {
    title: "Bonus breakdown",
    base: "Base",
    combo: "combo ×{{count}}",
    event: "event",
    perfect: "Perfect bonus",
    luckyXp: "Lucky XP",
    luckyGold: "Lucky gold",
    total: "Total",
  },
},
```

Also add a `common.dismiss` entry to both languages:
```typescript
// th
common: { ..., dismiss: "ปิด" }
// en
common: { ..., dismiss: "Dismiss" }
```

- [ ] **Step 2: Typecheck everything**

```bash
bun run typecheck
```
Expected: ideally zero new errors. Pre-existing errors remain acceptable but should not grow.

- [ ] **Step 3: Build**

```bash
bun run build
```
Expected: completes successfully.

- [ ] **Step 4: Run project health check**

```bash
bun run check
```
Expected: completes without new errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(gamification): add Thai + English i18n strings

Strings for combo tiers, multiplier banner, bonus breakdown. Both th
and en locales updated. Final build verification passes."
```

- [ ] **Step 6: Manual smoke test checklist**

After deploying to a preview environment, verify end-to-end:

1. **Daily quest with perfect score** → see BonusBreakdown with combo + perfect + possibly lucky
2. **Daily quest with wrong answer** → combo resets, no perfect bonus
3. **Submit assignment as teacher** (triggers `award_submission_grade`) → student sees XP increase; if graded perfect, see combo +1
4. **Attendance check-in** → student sees XP gain + combo +1
5. **Quiz finish** → top-3 participants see XP with outcome
6. **Wait 31+ minutes between two quests** → combo resets
7. **Admin creates a multiplier event covering "now"** → next submission is multiplied; banner appears on dashboard
8. **Dismiss multiplier banner** → stays dismissed after page reload
9. **Verify ledger integrity**:
   ```sql
   SELECT p.id, p.xp, SUM(t.amount) AS ledger_sum
   FROM profiles p
   JOIN xp_transactions t ON t.user_id = p.id
   GROUP BY p.id, p.xp
   HAVING p.xp <> SUM(t.amount);
   ```
   Expected: zero rows. (This is the critical invariant.)

- [ ] **Step 7: Tag release**

```bash
git tag -a gamification-phase-1 -m "Phase 1: Engagement Engine — combos, multipliers, perfect bonuses, lucky drops"
```

---

## Self-review notes (post-write)

**Spec coverage:**
- §3 architecture → Tasks 1-7 (DB) + 8-12 (UI components)
- §4 data model → Task 1 (tables + enum + helper)
- §5 award_xp signature → Task 2
- §6 caller migrations → Tasks 4-7
- §7 frontend integration → Tasks 9-16
- §8 auto-spawn → Task 18
- §9 edge cases → handled in Task 2's algorithm (negative amounts, idempotency, day rollover, race via FOR UPDATE)
- §10 testing → verification steps in each task + Task 19 Step 6 smoke checklist
- §11 migration plan → all steps consolidated in single migration file (Task 1, appended by Tasks 2, 4, 5, 6, 7, 18)

**Placeholder scan:** None — every step has runnable code.

**Type consistency:** `AwardXpResult`, `LuckyDropReward`, `ComboTier`, `MultiplierEventRow`, `ComboStateRow`, `LuckyDropLogRow` all defined in Task 8 and referenced consistently.

**Open risks:**
- Trigger folding (Tasks 5-7) changes long-standing behavior. If something breaks, the smoke test in Task 19 Step 9 (ledger integrity query) catches it.
- The `(supabase.rpc as any)(...)` pattern in TS means some call sites won't type-check the new return fields. The `?? 0` defaults protect against that.
- pg_cron / pg_net availability is Supabase-plan-dependent. Task 18 documents both options.
