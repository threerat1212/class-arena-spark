# XP Activity Ledger — Design Spec

> **วันที่:** 2026-07-15
> **โปรเจกต์:** Scholar Hall (class-arena-spark)
> **โปรเจกต์ย่อย:** A (จากชุด A=Ledger / B=Skill Tree / C=Seasonal Events)
> **สถานะ:** อนุมัติ design แล้วใน brainstorming — รอ implementation plan
> **เกี่ยวข้องกับ:** `2026-06-03-weekly-gamification-system-design.md`

---

## 1. บทนำและเหตุผล

### ปัญหา
ระบบ gamification ของ Scholar Hall "ครบและเป็นผู้ใหญ่" แต่มี **ช่องว่างความถูกต้อง**:

1. **XP จากการมาเรียนเป็นของปลอม** — `dashboard.tsx` แสดง `+15 XP present / +5 XP late` แต่ RPC `self_check_in` (`20260527063930_...sql`) ไม่ได้ UPDATE `profiles.xp` จริง
2. **XP จาก weekly mission ไม่ไหลเข้าระบบ** — `mission_progress` คำนวณ `*_xp_awarded` ไว้ แต่ sync mutation (`weekly-missions.tsx:798`) คำนวณ client-side แล้วไม่เคย UPDATE `profiles.xp`
3. **ไม่มีประวัติ XP** — `profiles.xp` เป็น `int` ตัวเดียวที่ถูกเขียนทับ ไม่มี audit log ว่า XP มาจากไหน (ROADMAP item 2: "activity audit log" ยังไม่ทำ)
4. **นักเรียนมองไม่เห็นประวัติตัวเอง** — ไม่มี timeline แสดงว่าได้ XP จากอะไรบ้าง

### เป้าหมาย
สร้าง **XP Activity Ledger** — ตาราง append-only ที่บันทึกทุกครั้งที่ได้ XP และทำให้ ledger เป็น source of truth ควบคู่กับ `profiles.xp` (sync ใน transaction เดียวกันเสมอ) พร้อมปิดช่องว่าง XP ของ attendance + weekly mission และเพิ่ม UI timeline ให้นักเรียนเห็นประวัติตัวเอง

### หลักการออกแบบ (จาก `PRODUCT.md`)
- **"Calm classroom energy, use gamification as feedback not visual noise"** — ใช้ visual vocabulary เดิม ไม่สร้าง animation system ใหม่
- **Thai-first** — ทุก label ภาษาไทย ผ่าน `tr(...)` จาก `src/i18n.ts`
- **"Teacher-as-judge"** (จาก spec weekly gamification) — XP จาก mission ออกตอนครูปิด mission ไม่ใช่ realtime

---

## 2. ขอบเขต (Scope)

### ในขอบเขต (In scope)
- ตาราง `xp_transactions` + enum `app_xp_source`
- RPC กลาง `award_xp()` (SECURITY DEFINER) เป็นประตูเดียวในการให้ XP
- Refactor RPC เดิมให้เรียกผ่าน `award_xp()`: `finalize_quest_from_progress`, `complete_quest`, `claim_achievement`
- ปิดช่องว่าง XP: attendance (แก้ `self_check_in`), weekly mission (RPC ใหม่ `close_weekly_mission`)
- UI: route `/activity` (หน้าเต็ม) + widget ใน `StudentDashboard`
- ลบ copy ปลอม "+15 XP present" ใน dashboard

### นอกขอบเขต (Out of scope — YAGNI)
- ❌ XP จาก flashcard / live quiz (รอบถัดไป)
- ❌ กราฟแนวโน้ม XP รายวัน/สัปดาห์ (เก็บไว้ทำใน Skill Tree — โปรเจกต์ B)
- ❌ CSV export / หน้า admin audit (ROADMAP item 2 — รอบแยก)
- ❌ Push notification ทุกครั้งที่ได้ XP (ใช้ toast เดิม กัน noise)
- ❌ Backfill ข้อมูลย้อนหลัง — เริ่มนับใหม่ตั้งแต่วันเปิดใช้งาน
- ❌ Skill Tree (B) / Seasonal Events (C) — โปรเจกต์ย่อยถัดไป แต่ column ใน ledger เตรียมไว้ให้แล้ว

