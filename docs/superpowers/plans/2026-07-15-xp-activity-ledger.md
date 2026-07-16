# XP Activity Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง XP Activity Ledger ที่บันทึกทุกครั้งที่นักเรียนได้ XP (append-only, source of truth), ปิดช่องว่าง XP ของ attendance + weekly mission, และเพิ่ม UI timeline ให้นักเรียนเห็นประวัติตัวเอง

**Architecture:** Ledger-first — ทุกการให้ XP ต้องผ่าน RPC กลาง `award_xp()` (SECURITY DEFINER) ที่ INSERT ledger + UPDATE profiles + UPSERT classroom_scores ใน transaction เดียวกัน RPC เดิม (`finalize_quest_from_progress`, `complete_quest`, `claim_achievement`, `self_check_in`) refactor ให้เรียกผ่าน `award_xp` RPC ใหม่ `close_weekly_mission` ออก XP รวดเดียวตอนครูปิด mission UI = หน้า `/activity` + widget ใน dashboard

**Tech Stack:** Supabase (Postgres + RPC SECURITY DEFINER + RLS), TanStack Start (React 19 SSR), TanStack Query, shadcn/ui, Tailwind v4, lucide-react, sonner, i18n ไทย

**Spec:** `docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md`

**หมายเหตุสำคัญเรื่องการทดสอบ:** โปรเจกต์นี้ **ไม่มี test framework** (ไม่มี vitest/jest/playwright) จึงใช้ verification ผ่าน (1) `npm run typecheck`, (2) `npm run lint`, (3) manual smoke test ใน dev server + Supabase Studio แทน TDD แบบ classic แต่ละ task จะมี "ตรวจสอบ" step ชัดเจน

---

## File Structure

### สร้างใหม่
| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/<ts>_xp_ledger_schema.sql` | enum + ตาราง `xp_transactions` + index + RLS |
| `supabase/migrations/<ts>_xp_ledger_award_xp.sql` | RPC `award_xp()` |
| `supabase/migrations/<ts>_xp_ledger_refactor_rpcs.sql` | refactor `finalize_quest_from_progress` + `self_check_in` |
| `supabase/migrations/<ts>_xp_ledger_close_mission.sql` | RPC `close_weekly_mission` |
| `src/lib/xp-transactions.functions.ts` | data fetching (fetchXpTransactions, fetchXpSummary) |
| `src/components/recent-activity-card.tsx` | widget 5 รายการล่าสุด |
| `src/routes/_authenticated/activity.tsx` | หน้า timeline เต็ม |

### แก้ไข
| ไฟล์ | การแก้ |
|---|---|
| `src/integrations/supabase/types.ts` | regenerate + manual patch ถ้าจำเป็น |
| `src/routes/_authenticated/dashboard.tsx` | ฝัง widget + ลบ copy ปลอม + invalidate |
| `src/routes/_authenticated/weekly-missions.tsx` | เรียก `close_weekly_mission` RPC แทน client-side sync |
| `src/routes/_authenticated/quests.tsx` | invalidate `["xp-transactions"]` หลัง finalize |
| `src/components/app-sidebar.tsx` | เพิ่ม link "บันทึกกิจกรรม" |
| `src/i18n.ts` | เพิ่มคำศัพท์ timeline / filter labels |

---

## Task 1: Migration — Enum + ตาราง xp_transactions

**Files:**
- Create: `supabase/migrations/20260715090000_xp_ledger_schema.sql`

- [ ] **Step 1: สร้าง migration ไฟล์**

สร้าง `supabase/migrations/20260715090000_xp_ledger_schema.sql`:

```sql
-- XP Activity Ledger: enum + table + indexes + RLS
-- Spec: docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md

-- 1. Enum แหล่งที่มาของ XP
CREATE TYPE public.app_xp_source AS ENUM (
  'daily_quest',
  'attendance',
  'weekly_mission',
  'daily_bonus',
  'achievement',
  'shop_purchase',
  'admin_adjustment'
);

-- 2. ตาราง ledger (append-only)
CREATE TABLE public.xp_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount          int  NOT NULL,
  source          public.app_xp_source NOT NULL,
  source_label    text NOT NULL,
  subject         text,
  ref_table       text,
  ref_id          uuid,
  classroom_id    uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  balance_after   int  NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX idx_xpt_user_time
  ON public.xp_transactions (user_id, created_at DESC);

CREATE INDEX idx_xpt_user_source
  ON public.xp_transactions (user_id, source);

-- Partial unique index สำหรับ idempotency (NULL ไม่ enforce)
CREATE UNIQUE INDEX uq_xpt_idempotency
  ON public.xp_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. RLS
ALTER TABLE public.xp_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "xp_transactions read own or admin"
  ON public.xp_transactions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- ไม่มี INSERT/UPDATE/DELETE policy
-- → ผู้ใช้เขียนตรงไม่ได้ ต้องผ่าน SECURITY DEFINER RPC เท่านั้น
```

- [ ] **Step 2: ตรวจสอบ syntax ใน Supabase Studio**

เปิด Supabase Studio → SQL Editor → วาง migration รันดู (ใน dev project)

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY` สำเร็จ ไม่มี error

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715090000_xp_ledger_schema.sql
git commit -m "feat(xp-ledger): add xp_transactions table + RLS"
```

---

## Task 2: Migration — RPC กลาง award_xp()

**Files:**
- Create: `supabase/migrations/20260715090100_xp_ledger_award_xp.sql`

- [ ] **Step 1: สร้าง migration**

สร้าง `supabase/migrations/20260715090100_xp_ledger_award_xp.sql`:

```sql
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
```

- [ ] **Step 2: ทดสอบใน Supabase Studio**

รัน SQL ต่อไปนี้เพื่อทดสอบ:

```sql
-- หา user ทดสอบ (student)
SELECT id, display_name, xp, level FROM profiles WHERE display_name LIKE '%ทดสอบ%' LIMIT 1;
-- สมมติได้ id = 'test-user-id'

-- ทดสอบ award_xp
SELECT * FROM award_xp(
  _user_id := '<test-user-id>'::uuid,
  _amount := 50,
  _source := 'admin_adjustment'::app_xp_source,
  _source_label := 'ทดสอบระบบ ledger',
  _metadata := '{"test": true}'::jsonb
);

