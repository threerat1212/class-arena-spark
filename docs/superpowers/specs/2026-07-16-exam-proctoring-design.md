# Exam System with Proctoring — Design Spec

> **วันที่:** 2026-07-16
> **โปรเจกต์:** Scholar Hall (class-arena-spark)
> **สถานะ:** อนุมัติ design แล้วใน brainstorming — รอ implementation plan
> **Deadline:** สอบสัปดาห์หน้า (~2026-07-22)
> **เกี่ยวข้องกับ:** `2026-07-15-xp-activity-ledger-design.md` (ใช้ `award_xp` + เพิ่ม enum `'exam'`)

---

## 1. บทนำและเหตุผล

### วัตถุประสงค์
สร้างระบบสอบในเว็บสำหรับโรงเรียน พร้อมระบบ **proctoring (ตรวจจับการโกง)** เพื่อใช้สอบจริงสัปดาห์หน้า

### ข้อจำกัดเชิงเทคนิคที่ต้องยอมรับ
เบราว์เซอร์ออกแบบให้ผู้ใช้คุมเครื่องเอง ไม่ใช่ให้เว็บคุม ดังนั้น:
- ❌ **ล็อกจอจริง 100% (กด Alt+Tab, Ctrl+T ไม่ได้) — เว็บทำไม่ได้**
- ❌ บังคับ fullscreen ถาวร — เบราว์เซอร์ให้ Esc ออกเสมอ
- ❌ ปิด DevTools — นักเรียนเปิดได้เสมอ

### สิ่งที่ทำได้จริง (Proctoring + Detection)
| ฟีเจอร์ | ประสิทธิภาพ |
|---|---|
| ตรวจจับ visibilitychange + blur + fullscreenchange events | ✅ แม่นยำ |
| บันทึกทุกครั้งที่ออกจากหน้าสอบ + counter ขึ้นจอ | ✅ |
| ส่งอัตโนมัติเมื่อครบ violation_threshold | ✅ |
| บังคับ fullscreen เข้าสอบ + ตรวจจับการออก | ✅ |
| ปิด copy/paste/context menu | ✅ |
| เวลาฝั่งเซิร์ฟเวอร์ — หมดเวลาส่งอัตโนมัติ | ✅ กันหน่วงเวลา |
| รายงานครู — เห็น violation count รายคน | ✅ |

**การันตีความถูกต้องของคะแนนอาศัย: (1) เวลาฝั่งเซิร์ฟเวอร์ (2) idempotent submit-once + (3) การเฝ้าในห้องของครู** — proctoring เป็น deterrent + audit log ไม่ใช่การันตีแบบ hard lock

---

## 2. ขอบเขต (Scope)

### ในขอบเขต (In scope)
- ระบบสอบใหม่ 5 ตาราง + 1 view + enum ใหม่ `'exam'`
- RPCs 12 ตัว (SECURITY DEFINER + server-enforced time)
- Proctoring hook `useExamProctoring` + violation counter overlay
- 6 หน้า UI: index / new / `$examId` (host+student รวม) / join / report / แท็บใน classroom
- AI grading สำหรับเติมคำสั้น (edge function ใหม่ `grade-exam-short-answers`)
- XP ตามคะแนนผ่าน `award_xp` (source='exam')
- CSV export รายงาน

### นอกขอบเขต (Out of scope — YAGNI)
- ❌ Webcam / screen recording proctoring
- ❌ ข้อความยาว (essay) — มีเฉพาะปรนัย + เติมคำสั้น
- ❌ สุ่มลำดับข้อ / สุ่มช้อยส์ (shuffle)
- ❌ Bank ข้อสอบ / นำกลับมาใช้ใหม่ — สร้างใหม่ทุกครั้ง
- ❌ Realtime คะแนนห้องระหว่างสอบ
- ❌ สอบแต่ละคนเริ่มเอง (per-student timer) — ใช้ "ครูกดเปิด รวมเวลา" เท่านั้น

---

## 3. Data Model

### 3.1 Enum ใหม่
```sql
ALTER TYPE public.app_xp_source ADD VALUE 'exam';
```

