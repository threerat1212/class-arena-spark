import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Play, Square, Send, AlertTriangle, Clock, Maximize2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import {
  fetchExamRaw,
  fetchParticipants,
  fetchExamQuestionsSafe,
  fetchMyExamAnswers,
  fetchMyParticipant,
  rpcPublishExam,
  rpcOpenExam,
  rpcCloseExam,
  rpcStartExamAttempt,
  rpcSubmitExamAnswer,
  rpcSubmitExam,
} from "@/lib/exam.functions";
import type { ExamSessionRow, ExamParticipantRow } from "@/lib/exam.functions";
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

  if (!exam)
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );

  return isHost ? <HostView exam={exam} /> : <StudentView exam={exam} />;
}

// ============ HOST VIEW ============
function HostView({ exam }: { exam: ExamSessionRow }) {
  const qc = useQueryClient();
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const { data: participants } = useQuery({
    queryKey: ["exam-participants", exam.id],
    queryFn: () => fetchParticipants(exam.id),
    refetchInterval: exam.status === "active" ? 5000 : false,
  });

  const publishMut = useMutation({
    mutationFn: () =>
      rpcPublishExam(exam.id, new Date(startAt).toISOString(), new Date(endAt).toISOString()),
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
          <div>
            {tr("รหัสเข้าร่วม")}: <code className="font-mono text-lg">{exam.join_code}</code>
          </div>
          <div>
            {tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")} · {tr("โกงสูงสุด")}{" "}
            {exam.violation_threshold} {tr("ครั้ง")}
          </div>
          {exam.starts_at && (
            <div>
              {tr("เวลาเปิด")}: {new Date(exam.starts_at).toLocaleString("th-TH")}
            </div>
          )}
          {exam.ends_at && (
            <div>
              {tr("เวลาปิด")}: {new Date(exam.ends_at).toLocaleString("th-TH")}
            </div>
          )}
        </CardContent>
      </Card>

      {exam.status === "draft" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tr("กำหนดเวลาและเปิดสอบ")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs">{tr("เปิดสอบเมื่อ")}</label>
                <Input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs">{tr("ปิดสอบเมื่อ")}</label>
                <Input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={() => publishMut.mutate()}
              disabled={publishMut.isPending || !startAt || !endAt}
            >
              {publishMut.isPending && <Loader2 className="size-4 mr-1 animate-spin" />}
              {tr("กำหนดเวลา")}
            </Button>
          </CardContent>
        </Card>
      )}

      {exam.status === "scheduled" && (
        <Button onClick={() => openMut.mutate()} disabled={openMut.isPending} size="lg">
          {openMut.isPending ? (
            <Loader2 className="size-4 mr-1 animate-spin" />
          ) : (
            <Play className="size-4 mr-1" />
          )}
          {tr("เปิดสอบเลย")}
        </Button>
      )}

      {exam.status === "active" && (
        <Button
          onClick={() => closeMut.mutate()}
          disabled={closeMut.isPending}
          variant="destructive"
          size="lg"
        >
          {closeMut.isPending ? (
            <Loader2 className="size-4 mr-1 animate-spin" />
          ) : (
            <Square className="size-4 mr-1" />
          )}
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
              {tr("ยังไม่มีคนเข้าร่วม — แชร์รหัส ")}
              <code className="font-mono">{exam.join_code}</code>
            </p>
          ) : (
            <div className="space-y-1">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0"
                >
                  <span className="truncate">{p.user_id.slice(0, 8)}...</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {p.submitted_at ? (
                      <span>
                        ✓ {tr("ส่งแล้ว")}{" "}
                        {p.auto_submitted && (
                          <Badge variant="destructive" className="ml-1">
                            {tr("อัตโนมัติ")}
                          </Badge>
                        )}
                      </span>
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
function StudentView({ exam }: { exam: ExamSessionRow }) {
  // step 1: ready (not started)
  // step 2: in-exam (started, not submitted)
  // step 3: results (submitted)
  const { data: participant } = useQuery({
    queryKey: ["my-exam-participant", exam.id],
    queryFn: () => fetchMyParticipant(exam.id),
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

function ReadyScreen({ exam }: { exam: ExamSessionRow }) {
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
        <CardHeader>
          <CardTitle>{exam.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="size-4" /> {tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")}
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4" /> {tr("ออกจากหน้าสอบสูงสุด")}{" "}
              {exam.violation_threshold} {tr("ครั้ง — ครบจะส่งอัตโนมัติ")}
            </div>
            <div className="flex items-center gap-2">
              <Maximize2 className="size-4" /> {tr("ต้องสอบในโหมดเต็มจอ")}
            </div>
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

type AnswerDraft = { answer_idx?: number; answer_text?: string };

function ExamScreen({ exam, threshold }: { exam: ExamSessionRow; threshold: number }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [answersHydrated, setAnswersHydrated] = useState(false);

  const { data: questions } = useQuery({
    queryKey: ["exam-questions-safe", exam.id],
    queryFn: () => fetchExamQuestionsSafe(exam.id),
  });
  const { data: existingAnswers } = useQuery({
    queryKey: ["my-exam-answers", exam.id],
    queryFn: () => fetchMyExamAnswers(exam.id),
  });

  // merge existing answers into local state once on load
  useEffect(() => {
    if (existingAnswers && !answersHydrated) {
      const m: Record<string, AnswerDraft> = {};
      for (const a of existingAnswers) {
        m[a.question_id] = {
          answer_idx: a.answer_idx ?? undefined,
          answer_text: a.answer_text ?? undefined,
        };
      }
      setAnswers(m);
      setAnswersHydrated(true);
    }
  }, [existingAnswers, answersHydrated]);

  // proctoring hook — only when exam active and not ended
  const { violationCount, isFullscreenActive, requestFullscreen } = useExamProctoring({
    examId: exam.id,
    enabled: !endedReason,
    threshold,
    onAutoSubmit: (reason) => {
      setEndedReason(reason);
      toast.error(
        tr("ส่งข้อสอบอัตโนมัติ — ") +
          (reason === "violation_threshold"
            ? tr("ออกจากหน้าสอบครบ") + ` ${threshold} ` + tr("ครั้ง")
            : tr("หมดเวลา")),
      );
      qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      setTimeout(() => nav({ to: "/exam/$examId", params: { examId: exam.id } }), 1500);
    },
  });

  // countdown to ends_at
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  useEffect(() => {
    if (!exam.ends_at) return;
    const endsAt = exam.ends_at;
    const tick = () => {
      const s = Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000);
      setRemainingSec(Math.max(0, s));
      if (s <= 0) {
        setEndedReason("time_up");
        qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [exam.ends_at, qc, exam.id]);

  // enter fullscreen on mount
  useEffect(() => {
    if (!isFullscreenActive) {
      requestFullscreen();
    }
  }, [isFullscreenActive, requestFullscreen]);

  if (!questions)
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
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
        <Button onClick={() => nav({ to: "/exam/$examId", params: { examId: exam.id } })}>
          {tr("ดูผล")}
        </Button>
      </div>
    );
  }

  const q = questions[currentIdx];
  // view columns are nullable; bail out cleanly if the row is malformed
  if (!q.id || !q.question || !q.question_type) {
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  const qId = q.id;

  async function saveAnswer(questionId: string, value: AnswerDraft) {
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

  const mmss =
    remainingSec !== null
      ? `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`
      : "--:--";

  return (
    <div className="min-h-screen flex flex-col">
      {/* sticky top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1">
          <Clock className="size-4" /> {tr("เหลือ")}{" "}
          <span className="font-mono font-bold">{mmss}</span>
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle
            className={`size-4 ${violationCount >= threshold - 1 ? "text-red-500" : "text-amber-500"}`}
          />
          {tr("โกง")} {violationCount}/{threshold}
        </span>
      </div>

      <div className="flex-1 container max-w-2xl py-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {tr("ข้อ")} {currentIdx + 1}/{questions.length}
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
              disabled={currentIdx === questions.length - 1}
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
                {((q.options as string[] | null) ?? []).map((opt: string, oi: number) => (
                  <label
                    key={oi}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer hover:bg-muted/40 ${answers[qId]?.answer_idx === oi ? "border-primary bg-primary/5" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`q-${qId}`}
                      checked={answers[qId]?.answer_idx === oi}
                      onChange={() => saveAnswer(qId, { answer_idx: oi })}
                    />
                    <span>
                      {["ก", "ข", "ค", "ง", "จ"][oi]}. {opt}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <Textarea
                value={answers[qId]?.answer_text ?? ""}
                onChange={(e) => saveAnswer(qId, { answer_text: e.target.value })}
                placeholder={tr("พิมพ์คำตอบ...")}
                rows={8}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm(tr("ส่งข้อสอบเลย? ไม่สามารถแก้ไขได้หลังส่ง"))) submitAll();
            }}
          >
            <Send className="size-4 mr-1" /> {tr("ส่งข้อสอบ")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultsScreen({
  exam,
  participant,
}: {
  exam: ExamSessionRow;
  participant: Pick<
    ExamParticipantRow,
    "total_score" | "auto_submitted" | "auto_submit_reason" | "violation_count"
  >;
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
              {tr("ส่งอัตโนมัติ")}:{" "}
              {participant.auto_submit_reason === "violation_threshold"
                ? tr("โกงครบ")
                : tr("หมดเวลา")}
            </Badge>
          )}
          {participant.violation_count > 0 && (
            <p className="text-xs text-muted-foreground">
              {tr("ออกจากหน้าสอบ")} {participant.violation_count} {tr("ครั้ง")}
            </p>
          )}
        </CardContent>
      </Card>
      {/* exam reference kept to preserve component signature for future use (e.g. title display) */}
      <span className="sr-only">{exam.title}</span>
    </div>
  );
}
