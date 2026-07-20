// Shows the bonus math: base × combo × event + perfect + lucky.
// Used on quest/exam result screens to make rewards legible.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface BonusBreakdownProps {
  base: number;
  comboCount?: number;
  comboMultiplier?: number;
  eventMultiplier?: number;
  perfectBonus?: number;
  luckyGold?: number;
  luckyXp?: number;
  className?: string;
}

export function BonusBreakdown({
  base,
  comboCount = 0,
  comboMultiplier = 1,
  eventMultiplier = 1,
  perfectBonus = 0,
  luckyGold = 0,
  luckyXp = 0,
  className,
}: BonusBreakdownProps) {
  const { t } = useTranslation();
  const total = Math.round(base * comboMultiplier * eventMultiplier) + perfectBonus + luckyXp;

  return (
    <div className={cn("rounded-md border bg-muted/30 p-3 text-sm", className)}>
      <div className="mb-1 font-medium">
        {t("gamification.breakdown.title", { defaultValue: "รายละเอียดโบนัส" })}
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <Row
          label={t("gamification.breakdown.base", { defaultValue: "พื้นฐาน" })}
          value={`+${base}`}
        />
        {comboMultiplier > 1 && (
          <Row
            label={t("gamification.breakdown.combo", {
              count: comboCount,
              defaultValue: `combo ×${comboCount}`,
            })}
            value={`×${comboMultiplier.toFixed(2)}`}
          />
        )}
        {eventMultiplier > 1 && (
          <Row
            label={t("gamification.breakdown.event", { defaultValue: "กิจกรรม" })}
            value={`×${eventMultiplier.toFixed(2)}`}
          />
        )}
        {perfectBonus > 0 && (
          <Row
            label={t("gamification.breakdown.perfect", { defaultValue: "โบนัสคะแนนเต็ม" })}
            value={`+${perfectBonus}`}
            highlight
          />
        )}
        {luckyXp > 0 && (
          <Row
            label={t("gamification.breakdown.luckyXp", { defaultValue: "ลากได้ XP" })}
            value={`+${luckyXp}`}
            highlight
          />
        )}
        {luckyGold > 0 && (
          <Row
            label={t("gamification.breakdown.luckyGold", { defaultValue: "ลากได้ทอง" })}
            value={`+${luckyGold}`}
            highlight
          />
        )}
      </div>
      <div className="mt-2 border-t pt-2 font-semibold">
        {t("gamification.breakdown.total", { defaultValue: "รวม" })}: +{total} XP
        {luckyGold > 0 && ` +${luckyGold} 🪙`}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("flex justify-between", highlight && "text-primary font-medium")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
