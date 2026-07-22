// IntersectionObserver-based reveal. Fires once when element enters viewport.
// Direction + delay let callers stagger without pulling in motion for simple cases.
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type Direction = "up" | "down" | "left" | "right" | "scale" | "fade";

interface ScrollRevealProps {
  children: ReactNode;
  direction?: Direction;
  delay?: number;
  duration?: number;
  className?: string;
  as?: "div" | "section" | "article" | "li" | "header" | "footer" | "aside";
  threshold?: number;
  once?: boolean;
}

const initialTransform: Record<Direction, string> = {
  up: "translate3d(0, 16px, 0)",
  down: "translate3d(0, -16px, 0)",
  left: "translate3d(16px, 0, 0)",
  right: "translate3d(-16px, 0, 0)",
  scale: "scale(0.975)",
  fade: "none",
};

export function ScrollReveal({
  children,
  direction = "up",
  delay = 0,
  duration = 460,
  className,
  as: Tag = "div",
  threshold = 0.15,
  once = true,
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      { threshold, rootMargin: "0px 0px -60px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [threshold, once]);

  const style: CSSProperties = {
    opacity: visible || shouldReduceMotion ? 1 : 0.82,
    transform: visible || shouldReduceMotion ? "none" : initialTransform[direction],
    transition: shouldReduceMotion
      ? "none"
      : `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
    willChange: !visible && !shouldReduceMotion ? "opacity, transform" : undefined,
  };

  const Component = Tag as React.ElementType;
  return (
    <Component ref={ref as React.Ref<HTMLElement>} style={style} className={cn(className)}>
      {children}
    </Component>
  );
}
