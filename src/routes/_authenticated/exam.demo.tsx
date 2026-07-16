import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, Clock, CheckCircle2, XCircle, Loader2, Maximize2 } from "lucide-react";
import { tr } from "@/i18n";
import { useExamProctoring } from "@/hooks/use-exam-proctoring";

// createFileRoute type expects a registered route path; routeTree generator
// can't run on Windows due to Lovable MCP plugin bug — cast to bypass type-check
export const Route = (createFileRoute as any)("/_authenticated/exam/demo")({
  component: DemoExamPage,
});

// ข้อสอบตัวอย่างคงที่ — สำหรับให้นักเรียนทดสอบระบบ proctoring
const DEMO_QUESTIONS = [
  {
    idx: 0,
    question_type: "multiple_choice" as const,
    question: tr("ข้อใดเป็นรากที่สองของ 144? (ตัวอย่างข้อสอบปรนัย — ทดสอบการกดตัวเลือก)"),
    options: ["10", "11", "12", "13"],
    correct_idx: 2,
    points: 1,
  },
  {
    idx: 1,
    question_type: "multiple_choice" as const,
    question: tr("โลกหมุนรอบตัวเองใช้เวลาเท่าใด? (ตัวอย่างข้อสอบปรนัย)"),
    options: ["12 ชั่วโมง", "24 ชั่วโมง", "365 วัน", "1 เดือน"],
    correct_idx: 1,
    points: 1,
  },
  {
    idx: 2,
    question_type: "short_answer" as const,
    question: tr("พิมพ์คำว่า 'สวัสดี' (ตัวอย่างข้อสอบเติมคำสั้น — ทดสอบการพิมพ์คำตอบ)"),
    expected_answer: "สวัสดี",
    points: 1,
  },
];

const DEMO_THRESHOLD = 99; // สูงมาก — proctoring ยังทำงาน แต่ไม่่มีการ auto-submit จริง

type DemoStage = "ready" | "exam" | "finished";