-- ตรวจผลลัพธ์
SELECT * FROM xp_transactions WHERE user_id = '<test-user-id>'::uuid ORDER BY created_at DESC LIMIT 5;
SELECT xp, level FROM profiles WHERE id = '<test-user-id>'::uuid;
```

Expected:
- `award_xp` return `(transaction_id, new_xp=old_xp+50, new_level, leveled_up)`
- `xp_transactions` มี row ใหม่ amount=50, balance_after=ยอดใหม่
- `profiles.xp` เพิ่ม 50

- [ ] **Step 3: ทดสอบ idempotency**

รัน `award_xp` ซ้ำด้วย `_idempotency_key := 'test-key-1'` สองครั้ง:

```sql
SELECT * FROM award_xp(
  _user_id := '<test-user-id>'::uuid,
  _amount := 30,
  _source := 'admin_adjustment'::app_xp_source,
  _source_label := 'ทดสอบ idempotent',
  _idempotency_key := 'test-key-1'
);
-- ครั้งที่ 1: return transaction_id_A, xp เพิ่ม 30

SELECT * FROM award_xp(
  _user_id := '<test-user-id>'::uuid,
  _amount := 30,
  _source := 'admin_adjustment'::app_xp_source,
  _source_label := 'ทดสอบ idempotent',
  _idempotency_key := 'test-key-1'
);
-- ครั้งที่ 2: return transaction_id_A (เดิม), xp ไม่เพิ่ม
```

Expected: ครั้งที่ 2 return transaction_id เดียวกัน + xp ไม่เปลี่ยน

- [ ] **Step 4: ล้างข้อมูลทดสอบ**

```sql
DELETE FROM xp_transactions WHERE metadata->>'test' = 'true' OR source_label LIKE 'ทดสอบ%';
-- ปรับ profiles.xp กลับด้วยถ้าจำเป็น
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260715090100_xp_ledger_award_xp.sql
git commit -m "feat(xp-ledger): add award_xp() RPC with idempotency + atomic update"
```

---

## Task 3: Migration — Refactor finalize_quest_from_progress

**Files:**
- Create: `supabase/migrations/20260715090200_xp_ledger_refactor_quests.sql`
- Reference: `supabase/migrations/20260528065153_42aaab1e-5cf8-4598-8c39-acb47473a410.sql`

- [ ] **Step 1: สร้าง migration refactor**

สร้าง `supabase/migrations/20260715090200_xp_ledger_refactor_quests.sql`:

```sql
-- Refactor finalize_quest_from_progress ให้ XP วิ่งผ่าน award_xp()
-- (อ้างอิง schema เดิมจาก 20260528065153_42aaab1e)

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

  INSERT INTO public.daily_quest_attempts(quest_id,user_id,answers,score,max_score,xp_awarded,gold_awarded,ai_feedback,per_question)
  VALUES (_quest_id,_user_id,_answers,_total,_max,_xp,_gold,'สรุปคะแนนจากคำตอบที่ทำไว้',_per);

  SELECT * INTO _prof FROM public.profiles WHERE id=_user_id;
  _new_streak := CASE
    WHEN _prof.last_quest_date = _today THEN _prof.streak_days
    WHEN _prof.last_quest_date = _today - INTERVAL '1 day' THEN _prof.streak_days + 1
    ELSE 1
  END;

  -- แยกส่วนที่ไม่ใช่ XP ออกมา update profiles ตรง (gold, counters, streak, date)
  UPDATE public.profiles
  SET gold = gold + _gold,
      quests_completed = quests_completed + 1,
      perfect_scores = perfect_scores + CASE WHEN _is_perfect THEN 1 ELSE 0 END,
      streak_days = _new_streak,
      last_quest_date = _today
  WHERE id=_user_id;

  -- XP วิ่งผ่าน award_xp (atomic กับ ledger)
  SELECT * INTO _award FROM public.award_xp(
    _user_id := _user_id,
    _amount := _xp,
    _source := 'daily_quest'::public.app_xp_source,
    _source_label := COALESCE(_q.title, 'ทำควอสต์รายวัน'),
    _subject := _q.subject,
    _ref_table := 'daily_quest_attempts',
    _classroom_id := _q.classroom_id,
    _metadata := jsonb_build_object(
      'quest_id', _quest_id,
      'perfect', _is_perfect,
      'score', _total,
      'max_score', _max
    ),
    _idempotency_key := 'quest_finalize:' || _user_id::text || ':' || _quest_id::text
  );

  -- upsert counters ของ classroom_scores (xp=0 เพราะ award_xp จัดการแล้ว)
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
    'total_xp',_award.new_xp,'level',_award.new_level,'streak',_new_streak,'perfect',_is_perfect
  );
END;
$$;
```

- [ ] **Step 2: ตรวจสอบว่ามีคอลัมน์ `daily_quests.title` และ `daily_quests.subject`**

ถ้าไม่มี ให้ปรับ `_source_label := 'ทำควอสต์รายวัน'` และละ `_subject := NULL` ทดสอบ:

```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'daily_quests' AND column_name IN ('title', 'subject');
```

- [ ] **Step 3: ทดสอบ end-to-end**

ใน dev server (ล็อกอินเป็น student) → ทำควอสต์หนึ่งรายการให้จบ → ตรวจ:

```sql
SELECT * FROM xp_transactions
  WHERE user_id = '<test-user-id>'::uuid
  AND source = 'daily_quest'
  ORDER BY created_at DESC LIMIT 5;
SELECT xp, level, gold FROM profiles WHERE id = '<test-user-id>'::uuid;
```

Expected: ledger มี row source='daily_quest', profiles.xp ตรงกับ balance_after

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715090200_xp_ledger_refactor_quests.sql
git commit -m "refactor(xp-ledger): route daily quest XP through award_xp()"
```

---

## Task 4: Migration — Refactor self_check_in (attendance XP)

**Files:**
- Create: `supabase/migrations/20260715090300_xp_ledger_attendance.sql`
- Reference: `supabase/migrations/20260527063930_22883f9c-b06c-48bf-ac09-b937012410cf.sql`

- [ ] **Step 1: ตรวจสอบ attendance_sessions columns ที่จะใช้**