---

## 3. Data Model

### 3.1 Enum ใหม่ `app_xp_source`

```sql
CREATE TYPE public.app_xp_source AS ENUM (
  'daily_quest',       -- ทำควอสต์รายวัน / legacy quest
  'attendance',        -- มาเรียน (present / late)
  'weekly_mission',    -- ภารกิจรายสัปดาห์ (ออกตอนปิด mission)
  'daily_bonus',       -- รับโบนัสประจำวัน (อนาคต — ตอนนี้ให้ gold อย่างเดียว แต่เผื่อไว้)
  'achievement',       -- รับ achievement reward
  'shop_purchase',     -- ใช้ใน shop (refund กรณี) — เผื่อไว้
  'admin_adjustment'   -- admin ปรับ XP มือ
);
```

### 3.2 ตารางใหม่ `xp_transactions` (append-only)

```sql
CREATE TABLE public.xp_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount          int  NOT NULL,                      -- +ได้ / -หัก (ค่าลบ = ปรับลด)
  source          public.app_xp_source NOT NULL,
  source_label    text NOT NULL,                      -- "ทำควอสต์: เรขาคณิต" / "มาเรียนตรงเวลา" (ไทย)
  subject         text,                               -- แท็กวิชา (เตรียม Skill Tree รอบ B) — nullable
  ref_table       text,                               -- 'daily_quest_attempts' (soft ref, ไม่ FK เพราะหลายต้นทาง)
  ref_id          uuid,                               -- id ของ record ต้นทาง
  classroom_id    uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  balance_after   int  NOT NULL,                      -- snapshot profiles.xp หลังรายการนี้ (audit)
  metadata        jsonb NOT NULL DEFAULT '{}',        -- payload เสริม เช่น { "perfect": true, "score": 8 }
  idempotency_key text,                               -- กันเรียกซ้ำ (NULL = ไม่ enforce; NOT NULL = unique per user)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- หมายเหตุ: idempotency_key เป็นคอลัมน์แยก (ไม่ใช่ใน metadata) เพื่อใช้ partial UNIQUE index ได้
-- source ที่ต้องการ idempotent ส่ง key แบบ deterministic มา (เช่น 'quest_finalize:user:quest')
-- source ที่ไม่ enforce (attendance delta, admin_adjustment) ส่ง NULL มา

-- Index สำหรับ timeline query (หลัก)
CREATE INDEX idx_xpt_user_time
  ON public.xp_transactions (user_id, created_at DESC);

-- Index สำหรับกรองตาม source
CREATE INDEX idx_xpt_user_source
  ON public.xp_transactions (user_id, source);

-- Idempotency: ป้องกันเรียกซ้ำ (partial unique index — NULL ได้หลายแถว)
CREATE UNIQUE INDEX uq_xpt_idempotency
  ON public.xp_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.xp_transactions ENABLE ROW LEVEL SECURITY;
```

### 3.3 RLS Policy

```sql
-- อ่าน: เฉพาะของตัวเอง หรือ admin
CREATE POLICY "xp_transactions read own or admin"
  ON public.xp_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ไม่สร้าง INSERT / UPDATE / DELETE policy
-- → ผู้ใช้ไม่สามารถเขียนตรงได้ ต้องผ่าน SECURITY DEFINER RPC เท่านั้น
```

**เหตุผล:** นักเรียนไม่สามารถปลอม XP ได้ เพราะ INSERT ledger ต้องผ่าน RPC `award_xp()` ที่รันในสิทธิ์เจ้าของฟังก์ชัน (ไม่ใช่สิทธิ์ caller)

---

## 4. RPC กลาง `award_xp()` — Source of Truth

