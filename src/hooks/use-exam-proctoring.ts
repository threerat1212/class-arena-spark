import { useEffect, useRef, useState, useCallback } from "react";
import { rpcRecordViolation } from "@/lib/exam.functions";
import type { ViolationEventType } from "@/lib/exam.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { tr } from "@/i18n";

// Best-effort DOM snapshot; fire-and-forget so it never blocks the exam UI.
async function captureAndUploadSnapshot(
  examId: string,
  userId: string,
  eventType: string,
): Promise<string | null> {
  try {
    const { default: html2canvas } = await import("html2canvas-pro");
    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      backgroundColor: "#ffffff",
      // downscale for smaller uploads
      scale: Math.min(1, 1280 / Math.max(1, window.innerWidth)),
      ignoreElements: (el) => el.tagName === "VIDEO" || el.tagName === "IFRAME",
    });
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.6),
    );
    if (!blob) return null;
    const path = `${examId}/${userId}/${Date.now()}_${eventType}.jpg`;
    const { error } = await supabase.storage
      .from("exam-violations")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.warn("snapshot upload failed", error);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("snapshot capture failed", e);
    return null;
  }
}

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
  const [violationLog, setViolationLog] = useState<ViolationLogEntry[]>([]);
  const lastEventRef = useRef<Record<string, number>>({});
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  const reasonForEvent = (t: ViolationEventType): string => {
    switch (t) {
      case "visibility_change":
        return tr("สลับแท็บ / ย่อจอ / เปลี่ยนหน้าต่าง");
      case "blur":
        return tr("คลิกออกนอกหน้าสอบ (สูญเสียโฟกัส)");
      case "fullscreen_exit":
        return tr("ออกจากโหมดเต็มจอ");
      case "copy_paste":
        return tr("พยายามคัดลอก / วาง");
      case "dev_tools":
        return tr("พยายามเปิด DevTools (F12 / Ctrl+Shift+I)");
      case "other":
        return tr("พยายามรีเฟรช / กด Back / Forward");
      default:
        return tr("พฤติกรรมน่าสงสัย");
    }
  };

  const recordViolation = useCallback(
    async (eventType: ViolationEventType) => {
      // debounce: skip if same event type fired within 500ms
      const now = Date.now();
      const last = lastEventRef.current[eventType] ?? 0;
      if (now - last < 500) return;
      lastEventRef.current[eventType] = now;

      // Optimistic UI bump so the student sees the count even if RPC is slow/failing
      setViolationCount((c) => c + 1);
      setViolationLog((log) => [
        ...log,
        { type: eventType, reason: reasonForEvent(eventType), at: now },
      ]);

      // Fire-and-forget snapshot; attach path to the RPC payload when it lands in time.
      let snapshotPath: string | null = null;
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user?.id;
        if (uid) {
          // Only snapshot once per second per event type across all events (throttle)
          snapshotPath = await captureAndUploadSnapshot(examId, uid, eventType);
        }
      } catch {
        /* ignore */
      }

      try {
        const result = await rpcRecordViolation({
          exam_id: examId,
          event_type: eventType,
          payload: {
            at: now,
            user_agent: navigator.userAgent,
            reason: reasonForEvent(eventType),
            ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
          },
        });
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

  return { violationCount, isFullscreenActive, violationLog, requestFullscreen, exitFullscreen };
}
