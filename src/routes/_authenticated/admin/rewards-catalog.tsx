import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { tr } from "@/i18n";
import type { Database } from "@/integrations/supabase/types";
import { Store, Gift, Sparkles, Trash2, Plus, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/rewards-catalog")({
  component: AdminRewardsCatalogPage,
});

type ShopItemRow = Database["public"]["Tables"]["shop_items"]["Row"];
type LevelUnlockRow = Database["public"]["Tables"]["level_unlocks"]["Row"];

const KINDS = [
  { value: "avatar_frame", label: "กรอบโปรไฟล์" },
  { value: "name_color", label: "สีชื่อ" },
  { value: "banner", label: "แบนเนอร์" },
  { value: "title", label: "ฉายา" },
  { value: "xp_potion", label: "ยา XP Potion" },
  { value: "combo_shield", label: "โล่ Combo Shield" },
  { value: "streak_freeze", label: "Streak Freeze" },
  { value: "hint_token", label: "Hint Token" },
  { value: "retry_token", label: "Retry Token" },
  { value: "extra_time", label: "Extra Time" },
];

const COSMETIC_CODES: Record<string, string[]> = {
  avatar_frame: ["bronze", "silver", "gold", "diamond", "legend"],
  banner: ["sky", "ocean", "mountain", "galaxy", "flame", "aurora"],
  name_color: ["#3b82f6", "#ef4444", "#f97316", "#22c55e", "#eab308", "#a855f7", "#ec4899", "rainbow"],
};

