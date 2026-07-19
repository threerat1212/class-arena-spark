import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Coins, Flame, Trophy, Sparkles, Pencil } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

import { tr } from "@/i18n";
export const Route = createFileRoute("/_authenticated/profile")({ component: ProfilePage });

type ProfileWithTitle = Database["public"]["Tables"]["profiles"]["Row"] & {
  titles?: { name: string | null } | null;
};
type UserTitleWithTitle = Database["public"]["Tables"]["user_titles"]["Row"] & {
  titles?: { name: string | null } | null;
};
type UserBadgeWithBadge = Database["public"]["Tables"]["user_badges"]["Row"] & {
  badges?: { name: string | null; icon: string | null; description: string | null } | null;
};

function ProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["me-profile", user?.id],
    queryFn: async (): Promise<ProfileWithTitle | null> => {
      const profileWithTitle = await supabase
        .from("profiles")
        .select("*, titles!profiles_active_title_id_fkey(name)")
        .eq("id", user!.id)
        .maybeSingle();
      return (
        (profileWithTitle.data as ProfileWithTitle | null) ??
        ((await supabase.from("profiles").select("*").eq("id", user!.id).single())
          .data as ProfileWithTitle | null)
      );
    },
    enabled: !!user,
  });

  const { data: privateProfile } = useQuery({
    queryKey: ["me-profile-private", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles_private")
        .select("birthday, bio, grade_level")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: achievements } = useQuery({
    queryKey: ["all-ach"],
    queryFn: async () =>
      (await supabase.from("achievements").select("*").order("criteria_value")).data ?? [],
  });
  const { data: myAch } = useQuery({
    queryKey: ["my-ach", user?.id],
    queryFn: async () =>
      (await supabase.from("user_achievements").select("achievement_id").eq("user_id", user!.id))
        .data ?? [],
    enabled: !!user,
  });
  const { data: badges } = useQuery({
    queryKey: ["my-badges", user?.id],
    queryFn: async () =>
      ((await supabase.from("user_badges").select("*, badges(*)").eq("user_id", user!.id)).data as
        | UserBadgeWithBadge[]
        | null) ?? [],
    enabled: !!user,
  });
  const { data: titles } = useQuery({
    queryKey: ["my-titles", user?.id],
    queryFn: async () =>
      ((await supabase.from("user_titles").select("*, titles(*)").eq("user_id", user!.id)).data as
        | UserTitleWithTitle[]
        | null) ?? [],
    enabled: !!user,
  });

  const unlocked = new Set(myAch?.map((a) => a.achievement_id));
  const nextLv = (profile?.level ?? 1) * 100;
  const pct = profile ? ((profile.xp % 100) / 100) * 100 : 0;

  async function saveName() {
    if (!newName.trim() || newName.trim() === profile?.display_name) {
      setIsEditingName(false);
      return;
    }
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: newName.trim() })
      .eq("id", user!.id);
    setSavingName(false);
    if (error) toast.error(error.message);
    else {
      toast.success(tr("แก้ไขชื่อเรียบร้อย"));
      setIsEditingName(false);
      qc.invalidateQueries({ queryKey: ["me-profile"] });
    }
  }

  async function setTitle(id: string | null) {
    const { error } = await supabase.rpc("set_active_title", { _title_id: id as string });
    if (error) toast.error(error.message);
    else {
      toast.success(tr("เปลี่ยนฉายาแล้ว"));
      qc.invalidateQueries({ queryKey: ["me-profile"] });
    }
  }

  // Auto-check birthday easter egg whenever profile loads with a birthday set
  useEffect(() => {
    if (!user || !privateProfile?.birthday) return;
    supabase.rpc("check_birthday_visit").then(({ data }) => {
      const result = data as { birthday?: boolean } | null;
      if (result?.birthday) {
        toast.success(tr("🎂 สุขสันต์วันเกิด! ปลดล็อกรางวัลลับ"));
        qc.invalidateQueries({ queryKey: ["me-profile"] });
        qc.invalidateQueries({ queryKey: ["my-ach"] });
        qc.invalidateQueries({ queryKey: ["my-titles"] });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, privateProfile?.birthday]);

  async function saveBirthday(value: string) {
    const { error } = await supabase
      .from("profiles_private")
      .upsert({ user_id: user!.id, birthday: value || null }, { onConflict: "user_id" });
    if (error) toast.error(error.message);
    else {
      toast.success(tr("บันทึกวันเกิดแล้ว"));
      qc.invalidateQueries({ queryKey: ["me-profile-private"] });
    }
  }

  if (!profile) return <div className="p-10">{tr("กำลังโหลด…")}</div>;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-10 space-y-6">
      <Card className="overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-primary/40 via-primary/20 to-accent/40" />
        <CardContent className="pt-0 -mt-12">
          <div className="flex items-end gap-4">
            <Avatar className="size-24 border-4 border-background">
              <AvatarImage src={profile.avatar_url ?? undefined} />
              <AvatarFallback className="text-3xl">
                {profile.display_name?.[0] ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="pb-2 flex-1">
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    className="h-11 w-56 font-display text-xl"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") {
                        setIsEditingName(false);
                        setNewName(profile?.display_name ?? "");
                      }
                    }}
                    autoFocus
                    maxLength={120}
                  />
                  <Button size="sm" onClick={saveName} disabled={savingName}>
                    {tr("บันทึก")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsEditingName(false);
                      setNewName(profile?.display_name ?? "");
                    }}
                    disabled={savingName}
                  >
                    {tr("ยกเลิก")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-3xl">{profile.display_name}</h1>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-11"
                    onClick={() => {
                      setNewName(profile.display_name ?? "");
                      setIsEditingName(true);
                    }}
                    title={tr("แก้ไขชื่อ")}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              )}
              {profile.titles?.name && (
                <Badge variant="secondary" className="mt-1">
                  👑 {profile.titles.name}
                </Badge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <Stat
              icon={<Sparkles className="size-4" />}
              label={tr("เลเวล")}
              value={profile.level}
            />
            <Stat icon={<Zap className="size-4" />} label="XP" value={profile.xp} />
            <Stat icon={<Coins className="size-4" />} label={tr("ทอง")} value={profile.gold} />
            <Stat
              icon={<Flame className="size-4" />}
              label={tr("สตรีค")}
              value={`${profile.streak_days} วัน`}
            />
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1">
              <span>{tr("ความคืบหน้าเลเวล")}</span>
              <span>{profile.xp % 100}/100 XP</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">🎂 {tr("วันเกิด")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Label htmlFor="bday" className="text-sm text-muted-foreground">
            {tr("ใส่วันเกิดเพื่อรับเซอร์ไพรส์ในวันพิเศษ")}
          </Label>
          <Input
            id="bday"
            type="date"
            className="w-44"
            defaultValue={privateProfile?.birthday ?? ""}
            onBlur={(e) => {
              if (e.target.value !== (privateProfile?.birthday ?? "")) saveBirthday(e.target.value);
            }}
          />
        </CardContent>
      </Card>

      <PasswordChangeCard />


      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Trophy className="size-5" />
            Achievements ({unlocked.size}/{achievements?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {achievements?.map((a) => {
              const has = unlocked.has(a.id);
              return (
                <div
                  key={a.id}
                  className={`p-3 rounded-lg border text-center ${has ? "bg-gradient-to-br from-primary/20 to-accent/20 border-primary/40" : "opacity-40 grayscale"}`}
                  title={a.description ?? ""}
                >
                  <div className="text-3xl">{a.icon}</div>
                  <p className="text-xs mt-1 font-medium">{a.name}</p>
                  <Badge variant="outline" className="text-[10px] mt-1 capitalize">
                    {a.rarity}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">{tr("ฉายาของฉัน")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={profile.active_title_id ? "outline" : "default"}
            onClick={() => setTitle(null)}
          >
            {tr("ไม่ใช้")}
          </Button>
          {titles?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {tr("ยังไม่มีฉายา สะสม achievement เพื่อปลดล็อก")}
            </p>
          )}
          {titles?.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={profile.active_title_id === t.title_id ? "default" : "outline"}
              onClick={() => setTitle(t.title_id)}
            >
              👑 {t.titles?.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Badge Wall</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {badges?.length === 0 && (
            <p className="text-sm text-muted-foreground">{tr("ยังไม่มี badge")}</p>
          )}
          {badges?.map((b) => (
            <div key={b.id} className="text-center" title={b.badges?.description ?? ""}>
              <div className="size-14 rounded-full bg-primary/10 grid place-items-center text-2xl border border-primary/30">
                {b.badges?.icon ?? "🏅"}
              </div>
              <p className="text-xs mt-1">{b.badges?.name}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="font-display text-2xl mt-1">{value}</p>
    </div>
  );
}

function PasswordChangeCard() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (pw.length < 6) {
      toast.error(tr("รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร"));
      return;
    }
    if (pw !== pw2) {
      toast.error(tr("รหัสผ่านไม่ตรงกัน"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(tr("เปลี่ยนรหัสผ่านแล้ว"));
      setPw("");
      setPw2("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          🔒 {tr("เปลี่ยนรหัสผ่าน")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-w-sm">
        <div>
          <Label htmlFor="new-pw">{tr("รหัสผ่านใหม่")}</Label>
          <Input
            id="new-pw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="new-pw2">{tr("ยืนยันรหัสผ่านใหม่")}</Label>
          <Input
            id="new-pw2"
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <Button onClick={submit} disabled={saving}>
          {saving ? tr("กำลังบันทึก") : tr("บันทึกรหัสผ่านใหม่")}
        </Button>
      </CardContent>
    </Card>
  );
}
