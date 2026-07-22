// Ambient signal field for the public landing hero. Purely presentational.
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "primary" | "warm" | "cool";
}

export function AnimatedBackground({ className, variant = "primary" }: Props) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <div
        className={cn(
          "motion-blob absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl",
          variant === "primary" &&
            "bg-[radial-gradient(circle_at_30%_30%,var(--primary),transparent_70%)]",
          variant === "warm" &&
            "bg-[radial-gradient(circle_at_30%_30%,var(--gold),transparent_70%)]",
          variant === "cool" && "bg-[radial-gradient(circle_at_30%_30%,var(--xp),transparent_70%)]",
        )}
      />
      <div className="motion-blob motion-blob-delay absolute top-40 right-[-120px] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle_at_60%_40%,var(--gold),transparent_70%)] opacity-20 blur-3xl" />
      <div className="motion-blob motion-blob-delay-2 absolute bottom-[-100px] left-1/3 h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle_at_50%_50%,var(--xp),transparent_70%)] opacity-15 blur-3xl" />
      <div className="motion-grid absolute inset-0 opacity-[0.035]" />
      <svg
        className="absolute inset-0 size-full text-primary/25"
        viewBox="0 0 1200 700"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          className="scholar-signal-line"
          d="M-80 560C210 500 282 180 564 244S828 568 1280 394"
          stroke="currentColor"
          strokeWidth="1.25"
          pathLength="100"
        />
        <path
          className="scholar-signal-line scholar-signal-line-delay-1"
          d="M-120 222C154 332 330 84 584 142S936 430 1300 226"
          stroke="var(--gold)"
          strokeOpacity="0.28"
          strokeWidth="1"
          pathLength="100"
        />
        <path
          className="scholar-signal-line scholar-signal-line-delay-2"
          d="M-60 654C284 376 504 670 746 502S1018 126 1270 180"
          stroke="var(--xp)"
          strokeOpacity="0.24"
          strokeWidth="1"
          pathLength="100"
        />
      </svg>
      <span className="scholar-signal-node absolute top-[27%] left-[22%] size-2 rounded-full bg-primary/40" />
      <span className="scholar-signal-node scholar-signal-node-delay absolute top-[58%] right-[24%] size-1.5 rounded-full bg-gold/50" />
      <span className="scholar-signal-node scholar-signal-node-delay-2 absolute bottom-[18%] left-[48%] size-1.5 rounded-full bg-xp/40" />
    </div>
  );
}
