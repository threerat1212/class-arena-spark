// Animated pill showing combo count + multiplier.
// Hidden when combo = 0. Pulses at tier >= 7.
import { motion, AnimatePresence } from "motion/react";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { comboTierFor } from "@/lib/gamification.types";
import { useTranslation } from "react-i18next";

interface ComboBadgeProps {
  combo: number;
  multiplier?: number;
  className?: string;
  /** Compact mode for inline use (no text label). */
  compact?: boolean;
}

export function ComboBadge({ combo, multiplier, className, compact }: ComboBadgeProps) {
  const { t } = useTranslation();
  if (combo <= 0) return null;
  const tier = comboTierFor(combo);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={combo}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          "bg-card",
          tier.glowClass || "text-muted-foreground",
          tier.min >= 7 && "border-red-300",
          className,
        )}
      >
        <Flame className={cn("h-3.5 w-3.5", tier.min >= 7 && "animate-pulse")} />
        <span>
          {compact
            ? `×${combo}`
            : t(`gamification.combo.tier.${tier.label}`, {
                count: combo,
                defaultValue: `combo ×${combo}`,
              })}
        </span>
        {multiplier && multiplier > 1 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {multiplier.toFixed(2)}×
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
