import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BonusBreakdown } from "@/components/gamification/bonus-breakdown";
import { ComboBadge } from "@/components/gamification/combo-badge";
import { announceLuckyDrop } from "@/components/gamification/lucky-drop-toast";
import {
  Sparkles,
  Zap,
  Coins,
  Check,
  Lock,
  Trophy,
  ArrowUp,
  Star,
  Clock,
  ChevronRight,
  ChevronDown,
  Loader2,
  Users,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import type { Database, Json } from "@/integrations/supabase/types";

import { tr } from "@/i18n";
export const Route = createFileRoute("/_authenticated/quests")({ component: QuestsPage });

type DailyQuestViewRow = Database["public"]["Views"]["daily_quests_safe"]["Row"];
type DailyQuest = DailyQuestViewRow & {
  classrooms?: { name?: string | null } | null;
};
type ClassroomNameRow = Pick<Database["public"]["Tables"]["classrooms"]["Row"], "id" | "name">;
type QuestAttemptRow = Database["public"]["Tables"]["daily_quest_attempts"]["Row"];
type QuestProgressRow = Omit<
  Database["public"]["Tables"]["daily_quest_question_progress"]["Row"],
  "result"
> & {
  result?: QuestGradeResult | null;
};
type UserTitleCodeRow = { titles?: { code: string | null } | null };
type ProfileNameRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "display_name">;

type QuestQuestion = {
  question?: string;
  expected_answer?: string;
  difficulty?: string;
  difficulty_label?: string;
  keywords?: string[];
  points?: number;
};

type QuestGradeResult = {
  idx?: number;
  score?: number;
  max_score?: number;
  correct?: boolean;
  feedback?: string;
};

type GradeQuestResponse = {
  results?: QuestGradeResult[];
  total_score?: number;
  max_score?: number;
  overall_feedback?: string;
};

type AwardQuestResult = {
  xp_gained?: number;
  gold_awarded?: number;
  // Engagement Engine bonus fields (added in Phase 1).
  // All optional so older RPC responses still type-check.
  combo_applied?: number;
  multiplier_applied?: number;
  perfect_bonus?: number;
  lucky_drop?: {
    id: string;
    kind: "gold" | "xp" | "cosmetic_voucher" | "rare_title";
    amount: number | null;
    status: "granted" | "pending" | "revoked";
  } | null;
};

type CompletedQuestResult = GradeQuestResponse & AwardQuestResult;

type QuestAttemptView = {
  score?: number;
  max_score?: number;
  xp_awarded?: number;
  gold_awarded?: number;
  ai_feedback?: string | null;
  per_question?: Json | QuestGradeResult[] | null;
  answers?: Json | string[];
  // Engagement Engine bonus context (passed through from award RPC).
  combo_applied?: number;
  multiplier_applied?: number;
  perfect_bonus?: number;
  lucky_drop?: AwardQuestResult["lucky_drop"];
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : tr("ผิดพลาด");
}

function isJsonObject(
  value: Json | null | undefined,
): value is { [key: string]: Json | undefined } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toQuestQuestions(value: Json | QuestQuestion[] | null | undefined): QuestQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) => !!item && typeof item === "object" && !Array.isArray(item),
  ) as QuestQuestion[];
}

function toGradeResult(value: Json | QuestGradeResult | null | undefined): QuestGradeResult | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as QuestGradeResult)
    : null;
}

function toGradeResults(value: Json | QuestGradeResult[] | null | undefined): QuestGradeResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toGradeResult(item as Json | QuestGradeResult))
    .filter((item): item is QuestGradeResult => !!item);
}

function toStringArray(value: Json | string[] | null | undefined): string[] {
  return Array.isArray(value) ? (value.filter((item) => typeof item === "string") as string[]) : [];
}

function toAwardResult(value: Json | null | undefined): AwardQuestResult | null {
  return isJsonObject(value) ? (value as unknown as AwardQuestResult) : null;
}