### 3.2 ตารางใหม่ 5 ตาราง

```sql
-- 1. หัวข้อสอบ
CREATE TABLE public.exam_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id        uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  host_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title               text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','active','closed')),
  join_code           char(6) NOT NULL UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(4),'hex'),1,6)),
  starts_at           timestamptz,                    -- NULL ใน draft; SET เมื่อ publish
  ends_at             timestamptz,                    -- NULL ใน draft; SET เมื่อ publish
  duration_minutes    int  NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 300),
  violation_threshold int  NOT NULL DEFAULT 5 CHECK (violation_threshold BETWEEN 1 AND 20),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_sessions_classroom ON public.exam_sessions (classroom_id, status);

-- 2. ข้อสอบ
CREATE TABLE public.exam_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  idx             int  NOT NULL,
  question_type   text NOT NULL CHECK (question_type IN ('multiple_choice','short_answer')),
  question        text NOT NULL,
  options         jsonb,                              -- MCQ: array of strings
  correct_idx     int,                                -- MCQ: ซ่อนด้วย _safe view
  expected_answer text,                               -- short: ซ่อนด้วย _safe view (keyword hints)
  points          int  NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idx)
);
CREATE INDEX idx_exam_questions_session ON public.exam_questions (session_id, idx);

-- 3. ผู้เข้าสอบ (1 row per student per exam)
CREATE TABLE public.exam_participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at        timestamptz,                      -- NULL จนกว่าจะ start_exam_attempt
  submitted_at      timestamptz,                      -- NULL จนกว่าจะ submit/auto-submit
  total_score       int,                              -- NULL จนกว่าจะ grade ครบ
  violation_count   int  NOT NULL DEFAULT 0,
  auto_submitted    boolean NOT NULL DEFAULT false,
  auto_submit_reason text,                            -- 'violation_threshold' | 'time_up' | 'exam_closed'
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_exam_participants_session ON public.exam_participants (session_id);
CREATE INDEX idx_exam_participants_user ON public.exam_participants (user_id);

-- 4. คำตอบรายข้อ
CREATE TABLE public.exam_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL,                      -- denormalized เพื่อ RLS
  user_id         uuid NOT NULL,
  answer_idx      int,                                -- MCQ
  answer_text     text,                               -- short
  is_correct      boolean,
  score_awarded   int,
  graded_by       text CHECK (graded_by IN ('server','ai','teacher') OR graded_by IS NULL),
  graded_at       timestamptz,
  answered_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);
CREATE INDEX idx_exam_answers_session_user ON public.exam_answers (session_id, user_id);

-- 5. Proctoring events (append-only)
CREATE TABLE public.exam_proctoring_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  event_type    text NOT NULL CHECK (event_type IN
                  ('tab_blur','window_blur','fullscreen_exit','copy_attempt','paste_attempt')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exam_proctoring_session_user ON public.exam_proctoring_events (session_id, user_id, created_at DESC);
```

### 3.3 View `exam_questions_safe` (ซ่อนคำตอบ)

```sql
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
```

### 3.4 RLS Policy

```sql
-- exam_sessions: classroom members อ่านได้; host/admin write
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_sessions read classroom" ON public.exam_sessions FOR SELECT TO authenticated
  USING (public.is_classroom_member(classroom_id, auth.uid())
         OR host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "exam_sessions host write" ON public.exam_sessions FOR ALL TO authenticated
  USING (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (host_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- exam_questions: อ่านผ่าน _safe view เท่านั้น; raw table host/admin only
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_questions host only" ON public.exam_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- exam_participants: อ่านของตัวเอง + host/admin
ALTER TABLE public.exam_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_participants read own or host" ON public.exam_participants FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- exam_answers: เจ้าของ + host/admin (ไม่ broadcast ทาง realtime)
ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_answers read own or host" ON public.exam_answers FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                     AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- exam_proctoring_events: host/admin อ่านอย่างเดียว (นักเรียนไม่เห็น event ของใคร)
-- insert ผ่าน SECURITY DEFINER RPC record_exam_violation
ALTER TABLE public.exam_proctoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_proctoring host read" ON public.exam_proctoring_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.exam_sessions s WHERE s.id = session_id
                  AND (s.host_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- Realtime hardening: ห้าม broadcast exam_answers (กัน peer leak)
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.exam_answers;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.exam_proctoring_events;

-- Grants
GRANT SELECT ON public.exam_sessions, public.exam_questions_safe,
                public.exam_participants, public.exam_answers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_questions TO authenticated;  -- host เขียนผ่าน RLS
GRANT SELECT ON public.exam_proctoring_events TO authenticated;  -- host อ่านผ่าน RLS
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
```

