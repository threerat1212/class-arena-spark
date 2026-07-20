# Gamification — Phase 1: Engagement Engine

**Date:** 2026-07-20
**Status:** Approved (design)
**Author:** brainstorm session (engagement-first approach)
**Related:** `docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md` (foundation)

---

## 1. Problem & Goal

### Problem

Today the reward loop is **linear and flat**:

> do action → `+amount XP` → accumulate → level up → repeat

There is no **variance**, no **surprise**, no **bonus for excellence**. A perfect quiz and a barely-passing quiz award the same per-action XP (only the score differs). The user feedback: _"ตอนนี้มันขาด gimmicks ที่ทำให้แต่ละครั้งรู้สึกพิเศษ มีแค่ขยัน→ได้ XP+ทอง"._

### Goal (Phase 1)

Make **every XP-granting action feel different** by adding:

1. **Combo system** — consecutive correct answers stack a multiplier
2. **Perfect-score bonus** — excellence gets rewarded on top of the score
3. **Multiplier events** — global "double-XP hour" windows
4. **Lucky drops** — small random bonus after a successful action

All four flow through the **existing central funnel**: `award_xp()` RPC + `xp_transactions` ledger + `app_xp_source` enum. No parallel reward paths are introduced. This matches the PRODUCT.md design ethos ("calm gamification, no flashy noise").

### Non-goals (deferred to Phase 2/3)

- Daily challenge rotation, mission chains (Phase 2)
- Streak freeze, comeback bonus, milestone rewards (Phase 2)
- Cosmetic catalog, loot box, rare title drops (Phase 3)
- PvP / arena / houses (separate brainstorm)

---

## 2. Design constraints (locked)

These constraints come from the codebase survey and cannot be relaxed:

| #   | Constraint                                    | Why                                                                                            |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| C1  | All rewards flow through `award_xp()`         | Single source of truth, idempotent, RLS-safe. Spec: `2026-07-15-xp-activity-ledger-design.md`. |
| C2  | Additive signature change only (named params) | All 6 internal SQL callers use named parameters. Renames/reorders would break them.            |
| C3  | `xp_transactions` is append-only              | Ledger integrity. We never UPDATE rows; combo state lives elsewhere.                           |
| C4  | Idempotency keys must remain stable           | Existing keys like `quest_finalize:<uid>:<qid>` must still dedupe.                             |
| C5  | `SECURITY DEFINER` only — no client writes    | Clients cannot mint XP. All multipliers computed server-side.                                  |
| C6  | Stay "calm" per PRODUCT.md                    | No neon UI, no mandatory popups; opt-in animations, dismissible toasts.                        |

---

## 3. Architecture overview

```
                    ┌─────────────────────────────────────────┐
                    │              Triggers / RPCs            │
                    │  (quest, exam, mission, attendance,     │
                    │   submission, quiz, achievement, …)     │
                    └───────────────────┬─────────────────────┘
                                        │  all call award_xp()
                                        ▼
   ┌─────────────────┐         ┌──────────────────────────┐         ┌────────────────┐
   │  combo_state    │◄────────│        award_xp()        │────────►│ xp_transactions│
   │  (per user)     │  read/  │   applies multipliers:   │ append  │   (ledger)     │
   │                 │  write  │   base × combo × event   │         │                │
   └─────────────────┘         └──────────┬───────────────┘         └────────────────┘
                                            │ metadata.bonus_breakdown
                                            ▼
   ┌─────────────────┐         ┌──────────────────────────┐
   │ multiplier_     │◄────────│   lucky_drop (post-hoc)  │
   │   events        │  read   │   roll inside award_xp   │
   └─────────────────┘         └──────────────────────────┘
                                            │
                                            ▼
                                    bonus row in xp_transactions
                                    (separate source: 'lucky_drop')
```

