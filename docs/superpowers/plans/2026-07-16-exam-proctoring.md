# Exam System with Proctoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างระบบสอบในเว็บพร้อมระบบ proctoring (ตรวจจับการโกง) สำหรับใช้สอบจริงสัปดาห์หน้า

**Architecture:** ระบบสอบใหม่ 5 ตาราง + 12 RPCs (SECURITY DEFINER + server-enforced time) + proctoring hook ฝั่ง client (visibility/blur/fullscreen tracking + auto-submit ครบ 5 violations) + 6 หน้า UI (mirror pattern ของ quiz.*) + AI grading สำหรับเติมคำสั้น

**Tech Stack:** Supabase (Postgres + RPC + RLS + Edge Functions), TanStack Start/Router/Query, React 19, shadcn/ui, sonner, lucide-react, i18n ไทย-first

**Spec:** `docs/superpowers/specs/2026-07-16-exam-proctoring-design.md`

**ข้อจำกัดสำคัญ:** Dev server ใช้ไม่ได้ตอนนี้ (MCP plugin ของ Lovable มี bug บน Windows) → verification หลักคือ `typecheck` + `build` + manual SQL test ใน Supabase Studio ภายหลัง

---

## File Structure

### สร้างใหม่
| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/<ts>_exam_schema.sql` | enum `'exam'` + 5 ตาราง + view + RLS + grants + realtime drop |
| `supabase/migrations/<ts>_exam_teacher_rpcs.sql` | create_exam, update_exam_questions, publish_exam, open_exam, close_exam, grade_short_answer |
| `supabase/migrations/<ts>_exam_student_rpcs.sql` | join_exam_by_code, start_exam_attempt, submit_exam_answer, submit_exam, record_exam_violation, auto_submit_exam |
| `src/hooks/use-exam-proctoring.ts` | proctoring hook (visibility/blur/fullscreen/copy/paste + RPC record) |
| `src/lib/exam.functions.ts` | client data layer (fetchExam, fetchExamQuestions, fetchParticipants, etc.) |
| `src/components/exam-timer-bar.tsx` | sticky countdown bar |
| `src/components/exam-violation-overlay.tsx` | violation counter overlay |
| `src/routes/_authenticated/exam.index.tsx` | ครู: รายการสอบในห้อง |
| `src/routes/_authenticated/exam.new.tsx` | ครู: ฟอร์มสร้างข้อสอบ |
| `src/routes/_authenticated/exam.$examId.tsx` | host dashboard + student exam screen |
| `src/routes/_authenticated/exam.join.tsx` | นักเรียน: กรอกรหัส 6 หลัก |
| `src/routes/_authenticated/exam.$examId.report.tsx` | ครู: รายงานคะแนน + CSV export |
| `supabase/functions/grade-exam-short-answers/index.ts` | AI grading edge function |
| `docs/superpowers/plans/2026-07-16-exam-proctoring.md` | เอกสารนี้ |

### แก้ไข
| ไฟล์ | การแก้ |
|---|---|
| `src/integrations/supabase/types.ts` | เพิ่ม exam_* tables + RPC signatures |
| `src/components/app-sidebar.tsx` | เพิ่ม link "การสอบ" |
| `src/routes/_authenticated/classrooms.$id.tsx` | เพิ่มแท็บ "การสอบ" |
| `src/i18n.ts` | เพิ่ม keys |

---

## Phase 1: Database Schema (Tasks 1)

### Task 1: Migration — Schema + RLS + View

**Files:**
- Create: `supabase/migrations/20260716090000_exam_schema.sql`

- [ ] **Step 1: สร้าง migration schema**

```sql
-- Exam System with Proctoring — schema
-- Spec: docs/superpowers/specs/2026-07-16-exam-proctoring-design.md

-- 1. Add 'exam' to app_xp_source enum (reuses XP Ledger)
ALTER TYPE public.app_xp_source ADD VALUE IF NOT EXISTS 'exam';

-- 2. exam_sessions
CREATE TABLE public.exam_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id        uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  host_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title               text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','active','closed')),
  join_code           char(6) NOT NULL UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(4),'hex'),1,6)),
  starts_at           timestamptz,
  ends_at             timestamptz,
  duration_minutes    int  NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 300),
  violation_threshold int  NOT NULL DEFAULT 5 CHECK (violation_threshold BETWEEN 1 AND 20),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_sessions_classroom ON public.exam_sessions (classroom_id, status);

-- 3. exam_questions
CREATE TABLE public.exam_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  idx             int  NOT NULL,
  question_type   text NOT NULL CHECK (question_type IN ('multiple_choice','short_answer')),
  question        text NOT NULL,
  options         jsonb,
  correct_idx     int,
  expected_answer text,
  points          int  NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idx)
);
CREATE INDEX idx_exam_questions_session ON public.exam_questions (session_id, idx);

-- 4. exam_participants
CREATE TABLE public.exam_participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at        timestamptz,
  submitted_at      timestamptz,
  total_score       int,
  violation_count   int  NOT NULL DEFAULT 0,
  auto_submitted    boolean NOT NULL DEFAULT false,
  auto_submit_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_exam_participants_session ON public.exam_participants (session_id);
CREATE INDEX idx_exam_participants_user ON public.exam_participants (user_id);

-- 5. exam_answers
CREATE TABLE public.exam_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL,
  user_id         uuid NOT NULL,
  answer_idx      int,
  answer_text     text,
  is_correct      boolean,
  score_awarded   int,
  graded_by       text CHECK (graded_by IN ('server','ai','teacher') OR graded_by IS NULL),
  graded_at       timestamptz,
  answered_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);
CREATE INDEX idx_exam_answers_session_user ON public.exam_answers (session_id, user_id);