### 4.1 Signature

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
RETURNS TABLE(transaction_id uuid, new_xp int, new_level int, leveled_up boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _current_xp int;
  _new_xp int;
  _new_level int;
  _old_level int;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF _amount = 0 THEN RAISE EXCEPTION 'amount must be non-zero'; END IF;

  -- 1. Idempotency: ถ้า key ซ้ำ return txn เดิม
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.xp_transactions
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key LIMIT 1;
    IF _existing IS NOT NULL THEN
      RETURN QUERY
        SELECT _existing,
               p.xp, p.level, false
        FROM public.profiles p WHERE p.id = _user_id;
      RETURN;
    END IF;
  END IF;

  -- 2. คำนวณ balance ใหม่ (clamp ที่ 0)
  SELECT xp, level INTO _current_xp, _old_level
    FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF _current_xp IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;
  _new_xp    := GREATEST(0, _current_xp + _amount);
  _new_level := GREATEST(_old_level, 1 + _new_xp / 100);

  -- 3. INSERT ledger + UPDATE profiles ใน transaction เดียวกัน (atomic)
  INSERT INTO public.xp_transactions
    (user_id, amount, source, source_label, subject, ref_table, ref_id,
     classroom_id, balance_after, metadata, idempotency_key)
  VALUES
    (_user_id, _amount, _source, _source_label, _subject, _ref_table, _ref_id,
     _classroom_id, _new_xp, _metadata, _idempotency_key)
  RETURNING id INTO _existing;

  UPDATE public.profiles
    SET xp = _new_xp, level = _new_level
    WHERE id = _user_id;

  -- 4. Sync classroom_scores (ถ้ามี classroom_id)
  IF _classroom_id IS NOT NULL AND _amount > 0 THEN
    INSERT INTO public.classroom_scores (classroom_id, user_id, xp, quests_completed, streak_days, perfect_scores)
    VALUES (_classroom_id, _user_id, _amount, 0, 0, 0)
    ON CONFLICT (classroom_id, user_id) DO UPDATE
      SET xp = public.classroom_scores.xp + EXCLUDED.xp,
          updated_at = now();
  END IF;

  RETURN QUERY SELECT _existing, _new_xp, _new_level, (_new_level > _old_level);
END;
$$;

-- Grant: เรียกจาก authenticated users เท่านั้น (ครูละนักเรียนเรียกผ่าน RPC wrapper)
-- RPC เดิมที่เป็น SECURITY DEFINER เรียก award_xp() ภายในได้โดยตรง
GRANT EXECUTE ON FUNCTION public.award_xp(...) TO authenticated;
```

### 4.2 คุณสมบัติสำคัญ

| คุณสมบัติ | รายละเอียด |
|---|---|
| **Atomic** | INSERT ledger + UPDATE profiles อยู่ใน transaction เดียวกัน → ledger กับ `profiles.xp` ตรงเสมอ |
| **Idempotent** | ถ้า `idempotency_key` ซ้ำ → return txn เดิม ไม่เพิ่ม XP สองครั้ง |
| **Anti-farming** | `FOR UPDATE` lock กัน race condition; clamp ที่ 0 กันติดลบ |
| **Audit-ready** | `balance_after` snapshot ทุกรายการ → reconstruct ยอดได้ทุกจุดเวลา |
| **เตรียมอนาคต** | `subject`, `classroom_id`, `created_at` column พร้อมให้ Skill Tree (B) และ Seasonal Events (C) ใช้ |

---

## 5. การปิดช่องว่าง XP

### 5.1 XP จากการมาเรียน (attendance)

**แก้ `self_check_in(p_code text)`** ใน migration ใหม่ (ไม่แก้ของเดิม):

```sql
CREATE OR REPLACE FUNCTION public.self_check_in(p_code text)
RETURNS TABLE(session_id uuid, status text, xp_gained int)
-- ...
DECLARE
  v_old_status attendance_status;
  v_xp_delta int;
  v_label text;
  v_subject text;
BEGIN
  -- ... ตรวจ session, membership เหมือนเดิม ...

  v_minutes := EXTRACT(EPOCH FROM (now() - v_session.check_in_opens_at)) / 60;
  v_status := CASE WHEN v_minutes > 5 THEN 'late' ELSE 'present' END;

  -- เก็บสถานะเดิมก่อน upsert (สำคัญ!)
  SELECT status INTO v_old_status FROM public.attendance_records
    WHERE session_id = v_session.id AND user_id = auth.uid();

  INSERT INTO public.attendance_records (session_id, user_id, status)
    VALUES (v_session.id, auth.uid(), v_status)
    ON CONFLICT (session_id, user_id) DO UPDATE SET status = EXCLUDED.status, marked_at = now();

  -- คำนวณ XP delta (รองรับการ re-grade: late→present ต้อง +10)
  v_xp_delta := CASE
    WHEN v_status = 'present' AND v_old_status IS DISTINCT FROM 'present' THEN
      CASE WHEN v_old_status = 'late' THEN 10 ELSE 15 END
    WHEN v_status = 'late' AND v_old_status IS DISTINCT FROM 'late' THEN
      CASE WHEN v_old_status = 'present' THEN -10 ELSE 5 END
    ELSE 0
  END;

  IF v_xp_delta != 0 THEN
    v_label   := CASE WHEN v_status = 'present' THEN 'มาเรียนตรงเวลา' ELSE 'มาเรียนสาย' END;
    v_subject := COALESCE(v_session.subject, 'การเข้าเรียน');  -- หรือดึงจาก classroom

    PERFORM public.award_xp(
      _user_id => auth.uid(),
      _amount => v_xp_delta,
      _source => 'attendance'::public.app_xp_source,
      _source_label => v_label,
      _subject => v_subject,
      _ref_table => 'attendance_records',
      _ref_id => NULL,  -- records ไม่มี id PK เป็น uuid; ใช้ composite (session_id, user_id) ใน metadata
      _classroom_id => v_session.classroom_id,
      _metadata => jsonb_build_object('session_id', v_session.id, 'status', v_status),
      _idempotency_key => NULL  -- ใช้ delta logic แทน idempotency (รองรับ re-grade)
    );
  END IF;

  RETURN QUERY SELECT v_session.id, v_status::text, v_xp_delta;
END;
```

**ตาราง XP ตามสถานะ:**

| สถานะ | XP ครั้งแรก | XP delta ถ้า re-grade |
|---|---|---|
| present | +15 | late→present: +10 |
| late | +5 | present→late: -10 |
| absent / excused | 0 | ไม่มีการเปลี่ยน |

**ข้อควรระวัง:** ไม่ใช้ `idempotency_key` แบบ fixed ที่นี่ เพราะต้องรองรับ re-grade (เปลี่ยนสถานะทีหลัง) → ใช้ delta logic แทน

### 5.2 XP จาก Weekly Mission — RPC ใหม่ `close_weekly_mission`

```sql
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
  IF _wm.id IS NULL THEN RAISE EXCEPTION 'mission not found'; END IF;

  -- สิทธิ์: ครูเจ้าของห้อง หรือ admin เท่านั้น
  IF NOT public.is_classroom_owner(_wm.classroom_id) AND NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปิดภารกิจ';
  END IF;

  -- ต้องอยู่ในสถานะ published ก่อน
  IF _wm.status != 'published' THEN
    RAISE EXCEPTION 'ภารกิจไม่ได้อยู่ในสถานะที่ปิดได้ (ต้องเป็น published)';
  END IF;

  -- ปิด mission
  UPDATE public.weekly_missions
    SET status = 'closed', closed_at = now()
    WHERE id = _mission_id;

  -- ดึง subject จาก main assignment (เตรียมให้ Skill Tree)
  SELECT c.subject INTO _main_subject
    FROM public.assignments a
    JOIN public.classrooms c ON c.id = a.classroom_id
    WHERE a.id = _wm.main_assignment_id;

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
        _user_id => _mp.user_id,
        _amount => _total_xp,
        _source => 'weekly_mission'::public.app_xp_source,
        _source_label => 'ภารกิจรายสัปดาห์',
        _subject => _main_subject,
        _ref_table => 'mission_progress',
        _ref_id => _mp.id,
        _classroom_id => _wm.classroom_id,
        _metadata => jsonb_build_object(
          'mission_id', _wm.id,
          'participation', _mp.participation_xp_awarded,
          'quality', _mp.quality_xp_awarded,
          'ai', _mp.ai_xp_awarded
        ),
        _idempotency_key => 'mission_close:' || _mission_id::text || ':' || _mp.user_id::text
      );

      RETURN QUERY SELECT _mp.user_id, _total_xp;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_weekly_mission(uuid) TO authenticated;