---

## 4. RPCs (SECURITY DEFINER + server-enforced time)

ทุก RPC `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`

### 4.1 Teacher RPCs

```sql
-- สร้าง exam (status=draft)
create_exam(_classroom_id uuid, _title text, _duration_minutes int DEFAULT 60, _violation_threshold int DEFAULT 5)
RETURNS uuid   -- exam_id
-- ตรวจ is_classroom_owner

-- Bulk upsert ข้อสอบ (draft เท่านั้น)
update_exam_questions(_exam_id uuid, _questions jsonb)
RETURNS void
-- ตรวจ owner + status='draft'

-- Publish: draft → scheduled + ตั้งเวลา
publish_exam(_exam_id uuid, _starts_at timestamptz, _ends_at timestamptz)
RETURNS void
-- ตรวจ owner + status='draft'; ตรวจ _starts_at < _ends_at

-- ⭐ เปิดสอบ: scheduled → active (ครูกด)
open_exam(_exam_id uuid)
RETURNS void
-- ตรวจ owner + status='scheduled'

-- ปิดสอบ: active → closed + force-submit คนที่ยังไม่ส่ง + trigger AI grade
close_exam(_exam_id uuid)
RETURNS table(user_id uuid, auto_submitted boolean)
-- ตรวจ owner + status='active'

-- Grade เติมคำสั้น (เรียกจาก AI edge function / ครู manual)
grade_short_answer(_question_id uuid, _user_id uuid, _is_correct boolean, _score int, _graded_by text)
RETURNS void
-- ตรวจ is host ของ session; update exam_answers + recompute total_score
```

### 4.2 Student RPCs

```sql
-- เข้าร่วมด้วยรหัส
join_exam_by_code(_code text)
RETURNS table(exam_id uuid, title text)
-- INSERT exam_participants ON CONFLICT DO NOTHING; ตรวจ classroom member + now() BETWEEN starts_at AND ends_at

-- เริ่ม attempt (บันทึก started_at ครั้งแรก) + return context ที่ client ต้องการ
start_exam_attempt(_exam_id uuid)
RETURNS table(ends_at timestamptz, violation_threshold int, duration_minutes int, started_at timestamptz)
-- ตรวจ status='active'; UPDATE participants SET started_at=now() WHERE started_at IS NULL
-- return ค่าเหล่านี้ให้ client ใช้ countdown + setup proctoring hook

-- ส่งคำตอบรายข้อ (auto-save) + auto-grade ปรนัยทันที
submit_exam_answer(_question_id uuid, _answer_idx int DEFAULT NULL, _answer_text text DEFAULT NULL)
RETURNS table(is_correct boolean, score_awarded int)
-- ตรวจ now() < s.ends_at มิฉะนั้น RAISE 'หมดเวลาแล้ว'
-- ปรนัย: server เทียบ correct_idx → is_correct + score_awarded
-- เติมคำ: ยังไม่ grade (graded_by=NULL) รอ AI

-- บันทึก violation + auto-submit ถ้าครบ threshold
record_exam_violation(_exam_id uuid, _event_type text, _payload jsonb DEFAULT '{}')
RETURNS table(violation_count int, auto_submitted boolean)
-- INSERT exam_proctoring_events
-- UPDATE participants SET violation_count = violation_count + 1
-- IF violation_count >= threshold THEN PERFORM auto_submit_exam(...); RETURN auto_submitted=true

-- ส่งข้อสอบ (manual)
submit_exam(_exam_id uuid)
RETURNS table(total_score int, xp_awarded int)
-- idempotent: 'exam_submit:' || exam_id || ':' || user_id
-- คำนวณ total_score = SUM(score_awarded) จาก exam_answers
-- UPDATE participants SET submitted_at=now(), total_score=...
-- PERFORM award_xp(_source='exam', _amount=total_score, ...)

-- ส่งอัตโนมัติ (เรียกภายใน record_exam_violation / close_exam)
auto_submit_exam(_exam_id uuid, _user_id uuid, _reason text)
RETURNS void
-- เหมือน submit_exam แต่ auto_submitted=true + auto_submit_reason=_reason
```