-- 6. exam_proctoring_events (append-only)
CREATE TABLE public.exam_proctoring_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  event_type    text NOT NULL CHECK (event_type IN
                  ('tab_blur','window_blur','fullscreen_exit','copy_attempt','paste_attempt')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_proctoring_session_user
  ON public.exam_proctoring_events (session_id, user_id, created_at DESC);

-- 7. exam_questions_safe view (hide correct_idx + expected_answer unless host/admin/closed)
CREATE OR REPLACE VIEW public.exam_questions_safe
WITH (security_invoker = on) AS
SELECT q.id, q.session_id, q.idx, q.question_type, q.question, q.options,
       q.points, q.created_at,
  CASE
    WHEN s.host_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR s.status = 'closed'
    THEN q.correct_idx ELSE NULL
  END AS correct_idx,
  CASE
    WHEN s.host_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR s.status = 'closed'
    THEN q.expected_answer ELSE NULL
  END AS expected_answer
FROM public.exam_questions q
JOIN public.exam_sessions s ON s.id = q.session_id;

-- 8. RLS policies
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_sessions read classroom" ON public.exam_sessions FOR SELECT TO authenticated
  USING (public.is_classroom_member(classroom_id, auth.uid())
         OR host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "exam_sessions host write" ON public.exam_sessions FOR ALL TO authenticated
  USING (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_questions host only" ON public.exam_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "exam_questions host insert" ON public.exam_questions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "exam_questions host update" ON public.exam_questions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "exam_questions host delete" ON public.exam_questions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

ALTER TABLE public.exam_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_participants read own or host" ON public.exam_participants FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_answers read own or host" ON public.exam_answers FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

ALTER TABLE public.exam_proctoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_proctoring host read" ON public.exam_proctoring_events FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- 9. Realtime hardening: prevent peer answer/violation leaks
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.exam_answers;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.exam_proctoring_events;

-- 10. Grants (writes go through SECURITY DEFINER RPCs)
GRANT SELECT ON public.exam_sessions, public.exam_questions_safe,
                public.exam_participants, public.exam_answers,
                public.exam_proctoring_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_questions TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
```

- [ ] **Step 2: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน (migrations ไม่กระทบ typecheck — แค่ตรวจว่าไม่มี syntax error ใน .ts อื่นๆ)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716090000_exam_schema.sql
git commit -m "feat(exam): schema + RLS + safe view + grants"
```

---

## Phase 2: Teacher RPCs (Task 2)

### Task 2: Migration — Teacher RPCs

**Files:**
- Create: `supabase/migrations/20260716090100_exam_teacher_rpcs.sql`

- [ ] **Step 1: สร้าง migration พร้อม RPCs 6 ตัว**

```sql
-- Exam Teacher RPCs (SECURITY DEFINER)
-- Spec: docs/superpowers/specs/2026-07-16-exam-proctoring-design.md

-- 1. create_exam
CREATE OR REPLACE FUNCTION public.create_exam(
  _classroom_id uuid, _title text,
  _duration_minutes int DEFAULT 60, _violation_threshold int DEFAULT 5
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _host uuid := auth.uid();
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  IF NOT public.is_classroom_owner(_classroom_id, _host) AND NOT public.has_role(_host, 'admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์สร้างข้อสอบในห้องนี้';
  END IF;
  INSERT INTO public.exam_sessions (classroom_id, host_id, title, duration_minutes, violation_threshold)
  VALUES (_classroom_id, _host, _title, _duration_minutes, _violation_threshold)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_exam(uuid,text,int,int) TO authenticated;

-- 2. update_exam_questions (bulk upsert, draft only)
CREATE OR REPLACE FUNCTION public.update_exam_questions(_exam_id uuid, _questions jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text; q jsonb; _idx int;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF _status != 'draft' THEN RAISE EXCEPTION 'แก้ข้อสอบได้เฉพาะตอน draft'; END IF;
  PERFORM 1 FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF NOT FOUND AND NOT public.has_role(_host,'admin') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์';
  END IF;
  DELETE FROM public.exam_questions WHERE session_id=_exam_id;
  FOR q IN SELECT * FROM jsonb_array_elements(_questions) LOOP
    _idx := (q->>'idx')::int;
    INSERT INTO public.exam_questions (session_id, idx, question_type, question, options, correct_idx, expected_answer, points)
    VALUES (
      _exam_id, _idx,
      q->>'question_type', q->>'question',
      q->'options', (q->>'correct_idx')::int, q->>'expected_answer',
      COALESCE((q->>'points')::int, 1)
    );
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.update_exam_questions(uuid,jsonb) TO authenticated;

-- 3. publish_exam (draft → scheduled)
CREATE OR REPLACE FUNCTION public.publish_exam(
  _exam_id uuid, _starts_at timestamptz, _ends_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  IF _starts_at >= _ends_at THEN RAISE EXCEPTION 'เวลาเริ่มต้องก่อนเวลาหมด'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบหรือไม่มีสิทธิ์'; END IF;
  IF _status != 'draft' THEN RAISE EXCEPTION 'ต้องเป็น draft เท่านั้น'; END IF;
  UPDATE public.exam_sessions SET status='scheduled', starts_at=_starts_at, ends_at=_ends_at
    WHERE id=_exam_id;
END $$;
GRANT EXECUTE ON FUNCTION public.publish_exam(uuid,timestamptz,timestamptz) TO authenticated;

-- 4. open_exam (scheduled → active)
CREATE OR REPLACE FUNCTION public.open_exam(_exam_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบหรือไม่มีสิทธิ์'; END IF;
  IF _status != 'scheduled' THEN RAISE EXCEPTION 'ต้องเป็น scheduled เท่านั้น'; END IF;
  UPDATE public.exam_sessions SET status='active' WHERE id=_exam_id;
END $$;
GRANT EXECUTE ON FUNCTION public.open_exam(uuid) TO authenticated;

-- 5. grade_short_answer (called by AI edge function or teacher)
CREATE OR REPLACE FUNCTION public.grade_short_answer(
  _question_id uuid, _user_id uuid, _is_correct boolean, _score int, _graded_by text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _session_id uuid; _host uuid := auth.uid();
BEGIN
  -- Edge function calls this with service_role (auth.uid() is null but service_role bypasses RLS)
  -- For teacher calls, enforce host check
  SELECT session_id INTO _session_id FROM public.exam_questions WHERE id=_question_id;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF _host IS NOT NULL AND _graded_by='teacher' THEN
    PERFORM 1 FROM public.exam_sessions s WHERE s.id=_session_id
      AND (s.host_id=_host OR public.has_role(_host,'admin'));
    IF NOT FOUND THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ตรวจ'; END IF;
  END IF;
  UPDATE public.exam_answers
    SET is_correct=_is_correct, score_awarded=_score, graded_by=_graded_by, graded_at=now()
    WHERE question_id=_question_id AND user_id=_user_id;
  -- recompute participant total_score
  UPDATE public.exam_participants p SET total_score = (
    SELECT COALESCE(SUM(a.score_awarded), 0) FROM public.exam_answers a
      JOIN public.exam_questions q ON q.id=a.question_id
      WHERE a.session_id=p.session_id AND a.user_id=p.user_id
  ) WHERE p.session_id=_session_id AND p.user_id=_user_id;
END $$;
GRANT EXECUTE ON FUNCTION public.grade_short_answer(uuid,uuid,boolean,int,text) TO authenticated;

-- 6. close_exam (active → closed + force-submit unsubmitted + return summary)
CREATE OR REPLACE FUNCTION public.close_exam(_exam_id uuid)
RETURNS TABLE(user_id uuid, auto_submitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _host uuid := auth.uid(); _status text; _p RECORD;
BEGIN
  IF _host IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT status INTO _status FROM public.exam_sessions WHERE id=_exam_id AND host_id=_host;
  IF _status IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบหรือไม่มีสิทธิ์'; END IF;
  IF _status != 'active' THEN RAISE EXCEPTION 'ต้องเป็น active เท่านั้น'; END IF;
  UPDATE public.exam_sessions SET status='closed' WHERE id=_exam_id;
  -- force-submit unsubmitted participants
  FOR _p IN SELECT * FROM public.exam_participants WHERE session_id=_exam_id AND submitted_at IS NULL LOOP
    PERFORM public.auto_submit_exam(_exam_id, _p.user_id, 'exam_closed');
    RETURN QUERY SELECT _p.user_id, true;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.close_exam(uuid) TO authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260716090100_exam_teacher_rpcs.sql
git commit -m "feat(exam): teacher RPCs (create/update/publish/open/grade/close)"
```

---

## Phase 2: Student + Proctoring RPCs (Task 3)

### Task 3: Migration — Student + Proctoring RPCs

**Files:**
- Create: `supabase/migrations/20260716090200_exam_student_rpcs.sql`

- [ ] **Step 1: สร้าง migration พร้อม RPCs 6 ตัว**

```sql
-- Exam Student + Proctoring RPCs (SECURITY DEFINER)
-- Spec: docs/superpowers/specs/2026-07-16-exam-proctoring-design.md

-- 1. join_exam_by_code
CREATE OR REPLACE FUNCTION public.join_exam_by_code(_code text)
RETURNS TABLE(exam_id uuid, title text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _s RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE join_code = upper(trim(_code));
  IF _s.id IS NULL THEN RAISE EXCEPTION 'รหัสไม่ถูกต้อง'; END IF;
  IF NOT public.is_classroom_member(_s.classroom_id, _uid) THEN
    RAISE EXCEPTION 'ไม่ได้อยู่ในห้องเรียนนี้';
  END IF;
  IF _s.status NOT IN ('scheduled','active') THEN
    RAISE EXCEPTION 'ยังไม่เปิดสอบหรือปิดไปแล้ว';
  END IF;
  IF _s.status = 'scheduled' OR (_s.starts_at IS NOT NULL AND now() < _s.starts_at) THEN
    RAISE EXCEPTION 'ยังไม่ถึงเวลาสอบ';
  END IF;
  IF _s.ends_at IS NOT NULL AND now() > _s.ends_at THEN
    RAISE EXCEPTION 'หมดเวลาสอบแล้ว';
  END IF;
  INSERT INTO public.exam_participants (session_id, user_id)
    VALUES (_s.id, _uid) ON CONFLICT (session_id, user_id) DO NOTHING;
  RETURN QUERY SELECT _s.id, _s.title;
END $$;
GRANT EXECUTE ON FUNCTION public.join_exam_by_code(text) TO authenticated;

-- 2. start_exam_attempt (returns context for client UI)
CREATE OR REPLACE FUNCTION public.start_exam_attempt(_exam_id uuid)
RETURNS TABLE(ends_at timestamptz, violation_threshold int, duration_minutes int, started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _s RECORD; _p RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_exam_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  IF _s.status != 'active' THEN RAISE EXCEPTION 'ยังไม่เปิดสอบ'; END IF;
  IF _s.ends_at IS NOT NULL AND now() > _s.ends_at THEN
    RAISE EXCEPTION 'หมดเวลาสอบแล้ว';
  END IF;
  SELECT * INTO _p FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'ยังไม่ได้เข้าร่วมสอบ'; END IF;
  IF _p.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'ส่งข้อสอบแล้ว'; END IF;
  IF _p.started_at IS NULL THEN
    UPDATE public.exam_participants SET started_at=now() WHERE id=_p.id;
    _p.started_at := now();
  END IF;
  RETURN QUERY SELECT _s.ends_at, _s.violation_threshold, _s.duration_minutes, _p.started_at;
END $$;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;

-- 3. submit_exam_answer (auto-save + auto-grade MCQ)
CREATE OR REPLACE FUNCTION public.submit_exam_answer(
  _question_id uuid, _answer_idx int DEFAULT NULL, _answer_text text DEFAULT NULL
) RETURNS TABLE(is_correct boolean, score_awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _q RECORD; _s RECORD;
  _is_correct boolean; _score int; _graded_by text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _q FROM public.exam_questions WHERE id=_question_id;
  IF _q.id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_q.session_id;
  IF _s.status != 'active' THEN RAISE EXCEPTION 'ยังไม่เปิดสอบหรือปิดไปแล้ว'; END IF;
  IF _s.ends_at IS NOT NULL AND now() > _s.ends_at THEN
    RAISE EXCEPTION 'หมดเวลาแล้ว';
  END IF;
  PERFORM 1 FROM public.exam_participants WHERE session_id=_q.session_id AND user_id=_uid AND submitted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ส่งข้อสอบแล้ว ไม่สามารถแก้ไขได้'; END IF;

  IF _q.question_type = 'multiple_choice' THEN
    _is_correct := (_answer_idx = _q.correct_idx);
    _score := CASE WHEN _is_correct THEN _q.points ELSE 0 END;
    _graded_by := 'server';
  ELSE
    -- short_answer: not graded yet (graded_by=NULL, pending AI)
    _is_correct := NULL; _score := NULL; _graded_by := NULL;
  END IF;

  INSERT INTO public.exam_answers
    (question_id, session_id, user_id, answer_idx, answer_text, is_correct, score_awarded, graded_by, graded_at)
  VALUES (_question_id, _q.session_id, _uid, _answer_idx, _answer_text, _is_correct, _score, _graded_by,
          CASE WHEN _graded_by IS NOT NULL THEN now() ELSE NULL END)
  ON CONFLICT (question_id, user_id) DO UPDATE SET
    answer_idx = EXCLUDED.answer_idx,
    answer_text = EXCLUDED.answer_text,
    is_correct = EXCLUDED.is_correct,
    score_awarded = EXCLUDED.score_awarded,
    graded_by = EXCLUDED.graded_by,
    graded_at = EXCLUDED.graded_at,
    answered_at = now();

  RETURN QUERY SELECT _is_correct, _score;
END $$;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer(uuid,int,text) TO authenticated;

-- 4. record_exam_violation (increment + auto-submit on threshold)
CREATE OR REPLACE FUNCTION public.record_exam_violation(
  _exam_id uuid, _event_type text, _payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(violation_count int, auto_submitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _threshold int; _new_count int; _auto boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  -- advisory lock to dedupe simultaneous events
  PERFORM pg_advisory_xact_lock(hashtext('exam_violation:' || _exam_id::text || ':' || _uid::text));

  SELECT violation_threshold INTO _threshold FROM public.exam_sessions WHERE id=_exam_id;
  IF _threshold IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อสอบ'; END IF;

  -- skip if already submitted
  PERFORM 1 FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_uid AND submitted_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, false; RETURN;
  END IF;

  INSERT INTO public.exam_proctoring_events (session_id, user_id, event_type, payload)
    VALUES (_exam_id, _uid, _event_type, _payload);

  UPDATE public.exam_participants
    SET violation_count = violation_count + 1
    WHERE session_id=_exam_id AND user_id=_uid
    RETURNING violation_count INTO _new_count;

  IF _new_count >= _threshold THEN
    PERFORM public.auto_submit_exam(_exam_id, _uid, 'violation_threshold');
    _auto := true;
  END IF;

  RETURN QUERY SELECT _new_count, _auto;
END $$;
GRANT EXECUTE ON FUNCTION public.record_exam_violation(uuid,text,jsonb) TO authenticated;

-- 5. submit_exam (manual submit + award XP via award_xp)
CREATE OR REPLACE FUNCTION public.submit_exam(_exam_id uuid)
RETURNS TABLE(total_score int, xp_awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s RECORD; _p RECORD;
  _max_score int; _title text; _classroom_id uuid; _classroom_name text;
  _award RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบ'; END IF;
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_exam_id;
  SELECT * INTO _p FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'ยังไม่ได้เข้าร่วมสอบ'; END IF;
  IF _p.submitted_at IS NOT NULL THEN
    -- already submitted — idempotent return
    RETURN QUERY SELECT COALESCE(_p.total_score,0), 0; RETURN;
  END IF;

  -- compute total_score (only graded answers count; ungraded short_answer = 0 for now)
  SELECT COALESCE(SUM(a.score_awarded),0) INTO _p.total_score
    FROM public.exam_answers a WHERE a.session_id=_exam_id AND a.user_id=_uid;
  SELECT COALESCE(SUM(q.points),0) INTO _max_score
    FROM public.exam_questions q WHERE q.session_id=_exam_id;

  UPDATE public.exam_participants
    SET submitted_at=now(), total_score=_p.total_score, auto_submitted=false
    WHERE id=_p.id;

  -- award XP via central ledger
  SELECT name INTO _classroom_name FROM public.classrooms WHERE id=_s.classroom_id;
  SELECT * INTO _award FROM public.award_xp(
    _user_id := _uid,
    _amount := COALESCE(_p.total_score,0),
    _source := 'exam'::public.app_xp_source,
    _source_label := 'สอบ: ' || _s.title,
    _subject := _classroom_name,
    _ref_table := 'exam_participants',
    _ref_id := _p.id,
    _classroom_id := _s.classroom_id,
    _metadata := jsonb_build_object(
      'exam_id', _exam_id, 'max_score', _max_score,
      'violation_count', _p.violation_count
    ),
    _idempotency_key := 'exam_submit:' || _exam_id::text || ':' || _uid::text
  );

  RETURN QUERY SELECT COALESCE(_p.total_score,0), COALESCE(_award.transaction_id IS NOT NULL, false)::int * COALESCE(_p.total_score,0);
END $$;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid) TO authenticated;

-- 6. auto_submit_exam (internal — called by record_exam_violation / close_exam)
CREATE OR REPLACE FUNCTION public.auto_submit_exam(_exam_id uuid, _user_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s RECORD; _p RECORD; _total int; _max int; _title text; _classroom_id uuid; _classroom_name text;
BEGIN
  SELECT * INTO _s FROM public.exam_sessions WHERE id=_exam_id;
  SELECT * INTO _p FROM public.exam_participants WHERE session_id=_exam_id AND user_id=_user_id;
  IF _p.id IS NULL OR _p.submitted_at IS NOT NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(a.score_awarded),0) INTO _total
    FROM public.exam_answers a WHERE a.session_id=_exam_id AND a.user_id=_user_id;
  SELECT COALESCE(SUM(q.points),0) INTO _max
    FROM public.exam_questions q WHERE q.session_id=_exam_id;

  UPDATE public.exam_participants
    SET submitted_at=now(), total_score=_total, auto_submitted=true, auto_submit_reason=_reason
    WHERE id=_p.id;

  SELECT name INTO _classroom_name FROM public.classrooms WHERE id=_s.classroom_id;
  PERFORM public.award_xp(
    _user_id := _user_id,
    _amount := _total,
    _source := 'exam'::public.app_xp_source,
    _source_label := 'สอบ (ส่งอัตโนมัติ): ' || _s.title,
    _subject := _classroom_name,
    _ref_table := 'exam_participants',
    _ref_id := _p.id,
    _classroom_id := _s.classroom_id,
    _metadata := jsonb_build_object(
      'exam_id', _exam_id, 'max_score', _max,
      'violation_count', _p.violation_count, 'auto_submitted', true, 'reason', _reason
    ),
    _idempotency_key := 'exam_submit:' || _exam_id::text || ':' || _user_id::text
  );
END $$;
-- Note: auto_submit_exam is internal; grant only to authenticated (called by other SECURITY DEFINER fns)
GRANT EXECUTE ON FUNCTION public.auto_submit_exam(uuid,uuid,text) TO authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260716090200_exam_student_rpcs.sql
git commit -m "feat(exam): student + proctoring RPCs (join/start/answer/submit/violation/auto-submit)"
```

---

## Phase 3: Types + Data Layer (Tasks 4-5)

### Task 4: Update types.ts with exam tables + RPCs

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: เพิ่ม enum value `'exam'` ใน `app_xp_source`**

ค้นหา `app_xp_source:` ในไฟล์ (อยู่ใน `Enums` section) แล้วเพิ่ม `'exam'`:

```ts
app_xp_source:
  | "daily_quest" | "attendance" | "weekly_mission"
  | "daily_bonus" | "achievement" | "shop_purchase"
  | "admin_adjustment" | "exam";  // เพิ่มบรรทัดนี้
```

- [ ] **Step 2: เพิ่ม 5 tables ใน `Tables` section**

วางหลัง `xp_transactions` block:

```ts
exam_sessions: {
  Row: {
    id: string;
    classroom_id: string;
    host_id: string;
    title: string;
    status: "draft" | "scheduled" | "active" | "closed";
    join_code: string;
    starts_at: string | null;
    ends_at: string | null;
    duration_minutes: number;
    violation_threshold: number;
    created_at: string;
  };
  Insert: {
    id?: string;
    classroom_id: string;
    host_id: string;
    title: string;
    status?: "draft" | "scheduled" | "active" | "closed";
    join_code?: string;
    starts_at?: string | null;
    ends_at?: string | null;
    duration_minutes?: number;
    violation_threshold?: number;
    created_at?: string;
  };
  Update: Partial<Database["public"]["Tables"]["exam_sessions"]["Insert"]>;
  Relationships: [
    { foreignKeyName: "exam_sessions_classroom_id_fkey"; columns: ["classroom_id"]; referencedRelation: "classrooms"; referencedColumns: ["id"]; },
    { foreignKeyName: "exam_sessions_host_id_fkey"; columns: ["host_id"]; referencedRelation: "profiles"; referencedColumns: ["id"]; },
  ];
},
exam_questions: {
  Row: {
    id: string;
    session_id: string;
    idx: number;
    question_type: "multiple_choice" | "short_answer";
    question: string;
    options: string[] | null;
    correct_idx: number | null;
    expected_answer: string | null;
    points: number;
    created_at: string;
  };
  Insert: {
    id?: string; session_id: string; idx: number;
    question_type: "multiple_choice" | "short_answer";
    question: string; options?: string[] | null;
    correct_idx?: number | null; expected_answer?: string | null;
    points?: number; created_at?: string;
  };
  Update: Partial<Database["public"]["Tables"]["exam_questions"]["Insert"]>;
  Relationships: [
    { foreignKeyName: "exam_questions_session_id_fkey"; columns: ["session_id"]; referencedRelation: "exam_sessions"; referencedColumns: ["id"]; },
  ];
},
exam_participants: {
  Row: {
    id: string; session_id: string; user_id: string;
    started_at: string | null; submitted_at: string | null;
    total_score: number | null;
    violation_count: number;
    auto_submitted: boolean;
    auto_submit_reason: string | null;
    created_at: string;
  };
  Insert: {
    id?: string; session_id: string; user_id: string;
    started_at?: string | null; submitted_at?: string | null;
    total_score?: number | null;
    violation_count?: number;
    auto_submitted?: boolean;
    auto_submit_reason?: string | null;
    created_at?: string;
  };
  Update: Partial<Database["public"]["Tables"]["exam_participants"]["Insert"]>;
  Relationships: [
    { foreignKeyName: "exam_participants_session_id_fkey"; columns: ["session_id"]; referencedRelation: "exam_sessions"; referencedColumns: ["id"]; },
    { foreignKeyName: "exam_participants_user_id_fkey"; columns: ["user_id"]; referencedRelation: "profiles"; referencedColumns: ["id"]; },
  ];
},
exam_answers: {
  Row: {
    id: string; question_id: string; session_id: string; user_id: string;
    answer_idx: number | null; answer_text: string | null;
    is_correct: boolean | null; score_awarded: number | null;
    graded_by: "server" | "ai" | "teacher" | null; graded_at: string | null;
    answered_at: string;
  };
  Insert: {
    id?: string; question_id: string; session_id: string; user_id: string;
    answer_idx?: number | null; answer_text?: string | null;
    is_correct?: boolean | null; score_awarded?: number | null;
    graded_by?: "server" | "ai" | "teacher" | null; graded_at?: string | null;
    answered_at?: string;
  };
  Update: Partial<Database["public"]["Tables"]["exam_answers"]["Insert"]>;
  Relationships: [
    { foreignKeyName: "exam_answers_question_id_fkey"; columns: ["question_id"]; referencedRelation: "exam_questions"; referencedColumns: ["id"]; },
  ];
},
exam_proctoring_events: {
  Row: {
    id: string; session_id: string; user_id: string;
    event_type: "tab_blur" | "window_blur" | "fullscreen_exit" | "copy_attempt" | "paste_attempt";
    payload: Record<string, unknown>;
    created_at: string;
  };
  Insert: {
    id?: string; session_id: string; user_id: string;
    event_type: "tab_blur" | "window_blur" | "fullscreen_exit" | "copy_attempt" | "paste_attempt";
    payload?: Record<string, unknown>;
    created_at?: string;
  };
  Update: Partial<Database["public"]["Tables"]["exam_proctoring_events"]["Insert"]>;
  Relationships: [
    { foreignKeyName: "exam_proctoring_events_session_id_fkey"; columns: ["session_id"]; referencedRelation: "exam_sessions"; referencedColumns: ["id"]; },
  ];
},
```

- [ ] **Step 3: เพิ่ม Views section (ถ้ายังไม่มีให้สร้าง; ถ้ามีให้เพิ่ม)**

```ts
Views: {
  // ... existing views (quiz_questions_safe, daily_quests_safe, etc.)
  exam_questions_safe: {
    Row: {
      id: string; session_id: string; idx: number;
      question_type: "multiple_choice" | "short_answer";
      question: string; options: string[] | null;
      points: number; created_at: string;
      correct_idx: number | null;
      expected_answer: string | null;
    };
    Relationships: [...same as exam_questions];
  };
};
```

- [ ] **Step 4: เพิ่ม RPC signatures ใน `Functions` section**

```ts
create_exam: {
  Args: { _classroom_id: string; _title: string; _duration_minutes?: number; _violation_threshold?: number };
  Returns: string;
},
update_exam_questions: {
  Args: { _exam_id: string; _questions: unknown };
  Returns: undefined;
},
publish_exam: {
  Args: { _exam_id: string; _starts_at: string; _ends_at: string };
  Returns: undefined;
},
open_exam: { Args: { _exam_id: string }; Returns: undefined; },
close_exam: {
  Args: { _exam_id: string };
  Returns: { user_id: string; auto_submitted: boolean }[];
},
grade_short_answer: {
  Args: { _question_id: string; _user_id: string; _is_correct: boolean; _score: number; _graded_by: string };
  Returns: undefined;
},
join_exam_by_code: {
  Args: { _code: string };
  Returns: { exam_id: string; title: string }[];
},
start_exam_attempt: {
  Args: { _exam_id: string };
  Returns: { ends_at: string; violation_threshold: number; duration_minutes: number; started_at: string }[];
},
submit_exam_answer: {
  Args: { _question_id: string; _answer_idx?: number | null; _answer_text?: string | null };
  Returns: { is_correct: boolean | null; score_awarded: number | null }[];
},
record_exam_violation: {
  Args: { _exam_id: string; _event_type: string; _payload?: Record<string, unknown> };
  Returns: { violation_count: number; auto_submitted: boolean }[];
},
submit_exam: {
  Args: { _exam_id: string };
  Returns: { total_score: number; xp_awarded: number }[];
},
auto_submit_exam: {
  Args: { _exam_id: string; _user_id: string; _reason: string };
  Returns: undefined;
},
```

- [ ] **Step 5: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน (เหลือเพียง vite.config.ts error ของ Lovable เท่านั้น)

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "feat(exam): add types for 5 tables + 12 RPCs + safe view"
```

---

### Task 5: Data layer — exam.functions.ts

**Files:**
- Create: `src/lib/exam.functions.ts`

- [ ] **Step 1: สร้าง data layer**

```ts
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ExamSessionRow = Database["public"]["Tables"]["exam_sessions"]["Row"];
export type ExamQuestionRow = Database["public"]["Tables"]["exam_questions"]["Row"];
export type ExamQuestionSafeRow = Database["public"]["Views"]["exam_questions_safe"]["Row"];
export type ExamParticipantRow = Database["public"]["Tables"]["exam_participants"]["Row"];
export type ExamAnswerRow = Database["public"]["Tables"]["exam_answers"]["Row"];
export type ExamProctoringEventRow = Database["public"]["Tables"]["exam_proctoring_events"]["Row"];
export type ExamStatus = ExamSessionRow["status"];
export type QuestionType = ExamQuestionRow["question_type"];
export type ViolationEventType = ExamProctoringEventRow["event_type"];

// ===== Teacher queries =====

export async function fetchTeacherExams(classroomIds: string[]): Promise<ExamSessionRow[]> {
  if (classroomIds.length === 0) return [];
  const { data, error } = await supabase
    .from("exam_sessions")
    .select("*")
    .in("classroom_id", classroomIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchExamRaw(examId: string): Promise<ExamSessionRow | null> {
  const { data, error } = await supabase
    .from("exam_sessions")
    .select("*")
    .eq("id", examId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchExamQuestionsRaw(examId: string): Promise<ExamQuestionRow[]> {
  // host/admin only (raw table includes correct_idx)
  const { data, error } = await supabase
    .from("exam_questions")
    .select("*")
    .eq("session_id", examId)
    .order("idx", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchParticipants(examId: string): Promise<ExamParticipantRow[]> {
  const { data, error } = await supabase
    .from("exam_participants")
    .select("*")
    .eq("session_id", examId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ===== Student queries =====

export async function fetchExamQuestionsSafe(examId: string): Promise<ExamQuestionSafeRow[]> {
  // uses _safe view — correct_idx/expected_answer null until closed
  const { data, error } = await supabase
    .from("exam_questions_safe")
    .select("*")
    .eq("session_id", examId)
    .order("idx", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyExamAnswers(examId: string): Promise<ExamAnswerRow[]> {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("*")
    .eq("session_id", examId);
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyParticipant(examId: string): Promise<ExamParticipantRow | null> {
  const { data, error } = await supabase
    .from("exam_participants")
    .select("*")
    .eq("session_id", examId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ===== RPC wrappers =====

export async function rpcCreateExam(args: {
  classroom_id: string; title: string;
  duration_minutes: number; violation_threshold: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_exam", args);
  if (error) throw error;
  return data as string;
}

export async function rpcUpdateExamQuestions(examId: string, questions: unknown[]): Promise<void> {
  const { error } = await supabase.rpc("update_exam_questions", {
    _exam_id: examId, _questions: questions,
  });
  if (error) throw error;
}

export async function rpcPublishExam(examId: string, startsAt: string, endsAt: string): Promise<void> {
  const { error } = await supabase.rpc("publish_exam", {
    _exam_id: examId, _starts_at: startsAt, _ends_at: endsAt,
  });
  if (error) throw error;
}

export async function rpcOpenExam(examId: string): Promise<void> {
  const { error } = await supabase.rpc("open_exam", { _exam_id: examId });
  if (error) throw error;
}

export async function rpcCloseExam(examId: string): Promise<{ user_id: string; auto_submitted: boolean }[]> {
  const { data, error } = await supabase.rpc("close_exam", { _exam_id: examId });
  if (error) throw error;
  return (data as { user_id: string; auto_submitted: boolean }[]) ?? [];
}

export async function rpcJoinExamByCode(code: string): Promise<{ exam_id: string; title: string }> {
  const { data, error } = await supabase.rpc("join_exam_by_code", { _code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("ไม่พบข้อสอบ");
  return row;
}

export async function rpcStartExamAttempt(examId: string): Promise<{
  ends_at: string; violation_threshold: number; duration_minutes: number; started_at: string;
}> {
  const { data, error } = await supabase.rpc("start_exam_attempt", { _exam_id: examId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("ไม่สามารถเริ่มสอบได้");
  return row;
}

export async function rpcSubmitExamAnswer(args: {
  question_id: string; answer_idx?: number | null; answer_text?: string | null;
}): Promise<{ is_correct: boolean | null; score_awarded: number | null }> {
  const { data, error } = await supabase.rpc("submit_exam_answer", {
    _question_id: args.question_id,
    _answer_idx: args.answer_idx ?? null,
    _answer_text: args.answer_text ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { is_correct: null, score_awarded: null };
}

export async function rpcRecordViolation(args: {
  exam_id: string; event_type: ViolationEventType; payload?: Record<string, unknown>;
}): Promise<{ violation_count: number; auto_submitted: boolean }> {
  const { data, error } = await supabase.rpc("record_exam_violation", {
    _exam_id: args.exam_id, _event_type: args.event_type, _payload: args.payload ?? {},
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { violation_count: 0, auto_submitted: false };
}

export async function rpcSubmitExam(examId: string): Promise<{ total_score: number; xp_awarded: number }> {
  const { data, error } = await supabase.rpc("submit_exam", { _exam_id: examId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { total_score: 0, xp_awarded: 0 };
}
```

- [ ] **Step 2: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน

- [ ] **Step 3: Commit**

```bash
git add src/lib/exam.functions.ts
git commit -m "feat(exam): client data layer with RPC wrappers"
```

---

## Phase 3: Proctoring Hook (Task 6)

### Task 6: use-exam-proctoring hook

**Files:**
- Create: `src/hooks/use-exam-proctoring.ts`

- [ ] **Step 1: สร้าง hook**

```ts
import { useEffect, useRef, useState, useCallback } from "react";
import { rpcRecordViolation } from "@/lib/exam.functions";
import type { ViolationEventType } from "@/lib/exam.functions";
import { toast } from "sonner";
import { tr } from "@/i18n";

interface UseExamProctoringArgs {
  examId: string;
  enabled: boolean;
  threshold: number;
  onAutoSubmit: (reason: string) => void;
}

interface UseExamProctoringReturn {
  violationCount: number;
  isFullscreenActive: boolean;
  requestFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

export function useExamProctoring({
  examId, enabled, threshold, onAutoSubmit,
}: UseExamProctoringArgs): UseExamProctoringReturn {
  const [violationCount, setViolationCount] = useState(0);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const lastEventRef = useRef<Record<string, number>>({});
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  const recordViolation = useCallback(async (eventType: ViolationEventType) => {
    // debounce: skip if same event type fired within 500ms
    const now = Date.now();
    const last = lastEventRef.current[eventType] ?? 0;
    if (now - last < 500) return;
    lastEventRef.current[eventType] = now;

    try {
      const result = await rpcRecordViolation({ exam_id: examId, event_type: eventType });
      setViolationCount(result.violation_count);
      if (result.violation_count < threshold) {
        toast.warning(
          tr("⚠ ออกจากหน้าสอบ ") + `${result.violation_count}/${threshold}` +
          tr(" ครั้ง — ครบ ") + `${threshold}` + tr(" ครั้งจะส่งอัตโนมัติ"),
        );
      }
      if (result.auto_submitted) {
        onAutoSubmitRef.current("violation_threshold");
      }
    } catch (err) {
      // network/permission error — don't block exam, just log
      console.error("Failed to record violation:", err);
    }
  }, [examId, threshold]);

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.hidden) recordViolation("tab_blur");
    };
    const onBlur = () => recordViolation("window_blur");
    const onFsChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreenActive(active);
      if (!active) recordViolation("fullscreen_exit");
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      recordViolation("copy_attempt");
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      recordViolation("paste_attempt");
    };
    const onContext = (e: MouseEvent) => e.preventDefault();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContext);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContext);
    };
  }, [enabled, recordViolation]);

  const requestFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreenActive(true);
    } catch {
      toast.error(tr("ไม่สามารถเข้าโหมดเต็มจอได้ — กรุณาอนุญาตในเบราว์เซอร์"));
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      setIsFullscreenActive(false);
    } catch { /* ignore */ }
  }, []);

  return { violationCount, isFullscreenActive, requestFullscreen, exitFullscreen };
}
```

- [ ] **Step 2: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-exam-proctoring.ts
git commit -m "feat(exam): proctoring hook (visibility/blur/fullscreen/copy/paste)"
```

---

## Phase 4: Teacher UI (Tasks 7-9)

### Task 7: Route — exam.index.tsx (รายการสอบของครู)

**Files:**
- Create: `src/routes/_authenticated/exam.index.tsx`

- [ ] **Step 1: สร้าง route index (ครูเห็นรายการสอบในทุกห้องของตน)**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import { fetchTeacherExams } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/")({
  component: ExamIndexPage,
});

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
    draft: { label: tr("ฉบับร่าง"), variant: "secondary" },
    scheduled: { label: tr("รอเปิดสอบ"), variant: "outline" },
    active: { label: tr("กำลังสอบ"), variant: "default" },
    closed: { label: tr("ปิดแล้ว"), variant: "destructive" },
  };
  const m = map[status] ?? map.draft;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function ExamIndexPage() {
  const { user, roles } = useAuth();
  const isTeacher = roles.includes("teacher") || roles.includes("admin");

  const { data: classrooms } = useQuery({
    queryKey: ["my-classrooms-as-owner", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classrooms")
        .select("id, name")
        .eq("owner_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && isTeacher,
  });

  const { data: exams, isLoading } = useQuery({
    queryKey: ["teacher-exams", classrooms?.map((c) => c.id)],
    queryFn: () => fetchTeacherExams(classrooms!.map((c) => c.id)),
    enabled: !!classrooms && classrooms.length > 0,
  });

  if (!isTeacher) {
    return (
      <div className="container max-w-3xl py-6">
        <p className="text-muted-foreground">{tr("หน้านี้สำหรับครูเท่านั้น — นักเรียนใช้การเข้าสอบด้วยรหัส")}</p>
        <Button asChild className="mt-4"><Link to="/exam/join">{tr("เข้าสอบด้วยรหัส")}</Link></Button>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr("📝 การสอบ")}</h1>
        <Button asChild>
          <Link to="/exam/new">
            <Plus className="size-4 mr-1" />
            {tr("สร้างข้อสอบ")}
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-12"><Loader2 className="size-6 animate-spin" /></div>
      ) : !exams || exams.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="size-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{tr("ยังไม่มีข้อสอบ — สร้างข้อสอบแรกของคุณ")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {exams.map((exam) => (
            <Card key={exam.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{exam.title}</CardTitle>
                  {statusBadge(exam.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                <span>{tr("รหัสเข้าร่วม")}: <code className="font-mono">{exam.join_code}</code></span>
                {" · "}
                <span>{tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")}</span>
                {" · "}
                <span>{tr("โกงสูงสุด")} {exam.violation_threshold} {tr("ครั้ง")}</span>
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/exam/$examId" params={{ examId: exam.id }}>{tr("เปิด")}</Link>
                  </Button>
                  {exam.status === "closed" && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/exam/$examId/report" params={{ examId: exam.id }}>{tr("รายงาน")}</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/_authenticated/exam.index.tsx
git commit -m "feat(exam): teacher exam list route"
```

---

### Task 8: Route — exam.new.tsx (ฟอร์มสร้างข้อสอบ)

**Files:**
- Create: `src/routes/_authenticated/exam.new.tsx`

- [ ] **Step 1: สร้างฟอร์มสร้างข้อสอบ (mirror quiz.new.tsx pattern)**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import { rpcCreateExam, rpcUpdateExamQuestions } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/new")({
  validateSearch: (s: Record<string, unknown>) => ({ classroom: (s.classroom as string) ?? "" }),
  component: NewExamPage,
});

type DraftQuestion = {
  idx: number;
  question_type: "multiple_choice" | "short_answer";
  question: string;
  options: string[];
  correct_idx: number;
  expected_answer: string;
  points: number;
};

function emptyQ(idx: number): DraftQuestion {
  return {
    idx,
    question_type: "multiple_choice",
    question: "",
    options: ["", "", "", ""],
    correct_idx: 0,
    expected_answer: "",
    points: 1,
  };
}

function NewExamPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { classroom } = Route.useSearch();
  const [classroomId, setClassroomId] = useState(classroom);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(60);
  const [threshold, setThreshold] = useState(5);
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQ(0)]);
  const [saving, setSaving] = useState(false);

  const { data: myClassrooms } = useMyClassrooms(user?.id);

  function updateQ(i: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function updateOption(i: number, oi: number, v: string) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx === i ? { ...q, options: q.options.map((o, j) => (j === oi ? v : o)) } : q,
      ),
    );
  }
  function addQ() {
    setQuestions((qs) => [...qs, emptyQ(qs.length)]);
  }
  function removeQ(i: number) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, idx })));
  }

  async function save() {
    if (!classroomId) { toast.error(tr("เลือกห้องเรียนก่อน")); return; }
    if (!title.trim()) { toast.error(tr("กรอกชื่อข้อสอบ")); return; }
    if (questions.some((q) => !q.question.trim())) { toast.error(tr("กรอกคำถามให้ครบ")); return; }
    setSaving(true);
    try {
      const examId = await rpcCreateExam({
        classroom_id: classroomId, title: title.trim(),
        duration_minutes: duration, violation_threshold: threshold,
      });
      const payload = questions.map((q) => ({
        idx: q.idx,
        question_type: q.question_type,
        question: q.question.trim(),
        options: q.question_type === "multiple_choice" ? q.options.filter((o) => o.trim()) : null,
        correct_idx: q.question_type === "multiple_choice" ? q.correct_idx : null,
        expected_answer: q.question_type === "short_answer" ? q.expected_answer.trim() : null,
        points: q.points,
      }));
      await rpcUpdateExamQuestions(examId, payload);
      toast.success(tr("สร้างข้อสอบแล้ว — ยังเป็น draft"));
      nav({ to: "/exam/$examId", params: { examId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("สร้างข้อสอบไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container max-w-3xl py-6 space-y-4">
      <h1 className="text-2xl font-semibold">{tr("📝 สร้างข้อสอบใหม่")}</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{tr("รายละเอียดสอบ")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>{tr("ชื่อข้อสอบ")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("เช่น สอบกลางภาค ม.4/1")} />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("ห้องเรียน")}</Label>
            <Select value={classroomId} onValueChange={setClassroomId}>
              <SelectTrigger><SelectValue placeholder={tr("เลือกห้อง")} /></SelectTrigger>
              <SelectContent>
                {(myClassrooms ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{tr("ระยะเวลา (นาที)")}</Label>
              <Input type="number" min={5} max={300} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("โกงสูงสุด (ครั้ง)")}</Label>
              <Input type="number" min={1} max={20} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {questions.map((q, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{tr("ข้อ")} {i + 1}</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={q.question_type} onValueChange={(v) => updateQ(i, { question_type: v as DraftQuestion["question_type"] })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiple_choice">{tr("ปรนัย (ก/ข/ค/ง)")}</SelectItem>
                      <SelectItem value="short_answer">{tr("เติมคำสั้น")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {questions.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => removeQ(i)}><Trash2 className="size-4" /></Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea value={q.question} onChange={(e) => updateQ(i, { question: e.target.value })} placeholder={tr("พิมพ์คำถาม...")} rows={2} />
              {q.question_type === "multiple_choice" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("ตัวเลือก (เลือกคำตอบที่ถูก)")}</Label>
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-${i}`}
                        checked={q.correct_idx === oi}
                        onChange={() => updateQ(i, { correct_idx: oi })}
                      />
                      <span className="text-xs text-muted-foreground w-5">{["ก","ข","ค","ง","จ"][oi]}</span>
                      <Input value={opt} onChange={(e) => updateOption(i, oi, e.target.value)} placeholder={tr(`ตัวเลือก ${oi+1}`)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("คำตอบที่ถูก (หรือคำสำคัญ)")}</Label>
                  <Input value={q.expected_answer} onChange={(e) => updateQ(i, { expected_answer: e.target.value })} placeholder={tr("เช่น photosynthesis หรือ การสังเคราะห์แสง")} />
                  <p className="text-xs text-muted-foreground">{tr("AI จะใช้คำนี้เป็นเกณฑ์ตรวจคำตอบนักเรียน")}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label className="text-xs">{tr("คะแนน")}:</Label>
                <Input type="number" min={1} max={100} value={q.points} onChange={(e) => updateQ(i, { points: Number(e.target.value) })} className="w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
        <Button variant="outline" onClick={addQ} className="w-full">
          <Plus className="size-4 mr-1" /> {tr("เพิ่มข้อ")}
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => nav({ to: "/exam" })}>{tr("ยกเลิก")}</Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
          {tr("บันทึกเป็น draft")}
        </Button>
      </div>
    </div>
  );
}

// helper hook (could be in exam.functions.ts — keep inline for brevity)
import { useQuery } from "@tanstack/react-query";
function useMyClassrooms(userId?: string) {
  return useQuery({
    queryKey: ["my-classrooms-owner", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("classrooms").select("id, name").eq("owner_id", userId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
  });
}
```

- [ ] **Step 2: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน (อาจต้อง restart dev เพื่อ route tree regen — ถ้า dev server ใช้ได้ ไม่งั้น typecheck พอ)

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/exam.new.tsx
git commit -m "feat(exam): teacher create-exam form (MCQ + short answer)"
```

---

### Task 9: Route — exam.$examId.tsx (host dashboard + student exam screen)

**Files:**
- Create: `src/routes/_authenticated/exam.$examId.tsx`

**Note:** ไฟล์นี้ใหญ่ที่สุด — host view (publish/open/close + participant list) + student view (Ready screen → exam screen with proctoring → results). แบ่งเป็น 2 steps.

- [ ] **Step 1: สร้าง host view + student ready/results (โครงหลัก)**

สร้างไฟล์ `src/routes/_authenticated/exam.$examId.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Play, Square, Send, AlertTriangle, Clock, Maximize2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import {
  fetchExamRaw, fetchParticipants, fetchExamQuestionsSafe, fetchMyExamAnswers,
  rpcPublishExam, rpcOpenExam, rpcCloseExam, rpcStartExamAttempt,
  rpcSubmitExamAnswer, rpcSubmitExam,
} from "@/lib/exam.functions";
import { useExamProctoring } from "@/hooks/use-exam-proctoring";

export const Route = createFileRoute("/_authenticated/exam/$examId")({
  component: ExamDetailPage,
});

function ExamDetailPage() {
  const { examId } = Route.useParams();
  const { user } = useAuth();
  const { data: exam } = useQuery({
    queryKey: ["exam", examId],
    queryFn: () => fetchExamRaw(examId),
  });
  const isHost = !!exam && exam.host_id === user?.id;

  if (!exam) return <div className="grid place-items-center py-12"><Loader2 className="size-6 animate-spin" /></div>;

  return isHost ? <HostView exam={exam} /> : <StudentView exam={exam} />;
}

// ============ HOST VIEW ============
function HostView({ exam }: { exam: NonNullable<Awaited<ReturnType<typeof fetchExamRaw>>> }) {
  const qc = useQueryClient();
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const { data: participants } = useQuery({
    queryKey: ["exam-participants", exam.id],
    queryFn: () => fetchParticipants(exam.id),
    refetchInterval: exam.status === "active" ? 5000 : false,
  });

  const publishMut = useMutation({
    mutationFn: () => rpcPublishExam(exam.id, new Date(startAt).toISOString(), new Date(endAt).toISOString()),
    onSuccess: () => {
      toast.success(tr("เปิดสอบแล้ว (รอเวลา)"));
      qc.invalidateQueries({ queryKey: ["exam", exam.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const openMut = useMutation({
    mutationFn: () => rpcOpenExam(exam.id),
    onSuccess: () => {
      toast.success(tr("เปิดสอบแล้ว — นักเรียนเข้าได้"));
      qc.invalidateQueries({ queryKey: ["exam", exam.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const closeMut = useMutation({
    mutationFn: () => rpcCloseExam(exam.id),
    onSuccess: (data) => {
      toast.success(tr("ปิดสอบแล้ว — force-submit ") + `${data.length}` + tr(" คน"));
      qc.invalidateQueries({ queryKey: ["exam", exam.id] });
      qc.invalidateQueries({ queryKey: ["exam-participants", exam.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="container max-w-3xl py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{exam.title}</h1>
        <Badge>{exam.status}</Badge>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-2 text-sm">
          <div>{tr("รหัสเข้าร่วม")}: <code className="font-mono text-lg">{exam.join_code}</code></div>
          <div>{tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")} · {tr("โกงสูงสุด")} {exam.violation_threshold} {tr("ครั้ง")}</div>
          {exam.starts_at && <div>{tr("เวลาเปิด")}: {new Date(exam.starts_at).toLocaleString("th-TH")}</div>}
          {exam.ends_at && <div>{tr("เวลาปิด")}: {new Date(exam.ends_at).toLocaleString("th-TH")}</div>}
        </CardContent>
      </Card>

      {exam.status === "draft" && (
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("กำหนดเวลาและเปิดสอบ")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs">{tr("เปิดสอบเมื่อ")}</label>
                <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div>
                <label className="text-xs">{tr("ปิดสอบเมื่อ")}</label>
                <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
            </div>
            <Button onClick={() => publishMut.mutate()} disabled={publishMut.isPending || !startAt || !endAt}>
              {publishMut.isPending && <Loader2 className="size-4 mr-1 animate-spin" />}
              {tr("กำหนดเวลา")}
            </Button>
          </CardContent>
        </Card>
      )}

      {exam.status === "scheduled" && (
        <Button onClick={() => openMut.mutate()} disabled={openMut.isPending} size="lg">
          {openMut.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Play className="size-4 mr-1" />}
          {tr("เปิดสอบเลย")}
        </Button>
      )}

      {exam.status === "active" && (
        <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending} variant="destructive" size="lg">
          {closeMut.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Square className="size-4 mr-1" />}
          {tr("ปิดสอบ (force-submit คนที่ยังไม่ส่ง)")}
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tr("ผู้เข้าสอบ")} ({participants?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!participants || participants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {tr("ยังไม่มีคนเข้าร่วม — แชร์รหัส ")}<code className="font-mono">{exam.join_code}</code>
            </p>
          ) : (
            <div className="space-y-1">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0">
                  <span className="truncate">{p.user_id.slice(0,8)}...</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {p.submitted_at ? (
                      <span>✓ {tr("ส่งแล้ว")} {p.auto_submitted && <Badge variant="destructive" className="ml-1">{tr("อัตโนมัติ")}</Badge>}</span>
                    ) : p.started_at ? (
                      <span>{tr("กำลังทำ")}</span>
                    ) : (
                      <span>{tr("รอเริ่ม")}</span>
                    )}
                    {p.violation_count > 0 && (
                      <Badge variant="outline">⚠ {p.violation_count}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============ STUDENT VIEW ============
function StudentView({ exam }: { exam: NonNullable<Awaited<ReturnType<typeof fetchExamRaw>>> }) {
  const nav = useNavigate();
  const qc = useQueryClient();

  // step 1: ready (not started)
  // step 2: in-exam (started, not submitted)
  // step 3: results (submitted)
  const { data: participant } = useQuery({
    queryKey: ["my-exam-participant", exam.id],
    queryFn: async () => {
      const { data } = await supabase.from("exam_participants").select("*").eq("session_id", exam.id).maybeSingle();
      return data;
    },
  });

  if (!participant) {
    return <ReadyScreen exam={exam} />;
  }
  if (participant.submitted_at) {
    return <ResultsScreen exam={exam} participant={participant} />;
  }
  if (!participant.started_at) {
    return <ReadyScreen exam={exam} />;
  }
  return <ExamScreen exam={exam} threshold={exam.violation_threshold} />;
}

function ReadyScreen({ exam }: { exam: NonNullable<Awaited<ReturnType<typeof fetchExamRaw>>> }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);

  async function start() {
    if (exam.status !== "active") {
      toast.error(tr("ยังไม่เปิดสอบ"));
      return;
    }
    setStarting(true);
    try {
      await rpcStartExamAttempt(exam.id);
      qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("เริ่มสอบไม่สำเร็จ"));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="container max-w-2xl py-6 space-y-4">
      <Card>
        <CardHeader><CardTitle>{exam.title}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><Clock className="size-4" /> {tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")}</div>
            <div className="flex items-center gap-2"><AlertTriangle className="size-4" /> {tr("ออกจากหน้าสอบสูงสุด")} {exam.violation_threshold} {tr("ครั้ง — ครบจะส่งอัตโนมัติ")}</div>
            <div className="flex items-center gap-2"><Maximize2 className="size-4" /> {tr("ต้องสอบในโหมดเต็มจอ")}</div>
          </div>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100">
            <p className="font-medium mb-1">⚠ {tr("กติกาสอบ")}:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>{tr("ห้ามเปลี่ยน tab, หน้าต่าง หรือออกจากโหมดเต็มจอ")}</li>
              <li>{tr("ห้าม copy/paste หรือเปิดเครื่องมืออื่น")}</li>
              <li>{tr("ทุกครั้งที่ออกจากหน้าจะนับเป็นการโกง")}</li>
              <li>{tr("หมดเวลาหรือโกงครบจะส่งอัตโนมัติ")}</li>
            </ul>
          </div>
          <Button onClick={start} disabled={starting} size="lg" className="w-full">
            {starting && <Loader2 className="size-4 mr-1 animate-spin" />}
            {tr("เริ่มสอบ")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ExamScreen({ exam, threshold }: { exam: NonNullable<Awaited<ReturnType<typeof fetchExamRaw>>>; threshold: number }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { answer_idx?: number; answer_text?: string }>>({});

  const { data: questions } = useQuery({
    queryKey: ["exam-questions-safe", exam.id],
    queryFn: () => fetchExamQuestionsSafe(exam.id),
  });
  const { data: existingAnswers } = useQuery({
    queryKey: ["my-exam-answers", exam.id],
    queryFn: () => fetchMyExamAnswers(exam.id),
  });

  // merge existing answers into local state
  useMemo(() => {
    if (existingAnswers && Object.keys(answers).length === 0) {
      const m: Record<string, { answer_idx?: number; answer_text?: string }> = {};
      for (const a of existingAnswers) {
        m[a.question_id] = { answer_idx: a.answer_idx ?? undefined, answer_text: a.answer_text ?? undefined };
      }
      setAnswers(m);
    }
  }, [existingAnswers]);

  // proctoring hook — only when exam active and not ended
  const { violationCount, isFullscreenActive, requestFullscreen } = useExamProctoring({
    examId: exam.id,
    enabled: !endedReason,
    threshold,
    onAutoSubmit: (reason) => {
      setEndedReason(reason);
      toast.error(tr("ส่งข้อสอบอัตโนมัติ — ") + (reason === "violation_threshold" ? tr("ออกจากหน้าสอบครบ") + ` ${threshold} ` + tr("ครั้ง") : tr("หมดเวลา")));
      qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      setTimeout(() => nav({ to: "/exam/$examId", params: { examId: exam.id } }), 1500);
    },
  });

  // countdown to ends_at
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  useMemo(() => {
    if (!exam.ends_at) return;
    const tick = () => {
      const s = Math.floor((new Date(exam.ends_at!).getTime() - Date.now()) / 1000);
      setRemainingSec(Math.max(0, s));
      if (s <= 0) {
        setEndedReason("time_up");
        qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [exam.ends_at, qc]);

  // enter fullscreen on mount
  useMemo(() => {
    if (!isFullscreenActive) requestFullscreen();
  }, [isFullscreenActive, requestFullscreen]);

  if (!questions) return <div className="grid place-items-center py-12"><Loader2 className="size-6 animate-spin" /></div>;
  if (endedReason) {
    return (
      <div className="container max-w-md py-12 text-center space-y-3">
        <AlertTriangle className="size-12 mx-auto text-amber-500" />
        <h2 className="text-xl font-semibold">{tr("ส่งข้อสอบอัตโนมัติ")}</h2>
        <p className="text-muted-foreground">
          {endedReason === "violation_threshold"
            ? tr("ออกจากหน้าสอบครบ ") + `${threshold} ` + tr("ครั้ง")
            : tr("หมดเวลาแล้ว")}
        </p>
        <Button onClick={() => nav({ to: "/exam/$examId", params: { examId: exam.id } })}>{tr("ดูผล")}</Button>
      </div>
    );
  }

  const q = questions[currentIdx];

  async function saveAnswer(questionId: string, value: { answer_idx?: number; answer_text?: string }) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
    try {
      await rpcSubmitExamAnswer({ question_id: questionId, ...value });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("บันทึกคำตอบล้มเหลว"));
    }
  }

  async function submitAll() {
    try {
      await rpcSubmitExam(exam.id);
      toast.success(tr("ส่งข้อสอบแล้ว"));
      qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      qc.invalidateQueries({ queryKey: ["xp-transactions"] });
      qc.invalidateQueries({ queryKey: ["xp-summary"] });
      nav({ to: "/exam/$examId", params: { examId: exam.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ส่งข้อสอบล้มเหลว"));
    }
  }

  const mmss = remainingSec !== null ? `${Math.floor(remainingSec/60)}:${String(remainingSec%60).padStart(2,"0")}` : "--:--";

  return (
    <div className="min-h-screen flex flex-col">
      {/* sticky top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1"><Clock className="size-4" /> {tr("เหลือ")} <span className="font-mono font-bold">{mmss}</span></span>
        <span className="flex items-center gap-1">
          <AlertTriangle className={`size-4 ${violationCount >= threshold - 1 ? "text-red-500" : "text-amber-500"}`} />
          {tr("โกง")} {violationCount}/{threshold}
        </span>
      </div>

      <div className="flex-1 container max-w-2xl py-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{tr("ข้อ")} {currentIdx + 1}/{questions.length}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={currentIdx === 0} onClick={() => setCurrentIdx((i) => i - 1)}>◀</Button>
            <Button size="sm" variant="outline" disabled={currentIdx === questions.length - 1} onClick={() => setCurrentIdx((i) => i + 1)}>▶</Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-base">{q.question}</p>
            {q.question_type === "multiple_choice" ? (
              <div className="space-y-2">
                {(q.options ?? []).map((opt, oi) => (
                  <label key={oi} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer hover:bg-muted/40 ${answers[q.id]?.answer_idx === oi ? "border-primary bg-primary/5" : ""}`}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={answers[q.id]?.answer_idx === oi}
                      onChange={() => saveAnswer(q.id, { answer_idx: oi })}
                    />
                    <span>{["ก","ข","ค","ง","จ"][oi]}. {opt}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Textarea
                value={answers[q.id]?.answer_text ?? ""}
                onChange={(e) => saveAnswer(q.id, { answer_text: e.target.value })}
                placeholder={tr("พิมพ์คำตอบ...")}
                rows={3}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => { if (confirm(tr("ส่งข้อสอบเลย? ไม่สามารถแก้ไขได้หลังส่ง"))) submitAll(); }}>
            <Send className="size-4 mr-1" /> {tr("ส่งข้อสอบ")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultsScreen({ exam, participant }: {
  exam: NonNullable<Awaited<ReturnType<typeof fetchExamRaw>>>;
  participant: { total_score: number | null; auto_submitted: boolean; auto_submit_reason: string | null; violation_count: number };
}) {
  return (
    <div className="container max-w-md py-12 text-center space-y-4">
      <h1 className="text-2xl font-semibold">{tr("ส่งข้อสอบเรียบร้อย")}</h1>
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="text-4xl font-bold text-primary">{participant.total_score ?? "--"}</div>
          <p className="text-sm text-muted-foreground">{tr("คะแนน (อาจปรับหลัง AI ตรวจเติมคำ)")}</p>
          {participant.auto_submitted && (
            <Badge variant="destructive">
              {tr("ส่งอัตโนมัติ")}: {participant.auto_submit_reason === "violation_threshold" ? tr("โกงครบ") : tr("หมดเวลา")}
            </Badge>
          )}
          {participant.violation_count > 0 && (
            <p className="text-xs text-muted-foreground">{tr("ออกจากหน้าสอบ")} {participant.violation_count} {tr("ครั้ง")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// missing import
import { supabase } from "@/integrations/supabase/client";
```

- [ ] **Step 2: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน (ถ้า error เรื่อง import order ให้แก้ — `supabase` import ควรอยู่บนสุด)

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/exam.\$examId.tsx
git commit -m "feat(exam): host dashboard + student exam screen with proctoring"
```

---

### Task 10: Route — exam.join.tsx + report

**Files:**
- Create: `src/routes/_authenticated/exam.join.tsx`
- Create: `src/routes/_authenticated/exam.$examId.report.tsx`

- [ ] **Step 1: สร้าง exam.join.tsx (mirror quiz.join.tsx)**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, KeyRound } from "lucide-react";
import { tr } from "@/i18n";
import { rpcJoinExamByCode } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/join")({
  component: JoinExamPage,
});

function JoinExamPage() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 6) { toast.error(tr("กรอกรหัส 6 หลัก")); return; }
    setLoading(true);
    try {
      const result = await rpcJoinExamByCode(code.trim().toUpperCase());
      nav({ to: "/exam/$examId", params: { examId: result.exam_id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("เข้าร่วมสอบไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[60vh] grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="size-14 mx-auto rounded-xl bg-primary/15 grid place-items-center mb-2">
            <KeyRound className="size-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">{tr("เข้าสอบ")}</CardTitle>
          <p className="text-sm text-muted-foreground">{tr("กรอกรหัส 6 หลักจากครู")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="exam-code">{tr("รหัสสอบ")}</Label>
              <Input
                id="exam-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABC123"
                className="text-center text-2xl font-mono tracking-widest h-14"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading || code.length < 6}>
              {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
              {tr("เข้าสอบ")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: สร้าง exam.$examId.report.tsx (รายงานครู + CSV export)**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, ArrowLeft } from "lucide-react";
import { tr } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamRaw, fetchParticipants, fetchExamQuestionsRaw } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/$examId/report")({
  component: ExamReportPage,
});

function ExamReportPage() {
  const { examId } = Route.useParams();
  const { data: exam } = useQuery({ queryKey: ["exam", examId], queryFn: () => fetchExamRaw(examId) });
  const { data: participants } = useQuery({ queryKey: ["exam-participants", examId], queryFn: () => fetchParticipants(examId) });
  const { data: questions } = useQuery({ queryKey: ["exam-questions-raw", examId], queryFn: () => fetchExamQuestionsRaw(examId) });

  // get display names
  const userIds = (participants ?? []).map((p) => p.user_id);
  const { data: profiles } = useQuery({
    queryKey: ["exam-report-profiles", userIds],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
      return (data ?? []) as { id: string; display_name: string }[];
    },
    enabled: userIds.length > 0,
  });
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const maxScore = (questions ?? []).reduce((s, q) => s + q.points, 0);
  const submittedCount = (participants ?? []).filter((p) => p.submitted_at).length;
  const autoCount = (participants ?? []).filter((p) => p.auto_submitted).length;

  function exportCsv() {
    const rows = [
      [tr("ชื่อ"), tr("คะแนน"), `/${maxScore}`, tr("โกง"), tr("ส่งอัตโนมัติ"), tr("เหตุผล")],
      ...(participants ?? []).map((p) => [
        nameById.get(p.user_id) ?? p.user_id.slice(0,8),
        String(p.total_score ?? ""),
        String(p.violation_count),
        p.auto_submitted ? tr("ใช่") : tr("ไม่"),
        p.auto_submit_reason ?? "",
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${exam?.title ?? "exam"}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!exam || !participants) return <div className="grid place-items-center py-12"><Loader2 className="size-6 animate-spin" /></div>;

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/exam/$examId" params={{ examId }}><ArrowLeft className="size-4" /></Link></Button>
        <h1 className="text-2xl font-semibold">{tr("รายงาน: ")}{exam.title}</h1>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">{submittedCount}/{participants.length}</div>
            <div className="text-xs text-muted-foreground">{tr("ส่งแล้ว")}</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">{autoCount}</div>
            <div className="text-xs text-muted-foreground">{tr("ส่งอัตโนมัติ")}</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{maxScore}</div>
            <div className="text-xs text-muted-foreground">{tr("คะแนนเต็ม")}</div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={exportCsv} variant="outline"><Download className="size-4 mr-1" /> {tr("Export CSV")}</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("นักเรียน")}</TableHead>
                <TableHead className="text-right">{tr("คะแนน")}</TableHead>
                <TableHead className="text-center">{tr("โกง")}</TableHead>
                <TableHead className="text-center">{tr("สถานะ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{nameById.get(p.user_id) ?? p.user_id.slice(0,8)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {p.total_score ?? "--"} / {maxScore}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.violation_count > 0 ? <Badge variant="outline">⚠ {p.violation_count}</Badge> : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.auto_submitted
                      ? <Badge variant="destructive">{tr("อัตโนมัติ")}</Badge>
                      : p.submitted_at
                        ? <Badge>{tr("ส่งเอง")}</Badge>
                        : <Badge variant="outline">{tr("ยังไม่ส่ง")}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: ตรวจ typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/exam.join.tsx src/routes/_authenticated/exam.\$examId.report.tsx
git commit -m "feat(exam): join-by-code route + teacher report with CSV export"
```

---

## Phase 5: Wire-up + i18n (Tasks 11-12)

### Task 11: Sidebar link + classroom tab

**Files:**
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/routes/_authenticated/classrooms.$id.tsx`

- [ ] **Step 1: เพิ่ม sidebar link ในกลุ่ม "การสอน"**

ใน `app-sidebar.tsx` ค้นหา group "การสอน" (teacher/admin roles) แล้วเพิ่ม:

```tsx
{ label: "การสอบ", url: "/exam", icon: FileText, roles: ["teacher", "admin"] },
```

อย่าลืม import `FileText` จาก lucide-react

- [ ] **Step 2: เพิ่ม link เข้าสอบใน student area ด้วย**

ในกลุ่ม "การเรียน" (student/admin) เพิ่ม:

```tsx
{ label: "เข้าสอบ", url: "/exam/join", icon: FileText, roles: ["student", "admin"] },
```

- [ ] **Step 3: (optional) เพิ่มแท็บใน `classrooms.$id.tsx`**

ถ้ามีเวลา — เพิ่มแท็บ "การสอบ" ในห้องเรียนโชว์รายการสอบของห้องนั้น (ครู) / สอบ active ของห้อง (นักเรียน) ถ้าไม่มีเวลาข้ามไปก่อน

- [ ] **Step 4: Commit**

```bash
git add src/components/app-sidebar.tsx
git commit -m "feat(exam): sidebar links (teacher + student)"
```

---

### Task 12: i18n keys

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: เพิ่ม entries ใน `enDict`**

```ts
"📝 การสอบ": "📝 Exams",
"📝 สร้างข้อสอบใหม่": "📝 Create new exam",
"รายละเอียดสอบ": "Exam details",
"ชื่อข้อสอบ": "Exam title",
"ระยะเวลา (นาที)": "Duration (minutes)",
"โกงสูงสุด (ครั้ง)": "Max violations",
"สร้างข้อสอบ": "Create exam",
"บันทึกเป็น draft": "Save as draft",
"ฉบับร่าง": "Draft",
"รอเปิดสอบ": "Scheduled",
"กำลังสอบ": "Active",
"ปิดแล้ว": "Closed",
"รหัสเข้าร่วม": "Join code",
"ระยะเวลา": "Duration",
"โกงสูงสุด": "Max violations",
"ครั้ง": "times",
"นาที": "min",
"กำหนดเวลาและเปิดสอบ": "Schedule and open",
"เปิดสอบเมื่อ": "Open at",
"ปิดสอบเมื่อ": "Close at",
"กำหนดเวลา": "Schedule",
"เปิดสอบเลย": "Open now",
"ปิดสอบ (force-submit คนที่ยังไม่ส่ง)": "Close exam (force-submit unsubmitted)",
"ผู้เข้าสอบ": "Participants",
"ยังไม่มีคนเข้าร่วม — แชร์รหัส ": "No participants yet — share code ",
"ส่งแล้ว": "Submitted",
"อัตโนมัติ": "Auto",
"กำลังทำ": "In progress",
"รอเริ่ม": "Waiting",
"เข้าสอบด้วยรหัส": "Join by code",
"เริ่มสอบ": "Start exam",
"หน้านี้สำหรับครูเท่านั้น — นักเรียนใช้การเข้าสอบด้วยรหัส": "Teachers only — students join via code",
"ยังไม่มีข้อสอบ — สร้างข้อสอบแรกของคุณ": "No exams yet — create your first",
"ออกจากหน้าสอบสูงสุด": "Max exits from exam:",
"ออกจากหน้าสอบ": "Left exam",
"ครบจะส่งอัตโนมัติ": "— auto-submit on reaching limit",
"ต้องสอบในโหมดเต็มจอ": "Must take exam in fullscreen",
"⚠ กติกาสอบ:": "⚠ Exam rules:",
"ห้ามเปลี่ยน tab, หน้าต่าง หรือออกจากโหมดเต็มจอ": "No switching tabs/windows or exiting fullscreen",
"ห้าม copy/paste หรือเปิดเครื่องมืออื่น": "No copy/paste or other tools",
"ทุกครั้งที่ออกจากหน้าจะนับเป็นการโกง": "Each exit counts as a violation",
"หมดเวลาหรือโกงครบจะส่งอัตโนมัติ": "Auto-submit on timeout or violation limit",
"เหลือ": "Remaining",
"โกง": "Violations",
"ข้อ": "Question",
"ส่งข้อสอบ": "Submit exam",
"ส่งข้อสอบเลย? ไม่สามารถแก้ไขได้หลังส่ง": "Submit now? Cannot edit after submit",
"ส่งข้อสอบเรียบร้อย": "Exam submitted",
"ส่งข้อสอบอัตโนมัติ": "Auto-submitted",
"ออกจากหน้าสอบครบ": "Reached violation limit:",
"หมดเวลาแล้ว": "Time up",
"ดูผล": "View result",
"คะแนน (อาจปรับหลัง AI ตรวจเติมคำ)": "Score (may adjust after AI grading)",
"เข้าสอบ": "Join exam",
"กรอกรหัส 6 หลักจากครู": "Enter the 6-digit code from your teacher",
"รหัสสอบ": "Exam code",
"รายงาน: ": "Report: ",
"นักเรียน": "Student",
"คะแนน": "Score",
"สถานะ": "Status",
"ส่งเอง": "Self-submitted",
"ยังไม่ส่ง": "Not submitted",
"Export CSV": "Export CSV",
"force-submit ": "force-submit ",
" คน": " students",
"ปรนัย (ก/ข/ค/ง)": "Multiple choice",
"เติมคำสั้น": "Short answer",
"เพิ่มข้อ": "Add question",
"ลบ": "Remove",
"คำตอบที่ถูก (หรือคำสำคัญ)": "Correct answer (or keywords)",
"AI จะใช้คำนี้เป็นเกณฑ์ตรวจคำตอบนักเรียน": "AI will use this as grading reference",
"คะแนน:": "Points:",
"เวลาเปิด": "Opens at",
"เวลาปิด": "Closes at",
"ไม่สามารถเข้าโหมดเต็มจอได้ — กรุณาอนุญาตในเบราว์เซอร์": "Cannot enter fullscreen — please allow in browser",
"⚠ ออกจากหน้าสอบ ": "⚠ Left exam ",
" ครั้ง — ครบ ": " times — at ",
" ครั้งจะส่งอัตโนมัติ": " auto-submit",
```

- [ ] **Step 2: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(exam): i18n keys for exam UI"
```

---

## Phase 6: AI Grading Edge Function (Task 13) — optional/post-MVP

### Task 13: Edge function grade-exam-short-answers

**Files:**
- Create: `supabase/functions/grade-exam-short-answers/index.ts`

- [ ] **Step 1: สร้าง edge function (mirror generate-quest pattern)**

```ts
// supabase/functions/grade-exam-short-answers/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { exam_id } = await req.json();
  if (!exam_id) return new Response("exam_id required", { status: 400 });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // fetch ungraded short answers
  const { data: answers, error: aErr } = await sb
    .from("exam_answers")
    .select(`
      id, question_id, user_id, answer_text,
      exam_questions!inner(expected_answer, question, points)
    `)
    .eq("session_id", exam_id)
    .eq("graded_by", null)
    .not("answer_text", "is", null);
  if (aErr) return new Response(JSON.stringify(aErr), { status: 500 });
  if (!answers || answers.length === 0) {
    return new Response(JSON.stringify({ graded: 0 }), { headers: { "content-type": "application/json" } });
  }

  let graded = 0;
  for (const a of answers) {
    const q = a.exam_questions as unknown as { expected_answer: string; question: string; points: number };
    // call AI gateway
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You grade Thai student short answers. Compare the student's answer against the expected answer/key terms. Return JSON only: {"is_correct": bool, "score": int (0 to max_points), "reason": "short explanation in Thai"}. Be lenient with typos, synonyms, and equivalent phrasings in Thai.`,
          },
          {
            role: "user",
            content: `Question: ${q.question}\nExpected answer: ${q.expected_answer}\nMax points: ${q.points}\nStudent answer: ${a.answer_text}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const aiJson = await aiRes.json();
    try {
      const result = JSON.parse(aiJson.choices[0].message.content);
      await sb.rpc("grade_short_answer", {
        _question_id: a.question_id,
        _user_id: a.user_id,
        _is_correct: !!result.is_correct,
        _score: Math.max(0, Math.min(q.points, Number(result.score) || 0)),
        _graded_by: "ai",
      });
      graded++;
    } catch (e) {
      console.error("Grade failed for", a.id, e);
    }
  }

  return new Response(JSON.stringify({ graded }), { headers: { "content-type": "application/json" } });
});
```

- [ ] **Step 2: เชื่อมใน close_exam (optional post-MVP)**

ใน `close_exam` RPC (Task 2) เพิ่ม HTTP POST ไป edge function (best-effort ใช้ `pg_http` extension หรือทำผ่าน UI ทีหลัง ครูกดปุ่ม "ตรวจด้วย AI") — สำหรับ MVP ให้ครูเรียก edge function เองผ่าน UI button

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/grade-exam-short-answers/index.ts
git commit -m "feat(exam): AI grading edge function for short answers"
```

---

## Phase 7: Quality gates (Task 14)

### Task 14: Final verification

- [ ] **Step 1: typecheck**

```bash
npm run typecheck
```

Expected: ผ่าน (เหลือเพียง vite.config.ts error ของ Lovable เท่านั้น)

- [ ] **Step 2: build**

```bash
npm run build
```

Expected: ผ่าน

- [ ] **Step 3: lint new files**

```bash
npx eslint --fix src/lib/exam.functions.ts src/hooks/use-exam-proctoring.ts src/routes/_authenticated/exam.index.tsx src/routes/_authenticated/exam.new.tsx src/routes/_authenticated/exam.\$examId.tsx src/routes/_authenticated/exam.join.tsx src/routes/_authenticated/exam.\$examId.report.tsx
```

Expected: ผ่าน (auto-fix prettier)

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "chore(exam): final typecheck + lint + build verification"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] 5 tables + view + RLS → Task 1
- [x] 12 RPCs (6 teacher + 6 student/proctoring) → Tasks 2-3
- [x] types.ts → Task 4
- [x] data layer → Task 5
- [x] proctoring hook → Task 6
- [x] 6 routes (index, new, $examId, join, report) → Tasks 7-10
- [x] sidebar + i18n → Tasks 11-12
- [x] AI grading → Task 13 (optional)
- [x] XP via award_xp → Task 3 (submit_exam + auto_submit_exam)
- [x] enum 'exam' added → Task 1
- [x] RLS / safe view / realtime drop → Task 1

**2. Type consistency:**
- `ExamQuestionSafeRow` from view consistent across queries
- RPC signatures match between Task 4 (types) and Task 5 (data layer)
- `useExamProctoring` API: `{ examId, enabled, threshold, onAutoSubmit }` used in Task 9

**3. Placeholder scan:** ไม่มี TODO — ทุก step มี code

---

## Execution Handoff

Plan บันทึกที่ `docs/superpowers/plans/2026-07-16-exam-proctoring.md`

**ข้อจำกัดสำคัญ:**
- **Dev server ใช้ไม่ได้** (MCP plugin bug ของ Lovable) → verification หลักคือ typecheck + build
- **Migrations ต้องรันบน Supabase Studio เอง** ภายหลัง — ไม่สามารถทดสอบ RPC จริงได้ระหว่าง implement

**แนะนำ: Subagent-Driven** — เหมาะกับ task-based plan ที่ชัดเจน