```

### 5.3 Refactor RPC ที่ให้ XP เดิมให้เรียกผ่าน `award_xp()`

#### `finalize_quest_from_progress` (`20260528065153_...sql:73-89`)

แทนที่ block `UPDATE profiles ... classroom_scores ...` ด้วย:

```sql
-- แยกส่วนที่ไม่ใช่ XP ออกมา update ตรง profiles ตามเดิม
UPDATE public.profiles
SET gold = gold + _gold,
    quests_completed = quests_completed + 1,
    perfect_scores = perfect_scores + CASE WHEN _is_perfect THEN 1 ELSE 0 END,
    streak_days = _new_streak,
    last_quest_date = _today
WHERE id = _user_id;

-- XP วิ่งผ่าน award_xp (atomic กับ ledger)
PERFORM public.award_xp(
  _user_id => _user_id,
  _amount => _xp,
  _source => 'daily_quest'::public.app_xp_source,
  _source_label => COALESCE(_q.title, 'ทำควอสต์รายวัน'),
  _subject => _q.subject,
  _ref_table => 'daily_quest_attempts',
  _ref_id => NULL,  -- attempt id ยังไม่มีตอนนี้; เก็บใน metadata
  _classroom_id => _q.classroom_id,
  _metadata => jsonb_build_object('quest_id', _quest_id, 'perfect', _is_perfect, 'score', _total, 'max_score', _max),
  _idempotency_key => 'quest_finalize:' || _user_id::text || ':' || _quest_id::text
);
```

**หมายเหตุ — ความซ้ำซ้อนของ `classroom_scores`:** `award_xp` จะ upsert `classroom_scores.xp` ให้แล้ว (ส่วน XP) ส่วน counters อื่น (`quests_completed`, `streak_days`, `perfect_scores`) ต้อง upsert แยกอีกครั้งด้วย `xp=0` เพื่อไม่ให้ XP ถูกนับสองครั้ง:

```sql
INSERT INTO public.classroom_scores (classroom_id, user_id, xp, quests_completed, streak_days, perfect_scores)
VALUES (_q.classroom_id, _user_id, 0, 1, _new_streak, CASE WHEN _is_perfect THEN 1 ELSE 0 END)
ON CONFLICT (classroom_id, user_id) DO UPDATE
SET quests_completed = public.classroom_scores.quests_completed + 1,
    streak_days = GREATEST(public.classroom_scores.streak_days, EXCLUDED.streak_days),
    perfect_scores = public.classroom_scores.perfect_scores + EXCLUDED.perfect_scores,
    updated_at = now();
