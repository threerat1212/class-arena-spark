import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown, Trophy, Flame, Zap, Coins, Medal, Sparkles, Star, RefreshCw } from "lucide-react";
import { useTr } from "@/lib/tr";
import { cn } from "@/lib/utils";
import { ColoredName, frameRingClass } from "@/lib/cosmetics";

function RefreshButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      className="relative z-10 gap-1.5 text-xs"
    >
      <RefreshCw className="size-3.5" />
      {label}
    </Button>
  );
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  level: number;
  xp: number;
  gold: number;
  streak_days: number;
  active_title_id: string | null;
  active_frame_code: string | null;
  active_name_color: string | null;
};

type EnrichedProfile = ProfileRow & {
  title_name: string | null;
  badge_count: number;
  ach_count: number;
};
type TitleNameRow = { id: string; name: string | null };
type UserBadgeCountRow = { user_id: string };
type UserAchievementCountRow = { user_id: string };
type ClassroomSummaryRow = {
  classrooms: { id: string; name: string; subject: string | null } | null;
};
type ClassroomScoreRow = {
  user_id: string;
  xp: number | null;
  streak_days: number | null;
  perfect_scores: number | null;
};
type ClassroomGradeRow = { classrooms: { grade_level: string | null } | null };
type ClassroomIdRow = { id: string };