### 4.3 Time check invariant

ทุก RPC ที่นักเรียนเรียก (join/start/submit_answer/record_violation/submit) ต้อง:
1. ตรวจ `s.status` ที่เหมาะสม (active สำหรับการทำข้อสอบ)
2. ตรวจ `now() < s.ends_at` (ยกเว้น record_violation ที่อนุญาตตอน auto-submit)
3. Client countdown ใช้ `ends_at` เป็นหลัก (server-time; client ดึงจาก RPC `start_exam_attempt` return ค่า `ends_at`)

---

## 5. AI Grading Flow (เติมคำสั้น)

### Edge function ใหม่ `supabase/functions/grade-exam-short-answers/index.ts`
- รับ `{ exam_id }` ใน body + Authorization header (Supabase JWT)
- ตรวจ role = host ของ classroom ที่เป็นเจ้าของ exam (ผ่าน service role)
- Query: `SELECT * FROM exam_answers WHERE session_id=exam_id AND graded_by IS NULL AND answer_text IS NOT NULL`
- วนเรียก Lovable AI Gateway (`google/gemini-2.5-flash`) สำหรับแต่ละคำตอบ:
  - Prompt: เทียบ `answer_text` กับ `expected_answer` + `question` → return `{ is_correct: bool, score: int, reason: text }`
- เขียนกลับผ่าน `grade_short_answer` RPC (service role bypass RLS)

### Trigger
- `close_exam` จะ HTTP POST ไป edge function (best-effort; ถ้า fail ครู grade เอง)
- ในระหว่างนั้น report แสดง "⏳ กำลังตรวจ" สำหรับข้อเติมคำ

---

## 6. UI Design

### 6.1 Routes (6 หน้า)

| Route | ผู้ใช้ | Layout |
|---|---|---|
| `/exam` (exam.index.tsx) | ครู | รายการสอบในทุกห้องของตน + ปุ่ม "สร้างข้อสอบ" |
| `/exam/new` (exam.new.tsx) | ครู | ฟอร์มสร้าง: ชื่อ, ระยะเวลา, threshold, เพิ่มข้อ (ปรนัย/เติมคำสั้นสลับกันได้) |
| `/exam/$examId` (exam.$examId.tsx) ⭐ | ทั้งคู่ | **Host view**: dashboard (lobby/active/closed), ปุ่ม publish/open/close, รายชื่อเข้าร่วม. **Student view**: หน้า "Ready?" → หน้าสอบจริง + proctoring |
| `/exam/join` (exam.join.tsx) | นักเรียน | กรอกรหัส 6 หลัก → navigate ไป `/exam/$id` |
| `/exam/$examId/report` (exam.$examId.report.tsx) | ครู | ตารางคะแนน + violation count + auto_submitted flag + Export CSV |
| (เพิ่มใน `classrooms.$id.tsx`) | ทั้งคูย | แท็บ "การสอบ" |

### 6.2 Proctoring Hook (`src/hooks/use-exam-proctoring.ts`)