```

#### `complete_quest` (legacy) และ `claim_achievement`
รูปแบบเดียวกัน — แยก non-XP updates, เรียก `award_xp` สำหรับส่วน XP (ส่วน gold ยัง UPDATE ตรงตามเดิม)

---

## 6. ไอเด็มโพเทนซีคีย์ (Idempotency Keys)

| source | idempotency_key pattern | หมายเหตุ |
|---|---|---|
| `daily_quest` | `quest_finalize:<user_id>:<quest_id>` | กัน finalize ซ้ำ |
| `weekly_mission` | `mission_close:<mission_id>:<user_id>` | กันครูกดปิดซ้ำ |
| `achievement` | `achievement:<user_id>:<achievement_code>` | กัน claim ซ้ำ |
| `attendance` | NULL | ใช้ delta logic รองรับ re-grade |
| `admin_adjustment` | NULL | admin ปรับซ้ำได้ |
| `shop_purchase` | NULL (refund) | — |

---

## 7. Edge Cases และความปลอดภัย

| Edge case | การจัดการ |
|---|---|
| XP ติดลบ (admin ปรับลด) | `amount` เป็นลบได้; balance clamp ที่ `GREATEST(0, xp + amount)` |
| นักเรียนถูกลบ | `ON DELETE CASCADE` ลบ ledger ทั้งหมดของ user นั้น |
| RPC fail ครึ่งทาง | INSERT + UPDATE ใน transaction เดียวกัน → rollback ทั้งคู่ |
| Race condition (เรียกพร้อมกัน) | `SELECT ... FOR UPDATE` ใน `award_xp` ล็อคแถว profiles |
| ครูปิด mission ซ้ำ | `idempotency_key` + status check (`status != 'published'` → exception) |
| Attendance re-grade (late→present) | Delta logic คำนวณส่วนต่าง; ไม่ใช้ fixed idempotency |
| นักเรียนพยายาม INSERT ledger ตรง | ไม่มี INSERT policy → RLS block; ต้องผ่าน SECURITY DEFINER RPC |
| Level ลดลงเมื่อ XP ถูกหัก | `level = GREATEST(level, 1 + xp/100)` — level ไม่ลด (เหมือนเดิม) |

---

## 8. Data Layer (TypeScript)

### 8.1 Types (`src/integrations/supabase/types.ts` — regenerate)
หลัง migration แล้ว run `supabase gen types` จะได้:
- `xp_transactions` Row type
- `app_xp_source` enum

### 8.2 `src/lib/xp-transactions.functions.ts` (ใหม่)

```ts
import { supabase } from "@/integrations/supabase/client";