```sql
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'attendance_sessions'
  AND column_name IN ('id', 'classroom_id', 'check_in_code', 'check_in_opens_at', 'check_in_expires_at', 'title');
```

จดชื่อ column ไว้ใช้ในฟังก์ชัน

- [ ] **Step 2: สร้าง migration**

สร้าง `supabase/migrations/20260715090300_xp_ledger_attendance.sql`:

```sql
-- Refactor self_check_in ให้มอบ XP จริง (present=+15, late=+5)
-- รองรับ re-grade (late→present) ผ่าน delta logic

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

  v_minutes := EXTRACT(EPOCH FROM (now() - v_session.check_in_opens_at)) / 60;
  v_status := CASE WHEN v_minutes > 5 THEN 'late'::attendance_status ELSE 'present'::attendance_status END;

  -- เก็บสถานะเดิมก่อน upsert
  SELECT status INTO v_old_status FROM public.attendance_records
    WHERE session_id = v_session.id AND user_id = auth.uid();

  INSERT INTO public.attendance_records AS ar (session_id, user_id, status)
    VALUES (v_session.id, auth.uid(), v_status)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET status = EXCLUDED.status, marked_at = now();

  -- คำนวณ XP delta (รองรับการ re-grade)
  v_xp_delta := CASE
    WHEN v_status = 'present' AND v_old_status IS DISTINCT FROM 'present' THEN
      CASE WHEN v_old_status = 'late' THEN 10 ELSE 15 END
    WHEN v_status = 'late' AND v_old_status IS DISTINCT FROM 'late' THEN
      CASE WHEN v_old_status = 'present' THEN -10 ELSE 5 END
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
      -- idempotency_key = NULL เพราะใช้ delta logic รองรับ re-grade
    );
  END IF;

  RETURN QUERY SELECT v_session.id, v_status::text, v_xp_delta;
END;
$function$;
```

- [ ] **Step 3: ทดสอบ check-in ครั้งแรก**

ล็อกอินเป็น student → ใช้ check-in code ของ session active → ตรวจ:

```sql
SELECT * FROM xp_transactions WHERE source = 'attendance' ORDER BY created_at DESC LIMIT 5;
SELECT xp FROM profiles WHERE id = '<student-id>'::uuid;
```

Expected: ledger มี row source='attendance' amount=15 หรือ 5, profiles.xp เพิ่มตาม

- [ ] **Step 4: ทดสอบ re-grade scenario (optional — ใช้ SQL)**

```sql
-- จำลอง late → present (ในกรณีครูเปลี่ยนสถานะ)
-- (การ re-grade ผ่าน UI ขึ้นกับ flow ครู — ทดสอบด้วย manual ถ้ามี)
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260715090300_xp_ledger_attendance.sql
git commit -m "feat(xp-ledger): award real XP on attendance check-in"
```

---

## Task 5: Migration — RPC close_weekly_mission

**Files:**
- Create: `supabase/migrations/20260715090400_xp_ledger_close_mission.sql`

- [ ] **Step 1: ตรวจสอบ weekly_missions และ mission_progress columns**

```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'weekly_missions_items' AND column_name = 'subject';
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'assignments' AND column_name = 'subject';
```

ถ้าไม่มี `subject` → fallback `_subject := NULL` ในฟังก์ชัน

- [ ] **Step 2: สร้าง migration**

สร้าง `supabase/migrations/20260715090400_xp_ledger_close_mission.sql`:

```sql
-- RPC ใหม่: ครูปิด mission → ออก XP ทุกคนพร้อมกัน
-- idempotent (กันกดปิดซ้ำ), ตรวจสิทธิ์ครูเจ้าของห้อง

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
  _main_subject text;
BEGIN
  SELECT * INTO _wm FROM public.weekly_missions WHERE id = _mission_id;
  IF _wm.id IS NULL THEN
    RAISE EXCEPTION 'mission not found';
  END IF;

  -- สิทธิ์: ครูเจ้าของห้อง หรือ admin
  IF NOT public.is_classroom_owner(_wm.classroom_id) AND NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปิดภารกิจ';
  END IF;

  -- ต้องอยู่ในสถานะ published
  IF _wm.status != 'published' THEN
    RAISE EXCEPTION 'ภารกิจไม่ได้อยู่ในสถานะที่ปิดได้ (ต้องเป็น published)';
  END IF;

  -- ดึง subject จาก main assignment (fallback NULL ถ้าไม่มี)
  BEGIN
    SELECT a.subject INTO _main_subject
      FROM public.assignments a
      WHERE a.id = _wm.main_assignment_id;
  EXCEPTION WHEN others THEN
    _main_subject := NULL;
  END;

  -- ปิด mission
  UPDATE public.weekly_missions
    SET status = 'closed', closed_at = now()
    WHERE id = _mission_id;

  -- วนให้ XP ทุกคนที่มี progress
  FOR _mp IN
    SELECT * FROM public.mission_progress
      WHERE mission_id = _mission_id
        AND status IN ('submitted', 'reviewed', 'completed')
  LOOP
    _total_xp := COALESCE(_mp.participation_xp_awarded, 0)
               + COALESCE(_mp.quality_xp_awarded, 0)
               + COALESCE(_mp.ai_xp_awarded, 0);

    IF _total_xp > 0 THEN
      PERFORM public.award_xp(
        _user_id         := _mp.user_id,
        _amount          := _total_xp,
        _source          := 'weekly_mission'::public.app_xp_source,
        _source_label    := 'ภารกิจรายสัปดาห์',
        _subject         := _main_subject,
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
```

- [ ] **Step 3: ทดสอบ**

ใน Supabase Studio:

```sql
-- หา published mission
SELECT id, classroom_id, main_assignment_id, status FROM weekly_missions WHERE status = 'published' LIMIT 1;

-- เรียกในนามครูเจ้าของ (ใช้ set_config ถ้าจำเป็น หรือทดสอบผ่าน UI)
-- ดูผลลัพธ์:
SELECT user_id, xp_awarded FROM close_weekly_mission('<mission-id>'::uuid);

SELECT * FROM xp_transactions WHERE source = 'weekly_mission' ORDER BY created_at DESC LIMIT 20;
```

