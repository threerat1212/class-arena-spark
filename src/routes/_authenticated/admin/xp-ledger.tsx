import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { tr } from "@/i18n";
import { Sparkles, Flame, Trophy, Gift } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/xp-ledger")({
  component: XpLedgerPage,
});

type LedgerRow = {
  id: string;
  user_id: string;
  amount: number;
  source: string;
  source_label: string;
  balance_after: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ComboRow = {
  user_id: string;
  current_combo: number;
  max_combo: number;
  last_success_at: string | null;
};

type LuckyRow = {
  id: string;
  user_id: string;
  reward_kind: string;
  reward_amount: number | null;
  status: string;
  created_at: string;
};

function XpLedgerPage() {
  const { hasRole, loading } = useAuth();

  const { data: profileMap = {} } = useQuery({
    queryKey: ["admin-xp-ledger-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, xp, level");
      if (error) throw error;
      const map: Record<string, { display_name: string | null }> = {};
      for (const p of data ?? []) map[p.id as string] = { display_name: p.display_name };
      return map;
    },
    enabled: hasRole("admin"),
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ["admin-xp-ledger"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("xp_transactions")
        .select("id, user_id, amount, source, source_label, balance_after, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    enabled: hasRole("admin"),
    refetchInterval: 5000,
  });

  const { data: combos = [] } = useQuery({
    queryKey: ["admin-combo-leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("combo_state")
        .select("user_id, current_combo, max_combo, last_success_at")
        .order("max_combo", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ComboRow[];
    },
    enabled: hasRole("admin"),
    refetchInterval: 10000,
  });

  const { data: lucky = [] } = useQuery({
    queryKey: ["admin-lucky-drops"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lucky_drop_log")
        .select("id, user_id, reward_kind, reward_amount, status, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as LuckyRow[];
    },
    enabled: hasRole("admin"),
    refetchInterval: 10000,
  });

  if (loading) return null;
  if (!hasRole("admin")) return <Navigate to="/dashboard" />;

  const nameOf = (uid: string) =>
    profileMap[uid]?.display_name || profileMap[uid]?.username || uid.slice(0, 8);

  return (
    <div className="container mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{tr("XP Ledger & Combo")}</h1>
      </div>

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">
            <Sparkles className="mr-1 h-4 w-4" />
            {tr("รายการ XP ล่าสุด")}
          </TabsTrigger>
          <TabsTrigger value="combo">
            <Flame className="mr-1 h-4 w-4" />
            {tr("Combo Leaderboard")}
          </TabsTrigger>
          <TabsTrigger value="lucky">
            <Gift className="mr-1 h-4 w-4" />
            {tr("Lucky Drops")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr("100 รายการล่าสุด (refresh อัตโนมัติทุก 5 วินาที)")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[520px]">
                <div className="space-y-2">
                  {ledger.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {tr("ยังไม่มีรายการ")}
                    </p>
                  )}
                  {ledger.map((r) => {
                    const bd = (r.metadata?.bonus_breakdown ?? null) as
                      | {
                          base?: number;
                          combo_multiplier?: number;
                          combo_count?: number;
                          event_multiplier?: number;
                          outcome?: string;
                        }
                      | null;
                    return (
                      <div
                        key={r.id}
                        className="flex flex-col gap-1 rounded-md border p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{r.source}</Badge>
                          <span className="font-medium">{nameOf(r.user_id)}</span>
                          <span className="text-muted-foreground">
                            {r.source_label}
                          </span>
                          {bd?.outcome === "perfect" && (
                            <Badge className="bg-yellow-500 text-white">
                              <Trophy className="mr-1 h-3 w-3" />
                              perfect
                            </Badge>
                          )}
                          {bd?.combo_count && bd.combo_count >= 3 && (
                            <Badge variant="secondary">
                              <Flame className="mr-1 h-3 w-3" />
                              x{bd.combo_count}
                            </Badge>
                          )}
                          {bd?.event_multiplier && bd.event_multiplier > 1 && (
                            <Badge className="bg-purple-500 text-white">
                              ×{bd.event_multiplier}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <span
                            className={
                              r.amount >= 0
                                ? "font-mono font-bold text-green-600"
                                : "font-mono font-bold text-red-600"
                            }
                          >
                            {r.amount >= 0 ? "+" : ""}
                            {r.amount} XP
                          </span>
                          <span className="w-20 text-right font-mono text-xs text-muted-foreground">
                            = {r.balance_after}
                          </span>
                          <span className="w-32 text-right text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString("th-TH")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="combo">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tr("Top 20 Max Combo")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {combos.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {tr("ยังไม่มี combo")}
                  </p>
                )}
                {combos.map((c, i) => (
                  <div
                    key={c.user_id}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="w-8 justify-center">
                        #{i + 1}
                      </Badge>
                      <span className="font-medium">{nameOf(c.user_id)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-orange-500 text-white">
                        <Flame className="mr-1 h-3 w-3" />
                        {tr("สูงสุด")} {c.max_combo}
                      </Badge>
                      <Badge variant="secondary">
                        {tr("ปัจจุบัน")} {c.current_combo}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lucky">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr("Lucky Drops ล่าสุด 30 รายการ")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {lucky.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {tr("ยังไม่มี lucky drop")}
                  </p>
                )}
                {lucky.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-pink-500" />
                      <span className="font-medium">{nameOf(l.user_id)}</span>
                      <Badge variant="outline">{l.reward_kind}</Badge>
                      {l.reward_amount !== null && (
                        <span className="font-mono">+{l.reward_amount}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={l.status === "granted" ? "default" : "secondary"}
                      >
                        {l.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(l.created_at).toLocaleString("th-TH")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