export type XpSource =
  | "daily_quest" | "attendance" | "weekly_mission"
  | "daily_bonus" | "achievement" | "shop_purchase" | "admin_adjustment";

export type TimeRange = "today" | "week" | "month" | "all";

interface FetchXpTransactionsParams {
  limit?: number;
  source?: XpSource;
  range?: TimeRange;
  cursor?: string;  // created_at ของรายการสุดท้าย (infinite scroll)
}

export async function fetchXpTransactions(params: FetchXpTransactionsParams) {
  const { limit = 20, source, range, cursor } = params;
  let q = supabase.from("xp_transactions")
    .select("*")
    .order("created_at", { ascending: false });

  if (source) q = q.eq("source", source);
  if (cursor) q = q.lt("created_at", cursor);
  if (range) {
    const since = computeRangeStart(range);  // helper
    q = q.gte("created_at", since.toISOString());
  }
  return q.limit(limit);
}

export async function fetchXpSummary(range?: TimeRange) {
  // ใช้ RPC aggregate หรือ client-side sum (เลือก: aggregate ใน DB ดีกว่า)
  // ...
}
```

---

## 9. UI Design

### 9.1 Route ใหม่ `/activity` (`src/routes/_authenticated/activity.tsx`)

**Layout (ASCII mockup):**
```
┌─────────────────────────────────────────────────┐
│  📜 บันทึกกิจกรรม                                │
│  ─────────────────────────────────────────────  │
│  [วันนี้] [สัปดาห์] [เดือน] [ทั้งหมด]              │
│  แหล่ง: (ทั้งหมด) ควอสต์ มาเรียน ภารกิจ ความสำเร็จ│
│                                                 │
│  รวม 7 วัน: +145 XP        ━━━━━━━━━ ระดับ 8   │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ ●  15:42   +15 XP   ✅ มาเรียนตรงเวลา      │ │
│  │            เลขา  •  ห้อง ม.4/1              │ │
│  ├───────────────────────────────────────────┤ │
│  │ ●  14:10   +40 XP   🎯 ภารกิจ "สมการ"      │ │
│  │            ครูสมชายปิดภารกิจ                │ │
│  └───────────────────────────────────────────┘ │
│  [โหลดเพิ่ม...]                                 │
└─────────────────────────────────────────────────┘
```

**ฟีเจอร์:**
- กรองตาม source (chips toggle) และช่วงเวลา (segmented control)
- แสดงยอดรวมใน range + แถบความคืบหน้าเลเวล
- Infinite scroll (TanStack Query `useInfiniteQuery`, limit=20)
- แตะรายการ → navigate ไป source route (quest→`/quests`, mission→`/weekly-missions`)
- ใช้ `lucide-react`: `Zap`=XP, `CalendarCheck`=attendance, `Target`=mission, `Sparkles`=quest, `Trophy`=achievement, `Coins`=gold
- ใช้ `shadcn/ui`: `Card`, `Badge`, `Progress`, `ScrollArea`
- สีผ่าน CSS vars `--xp` (เขียว), `--gold` (เหลือง) ที่มีอยู่

### 9.2 Widget ใน `StudentDashboard` (`src/components/recent-activity-card.tsx`)

```
┌─────────────────────────────────┐
│  📜 กิจกรรมล่าสุด        ดูทั้งหมด │
│  ─────────────────────────────  │
│  +15 XP  ✅ มาเรียนตรงเวลา  15:42│
│  +40 XP  🎯 ภารกิจ "สมการ" 14:10│
│  +30 XP  ✨ ควอสต์: เรขา     09:30│
│  +5  💰  รับโบนัสประจำวัน   เมื่อวาน│
│  +50 XP  🏆 ความสำเร็จ: นักฆ่าต่อ│
└─────────────────────────────────┘
```

- Query key เดียวกับหน้าเต็ม (`["xp-transactions", { limit: 5 }]`) เพื่อ cache sharing
- "ดูทั้งหมด" → `navigate("/activity")`
- วางใต้ `GamificationStatusPanel` ใน `StudentDashboard`

### 9.3 Sidebar (`src/components/app-sidebar.tsx`)

เพิ่ม item "บันทึกกิจกรรม" ในกลุ่ม General, icon `ScrollText` หรือ `History`

### 9.4 Wire-up: invalidate queries

หลัง mutation ที่ได้ XP:
- `quests.tsx` หลัง finalize → `qc.invalidateQueries({ queryKey: ["xp-transactions"] })`
- `dashboard.tsx` หลัง `self_check_in` → invalidate
- `weekly-missions.tsx` หลัง `close_weekly_mission` → invalidate + toast `ได้ +40 XP ภารกิจรายสัปดาห์`
- `profile.tsx` / rewards → invalidate

### 9.5 ลบ copy ปลอม
ใน `dashboard.tsx:247-248` ลบ/แก้ข้อความ "+15 XP present / +5 XP late" ให้สอดคล้องกับระบบจริง (ตอนนี้ให้จริงแล้ว)

---

## 10. การเชื่อมต่อกับโปรเจกต์ถัดไป

### Skill Tree (โปรเจกต์ B)
- ใช้ `xp_transactions.subject` (GROUP BY) เพื่อคำนวณ XP แยกตามวิชา
- แสดงจุดแข็ง/จุดอ่อนตาม subject
- ต้องเพิ่มการ tag `subject` ใน `daily_quests` (อาจมีอยู่แล้วในบางคอลัมน์) และเวลาสร้าง quest

### Seasonal Events (โปรเจกต์ C)
- ใช้ `xp_transactions.created_at` + `classroom_id` เพื่อนับ XP ในช่วงเวลา/กลุ่มใดๆ
- `WHERE created_at BETWEEN season_start AND season_end AND classroom_id IN (...)`

---

## 11. ลำดับการ implement (Build Sequence)

1. **Migration 1:** enum + ตาราง `xp_transactions` + index + RLS policy
2. **Migration 2:** RPC `award_xp()` + grant
3. **Migration 3:** refactor `finalize_quest_from_progress`, `complete_quest`, `claim_achievement`, `self_check_in` ให้เรียก `award_xp`
4. **Migration 4:** RPC ใหม่ `close_weekly_mission`
5. **Types:** regenerate `src/integrations/supabase/types.ts`
6. **Data layer:** `src/lib/xp-transactions.functions.ts`
7. **UI:** `recent-activity-card.tsx` + route `activity.tsx`
8. **Integration:** ฝัง widget ใน dashboard + sidebar link + invalidate queries + ลบ copy ปลอม
9. **เปลี่ยน weekly-missions.tsx** ให้เรียก `close_weekly_mission` RPC แทน client-side sync
10. **ทดสอบ end-to-end:** ควอสต์ / มาเรียน / ปิด mission → เห็นใน ledger + XP ถูกต้อง + dashboard อัปเดต
11. **Quality gates:** `npm run typecheck && npm run lint && npm run check`

---

## 12. ไฟล์ที่จะกระทบ

### สร้างใหม่ (5)
| ไฟล์ | วัตถุประสงค์ |
|---|---|
| `supabase/migrations/<ts>_xp_activity_ledger.sql` | รวม migration 1-4 (หรือแยก 4 ไฟล์) |
| `src/lib/xp-transactions.functions.ts` | data fetching |
| `src/components/recent-activity-card.tsx` | widget 5 รายการล่าสุด |
| `src/routes/_authenticated/activity.tsx` | หน้า timeline เต็ม |
| `docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md` | เอกสารนี้ |

### แก้ไข (≈6)
| ไฟล์ | การแก้ |
|---|---|
| `src/integrations/supabase/types.ts` | regenerate จาก migration |
| `src/routes/_authenticated/dashboard.tsx` | ฝัง widget + ลบ copy ปลอม + invalidate |
| `src/routes/_authenticated/weekly-missions.tsx` | เรียก `close_weekly_mission` RPC แทน client-side sync |
| `src/routes/_authenticated/quests.tsx` | invalidate `["xp-transactions"]` |
| `src/components/app-sidebar.tsx` | เพิ่ม link "บันทึกกิจกรรม" |
| `src/i18n.ts` | เพิ่มคำศัพท์ timeline / filter labels |

---

## 13. ความเสี่ยงและการบรรเทา

| ความเสี่ยง | ระดับ | การบรรเทา |
|---|---|---|
| Refactor `finalize_quest_from_progress` ทำลาย flow เดิม | สูง | Migration แยก + เก็บ logging; ทดสอบกับข้อมูลจริงใน dev ก่อน deploy |
| Idempotency + re-grade ของ attendance ซับซ้อน | กลาง | Delta logic + test case ครอบคลุมทุก transition |
| Migration ใหญ่เกินไป | กลาง | แบ่งเป็น 4 migration เล็กๆ ตาม build sequence |
| Performance เมื่อ ledger โต | ต่ำ | Index `(user_id, created_at DESC)` + limit=20 + infinite scroll |
| `award_xp` กลายเป็น bottleneck | ต่ำ | `FOR UPDATE` lock สั้น; ไม่น่ามีปัญหาที่สเกลโรงเรียน |
| ข้อมูล types.ts regenerate ไม่ตรง | กลาง | รัน `supabase gen types` หลัง migration; typecheck จะ catch |

---

## 14. เกณฑ์ความสำเร็จ (Success Criteria)

- [ ] ตาราง `xp_transactions` สร้างแล้ว + RLS บล็อค INSERT ตรง
- [ ] `award_xp()` RPC ทำงาน atomic (INSERT + UPDATE สำเร็จหรือ fail พร้อมกัน)
- [ ] Idempotency กันเรียกซ้ำได้จริง
- [ ] ทำควอสต์ → XP เข้า ledger + `profiles.xp` ถูกต้อง + `dashboard` widget แสดง
- [ ] เช็คอินเข้าเรียน → +15/+5 XP เข้าจริง (ไม่ใช่แค่ copy)
- [ ] ครูปิด mission → นักเรียนทุกคนได้ XP รวม + กดปิดซ้ำไม่ได้
- [ ] หน้า `/activity` แสดง timeline กรองได้ + infinite scroll
- [ ] Widget ใน dashboard แสดง 5 รายการล่าสุด
- [ ] Copy "+15 XP present" ใน dashboard ถูกต้องแล้ว
- [ ] `npm run typecheck && npm run lint && npm run check` ผ่าน
- [ ] E2E ทดสอบครบ 3 sources (quest / attendance / mission)

---

*Spec นี้ได้รับการอนุมัติ design ใน brainstorming (ส่วน 1-4) — รอ user review ครั้งสุดท้ายก่อนส่งต่อไป writing-plans skill*
