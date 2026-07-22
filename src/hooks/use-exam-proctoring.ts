import { useEffect, useRef, useState, useCallback } from "react";
import { rpcRecordViolation } from "@/lib/exam.functions";
import type { ViolationEventType } from "@/lib/exam.functions";
import { toast } from "sonner";
import { tr } from "@/i18n";

interface UseExamProctoringArgs {
  examId: string;
  enabled: boolean;
  threshold: number;
  onAutoSubmit: (reason: string) => void;
}

export interface ViolationLogEntry {
  type: ViolationEventType;
  reason: string;
  at: number;
}

interface UseExamProctoringReturn {
  violationCount: number;
  isFullscreenActive: boolean;
  violationLog: ViolationLogEntry[];
  requestFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

export function useExamProctoring({
  examId,
  enabled,
  threshold,
  onAutoSubmit,
}: UseExamProctoringArgs): UseExamProctoringReturn {
  const [violationCount, setViolationCount] = useState(0);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const lastEventRef = useRef<Record<string, number>>({});
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  const recordViolation = useCallback(
    async (eventType: ViolationEventType) => {
      // debounce: skip if same event type fired within 500ms
      const now = Date.now();
      const last = lastEventRef.current[eventType] ?? 0;
      if (now - last < 500) return;
      lastEventRef.current[eventType] = now;

      // Optimistic UI bump so the student sees the count even if RPC is slow/failing
      setViolationCount((c) => c + 1);

      try {
        const result = await rpcRecordViolation({ exam_id: examId, event_type: eventType });
        setViolationCount(result.violation_count);
        if (result.violation_count < threshold) {
          toast.warning(
            tr("⚠ ออกจากหน้าสอบ ") +
              `${result.violation_count}/${threshold}` +
              tr(" ครั้ง — ครบ ") +
              `${threshold}` +
              tr(" ครั้งจะส่งอัตโนมัติ"),
          );
        }
        if (result.auto_submitted) {
          onAutoSubmitRef.current("violation_threshold");
        }
      } catch (err) {
        // network/permission error — don't block exam, just log
        console.error("Failed to record violation:", err);
      }
    },
    [examId, threshold],
  );


  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.hidden) recordViolation("visibility_change");
    };
    const onBlur = () => recordViolation("blur");
    const onFsChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreenActive(active);
      if (!active) recordViolation("fullscreen_exit");
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      recordViolation("copy_paste");
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      recordViolation("copy_paste");
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    // Warn on refresh / close / navigate-away — browsers show a native confirm dialog
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    // Block back / forward — re-push current state and count as violation
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      recordViolation("other");
    };
    // Block reload shortcuts (F5, Ctrl/Cmd+R, Ctrl+Shift+R) and DevTools shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isReload = key === "f5" || ((e.ctrlKey || e.metaKey) && key === "r");
      const isDevTools =
        key === "f12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === "i" || key === "j" || key === "c")) ||
        ((e.ctrlKey || e.metaKey) && key === "u"); // view-source
      if (isReload) {
        e.preventDefault();
        e.stopPropagation();
        recordViolation("other");
      } else if (isDevTools) {
        e.preventDefault();
        e.stopPropagation();
        recordViolation("dev_tools");
      }
    };

    // Seed a history entry so popstate has something to catch
    window.history.pushState(null, "", window.location.href);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContext);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContext);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions);
    };
  }, [enabled, recordViolation]);

  // Safety net: poll fullscreen state — some browsers/OS combos skip fullscreenchange
  // when leaving fullscreen (e.g. via ESC held, window resize, taskbar). If we detect
  // the transition from active→inactive here, record it explicitly.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const active = !!document.fullscreenElement;
      if (wasActiveRef.current && !active) {
        setIsFullscreenActive(false);
        recordViolation("fullscreen_exit");
      }
      wasActiveRef.current = active;
    }, 750);
    return () => clearInterval(id);
  }, [enabled, recordViolation]);



  const requestFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreenActive(true);
    } catch {
      toast.error(tr("ไม่สามารถเข้าโหมดเต็มจอได้ — กรุณาอนุญาตในเบราว์เซอร์"));
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      setIsFullscreenActive(false);
    } catch {
      /* ignore */
    }
  }, []);

  return { violationCount, isFullscreenActive, requestFullscreen, exitFullscreen };
}
