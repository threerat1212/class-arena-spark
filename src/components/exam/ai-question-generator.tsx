// AI-powered exam question generator dialog.
// Teacher/admin can:
//  - import lesson content directly from the classroom (lesson_contents)
//  - and/or paste raw content
//  - specify a difficulty distribution (easy / medium / hard counts) instead of only 1 difficulty
// AI returns draft questions; correct answer is filled by the teacher.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { tr } from "@/i18n";

export type GeneratedQuestion = {
  question_type: "multiple_choice" | "short_answer" | "essay";
  question: string;
  options: string[];
  correct_idx: number;
  expected_answer: string;
  points: number;
};

type LessonRow = { id: string; topic: string; content: string; lesson_date: string };

export function AiQuestionGenerator({
  onGenerated,
  hasExisting,
  classroomId,
}: {
  onGenerated: (questions: GeneratedQuestion[], mode: "replace" | "append") => void;
  hasExisting: boolean;
  classroomId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [optionsCount, setOptionsCount] = useState(4);
  const [qType, setQType] = useState<
    "multiple_choice" | "short_answer" | "essay" | "mixed"
  >("multiple_choice");
  // difficulty mode: single vs mix
  const [diffMode, setDiffMode] = useState<"single" | "mix">("single");
  const [difficulty, setDifficulty] = useState("ปานกลาง");
  const [easyCount, setEasyCount] = useState(2);
  const [mediumCount, setMediumCount] = useState(3);
  const [hardCount, setHardCount] = useState(1);
  const [singleCount, setSingleCount] = useState(5);
  const [loading, setLoading] = useState(false);

  // lesson picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedLessonIds, setSelectedLessonIds] = useState<Record<string, boolean>>({});

  const { data: lessons } = useQuery({
    queryKey: ["lesson-contents", classroomId],
    enabled: !!classroomId && open,
    queryFn: async (): Promise<LessonRow[]> => {
      const { data, error } = await supabase
        .from("lesson_contents")
        .select("id, topic, content, lesson_date")
        .eq("classroom_id", classroomId!)
        .order("lesson_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalCount = useMemo(
    () => (diffMode === "mix" ? easyCount + mediumCount + hardCount : singleCount),
    [diffMode, easyCount, mediumCount, hardCount, singleCount],
  );

  function insertSelectedLessons(mode: "append" | "replace") {
    const chosen = (lessons ?? []).filter((l) => selectedLessonIds[l.id]);
    if (chosen.length === 0) {
      toast.error(tr("เลือกบทเรียนก่อน"));
      return;
    }
    const block = chosen
      .map((l) => `# ${l.topic}\n${l.content}`)
      .join("\n\n---\n\n");
    setContent((prev) => (mode === "replace" || !prev.trim() ? block : `${prev}\n\n${block}`));
    if (!topic.trim() && chosen.length === 1) setTopic(chosen[0].topic);
    setPickerOpen(false);
    setSelectedLessonIds({});
    toast.success(tr("นำเข้าบทเรียนแล้ว") + ` (${chosen.length})`);
  }

  async function generate(mode: "replace" | "append") {
    if (!topic.trim() && !content.trim()) {
      toast.error(tr("กรอกหัวข้อหรือเนื้อหาก่อน"));
      return;
    }
    if (totalCount < 1) {
      toast.error(tr("จำนวนข้อต้องมากกว่า 0"));
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-exam-questions", {
        body: {
          topic: topic.trim(),
          content: content.trim(),
          count: totalCount,
          options_count: optionsCount,
          question_type: qType,
          difficulty,
          distribution:
            diffMode === "mix"
              ? { easy: easyCount, medium: mediumCount, hard: hardCount }
              : null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const questions = (data?.questions ?? []) as Array<{
        question_type?: string;
        question?: string;
        options?: unknown;
        points?: number;
      }>;
      if (questions.length === 0) {
        toast.error(tr("AI สร้างข้อสอบไม่ได้ ลองใหม่"));
        return;
      }
      const normalized: GeneratedQuestion[] = questions.map((q) => {
        const qt: "multiple_choice" | "short_answer" | "essay" =
          q.question_type === "short_answer"
            ? "short_answer"
            : q.question_type === "essay"
              ? "essay"
              : "multiple_choice";
        const isMC = qt === "multiple_choice";
        const opts = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "")) : [];
        const targetLen = isMC ? optionsCount : 4;
        while (opts.length < targetLen) opts.push("");
        return {
          question_type: qt,
          question: String(q.question ?? "").trim(),
          options: opts.slice(0, targetLen),
          correct_idx: 0,
          expected_answer: "",
          points: Math.max(1, Math.min(100, Number(q.points) || 1)),
        };
      });
      onGenerated(normalized, mode);
      toast.success(tr("AI สร้างให้แล้ว") + ` (${normalized.length} ${tr("ข้อ")})`);
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("rate_limit")) toast.error(tr("ใช้งาน AI บ่อยเกินไป รอสักครู่"));
      else if (msg.includes("credits")) toast.error(tr("เครดิต AI หมด"));
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" type="button">
          <Sparkles className="size-4 mr-1" />
          {tr("ให้ AI ช่วยออกข้อสอบ")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle className="text-xl">{tr("AI ออกแบบข้อสอบ")}</DialogTitle>
          <DialogDescription>
            {tr("เลือกบทเรียนในคลาส หรือวางเนื้อหาเอง แล้ว AI จะออกคำถาม+ตัวเลือกให้ (ครูเลือกเฉลยเอง)")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {classroomId && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{tr("เลือกจากบทเรียนในคลาส")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPickerOpen((v) => !v)}
                >
                  <BookOpen className="size-3.5 mr-1" />
                  {pickerOpen ? tr("ปิดรายการ") : tr("เลือกบทเรียน")}
                  {lessons ? ` (${lessons.length})` : ""}
                </Button>
              </div>
              {pickerOpen && (
                <div className="rounded-md border p-2 space-y-1.5 max-h-56 overflow-y-auto bg-muted/30">
                  {!lessons || lessons.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">
                      {tr("ยังไม่มีบทเรียนในคลาสนี้")}
                    </p>
                  ) : (
                    <>
                      {lessons.map((l) => (
                        <label
                          key={l.id}
                          className="flex items-start gap-2 p-1.5 rounded hover:bg-background cursor-pointer text-xs"
                        >
                          <Checkbox
                            checked={!!selectedLessonIds[l.id]}
                            onCheckedChange={(v) =>
                              setSelectedLessonIds((s) => ({ ...s, [l.id]: !!v }))
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{l.topic}</div>
                            <div className="text-muted-foreground truncate">
                              {new Date(l.lesson_date).toLocaleDateString("th-TH")} ·{" "}
                              {l.content.slice(0, 80)}
                              {l.content.length > 80 ? "…" : ""}
                            </div>
                          </div>
                        </label>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => insertSelectedLessons("append")}
                        >
                          {tr("เพิ่มเข้าเนื้อหา")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1"
                          onClick={() => insertSelectedLessons("replace")}
                        >
                          {tr("แทนที่เนื้อหา")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{tr("หัวข้อ")}</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={tr("เช่น ระบบสุริยะ, สงครามโลกครั้งที่ 2")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("เนื้อหา (จากบทเรียนหรือวางเอง)")}</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder={tr("วางเนื้อหาที่ต้องการออกข้อสอบตรงนี้...")}
            />
            <p className="text-xs text-muted-foreground">
              {content.length}/15000 {tr("ตัวอักษร")}
            </p>
          </div>

          {/* Difficulty mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">{tr("แบ่งความยาก")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={diffMode === "single" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDiffMode("single")}
              >
                {tr("ระดับเดียว")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={diffMode === "mix" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDiffMode("mix")}
              >
                {tr("ผสม (กำหนดจำนวนแต่ละระดับ)")}
              </Button>
            </div>
          </div>

          {diffMode === "single" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("จำนวนข้อ")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={singleCount}
                  onChange={(e) => setSingleCount(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("ความยาก")}</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ง่าย">{tr("ง่าย")}</SelectItem>
                    <SelectItem value="ปานกลาง">{tr("ปานกลาง")}</SelectItem>
                    <SelectItem value="ยาก">{tr("ยาก")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("ง่าย")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={easyCount}
                  onChange={(e) => setEasyCount(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("ปานกลาง")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={mediumCount}
                  onChange={(e) => setMediumCount(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("ยาก")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={hardCount}
                  onChange={(e) => setHardCount(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <p className="col-span-3 text-xs text-muted-foreground">
                {tr("รวมทั้งหมด")}: <b>{totalCount}</b> {tr("ข้อ")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("จำนวนตัวเลือก")}</Label>
              <Select
                value={String(optionsCount)}
                onValueChange={(v) => setOptionsCount(Number(v))}
                disabled={qType === "short_answer" || qType === "essay"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 (ก, ข)</SelectItem>
                  <SelectItem value="3">3 (ก, ข, ค)</SelectItem>
                  <SelectItem value="4">4 (ก, ข, ค, ง)</SelectItem>
                  <SelectItem value="5">5 (ก, ข, ค, ง, จ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("ประเภท")}</Label>
              <Select value={qType} onValueChange={(v) => setQType(v as typeof qType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiple_choice">{tr("ปรนัย")}</SelectItem>
                  <SelectItem value="short_answer">{tr("เติมคำ")}</SelectItem>
                  <SelectItem value="essay">{tr("ข้อเขียน (ยาว)")}</SelectItem>
                  <SelectItem value="mixed">{tr("ผสม")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("AI จะไม่เฉลยให้ — ครูเลือกคำตอบที่ถูกเองในแต่ละข้อ")}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {hasExisting && (
            <Button
              variant="outline"
              onClick={() => generate("append")}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 mr-1 animate-spin" />}
              {tr("เพิ่มต่อท้าย")}
            </Button>
          )}
          <Button onClick={() => generate("replace")} disabled={loading}>
            {loading && <Loader2 className="size-4 mr-1 animate-spin" />}
            {hasExisting ? tr("แทนที่ทั้งหมด") : tr("สร้าง")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