function DemoExamPage() {
  const nav = useNavigate();
  const [stage, setStage] = useState<DemoStage>("ready");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, { idx?: number; text?: string }>>({});
  const [endedReason, setEndedReason] = useState<string | null>(null);

  // จำลอง countdown 5 นาทีสำหรับ demo
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  const onAutoSubmit = useMemo(
    () => (_reason: string) => {
      // demo mode: ไม่ส่งจริง แค่แสดงว่าจะส่งได้
      setEndedReason("demo_violation_threshold");
      toast.info(
        tr("🔄 (โหมดทดสอบ) — ถ้าเป็นข้อสอบจริง ตอนนี้จะถูกส่งอัตโนมัติเพราะออกจากหน้าสอบครบเกณฑ์"),
      );
    },
    [],
  );

  const { violationCount, isFullscreenActive, requestFullscreen } = useExamProctoring({
    examId: "demo-fixed-not-real",
    enabled: stage === "exam" && !endedReason,
    threshold: DEMO_THRESHOLD,
    onAutoSubmit,
  });

  // เริ่ม countdown ตอนเข้าสอบ
  useEffect(() => {
    if (stage !== "exam") return;
    setRemainingSec(5 * 60); // 5 นาที
    const id = setInterval(() => {
      setRemainingSec((s) => {
        if (s === null) return null;
        if (s <= 1) {
          clearInterval(id);
          setStage("finished");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  // บังคับ fullscreen ตอนเข้าสอบ
  useEffect(() => {
    if (stage === "exam" && !isFullscreenActive && !endedReason) {
      requestFullscreen();
    }
  }, [stage, isFullscreenActive, endedReason, requestFullscreen]);

  // ====== READY SCREEN ======
  if (stage === "ready") {
    return (
      <div className="container max-w-2xl py-6 space-y-4">
        <div className="text-center">
          <div className="size-16 mx-auto rounded-2xl bg-primary/15 grid place-items-center mb-3">
            <Maximize2 className="size-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">{tr("🧪 ทดสอบระบบสอบ")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tr("ทดสอบความคุ้นเคยกับหน้าจอสอบและระบบป้องกันการโกง")}
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-blue-900 dark:text-blue-100">
              <p className="font-medium mb-1">ℹ️ {tr("โหมดทดสอบ — ไม่มีการบันทึกคะแนน")}</p>
              <p className="text-xs">
                {tr(
                  "ทุกคำตอบจะไม่ถูกบันทึก ไม่มีการส่งข้อสอบจริง ไม่ได้ XP — เน้นให้คุ้นเคยระบบเท่านั้น",
                )}
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="size-4 shrink-0" />
                <span>{tr("จำลองเวลาสอบ 5 นาที")}</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                <span>
                  {tr(
                    "ระบบป้องกันการโกงจะทำงานจริง (นับการออกจากหน้า + แจ้งเตือน) — แต่ไม่่มีการส่งอัตโนมัติ",
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Maximize2 className="size-4 shrink-0" />
                <span>{tr("ต้องสอบในโหมดเต็มจอ (fullscreen)")}</span>
              </div>
            </div>

            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-100">
              <p className="font-medium mb-1">⚠ {tr("กติกาสอบจริง")}:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>{tr("ห้ามเปลี่ยน tab, หน้าต่าง หรือออกจากโหมดเต็มจอ")}</li>
                <li>{tr("ห้าม copy/paste")}</li>
                <li>{tr("หมดเวลาหรือโกงครบเกณฑ์ = ส่งอัตโนมัติ")}</li>
              </ul>
            </div>

            <Button onClick={() => setStage("exam")} size="lg" className="w-full">
              {tr("เริ่มทดสอบ")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => nav({ to: "/dashboard" })}
            >
              {tr("ยกเลิก กลับหน้าหลัก")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ====== FINISHED SCREEN ======
  if (stage === "finished" || endedReason) {
    const correctCount = DEMO_QUESTIONS.filter((q) => {
      const a = answers[q.idx];
      if (q.question_type === "multiple_choice") return a?.idx === q.correct_idx;
      if (q.question_type === "short_answer") return (a?.text ?? "").trim() === q.expected_answer;
      return false;
    }).length;

    return (
      <div className="container max-w-md py-8 text-center space-y-4">
        <div className="size-16 mx-auto rounded-full bg-green-100 dark:bg-green-950 grid place-items-center">
          <CheckCircle2 className="size-10 text-green-600" />
        </div>
        <h1 className="text-2xl font-semibold">{tr("ทดสอบเสร็จสิ้น")}</h1>
        <Card>
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm text-muted-foreground">
              {tr("คุณตอบถูก (โหมดทดสอบ — ไม่บันทึกจริง)")}
            </p>
            <div className="text-4xl font-bold text-primary">
              {correctCount}/{DEMO_QUESTIONS.length}
            </div>
            {violationCount > 0 && (
              <Badge variant="outline" className="mt-2">
                ⚠ {tr("ออกจากหน้าสอบ ")}
                {violationCount} {tr("ครั้ง")} ({tr("ไม่่นับในโหมดทดสอบ")})
              </Badge>
            )}
            {endedReason && (
              <p className="text-xs text-muted-foreground mt-2">
                {tr("ℹ️ ในข้อสอบจริง ตอนนี้จะถูกส่งอัตโนมัติเพราะครบเกณฑ์การออกจากหน้า")}
              </p>
            )}
          </CardContent>
        </Card>
        <Button onClick={() => nav({ to: "/dashboard" })}>{tr("กลับหน้าหลัก")}</Button>
      </div>
    );
  }

  // ====== EXAM SCREEN ======
  const q = DEMO_QUESTIONS[currentIdx];
  const mmss =
    remainingSec !== null
      ? `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`
      : "--:--";

  function setAnswer(idx: number, value: { idx?: number; text?: string }) {
    setAnswers((a) => ({ ...a, [idx]: value }));
  }

  function exitFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* sticky top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1">
          <Clock className="size-4" />
          {tr("เหลือ")} <span className="font-mono font-bold">{mmss}</span>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {tr("🧪 โหมดทดสอบ")}
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="size-4 text-amber-500" />
          {tr("ออกจากหน้า")} {violationCount}/{DEMO_THRESHOLD}
        </span>
      </div>

      <div className="flex-1 container max-w-2xl py-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {tr("ข้อ")} {currentIdx + 1}/{DEMO_QUESTIONS.length}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => i - 1)}
            >
              ◀
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentIdx === DEMO_QUESTIONS.length - 1}
              onClick={() => setCurrentIdx((i) => i + 1)}
            >
              ▶
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-base">{q.question}</p>
            {q.question_type === "multiple_choice" ? (
              <div className="space-y-2">
                {q.options.map((opt, oi) => (
                  <label
                    key={oi}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer hover:bg-muted/40 ${
                      answers[q.idx]?.idx === oi ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${q.idx}`}
                      checked={answers[q.idx]?.idx === oi}
                      onChange={() => setAnswer(q.idx, { idx: oi })}
                    />
                    <span>
                      {["ก", "ข", "ค", "ง"][oi]}. {opt}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <Textarea
                value={answers[q.idx]?.text ?? ""}
                onChange={(e) => setAnswer(q.idx, { text: e.target.value })}
                placeholder={tr("พิมพ์คำตอบ...")}
                rows={3}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm(tr("จบการทดสอบ?"))) {
                exitFullscreen();
                setStage("finished");
              }
            }}
          >
            {tr("จบทดสอบ")}
          </Button>
          {currentIdx === DEMO_QUESTIONS.length - 1 && (
            <Button
              onClick={() => {
                exitFullscreen();
                setStage("finished");
              }}
            >
              {tr("ส่งและดูผล")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
