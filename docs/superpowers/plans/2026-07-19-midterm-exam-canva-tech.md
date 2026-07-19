# ข้อสอบกลางภาค (Canva ม.3 + เทคโนโลยี ม.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เตรียมระบบสอบในเว็บให้พร้อมสำหรับข้อสอบกลางภาค ม.3 (Canva) และ ม.4 (เทคโนโลยี) — เพิ่ม UI ครูตรวจข้อเขียน + ขยาย Textarea + สร้างข้อสอบจริงทั้งสอบวิชา

**Architecture:**
1. UI ใหม่ "ตรวจข้อเขียนด้วยมือ" ในหน้า report (`exam.$examId.report.tsx`) — ครูคลิกคำตอบเด็ก เห็นข้อความ + ปรับคะแนน + save ผ่าน RPC `grade_short_answer` ที่มีอยู่แล้ว
2. Textarea ในหน้า exam ขยายจาก `rows={3}` → `rows={8}` (1 บรรทัด)
3. สร้างข้อสอบจริงผ่าน UI สร้างข้อสอบ (manual data entry โดยครู — ไม่ใช่ code)

**Tech Stack:** React + TanStack Router/Query, Supabase RPC, shadcn/ui, Tailwind

**Spec:** `docs/superpowers/specs/2026-07-19-midterm-exam-canva-tech-design.md`

---

## File Structure

| ไฟล์ | การเปลี่ยนแปลง | หน้าที่ |
|---|---|---|
| `src/routes/_authenticated/exam.$examId.report.tsx` | **แก้** | เพิ่ม section "ตรวจข้อเขียนด้วยมือ" |
| `src/lib/exam.functions.ts` | **แก้** | เพิ่ม `fetchShortAnswersForGrading()` + `rpcGradeShortAnswer()` wrapper |
| `src/routes/_authenticated/exam.$examId.tsx:518` | **แก้** | `rows={3}` → `rows={8}` |

ไม่มีไฟล์ใหม่นอกจาก migration (ถ้าจำเป็น) — ทุกอย่างใช้ schema/UI ที่มีอยู่

---

## Task 1: เพิ่ม RPC wrapper + query helper สำหรับครูตรวจ essay

**Files:**
- Modify: `src/lib/exam.functions.ts` (ต่อท้ายไฟล์)

- [ ] **Step 1: เพิ่ม `fetchShortAnswersForGrading` function**

เพิ่มท้ายไฟล์ `src/lib/exam.functions.ts`:

```ts
// ===== Teacher grading helpers =====

/**
 * ดึงคำตอบ short_answer ทั้งหมดของข้อสอบ พร้อม question/profile
 * สำหรับ UI ครูตรวจข้อเขียนด้วยมือ
 */
export async function fetchShortAnswersForGrading(examId: string): Promise<
  Array<{
    answer: ExamAnswerRow;
    question: ExamQuestionRow;
    user_display_name: string | null;
  }>
> {
  const { data, error } = await supabase
    .from("exam_answers")
    .select(
      `*, question:exam_questions!inner(*), user:profiles!inner(display_name)`,
    )
    .eq("session_id", examId)
    .not("answer_text", "is", null)
    .order("graded_at", { ascending: false, nullsFirst: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    answer: row as ExamAnswerRow,
    question: row.question as ExamQuestionRow,
    user_display_name: (row.user as { display_name: string | null }).display_name,
  }));
}

/**
 * ครูให้คะแนน short_answer ด้วยมือ (graded_by='teacher')
 * เขียนทับคะแนน AI ได้
 */
export async function rpcGradeShortAnswer(args: {
  question_id: string;
  user_id: string;
  is_correct: boolean;
  score: number;
}): Promise<void> {
  const { error } = await supabase.rpc("grade_short_answer", {
    _question_id: args.question_id,
    _user_id: args.user_id,
    _is_correct: args.is_correct,
    _score: args.score,
    _graded_by: "teacher",
  });
  if (error) throw error;
}
```

