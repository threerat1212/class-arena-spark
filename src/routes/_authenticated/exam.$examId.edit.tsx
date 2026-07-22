import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Plus, Trash2, Loader2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { tr } from "@/i18n";
import {
  fetchExamRaw,
  fetchExamQuestionsRaw,
  rpcUpdateExamQuestions,
} from "@/lib/exam.functions";
import { AiQuestionGenerator, type GeneratedQuestion } from "@/components/exam/ai-question-generator";

export const Route = createFileRoute("/_authenticated/exam/$examId/edit")({
  component: EditExamPage,
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

function EditExamPage() {
  const { examId } = Route.useParams();
  const nav = useNavigate();

  const { data: exam, isLoading: examLoading, error: examError } = useQuery({
    queryKey: ["exam", examId],
    queryFn: () => fetchExamRaw(examId),
  });
  const { data: rawQuestions, isLoading: qLoading, error: questionsError } = useQuery({
    queryKey: ["exam-questions-raw", examId],
    queryFn: () => fetchExamQuestionsRaw(examId),
  });

  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(60);
  const [threshold, setThreshold] = useState(5);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (exam && rawQuestions && !hydrated) {
      setTitle(exam.title);
      setDuration(exam.duration_minutes);
      setThreshold(exam.violation_threshold);
      setQuestions(
        rawQuestions.length > 0
          ? rawQuestions.map((q, i) => {
              const opts = Array.isArray(q.options)
                ? (q.options as unknown[]).map((o) => String(o))
                : ["", "", "", ""];
              while (opts.length < 4) opts.push("");
              return {
                idx: i,
                question_type: q.question_type,
                question: q.question,
                options: opts,
                correct_idx: q.correct_idx ?? 0,
                expected_answer: q.expected_answer ?? "",
                points: q.points ?? 1,
              };
            })
          : [emptyQ(0)],
      );
      setHydrated(true);
    }
  }, [exam, rawQuestions, hydrated]);

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
    if (!title.trim()) {
      toast.error(tr("กรอกชื่อข้อสอบ"));
      return;
    }
    if (questions.length === 0 || questions.some((q) => !q.question.trim())) {
      toast.error(tr("กรอกคำถามให้ครบ"));
      return;
    }
    setSaving(true);
    try {
      const { error: updErr } = await supabase
        .from("exam_sessions")
        .update({
          title: title.trim(),
          duration_minutes: duration,
          violation_threshold: threshold,
        })
        .eq("id", examId);
      if (updErr) throw updErr;

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
      toast.success(tr("บันทึกการแก้ไขแล้ว"));
      nav({ to: "/exam/$examId", params: { examId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("บันทึกไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  }

  if (examLoading || qLoading) {
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (examError || questionsError) {
    const message = examError instanceof Error
      ? examError.message
      : questionsError instanceof Error
        ? questionsError.message
        : tr("โหลดข้อสอบไม่สำเร็จ");

    return (
      <div className="container max-w-2xl py-6 space-y-3 text-center">
        <p className="text-muted-foreground">{message}</p>
        <Button asChild variant="outline">
          <Link to="/exam/$examId" params={{ examId }}>
            <ArrowLeft className="size-4 mr-1" />
            {tr("กลับ")}
          </Link>
        </Button>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="container max-w-2xl py-6 space-y-3 text-center">
        <p className="text-muted-foreground">{tr("ไม่พบข้อสอบ")}</p>
        <Button asChild variant="outline">
          <Link to="/exam/">
            <ArrowLeft className="size-4 mr-1" />
            {tr("กลับ")}
          </Link>
        </Button>
      </div>
    );
  }

  if (exam.status === "active") {
    return (
      <div className="container max-w-2xl py-6 space-y-3 text-center">
        <p className="text-muted-foreground">
          {tr("ไม่สามารถแก้ไขระหว่างสอบกำลังดำเนินการได้")}
        </p>
        <Button asChild variant="outline">
          <Link to="/exam/$examId" params={{ examId }}>
            <ArrowLeft className="size-4 mr-1" />
            {tr("กลับ")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-accent/20 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-background/80 backdrop-blur px-2.5 py-0.5 text-xs font-medium border">
                {tr("โหมดแก้ไข")}
              </span>
              <span className="text-xs text-muted-foreground">
                {exam.status === "draft" ? tr("ฉบับร่าง") : exam.status === "scheduled" ? tr("ตั้งเวลาไว้") : tr("ปิดแล้ว")}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold font-display">
              ✏️ {tr("แก้ไขข้อสอบ")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tr("ปรับรายละเอียด คำถาม และตัวเลือก แล้วบันทึกเพื่ออัปเดตข้อสอบ")}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/exam/$examId" params={{ examId }}>
              <ArrowLeft className="size-4 mr-1" />
              {tr("กลับ")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Exam details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tr("รายละเอียดสอบ")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{tr("ชื่อข้อสอบ")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* Questions header + AI */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold font-display">
            {tr("คำถาม")}{" "}
            <span className="text-sm text-muted-foreground font-normal">
              ({questions.length} {tr("ข้อ")})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {tr("รวมคะแนน")}: {questions.reduce((s, q) => s + (q.points || 0), 0)}
          </p>
        </div>
        <AiQuestionGenerator
          onGenerated={applyAi}
          hasExisting={questions.some((q) => q.question.trim().length > 0)}
          classroomId={exam.classroom_id}
        />
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <Card key={i} className="overflow-hidden">
            <CardHeader className="pb-3 bg-muted/30 border-b">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center size-7 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                    {i + 1}
                  </span>
                  <CardTitle className="text-base">
                    {tr("ข้อ")} {i + 1}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={q.question_type}
                    onValueChange={(v) =>
                      updateQ(i, { question_type: v as DraftQuestion["question_type"] })
                    }
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiple_choice">{tr("ปรนัย (ก/ข/ค/ง)")}</SelectItem>
                      <SelectItem value="short_answer">{tr("เติมคำสั้น")}</SelectItem>
                      <SelectItem value="essay">{tr("ข้อเขียน (ยาว)")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {questions.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeQ(i)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("คำถาม")}</Label>
                <Textarea
                  value={q.question}
                  onChange={(e) => updateQ(i, { question: e.target.value })}
                  placeholder={tr("พิมพ์คำถาม...")}
                  rows={2}
                />
              </div>
              {q.question_type === "multiple_choice" ? (
                <div className="space-y-2">
                  <Label className="text-xs">{tr("ตัวเลือก (เลือกคำตอบที่ถูก)")}</Label>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => {
                      const isCorrect = q.correct_idx === oi;
                      return (
                        <label
                          key={oi}
                          className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${
                            isCorrect
                              ? "border-primary/60 bg-primary/5"
                              : "border-border hover:bg-muted/40"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`correct-${i}`}
                            checked={isCorrect}
                            onChange={() => updateQ(i, { correct_idx: oi })}
                            className="accent-primary"
                          />
                          <span
                            className={`inline-flex items-center justify-center size-6 rounded-full text-xs font-semibold ${
                              isCorrect
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {["ก", "ข", "ค", "ง", "จ"][oi]}
                          </span>
                          <Input
                            value={opt}
                            onChange={(e) => updateOption(i, oi, e.target.value)}
                            placeholder={tr(`ตัวเลือก ${oi + 1}`)}
                            className="flex-1 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : q.question_type === "short_answer" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("คำตอบที่ถูก (หรือคำสำคัญ)")}</Label>
                  <Input
                    value={q.expected_answer}
                    onChange={(e) => updateQ(i, { expected_answer: e.target.value })}
                  />
                </div>
              ) : (
                <div className="rounded-lg bg-muted/40 border border-dashed p-3">
                  <p className="text-xs text-muted-foreground">
                    {tr("นักเรียนจะพิมพ์คำตอบยาว ครูตรวจให้คะแนนเองหลังสอบเสร็จ")}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Label className="text-xs">{tr("คะแนน")}:</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={q.points}
                  onChange={(e) => updateQ(i, { points: Number(e.target.value) })}
                  className="w-24"
                />
              </div>
            </CardContent>
          </Card>
        ))}
        <Button variant="outline" onClick={addQ} className="w-full border-dashed">
          <Plus className="size-4 mr-1" /> {tr("เพิ่มข้อ")}
        </Button>
      </div>

      {/* Sticky footer actions */}
      <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 bg-gradient-to-t from-background via-background to-background/80 backdrop-blur border-t">
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => nav({ to: "/exam/$examId", params: { examId } })}
          >
            {tr("ยกเลิก")}
          </Button>
          <Button onClick={save} disabled={saving} size="lg">
            {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
            {tr("บันทึกการแก้ไข")}
          </Button>
        </div>
      </div>
    </div>
  );
}