function QuestsPage() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () =>
      (await supabase.from("profiles").select("*").eq("id", user!.id).single()).data,
    enabled: !!user,
  });

  const { data: quests } = useQuery({
    queryKey: ["all-daily-quests"],
    queryFn: async () =>
      (
        await supabase
          .from("daily_quests_safe")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
      ).data ?? ([] as DailyQuest[]),
  });

  const questList = (quests ?? []) as DailyQuest[];
  const classroomIds = Array.from(
    new Set(questList.map((q) => q.classroom_id).filter((id): id is string => !!id)),
  );
  const { data: classrooms } = useQuery({
    queryKey: ["classroom-names", classroomIds.join(",")],
    queryFn: async () =>
      (await supabase.from("classrooms").select("id,name").in("id", classroomIds)).data ?? [],
    enabled: classroomIds.length > 0,
  });
  const classMap = Object.fromEntries(
    ((classrooms ?? []) as ClassroomNameRow[]).map((c) => [c.id, c.name]),
  );

  const { data: attempts } = useQuery({
    queryKey: ["my-attempts", user?.id],
    queryFn: async () =>
      (await supabase.from("daily_quest_attempts").select("*").eq("user_id", user!.id)).data ?? [],
    enabled: !!user,
  });

  // Fetch the user's titles to determine which secret quests they can see
  const { data: myTitles } = useQuery({
    queryKey: ["my-title-codes", user?.id],
    queryFn: async () =>
      (await supabase.from("user_titles").select("titles(code)").eq("user_id", user!.id)).data ??
      [],
    enabled: !!user,
  });
  const myTitleCodes = new Set(
    ((myTitles ?? []) as UserTitleCodeRow[])
      .map((t) => t.titles?.code)
      .filter((code): code is string => !!code),
  );

  const lvl = profile?.level ?? 1;
  const xp = profile?.xp ?? 0;

  // Filter out secret quests the user doesn't have the required title for
  const visibleQuests = questList.filter(
    (q) => !q.required_title_code || myTitleCodes.has(q.required_title_code),
  );

  const attemptList = (attempts ?? []) as QuestAttemptRow[];
  const sortedQuests = [...visibleQuests].sort((a, b) => {
    const aAtt = attemptList.find((x) => x.quest_id === a.id);
    const bAtt = attemptList.find((x) => x.quest_id === b.id);
    const aLocked = false;
    const bLocked = false;
    if (aLocked !== bLocked) return aLocked ? 1 : -1;
    if (!!aAtt !== !!bAtt) return aAtt ? 1 : -1;
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl">{tr("เควสต์ฝึกทักษะ")}</h1>
          <p className="text-muted-foreground mt-1">
            {tr("เลเวลของฉัน:")}
            <span className="font-semibold">{lvl}</span> • XP: {xp} • Streak:{" "}
            {profile?.streak_days ?? 0}🔥
          </p>
        </div>
        <Badge className="text-sm" variant="outline">
          <Trophy className="size-3 mr-1" />
          ทำสำเร็จ {profile?.quests_completed ?? 0} ข้อ
        </Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedQuests?.length === 0 && (
          <p className="text-muted-foreground text-sm">{tr("ยังไม่มี Practice Quest")}</p>
        )}
        {sortedQuests?.map((q) => {
          const att = attemptList.find((a) => a.quest_id === q.id);
          const locked = false;
          const qWithClass = {
            ...q,
            classrooms: q.classroom_id ? { name: classMap[q.classroom_id] } : null,
          };
          return (
            <StudentQuestQuestions
              key={q.id}
              quest={qWithClass}
              attempt={att}
              locked={locked}
              playerLevel={lvl}
              playerXp={xp}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders each sub-question of a quest as its own card (student view).
 * Answers are shared across the cards of the same quest; submitting any card
 * grades the entire quest using all current answers.
 */
export function StudentQuestQuestions({
  quest,
  attempt,
  locked,
  playerLevel,
  playerXp,
  onDone,
}: {
  quest: DailyQuest;
  attempt?: QuestAttemptRow | null;
  locked: boolean;
  playerLevel: number;
  playerXp: number;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const questions = toQuestQuestions(quest.questions);
  const questId = quest.id ?? "";

  // Persisted per-question progress (survives refresh) — only fetched until final attempt exists
  const { data: progressRows } = useQuery({
    queryKey: ["dq-progress", questId, user?.id],
    queryFn: async () =>
      (
        await supabase
          .from("daily_quest_question_progress")
          .select("*")
          .eq("user_id", user!.id)
          .eq("quest_id", questId)
      ).data ?? [],
    enabled: !!user && !attempt && !!questId,
  });

  const persistedResults: Record<number, QuestGradeResult> = {};
  const persistedAnswers: Record<number, string> = {};
  for (const row of (progressRows ?? []) as QuestProgressRow[]) {
    const result = toGradeResult(row.result);
    if (result) persistedResults[row.q_index] = result;
    if (typeof row.answer === "string") persistedAnswers[row.q_index] = row.answer;
  }

  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [submittingIdx, setSubmittingIdx] = useState<number | null>(null);
  const [perResults, setPerResults] = useState<Record<number, QuestGradeResult>>({});
  const [awarded, setAwarded] = useState<AwardQuestResult | null>(null);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [hintLoadingIdx, setHintLoadingIdx] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  const { data: tokenStock } = useQuery({
    queryKey: ["inv-tokens", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_inventory")
        .select("item_kind,quantity")
        .in("item_kind", ["hint_token", "retry_token"]);
      const map: Record<string, number> = { hint_token: 0, retry_token: 0 };
      for (const r of data ?? []) map[r.item_kind] = (map[r.item_kind] ?? 0) + (r.quantity ?? 0);
      return map;
    },
    enabled: !!user,
  });

  async function useHint(i: number) {
    if (!questId) return;
    setHintLoadingIdx(i);
    try {
      const { data, error } = await supabase.rpc("use_hint_token", {
        _quest_id: questId,
        _q_index: i,
      });
      if (error) throw error;
      const resp = data as { hint?: string } | null;
      if (resp?.hint) {
        setHints((h) => ({ ...h, [i]: resp.hint! }));
        toast.success(tr("ใบ้แล้ว!"));
        qc.invalidateQueries({ queryKey: ["inv-tokens"] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ใช้ไม่สำเร็จ"));
    } finally {
      setHintLoadingIdx(null);
    }
  }

  async function useRetry() {
    if (!questId) return;
    if (!window.confirm(tr("ใช้ Retry Token เพื่อทำ quest นี้ใหม่? (คะแนน/ทองรอบก่อนจะถูกย้อนคืน)"))) return;
    setRetrying(true);
    try {
      const { error } = await supabase.rpc("use_retry_token", { _quest_id: questId });
      if (error) throw error;
      toast.success(tr("รีเซ็ต quest แล้ว — เริ่มใหม่ได้เลย"));
      qc.invalidateQueries({ queryKey: ["my-attempts"] });
      qc.invalidateQueries({ queryKey: ["my-dq-attempts"] });
      qc.invalidateQueries({ queryKey: ["dq-progress", questId] });
      qc.invalidateQueries({ queryKey: ["inv-tokens"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setPerResults({});
      setAwarded(null);
      setAnswers(questions.map(() => ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ใช้ไม่สำเร็จ"));
    } finally {
      setRetrying(false);
    }
  }

  async function submitOne(i: number) {
    if (!answers[i]?.trim()) return;
    if (!questId) {
      toast.error(tr("ไม่พบ Quest"));
      return;
    }
    setSubmittingIdx(i);
    try {
      const { data: graded, error } = await supabase.functions.invoke("grade-quest-answer", {
        body: { quest_id: questId, answers, only_index: i },
      });
      if (error) throw error;
      const gradeResponse = graded as GradeQuestResponse | null;
      const r = gradeResponse?.results?.find((x) => x?.idx === i) ?? gradeResponse?.results?.[0];
      if (!r) throw new Error("ไม่ได้รับผลตรวจ");

      const nextResults = { ...perResults, [i]: r };
      setPerResults(nextResults);

      // Persist this question's progress so refresh doesn't lose it
      await supabase.from("daily_quest_question_progress").upsert(
        {
          user_id: user!.id,
          quest_id: questId,
          q_index: i,
          answer: answers[i],
          result: r as unknown as Json,
        },
        { onConflict: "user_id,quest_id,q_index" },
      );

      const gotPoints = r.score ?? 0;
      const maxPoints = r.max_score ?? 0;
      const pct = maxPoints > 0 ? Math.round((gotPoints / maxPoints) * 100) : 0;
      toast.success(`ข้อ ${i + 1}: ${gotPoints}/${maxPoints} (${pct}%)`);

      // Merge fresh + persisted to decide if quest is fully done
      const allResults: Record<number, QuestGradeResult> = { ...persistedResults, ...nextResults };
      const allDone = questions.every((_, k) => allResults[k] !== undefined);
      if (allDone) {
        const ordered = questions.map((_, k) => allResults[k]);
        const total = ordered.reduce((s, x) => s + (x?.score ?? 0), 0);
        const max = ordered.reduce((s, x) => s + (x?.max_score ?? 0), 0);
        const overall = ordered.map((x, k) => `ข้อ ${k + 1}: ${x?.feedback ?? ""}`).join(" • ");
        const finalAnswers = questions.map((_, k) =>
          answers[k]?.trim() ? answers[k] : (persistedAnswers[k] ?? ""),
        );
        const { data: award, error: e2 } = await supabase.rpc("award_quest_attempt", {
          _quest_id: questId,
          _answers: finalAnswers,
          _score: total,
          _max_score: max,
          _feedback: overall,
          _per_question: ordered as unknown as Json,
        });
        if (e2) throw e2;
        const awardResult = toAwardResult(award);
        setAwarded(awardResult);
        toast.success(
          `ได้ ${awardResult?.xp_gained ?? 0} XP + ${awardResult?.gold_awarded ?? 0} ทอง!`,
        );
        if (awardResult?.lucky_drop) announceLuckyDrop(awardResult.lucky_drop);
        await supabase
          .from("daily_quest_question_progress")
          .delete()
          .eq("user_id", user!.id)
          .eq("quest_id", questId);
        qc.invalidateQueries({ queryKey: ["my-attempts"] });
        qc.invalidateQueries({ queryKey: ["my-dq-attempts"] });
        qc.invalidateQueries({ queryKey: ["xp-transactions"] });
        qc.invalidateQueries({ queryKey: ["xp-summary"] });
        qc.invalidateQueries({ queryKey: ["profile"] });
        onDone?.();
      }
      qc.invalidateQueries({ queryKey: ["dq-progress", questId, user?.id] });
      setOpenIdx(null);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    } finally {
      setSubmittingIdx(null);
    }
  }

  const savedPerQ = toGradeResults(attempt?.per_question ?? null);
  const savedAns = toStringArray(attempt?.answers ?? null);

  const answeredCount = new Set([...Object.keys(persistedResults), ...Object.keys(perResults)])
    .size;
  const canFinalize = !attempt && !awarded && answeredCount > 0 && answeredCount < questions.length;
  const [finalizing, setFinalizing] = useState(false);

  async function finalizePartial() {
    if (
      !confirm(
        tr(
          `ส่งสรุปคะแนนเลยใช่ไหม? ข้อที่ยังไม่ตอบจะได้ 0 คะแนน (ตอบแล้ว ${answeredCount}/${questions.length} ข้อ)`,
        ),
      )
    )
      return;
    setFinalizing(true);
    try {
      if (!questId) throw new Error(tr("ไม่พบ Quest"));
      const { data: award, error } = await supabase.rpc("finalize_my_quest_progress", {
        _quest_id: questId,
      });
      if (error) throw error;
      const awardResult = toAwardResult(award);
      setAwarded(awardResult);
      toast.success(
        `ได้ ${awardResult?.xp_gained ?? 0} XP + ${awardResult?.gold_awarded ?? 0} ทอง!`,
      );
      if (awardResult?.lucky_drop) announceLuckyDrop(awardResult.lucky_drop);
      qc.invalidateQueries({ queryKey: ["my-attempts"] });
      qc.invalidateQueries({ queryKey: ["my-dq-attempts"] });
      qc.invalidateQueries({ queryKey: ["xp-transactions"] });
      qc.invalidateQueries({ queryKey: ["xp-summary"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["dq-progress", questId, user?.id] });
      onDone?.();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <>
      {questions.map((q, i) => {
        const fresh = perResults[i];
        const persisted = persistedResults[i];
        const saved = savedPerQ[i] ?? savedPerQ.find((x) => x?.idx === i);
        const result = fresh ?? persisted ?? saved;
        const isDone = !!result;
        const displayAnswer = fresh ? answers[i] : (persistedAnswers[i] ?? savedAns[i]);
        return (
          <QuestionCard
            key={`${questId || "quest"}-${i}`}
            quest={quest}
            question={q}
            index={i}
            total={questions.length}
            locked={locked}
            playerLevel={playerLevel}
            playerXp={playerXp}
            answer={answers[i] ?? ""}
            onAnswerChange={(v: string) => {
              const a = [...answers];
              a[i] = v;
              setAnswers(a);
            }}
            open={openIdx === i}
            onToggle={() => setOpenIdx((v) => (v === i ? null : i))}
            onSubmit={() => submitOne(i)}
            submitting={submittingIdx === i}
            done={isDone}
            result={result}
            savedAnswer={displayAnswer}
            hint={hints[i]}
            hintStock={tokenStock?.hint_token ?? 0}
            onUseHint={() => useHint(i)}
            hintLoading={hintLoadingIdx === i}
          />
        );
      })}
      {(attempt || awarded) && !locked && (tokenStock?.retry_token ?? 0) > 0 && (
        <div className="rounded-lg border border-purple-300/50 bg-purple-50 dark:bg-purple-950/20 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-purple-900 dark:text-purple-200">
            {tr("ใช้ Retry Token เพื่อทำ quest นี้ใหม่")} ({tokenStock?.retry_token} {tr("คงเหลือ")})
          </p>
          <Button size="sm" variant="outline" onClick={useRetry} disabled={retrying} className="shrink-0">
            {retrying ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="size-4 mr-2" />
            )}
            {tr("ทำใหม่")}
          </Button>
        </div>
      )}
      {/* placeholder-marker */}
      {canFinalize && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {tr(
              `ตอบแล้ว ${answeredCount}/${questions.length} ข้อ ส่งสรุปคะแนนได้เลย (ข้อที่ยังไม่ตอบจะได้ 0)`,
            )}
          </p>
          <Button size="sm" onClick={finalizePartial} disabled={finalizing} className="shrink-0">
            {finalizing ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Trophy className="size-4 mr-2" />
            )}
            {tr("ส่งและสรุปคะแนน")}
          </Button>
        </div>
      )}
    </>
  );
}

function QuestionCard({
  quest,
  question,
  index,
  total,
  locked,
  playerLevel,
  playerXp,
  answer,
  onAnswerChange,
  open,
  onToggle,
  onSubmit,
  submitting,
  done,
  result,
  savedAnswer,
  hint,
  hintStock,
  onUseHint,
  hintLoading,
}: {
  quest: DailyQuest;
  question: QuestQuestion;
  index: number;
  total: number;
  locked: boolean;
  playerLevel: number;
  playerXp: number;
  answer: string;
  onAnswerChange: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  onSubmit: () => void;
  submitting: boolean;
  done: boolean;
  result?: QuestGradeResult;
  savedAnswer?: string;
  hint?: string;
  hintStock?: number;
  onUseHint?: () => void;
  hintLoading?: boolean;
}) {
  // Per-question difficulty (fallback to quest difficulty)
  const diffKey = String(
    question.difficulty ?? question.difficulty_label ?? quest.difficulty ?? "medium",
  ).toLowerCase();
  const meta = difficultyMeta[diffKey] ?? difficultyMeta.medium;
  const estMinutes = 4;
  const minLevel = quest.min_level ?? 1;

  return (
    <Card
      className={`relative overflow-hidden transition-all duration-300 ${locked ? "bg-muted/30" : "hover:shadow-md"}`}
    >
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            className={`uppercase tracking-wide text-[10px] font-bold border ${meta.className}`}
          >
            {locked ? (
              <>
                <Lock className="size-3 mr-1" />
                Lv.{minLevel}+
              </>
            ) : (
              meta.label
            )}
          </Badge>
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`size-3.5 ${i < meta.stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="font-semibold leading-tight line-clamp-3 flex items-start gap-1.5">
            {done && result?.correct && <Check className="size-4 text-green-500 shrink-0 mt-0.5" />}
            {!done && !locked && <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />}
            <span>{question.question}</span>
          </h3>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            {quest.classrooms?.name ? `${quest.classrooms.name} • ` : ""}
            {tr("ข้อ")} {index + 1}/{total}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-primary font-medium">
              <Zap className="size-3.5" />+
              {Math.round((quest.max_xp_reward ?? 0) / Math.max(1, total))}
            </span>
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <Coins className="size-3.5" />+
              {Math.round((quest.max_gold_reward ?? 0) / Math.max(1, total))}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {estMinutes}m
            </span>
          </div>
          {locked ? (
            <Button size="sm" variant="outline" disabled className="gap-1">
              <Lock className="size-3" />
              Locked
            </Button>
          ) : done ? (
            <Button size="sm" variant="outline" onClick={onToggle} className="gap-1">
              <Check className="size-3.5 text-green-600" />
              {open ? tr("ซ่อน") : tr("ดูผล")}
            </Button>
          ) : (
            <Button size="sm" onClick={onToggle} className="gap-1">
              {open ? (
                <>
                  {tr("ซ่อน")} <ChevronDown className="size-3.5 rotate-180" />
                </>
              ) : (
                <>
                  Start <ChevronRight className="size-3.5" />
                </>
              )}
            </Button>
          )}
        </div>

        {locked && (
          <div className="rounded-md bg-muted/40 px-2.5 py-2 space-y-1">
            <Progress value={(playerLevel / minLevel) * 100} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ArrowUp className="size-3" />
              อีก {Math.max(0, minLevel - playerLevel)} เลเวล
            </p>
          </div>
        )}

        {open && !locked && !done && (
          <div className="pt-2 border-t space-y-2">
            <Textarea
              rows={3}
              value={answer}
              onChange={(e) => onAnswerChange(e.target.value)}
              placeholder={tr("พิมพ์คำตอบของคุณ...")}
            />
            <Button className="w-full" onClick={onSubmit} disabled={submitting || !answer.trim()}>
              {submitting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Trophy className="size-4 mr-2" />
              )}
              {tr("ส่งคำตอบ")}
            </Button>
            {total > 1 && (
              <p className="text-[11px] text-muted-foreground">
                {tr("AI จะตรวจข้อนี้ทันทีและให้คะแนนตามความใกล้เคียง (มีคะแนนบางส่วน)")}
              </p>
            )}
          </div>
        )}

        {open && done && (
          <div className="pt-2 border-t space-y-2 text-xs">
            {savedAnswer && (
              <p>
                <span className="text-muted-foreground">{tr("คำตอบของคุณ")}:</span> {savedAnswer}
              </p>
            )}
            {result && (
              <>
                <p className="flex items-start gap-1">
                  <span>{result.correct ? "✅" : "❌"}</span>
                  <span>
                    <b>
                      {result.score}/{result.max_score}
                    </b>
                    : {result.feedback}
                  </span>
                </p>
                {question.expected_answer && (
                  <p className="text-muted-foreground">
                    <span className="text-foreground/70">{tr("เฉลย")}:</span>{" "}
                    {question.expected_answer}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const difficultyMeta: Record<string, { stars: number; label: string; className: string }> = {
  very_easy: {
    stars: 1,
    label: "VERY EASY",
    className: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  ง่ายมาก: {
    stars: 1,
    label: "ง่ายมาก",
    className: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  easy: {
    stars: 2,
    label: "EASY",
    className: "bg-sky-100 text-sky-700 border-sky-200",
  },
  ง่าย: {
    stars: 2,
    label: "ง่าย",
    className: "bg-sky-100 text-sky-700 border-sky-200",
  },
  normal: { stars: 3, label: "MEDIUM", className: "bg-amber-100 text-amber-700 border-amber-200" },
  medium: { stars: 3, label: "MEDIUM", className: "bg-amber-100 text-amber-700 border-amber-200" },
  ปานกลาง: {
    stars: 3,
    label: "ปานกลาง",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  hard: { stars: 4, label: "HARD", className: "bg-orange-100 text-orange-700 border-orange-200" },
  ยาก: { stars: 4, label: "ยาก", className: "bg-orange-100 text-orange-700 border-orange-200" },
  expert: { stars: 5, label: "EXPERT", className: "bg-rose-100 text-rose-700 border-rose-200" },
  ยากมาก: { stars: 5, label: "ยากมาก", className: "bg-rose-100 text-rose-700 border-rose-200" },
};

export function QuestCard({
  quest,
  attempt,
  locked,
  playerLevel,
  playerXp,
  mode = "student",
  onDone,
}: {
  quest: DailyQuest;
  attempt?: QuestAttemptRow | null;
  locked: boolean;
  playerLevel: number;
  playerXp: number;
  mode?: "student" | "teacher";
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const meta =
    difficultyMeta[String(quest.difficulty ?? "medium").toLowerCase()] ?? difficultyMeta.medium;
  const questions = toQuestQuestions(quest.questions);
  const estMinutes = Math.max(5, questions.length * 4);
  const questId = quest.id ?? "";
  const minLevel = quest.min_level ?? 1;

  const [expanded, setExpanded] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CompletedQuestResult | null>(null);

  const isTeacher = mode === "teacher";

  async function submit() {
    setSubmitting(true);
    try {
      if (!questId) throw new Error(tr("ไม่พบ Quest"));
      const { data: graded, error } = await supabase.functions.invoke("grade-quest-answer", {
        body: { quest_id: questId, answers },
      });
      if (error) throw error;
      const gradeResponse = graded as GradeQuestResponse;
      const { data: award, error: e2 } = await supabase.rpc("award_quest_attempt", {
        _quest_id: questId,
        _answers: answers,
        _score: gradeResponse.total_score ?? 0,
        _max_score: gradeResponse.max_score ?? 0,
        _feedback: gradeResponse.overall_feedback ?? "",
        _per_question: (gradeResponse.results ?? []) as unknown as Json,
      });
      if (e2) throw e2;
      const awardResult = toAwardResult(award);
      setResult({ ...gradeResponse, ...(awardResult ?? {}) });
      toast.success(
        `ได้ ${awardResult?.xp_gained ?? 0} XP + ${awardResult?.gold_awarded ?? 0} ทอง!`,
      );
      if (awardResult?.lucky_drop) announceLuckyDrop(awardResult.lucky_drop);
      qc.invalidateQueries({ queryKey: ["my-attempts"] });
      qc.invalidateQueries({ queryKey: ["my-dq-attempts"] });
      qc.invalidateQueries({ queryKey: ["xp-transactions"] });
      qc.invalidateQueries({ queryKey: ["xp-summary"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      onDone?.();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      className={`relative overflow-hidden transition-all duration-300 ${locked ? "bg-muted/30" : "hover:shadow-md"}`}
    >
      <CardContent className="p-5 space-y-3">
        {/* Top row: difficulty + stars */}
        <div className="flex items-start justify-between gap-2">
          <Badge
            className={`uppercase tracking-wide text-[10px] font-bold border ${meta.className}`}
          >
            {locked ? (
              <>
                <Lock className="size-3 mr-1" />
                Lv.{minLevel}+
              </>
            ) : (
              meta.label
            )}
          </Badge>
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`size-3.5 ${i < meta.stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
              />
            ))}
          </div>
        </div>

        {/* Title + classroom */}
        <div className="space-y-1">
          <h3 className="font-semibold leading-tight line-clamp-2 flex items-start gap-1.5">
            {attempt && <Check className="size-4 text-green-500 shrink-0 mt-0.5" />}
            {!attempt && !locked && <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />}
            <span>{quest.title}</span>
          </h3>
          {quest.classrooms?.name && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              {quest.classrooms.name}
            </p>
          )}
          <p className="text-xs text-muted-foreground">AI-generated practice quest</p>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-primary font-medium">
              <Zap className="size-3.5" />+{quest.max_xp_reward}
            </span>
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <Coins className="size-3.5" />+{quest.max_gold_reward}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {estMinutes}m
            </span>
          </div>
          {isTeacher ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded((v) => !v)}
              className="gap-1"
            >
              <Users className="size-3.5" />
              {expanded ? tr("ซ่อน") : tr("ดูคำตอบนักเรียน")}
              <ChevronDown
                className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </Button>
          ) : locked ? (
            <Button size="sm" variant="outline" disabled className="gap-1">
              <Lock className="size-3" />
              Locked
            </Button>
          ) : attempt || result ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded((v) => !v)}
              className="gap-1"
            >
              <Check className="size-3.5 text-green-600" />
              {expanded ? tr("ซ่อน") : tr("ดูผล")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setExpanded((v) => !v)} className="gap-1">
              {expanded ? (
                <>
                  {tr("ซ่อน")} <ChevronDown className="size-3.5 rotate-180" />
                </>
              ) : (
                <>
                  Start <ChevronRight className="size-3.5" />
                </>
              )}
            </Button>
          )}
        </div>

        {/* Attempt summary */}
        {attempt && !expanded && (
          <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {tr("คะแนน")}{" "}
            <b className="text-foreground">
              {attempt.score}/{attempt.max_score}
            </b>{" "}
            • +{attempt.xp_awarded} XP • +{attempt.gold_awarded} {tr("ทอง")}
          </div>
        )}

        {/* Locked progress hint */}
        {locked && !isTeacher && (
          <div className="rounded-md bg-muted/40 px-2.5 py-2 space-y-1">
            <Progress value={(playerLevel / minLevel) * 100} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ArrowUp className="size-3" />
              อีก {Math.max(0, minLevel - playerLevel)} เลเวล หรือ{" "}
              {Math.max(0, (minLevel - playerLevel) * 100 - (playerXp % 100))} XP
            </p>
          </div>
        )}

        {/* EXPANDED CONTENT */}
        {expanded && !locked && (
          <div className="pt-2 border-t space-y-3">
            {isTeacher ? (
              <TeacherAnswersView questId={questId} questions={questions} />
            ) : attempt ? (
              <AttemptResultView attempt={attempt} questions={questions} />
            ) : result ? (
              <AttemptResultView
                attempt={{
                  score: result.total_score,
                  max_score: result.max_score,
                  xp_awarded: result.xp_gained,
                  gold_awarded: result.gold_awarded,
                  ai_feedback: result.overall_feedback,
                  per_question: result.results,
                  answers,
                  combo_applied: result.combo_applied,
                  multiplier_applied: result.multiplier_applied,
                  perfect_bonus: result.perfect_bonus,
                  lucky_drop: result.lucky_drop,
                }}
                questions={questions}
              />
            ) : (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">
                        {i + 1}. {q.question}
                      </p>
                      {q.difficulty_label && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {q.difficulty_label}
                        </Badge>
                      )}
                    </div>
                    <Textarea
                      rows={2}
                      value={answers[i] ?? ""}
                      onChange={(e) => {
                        const a = [...answers];
                        a[i] = e.target.value;
                        setAnswers(a);
                      }}
                      placeholder={tr("พิมพ์คำตอบของคุณ...")}
                    />
                  </div>
                ))}
                <Button className="w-full" onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Trophy className="size-4 mr-2" />
                  )}
                  {tr("ส่งให้ AI ตรวจ")}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttemptResultView({
  attempt,
  questions,
}: {
  attempt: QuestAttemptView;
  questions: QuestQuestion[];
}) {
  const score = attempt.score ?? 0;
  const maxScore = attempt.max_score ?? 0;
  const pct = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const tone = pct >= 80 ? "text-green-600" : pct >= 50 ? "text-amber-600" : "text-red-600";
  const per = toGradeResults(attempt.per_question ?? null);
  const ans = toStringArray(attempt.answers ?? null);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{tr("ความถูกต้อง")}</span>
          <span className={`text-2xl font-bold ${tone}`}>{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
        <p className="text-xs text-muted-foreground">
          {tr("คะแนน")} {score}/{maxScore} • +{attempt.xp_awarded ?? 0} XP • +
          {attempt.gold_awarded ?? 0} {tr("ทอง")}
        </p>
        {attempt.combo_applied ||
        attempt.multiplier_applied ||
        attempt.perfect_bonus ||
        attempt.lucky_drop ? (
          <div className="pt-1 space-y-2">
            {attempt.combo_applied ? (
              <ComboBadge combo={attempt.combo_applied} multiplier={attempt.multiplier_applied} />
            ) : null}
            <BonusBreakdown
              base={attempt.xp_awarded ?? 0}
              comboCount={attempt.combo_applied ?? 0}
              comboMultiplier={attempt.multiplier_applied}
              perfectBonus={attempt.perfect_bonus}
              luckyXp={attempt.lucky_drop?.kind === "xp" ? (attempt.lucky_drop.amount ?? 0) : 0}
              luckyGold={attempt.lucky_drop?.kind === "gold" ? (attempt.lucky_drop.amount ?? 0) : 0}
            />
          </div>
        ) : null}
        {attempt.ai_feedback && (
          <p className="italic text-xs text-muted-foreground pt-1">"{attempt.ai_feedback}"</p>
        )}
      </div>
      <div className="space-y-2">
        {questions.map((q, i) => {
          const r = per[i] ?? per.find((x) => x.idx === i);
          return (
            <div key={i} className="text-xs rounded border p-2 space-y-1">
              <p className="font-medium">
                {i + 1}. {q.question}
              </p>
              {ans[i] && (
                <p className="text-muted-foreground">
                  {tr("คำตอบ")}: {ans[i]}
                </p>
              )}
              {r && (
                <p className="flex items-start gap-1">
                  <span>{r.correct ? "✅" : "❌"}</span>
                  <span>
                    <b>
                      {r.score}/{r.max_score}
                    </b>
                    : {r.feedback}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeacherAnswersView({
  questId,
  questions,
}: {
  questId: string;
  questions: QuestQuestion[];
}) {
  const { data: attempts, isLoading } = useQuery({
    queryKey: ["quest-attempts", questId],
    queryFn: async () =>
      (
        await supabase
          .from("daily_quest_attempts")
          .select("*")
          .eq("quest_id", questId)
          .order("completed_at", { ascending: false })
      ).data ?? [],
  });
  const attemptList = (attempts ?? []) as QuestAttemptRow[];
  const userIds = Array.from(new Set(attemptList.map((a) => a.user_id)));
  const { data: profiles } = useQuery({
    queryKey: ["attempt-profiles", userIds.join(",")],
    queryFn: async () =>
      (await supabase.from("profiles").select("id,display_name").in("id", userIds)).data ?? [],
    enabled: userIds.length > 0,
  });
  const nameMap = Object.fromEntries(
    ((profiles ?? []) as ProfileNameRow[]).map((p) => [p.id, p.display_name || tr("นักเรียน")]),
  );

  if (isLoading) return <p className="text-xs text-muted-foreground">{tr("กำลังโหลด…")}</p>;
  if (!attempts || attempts.length === 0)
    return <p className="text-xs text-muted-foreground">{tr("ยังไม่มีนักเรียนทำเควสต์นี้")}</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {attempts.length} {tr("คนทำแล้ว")}
      </p>
      {attemptList.map((a) => {
        const pct = a.max_score ? Math.round((a.score / a.max_score) * 100) : 0;
        const per = toGradeResults(a.per_question ?? null);
        const ans = toStringArray(a.answers ?? null);
        return (
          <details key={a.id} className="rounded border bg-muted/20 group">
            <summary className="cursor-pointer p-2.5 flex items-center justify-between gap-2 text-sm list-none">
              <span className="font-medium truncate">
                {nameMap[a.user_id] ?? a.user_id.slice(0, 8)}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant={pct >= 80 ? "default" : pct >= 50 ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  {a.score}/{a.max_score} ({pct}%)
                </Badge>
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </div>
            </summary>
            <div className="px-2.5 pb-2.5 space-y-2">
              {a.ai_feedback && (
                <p className="italic text-xs text-muted-foreground">"{a.ai_feedback}"</p>
              )}
              {questions.map((q, i) => {
                const r = per[i] ?? per.find((x) => x.idx === i);
                return (
                  <div key={i} className="text-xs rounded border bg-background p-2 space-y-1">
                    <p className="font-medium">
                      {i + 1}. {q.question}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="text-foreground/70">{tr("คำตอบ")}:</span> {ans[i] || "—"}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="text-foreground/70">{tr("เฉลย")}:</span> {q.expected_answer}
                    </p>
                    {r && (
                      <p className="flex items-start gap-1">
                        <span>{r.correct ? "✅" : "❌"}</span>
                        <span>
                          <b>
                            {r.score}/{r.max_score}
                          </b>
                          : {r.feedback}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