**Key principle:** `award_xp()` becomes a _smart_ function. It computes the final amount from `base × combo_multiplier × event_multiplier + perfect_bonus`, then optionally rolls a lucky drop. The single `xp_transactions` row records the **base amount** in `amount`; the breakdown lives in `metadata.bonus_breakdown` so the ledger stays sum-correct (no double counting) but the UI can show "base 50 + combo 1.5× + perfect 25 = 100".

Wait — re-examining: if `amount` is the base and breakdown is in metadata, then `SUM(amount)` under-counts what the user actually received. That breaks `profiles.xp` reconciliation. **Decision:** `amount` = **total applied** (after all multipliers and bonuses). `metadata.base_amount` = original. The ledger sum always equals the actual XP granted. This keeps the invariant `profiles.xp = SUM(xp_transactions.amount WHERE user_id)` intact.

---

## 4. Data model

### 4.1 New table: `combo_state`

Per-user, per-session combo tracking. A "session" is bounded by either (a) the same `ref_id` (e.g. one exam, one quest) or (b) a 30-minute inactivity window. We track at the **user level** because combos cross actions within a study session.

```sql
CREATE TABLE public.combo_state (
  user_id          uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_combo    int  NOT NULL DEFAULT 0,        -- consecutive-success count
  max_combo        int  NOT NULL DEFAULT 0,        -- lifetime best
  last_success_at  timestamptz,                    -- for decay detection
  last_ref_id      uuid,                           -- break combo on ref change? (see §4.4)
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.combo_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "combo_state read own or admin"
  ON public.combo_state FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.combo_state TO authenticated;
-- No INSERT/UPDATE/DELETE policy; only award_xp (SECURITY DEFINER) mutates it.
```

**Why per-user, not per-session?** Duolingo-style combos persist across lessons within a day. For Scholar Hall we want "I answered 5 questions right in a row across my morning quest + afternoon quiz" to feel connected. Decay window (§4.3) prevents stale inflation.

### 4.2 New table: `multiplier_events`

Admin-defined or auto-spawned global XP windows.

```sql
CREATE TABLE public.multiplier_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  multiplier  numeric(3,2) NOT NULL DEFAULT 2.00,  -- 1.00 = none, 2.00 = double, etc.
  label       text NOT NULL DEFAULT 'Double XP Hour',  -- shown in UI
  scope       text NOT NULL DEFAULT 'global',           -- reserved: 'global' | 'classroom' (future)
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE CASCADE,  -- NULL when global
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (multiplier >= 1.00 AND multiplier <= 5.00)
);

CREATE INDEX idx_mult_events_active_window
  ON public.multiplier_events (starts_at, ends_at)
  WHERE is_active = true;

ALTER TABLE public.multiplier_events ENABLE ROW LEVEL SECURITY;
-- Everyone can read (to see active events in UI)
CREATE POLICY "multiplier_events read all"
  ON public.multiplier_events FOR SELECT TO authenticated USING (true);
-- Only admins can write
CREATE POLICY "multiplier_events write admin"
  ON public.multiplier_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.multiplier_events TO authenticated;
```

### 4.3 `app_xp_source` enum — new values

```sql
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'lucky_drop';
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'perfect_bonus';
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'submission';     -- newly attributed (Phase 1 cleanup)
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'quiz';           -- newly attributed (Phase 1 cleanup)
-- 'combo_bonus' intentionally NOT added: combo is folded into the base row's
-- amount + recorded in metadata, not as a separate transaction. Keeping the
-- ledger row count = action count makes reconciliation trivial.
-- (Phase 1 also retro-attributes submissions and quiz-top-3 rewards to their
--  own enum values instead of reusing 'daily_quest'.)
```

> **Phase 1 scope:** multiplier events are **global only**. The `classroom_id` column exists in the schema for future use (see §13 O1) but every Phase 1 row will have `classroom_id = NULL`.

