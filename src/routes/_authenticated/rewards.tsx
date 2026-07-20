import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Coins,
  Lock,
  Check,
  Trophy,
  ShoppingBag,
  Award,
  Crown,
  Star,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import type { MultiplierEventRow, LuckyDropLogRow } from "@/lib/gamification.types";

import { tr } from "@/i18n";
export const Route = createFileRoute("/_authenticated/rewards")({ component: RewardsPage });

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type AchievementRow = Database["public"]["Tables"]["achievements"]["Row"];
type ClaimAchievementResult = {
  name?: string;
  xp_bonus?: number;
  gold_bonus?: number;
  title_granted?: boolean;
};
type ShopItemRow = Database["public"]["Tables"]["shop_items"]["Row"];
type PurchaseShopResult = { item?: string };
type TitleRelation = Pick<
  Database["public"]["Tables"]["titles"]["Row"],
  "id" | "name" | "description" | "code"
>;
type UserTitleWithTitle = Pick<Database["public"]["Tables"]["user_titles"]["Row"], "title_id"> & {
  titles?: TitleRelation | null;
};
type BadgeRow = Database["public"]["Tables"]["badges"]["Row"];

function getErrorMessage(error: unknown, fallback = tr("เกิดข้อผิดพลาด")) {
  return error instanceof Error ? error.message : fallback;
}

const rarityStyle: Record<string, string> = {
  common: "bg-slate-100 text-slate-700 border-slate-300",
  rare: "bg-blue-100 text-blue-800 border-blue-300",
  epic: "bg-purple-100 text-purple-800 border-purple-300",
  legendary: "bg-amber-100 text-amber-900 border-amber-300",
};