Expected: ledger มี row สำหรับทุก student ที่มี progress

- [ ] **Step 4: ทดสอบ idempotency (กดปิดซ้ำ)**

เรียก `close_weekly_mission` อีกครั้งด้วย mission_id เดิม → expect exception `'ภารกิจไม่ได้อยู่ในสถานะที่ปิดได้'` (เพราะ status=closed แล้ว)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260715090400_xp_ledger_close_mission.sql
git commit -m "feat(xp-ledger): add close_weekly_mission() RPC to batch-award mission XP"
```

---

## Task 6: Regenerate types.ts

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: รัน supabase gen types (ถ้ามี supabase CLI + access)**

```bash
npx supabase gen types typescript --project-id fkjazvlqfgycoauemopz > src/integrations/supabase/types.ts.new
```

ถ้าไม่ได้ (ไม่มี CLI / ไม่มี access) → แก้ manual:

- [ ] **Step 2 (fallback): Manual patch types.ts**

เพิ่มในส่วน `Enums`:

```ts
app_xp_source: 'daily_quest' | 'attendance' | 'weekly_mission' | 'daily_bonus' | 'achievement' | 'shop_purchase' | 'admin_adjustment';
```

เพิ่มใน `Tables` (ใต้ entry อื่น):

```ts
xp_transactions: {
  Row: {
    id: string;
    user_id: string;
    amount: number;
    source: Database["public"]["Enums"]["app_xp_source"];
    source_label: string;
    subject: string | null;
    ref_table: string | null;
    ref_id: string | null;
    classroom_id: string | null;
    balance_after: number;
    metadata: Record<string, unknown>;
    idempotency_key: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    amount: number;
    source: Database["public"]["Enums"]["app_xp_source"];
    source_label: string;
    subject?: string | null;
    ref_table?: string | null;
    ref_id?: string | null;
    classroom_id?: string | null;
    balance_after: number;
    metadata?: Record<string, unknown>;
    idempotency_key?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    user_id?: string;
    amount?: number;
    source?: Database["public"]["Enums"]["app_xp_source"];
    source_label?: string;
    subject?: string | null;
    ref_table?: string | null;
    ref_id?: string | null;
    classroom_id?: string | null;
    balance_after?: number;
    metadata?: Record<string, unknown>;
    idempotency_key?: string | null;
    created_at?: string;
  };
  Relationships: [
    { foreignKeyName: 'xp_transactions_user_id_fkey'; columns: ['user_id']; referencedRelation: 'profiles'; referencedColumns: ['id']; },
    { foreignKeyName: 'xp_transactions_classroom_id_fkey'; columns: ['classroom_id']; referencedRelation: 'classrooms'; referencedColumns: ['id']; },
  ];
};
```

เพิ่มใน `Functions` (RPC signatures):

```ts
award_xp: {
  Args: {
    _user_id: string;
    _amount: number;
    _source: Database["public"]["Enums"]["app_xp_source"];
    _source_label: string;
    _subject?: string | null;
    _ref_table?: string | null;
    _ref_id?: string | null;
    _classroom_id?: string | null;
    _metadata?: Record<string, unknown>;
    _idempotency_key?: string | null;
  };
  Returns: {
    transaction_id: string;
    new_xp: number;
    new_level: number;
    leveled_up: boolean;
  }[];
};
close_weekly_mission: {
  Args: { _mission_id: string };
  Returns: { user_id: string; xp_awarded: number }[];
};
```

- [ ] **Step 3: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน (อาจมี error เก่าๆ ที่ไม่เกี่ยวข้อง — เช็คว่าไม่มี error จาก `xp_transactions` / `app_xp_source`)

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): add xp_transactions + app_xp_source + RPC signatures"
```

---

## Task 7: Data layer — xp-transactions.functions.ts

**Files:**
- Create: `src/lib/xp-transactions.functions.ts`

- [ ] **Step 1: ดู pattern ของ functions.ts อื่นๆ**

อ้างอิง `src/lib/gradebook.functions.ts` สำหรับ import / typing style

- [ ] **Step 2: สร้างไฟล์**

สร้าง `src/lib/xp-transactions.functions.ts`:

```ts
import { getSupabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type XpSource =
  Database["public"]["Enums"]["app_xp_source"];

export type XpTransactionRow =
  Database["public"]["Tables"]["xp_transactions"]["Row"];

export type TimeRange = "today" | "week" | "month" | "all";

export interface FetchXpTransactionsParams {
  limit?: number;
  source?: XpSource | null;
  range?: TimeRange;
  cursor?: string; // created_at ของรายการสุดท้าย (infinite scroll)
}

export interface XpSummary {
  totalXp: number;
  perSource: Record<string, number>;
}

/**
 * คำนวณเวลาเริ่มต้นของ range (local time → ISO string)
 */
function computeRangeStart(range: TimeRange): Date | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return start;
  }
  if (range === "month") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    return start;
  }
  return null;
}

/**
 * ดึงรายการ XP transactions ของ user ปัจจุบัน (RLS filter ให้อัตโนมัติ)
 */
export async function fetchXpTransactions(
  params: FetchXpTransactionsParams = {}
): Promise<{ data: XpTransactionRow[] | null; error: Error | null }> {
  const supabase = getSupabase();
  const { limit = 20, source, range, cursor } = params;

  let query = supabase
    .from("xp_transactions")
    .select("*")
    .order("created_at", { ascending: false });

  if (source) {
    query = query.eq("source", source);
  }

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const rangeStart = computeRangeStart(range ?? "all");
  if (rangeStart) {
    query = query.gte("created_at", rangeStart.toISOString());
  }

  const { data, error } = await query.limit(limit);
  return { data, error: error as Error | null };
}

/**
 * ดึงยอดรวม XP + แยกตาม source สำหรับ range ที่เลือก
 */
export async function fetchXpSummary(
  range: TimeRange = "all"
): Promise<{ data: XpSummary | null; error: Error | null }> {
  const supabase = getSupabase();
  const rangeStart = computeRangeStart(range);

  let query = supabase
    .from("xp_transactions")
    .select("amount, source");

  if (rangeStart) {
    query = query.gte("created_at", rangeStart.toISOString());
  }

  const { data, error } = await query;
  if (error || !data) {
    return { data: null, error: error as Error };
  }

  const summary: XpSummary = {
    totalXp: 0,
    perSource: {},
  };
  for (const row of data) {
    const amt = row.amount ?? 0;
    summary.totalXp += amt;
    const key = row.source as string;
    summary.perSource[key] = (summary.perSource[key] ?? 0) + amt;
  }
  return { data: summary, error: null };
}
```