> Why separate transactions for `lucky_drop` and `perfect_bonus` but not `combo`?
>
> - **Lucky drop** is stochastic and post-hoc — it happens _after_ the action resolves. Separate row lets us revoke it independently (admin adjustment) and clearly attribute it.
> - **Perfect bonus** is also conceptually separate from "you did the action" — it's an excellence reward. Separating it lets the UI highlight "🎯 +25 perfect bonus!" distinctly.
> - **Combo** is intrinsic to the action — it's how we value _this_ action, not a side reward. Folding it into the same row keeps the per-action granularity clean.

### 4.4 Combo decay rules

A combo is **broken** (resets to 0) when:

| Trigger                                    | Action                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| Action succeeds (correct/perfect)          | `current_combo += 1`, then update `max_combo` if exceeded |
| Action fails (wrong answer / failed quest) | `current_combo := 0`                                      |
| 30 minutes pass since `last_success_at`    | `current_combo := 0` (computed lazily on next read)       |
| Calendar day changes (Asia/Bangkok)        | `current_combo := 0` (computed lazily)                    |

**Scoping:** Combo **does NOT break on `ref_id` change**. Rationale: a student doing their morning daily quest, then immediately doing a 5-question quiz, should keep the streak alive — that's the engagement we want to reward. The 30-min decay handles "left the app" naturally.

**Which actions count?** Only actions that pass `_metadata.outcome = 'success' | 'perfect' | 'fail'`. The caller decides the outcome:

- Daily quest: `perfect` if score == max, `success` if score > 0, `fail` if score == 0
- Exam: same logic on per-exam score
- Quiz: per-question outcome (the quiz loop calls `award_xp` once per answered batch)
- Attendance check-in: `success` (no concept of perfect/fail)
- Mission close: no combo impact (bulk, async)
- Achievement claim: no combo impact (one-shot)
- Submission grade: `success` if score >= 50%, `fail` if < 50%

The outcome is **always passed by the caller in `_metadata`**, never guessed by `award_xp`. This keeps `award_xp` dumb about domain semantics.

### 4.5 Combo multiplier curve

Capped, sub-linear, design for "feel" not for inflation:

| Combo | Multiplier  |
| ----- | ----------- |
| 1-2   | 1.00×       |
| 3-4   | 1.20×       |
| 5-6   | 1.50×       |
| 7-9   | 1.80×       |
| 10+   | 2.00× (cap) |

Curve is a SQL function so it can be tuned without redeploying RPC logic.

```sql
CREATE OR REPLACE FUNCTION public.combo_multiplier(combo int)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN combo >= 10 THEN 2.00
    WHEN combo >= 7  THEN 1.80
    WHEN combo >= 5  THEN 1.50
    WHEN combo >= 3  THEN 1.20
    ELSE 1.00
  END;
$$;
```

### 4.6 Perfect bonus formula

When `_metadata.outcome = 'perfect'`, an **additive** bonus is added (separate transaction):

```
perfect_bonus = floor(base_amount × 0.50)   -- 50% of base, floored
```

Capped at +100 XP per action to avoid runaway on big exam submissions.

### 4.7 Lucky drop roll

After every successful action (outcome in `success`, `perfect`), `award_xp` rolls:

- **P(lucky) = 8%** base chance
- Modifiers: +2% per combo above 5 (capped at +10%) → max 18%
- Drop table (rolled if hit):

| Roll | Reward                          | Notes                                  |
| ---- | ------------------------------- | -------------------------------------- |
| 60%  | +10 gold                        | small treat                            |
| 25%  | +25 XP                          | mid reward                             |
| 10%  | +50 XP                          | big reward                             |
| 4%   | cosmetic voucher (Phase 3 stub) | recorded as metadata; redeemable later |
| 1%   | rare title drop (Phase 3 stub)  | recorded as metadata                   |

Phase 1 only implements gold/XP drops. Cosmetic/title drops are **recorded in `lucky_drop_log` (new table) with status='pending'** so Phase 3 can build the redemption UI without losing drops that happened in Phase 1.

