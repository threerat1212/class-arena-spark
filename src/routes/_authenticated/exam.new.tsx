import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import { rpcCreateExam, rpcUpdateExamQuestions } from "@/lib/exam.functions";
import { AiQuestionGenerator, type GeneratedQuestion } from "@/components/exam/ai-question-generator";

export const Route = createFileRoute("/_authenticated/exam/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    classroom: (s.classroom as string) ?? "",
  }),
  component: NewExamPage,
});

type DraftQuestion = {
  idx: number;
  question_type: "multiple_choice" | "short_answer" | "essay";
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
  function applyAi(generated: GeneratedQuestion[], mode: "replace" | "append") {
    setQuestions((qs) => {
      const base = mode === "replace" ? [] : qs.filter((q) => q.question.trim());
      const merged = [...base, ...generated.map((g) => ({ ...g, idx: 0 }))];
      return merged.map((q, idx) => ({ ...q, idx }));
    });
  }

  async function save() {
    if (!classroomId) {
      toast.error(tr("เลือกห้องเรียนก่อน"));
      return;
    }
    if (!title.trim()) {
      toast.error(tr("กรอกชื่อข้อสอบ"));
      return;
    }
    if (questions.some((q) => !q.question.trim())) {
      toast.error(tr("กรอกคำถามให้ครบ"));
      return;
    }
    setSaving(true);
    try {
      const examId = await rpcCreateExam({
        classroom_id: classroomId,
        title: title.trim(),
        duration_minutes: duration,
        violation_threshold: threshold,
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

  const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-6 lg:py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          {tr("📝 สร้างข้อสอบใหม่")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {tr("กรอกรายละเอียด แล้วเพิ่มคำถามเอง หรือให้ AI ช่วยออกจากบทเรียนในคลาส")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("รายละเอียดสอบ")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{tr("ชื่อข้อสอบ")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tr("เช่น สอบกลางภาค ม.4/1")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("ห้องเรียน")}</Label>
            <Select value={classroomId} onValueChange={setClassroomId}>
              <SelectTrigger>
                <SelectValue placeholder={tr("เลือกห้อง")} />
              </SelectTrigger>
              <SelectContent>
                {(myClassrooms ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{tr("ระยะเวลา (นาที)")}</Label>
              <Input
                type="number"
                min={5}
                max={300}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("โกงสูงสุด (ครั้ง)")}</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{tr("ให้ AI ช่วยออกข้อสอบ")}</p>
            <p className="text-xs text-muted-foreground">
              {tr("เลือกบทเรียนจากคลาส หรือวางเนื้อหา แล้วกำหนดจำนวนข้อ/ความยากได้เอง")}
            </p>
          </div>
          <AiQuestionGenerator
            onGenerated={applyAi}
            hasExisting={questions.some((q) => q.question.trim().length > 0)}
            classroomId={classroomId || undefined}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          {tr("คำถาม")} <span className="text-muted-foreground">({questions.length})</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {tr("รวมคะแนน")}: <b className="text-foreground">{totalPoints}</b>
        </p>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <CardTitle className="text-base truncate">
                  {tr("ข้อ")} {i + 1}
                </CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <Select
                    value={q.question_type}
                    onValueChange={(v) =>
                      updateQ(i, { question_type: v as DraftQuestion["question_type"] })
                    }
                  >
                    <SelectTrigger className="w-36 sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiple_choice">{tr("ปรนัย (ก/ข/ค/ง)")}</SelectItem>
                      <SelectItem value="short_answer">{tr("เติมคำสั้น")}</SelectItem>
                      <SelectItem value="essay">{tr("ข้อเขียน (ยาว)")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {questions.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => removeQ(i)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={q.question}
                onChange={(e) => updateQ(i, { question: e.target.value })}
                placeholder={tr("พิมพ์คำถาม...")}
                rows={2}
              />
              {q.question_type === "multiple_choice" ? (
                <div className="space-y-2">
                  <Label className="text-xs">{tr("ตัวเลือก (เลือกคำตอบที่ถูก)")}</Label>
                  {q.options.map((opt, oi) => (
                    <label
                      key={oi}
                      className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                        q.correct_idx === oi
                          ? "border-primary bg-primary/10"
                          : "border-input hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`correct-${i}`}
                        checked={q.correct_idx === oi}
                        onChange={() => updateQ(i, { correct_idx: oi })}
                      />
                      <span className="text-xs font-medium text-muted-foreground w-5 shrink-0">
                        {["ก", "ข", "ค", "ง", "จ"][oi]}
                      </span>
                      <Input
                        value={opt}
                        onChange={(e) => updateOption(i, oi, e.target.value)}
                        placeholder={tr(`ตัวเลือก ${oi + 1}`)}
                        className="flex-1 border-0 shadow-none focus-visible:ring-0 p-0 h-7 bg-transparent"
                      />
                    </label>
                  ))}
                </div>
              ) : q.question_type === "short_answer" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("คำตอบที่ถูก (หรือคำสำคัญ)")}</Label>
                  <Input
                    value={q.expected_answer}
                    onChange={(e) => updateQ(i, { expected_answer: e.target.value })}
                    placeholder={tr("เช่น photosynthesis หรือ การสังเคราะห์แสง")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr("AI จะใช้คำนี้เป็นเกณฑ์ตรวจคำตอบนักเรียน")}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {tr("นักเรียนจะพิมพ์คำตอบยาว ครูตรวจให้คะแนนเองหลังสอบเสร็จ")}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Label className="text-xs">{tr("คะแนน")}:</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={q.points}
                  onChange={(e) => updateQ(i, { points: Number(e.target.value) })}
                  className="w-20"
                />
              </div>
            </CardContent>
          </Card>
        ))}
        <Button variant="outline" onClick={addQ} className="w-full">
          <Plus className="size-4 mr-1" /> {tr("เพิ่มข้อ")}
        </Button>
      </div>

      <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-lg border bg-background/80 backdrop-blur p-3 shadow-sm">
        <Button variant="ghost" onClick={() => nav({ to: "/exam" })}>
          {tr("ยกเลิก")}
        </Button>
        <Button onClick={save} disabled={saving} size="lg">
          {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
          {tr("บันทึกเป็น draft")}
        </Button>
      </div>
    </div>
  );
}

// helper hook (could be in exam.functions.ts — keep inline for brevity)
function useMyClassrooms(userId?: string) {
  return useQuery({
    queryKey: ["my-classrooms-owner", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classrooms")
        .select("id, name")
        .eq("owner_id", userId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
  });
}