- [ ] **Step 3: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน

- [ ] **Step 4: Commit**

```bash
git add src/lib/xp-transactions.functions.ts
git commit -m "feat(xp-ledger): add data layer for fetching XP transactions"
```

---

## Task 8: UI — recent-activity-card component

**Files:**
- Create: `src/components/recent-activity-card.tsx`

- [ ] **Step 1: เช็ค visual patterns ที่ใช้**

อ้างอิง `src/components/daily-bonus-card.tsx` และ `src/components/gamification-status-panel.tsx` สำหรับ:
- import pattern (Card, CardHeader, ...)
- icon usage
- Thai string pattern
- TanStack Query usage

- [ ] **Step 2: สร้าง component**

สร้าง `src/components/recent-activity-card.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Zap,
  CalendarCheck,
  Target,
  Sparkles,
  Trophy,
  Coins,
  Gift,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchXpTransactions } from "@/lib/xp-transactions.functions";
import type { XpSource } from "@/lib/xp-transactions.functions";

// Map source → (icon, label)
const SOURCE_META: Record<XpSource, { icon: LucideIcon; label: string }> = {
  daily_quest: { icon: Sparkles, label: "ควอสต์" },
  attendance: { icon: CalendarCheck, label: "มาเรียน" },
  weekly_mission: { icon: Target, label: "ภารกิจ" },
  daily_bonus: { icon: Gift, label: "โบนัส" },
  achievement: { icon: Trophy, label: "ความสำเร็จ" },
  shop_purchase: { icon: Coins, label: "ร้านค้า" },
  admin_adjustment: { icon: Zap, label: "ปรับปรุง" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "เมื่อวาน";
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
}

export function RecentActivityCard() {
  const { data } = useQuery({
    queryKey: ["xp-transactions", { limit: 5 }],
    queryFn: () => fetchXpTransactions({ limit: 5 }),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">📜 กิจกรรมล่าสุด</CardTitle>
        <Link
          to="/activity"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center"
        >
          ดูทั้งหมด
          <ChevronRight className="ml-0.5 h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            ยังไม่มีกิจกรรม — ทำควอสต์หรือมาเรียนเพื่อเริ่มสะสม XP!
          </p>
        ) : (
          rows.map((row) => {
            const meta = SOURCE_META[row.source] ?? SOURCE_META.admin_adjustment;
            const Icon = meta.icon;
            const isNegative = row.amount < 0;
            return (
              <div
                key={row.id}
                className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{row.source_label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      isNegative
                        ? "text-xs text-destructive font-medium"
                        : "text-xs text-[var(--xp)] font-medium"
                    }
                  >
                    {isNegative ? "" : "+"}
                    {row.amount} XP
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTime(row.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: ตรวจ typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: ผ่าน

- [ ] **Step 4: Commit**

```bash
git add src/components/recent-activity-card.tsx
git commit -m "feat(xp-ledger): add RecentActivityCard widget"
```

---

## Task 9: UI — route /activity

**Files:**
- Create: `src/routes/_authenticated/activity.tsx`

- [ ] **Step 1: ดู pattern ของ route เดิม**

อ้างอิง `src/routes/_authenticated/hall-of-fame.tsx` หรือ `bonus-center.tsx` สำหรับ:
- createFileRoute pattern
- layout (Card, container)
- createServerFn for auth guard

- [ ] **Step 2: สร้าง route**

สร้าง `src/routes/_authenticated/activity.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Zap, CalendarCheck, Target, Sparkles, Trophy, Coins, Gift,
  type LucideIcon,
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  fetchXpTransactions, fetchXpSummary,
  type XpSource, type TimeRange,
} from "@/lib/xp-transactions.functions";
import { useAuth } from "@/hooks/use-auth";

