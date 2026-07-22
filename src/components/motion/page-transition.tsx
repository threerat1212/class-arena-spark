// Wrap public route <Outlet /> so navigation between pages fades + rises,
// matching the authenticated shell's AnimatePresence transition.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="sync" initial={false}>
      <motion.div
        key={pathname}
        initial={shouldReduceMotion ? false : { opacity: 0.88 }}
        animate={{ opacity: 1 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