```sql
CREATE TABLE public.lucky_drop_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_ref  text,                                 -- 'exam:<id>' / 'quest:<id>' / etc.
  reward_kind text NOT NULL,                        -- 'gold' | 'xp' | 'cosmetic_voucher' | 'rare_title'
  reward_amount int,                                -- gold/xp amount; null for cosmetic/title
  reward_code text,                                 -- for cosmetic/title: catalog code
  status      text NOT NULL DEFAULT 'granted',      -- 'granted' (gold/xp auto-applied) | 'pending' (cosmetic/title awaiting Phase 3)
  granted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('granted', 'pending', 'revoked'))
);

CREATE INDEX idx_lucky_drop_user_time
  ON public.lucky_drop_log (user_id, created_at DESC);

ALTER TABLE public.lucky_drop_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lucky_drop_log read own or admin"
  ON public.lucky_drop_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.lucky_drop_log TO authenticated;
```

---

## 5. `award_xp()` signature & behavior (extended)

### 5.1 New signature

```sql
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
  transaction_id    uuid,
  new_xp            int,
  new_level         int,
  leveled_up        boolean,
  -- new columns:
  base_amount       int,       -- original _amount, pre-multiplier
  combo_applied     int,       -- combo count used (0 if not tracked)
  multiplier_applied numeric,  -- combined multiplier (combo × event)
  perfect_bonus     int,       -- perfect bonus awarded (0 if none)
  lucky_drop        jsonb      -- null or {kind, amount, code}
)
```

**Backward compatibility:** Existing callers ignore the new return columns. They use `SELECT *` patterns that tolerate extra columns. (Survey confirmed: no caller does `RETURN QUERY` unpacking that would break.)

### 5.2 Algorithm

```text
INPUT: _amount (signed), _metadata.outcome ∈ {success, perfect, fail, null}

1. Idempotency check (unchanged) — if _idempotency_key matches, return existing row.

2. If _amount <= 0 (e.g. shop purchase, admin deduction):
   - Skip combo, multiplier, perfect, lucky drop entirely.
   - Just apply the deduction (this matches C3: ledger integrity for negative flows).

3. Determine outcome:
   _outcome := _metadata->>'outcome'   -- may be NULL

4. COMBO (only if outcome IS NOT NULL):
   4a. Read combo_state FOR UPDATE.
   4b. If last_success_at < now() - 30 min → reset combo to 0.
   4c. If last_success_at::date < current_date (Asia/Bangkok) → reset combo to 0.
   4d. If outcome = 'success' OR 'perfect' → combo += 1.
       If outcome = 'fail'                → combo := 0.
   4e. Compute combo_mult := combo_multiplier(new combo).
   4f. Persist combo_state.

5. EVENT MULTIPLIER:
   event_mult := (SELECT multiplier FROM multiplier_events
                  WHERE is_active AND now() BETWEEN starts_at AND ends_at
                    AND (classroom_id IS NULL OR classroom_id = _classroom_id)
                  ORDER BY multiplier DESC LIMIT 1) → COALESCE(...,1.00)

6. COMPUTE FINAL AMOUNT:
   base := _amount
   total := round(base × combo_mult × event_mult)
   -- _amount here is what caller passed (e.g. exam score, quest XP).
   -- We treat the passed amount as "base XP for this action" before bonuses.

7. PERFECT BONUS (only if outcome = 'perfect'):
   perfect := LEAST(100, floor(base × 0.50))
   -- perfect is added AFTER multipliers? DECISION: NO. Perfect bonus is also
   -- multiplied by event_mult (you should get double perfect bonus during
   -- double-XP hour) but NOT by combo (combo already rewards consistency,
   -- perfect rewards the single action). So:
   perfect_total := round(perfect × event_mult)

8. WRITE LEDGER ROW (base × combo × event = total, NOT including perfect):
   INSERT xp_transactions (
     amount = total,                         -- sum-correct
     source = _source,
     metadata = jsonb_set(_metadata,
       '{bonus_breakdown}',
       jsonb_build_object(
         'base', base,
         'combo_multiplier', combo_mult,
         'combo_count', combo_applied,
         'event_multiplier', event_mult,
         'event_id', <matched event id or null>
       ))
   )

9. UPDATE profiles.xp/level (unchanged).

10. PERFECT BONUS — write as a SEPARATE transaction with source='perfect_bonus':
    IF perfect_total > 0:
      INSERT xp_transactions (amount = perfect_total, source = 'perfect_bonus', ...)
      UPDATE profiles.xp += perfect_total  (recompute level)

11. LUCKY DROP (only if outcome IN ('success','perfect')):
    lucky_chance := 0.08 + GREATEST(0, LEAST(combo_applied - 5, 10)) × 0.02
    IF random() < lucky_chance:
      roll := random()
      IF roll < 0.60: kind='gold', amt=10
      ELSE IF roll < 0.85: kind='xp', amt=25
      ELSE IF roll < 0.95: kind='xp', amt=50
      ELSE IF roll < 0.99: kind='cosmetic_voucher', amt=NULL, status='pending'
      ELSE: kind='rare_title', amt=NULL, status='pending'

      INSERT lucky_drop_log (...)
      IF kind='gold':
        UPDATE profiles.gold += amt
      IF kind='xp':
        INSERT xp_transactions (amount=amt, source='lucky_drop', metadata={lucky:true})
        UPDATE profiles.xp += amt (recompute level)

12. RETURN all fields including breakdown for UI to display.
```

