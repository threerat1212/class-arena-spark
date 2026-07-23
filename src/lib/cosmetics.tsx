// Shared helpers for rendering cosmetic rewards (avatar frames, name colors, banners).
// Codes come from shop_items seed data and profiles.active_*_code columns.
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export const FRAME_RING: Record<string, string> = {
  bronze: "ring-amber-700 shadow-[0_0_10px_rgba(180,83,9,0.55)]",
  silver: "ring-slate-300 shadow-[0_0_10px_rgba(148,163,184,0.6)]",
  gold: "ring-yellow-400 shadow-[0_0_12px_rgba(234,179,8,0.7)]",
  diamond: "ring-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.8)]",
  legend:
    "ring-transparent [background:linear-gradient(#fff,#fff)_padding-box,conic-gradient(from_0deg,#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)_border-box] shadow-[0_0_16px_rgba(168,85,247,0.7)]",
};

export const BANNER_GRADIENT: Record<string, string> = {
  sky: "linear-gradient(135deg,#38bdf8,#e0f2fe)",
  ocean: "linear-gradient(135deg,#0369a1,#22d3ee)",
  mountain: "linear-gradient(135deg,#78716c,#a8a29e)",
  galaxy: "linear-gradient(135deg,#4c1d95,#7c3aed,#0f172a)",
  flame: "linear-gradient(135deg,#dc2626,#f59e0b)",
  aurora: "linear-gradient(135deg,#22d3ee,#a855f7,#22c55e)",
};

export function frameRingClass(code: string | null | undefined): string {
  if (!code) return "";
  return FRAME_RING[code] ?? "";
}

export function bannerStyle(code: string | null | undefined): CSSProperties | undefined {
  if (!code) return undefined;
  const bg = BANNER_GRADIENT[code];
  return bg ? { backgroundImage: bg } : undefined;
}

export function nameColorStyle(code: string | null | undefined): CSSProperties | undefined {
  if (!code) return undefined;
  if (code === "rainbow") {
    return {
      backgroundImage: "linear-gradient(90deg,#ef4444,#eab308,#22c55e,#3b82f6,#a855f7)",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
  }
  return { color: code };
}

/** Wraps children as a name with the user's chosen color. */
export function ColoredName({
  code,
  className,
  children,
}: {
  code: string | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(className)} style={nameColorStyle(code)}>
      {children}
    </span>
  );
}
