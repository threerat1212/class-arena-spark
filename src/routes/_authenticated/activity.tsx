import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Zap,
  CalendarCheck,
  Target,
  Sparkles,
  Trophy,
  Coins,
  Gift,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchXpTransactions,
  fetchXpSummary,
  type XpSource,
  type TimeRange,
  type XpCursor,
} from "@/lib/xp-transactions.functions";
import { tr } from "@/i18n";
import { useAuth } from "@/hooks/use-auth";

const SOURCE_META: Record<XpSource, { icon: LucideIcon; label: string }> = {
  daily_quest: { icon: Sparkles, label: tr("ควอสต์") },
  attendance: { icon: CalendarCheck, label: tr("มาเรียน") },
  weekly_mission: { icon: Target, label: tr("ภารกิจ") },
  daily_bonus: { icon: Gift, label: tr("โบนัส") },
  achievement: { icon: Trophy, label: tr("ความสำเร็จ") },
  shop_purchase: { icon: Coins, label: tr("ร้านค้า") },
  admin_adjustment: { icon: Zap, label: tr("ปรับปรุง") },
};

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: tr("วันนี้") },
  { value: "week", label: tr("สัปดาห์") },
  { value: "month", label: tr("เดือน") },
  { value: "all", label: tr("ทั้งหมด") },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<TimeRange>("week");
  const [sourceFilter, setSourceFilter] = useState<XpSource | null>(null);

  // useAuth().user is a Supabase User without xp/level; fetch profile row.
  const { data: profile } = useQuery({
    queryKey: ["me-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("xp, level")
        .eq("id", user!.id)
        .maybeSingle();
      return data as { xp: number; level: number } | null;
    },
    enabled: !!user,
  });

  const summaryQuery = useQuery({
    queryKey: ["xp-summary", range],
    queryFn: () => fetchXpSummary(range),
  });

  const transactionsQuery = useInfiniteQuery({
    queryKey: ["xp-transactions", { source: sourceFilter, range, infinite: true }],
    queryFn: ({ pageParam }) =>
      fetchXpTransactions({
        limit: 20,
        source: sourceFilter,
        range,
        cursor: pageParam as XpCursor | undefined,
      }),
    initialPageParam: undefined as XpCursor | undefined,
    getNextPageParam: (lastPage) => {
      const rows = lastPage.data ?? [];
      if (rows.length < 20) return undefined;
      const last = rows[rows.length - 1];
      return { created_at: last.created_at, id: last.id };
    },
  });

  const allRows = transactionsQuery.data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const summary = summaryQuery.data?.data;
  const totalXp = profile?.xp ?? 0;
  const xpInLevel = totalXp % 100;
  const level = profile?.level ?? 1;

  return (
    <div className="container max-w-3xl py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tr("📜 บันทึกกิจกรรม")}</h1>
        <p className="text-sm text-muted-foreground">{tr("ดูประวัติ XP ทุกครั้งที่คุณได้รับ")}</p>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {tr("ระดับ")} {level}
            </span>
            <span className="text-sm text-[var(--xp)] font-semibold">
              {summary?.totalXp ?? 0} XP
            </span>
          </div>
          <Progress value={xpInLevel} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            {tr("อีก")} {100 - xpInLevel} XP {tr("ถึงระดับถัดไป")}
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-1 flex-wrap">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={range === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant={sourceFilter === null ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSourceFilter(null)}
          >
            {tr("ทั้งหมด")}
          </Button>
          {(Object.keys(SOURCE_META) as XpSource[]).map((src) => {
            const meta = SOURCE_META[src];
            const Icon = meta.icon;
            return (
              <Button
                key={src}
                variant={sourceFilter === src ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSourceFilter(src)}
                className="gap-1"
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("รายการ")}</CardTitle>
        </CardHeader>
        <CardContent>
          {allRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {tr("ยังไม่มีกิจกรรมในช่วงเวลานี้")}
            </p>
          ) : (
            <div className="space-y-1">
              {allRows.map((row) => {
                const meta = SOURCE_META[row.source] ?? SOURCE_META.admin_adjustment;
                const Icon = meta.icon;
                const isNegative = row.amount < 0;
                return (
                  <div
                    key={row.id}
                    className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0"
                  >
                    <div className="mt-0.5 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{row.source_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(row.created_at)}
                        {row.subject ? ` • ${row.subject}` : ""}
                      </p>
                    </div>
                    <Badge
                      variant={isNegative ? "destructive" : "secondary"}
                      className={isNegative ? "" : "text-[var(--xp)] bg-[var(--xp)]/10"}
                    >
                      {isNegative ? "" : "+"}
                      {row.amount} XP
                    </Badge>
                  </div>
                );
              })}

              {transactionsQuery.hasNextPage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => transactionsQuery.fetchNextPage()}
                  disabled={transactionsQuery.isFetchingNextPage}
                >
                  {transactionsQuery.isFetchingNextPage ? tr("กำลังโหลด...") : tr("โหลดเพิ่ม")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
