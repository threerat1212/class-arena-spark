import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import type { Database } from "@/integrations/supabase/types";

import { tr } from "@/i18n";
export const Route = createFileRoute("/checkin")({
  validateSearch: (s: Record<string, unknown>) => ({ code: (s.code as string) ?? "" }),
  component: CheckInPage,
});

type CheckInResult = Database["public"]["Functions"]["self_check_in"]["Returns"][number];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : tr("เช็กชื่อไม่สำเร็จ");
}

function CheckInPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { code: initial } = Route.useSearch();
  const [code, setCode] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const redirect = initial ? `/checkin?code=${encodeURIComponent(initial)}` : "/checkin";
      if (!data.session) nav({ to: "/login", search: { redirect } });
    });
  }, [initial, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("self_check_in", {
        p_code: code.trim().toUpperCase(),
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as (CheckInResult & { xp_gained?: number }) | undefined;
      const status = row?.status;
      const xp = row?.xp_gained ?? 0;
      // gold ยังไม่ได้ให้จริงในระบบ (legacy phantom) — แสดงเฉพาะตอนได้ XP ใหม่ > 0
      const gold = xp > 0 ? (status === "late" ? 2 : 5) : 0;
      const xpSign = xp > 0 ? "+" : "";
      const xpText = xp === 0 ? "" : ` ${xpSign}${xp} XP,`;
      const goldText = gold > 0 ? ` +${gold} ${tr("ทอง")}` : "";
      toast.success(
        (status === "late" ? tr("เช็กชื่อสำเร็จ (สาย)") : tr("เช็กชื่อสำเร็จ ✅")) +
          `${xpText}${goldText}`,
      );
      qc.invalidateQueries({ queryKey: ["xp-transactions"] });
      qc.invalidateQueries({ queryKey: ["xp-summary"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setTimeout(() => nav({ to: "/dashboard" }), 1500);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-gradient-to-br from-primary/5 to-background relative">
      <div className="absolute top-3 right-3">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="size-14 mx-auto rounded-xl bg-primary/15 grid place-items-center mb-2">
            <KeyRound className="size-7 text-primary" />
          </div>
          <CardTitle className="font-display text-2xl">{tr("เช็กชื่อเข้าเรียน")}</CardTitle>
          <p className="text-sm text-muted-foreground">{tr("กรอกรหัส 6 หลักจากครู")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="checkin-code">{tr("รหัสเช็กชื่อ")}</Label>
              <Input
                id="checkin-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABC123"
                className="text-center text-2xl font-mono tracking-widest h-14"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loading || code.length < 6}
            >
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              เช็กชื่อ
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
