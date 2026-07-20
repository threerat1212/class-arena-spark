// Dismissible banner showing an active XP multiplier event with countdown.
// Dismissal persists in localStorage keyed by event id.
import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { eventMultiplier, type MultiplierEventRow } from "@/lib/gamification.types";
import { useTranslation } from "react-i18next";

interface Props {
  event: MultiplierEventRow;
  className?: string;
  dismissible?: boolean;
}

function formatRemaining(ms: number, lang: string): string {
  if (ms <= 0) return lang === "th" ? "หมดแล้ว" : "ended";
  const totalMinutes = Math.floor(ms / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return lang === "th" ? `${hours} ชม. ${mins} นาที` : `${hours}h ${mins}m`;
  }
  return rtf.format(totalMinutes, "minute");
}

export function MultiplierEventBanner({ event, className, dismissible = true }: Props) {
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const storageKey = `mult-event-dismissed:${event.id}`;

  useEffect(() => {
    if (dismissible && typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    }
  }, [storageKey, dismissible]);

  useEffect(() => {
    const tick = () => {
      setRemainingMs(new Date(event.ends_at).getTime() - Date.now());
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [event.ends_at]);

  if (dismissed) return null;

  const lang = i18n.language?.startsWith("th") ? "th" : "en";
  const remaining = formatRemaining(remainingMs, lang);
  const mult = eventMultiplier(event);

  const dismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5",
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        <span className="font-medium">{event.label}</span>{" "}
        <span className="text-muted-foreground">
          {t("gamification.multiplier.active", {
            multiplier: mult.toFixed(2),
            remaining,
            defaultValue: `XP ×${mult.toFixed(2)} • ${remaining}`,
          })}
        </span>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