export default function AdminRewardsCatalogPage() {
  const { hasRole, loading } = useAuth();
  if (loading) return <div className="p-6 text-muted-foreground">{tr("กำลังโหลด...")}</div>;
  if (!hasRole("admin")) return <Navigate to="/dashboard" />;

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <Store className="size-7 text-primary" />
          {tr("จัดการรางวัล & ร้านค้า")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {tr("เพิ่ม/แก้ไขสินค้าในร้าน และรางวัลปลดล็อกตามเลเวล")}
        </p>
      </header>

      <Tabs defaultValue="shop">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="shop">
            <Store className="size-4 mr-1" /> {tr("ร้านค้า")}
          </TabsTrigger>
          <TabsTrigger value="unlocks">
            <Gift className="size-4 mr-1" /> {tr("ปลดล็อกตามเลเวล")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="shop" className="mt-4">
          <ShopTab />
        </TabsContent>
        <TabsContent value="unlocks" className="mt-4">
          <LevelUnlocksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShopTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<ShopItemRow>>({
    name: "",
    kind: "avatar_frame",
    description: "",
    gold_price: 100,
    icon: "🎁",
    is_active: true,
    metadata: {},
    title_id: null,
  });
  const [rewardCode, setRewardCode] = useState("");
  const [rewardAmount, setRewardAmount] = useState(1);

  const { data: items, isLoading } = useQuery({
    queryKey: ["admin-shop-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shop_items").select("*").order("kind").order("gold_price");
      if (error) throw error;
      return (data ?? []) as ShopItemRow[];
    },
  });

  const { data: titles } = useQuery({
    queryKey: ["admin-titles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("titles").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null }[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.name?.trim()) throw new Error(tr("ต้องใส่ชื่อสินค้า"));
      if (!form.kind) throw new Error(tr("ต้องเลือกประเภท"));
      const price = Number(form.gold_price);
      if (!Number.isFinite(price) || price < 0) throw new Error(tr("ราคาทองไม่ถูกต้อง"));

      const meta: Record<string, unknown> = {};
      if (form.kind !== "title") {
        meta.reward_kind = form.kind;
        meta.reward_code = rewardCode.trim() || undefined;
        meta.reward_amount = rewardAmount;
      }

      const { error } = await supabase.from("shop_items").insert({
        name: form.name.trim(),
        kind: form.kind,
        description: form.description?.trim() || null,
        gold_price: price,
        icon: form.icon?.trim() || "🎁",
        is_active: form.is_active ?? true,
        metadata: meta,
        title_id: form.kind === "title" ? form.title_id : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tr("เพิ่มสินค้าสำเร็จ"));
      qc.invalidateQueries({ queryKey: ["admin-shop-items"] });
      qc.invalidateQueries({ queryKey: ["shop-items"] });
      setForm({ name: "", kind: "avatar_frame", description: "", gold_price: 100, icon: "🎁", is_active: true, metadata: {}, title_id: null });
      setRewardCode("");
      setRewardAmount(1);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tr("เพิ่มสินค้าล้มเหลว")),
  });

  const toggleMutation = useMutation({
    mutationFn: async (args: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from("shop_items").update({ is_active: !args.isActive }).eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-shop-items"] });
      qc.invalidateQueries({ queryKey: ["shop-items"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tr("อัปเดตล้มเหลว")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shop_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-shop-items"] });
      qc.invalidateQueries({ queryKey: ["shop-items"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tr("ลบล้มเหลว")),
  });

  const selectedKind = form.kind || "avatar_frame";
  const codes = COSMETIC_CODES[selectedKind];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="size-4" /> {tr("เพิ่มสินค้า")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>{tr("ชื่อ")}</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>{tr("ประเภท")}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.kind}
              onChange={(e) => {
                setForm((f) => ({ ...f, kind: e.target.value }));
                setRewardCode("");
              }}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {selectedKind === "title" ? (
            <div className="space-y-1">
              <Label>{tr("ฉายา")}</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.title_id || ""}
                onChange={(e) => setForm((f) => ({ ...f, title_id: e.target.value || null }))}
              >
                <option value="">{tr("เลือกฉายา")}</option>
                {titles?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name ?? "—"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>{tr("รหัสรางวัล")}</Label>
              {codes ? (
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={rewardCode}
                  onChange={(e) => setRewardCode(e.target.value)}
                >
                  <option value="">{tr("เลือกรหัส")}</option>
                  {codes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <Input value={rewardCode} onChange={(e) => setRewardCode(e.target.value)} placeholder={tr("เช่น potion_1h / hint / time5")} />
              )}
              {selectedKind !== "name_color" && (
                <div className="pt-2 space-y-1">
                  <Label>{tr("จำนวน")}</Label>
                  <Input type="number" min={1} value={rewardAmount} onChange={(e) => setRewardAmount(Math.max(1, parseInt(e.target.value) || 1))} />
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label>{tr("ราคา (ทอง)")}</Label>
            <Input type="number" min={0} value={form.gold_price} onChange={(e) => setForm((f) => ({ ...f, gold_price: parseInt(e.target.value) || 0 }))} />
          </div>
          <div className="space-y-1">
            <Label>{tr("ไอคอน")}</Label>
            <Input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>{tr("คำอธิบาย")}</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full gap-1">
            <Save className="size-4" /> {tr("บันทึก")}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="size-4" /> {tr("สินค้าทั้งหมด")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{tr("กำลังโหลด…")}</p>
          ) : !items?.length ? (
            <p className="text-sm text-muted-foreground">{tr("ยังไม่มีสินค้า")}</p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between rounded-md border p-3 gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <span className="text-2xl">{it.icon}</span>
                    <div>
                      <p className="font-medium text-sm">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.kind} · {it.gold_price} {tr("ทอง")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={it.is_active ? "default" : "outline"}>
                      {it.is_active ? tr("เปิด") : tr("ปิด")}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleMutation.mutate({ id: it.id, isActive: it.is_active })}
                      disabled={toggleMutation.isPending}
                    >
                      {it.is_active ? tr("ปิด") : tr("เปิด")}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(it.id)} disabled={deleteMutation.isPending}>
                      <Trash2 className="size-4" />
                    </Button>
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

function LevelUnlocksTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<LevelUnlockRow>>({
    level: 1,
    reward_kind: "avatar_frame",
    reward_code: "",
    reward_amount: 1,
    label: "",
    description: "",
  });

  const { data: unlocks, isLoading } = useQuery({
    queryKey: ["admin-level-unlocks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("level_unlocks").select("*").order("level");
      if (error) throw error;
      return (data ?? []) as LevelUnlockRow[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const level = Number(form.level);
      if (!Number.isFinite(level) || level < 1) throw new Error(tr("เลเวลไม่ถูกต้อง"));
      if (!form.reward_kind) throw new Error(tr("ต้องเลือกประเภท"));
      if (!form.reward_code?.trim()) throw new Error(tr("ต้องใส่รหัสรางวัล"));
      const { error } = await supabase.from("level_unlocks").insert({
        level,
        reward_kind: form.reward_kind,
        reward_code: form.reward_code.trim(),
        reward_amount: form.reward_amount ?? 1,
        label: form.label?.trim() || null,
        description: form.description?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tr("เพิ่มรางวัลปลดล็อกสำเร็จ"));
      qc.invalidateQueries({ queryKey: ["admin-level-unlocks"] });
      qc.invalidateQueries({ queryKey: ["level-unlocks"] });
      setForm({ level: 1, reward_kind: "avatar_frame", reward_code: "", reward_amount: 1, label: "", description: "" });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tr("เพิ่มล้มเหลว")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("level_unlocks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-level-unlocks"] });
      qc.invalidateQueries({ queryKey: ["level-unlocks"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tr("ลบล้มเหลว")),
  });

  const selectedKind = form.reward_kind || "avatar_frame";
  const codes = COSMETIC_CODES[selectedKind];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4" /> {tr("เพิ่มรางวัลปลดล็อก")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>{tr("เลเวล")}</Label>
            <Input type="number" min={1} value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: parseInt(e.target.value) || 1 }))} />
          </div>
          <div className="space-y-1">
            <Label>{tr("ประเภท")}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.reward_kind}
              onChange={(e) => {
                setForm((f) => ({ ...f, reward_kind: e.target.value, reward_code: "" }));
              }}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{tr("รหัสรางวัล")}</Label>
            {codes ? (
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.reward_code}
                onChange={(e) => setForm((f) => ({ ...f, reward_code: e.target.value }))}
              >
                <option value="">{tr("เลือกรหัส")}</option>
                {codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <Input value={form.reward_code} onChange={(e) => setForm((f) => ({ ...f, reward_code: e.target.value }))} />
            )}
          </div>
          <div className="space-y-1">
            <Label>{tr("จำนวน")}</Label>
            <Input type="number" min={1} value={form.reward_amount} onChange={(e) => setForm((f) => ({ ...f, reward_amount: Math.max(1, parseInt(e.target.value) || 1) }))} />
          </div>
          <div className="space-y-1">
            <Label>{tr("ชื่อที่แสดง")}</Label>
            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>{tr("คำอธิบาย")}</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full gap-1">
            <Save className="size-4" /> {tr("บันทึก")}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="size-4" /> {tr("รางวัลปลดล็อกทั้งหมด")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{tr("กำลังโหลด…")}</p>
          ) : !unlocks?.length ? (
            <p className="text-sm text-muted-foreground">{tr("ยังไม่มีรางวัลปลดล็อก")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {unlocks.map((u) => (
                <div key={u.id} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge>Lv.{u.level}</Badge>
                    <Button size="sm" variant="ghost" className="text-destructive h-7 w-7 p-0" onClick={() => deleteMutation.mutate(u.id)} disabled={deleteMutation.isPending}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <p className="font-medium text-sm">{u.label || u.reward_code}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.reward_kind} · {u.reward_code} ×{u.reward_amount}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
