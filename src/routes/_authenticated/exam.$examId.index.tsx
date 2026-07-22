import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { announceLuckyDrop } from "@/components/gamification/lucky-drop-toast";
import { Loader2, Play, Square, Send, AlertTriangle, Clock, Maximize2, Pencil, Palette, Trash2, ExternalLink, TimerReset } from "lucide-react";
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

// Deterministic per-student shuffle so refreshing keeps the same order,
// but different students get different question / option order (prevents copying).
function seedHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}


export const Route = createFileRoute("/_authenticated/exam/$examId/")({
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

  const statusMeta: Record<
    string,
    { label: string; className: string; dot: string }
  > = {
    draft: {
      label: tr("ฉบับร่าง"),
      className: "bg-muted text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    },
    scheduled: {
      label: tr("รอเปิดสอบ"),
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
      dot: "bg-amber-500",
    },
    active: {
      label: tr("กำลังสอบ"),
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
      dot: "bg-emerald-500 animate-pulse",
    },
    closed: {
      label: tr("ปิดแล้ว"),
      className: "bg-destructive/10 text-destructive border-destructive/30",
      dot: "bg-destructive",
    },
  };
  const sm = statusMeta[exam.status] ?? statusMeta.draft;

  const submittedCount = participants?.filter((p) => p.submitted_at).length ?? 0;
  const activeCount = participants?.filter((p) => p.started_at && !p.submitted_at).length ?? 0;
  const totalP = participants?.length ?? 0;
  const submitPct = totalP > 0 ? Math.round((submittedCount / totalP) * 100) : 0;

  function copyCode() {
    navigator.clipboard?.writeText(exam.join_code).then(
      () => toast.success(tr("คัดลอกรหัสแล้ว")),
      () => toast.error(tr("คัดลอกไม่สำเร็จ")),
    );
  }

  // datetime-local helper: local ISO minus seconds
  function toLocalInput(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function quickSet(mins: number) {
    const now = new Date();
    const end = new Date(now.getTime() + mins * 60_000);
    setStartAt(toLocalInput(now));
    setEndAt(toLocalInput(end));
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-6 lg:py-10 space-y-6">
      {/* ── Hero header ── */}
      <header className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:p-6 shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0 space-y-2">
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${sm.className}`}
            >
              <span className={`size-1.5 rounded-full ${sm.dot}`} />
              {sm.label}
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight truncate">
              {exam.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tr("จัดการข้อสอบ กำหนดเวลา และติดตามผู้เข้าสอบแบบเรียลไทม์")}
            </p>
          </div>
          {exam.status !== "active" && (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to="/exam/$examId/edit" params={{ examId: exam.id }}>
                <Pencil className="size-4 mr-1" />
                {tr("แก้ไขข้อสอบ")}
              </Link>
            </Button>
          )}
        </div>

        {/* stat grid */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={copyCode}
            className="group text-left rounded-xl border bg-card p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {tr("รหัสเข้าร่วม")}
            </div>
            <div className="mt-1 font-mono text-lg font-bold tracking-widest text-primary group-hover:underline">
              {exam.join_code}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{tr("คลิกเพื่อคัดลอก")}</div>
          </button>
          <div className="rounded-xl border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {tr("ระยะเวลา")}
            </div>
            <div className="mt-1 text-lg font-bold">
              {exam.duration_minutes}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{tr("นาที")}</span>
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {tr("โกงสูงสุด")}
            </div>
            <div className="mt-1 text-lg font-bold">
              {exam.violation_threshold}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{tr("ครั้ง")}</span>
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {tr("ผู้เข้าสอบ")}
            </div>
            <div className="mt-1 text-lg font-bold">
              {totalP}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                · {submittedCount} {tr("ส่ง")}
              </span>
            </div>
          </div>
        </div>

        {(exam.starts_at || exam.ends_at) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {exam.starts_at && (
              <span>
                🟢 {tr("เปิด")}: {new Date(exam.starts_at).toLocaleString("th-TH")}
              </span>
            )}
            {exam.ends_at && (
              <span>
                🔴 {tr("ปิด")}: {new Date(exam.ends_at).toLocaleString("th-TH")}
              </span>
            )}
          </div>
        )}
      </header>

      {/* ── Draft: schedule card ── */}
      {exam.status === "draft" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              {tr("กำหนดเวลาและเปิดสอบ")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {tr("เลือกด่วน หรือกำหนดเองก็ได้")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[
                { m: exam.duration_minutes, label: tr("เริ่มตอนนี้") },
                { m: 30, label: "+30m" },
                { m: 60, label: "+1h" },
                { m: 60 * 24, label: tr("พรุ่งนี้") },
              ].map((q, i) => (
                <Button
                  key={i}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => quickSet(q.m)}
                >
                  {q.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {tr("เปิดสอบเมื่อ")}
                </label>
                <Input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {tr("ปิดสอบเมื่อ")}
                </label>
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
              size="lg"
              className="w-full sm:w-auto"
            >
              {publishMut.isPending ? (
                <Loader2 className="size-4 mr-1 animate-spin" />
              ) : (
                <Play className="size-4 mr-1" />
              )}
              {tr("กำหนดเวลา & เผยแพร่")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Action strips for scheduled / active ── */}
      {exam.status === "scheduled" && (
        <div className="rounded-xl border bg-amber-500/5 border-amber-500/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div>
            <p className="font-medium">{tr("รอเปิดสอบ")}</p>
            <p className="text-xs text-muted-foreground">
              {tr("กด 'เปิดสอบเลย' เพื่อให้เด็กเข้าได้ทันที")}
            </p>
          </div>
          <Button
            onClick={() => openMut.mutate()}
            disabled={openMut.isPending}
            size="lg"
          >
            {openMut.isPending ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Play className="size-4 mr-1" />
            )}
            {tr("เปิดสอบเลย")}
          </Button>
        </div>
      )}

      {exam.status === "active" && (
        <div className="rounded-xl border bg-emerald-500/5 border-emerald-500/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <p className="font-medium">{tr("กำลังสอบอยู่")}</p>
              <p className="text-xs text-muted-foreground">
                {activeCount} {tr("คนกำลังทำ")} · {submittedCount}/{totalP} {tr("ส่งแล้ว")}
              </p>
            </div>
          </div>
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
            {tr("ปิดสอบ")}
          </Button>
        </div>
      )}

      <CanvaPoolCard examId={exam.id} />

      {/* ── Participants ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">
              {tr("ผู้เข้าสอบ")}{" "}
              <span className="text-muted-foreground font-normal">({totalP})</span>
            </CardTitle>
            {totalP > 0 && (
              <span className="text-xs text-muted-foreground">
                {submittedCount}/{totalP} {tr("ส่งแล้ว")}
              </span>
            )}
          </div>
          {totalP > 0 && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-2">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${submitPct}%` }}
              />
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!participants || participants.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <div className="mx-auto size-12 rounded-full bg-muted grid place-items-center">
                <AlertTriangle className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {tr("ยังไม่มีคนเข้าร่วม")}
              </p>
              <p className="text-xs text-muted-foreground">
                {tr("แชร์รหัส")}{" "}
                <code className="font-mono font-bold text-foreground">{exam.join_code}</code>{" "}
                {tr("ให้นักเรียน")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {participants.map((p, i) => {
                const state = p.submitted_at
                  ? { label: tr("ส่งแล้ว"), dot: "bg-emerald-500", tone: "text-emerald-600" }
                  : p.started_at
                    ? { label: tr("กำลังทำ"), dot: "bg-blue-500 animate-pulse", tone: "text-blue-600" }
                    : { label: tr("รอเริ่ม"), dot: "bg-muted-foreground/60", tone: "text-muted-foreground" };
                return (
                  <div key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="size-7 shrink-0 rounded-full bg-muted grid place-items-center text-[10px] font-medium text-muted-foreground">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {p.user_id.slice(0, 8)}
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 text-xs ${state.tone}`}>
                      <span className={`size-1.5 rounded-full ${state.dot}`} />
                      {state.label}
                    </span>
                    {p.auto_submitted && (
                      <Badge variant="destructive" className="text-[10px]">
                        {tr("อัตโนมัติ")}
                      </Badge>
                    )}
                    {p.violation_count > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        ⚠ {p.violation_count}
                      </Badge>
                    )}
                  </div>
                );
              })}
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
          <CanvaStudentButton examId={exam.id} canAssign={!!exam && exam.status === "active"} />
        </CardContent>
      </Card>
    </div>
  );
}

type AnswerDraft = { answer_idx?: number; answer_text?: string };

function ExamScreen({ exam, threshold }: { exam: ExamSessionRow; threshold: number }) {
  const { user } = useAuth();

  const nav = useNavigate();
  const qc = useQueryClient();
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [answersHydrated, setAnswersHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { data: questions } = useQuery({
    queryKey: ["exam-questions-safe", exam.id],
    queryFn: () => fetchExamQuestionsSafe(exam.id),
  });
  const { data: existingAnswers } = useQuery({
    queryKey: ["my-exam-answers", exam.id],
    queryFn: () => fetchMyExamAnswers(exam.id),
  });
  const { data: participant } = useQuery({
    queryKey: ["my-exam-participant", exam.id],
    queryFn: () => fetchMyParticipant(exam.id),
    refetchInterval: 30_000,
  });
  const { data: extraTimeStock } = useQuery({
    queryKey: ["inv", "extra_time"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_inventory")
        .select("quantity")
        .eq("item_kind", "extra_time")
        .maybeSingle();
      return data?.quantity ?? 0;
    },
  });
  const extraSeconds = participant?.extra_time_seconds ?? 0;
  const [usingExtra, setUsingExtra] = useState(false);
  async function useExtraTime() {
    setUsingExtra(true);
    try {
      const { error } = await supabase.rpc("use_extra_time_token", { _exam_id: exam.id, _minutes: 5 });
      if (error) throw error;
      toast.success(tr("เพิ่มเวลา +5 นาที"));
      qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      qc.invalidateQueries({ queryKey: ["inv", "extra_time"] });
      qc.invalidateQueries({ queryKey: ["active-boosts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ใช้ไม่สำเร็จ"));
    } finally {
      setUsingExtra(false);
    }
  }

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

  // countdown to ends_at (+ extra time token bonus)
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  useEffect(() => {
    if (!exam.ends_at) return;
    const endsAtMs = new Date(exam.ends_at).getTime() + extraSeconds * 1000;
    const tick = () => {
      const s = Math.floor((endsAtMs - Date.now()) / 1000);
      setRemainingSec(Math.max(0, s));
      if (s <= 0) {
        setEndedReason("time_up");
        qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [exam.ends_at, extraSeconds, qc, exam.id]);

  // enter fullscreen on mount
  useEffect(() => {
    if (!isFullscreenActive) {
      requestFullscreen();
    }
  }, [isFullscreenActive, requestFullscreen]);

  // Per-student shuffle: question order + MC option order.
  // Same student always sees the same order (refresh-safe); different students see different orders.
  const shuffleSeed = user?.id ? `${exam.id}::${user.id}` : "";
  const orderedQuestions = useMemo(() => {
    if (!questions || !shuffleSeed) return questions ?? [];
    return shuffleWithSeed(questions, seedHash(shuffleSeed));
  }, [questions, shuffleSeed]);
  const optionOrderMap = useMemo(() => {
    const m: Record<string, number[]> = {};
    if (!questions || !shuffleSeed) return m;
    for (const qq of questions) {
      if (!qq.id) continue;
      const n = Array.isArray(qq.options) ? (qq.options as unknown[]).length : 0;
      if (n <= 0) continue;
      m[qq.id] = shuffleWithSeed(
        Array.from({ length: n }, (_, i) => i),
        seedHash(`${shuffleSeed}::${qq.id}`),
      );
    }
    return m;
  }, [questions, shuffleSeed]);

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

  const q = orderedQuestions[currentIdx];
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
    if (submitting || submitted) return;
    setSubmitting(true);
    try {
      const result = await rpcSubmitExam(exam.id);
      setSubmitted(true);
      const xpGained = result.base_amount ?? result.xp_awarded ?? 0;
      const bonusParts: string[] = [];
      if (result.combo_applied && result.combo_applied > 0) {
        bonusParts.push(`🔥 combo ×${result.combo_applied}`);
      }
      if (result.multiplier_applied && result.multiplier_applied > 1) {
        bonusParts.push(`×${result.multiplier_applied.toFixed(2)}`);
      }
      if (result.perfect_bonus && result.perfect_bonus > 0) {
        bonusParts.push(`🎯 +${result.perfect_bonus}`);
      }
      const summary = bonusParts.length
        ? `${tr("ส่งข้อสอบแล้ว")} • +${xpGained} XP ${bonusParts.join(" ")}`
        : `${tr("ส่งข้อสอบแล้ว")} • +${xpGained} XP`;
      toast.success(summary);
      if (result.lucky_drop) announceLuckyDrop(result.lucky_drop);
      qc.invalidateQueries({ queryKey: ["my-exam-participant", exam.id] });
      qc.invalidateQueries({ queryKey: ["xp-transactions"] });
      qc.invalidateQueries({ queryKey: ["xp-summary"] });
      nav({ to: "/exam/$examId", params: { examId: exam.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ส่งข้อสอบล้มเหลว"));
      setSubmitting(false);
    }
  }

  const mmss =
    remainingSec !== null
      ? `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`
      : "--:--";

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Blocking overlay: shown whenever not fullscreen — student cannot continue until they return */}
      {!isFullscreenActive && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm grid place-items-center p-6">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 space-y-4 text-center">
              <AlertTriangle className="size-12 mx-auto text-red-500" />
              <h2 className="text-xl font-bold">{tr("คุณออกจากโหมดเต็มจอ")}</h2>
              <p className="text-sm text-muted-foreground">
                {tr("การย่อจอ / สลับแท็บ / ออกจากเต็มจอ ถูกนับเป็นการโกง")}
                <br />
                {tr("ตอนนี้โกง")} <b className="text-red-500">{violationCount}/{threshold}</b>{" "}
                {tr("ครั้ง — ครบจะส่งอัตโนมัติ")}
              </p>
              <Button onClick={requestFullscreen} size="lg" className="w-full">
                <Maximize2 className="size-4 mr-2" />
                {tr("กลับเข้าเต็มจอเพื่อทำต่อ")}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* sticky top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1">
          <Clock className="size-4" /> {tr("เหลือ")}{" "}
          <span className="font-mono font-bold">{mmss}</span>
        </span>
        <div className="flex items-center gap-3">
          {(extraTimeStock ?? 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={useExtraTime}
              disabled={usingExtra}
              title={tr("ใช้โทเคนเพิ่มเวลา +5 นาที")}
            >
              {usingExtra ? (
                <Loader2 className="size-3.5 mr-1 animate-spin" />
              ) : (
                <TimerReset className="size-3.5 mr-1" />
              )}
              +5m ({extraTimeStock})
            </Button>
          )}
          <CanvaStudentButton examId={exam.id} canAssign compact />
          <span className="flex items-center gap-1">
            <AlertTriangle
              className={`size-4 ${violationCount >= threshold - 1 ? "text-red-500" : "text-amber-500"}`}
            />
            {tr("โกง")} {violationCount}/{threshold}
          </span>
        </div>
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
            {(() => {
              const rawOpts = (q.options as string[] | null) ?? [];
              const order = optionOrderMap[qId] ?? rawOpts.map((_, i) => i);
              return order.map((origIdx, displayIdx) => {
                const opt = rawOpts[origIdx] ?? "";
                return (
                  <label
                    key={displayIdx}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer hover:bg-muted/40 ${answers[qId]?.answer_idx === origIdx ? "border-primary bg-primary/5" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`q-${qId}`}
                      checked={answers[qId]?.answer_idx === origIdx}
                      onChange={() => saveAnswer(qId, { answer_idx: origIdx })}
                    />
                    <span>
                      {["ก", "ข", "ค", "ง", "จ"][displayIdx]}. {opt}
                    </span>
                  </label>
                );
              });
            })()}
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

        <div className="flex justify-end">
          {(() => {
            const answeredCount = questions.filter((qq) => {
              if (!qq.id) return false;
              const a = answers[qq.id];
              if (!a) return false;
              if (qq.question_type === "multiple_choice") return typeof a.answer_idx === "number";
              return !!a.answer_text && a.answer_text.trim().length > 0;
            }).length;
            const total = questions.length;
            const unanswered = total - answeredCount;
            const isLast = currentIdx === total - 1;
            return (
              <SubmitExamButton
                total={total}
                answered={answeredCount}
                unanswered={unanswered}
                highlight={isLast && unanswered === 0}
                submitting={submitting}
                submitted={submitted}
                onConfirm={submitAll}
              />
            );
          })()}
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

// ============ Canva pool (host) ============
type CanvaLinkRow = {
  id: string;
  exam_id: string;
  url: string;
  label: string | null;
  assigned_to_user_id: string | null;
  assigned_at: string | null;
};

function CanvaPoolCard({ examId }: { examId: string }) {
  const qc = useQueryClient();
  const [bulk, setBulk] = useState("");
  const [label, setLabel] = useState("");

  const { data: links } = useQuery({
    queryKey: ["exam-canva-links", examId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_canva_links")
        .select("id,exam_id,url,label,assigned_to_user_id,assigned_at")
        .eq("exam_id", examId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CanvaLinkRow[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const urls = bulk
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (urls.length === 0) throw new Error(tr("ใส่ลิงก์อย่างน้อย 1 อัน"));
      const rows = urls.map((u, i) => ({
        exam_id: examId,
        url: u,
        label: label ? `${label} #${i + 1}` : null,
      }));
      const { error } = await supabase.from("exam_canva_links").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tr("เพิ่มลิงก์แล้ว"));
      setBulk("");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["exam-canva-links", examId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exam_canva_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-canva-links", examId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const assigned = links?.filter((l) => l.assigned_to_user_id) ?? [];
  const available = links?.filter((l) => !l.assigned_to_user_id) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Palette className="size-4" /> {tr("Canva สำหรับข้อสอบ (รายบุคคล)")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {tr("วางลิงก์ Canva หลายอัน (บรรทัดละ 1 ลิงก์) ระบบจะสุ่มจ่ายให้เด็กคนละ 1 อันโดยอัตโนมัติเมื่อเข้าสอบ")}
        </p>
        <Input
          placeholder={tr("ป้ายชื่อ (ไม่บังคับ) เช่น 'ชุด A'")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Textarea
          placeholder={"https://www.canva.com/design/xxx\nhttps://www.canva.com/design/yyy"}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          rows={4}
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={() => addMut.mutate()} disabled={addMut.isPending}>
          {addMut.isPending && <Loader2 className="size-4 mr-1 animate-spin" />}
          {tr("เพิ่มลิงก์")}
        </Button>

        <div className="text-xs text-muted-foreground pt-2">
          {tr("ว่าง")} {available.length} · {tr("แจกแล้ว")} {assigned.length}
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {(links ?? []).map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 text-xs py-1.5 border-b border-border/40 last:border-0"
            >
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate hover:underline"
              >
                {l.label ? `${l.label} — ` : ""}
                {l.url}
              </a>
              {l.assigned_to_user_id ? (
                <Badge variant="secondary">
                  {tr("แจก:")} {l.assigned_to_user_id.slice(0, 6)}
                </Badge>
              ) : (
                <Badge variant="outline">{tr("ว่าง")}</Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => delMut.mutate(l.id)}
                disabled={delMut.isPending}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Canva link (student) ============
function CanvaStudentButton({
  examId,
  canAssign,
  compact,
}: {
  examId: string;
  canAssign: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data: mine } = useQuery({
    queryKey: ["exam-canva-mine", examId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_canva_links")
        .select("id,url,label")
        .eq("exam_id", examId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; url: string; label: string | null } | null;
    },
  });
  // any exam_canva_links row visible to the student is theirs (RLS filters others)

  const [pending, setPending] = useState(false);
  async function claim() {
    setPending(true);
    try {
      const { data, error } = await supabase.rpc("assign_exam_canva_link", { _exam_id: examId });
      if (error) throw error;
      const row = data as unknown as { url?: string } | null;
      if (row?.url) window.open(row.url, "_blank", "noopener,noreferrer");
      qc.invalidateQueries({ queryKey: ["exam-canva-mine", examId] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no_link_available")) toast.error(tr("ครูยังไม่ได้ตั้งลิงก์ Canva"));
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  if (mine) {
    return (
      <Button
        size={compact ? "sm" : "lg"}
        variant={compact ? "outline" : "secondary"}
        className={compact ? "" : "w-full"}
        onClick={() => window.open(mine.url, "_blank", "noopener,noreferrer")}
      >
        <Palette className="size-4 mr-1" />
        {tr("เปิด Canva ของฉัน")}
        <ExternalLink className="size-3 ml-1" />
      </Button>
    );
  }

  if (!canAssign) return null;

  return (
    <Button
      size={compact ? "sm" : "lg"}
      variant={compact ? "outline" : "secondary"}
      className={compact ? "" : "w-full"}
      onClick={claim}
      disabled={pending}
    >
      {pending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Palette className="size-4 mr-1" />}
      {tr("รับลิงก์ Canva")}
    </Button>
  );
}