### 5.3 Idempotency interaction with stochastic rewards

A subtle problem: if a retry hits the same `_idempotency_key`, we return the cached `transaction_id` — but the lucky drop / perfect bonus from the first call already happened. We must ensure they're not re-rolled.

**Solution:** Store `lucky_drop_id` and `perfect_bonus_txn_id` in the **base transaction's metadata** on first call. On idempotent replay, return the cached row; the caller sees the same `lucky_drop` (re-fetched from `lucky_drop_log` by id). Re-rolls are impossible because we never reach step 11 on replay.

### 5.4 What about `_amount < 0` (shop purchases, deductions)?

Skip combo/multiplier/perfect/lucky entirely. They make no sense for deductions. The negative amount passes through to the ledger as-is. The original `daily_bonus`/`shop_purchase`/`admin_adjustment` enum values continue to work.

---

## 6. Caller migrations

### 6.1 Existing callers — metadata.outcome additions

Each caller needs to pass `_metadata->>'outcome'` so `award_xp` knows whether to update combo. **No signature changes** — just richer metadata.

| Caller                             | Outcome mapping                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `finalize_quest_from_progress`     | `outcome = 'perfect' if score=max_score else 'success' if score>0 else 'fail'` |
| `submit_exam` / `auto_submit_exam` | `outcome = 'perfect' if score=max_score else 'success' if score>0 else 'fail'` |
| `self_check_in` (attendance)       | `outcome = 'success'` (no fail concept)                                        |
| `close_weekly_mission`             | `outcome = NULL` (bulk; no combo impact)                                       |
| `claim_achievement`                | `outcome = NULL` (one-shot)                                                    |

### 6.2 Legacy triggers — fold into `award_xp`

Two triggers still bypass the ledger (§3 of survey). We migrate them so combos/multipliers/lucky drops work for submissions and attendance too.

**`award_submission_grade()` trigger → calls `award_xp` with:**

