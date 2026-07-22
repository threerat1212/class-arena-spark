import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface KineticHeadingProps {
  lines: string[];
  ariaLabel: string;
  accentLine?: number;
  className?: string;
}

export function KineticHeading({
  lines,
  ariaLabel,
  accentLine = lines.length - 1,
  className,
}: KineticHeadingProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <h1 aria-label={ariaLabel} className={cn("text-balance", className)}>
      {lines.map((line, index) => (
        <span key={line} aria-hidden className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className={cn("block", index === accentLine && "text-primary")}
            initial={shouldReduceMotion ? false : { opacity: 0.76, y: "42%", filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.62,
              delay: shouldReduceMotion ? 0 : index * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}