```ts
interface UseExamProctoringArgs {
  examId: string;
  enabled: boolean;            // true เมื่อนักเรียน start attempt + active
  onAutoSubmit: (reason: string) => void;
}

interface UseExamProctoringReturn {
  violationCount: number;
  threshold: number;
  isFullscreenActive: boolean;
  requestFullscreen: () => Promise<void>;
}

function useExamProctoring({ examId, enabled, onAutoSubmit }: UseExamProctoringArgs): UseExamProctoringReturn {
  const [violationCount, setViolationCount] = useState(0);
  const [threshold, setThreshold] = useState(5);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    // 1. visibilitychange → tab_blur
    const onVisibility = () => {
      if (document.hidden) recordViolation('tab_blur');
    };
    // 2. window blur → window_blur
    const onBlur = () => recordViolation('window_blur');
    // 3. fullscreenchange → fullscreen_exit
    const onFsChange = () => {
      if (!document.fullscreenElement) recordViolation('fullscreen_exit');
      else setIsFullscreenActive(true);
    };
    // 4. copy/paste → copy_attempt/paste_attempt
    const onCopy = (e: ClipboardEvent) => { e.preventDefault(); recordViolation('copy_attempt'); };
    const onPaste = (e: ClipboardEvent) => { e.preventDefault(); recordViolation('paste_attempt'); };
    // 5. contextmenu
    const onContext = (e: MouseEvent) => e.preventDefault();

    async function recordViolation(eventType: string) {
      const { data } = await supabase.rpc('record_exam_violation', {
        _exam_id: examId, _event_type: eventType,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setViolationCount(row.violation_count);
        if (row.violation_count < threshold) {
          toast.warning(`⚠ ออกจากหน้าสอบ ${row.violation_count}/${threshold} ครั้ง — ครบ ${threshold} ครั้งจะส่งอัตโนมัติ`);
        }
        if (row.auto_submitted) {
          onAutoSubmit('violation_threshold');
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContext);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContext);
    };
  }, [enabled, examId, threshold, onAutoSubmit]);

  const requestFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreenActive(true);
    } catch {
      toast.error('ไม่สามารถเข้าโหมดเต็มจอได้ — กรุณาอนุญาตในเบราว์เซอร์');
    }
  };

  return { violationCount, threshold, isFullscreenActive, requestFullscreen };
}
```

**ข้อควรระวัง edge cases:**
- `blur` + `visibilitychange` อาจ trigger พร้อมกัน (เช่น คลิกไป tab อื่น) → ใช้ debounce 100ms ภายใน `recordViolation` เพื่อกัน double-count ในเหตุการณ์เดียว
- หลัง `requestFullscreen` สำเร็จ browser อาจ trigger `fullscreenchange` → ต้อง track ว่า "เข้าใหม่" ไม่ใช่ "ออก"
- iOS Safari ไม่รองรับ Fullscreen API → fallback: แค่เตือน "กรุณาอย่าออกจากหน้า" (ไม่น่าใช้สอบในมือถืออยู่แล้ว)

### 6.3 หน้าสอบจริง (นักเรียน) — wireframe

```
┌─────────────────────────────────────────────────┐
│ ⏱ เหลือ 42:17       ⚠ 2/5     [✕ ออก = โกง]    │  ← sticky top bar
├─────────────────────────────────────────────────┤
│  ◀ ข้อ 3/20    ▶                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ จงเติมคำที่ขาดในประโยคต่อไปนี้               │  │
│  │ "光合作用需要 ___、水、和二氧化碳"            │  │
│  └───────────────────────────────────────────┘  │
│  คำตอบ: [_______________________________]      │
│  (บันทึกอัตโนมัติเมื่อพิมพ์เสร็จ)                  │
│                                                 │
│  [บันทึกชั่วคราว]            [ส่งข้อสอบ]         │
└─────────────────────────────────────────────────┘
```

### 6.4 รายงานครู — wireframe