function RewardsPage() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () =>
      (await supabase.from("profiles").select("*").eq("id", user!.id).single()).data,
    enabled: !!user,
  });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10 space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl">{tr("รางวัล & ความสำเร็จ")}</h1>
          <p className="text-muted-foreground mt-1">
            {tr("สะสมเหรียญตรา ปลดล็อก Achievement และซื้อฉายาเท่จากร้านค้า")}
          </p>
        </div>
        <Badge variant="outline" className="text-base px-3 py-1.5 gap-1.5">
          <Coins className="size-4 text-amber-500" /> {profile?.gold ?? 0} ทอง
        </Badge>
      </header>

      <Tabs defaultValue="achievements">
        <TabsList>
          <TabsTrigger value="achievements">
            <Trophy className="size-4 mr-1" />
            Achievement
          </TabsTrigger>
          <TabsTrigger value="shop">
            <ShoppingBag className="size-4 mr-1" />
            {tr("ร้านค้า")}
          </TabsTrigger>
          <TabsTrigger value="titles">
            <Crown className="size-4 mr-1" />
            {tr("ฉายา")}
          </TabsTrigger>
          <TabsTrigger value="badges">
            <Award className="size-4 mr-1" />
            {tr("เหรียญตรา")}
          </TabsTrigger>
          <TabsTrigger value="events">
            <Sparkles className="size-4 mr-1" />
            {tr("กิจกรรม")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="achievements" className="mt-4">
          <AchievementsTab profile={profile} userId={user?.id} />
        </TabsContent>
        <TabsContent value="shop" className="mt-4">
          <ShopTab gold={profile?.gold ?? 0} userId={user?.id} />
        </TabsContent>
        <TabsContent value="titles" className="mt-4">
          <TitlesTab userId={user?.id} activeTitleId={profile?.active_title_id} />
        </TabsContent>
        <TabsContent value="badges" className="mt-4">
          <BadgesTab userId={user?.id} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab userId={user?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Achievements ---------- */
function AchievementsTab({ profile, userId }: { profile?: ProfileRow | null; userId?: string }) {
  const qc = useQueryClient();
  const [claiming, setClaiming] = useState<string | null>(null);
  const { data: all } = useQuery({
    queryKey: ["all-achievements"],
    queryFn: async () =>
      (await supabase.from("achievements").select("*").order("criteria_value")).data ?? [],
  });
  const { data: mine } = useQuery({
    queryKey: ["my-achievements", userId],
    queryFn: async () =>
      (await supabase.from("user_achievements").select("achievement_id").eq("user_id", userId!))
        .data ?? [],
    enabled: !!userId,
  });
  const mineIds = new Set((mine ?? []).map((m) => m.achievement_id));

  function getValue(type: string) {
    if (!profile) return 0;
    return type === "level"
      ? profile.level
      : type === "xp"
        ? profile.xp
        : type === "gold"
          ? profile.gold
          : type === "quests"
            ? profile.quests_completed
            : type === "streak"
              ? profile.streak_days
              : type === "perfect"
                ? profile.perfect_scores
                : type === "night_owl"
                  ? profile.night_owl_quests
                  : type === "early_bird"
                    ? profile.early_bird_quests
                    : type === "weekend_warrior"
                      ? profile.weekend_warrior_quests
                      : type === "speed_demon"
                        ? profile.speed_demon_quests
                        : type === "perfect_streak"
                          ? profile.max_perfect_streak
                          : type === "birthday"
                            ? profile.birthday_visited
                              ? 1
                              : 0
                            : type === "achievement_count"
                              ? (mine?.length ?? 0)
                              : 0;
  }

  async function claim(id: string) {
    setClaiming(id);
    try {
      const { data, error } = await supabase.rpc("claim_achievement", { _achievement_id: id });
      if (error) throw error;
      const r = data as ClaimAchievementResult | null;
      toast.success(
        `🏆 ${r?.name ?? tr("Achievement")} +${r?.xp_bonus ?? 0} XP, +${r?.gold_bonus ?? 0} ทอง${r?.title_granted ? ` · ได้ฉายา!` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["my-achievements"] });
      qc.invalidateQueries({ queryKey: ["xp-transactions"] });
      qc.invalidateQueries({ queryKey: ["xp-summary"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["my-titles"] });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, tr("รับรางวัลไม่สำเร็จ")));
    } finally {
      setClaiming(null);
    }
  }

  if (!all?.length)
    return <p className="text-muted-foreground text-sm">{tr("ยังไม่มี Achievement")}</p>;

  // Separate hidden (not yet unlocked) from visible
  const achievementList = (all ?? []) as AchievementRow[];
  const visible = achievementList.filter((a) => !a.is_hidden || mineIds.has(a.id));
  const hiddenLocked = achievementList.filter((a) => a.is_hidden && !mineIds.has(a.id));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((a) => {
          const owned = mineIds.has(a.id);
          const current = getValue(a.criteria_type);
          const pct = Math.min(100, (current / a.criteria_value) * 100);
          return (
            <Card key={a.id} className={owned ? "border-primary/50" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-2xl">{a.icon ?? (owned ? "🏆" : "🔒")}</span>
                    {a.name}
                    {a.is_hidden && owned && (
                      <Badge variant="outline" className="text-[10px]">
                        ลับ
                      </Badge>
                    )}
                  </span>
                  <Badge
                    className={`text-xs border ${rarityStyle[a.rarity] ?? rarityStyle.common}`}
                  >
                    {a.rarity}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {a.description}
                </p>
                {!a.is_hidden && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{a.criteria_type}</span>
                      <span className="font-mono">
                        {Math.min(current, a.criteria_value)} / {a.criteria_value}
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </>
                )}
                <div className="flex gap-1 text-xs flex-wrap pt-1 items-center">
                  <Badge variant="outline">+{a.xp_bonus} XP</Badge>
                  <Badge variant="outline" className="gap-1">
                    <Coins className="size-3" />
                    {a.gold_bonus}
                  </Badge>
                  {owned ? (
                    <Badge className="bg-green-100 text-green-900 gap-1">
                      <Check className="size-3" />
                      {tr("ปลดล็อกแล้ว")}
                    </Badge>
                  ) : current >= a.criteria_value ? (
                    <Button
                      size="sm"
                      className="ml-auto gap-1"
                      onClick={() => claim(a.id)}
                      disabled={claiming === a.id}
                    >
                      <Trophy className="size-3" />
                      {claiming === a.id ? tr("กำลังรับ...") : tr("รับรางวัล")}
                    </Button>
                  ) : (
                    <Badge variant="outline" className="ml-auto gap-1 text-muted-foreground">
                      <Lock className="size-3" />
                      {tr("ยังไม่ครบ")}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {hiddenLocked.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display text-xl flex items-center gap-2">
            <Lock className="size-4" /> {tr("Achievement ลับ")} ({hiddenLocked.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hiddenLocked.map((a) => (
              <Card key={a.id} className="border-dashed opacity-80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-2xl grayscale">❓</span>
                      <span className="blur-[2px] select-none">??????</span>
                    </span>
                    <Badge
                      className={`text-xs border ${rarityStyle[a.rarity] ?? rarityStyle.common}`}
                    >
                      {a.rarity}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground italic leading-relaxed">
                    💡 {a.hint ?? tr("ปลดล็อกเพื่อเปิดเผยความลับ")}
                  </p>
                  <div className="flex gap-1 text-xs flex-wrap pt-1">
                    <Badge variant="outline">+? XP</Badge>
                    <Badge variant="outline" className="gap-1">
                      <Coins className="size-3" />?
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Shop ---------- */
function ShopTab({ gold, userId }: { gold: number; userId?: string }) {
  const qc = useQueryClient();
  const [buying, setBuying] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ["shop-items"],
    queryFn: async () =>
      (await supabase.from("shop_items").select("*").eq("is_active", true).order("gold_price"))
        .data ?? [],
  });
  const { data: owned } = useQuery({
    queryKey: ["my-purchases", userId],
    queryFn: async () =>
      (await supabase.from("shop_purchases").select("item_id").eq("user_id", userId!)).data ?? [],
    enabled: !!userId,
  });
  const ownedIds = new Set((owned ?? []).map((p) => p.item_id));

  async function buy(id: string) {
    setBuying(id);
    try {
      const { data, error } = await supabase.rpc("purchase_shop_item", { _item_id: id });
      if (error) throw error;
      const result = data as PurchaseShopResult | null;
      toast.success(`ซื้อสำเร็จ! ได้รับ ${result?.item ?? tr("สินค้า")}`);
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["my-purchases"] });
      qc.invalidateQueries({ queryKey: ["my-titles"] });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, tr("ซื้อไม่สำเร็จ")));
    } finally {
      setBuying(null);
    }
  }

  if (!items?.length)
    return <p className="text-muted-foreground text-sm">{tr("ยังไม่มีสินค้าในร้านค้า")}</p>;

  const itemList = (items ?? []) as ShopItemRow[];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {itemList.map((it) => {
        const isOwned = ownedIds.has(it.id);
        const cantAfford = gold < it.gold_price;
        return (
          <Card key={it.id} className={isOwned ? "border-green-500/40" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-2xl">{it.icon ?? "🎁"}</span>
                {it.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {it.description}
              </p>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="gap-1">
                  <Coins className="size-3 text-amber-500" />
                  {it.gold_price}
                </Badge>
                {isOwned ? (
                  <Badge className="bg-green-100 text-green-900 gap-1">
                    <Check className="size-3" />
                    {tr("มีแล้ว")}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => buy(it.id)}
                    disabled={cantAfford || buying === it.id}
                  >
                    {cantAfford ? (
                      <>
                        <Lock className="size-3 mr-1" />
                        {tr("ทองไม่พอ")}
                      </>
                    ) : (
                      tr("ซื้อ")
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- Titles ---------- */
function TitlesTab({ userId, activeTitleId }: { userId?: string; activeTitleId?: string | null }) {
  const qc = useQueryClient();
  const { data: titles } = useQuery({
    queryKey: ["my-titles", userId],
    queryFn: async () =>
      (
        await supabase
          .from("user_titles")
          .select("title_id, titles(id, name, description, code)")
          .eq("user_id", userId!)
      ).data ?? [],
    enabled: !!userId,
  });

  async function activate(titleId: string | null) {
    const { error } = await supabase
      .from("profiles")
      .update({ active_title_id: titleId })
      .eq("id", userId!);
    if (error) return toast.error(error.message);
    toast.success(titleId ? tr("เลือกฉายาแล้ว") : tr("ปิดการแสดงฉายา"));
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  if (!titles?.length)
    return (
      <p className="text-muted-foreground text-sm">
        {tr("ยังไม่มีฉายา ลองทำ Achievement หรือซื้อจากร้านค้า")}
      </p>
    );

  return (
    <div className="space-y-3">
      <Button
        variant={!activeTitleId ? "default" : "outline"}
        size="sm"
        onClick={() => activate(null)}
      >
        ไม่แสดงฉายา
      </Button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {((titles ?? []) as UserTitleWithTitle[]).map((t) => {
          const isActive = activeTitleId === t.titles?.id;
          return (
            <Card key={t.title_id} className={isActive ? "border-primary" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star
                    className={`size-4 ${isActive ? "text-primary fill-primary" : "text-muted-foreground"}`}
                  />
                  {t.titles?.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{t.titles?.description}</p>
                <Button
                  size="sm"
                  variant={isActive ? "secondary" : "default"}
                  className="w-full"
                  onClick={() => t.titles?.id && activate(t.titles.id)}
                  disabled={isActive || !t.titles?.id}
                >
                  {isActive ? tr("กำลังใช้งาน") : tr("เลือกใช้")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Badges ---------- */
function BadgesTab({ userId }: { userId?: string }) {
  const { data: badges } = useQuery({
    queryKey: ["all-badges"],
    queryFn: async () => (await supabase.from("badges").select("*")).data ?? [],
  });
  const { data: mine } = useQuery({
    queryKey: ["my-badges", userId],
    queryFn: async () =>
      (await supabase.from("user_badges").select("badge_id").eq("user_id", userId!)).data ?? [],
    enabled: !!userId,
  });
  const mineIds = new Set((mine ?? []).map((m) => m.badge_id));

  if (!badges?.length)
    return <p className="text-muted-foreground text-sm">{tr("ยังไม่มีเหรียญตรา")}</p>;

  const badgeList = (badges ?? []) as BadgeRow[];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {badgeList.map((b) => {
        const owned = mineIds.has(b.id);
        return (
          <Card key={b.id} className={owned ? "border-primary" : "opacity-60"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="text-3xl">{b.icon ?? "🏅"}</span>
                {b.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {b.description}
              </p>
              <p className="text-xs mt-2">{owned ? tr("✅ ได้แล้ว") : tr("🔒 ยังไม่ได้")}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function EventsTab({ userId }: { userId?: string }) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: events } = useQuery({
    queryKey: ["multiplier-events-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("multiplier_events")
        .select("*")
        .gte("starts_at", since.toISOString())
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MultiplierEventRow[];
    },
  });

  const { data: drops } = useQuery({
    queryKey: ["lucky-drop-history", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lucky_drop_log")
        .select("*")
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as LuckyDropLogRow[];
    },
    enabled: !!userId,
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{tr("กิจกรรมพิเศษ")}</h3>
        {!events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("ยังไม่มีกิจกรรม")}</p>
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-md border p-2.5 text-sm"
              >
                <div>
                  <div className="font-medium">{e.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.starts_at).toLocaleString("th-TH")} —{" "}
                    {new Date(e.ends_at).toLocaleString("th-TH")}
                  </div>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  ×{Number(e.multiplier).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{tr("ประวัติลากรับโชค")}</h3>
        {!drops || drops.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tr("ยังไม่เคยลากได้อะไร — ไปทำควอสต์ก่อน!")}
          </p>
        ) : (
          <div className="space-y-1">
            {drops.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-muted/50"
              >
                <span>
                  {d.reward_kind === "gold" && `🪙 +${d.reward_amount} ${tr("ทอง")}`}
                  {d.reward_kind === "xp" && `✨ +${d.reward_amount} XP`}
                  {d.reward_kind === "cosmetic_voucher" && `🎁 Voucher (${tr("รอเปิดใช้")})`}
                  {d.reward_kind === "rare_title" && `👑 ${tr("ฉายาหายาก")} (${tr("รอเปิดใช้")})`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleString("th-TH")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
