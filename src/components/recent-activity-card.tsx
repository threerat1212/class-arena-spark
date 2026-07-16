import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Zap,
  CalendarCheck,
  Target,
  Sparkles,
  Trophy,
  Coins,
  Gift,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchXpTransactions } from "@/lib/xp-transactions.functions";
import type { XpSource } from "@/lib/xp-transactions.functions";
import { tr } from "@/i18n";

const SOURCE_META: Record<XpSource, { icon: LucideIcon; label: string }> = {
  daily_quest: { icon: Sparkles, label: tr("ควอสต์") },
  attendance: { icon: CalendarCheck, label: tr("มาเรียน") },
  weekly_mission: { icon: Target, label: tr("ภารกิจ") },
  daily_bonus: { icon: Gift, label: tr("โบนัส") },
  achievement: { icon: Trophy, label: tr("ความสำเร็จ") },
  shop_purchase: { icon: Coins, label: tr("ร้านค้า") },
  admin_adjustment: { icon: Zap, label: tr("ปรับปรุง") },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return tr("เมื่อวาน");
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
}

export function RecentActivityCard() {
  const { data } = useQuery({
    queryKey: ["xp-transactions", { limit: 5 }],
    queryFn: () => fetchXpTransactions({ limit: 5 }),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">📜 {tr("กิจกรรมล่าสุด")}</CardTitle>
        <Link
          to="/activity"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center"
        >
          {tr("ดูทั้งหมด")}
          <ChevronRight className="ml-0.5 h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            {tr("ยังไม่มีกิจกรรม — ทำควอสต์หรือมาเรียนเพื่อเริ่มสะสม XP!")}
          </p>
        ) : (
          rows.map((row) => {
            const meta = SOURCE_META[row.source] ?? SOURCE_META.admin_adjustment;
            const Icon = meta.icon;
            const isNegative = row.amount < 0;
            return (
              <div
                key={row.id}
                className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{row.source_label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      isNegative
                        ? "text-xs text-destructive font-medium"
                        : "text-xs text-[var(--xp)] font-medium"
                    }
                  >
                    {isNegative ? "" : "+"}
                    {row.amount} XP
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTime(row.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
