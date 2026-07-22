// AI-powered exam question generator dialog.
// Teacher/admin pastes content + topic, picks count & type, AI returns draft questions.
// Parent decides whether to REPLACE or APPEND to its own question list.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { tr } from "@/i18n";

export type GeneratedQuestion = {
  question_type: "multiple_choice" | "short_answer";
  question: string;
  options: string[];
  correct_idx: number;
  expected_answer: string;
  points: number;
};

export function AiQuestionGenerator({
  onGenerated,
  hasExisting,
}: {
  onGenerated: (questions: GeneratedQuestion[], mode: "replace" | "append") => void;
  hasExisting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [count, setCount] = useState(5);
  const [qType, setQType] = useState<"multiple_choice" | "short_answer" | "mixed">(
    "multiple_choice",
  );
  const [difficulty, setDifficulty] = useState("ปานกลาง");
  const [loading, setLoading] = useState(false);

  async function generate(mode: "replace" | "append") {
    if (!topic.trim() && !content.trim()) {
      toast.error(tr("กรอกหัวข้อหรือเนื้อหาก่อน"));
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-exam-questions", {
        body: {
          topic: topic.trim(),
          content: content.trim(),
          count,
          question_type: qType,
          difficulty,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const questions = (data?.questions ?? []) as GeneratedQuestion[];
      if (questions.length === 0) {
        toast.error(tr("AI สร้างข้อสอบไม่ได้ ลองใหม่"));
        return;
      }
      const normalized: GeneratedQuestion[] = questions.map((q) => {
        const opts = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "")) : [];
        while (opts.length < 4) opts.push("");
        return {
          question_type: q.question_type === "short_answer" ? "short_answer" : "multiple_choice",
          question: String(q.question ?? "").trim(),
          options: opts.slice(0, 4),
          correct_idx: Math.max(0, Math.min(3, Number(q.correct_idx) || 0)),
          expected_answer: String(q.expected_answer ?? "").trim(),
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("AI ออกแบบข้อสอบ")}</DialogTitle>
          <DialogDescription>
            {tr("วางเนื้อหา แล้ว AI จะออกคำถามพร้อมเฉลยให้")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{tr("หัวข้อ")}</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={tr("เช่น ระบบสุริยะ, สงครามโลกครั้งที่ 2")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("เนื้อหา (วางบทเรียนหรือสรุป)")}</Label>
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
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("จำนวนข้อ")}</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
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
                  <SelectItem value="mixed">{tr("ผสม")}</SelectItem>
                </SelectContent>
              </Select>
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