```sql
SELECT * FROM public.award_xp(
  _user_id := NEW.student_id,
  _amount := _xp,
  _source := 'submission'::public.app_xp_source,   -- newly added in §4.3
  _source_label := 'ส่งงานได้คะแนน',
  _subject := <classroom name>,
  _ref_table := 'submissions',
  _ref_id := NEW.id,
  _classroom_id := NEW.classroom_id,
  _metadata := jsonb_build_object(
    'outcome', CASE WHEN NEW.score::float8 / NULLIF(NEW.max_score,0) >= 1.0 THEN 'perfect'
                    WHEN NEW.score::float8 / NULLIF(NEW.max_score,0) >= 0.5 THEN 'success'
                    ELSE 'fail' END,
    'score', NEW.score,
    'max_score', NEW.max_score
  ),
  _idempotency_key := 'submission_grade:' || NEW.id || ':' || COALESCE(NEW.graded_at::text,'')
);
```

> Phase 1 adds a proper `'submission'` enum value (§4.3) so submissions stop being mis-attributed as `'daily_quest'`. Historical rows keep their old source value — only new awards use `'submission'`.

**`award_attendance_checkin()` trigger → calls `award_xp`** similar pattern, with `outcome='success'`.

**`finish_quiz_session()`** — also migrated to route through `award_xp` using the new `'quiz'` source. Each winning participant gets `award_xp` with `outcome='perfect'`, runners-up with `outcome='success'`.

### 6.3 Idempotency key changes

The legacy triggers generated keys differently. New keys must remain stable to avoid double-awards during the migration window:

| Path                               | Old idempotency key    | New key                                                                          |
| ---------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `award_submission_grade` trigger   | (none — direct UPDATE) | `'submission_grade:' \|\| NEW.id \|\| ':' \|\| COALESCE(NEW.graded_at::text,'')` |
| `award_attendance_checkin` trigger | (none — direct UPDATE) | `'attendance:' \|\| NEW.id`                                                      |
| `finish_quiz_session`              | (none — direct UPDATE) | `'quiz_top:' \|\| session_id \|\| ':' \|\| user_id`                              |

---

## 7. Frontend integration

### 7.1 Where to surface feedback

| Surface                          | What to show                                                     | File                                                            |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Quest result page                | "🔥 Combo ×5 — 1.5× XP!" + "🎯 Perfect +25" + "🎲 Lucky! +25 XP" | `src/routes/_authenticated/quests.tsx`                          |
| Exam result page                 | same breakdown                                                   | `src/routes/_authenticated/exam.$examId.report.tsx`             |
| Quiz scoreboard                  | combo per question (top-right corner)                            | `src/routes/_authenticated/quiz.$sessionId.tsx`                 |
| Dashboard "Weekly Pulse" panel   | current combo, active multiplier event banner                    | `src/components/gamification-status-panel.tsx`                  |
| Global header                    | small badge if multiplier event is active                        | `src/components/app-header.tsx` (or wherever the top bar lives) |
| Toast notifications              | ephemeral "🎲 Lucky drop! +10 gold"                              | sonner (existing)                                               |
| Rewards page → new "กิจกรรม" tab | multiplier events schedule, combo history                        | `src/routes/_authenticated/rewards.tsx`                         |

### 7.2 New UI components

1. **`<ComboBadge combo={n} multiplier={m} />`** — small pill, animated count-up via `motion`, fire-themed at combo ≥ 7.
2. **`<MultiplierEventBanner event={...} />`** — top of dashboard, dismissible, shows time remaining.
3. **`<LuckyDropToast drop={...} />`** — sonner toast wrapper with confetti for rare drops (cosmetic/title).
4. **`<BonusBreakdown base={50} combo={1.5} event={2} perfect={25} lucky={10} />`** — renders the math line (`50 × 1.5 × 2 + 25 + 10 = 185`) on result pages.

### 7.3 Calm principles (PRODUCT.md compliance)

- All animations **≤ 600ms**, easing-out, no neon glow
- Combo badge is **pill-shaped**, not a fireworks overlay
- Multiplier event banner is **dismissible** and **once-dismissed stays dismissed for the event**
- Lucky drops default to a **single toast** that fades in 4s — no forced modals
- Rare drops (1%) are the **only** exception: full-screen brief flash (1s) + persistent badge on profile

