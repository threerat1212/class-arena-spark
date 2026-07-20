import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Award,
  Check,
  Flame,
  Gift,
  Sparkles,
  Star,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { tr } from "@/i18n";
import { ComboBadge } from "@/components/gamification/combo-badge";
import { MultiplierEventBanner } from "@/components/gamification/multiplier-event-banner";
import type { ComboStateRow, MultiplierEventRow } from "@/lib/gamification.types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type Mission = {
  label: string;
  detail: string;
  done: boolean;
  progress: number;
  reward: string;
  to: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isWithinDays(value: string | null | undefined, days: number) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function GamificationStatusPanel({
  profile,
  badgeCount = 0,
  achievementCount = 0,
}: {
  profile?: ProfileRow | null;
  badgeCount?: number;
  achievementCount?: number;
}) {
  const userId = profile?.id;
  const { data: comboState } = useQuery({
    queryKey: ["combo-state", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("combo_state")
        .select("*")
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return data as ComboStateRow | null;
    },
    enabled: !!userId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: activeEvent } = useQuery({
    queryKey: ["active-multiplier-event"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("multiplier_events")
        .select("*")
        .eq("is_active", true)
        .lte("starts_at", nowIso)
        .gte("ends_at", nowIso)
        .is("classroom_id", null)
        .order("multiplier", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as MultiplierEventRow | null;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const xp = profile?.xp ?? 0;
  const level = profile?.level ?? 1;
  const gold = profile?.gold ?? 0;
  const streak = profile?.streak_days ?? 0;
  const xpInLevel = xp % 100;
  const levelProgress = clampPct((xpInLevel / 100) * 100);
  const today = todayKey();
  const claimedBonus = profile?.last_login_bonus_date === today;
  const perfectStreak = profile?.perfect_streak ?? 0;
  const nextStreakMilestone = streak < 3 ? 3 : streak < 7 ? 7 : streak < 14 ? 14 : 30;
  const streakProgress = clampPct((streak / nextStreakMilestone) * 100);
  const questDoneThisWeek = isWithinDays(profile?.last_quest_date, 7);

  const missions: Mission[] = [
    {
      label: tr("เช็กอินรอบสัปดาห์นี้"),
      detail: claimedBonus ? tr("รับโบนัสวันนี้แล้ว") : tr("เริ่มรอบด้วยโบนัสเข้าใช้งาน"),
      done: claimedBonus,
      progress: claimedBonus ? 100 : 0,
      reward: "+Gold",
      to: "/weekly-missions",
    },
    {
      label: tr("ทำ Practice Quest"),
      detail: questDoneThisWeek ? tr("ทำ quest ในรอบนี้แล้ว") : tr("ทำหนึ่งโจทย์เพื่อดัน XP"),
      done: questDoneThisWeek,
      progress: questDoneThisWeek ? 100 : 0,
      reward: "+XP",
      to: "/weekly-missions",
    },
    {
      label: tr("ต่อ weekly streak ให้ถึง milestone"),
      detail: `${streak}/${nextStreakMilestone} ${tr("วัน")}`,
      done: streak >= nextStreakMilestone,
      progress: streakProgress,
      reward: `${nextStreakMilestone}d`,
      to: "/weekly-missions",
    },
  ];

  const completedMissions = missions.filter((m) => m.done).length;
  const nextUnlock =
    level < 5
      ? tr("ปลดล็อก practice quest ที่ยากขึ้นเมื่อถึง Lv.5")
      : achievementCount < 3
        ? tr("สะสม Achievement ให้ครบ 3 ชิ้นเพื่อดันโปรไฟล์รอบสัปดาห์")
        : tr("ดัน perfect streak เพื่อปลดล็อกฉายาระดับสูง");

  return (
    <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,var(--card),color-mix(in_oklch,var(--accent)_28%,var(--card)))]">
      <CardContent className="p-5 space-y-3">
        {(activeEvent || (comboState && comboState.current_combo > 0)) && (
          <div className="flex flex-wrap items-center gap-2">
            {activeEvent && (
              <MultiplierEventBanner
                event={activeEvent}
                className="flex-1 min-w-[200px]"
              />
            )}
            {comboState && comboState.current_combo > 0 && (
              <div className="inline-flex items-center gap-2">
                <ComboBadge combo={comboState.current_combo} />
                {comboState.max_combo > comboState.current_combo && (
                  <span className="text-xs text-muted-foreground">
                    {tr("สูงสุด")} ×{comboState.max_combo}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[1.05fr_1.4fr]">
        <div className="flex items-center gap-4">
          <div
            className="scholar-progress-ring grid size-28 shrink-0 place-items-center rounded-full p-2"
            style={{
              background: `conic-gradient(var(--xp) ${levelProgress}%, color-mix(in oklch, var(--muted) 75%, transparent) 0)`,
            }}
            aria-label={`${levelProgress}% ${tr("ความคืบหน้าเลเวล")}`}
          >
            <div className="grid size-full place-items-center rounded-full bg-card text-center">
              <div>
                <p className="text-xs text-muted-foreground">Lv.</p>
                <p className="font-display text-3xl font-semibold">{level}</p>
              </div>
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl">{tr("Weekly Pulse")}</h2>
                <Badge variant="outline" className="gap-1">
                  <Flame className="size-3.5 text-orange-500" />
                  {streak} {tr("วัน")}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {xpInLevel}/100 XP {tr("เพื่อไปยังเลเวล")} {level + 1}
              </p>
            </div>
            <Progress value={levelProgress} className="h-2.5" />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <PulseStat
                icon={<Zap className="size-3.5" />}
                label="XP"
                value={xp.toLocaleString()}
              />
              <PulseStat
                icon={<Gift className="size-3.5" />}
                label={tr("ทอง")}
                value={gold.toLocaleString()}
                reward
              />
              <PulseStat
                icon={<Award className="size-3.5" />}
                label={tr("ตรา")}
                value={`${badgeCount}/${achievementCount}`}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg">{tr("Weekly Mission Board")}</p>
              <p className="text-sm text-muted-foreground">{nextUnlock}</p>
            </div>
            <Badge className="shrink-0 gap-1">
              <Target className="size-3.5" />
              {completedMissions}/{missions.length}
            </Badge>
          </div>
          <div className="grid gap-2">
            {missions.map((mission) => (
              <Link
                key={mission.label}
                to={mission.to}
                className="group rounded-lg border bg-card/80 p-3 transition-colors hover:border-primary/45 hover:bg-secondary/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-md ${
                        mission.done
                          ? "scholar-complete-cue bg-primary text-primary-foreground"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {mission.done ? (
                        <Check className="size-4" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{mission.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{mission.detail}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        mission.reward === "+Gold"
                          ? "scholar-reward-cue border-[color:var(--gold)]/40 text-[color:var(--gold)]"
                          : undefined
                      }
                    >
                      {mission.reward}
                    </Badge>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
                <Progress value={mission.progress} className="mt-2 h-1.5" />
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/70 px-3 py-2">
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Trophy className="size-4 text-primary" />
              Perfect streak: {perfectStreak}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to="/rewards">
                {tr("ดูรางวัล")}
                <Star className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}

function PulseStat({
  icon,
  label,
  value,
  reward = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  reward?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-card/80 px-2.5 py-2 ${
        reward
          ? "border-[color:var(--gold)]/35 bg-[color-mix(in_oklch,var(--gold)_8%,var(--card))]"
          : ""
      }`}
    >
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 truncate font-semibold">{value}</p>
    </div>
  );
}
