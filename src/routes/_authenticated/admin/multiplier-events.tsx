import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { tr } from "@/i18n";
import type { MultiplierEventRow } from "@/lib/gamification.types";

export const Route = createFileRoute("/_authenticated/admin/multiplier-events")({
  component: AdminMultiplierEventsPage,
});

function AdminMultiplierEventsPage() {
  const { hasRole, loading } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    label: tr("ชั่วโมงพิเศษ!"),
    multiplier: "2.00",
    startsAt: "",
    endsAt: "",
  });

  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-multiplier-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("multiplier_events")
        .select("*")
        .order("starts_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MultiplierEventRow[];
    },
    enabled: hasRole("admin"),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const startsAt = new Date(form.startsAt);
      const endsAt = new Date(form.endsAt);
      if (!(endsAt > startsAt)) {
        throw new Error(tr("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม"));
      }
      const mult = parseFloat(form.multiplier);
      if (!Number.isFinite(mult) || mult < 1 || mult > 5) {
        throw new Error(tr("ตัวคูณต้องอยู่ระหว่าง 1.00 และ 5.00"));
      }
      const { error } = await supabase.from("multiplier_events").insert({
        label: form.label.trim() || tr("ชั่วโมงพิเศษ!"),
        multiplier: String(mult),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        scope: "global",
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tr("สร้างกิจกรรมสำเร็จ"));
      qc.invalidateQueries({ queryKey: ["admin-multiplier-events"] });
      qc.invalidateQueries({ queryKey: ["active-multiplier-event"] });
      qc.invalidateQueries({ queryKey: ["multiplier-events-history"] });
      setForm({
        label: tr("ชั่วโมงพิเศษ!"),
        multiplier: "2.00",
        startsAt: "",
        endsAt: "",
      });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : tr("สร้างกิจกรรมล้มเหลว")),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (args: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("multiplier_events")
        .update({ is_active: !args.isActive })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-multiplier-events"] });
      qc.invalidateQueries({ queryKey: ["active-multiplier-event"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : tr("อัปเดตล้มเหลว")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("multiplier_events")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-multiplier-events"] });
      qc.invalidateQueries({ queryKey: ["multiplier-events-history"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : tr("ลบล้มเหลว")),
  });

  if (loading) {
    return <div className="p-6 text-muted-foreground">{tr("กำลังโหลด...")}</div>;
  }
  if (!hasRole("admin")) {
    return <Navigate to="/dashboard" />;
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("th-TH");

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-6">
      <h1 className="text-2xl font-bold">{tr("จัดการกิจกรรม XP ×")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{tr("สร้างกิจกรรมใหม่")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>{tr("ชื่อกิจกรรม")}</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{tr("เริ่ม")}</Label>
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </div>
            <div>
              <Label>{tr("สิ้นสุด")}</Label>
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>{tr("ตัวคูณ (1.00 - 5.00)")}</Label>
            <Input
              type="number"
              step="0.25"
              min="1"
              max="5"
              value={form.multiplier}
              onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
            />
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={
              !form.startsAt ||
              !form.endsAt ||
              createMutation.isPending
            }
          >
            {createMutation.isPending ? tr("กำลังสร้าง...") : tr("สร้าง")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr("กิจกรรมล่าสุด")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{tr("กำลังโหลด...")}</p>
          ) : !events || events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("ยังไม่มีกิจกรรม")}</p>
          ) : (
            <div className="space-y-2">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.label}</span>
                      {!e.is_active && (
                        <Badge variant="outline">{tr("ปิดแล้ว")}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmt(e.starts_at)} — {fmt(e.ends_at)}
                    </div>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    ×{Number(e.multiplier).toFixed(2)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        toggleActiveMutation.mutate({
                          id: e.id,
                          isActive: e.is_active,
                        })
                      }
                    >
                      {e.is_active ? tr("ปิด") : tr("เปิด")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(e.id)}
                    >
                      {tr("ลบ")}
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