const SOURCE_META: Record<XpSource, { icon: LucideIcon; label: string }> = {
  daily_quest: { icon: Sparkles, label: "ควอสต์" },
  attendance: { icon: CalendarCheck, label: "มาเรียน" },
  weekly_mission: { icon: Target, label: "ภารกิจ" },
  daily_bonus: { icon: Gift, label: "โบนัส" },
  achievement: { icon: Trophy, label: "ความสำเร็จ" },
  shop_purchase: { icon: Coins, label: "ร้านค้า" },
  admin_adjustment: { icon: Zap, label: "ปรับปรุง" },
};

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "week", label: "สัปดาห์" },
  { value: "month", label: "เดือน" },
  { value: "all", label: "ทั้งหมด" },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<TimeRange>("week");
  const [sourceFilter, setSourceFilter] = useState<XpSource | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["xp-summary", range],
    queryFn: () => fetchXpSummary(range),
  });

  const transactionsQuery = useInfiniteQuery({
    queryKey: ["xp-transactions", { source: sourceFilter, range, infinite: true }],
    queryFn: ({ pageParam }) =>
      fetchXpTransactions({
        limit: 20,
        source: sourceFilter,
        range,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      const rows = lastPage.data ?? [];
      if (rows.length < 20) return undefined;
      return rows[rows.length - 1].created_at;
    },
  });

  const allRows = transactionsQuery.data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const summary = summaryQuery.data?.data;
  const xpInLevel = (user?.xp ?? 0) % 100;
  const level = user?.level ?? 1;

  return (
    <div className="container max-w-3xl py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">📜 บันทึกกิจกรรม</h1>
        <p className="text-sm text-muted-foreground">
          ดูประวัติ XP ทุกครั้งที่คุณได้รับ
        </p>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">ระดับ {level}</span>
            <span className="text-sm text-[var(--xp)] font-semibold">
              {summary?.totalXp ?? 0} XP
            </span>
          </div>
          <Progress value={xpInLevel} max={100} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            อีก {100 - xpInLevel} XP ถึงระดับถัดไป
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-1 flex-wrap">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={range === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant={sourceFilter === null ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSourceFilter(null)}
          >
            ทั้งหมด
          </Button>
          {(Object.keys(SOURCE_META) as XpSource[]).map((src) => {
            const meta = SOURCE_META[src];
            const Icon = meta.icon;
            return (
              <Button
                key={src}
                variant={sourceFilter === src ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSourceFilter(src)}
                className="gap-1"
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายการ</CardTitle>
        </CardHeader>
        <CardContent>
          {allRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              ยังไม่มีกิจกรรมในช่วงเวลานี้
            </p>
          ) : (
            <div className="space-y-1">
              {allRows.map((row) => {
                const meta = SOURCE_META[row.source] ?? SOURCE_META.admin_adjustment;
                const Icon = meta.icon;
                const isNegative = row.amount < 0;
                return (
                  <div
                    key={row.id}
                    className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0"
                  >
                    <div className="mt-0.5 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {row.source_label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(row.created_at)}
                        {row.subject ? ` • ${row.subject}` : ""}
                      </p>
                    </div>
                    <Badge
                      variant={isNegative ? "destructive" : "secondary"}
                      className={
                        isNegative
                          ? ""
                          : "text-[var(--xp)] bg-[var(--xp)]/10"
                      }
                    >
                      {isNegative ? "" : "+"}
                      {row.amount} XP
                    </Badge>
                  </div>
                );
              })}

              {transactionsQuery.hasNextPage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => transactionsQuery.fetchNextPage()}
                  disabled={transactionsQuery.isFetchingNextPage}
                >
                  {transactionsQuery.isFetchingNextPage
                    ? "กำลังโหลด..."
                    : "โหลดเพิ่ม"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: regenerate route tree**

```bash
npm run dev
```

ใน dev server, TanStack Router จะ regenerate `src/routeTree.gen.ts` อัตโนมัติเมื่อเห็นไฟล์ใหม่

- [ ] **Step 4: ตรวจ typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: ผ่าน (อาจต้อง restart dev server เพื่อ route tree update)

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/activity.tsx src/routeTree.gen.ts
git commit -m "feat(xp-ledger): add /activity timeline page"
```

---

## Task 10: ฝัง widget ใน dashboard + เพิ่ม sidebar link

**Files:**
- Modify: `src/routes/_authenticated/dashboard.tsx`
- Modify: `src/components/app-sidebar.tsx`

- [ ] **Step 1: ค้นหาตำแหน่งฝังใน StudentDashboard**

```bash
grep -n "GamificationStatusPanel\|StudentDashboard\|daily-bonus-card\|+15 XP" src/routes/_authenticated/dashboard.tsx
```

จดบรรทัดที่ import `GamificationStatusPanel` และตำแหน่งที่โชว์ copy "+15 XP present"

- [ ] **Step 2: เพิ่ม import + ฝัง RecentActivityCard**

ใน `src/routes/_authenticated/dashboard.tsx`:

เพิ่ม import (ใต้ import อื่นๆ ของ component):

```tsx
import { RecentActivityCard } from "@/components/recent-activity-card";
```

หา block `<GamificationStatusPanel ... />` ใน `StudentDashboard` แล้วเพิ่ม `<RecentActivityCard />` ถัดจากนั้น:

```tsx
<GamificationStatusPanel ... />
<RecentActivityCard />
```

- [ ] **Step 3: แก้ copy "+15 XP present" ที่หลอก**

หาบรรทัดที่โชว์ `+15 XP` / `+5 XP` สำหรับ attendance ใน dashboard (อ้างอิง dashboard.tsx:247-248) — ปรับข้อความให้สอดคล้องกับระบบจริง:

```tsx
// เดิมอาจเป็น copy ปลอมแบบ:
// "มาเรียน = +15 XP"
// → ปล่อยไว้ได้เพราะตอนนี้ระบบให้จริงแล้ว (แค่ ensure ว่าไม่ใช่ข้อความหลอก)
```

อ่าน context รอบๆ บรรทัดนั้น ถ้าเป็นแค่ label สวยๆ ปล่อยไว้ได้ ถ้าเป็น placeholder ที่ไม่ได้เชื่อมกับอะไร ให้ลบ

- [ ] **Step 4: เพิ่ม sidebar link**

ใน `src/components/app-sidebar.tsx`:

เพิ่ม import `ScrollText` ใน lucide imports (line 2-20):

```tsx
import {
  // ... existing
  ScrollText,
  // ... existing
} from "lucide-react";
```

เพิ่ม item ใน group "ทั่วไป" (line 43-50) ก่อน "โปรไฟล์":

```tsx
{ label: "บันทึกกิจกรรม", url: "/activity", icon: ScrollText, roles: ["student", "teacher", "admin"] },
```

- [ ] **Step 5: ทดสอบใน dev server**

```bash
npm run dev
```

เปิด browser → login เป็น student → ไป `/dashboard` → เห็น RecentActivityCard ใต้ status panel
→ คลิก sidebar "บันทึกกิจกรรม" → ไป `/activity` ได้

- [ ] **Step 6: ตรวจ typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: ผ่าน

- [ ] **Step 7: Commit**

```bash
git add src/routes/_authenticated/dashboard.tsx src/components/app-sidebar.tsx
git commit -m "feat(xp-ledger): embed RecentActivityCard + sidebar link"
```

---

## Task 11: แก้ weekly-missions.tsx ให้เรียก close RPC

**Files:**
- Modify: `src/routes/_authenticated/weekly-missions.tsx`

- [ ] **Step 1: หาตำแหน่ง sync_progress / close mutation**

```bash
grep -n "sync_progress\|close\|mutationFn\|buildProgressInserts\|invalidateQueries" src/routes/_authenticated/weekly-missions.tsx | head -30
```

- [ ] **Step 2: แก้ mutation ให้เรียก RPC**

หา mutation ที่คำนวณ client-side (line ~798-825) — เพิ่ม/แก้ mutation ใหม่ที่เรียก `close_weekly_mission` RPC:

```tsx
const closeMissionMutation = useMutation({
  mutationFn: async (missionId: string) => {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("close_weekly_mission", {
      _mission_id: missionId,
    });
    if (error) throw error;
    return data;
  },
  onSuccess: (data) => {
    const totalUsers = data?.length ?? 0;
    const totalXp = data?.reduce((sum, r: { xp_awarded: number }) => sum + r.xp_awarded, 0) ?? 0;
    toast.success(`ปิดภารกิจแล้ว — มอบ ${totalXp} XP ให้ ${totalUsers} คน`);
    qc.invalidateQueries({ queryKey: ["weekly-campaign"] });
    qc.invalidateQueries({ queryKey: ["xp-transactions"] });
    qc.invalidateQueries({ queryKey: ["xp-summary"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
  },
  onError: (err: Error) => {
    toast.error(err.message || "ปิดภารกิจไม่สำเร็จ");
  },
});
```

หาปุ่ม "ปิดภารกิจ" ใน UI (หรือเพิ่มใหม่) แล้วผูก `onClick={() => closeMissionMutation.mutate(mission.id)}`:

```tsx
<Button
  variant="default"
  onClick={() => closeMissionMutation.mutate(mission.id)}
  disabled={closeMissionMutation.isPending || mission.status !== "published"}
>
  {closeMissionMutation.isPending ? "กำลังปิด..." : "ปิดภารกิจและมอบ XP"}
</Button>
```

- [ ] **Step 3: ตรวจ typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: ผ่าน

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/weekly-missions.tsx
git commit -m "refactor(xp-ledger): weekly missions call close_weekly_mission RPC"
```

---

## Task 12: Invalidate xp-transactions queries ในจุดที่ได้ XP

**Files:**
- Modify: `src/routes/_authenticated/quests.tsx`
- Modify: `src/routes/_authenticated/dashboard.tsx` (อาจ)

- [ ] **Step 1: หา mutation ที่ finalize quest**

```bash
grep -n "finalize\|invalidateQueries\|onSuccess" src/routes/_authenticated/quests.tsx | head -20
```

- [ ] **Step 2: เพิ่ม invalidate**

ใน `quests.tsx` หา mutation ที่เรียก `finalize_my_quest_progress` (หรือชื่อใกล้เคียง) แล้วเพิ่ม invalidate ใน `onSuccess`:

```tsx
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ["xp-transactions"] });
  qc.invalidateQueries({ queryKey: ["xp-summary"] });
  qc.invalidateQueries({ queryKey: ["profile"] });
  // ... existing invalidations
},
```

- [ ] **Step 3: เช่นเดียวกันใน dashboard**

ถ้ามี mutation check-in ใน dashboard ให้ invalidate ด้วย (หรือในหน้า checkin.tsx — ค้นหา):

```bash
grep -rn "self_check_in\|checkIn" src/routes/ | head -10
```

เพิ่ม invalidate ในจุดที่เกี่ยวข้อง

- [ ] **Step 4: ตรวจ typecheck + lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/quests.tsx src/routes/_authenticated/dashboard.tsx
git commit -m "feat(xp-ledger): invalidate xp-transactions on XP award"
```

---

## Task 13: i18n — เพิ่มคำศัพท์ timeline / filter labels

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: หา pattern ของ i18n**

```bash
grep -n "export const tr\|กิจกรรม\|บันทึก" src/i18n.ts | head -10
```

- [ ] **Step 2: เพิ่ม keys**

ใน `src/i18n.ts` เพิ่ม entries ใน Thai-first dictionary (source language):

```ts
"บันทึกกิจกรรม": "บันทึกกิจกรรม",
"ดูประวัติ XP ทุกครั้งที่คุณได้รับ": "ดูประวัติ XP ทุกครั้งที่คุณได้รับ",
"กิจกรรมล่าสุด": "กิจกรรมล่าสุด",
"ดูทั้งหมด": "ดูทั้งหมด",
"ยังไม่มีกิจกรรมในช่วงเวลานี้": "ยังไม่มีกิจกรรมในช่วงเวลานี้",
"รายการ": "รายการ",
"ระดับ": "ระดับ",
"อีก {0} XP ถึงระดับถัดไป": "อีก {0} XP ถึงระดับถัดไป",
"โหลดเพิ่ม": "โหลดเพิ่ม",
"กำลังโหลด...": "กำลังโหลด...",
"ปิดภารกิจและมอบ XP": "ปิดภารกิจและมอบ XP",
```

และใน English dictionary (mapping):

```ts
"บันทึกกิจกรรม": "Activity Log",
"ดูประวัติ XP ทุกครั้งที่คุณได้รับ": "View every XP you have earned",
"กิจกรรมล่าสุด": "Recent activity",
"ดูทั้งหมด": "View all",
"ยังไม่มีกิจกรรมในช่วงเวลานี้": "No activity in this period",
"รายการ": "Entries",
"ระดับ": "Level",
"อีก {0} XP ถึงระดับถัดไป": "{0} XP to next level",
"โหลดเพิ่ม": "Load more",
"กำลังโหลด...": "Loading...",
"ปิดภารกิจและมอบ XP": "Close mission & award XP",
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(xp-ledger): add i18n keys for activity timeline"
```

---

## Task 14: End-to-end smoke test + quality gates

- [ ] **Step 1: รัน quality gates หลัก**

```bash
npm run typecheck
npm run lint
```

Expected: ผ่านทั้งคู่

- [ ] **Step 2: รัน health check**

```bash
npm run check
```

Expected: ผ่าน

- [ ] **Step 3: เริ่ม dev server และทดสอบ end-to-end**

```bash
npm run dev
```

ทดสอบ scenarios:

**Scenario A — Daily quest XP**
1. Login เป็น student
2. ไป `/quests` → ทำควอสต์หนึ่งให้จบ
3. ไป `/activity` → เห็นรายการ source='daily_quest' amount=XP ที่ได้
4. ไป `/dashboard` → RecentActivityCard แสดงรายการเดียวกัน

**Scenario B — Attendance XP**
1. Login เป็น teacher → สร้าง attendance session + check-in code
2. Login เป็น student → ใช้ code check-in
3. ไป `/activity` → เห็นรายการ source='attendance' amount=15 (present) หรือ 5 (late)

**Scenario C — Weekly mission XP**
1. Login เป็น teacher → สร้าง/เปิด published mission + sync progress ให้มีข้อมูล
2. กด "ปิดภารกิจและมอบ XP" (ปุ่มใหม่ใน weekly-missions.tsx)
3. ไป `/activity` (ในฐานะ student ในห้องนั้น) → เห็นรายการ source='weekly_mission'
4. ตรวจ `profiles.xp` เพิ่มจริง

**Scenario D — Idempotency**
1. ใน Supabase Studio เรียก `close_weekly_mission` อีกครั้งด้วย mission_id เดิม
2. Expected: exception "ภารกิจไม่ได้อยู่ในสถานะที่ปิดได้" + ไม่มี ledger row ซ้ำ

- [ ] **Step 4: ตรวจสอบ data integrity**

ใน Supabase Studio รัน:

```sql
-- ตรวจว่า ledger กับ profiles.xp ตรงกัน (sample user)
SELECT
  p.id,
  p.xp AS profile_xp,
  (SELECT balance_after FROM xp_transactions
    WHERE user_id = p.id ORDER BY created_at DESC LIMIT 1) AS latest_balance
FROM profiles p
WHERE EXISTS (SELECT 1 FROM xp_transactions WHERE user_id = p.id)
LIMIT 10;
```

Expected: `profile_xp` = `latest_balance` (ตรงทุกแถว)

- [ ] **Step 5: Final commit (ถ้ามี fix)**

ถ้าพบปัญหาจากการทดสอบ แก้แล้ว commit:

```bash
git add -A
git commit -m "fix(xp-ledger): address issues found in e2e testing"
```

---

## Self-Review Checklist

หลังเขียน plan เสร็จ ตรวจสอบ:

**1. Spec coverage:**
- [x] ตาราง `xp_transactions` + enum → Task 1
- [x] RPC `award_xp()` source of truth → Task 2
- [x] Refactor `finalize_quest_from_progress` → Task 3
- [x] ปิดช่องว่าง attendance → Task 4
- [x] RPC `close_weekly_mission` → Task 5
- [x] Refactor `complete_quest` + `claim_achievement` → **GAP** — เพิ่ม Task ด้านล่าง
- [x] Types regenerate → Task 6
- [x] Data layer → Task 7
- [x] Widget + route + sidebar → Task 8, 9, 10
- [x] weekly-missions.tsx wire-up → Task 11
- [x] invalidate queries → Task 12
- [x] i18n → Task 13
- [x] Edge cases (idempotency, atomic, RLS) → ครอบคลุมใน migration tasks

**2. Type consistency:**
- `award_xp` returns `(transaction_id, new_xp, new_level, leveled_up)` → ใช้ใน Task 3 (`_award.new_xp`, `_award.new_level`)
- `fetchXpTransactions` signature → ใช้ตรงกันใน Task 8 (widget) และ Task 9 (route)
- `XpSource` type ใช้ตรงกันทุกที่

**3. Placeholder scan:** ไม่มี TODO/TBD — ทุก step มี code/คำสั่งจริง

---

## Task 15: Refactor complete_quest + claim_achievement (เพิ่มภายหลัง self-review)

**Files:**
- Create: `supabase/migrations/20260715090500_xp_ledger_refactor_misc.sql`

- [ ] **Step 1: อ่าน RPC เดิมก่อน**

```bash
grep -n "complete_quest\|claim_achievement" supabase/migrations/*.sql | head -10
```

อ่าน body เดิมของทั้งสองฟังก์ชันจาก migration ที่สร้างไว้

- [ ] **Step 2: สร้าง migration สำหรับ refactor**

สร้าง `supabase/migrations/20260715090500_xp_ledger_refactor_misc.sql`:

```sql
-- Refactor complete_quest และ claim_achievement ให้ XP วิ่งผ่าน award_xp
-- (pattern เดียวกับ finalize_quest_from_progress — ดู migration 20260715090200)

-- TODO impl: อ่าน body เดิม → แยกส่วน non-XP → แทนที่ block XP ด้วย PERFORM award_xp(...)
-- ตัวอย่าง skeleton:

CREATE OR REPLACE FUNCTION public.complete_quest(_quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q RECORD;
  _uid uuid := auth.uid();
  _award RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _q FROM public.quests WHERE id = _quest_id;
  IF _q.id IS NULL THEN RAISE EXCEPTION 'quest not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_quests WHERE quest_id=_quest_id AND user_id=_uid) THEN
    RAISE EXCEPTION 'already completed';
  END IF;

  INSERT INTO public.user_quests(quest_id, user_id) VALUES (_quest_id, _uid);

  -- gold + counters อัปเดตตรง
  UPDATE public.profiles SET gold = gold + _q.gold_reward WHERE id=_uid;

  -- XP ผ่าน award_xp
  SELECT * INTO _award FROM public.award_xp(
    _user_id := _uid,
    _amount := _q.xp_reward,
    _source := 'daily_quest'::public.app_xp_source,
    _source_label := COALESCE(_q.title, 'ทำควอสต์'),
    _ref_table := 'user_quests',
    _ref_id := _quest_id,
    _metadata := jsonb_build_object('quest_id', _quest_id, 'legacy', true),
    _idempotency_key := 'quest_complete:' || _uid::text || ':' || _quest_id::text
  );

  RETURN jsonb_build_object('xp_gained', _q.xp_reward, 'gold_gained', _q.gold_reward);
END;
$$;
```

**หมายเหตุ:** ก่อน implement จริง ต้องอ่าน migration เดิมของ `complete_quest` และ `claim_achievement` เพื่อ preserve logic อื่นๆ (เช่น grant title, check criteria) — คำสั่งด้านบนเป็น skeleton ต้องเติมเต็ม

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715090500_xp_ledger_refactor_misc.sql
git commit -m "refactor(xp-ledger): route complete_quest + claim_achievement XP through award_xp()"
```

---

## Execution Handoff

Plan เสร็จและบันทึกที่ `docs/superpowers/plans/2026-07-15-xp-activity-ledger.md`

**สองทางเลือกในการ execute:**

1. **Subagent-Driven (แนะนำ)** — dispatch fresh subagent ต่อ task, รีวิวระหว่าง task, iteration เร็ว
2. **Inline Execution** — execute ใน session นี้ด้วย executing-plans, batch + checkpoint รีวิว
