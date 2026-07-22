// Decorative floating gradient blobs. Purely presentational, pointer-events: none.
// Respects prefers-reduced-motion via CSS keyframes defined in styles.css.
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "primary" | "warm" | "cool";
}

export function AnimatedBackground({ className, variant = "primary" }: Props) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "motion-blob absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full opacity-40 blur-3xl",
          variant === "primary" && "bg-[radial-gradient(circle_at_30%_30%,var(--primary),transparent_70%)]",
          variant === "warm" && "bg-[radial-gradient(circle_at_30%_30%,var(--gold),transparent_70%)]",
          variant === "cool" && "bg-[radial-gradient(circle_at_30%_30%,var(--xp),transparent_70%)]",
        )}
      />
      <div
        className="motion-blob motion-blob-delay absolute top-40 right-[-120px] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle_at_60%_40%,var(--gold),transparent_70%)] opacity-30 blur-3xl"
      />
      <div
        className="motion-blob motion-blob-delay-2 absolute bottom-[-100px] left-1/3 h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle_at_50%_50%,var(--xp),transparent_70%)] opacity-25 blur-3xl"
      />
      <div className="motion-grid absolute inset-0 opacity-[0.035]" />
    </div>
  );
}