- [ ] **Step 2: ตรวจ TypeScript compile**

Run: `npm run typecheck` (หรือ `npx tsc --noEmit`)
Expected: ไม่มี error

- [ ] **Step 3: Commit**

```bash
git add src/lib/exam.functions.ts
git commit -m "feat(exam): เพิ่ม helper สำหรับครูตรวจ short_answer ด้วยมือ"
```

---

## Task 2: ขยาย Textarea สำหรับ essay

**Files:**
- Modify: `src/routes/_authenticated/exam.$examId.tsx:518`

- [ ] **Step 1: เปลี่ยน `rows={3}` → `rows={8}`**

ใน `src/routes/_authenticated/exam.$examId.tsx` บรรทัด 518:

```diff
-                rows={3}
+                rows={8}
```

- [ ] **Step 2: ตรวจ build ไม่พัง**

Run: `npm run typecheck`
Expected: ไม่มี error

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/exam.\$examId.tsx
git commit -m "feat(exam): ขยาย Textarea เป็น rows=8 สำหรับ essay"
```

---

## Task 3: เพิ่ม UI "ตรวจข้อเขียนด้วยมือ" ในหน้า report

**Files:**
- Modify: `src/routes/_authenticated/exam.$examId.report.tsx`

UI จะแสดงใต้ตารางผลรวม: รายการคำตอบ short_answer ทั้งหมด ครูเห็นข้อความเต็ม + คำถาม + expected_answer (rubric) + คะแนนที่ AI ให้ + input ปรับคะแนนใหม่

- [ ] **Step 1: เพิ่ม import ที่จำเป็น**

ใน `src/routes/_authenticated/exam.$examId.report.tsx` แก้บรรทัด import:

```diff
 import { Loader2, Download, ArrowLeft } from "lucide-react";
+import { useState } from "react";
+import { Textarea } from "@/components/ui/textarea";
+import { Input } from "@/components/ui/input";
+import { useMutation, useQueryClient } from "@tanstack/react-query";
+import { toast } from "sonner";
+import {
+  fetchShortAnswersForGrading,
+  rpcGradeShortAnswer,
+} from "@/lib/exam.functions";
```

- [ ] **Step 2: เพิ่ม query ดึง short_answer answers ทั้งหมด**

ใน `ExamReportPage()` เพิ่มหลัง query `questions`:

```ts
  const { data: shortAnswers, refetch: refetchShortAnswers } = useQuery({
    queryKey: ["exam-short-answers", examId],
    queryFn: () => fetchShortAnswersForGrading(examId),
    enabled: !!examId,
  });