async function enrichProfiles(profiles: ProfileRow[]): Promise<EnrichedProfile[]> {
  if (profiles.length === 0) return [];
  const ids = profiles.map((p) => p.id);
  const titleIds = profiles.map((p) => p.active_title_id).filter(Boolean) as string[];

  const [titlesRes, badgesRes, achRes] = await Promise.all([
    titleIds.length
      ? supabase.from("titles").select("id, name").in("id", titleIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("user_badges").select("user_id").in("user_id", ids),
    supabase.from("user_achievements").select("user_id").in("user_id", ids),
  ]);

  const titleMap = new Map(
    ((titlesRes.data ?? []) as TitleNameRow[]).map((title) => [title.id, title.name]),
  );
  const badgeCount = new Map<string, number>();
  ((badgesRes.data ?? []) as UserBadgeCountRow[]).forEach((badge) =>
    badgeCount.set(badge.user_id, (badgeCount.get(badge.user_id) ?? 0) + 1),
  );
  const achCount = new Map<string, number>();
  ((achRes.data ?? []) as UserAchievementCountRow[]).forEach((achievement) =>
    achCount.set(achievement.user_id, (achCount.get(achievement.user_id) ?? 0) + 1),
  );

  return profiles.map((p) => ({
    ...p,
    title_name: p.active_title_id ? (titleMap.get(p.active_title_id) ?? null) : null,
    badge_count: badgeCount.get(p.id) ?? 0,
    ach_count: achCount.get(p.id) ?? 0,
  }));
}

/* -------- Podium for top 3 -------- */
function Podium({ players, highlightId }: { players: EnrichedProfile[]; highlightId?: string }) {
  const tr = useTr();
  // Re-order to [2nd, 1st, 3rd] for visual podium
  const order = [players[1], players[0], players[2]].filter(Boolean);
  const heights = ["h-24", "h-32", "h-20"];
  const ranks = [2, 1, 3];
  const ringColors = ["ring-zinc-300 dark:ring-zinc-400", "ring-yellow-400", "ring-amber-600"];
  const bgGradients = [
    "bg-zinc-100/80 dark:bg-zinc-800/70",
    "bg-amber-100/80 dark:bg-amber-900/40",
    "bg-orange-100/80 dark:bg-orange-900/35",
  ];

  return (
    <div className="flex items-end justify-center gap-3 px-2 pt-4 pb-2">
      {order.map((p, idx) => {
        const realRank = ranks[idx];
        const isMe = p.id === highlightId;
        return (
          <div key={p.id} className="flex-1 flex flex-col items-center gap-2 max-w-[33%]">
            <div className="relative">
              {realRank === 1 && (
                <Crown className="absolute -top-5 left-1/2 -translate-x-1/2 size-5 text-yellow-500 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
              )}
              <Avatar
                className={cn(
                  "size-14 ring-4 ring-offset-2 ring-offset-background",
                  p.active_frame_code ? frameRingClass(p.active_frame_code) : ringColors[idx],
                  realRank === 1 && "size-16",
                )}
              >
                <AvatarImage src={p.avatar_url ?? undefined} />
                <AvatarFallback className="bg-primary/10 font-semibold">
                  {p.display_name?.[0] ?? "?"}
                </AvatarFallback>
              </Avatar>
              {isMe && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                  {tr("คุณ")}
                </span>
              )}
            </div>
            <div className="text-center min-w-0 w-full">
              <p className="text-xs font-semibold truncate px-1">
                {p.display_name ?? tr("ผู้ใช้")}
              </p>
              {p.title_name && (
                <p className="text-[10px] text-muted-foreground truncate px-1">👑 {p.title_name}</p>
              )}
            </div>
            <div
              className={cn(
                "w-full rounded-t-lg border-t flex flex-col items-center justify-start pt-2 gap-0.5",
                heights[idx],
                bgGradients[idx],
                realRank === 1
                  ? "border-yellow-400"
                  : realRank === 2
                    ? "border-zinc-300"
                    : "border-amber-600",
              )}
            >
              <span
                className={cn(
                  "font-display font-bold leading-none",
                  realRank === 1 ? "text-2xl" : "text-xl",
                )}
              >
                #{realRank}
              </span>
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold">
                <Zap className="size-3" /> {p.xp.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">Lv {p.level}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------- Compact ranks for #4+ -------- */
function MiniRow({
  p,
  rank,
  isMe,
  tr,
}: {
  p: EnrichedProfile;
  rank: number;
  isMe: boolean;
  tr: (s: string) => string;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
        isMe ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-accent/40",
      )}
    >
      <span className="font-display text-sm font-bold text-muted-foreground w-6 text-center">
        #{rank}
      </span>
      <Avatar className="size-8">
        <AvatarImage src={p.avatar_url ?? undefined} />
        <AvatarFallback className="text-xs">{p.display_name?.[0] ?? "?"}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{p.display_name ?? tr("ผู้ใช้")}</span>
          {isMe && <Badge className="text-[9px] py-0 px-1.5 h-4">{tr("คุณ")}</Badge>}
        </div>
        {p.title_name && (
          <p className="text-[10px] text-muted-foreground truncate">👑 {p.title_name}</p>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
        <span className="inline-flex items-center gap-0.5 font-semibold text-foreground">
          <Zap className="size-3" />
          {p.xp.toLocaleString()}
        </span>
        <span className="hidden sm:inline-flex items-center gap-0.5">
          <Flame className="size-3" />
          {p.streak_days}
        </span>
      </div>
    </li>
  );
}

/* -------- Showcase shell card (hero look) -------- */
function ShowcaseShell({
  variant,
  icon,
  eyebrow,
  title,
  subtitle,
  badge,
  children,
}: {
  variant: "hall" | "leader";
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tint = variant === "hall" ? "bg-amber-500/10" : "bg-primary/10";
  const ring = variant === "hall" ? "ring-yellow-500/30" : "ring-primary/30";

  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-card ring-1", ring)}>
      <div className={cn("absolute inset-x-0 top-0 h-24 pointer-events-none", tint)} />
      <div className="absolute top-4 right-4 opacity-20 pointer-events-none">
        <Sparkles className="size-16" />
      </div>
      <div className="relative p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "size-11 rounded-xl grid place-items-center",
                variant === "hall"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  : "bg-primary/10 text-primary",
              )}
            >
              {icon}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
              <h3 className="font-display text-xl lg:text-2xl leading-tight">{title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>
          {badge}
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------- Hall of Fame: per classroom -------- */
export function ClassroomHallOfFame({ userId }: { userId: string }) {
  const tr = useTr();

  const { data: classrooms } = useQuery({
    queryKey: ["my-classrooms-showcase", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("classroom_members")
        .select("classroom_id, classrooms(id, name, subject)")
        .eq("user_id", userId);
      return ((data ?? []) as ClassroomSummaryRow[])
        .map((member) => member.classrooms)
        .filter(Boolean) as Array<{
        id: string;
        name: string;
        subject: string | null;
      }>;
    },
  });

  return (
    <ShowcaseShell
      variant="hall"
      icon={<Crown className="size-6" />}
      eyebrow="HALL OF FAME"
      title={tr("ดาวเด่นในห้องเรียน")}
      subtitle={tr("อันดับสมาชิกในห้องเรียนของคุณ")}
    >
      {!classrooms || classrooms.length === 0 ? (
        <div className="text-center py-8">
          <Crown className="size-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground mb-3">{tr("ยังไม่ได้เข้าห้องเรียน")}</p>
          <Link
            to="/classrooms"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            {tr("เข้าร่วมห้องเรียน")}
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {classrooms.map((c) => (
            <ClassroomTop key={c.id} classroom={c} userId={userId} />
          ))}
        </div>
      )}
    </ShowcaseShell>
  );
}

function ClassroomTop({
  classroom,
  userId,
}: {
  classroom: { id: string; name: string; subject: string | null };
  userId: string;
}) {
  const tr = useTr();
  const {
    data: top,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["classroom-top", classroom.id],
    queryFn: async () => {
      const { data: scores } = await supabase
        .from("classroom_scores")
        .select("user_id, xp, streak_days, perfect_scores")
        .eq("classroom_id", classroom.id)
        .order("xp", { ascending: false })
        .limit(5);
      const scoreRows = (scores ?? []) as ClassroomScoreRow[];
      const uids = scoreRows.map((score) => score.user_id);
      if (uids.length === 0) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select(
          "id, display_name, avatar_url, level, xp, gold, streak_days, active_title_id, active_frame_code, active_name_color",
        )
        .in("id", uids);
      const profileMap = new Map(((profs ?? []) as ProfileRow[]).map((p) => [p.id, p]));
      const ordered = scoreRows
        .map((score) => {
          const p = profileMap.get(score.user_id);
          return p
            ? { ...p, xp: score.xp ?? 0, streak_days: score.streak_days ?? p.streak_days }
            : null;
        })
        .filter(Boolean) as ProfileRow[];
      return enrichProfiles(ordered);
    },
  });

  return (
    <div className="rounded-xl bg-background/60 backdrop-blur p-3 border">
      <div className="flex items-center justify-between mb-1 px-1">
        <p className="font-display text-sm font-semibold flex items-center gap-1.5">
          <Star className="size-3.5 text-yellow-500" />
          {classroom.name}
          {classroom.subject && (
            <span className="text-xs font-normal text-muted-foreground">· {classroom.subject}</span>
          )}
        </p>
        <RefreshButton
          onClick={() => refetch()}
          label={isFetching ? tr("กำลังรีเฟรช") : tr("รีเฟรช")}
        />
      </div>
      {!top || top.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{tr("ยังไม่มีสมาชิก")}</p>
      ) : (
        <>
          {top.length >= 1 && <Podium players={top.slice(0, 3)} highlightId={userId} />}
          {top.length > 3 && (
            <ul className="space-y-1 mt-2">
              {top.slice(3).map((p, i) => (
                <MiniRow key={p.id} p={p} rank={i + 4} isMe={p.id === userId} tr={tr} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* -------- Leaderboard by grade level (derived from classroom membership) -------- */
export function GradeLeaderboard({ userId }: { userId: string }) {
  const tr = useTr();
  const qc = useQueryClient();

  // 1) Find a grade_level from any classroom the user belongs to (owner or member)
  const { data: gradeLevel } = useQuery({
    queryKey: ["my-grade-level", userId],
    queryFn: async () => {
      const { data: owned } = await supabase
        .from("classrooms")
        .select("grade_level")
        .eq("owner_id", userId)
        .not("grade_level", "is", null)
        .limit(1);
      if (owned && owned[0]?.grade_level) return owned[0].grade_level as string;
      const { data: mem } = await supabase
        .from("classroom_members")
        .select("classrooms(grade_level)")
        .eq("user_id", userId);
      const g = ((mem ?? []) as ClassroomGradeRow[])
        .map((member) => member.classrooms?.grade_level)
        .find((x) => !!x);
      return (g as string | undefined) ?? null;
    },
  });

  // 2) Find all users that are in classrooms sharing this grade_level
  const { data: top } = useQuery({
    queryKey: ["grade-leaderboard", gradeLevel],
    queryFn: async () => {
      if (!gradeLevel) return [];
      const { data: rooms } = await supabase
        .from("classrooms")
        .select("id")
        .eq("grade_level", gradeLevel);
      const roomIds = ((rooms ?? []) as ClassroomIdRow[]).map((room) => room.id);
      if (roomIds.length === 0) return [];
      const { data: scores } = await supabase
        .from("classroom_scores")
        .select("user_id, xp, streak_days, perfect_scores")
        .in("classroom_id", roomIds);
      const scoreMap = new Map<
        string,
        { xp: number; streak_days: number; perfect_scores: number }
      >();
      ((scores ?? []) as ClassroomScoreRow[]).forEach((score) => {
        const current = scoreMap.get(score.user_id) ?? {
          xp: 0,
          streak_days: 0,
          perfect_scores: 0,
        };
        scoreMap.set(score.user_id, {
          xp: current.xp + (score.xp ?? 0),
          streak_days: Math.max(current.streak_days, score.streak_days ?? 0),
          perfect_scores: current.perfect_scores + (score.perfect_scores ?? 0),
        });
      });
      const userIds = Array.from(scoreMap.keys());
      if (userIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select(
          "id, display_name, avatar_url, level, xp, gold, streak_days, active_title_id, active_frame_code, active_name_color",
        )
        .in("id", userIds);
      const rows = ((data ?? []) as ProfileRow[])
        .map((p) => {
          const score = scoreMap.get(p.id);
          return score
            ? { ...p, xp: score.xp, streak_days: score.streak_days || p.streak_days }
            : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b?.xp ?? 0) - (a?.xp ?? 0))
        .slice(0, 10) as ProfileRow[];
      return enrichProfiles(rows);
    },
    enabled: !!gradeLevel,
  });

  return (
    <ShowcaseShell
      variant="leader"
      icon={<Trophy className="size-6" />}
      eyebrow="LEADERBOARD"
      title={tr("แชมป์สายชั้น")}
      subtitle={tr("อันดับนักเรียนในสายชั้นเดียวกัน")}
      badge={
        <div className="flex items-center gap-2">
          {gradeLevel ? (
            <Badge variant="secondary" className="font-semibold">
              {gradeLevel}
            </Badge>
          ) : null}
          <RefreshButton
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["grade-leaderboard"] });
              qc.invalidateQueries({ queryKey: ["my-grade-level", userId] });
            }}
            label={tr("รีเฟรช")}
          />
        </div>
      }
    >
      {!gradeLevel ? (
        <div className="text-center py-8">
          <Trophy className="size-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground mb-1">
            {tr("ยังไม่ได้ตั้งสายชั้นของห้องเรียน")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr("ให้ครูประจำห้องตั้งสายชั้นในหน้าห้องเรียน")}
          </p>
        </div>
      ) : !top || top.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{tr("ยังไม่มีข้อมูล")}</p>
      ) : (
        <>
          <Podium players={top.slice(0, 3)} highlightId={userId} />
          {top.length > 3 && (
            <ul className="space-y-1 mt-3">
              {top.slice(3).map((p, i) => (
                <MiniRow key={p.id} p={p} rank={i + 4} isMe={p.id === userId} tr={tr} />
              ))}
            </ul>
          )}
          {(() => {
            const myRank = top.findIndex((p) => p.id === userId);
            return myRank >= 0 ? (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 p-3">
                <span className="text-xs font-semibold text-muted-foreground">
                  {tr("อันดับของคุณ")}
                </span>
                <span className="font-display text-2xl font-bold text-primary">#{myRank + 1}</span>
              </div>
            ) : null;
          })()}
        </>
      )}
    </ShowcaseShell>
  );
}

/* unused exports kept for compat */
export const _Medal = Medal;
export const _Coins = Coins;