### 7.4 Admin UI for multiplier events

New admin page: `src/routes/_authenticated/admin/multiplier-events.tsx`

- List active/past events
- Create new event (start, end, multiplier, label, scope)
- Auto-spawn toggle: "Auto-spawn 1 double-XP hour per week at random time within school hours" (PG `cron` or app-level scheduler — see §8)

---

## 8. Auto-spawning multiplier events

To avoid requiring admin attention, a weekly auto-spawn keeps events fresh:

**Approach:** Supabase Edge Function `supabase/functions/spawn-weekly-multiplier/` triggered by `pg_cron` (or Supabase's scheduled functions).

- Runs every Monday 06:00 Asia/Bangkok
- Picks a random weekday + random 1-hour slot between 12:00–18:00 (lunch + after-school)
- Inserts one `multiplier_events` row with `multiplier=2.0`, `label='ชั่วโมงพิเศษ!'`
- 50% chance to spawn a second smaller event (1.5×, 30 min) midweek

If `pg_cron` is not enabled, fallback is a daily check from the dashboard that lazily spawns if no event exists for the current week.

---

## 9. Edge cases & decisions

| Case                                                                        | Decision                                                                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Two multiplier events overlap (one global 2×, one classroom 3×)             | Use the **highest** multiplier; don't stack. (Survey said stack would inflate too fast.)                                            |
| Combo at 30+ — does multiplier keep climbing?                               | No, cap at 2.0× (see curve).                                                                                                        |
| User does exam at 23:55, finishes 00:10 next day                            | Day-rollover rule applies on **next action**, not mid-action. Exam's single `award_xp` call uses the combo at start.                |
| Lucky drop on a negative XP action                                          | Skipped (§5.4).                                                                                                                     |
| Same `idempotency_key` replayed                                             | Returns cached row; lucky drop is NOT re-rolled (stored in metadata).                                                               |
| Admin adjusts XP via direct UPDATE                                          | Not through `award_xp` — no combo/multiplier impact. Documented as expected.                                                        |
| Multiplier event created retroactively covering past hour                   | Does NOT re-process historical transactions. Only affects future calls.                                                             |
| Student has 100% on a 200-point exam                                        | Perfect bonus capped at +100 (§4.6).                                                                                                |
| Browser timezone ≠ Asia/Bangkok                                             | Day rollover is server-side, always Asia/Bangkok. Consistent for all users.                                                         |
| Race: two `award_xp` calls concurrently for same user                       | `FOR UPDATE` row lock on `profiles` + `combo_state` serializes them.                                                                |
| `award_xp` called inside a trigger that itself fires from `award_xp` writes | No recursion: `award_xp` writes to `xp_transactions` (no trigger on it) and `profiles` (no XP-related trigger on `profiles`). Safe. |

---

## 10. Testing strategy

### 10.1 SQL unit tests (pgTAP-style, manual `psql` runs)

1. `award_xp` with no metadata.outcome → no combo change, no perfect, no lucky.
2. `award_xp` with `outcome='success'` → combo increments, multiplier applies.
3. `award_xp` with `outcome='fail'` → combo resets to 0.
4. `award_xp` with `outcome='perfect'` → perfect bonus row created, separate source.
5. Two calls same idempotency key → only one row, no re-roll.
6. Multiplier event active → amount doubled; inactive → no change.
7. 30-min decay → combo resets.
8. Day rollover (mock `now()` via `set_config`) → combo resets.

### 10.2 Frontend tests

- `<ComboBadge>` renders correct tier color
- `<BonusBreakdown>` renders the math correctly for all combinations
- Idempotent `award_xp` return does not cause double toast

### 10.3 Manual smoke test (post-deploy)

1. Submit a daily quest perfectly → see combo +1, perfect bonus, possibly lucky drop.
2. Submit a wrong quest → see combo reset.
3. Wait 31 min, submit again → see combo restart at 1.
4. Admin creates a multiplier event → next submission is doubled.
5. Submit 10 in a row → combo cap at 2.0×.

---

## 11. Migration plan

A single migration file (atomic, idempotent):

**File:** `supabase/migrations/20260720100000_engagement_engine.sql`

Contents (in order):

1. `ALTER TYPE app_xp_source ADD VALUE IF NOT EXISTS 'lucky_drop'`
2. `ALTER TYPE app_xp_source ADD VALUE IF NOT EXISTS 'perfect_bonus'`
3. `CREATE TABLE combo_state ...`
4. `CREATE TABLE multiplier_events ...`
5. `CREATE TABLE lucky_drop_log ...`
6. `CREATE FUNCTION combo_multiplier(int) ...`
7. `CREATE OR REPLACE FUNCTION award_xp(...)` — new algorithm
8. Re-grant on `award_xp` (new signature)
9. `INSERT INTO combo_state (user_id) SELECT id FROM profiles` — backfill every user with combo=0
10. Seed one starter multiplier event (e.g. "Welcome bonus 2× hour" this weekend) for immediate visibility
11. Migrate `award_submission_grade` trigger to route through `award_xp`
12. Migrate `award_attendance_checkin` trigger to route through `award_xp`
13. Migrate `finish_quiz_session` to route through `award_xp`
14. Update `finalize_quest_from_progress`, `submit_exam`, `auto_submit_exam`, `self_check_in`, `close_weekly_mission`, `claim_achievement` to pass `outcome` in metadata (where applicable)
15. Regenerate `src/integrations/supabase/types.ts` via `supabase gen types`

**Rollback:** Each step is additive; rollback is `DROP TABLE`, `DROP FUNCTION`, `ALTER TYPE ... DROP VALUE` (note: Postgres cannot drop enum values easily; the migration is **one-way** for enum additions. Acceptable since values are additive).

---

## 12. Build sequence (for implementation plan)

Ordered so each step is independently verifiable:

1. **Migration** — schema + RPC rewrite. Verify with `psql` tests (§10.1).
2. **Trigger migrations** — fold submissions, attendance, quiz into `award_xp`. Verify with `psql` tests.
3. **Regenerate types** — `bun supabase gen types`.
4. **Frontend components** — `ComboBadge`, `MultiplierEventBanner`, `BonusBreakdown`, `LuckyDropToast`. Storybook-style isolated.
5. **Wire into quest result page** — first end-to-end visible path.
6. **Wire into exam report page**.
7. **Wire into dashboard panel** — combo display + event banner.
8. **Admin multiplier-events page**.
9. **Auto-spawn edge function + schedule**.
10. **Polish: animations, i18n strings, calm-ethos review.**

---

## 13. Open questions deferred

These are flagged but **not** in scope for Phase 1:

- **O1:** Should multiplier events be classroom-scoped or strictly global? (Schema supports both; Phase 1 only uses global.)
- **O2:** Streak freeze (Phase 2) interacts with day-rollover logic — coordinate then.
- **O3:** Cosmetic redemption UI for pending lucky drops (Phase 3).
- **O4:** Public weekly "fastest comboer" leaderboard? (Phase 3, social.)
- **O5:** Should `award_xp` expose a "dry run" mode for UI preview? Probably YAGNI.

---

## 14. Glossary

- **Combo** — consecutive successful actions, decays after 30 min inactivity or day rollover.
- **Multiplier event** — time-bounded global XP multiplier (e.g. "double XP hour").
- **Perfect bonus** — additive bonus when an action scores perfectly.
- **Lucky drop** — stochastic post-action reward (gold/XP/cosmetic/title).
- **Outcome** — caller-provided semantic result (`success` / `perfect` / `fail` / null) passed via `_metadata`.
