// sonner-based toast announcing lucky drops.
// Static Thai strings (sonner fires outside React tree so no useTranslation).
// Rare drops stay visible 6s, others 4s.
import { toast } from "sonner";
import { Sparkles, Coins, Gift, Crown } from "lucide-react";
import type { LuckyDropReward } from "@/lib/gamification.types";

export function announceLuckyDrop(drop: LuckyDropReward | null | undefined) {
  if (!drop) return;

  const cfg = {
    gold: {
      icon: Coins,
      color: "text-amber-500",
      msg: `ลากรับโชค! +${drop.amount} 🪙`,
    },
    xp: {
      icon: Sparkles,
      color: "text-blue-500",
      msg: `ลากรับโชค! +${drop.amount} XP`,
    },
    cosmetic_voucher: {
      icon: Gift,
      color: "text-fuchsia-500",
      msg: "ลากรับโชค! ได้ Voucher (เปิดใช้ในเร็ว ๆ นี้)",
    },
    rare_title: {
      icon: Crown,
      color: "text-yellow-500",
      msg: "ลากรับโชค! ได้ฉายาหายาก! (เปิดใช้ในเร็ว ๆ นี้)",
    },
  }[drop.kind];

  const Icon = cfg.icon;
  toast(cfg.msg, {
    icon: <Icon className={`h-4 w-4 ${cfg.color}`} />,
    duration:
      drop.kind === "rare_title" || drop.kind === "cosmetic_voucher" ? 6000 : 4000,
  });
}