```

- [ ] **Step 3: เพิ่ม mutation บันทึกคะแนน**

ต่อจาก query ข้างบน:

```ts
  const queryClient = useQueryClient();
  const gradeMutation = useMutation({
    mutationFn: rpcGradeShortAnswer,
    onSuccess: () => {
      toast.success(tr("บันทึกคะแนนเรียบร้อย"));
      queryClient.invalidateQueries({ queryKey: ["exam-participants", examId] });
      queryClient.invalidateQueries({ queryKey: ["exam-short-answers", examId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : tr("บันทึกไม่สำเร็จ"));
    },
  });
```

- [ ] **Step 4: เพิ่ม section UI "ตรวจข้อเขียนด้วยมือ"**

วาง **หลัง Card ตารางผลรวม** (ก่อน `</div>` ปิด container บรรทัด ~163):

```tsx
      {shortAnswers && shortAnswers.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr("ตรวจข้อเขียนด้วยมือ")}</h2>
              <Badge variant="outline">
                {shortAnswers.filter((s) => s.answer.graded_by !== "teacher").length}{" "}
                {tr("รอตรวจ")}
              </Badge>
            </div>
            <div className="space-y-3">
              {shortAnswers.map((item) => (
                <ManualGradeRow
                  key={`${item.answer.question_id}-${item.answer.user_id}`}
                  item={item}
                  isGrading={gradeMutation.isPending}
                  onGrade={(score, isCorrect) =>
                    gradeMutation.mutate({
                      question_id: item.answer.question_id,
                      user_id: item.answer.user_id,
                      score,
                      is_correct: isCorrect,
                    })
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 5: เพิ่ม component `ManualGradeRow`**

วางนอก `ExamReportPage` (ก่อน `export const Route`):

```tsx
function ManualGradeRow({
  item,
  isGrading,
  onGrade,
}: {
  item: {
    answer: ExamAnswerRow;
    question: ExamQuestionRow;
    user_display_name: string | null;
  };
  isGrading: boolean;
  onGrade: (score: number, isCorrect: boolean) => void;
}) {
  const maxPoints = item.question.points;
  const [scoreInput, setScoreInput] = useState(
    String(item.answer.score_awarded ?? 0),
  );
  const needsGrading = item.answer.graded_by !== "teacher";

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 text-sm">
        <div className="font-medium">
          {item.user_display_name ?? item.answer.user_id.slice(0, 8)}
          <span className="text-muted-foreground ml-2">
            — ข้อ {item.question.idx + 1} ({maxPoints} {tr("คะแนน")})
          </span>
        </div>
        {item.answer.graded_by === "ai" && (
          <Badge variant="secondary">AI: {item.answer.score_awarded}</Badge>
        )}
        {item.answer.graded_by === "teacher" && (
          <Badge variant="default">{tr("ตรวจแล้ว")}</Badge>
        )}
        {item.answer.graded_by === null && (
          <Badge variant="outline">{tr("รอตรวจ")}</Badge>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <strong>{tr("โจทย์")}:</strong> {item.question.question}
      </div>
      {item.question.expected_answer && (
        <div className="text-xs text-muted-foreground">
          <strong>{tr("เกณฑ์")}:</strong> {item.question.expected_answer}
        </div>
      )}
      <div className="bg-muted/50 rounded p-2 text-sm whitespace-pre-wrap">
        {item.answer.answer_text || <em className="text-muted-foreground">—</em>}
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={maxPoints}
          value={scoreInput}
          onChange={(e) => setScoreInput(e.target.value)}
          className="w-24"
          disabled={isGrading}
        />
        <span className="text-sm text-muted-foreground">/ {maxPoints}</span>
        <Button
          size="sm"
          disabled={isGrading || !needsGrading}
          onClick={() => {
            const score = Math.max(0, Math.min(maxPoints, Number(scoreInput) || 0));
            onGrade(score, score >= maxPoints * 0.5);
          }}
        >
          {tr("บันทึก")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: เพิ่ม import types**

ในบรรทัด import จาก `@/lib/exam.functions`:

```diff
-import { fetchExamRaw, fetchParticipants, fetchExamQuestionsRaw } from "@/lib/exam.functions";
+import {
+  fetchExamRaw,
+  fetchParticipants,
+  fetchExamQuestionsRaw,
+  type ExamAnswerRow,
+  type ExamQuestionRow,
+} from "@/lib/exam.functions";
```

- [ ] **Step 7: ตรวจ TypeScript compile**

Run: `npm run typecheck`
Expected: ไม่มี error

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/exam.\$examId.report.tsx
git commit -m "feat(exam): เพิ่ม UI ครูตรวจข้อเขียนด้วยมือในหน้า report"
```

---

## Task 4: เตรียมข้อมูลข้อสอบ ม.3 — Canva (14 ข้อ)

**Files:**
- ไม่แก้ code — เป็นข้อมูลที่ครูกรอกผ่าน UI `/exam/new`

หมายเหตุ: Task นี้ครูใช้กรอกใน UI สร้างข้อสอบ ข้อมูลด้านล่างคือ "เนื้อหาตัวอย่าง" ที่ครูสามารถ copy/paste ลง UI ได้ ปรับตามใจ

- [ ] **Step 1: สร้าง exam session ม.3 ผ่าน UI**

เข้า `/exam/new` → กรอก:
- **ชื่อข้อสอบ:** `ม.3 กลางภาค — Canva`
- **ความยาว:** 60 นาที
- **violation threshold:** 5

- [ ] **Step 2: กรอกคำถาม 14 ข้อ**

**บทที่ 1 — รู้จัก Canva (5 ข้อ, ข้อละ 1 คะแนน)**

ข้อ 1 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "Canva คือแพลตฟอร์มประเภทใด"
> ตัวเลือก: ก. เครื่องมือออกแบบกราฟิกออนไลน์ / ข. โปรแกรมตัดต่อวิดีโอ / ค. แอปพลิเคชันเล่นเกม / ง. ระบบปฏิบัติการ

ข้อ 2 — `multiple_choice` (points: 1, correct_idx: 2)
> คำถาม: "เริ่มต้นสร้างงานใหม่ใน Canva เราควรคลิกที่ปุ่มใด"
> ตัวเลือก: ก. Share / ข. Download / ค. Create a design / ง. Settings

ข้อ 3 — `multiple_choice` (points: 1, correct_idx: 1)
> คำถาม: "'Template' ใน Canva คืออะไร"
> ตัวเลือก: ก. รูปภาพที่ถูกอัปโหลด / ข. แม่แบบงานออกแบบสำเร็จรูป / ค. ประเภทไฟล์ / ง. เครื่องมือวาดเส้น

ข้อ 4 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "ด้านซ้ายของหน้าต่าง Canva คือส่วนใด"
> ตัวเลือก: ก. แผงเครื่องมือ (sidebar) / ข. พื้นที่ทำงาน (canvas) / ค. แถบเมนูบน / ง. ปุ่มดาวน์โหลด

ข้อ 5 — `multiple_choice` (points: 1, correct_idx: 3)
> คำถาม: "Canva สามารถดาวน์โหลดงานเป็นนามสกุลใดได้บ้าง (รวม)"
> ตัวเลือก: ก. เฉพาะ .png / ข. เฉพาะ .pdf / ค. เฉพาะ .jpg / ง. ได้ทั้ง .png .jpg .pdf และอื่น ๆ

**บทที่ 2 — เครื่องมือพื้นฐาน (5 ข้อ, ข้อละ 1 คะแนน)**

ข้อ 6 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "เครื่องมือใดใช้เพิ่มตัวอักษรลงในงาน"
> ตัวเลือก: ก. Text / ข. Elements / ค. Uploads / ง. Background

ข้อ 7 — `multiple_choice` (points: 1, correct_idx: 1)
> คำถาม: "เครื่องมือ 'Elements' ใช้ทำอะไร"
> ตัวเลือก: ก. เปลี่ยนสีพื้นหลัง / ข. เพิ่มรูปทรง ไอคอน สติกเกอร์ / ค. ใส่ตัวอักษร / ง. อัปโหลดรูป

ข้อ 8 — `multiple_choice` (points: 1, correct_idx: 2)
> คำถาม: "ต้องการเพิ่มรูปภาพจากเครื่องของเราเอง ควรใช้เครื่องมือใด"
> ตัวเลือก: ก. Text / ข. Elements / ค. Uploads / ง. Photos

ข้อ 9 — `multiple_choice` (points: 1, correct_idx: 2)
> คำถาม: "เครื่องมือ 'Background' ใช้สำหรับ"
> ตัวเลือก: ก. ใส่ตัวอักษร / ข. เพิ่มไอคอน / ค. เปลี่ยนสี/ภาพพื้นหลัง / ง. ตัดต่อวิดีโอ

ข้อ 10 — `multiple_choice` (points: 1, correct_idx: 3)
> คำถาม: "ถ้าต้องการย้ายวัตถุหลาย ๆ อย่างพร้อมกัน ควรทำอย่างไร"
> ตัวเลือก: ก. ลบทิ้งทั้งหมด / ข. สุ่มคลิกทีละอัน / ค. ปิดหน้าต่าง / ง. กดคลุมดำ (drag select) หรือ Shift+Click เพื่อจับกลุ่ม

**บทที่ 3 — หลักการออกแบบ (3 ข้อ, ข้อละ 1 คะแนน)**

ข้อ 11 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "'Contrast' (ความต่าง) ในการออกแบบ คืออะไร"
> ตัวเลือก: ก. การทำให้สองสิ่งมีความแตกต่างชัดเจน (เช่น สีดำ-ขาว) / ข. การจัดวัตถุให้เท่ากัน / ค. การใช้สีเดียว / ง. การลดขนาดตัวอักษร

ข้อ 12 — `multiple_choice` (points: 1, correct_idx: 1)
> คำถาม: "'Alignment' (การจัดวาง) ช่วยให้งานออกแบบ"
> ตัวเลือก: ก. ดูสับสน / ข. เป็นระเบียบ อ่านง่าย / ค. มีสีสันมากขึ้น / ง. ใหญ่ขึ้น

ข้อ 13 — `multiple_choice` (points: 1, correct_idx: 2)
> คำถาม: "'Hierarchy' (ลำดับความสำคัญ) คือการ"
> ตัวเลือก: ก. ใช้สีเดียวทุกอย่าง / ข. จัดทุกข้อความให้เท่ากัน / ค. จัดลำดับความสำคัญ เช่น หัวข้อใหญ่ รายละเอียดเล็ก / ง. ลบข้อความออก

**ข้อเขียน — ส่ง link Canva (1 ข้อ, 2 คะแนน)**

ข้อ 14 — `short_answer` (points: 2, expected_answer: rubric สำหรับครู)
> คำถาม: "วาง LINK Canva ของคุณในบรรทัดแรก จากนั้นอธิบายสั้น ๆ (3-5 บรรทัด) ว่าคุณใช้เครื่องมือ Canva อะไรบ้าง และใช้หลักการออกแบบ (Contrast / Alignment / Hierarchy) ข้อใดบ้าง"
> expected_answer (rubric): "ครูตรวจ: มี link ที่เปิดได้ (1) + ระบุเครื่องมือที่ใช้ถูกต้อง (0.5) + ระบุหลักการออกแบบที่ใช้ (0.5) = 2 คะแนน"

- [ ] **Step 3: บันทึกและ publish**

กด "บันทึก" → ไปหน้า exam → ตั้งเวลาสอบ → Publish

- [ ] **Step 4: Commit ไม่จำเป็น** (ข้อมูลอยู่ใน Supabase ไม่ใช่ไฟล์)

---

## Task 5: เตรียมข้อมูลข้อสอบ ม.4 — เทคโนโลยี (11 ข้อ)

**Files:**
- ไม่แก้ code — ข้อมูลครูกรอกผ่าน UI

- [ ] **Step 1: สร้าง exam session ม.4**

เข้า `/exam/new` → กรอก:
- **ชื่อข้อสอบ:** `ม.4 กลางภาค — เทคโนโลยี`
- **ความยาว:** 60 นาที
- **violation threshold:** 5

- [ ] **Step 2: กรอกคำถาม 11 ข้อ**

**หัวข้อ 1 — ความหมายของเทคโนโลยี (3 ข้อ, ข้อละ 1)**

ข้อ 1 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "'เทคโนโลยี' หมายถึงอะไร"
> ตัวเลือก: ก. การประยุกต์ใช้ความรู้วิทยาศาสตร์เพื่อสร้างสิ่งที่อำนวยความสะดวก / ข. การศึกษาธรรมชาติของสสาร / ค. ภาษาที่ใช้สื่อสาร / ง. ศิลปะการแสดง

ข้อ 2 — `multiple_choice` (points: 1, correct_idx: 1)
> คำถาม: "เทคโนโลยีเกิดจากแรงผลักดันหลักใด"
> ตัวเลือก: ก. ความบังเอิญ / ข. ความต้องการของมนุษย์ + ความรู้วิทยาศาสตร์ / ค. การสั่งสอนทางศาสนา / ง. ความฝัน

ข้อ 3 — `multiple_choice` (points: 1, correct_idx: 2)
> คำถาม: "ข้อใดเป็นตัวอย่างของเทคโนโลยี"
> ตัวเลือก: ก. ลมหายใจ / ข. ฝนตก / ค. สมาร์ตโฟน / ง. ดวงอาทิตย์

**หัวข้อ 2 — ศาสตร์ × วิเคราะห์เทคโนโลยี (2 ข้อ)**

ข้อ 4 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "ความสัมพันธ์ระหว่าง 'ศาสตร์' และ 'เทคโนโลยี' คือ"
> ตัวเลือก: ก. ศาสตร์สร้างความรู้ → เทคโนโลยีนำความรู้ไปใช้ / ข. ไม่เกี่ยวข้องกัน / ค. เทคโนโลยีก่อนศาสตร์ / ง. ศาสตร์ทำลายเทคโนโลยี

ข้อ 5 — `multiple_choice` (points: 1, correct_idx: 1)
> คำถาม: "การ 'วิเคราะห์เทคโนโลยี' หมายถึง"
> ตัวเลือก: ก. ซื้อเทคโนโลยีใหม่ / ข. ศึกษาองค์ประกอบ กระบวนการ และผลกระทบของเทคโนโลยี / ค. ทำลายเทคโนโลยี / ง. เก็บเทคโนโลยีไว้ในพิพิธภัณฑ์

**หัวข้อ 3 — องค์ประกอบและระบบทางเทคโนโลยีที่ซับซ้อน (2 ข้อ)**

ข้อ 6 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "องค์ประกอบหลักของระบบเทคโนโลยี มีกี่ส่วน"
> ตัวเลือก: ก. 4 ส่วน (input, process, output, feedback) / ข. 1 ส่วน / ค. 10 ส่วน / ง. ไม่มีส่วนประกอบ

ข้อ 7 — `multiple_choice` (points: 1, correct_idx: 2)
> คำถาม: "ข้อใดเป็นตัวอย่างของ 'input' ในระบบเทคโนโลยี 'ไมโครเวฟ'"
> ตัวเลือก: ก. อาหารร้อน / ข. เสียงเตือน / ค. อาหารเย็นที่ใส่เข้าไป / ง. ไฟฟ้าที่เสีย

**หัวข้อ 4 — การเปลี่ยนแปลงและผลกระทบของเทคโนโลยี (2 ข้อ)**

ข้อ 8 — `multiple_choice` (points: 1, correct_idx: 1)
> คำถาม: "เทคโนโลยีทำให้สังคมเปลี่ยนแปลงอย่างไร"
> ตัวเลือก: ก. ไม่เปลี่ยนแปลง / ข. เปลี่ยนทั้งด้านดีและด้านลบ / ค. เปลี่ยนแต่ด้านดีอย่างเดียว / ง. เปลี่ยนเฉพาะคนรวย

ข้อ 9 — `multiple_choice` (points: 1, correct_idx: 0)
> คำถาม: "ตัวอย่างผลกระทบเชิงลบของเทคโนโลยี คือ"
> ตัวเลือก: ก. มลพิษทางอากาศจากโรงงาน / ข. การรักษาพยาบาลที่ดีขึ้น / ค. การสื่อสารสะดวกขึ้น / ง. การคมนาคมเร็วขึ้น

**ข้อเขียน (2 ข้อ, 6 คะแนน)**

ข้อ 10 — `short_answer` (points: 3, expected_answer: rubric)
> คำถาม: "smartphone (สมาร์ตโฟน) กับการแพทย์เกี่ยวข้องกันอย่างไร จงอธิบายพร้อมยกตัวอย่าง"
> expected_answer (rubric): "ครูตรวจ: ยกตัวอย่างการใช้งาน (เช่น แอปหาหมอ นัดคิว ดูผลตรวจ telemedicine สมาร์ตวอทช์วัดชีพจร) — ครบ 2-3 ตัวอย่าง = 3 คะแนน; 1 ตัวอย่าง = 2; ตอบกว้าง ๆ = 1"

ข้อ 11 — `short_answer` (points: 3, expected_answer: rubric)
> คำถาม: "เลือกเทคโนโลยี 1 อย่างที่คุณใช้ทุกวัน จงวิเคราะห์ตามองค์ประกอบระบบ (input, process, output, feedback) และบอกผลกระทบต่อสังคมหรือสิ่งแวดล้อม"
> expected_answer (rubric): "ครูตรวจ: ระบุเทคโนโลยี (0.5) + อธิบาย input/process/output/feedback ครบ (1.5) + ผลกระทบต่อสังคม/สิ่งแวดล้อม (1) = 3 คะแนน"

- [ ] **Step 3: บันทึกและ publish**

---

## Task 6: ทดสอบ end-to-end ก่อนวันสอบ

**Files:** ไม่แก้ code

- [ ] **Step 1: ทดสอบข้อสอบ ม.3**

1. เข้าสอบด้วย account นักเรียนทดสอบ → ตอบ 13 ข้อกา + วาง URL ในข้อ 14
2. ส่งข้อสอบ
3. เข้าหน้า report ของครู → ตรวจข้อ 14 → ปรับคะแนน → บันทึก
4. ✅ ตรวจสอบ: total_score อัปเดต + สถานะ "ตรวจแล้ว"

- [ ] **Step 2: ทดสอบข้อสอบ ม.4**

1. เข้าสอบ → ตอบ 9 ข้อกา + เขียนข้อ 10, 11
2. ส่งข้อสอบ
3. ครูตรวจข้อ 10, 11 → บันทึก
4. ✅ ตรวจสอบ: total_score อัปเดต

- [ ] **Step 3: ทดสอบ edge cases**

- ปิดแท็บกลางสอบ → เข้าใหม่ → คำตอบยังอยู่ (autosave)
- รอเวลาหมด → auto-submit
- นับ violation → ถึง threshold → auto-submit

- [ ] **Step 4: เตรียม Canva link รายคน (ครูทำเอง นอกระบบ)**

1. ครูสร้าง Canva design template 1 ชิ้น
2. Duplicate เป็น N ชิ้น (ตามจำนวนเด็ก ม.3)
3. แต่ละชิ้น → Share → "Anyone with link" → "Can edit" → copy link
4. บันทึก mapping: link → ชื่อเด็ก
5. แจก link ให้เด็กทางไลน์/กระดาษก่อนวันสอบ

---

## Self-Review (หลังเขียนเสร็จ)

**Spec coverage:**
- ✅ 4.1 UI ครูตรวจ essay → Task 1 + Task 3
- ✅ 4.2 Textarea ใหญ่ขึ้น → Task 2
- ✅ 4.3 ไม่เปลี่ยน DB → ใช้ RPC `grade_short_answer` ที่มีอยู่
- ✅ ข้อสอบ ม.3 → Task 4
- ✅ ข้อสอบ ม.4 → Task 5
- ✅ ครูตรวจ 3 ข้อ (ม.3 #14, ม.4 #10, #11) → UI ใน Task 3 รองรับ
- ✅ คะแนน ม.3 = 5+5+3+2 = 15 ✓
- ✅ คะแนน ม.4 = 3+2+2+2+3+3 = 15 ✓

**Placeholder scan:** ไม่มี TBD/TODO — ทุก step มี code หรือข้อมูลครบ

**Type consistency:**
- `fetchShortAnswersForGrading` (Task 1) → ใช้ใน Task 3 ✓
- `rpcGradeShortAnswer` (Task 1) → ใช้ใน Task 3 ✓
- `ExamAnswerRow`, `ExamQuestionRow` (import ใน Task 3) → export จาก `exam.functions.ts:8-5` ✓