```
┌──────────────────────────────────────────────────────┐
│  รายงานสอบ: สอบกลางภาค — ม.4/1      [Export CSV]    │
│  สถานะ: ปิดแล้ว (AI ตรวจเติมคำเสร็จ)                  │
├──────────────────────────────────────────────────────┤
│  นักเรียน     ปรนัย   เติมคำ   รวม   โกง  ส่งอัตโนมัติ │
│  ──────────────────────────────────────────────────  │
│  สมชาย       10/10   8/10    18    0    ❌          │
│  สมหญิง       8/10   7/10    15    2    ❌          │
│  สมศักดิ์      6/10   6/10    12    5    ⚠️ โกง      │
│  สมปอง       9/10   ⏳       —     0    ❌          │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

---

## 7. XP Integration

`submit_exam` + `auto_submit_exam` เรียก `award_xp`:
```sql
PERFORM public.award_xp(
  _user_id         := _uid,
  _amount          := _total_score,
  _source          := 'exam'::public.app_xp_source,
  _source_label    := 'สอบ: ' || _exam.title,
  _subject         := _classroom_name,
  _ref_table       := 'exam_participants',
  _ref_id          := _participant_id,
  _classroom_id    := _exam.classroom_id,
  _metadata        := jsonb_build_object(
    'exam_id', _exam_id,
    'max_score', _max_score,
    'violation_count', _p.violation_count,
    'auto_submitted', _p.auto_submitted
  ),
  _idempotency_key := 'exam_submit:' || _exam_id::text || ':' || _uid::text
);
```

จะปรากฏใน `/activity` timeline + dashboard widget + `profiles.xp` อัปเดต atomic

---

## 8. Edge Cases และความปลอดภัย

| Edge case | การจัดการ |
|---|---|
| นักเรียนเปิด 2 tab พร้อมกัน | RLS + UNIQUE constraint ป้องกัน; `submit_exam_answer` ใช้ UPSERT |
| ปิดเบราว์เซอร์กลางคัน | `started_at` มี + `submitted_at` NULL → พอครู `close_exam` จะ force-submit |
| หมดเวลาระหว่างทำ | client countdown trigger auto-submit; server ก็ reject ทุก submit_answer ถ้า `now() >= ends_at` |
| Network หลุดตอนส่ง | idempotent key `exam_submit:exam_id:user_id` ป้องกัน double-XP |
| AI grade fail | `close_exam` best-effort trigger; fallback ครู grade เองผ่าน `grade_short_answer` |
| ครู forget publish (status=draft) | `join_exam_by_code` reject + แสดง "ยังไม่เปิดสอบ" |
| ครู open แล้ว ลืม close | `ends_at` บังคับ auto-submit เมื่อหมดเวลา แม้ status ยัง active |
| Tab blur + window blur พร้อมกัน | debounce 100ms ใน client + dedupe ด้วย (event_type, หาก record_exam_violation ถูกเรียก < 500ms หลังครั้งล่าสุดใน event_type เดียวกัน → skip) |
| iOS Safari ไม่มี Fullscreen | fallback เตือน "ไม่แนะนำให้สอบในมือถือ"; ไม่ block |
| Violation หลัง submit แล้ว | hook disable เมื่อ `submitted_at != NULL`; RPC reject ถ้า submitted แล้ว |
| ปรนัย auto-grade ผิดเพราะ correct_idx = NULL | server ใช้ raw `exam_questions` (service role bypass RLS) ไม่ใช้ `_safe` view |

---

## 9. ลำดับการ implement (Build Sequence)

ทำตาม phase เพื่อให้ deploy ได้ตั้งแต่ phase แรก (แม้จะยังไม่สมบูรณ์):

### Phase 1 — Database + Core RPCs (พื้นฐาน สอบได้)
1. Migration: enum `'exam'` + 5 ตาราง + RLS + view + grants + realtime drop
2. Migration: create_exam, update_exam_questions, publish_exam, open_exam, join_exam_by_code, start_exam_attempt, submit_exam_answer, submit_exam, close_exam
3. Types regenerate

### Phase 2 — Proctoring RPC + Hook
4. Migration: record_exam_violation + auto_submit_exam + grade_short_answer
5. `use-exam-proctoring.ts` hook

### Phase 3 — Teacher UI
6. exam.index.tsx, exam.new.tsx
7. exam.$examId.tsx (host view)
8. แท็บใน classrooms.$id.tsx

### Phase 4 — Student UI + Proctoring
9. exam.join.tsx
10. exam.$examId.tsx (student view) — Ready screen, exam screen with proctoring, results screen

### Phase 5 — AI Grading + Report
11. Edge function `grade-exam-short-answers`
12. exam.$examId.report.tsx + CSV export
13. Sidebar link + i18n keys

### Phase 6 — Hardening + Quality gates
14. typecheck + build + smoke test
15. code review

---

## 10. ไฟล์ที่จะกระทบ

### สร้างใหม่ (≈15)
- `supabase/migrations/<ts>_exam_schema.sql` (1 migration รวม)
- `supabase/migrations/<ts>_exam_rpcs.sql` (RPCs ทั้งหมด)
- `supabase/functions/grade-exam-short-answers/index.ts`
- `src/hooks/use-exam-proctoring.ts`
- `src/lib/exam.functions.ts` (client data layer)
- `src/routes/_authenticated/exam.index.tsx`
- `src/routes/_authenticated/exam.new.tsx`
- `src/routes/_authenticated/exam.$examId.tsx`
- `src/routes/_authenticated/exam.join.tsx`
- `src/routes/_authenticated/exam.$examId.report.tsx`
- `src/components/exam-timer.tsx` (countdown sticky bar)
- `src/components/exam-violation-overlay.tsx` (counter + warning)
- `docs/superpowers/specs/2026-07-16-exam-proctoring-design.md` (เอกสารนี้)

### แก้ไข (≈5)
- `src/integrations/supabase/types.ts` (regenerate)
- `src/components/app-sidebar.tsx` (เพิ่ม link "การสอบ" ในกลุ่ม "การสอน")
- `src/routes/_authenticated/classrooms.$id.tsx` (เพิ่มแท็บ "การสอบ")
- `src/i18n.ts` (เพิ่ม keys)
- `src/lib/xp-transactions.functions.ts` (อัปเดต XpSource type ถ้า enum export)

---

## 11. ความเสี่ยง + การบรรเทา

| ความเสี่ยง | ระดับ | การบรรเทา |
|---|---|---|
| Deadline สัปดาห์หน้าแน่น | สูง | Phase 1-4 คือ MVP (สอบปรนัยได้จริง); Phase 5-6 เสริม |
| Proctoring bypass โดยนักเรียนเก่ง | กลาง | เอกสารชัดเจนว่าเป็น deterrent ไม่ใช่ guarantee; server time + idempotency คือหลัก |
| AI grade latency ช้า | กลาง | UX แสดง "⏳ กำลังตรวจ" + ครู grade manual ได้ |
| Realtime leak ของ exam_answers | สูง | Drop จาก publication + RLS host-only + ใช้ polling ไม่ใช้ realtime |
| Edge function timeout | กลาง | best-effort; ครู grade manual fallback |
| Conflict กับ commit ใหม่ของ Lovable | ต่ำ | Pull ก่อน push; sync workflow |

---

## 12. เกณฑ์ความสำเร็จ (Success Criteria)

- [ ] ครูสร้างข้อสอบ (ปรนัย + เติมคำสั้น) ล่วงหน้าได้
- [ ] ครู publish + open สอบ นักเรียนเข้าด้วยรหัส 6 หลัก
- [ ] นักเรียนเข้าสอบ → fullscreen อัตโนมัติ + แสดง countdown
- [ ] นักเรียนออกจากหน้า → counter ขึ้น + toast warning + RPC บันทึก
- [ ] ครบ violation_threshold → auto-submit + flag 'auto_submitted'
- [ ] หมดเวลา → auto-submit
- [ ] ปรนัย auto-grade ทันที; เติมคำรอ AI / ครู
- [ ] ครูเห็นรายงานคะแนน + violation count + export CSV
- [ ] XP เข้า ledger + แสดงใน /activity timeline
- [ ] RLS กันอ่านคำตอบเพื่อน / คำตอบถูกก่อน closed
- [ ] typecheck + build + smoke test ผ่าน

---

*Spec นี้ได้รับการอนุมัติ design ใน brainstorming (ส่วน 1-3) — รอ user review ครั้งสุดท้ายก่อนส่งต่อไป writing-plans skill*
