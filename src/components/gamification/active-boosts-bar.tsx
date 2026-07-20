// Floating HUD showing active user boosts (XP Potion, Combo Shield, Streak Freeze).
// Auto-refreshes every 30s. Hidden when no boosts active.
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Shield, Snowflake } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { tr } from "@/i18n";

type BoostRow = {
  id: string;
  effect_kind: string;
  multiplier: number | string | null;
  expires_at: string | null;
  consumed_at: string | null;
};

const ICONS: Record<string, React.ReactNode> = {
  xp_potion: <Sparkles className="size-3" />,
  combo_shield: <Shield className="size-3" />,
  streak_freeze: <Snowflake className="size-3" />,
};
const LABELS: Record<string, string> = {
  xp_potion: "XP Potion",
  combo_shield: "Combo Shield",
  streak_freeze: "Streak Freeze",
};

export function ActiveBoostsBar() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["active-boosts", user?.id],
    queryFn: async () =>
      ((
        await supabase
          .from("boost_effects")
          .select("id,effect_kind,multiplier,expires_at,consumed_at")
          .eq("user_id", user!.id)
          .is("consumed_at", null)
      ).data ?? []) as BoostRow[],
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });

  const active = (data ?? []).filter(
    (b) => !b.expires_at || new Date(b.expires_at).getTime() > Date.now(),
  );

  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-1.5 border-b bg-primary/5">
      {active.map((b) => {
        const expires = b.expires_at ? new Date(b.expires_at) : null;
        const remaining = expires
          ? Math.max(0, Math.floor((expires.getTime() - Date.now()) / 60000))
          : null;
        return (
          <Badge
            key={b.id}
            variant="outline"
            className="gap-1 border-primary/40 bg-background text-xs"
          >
            {ICONS[b.effect_kind]}
            {LABELS[b.effect_kind] ?? b.effect_kind}
            {b.multiplier ? ` ×${Number(b.multiplier).toFixed(2)}` : ""}
            {remaining != null ? ` · ${remaining}${tr("นาที")}` : ""}
          </Badge>
        );
      })}
    </div>
  );
}
