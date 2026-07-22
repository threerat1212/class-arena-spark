import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, Camera } from "lucide-react";
import { tr } from "@/i18n";
import {
  fetchProctoringEventsForUser,
  createSnapshotSignedUrl,
  type ExamProctoringEventRow,
} from "@/lib/exam.functions";

const REASON_LABELS: Record<string, string> = {
  visibility_change: tr("สลับแท็บ / ย่อจอ / เปลี่ยนหน้าต่าง"),
  blur: tr("คลิกออกนอกหน้าสอบ (สูญเสียโฟกัส)"),
  fullscreen_exit: tr("ออกจากโหมดเต็มจอ"),
  copy_paste: tr("พยายามคัดลอก / วาง"),
  dev_tools: tr("พยายามเปิด DevTools"),
  other: tr("พยายามรีเฟรช / กด Back / Forward"),
};

interface Props {
  examId: string;
  userId: string | null;
  displayName: string;
  onOpenChange: (open: boolean) => void;
}

export function ViolationsDialog({ examId, userId, displayName, onOpenChange }: Props) {
  const open = !!userId;
  const { data: events, isLoading } = useQuery({
    queryKey: ["exam-violations", examId, userId],
    queryFn: () => fetchProctoringEventsForUser(examId, userId!),
    enabled: open,
  });

  // Count by type
  const counts: Record<string, number> = {};
  (events ?? []).forEach((e) => {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-600" />
            {tr("บันทึกการโกงของ")} {displayName}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !events || events.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            {tr("ไม่มีบันทึกการโกง")}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts).map(([type, n]) => (
                <Badge key={type} variant="outline">
                  {REASON_LABELS[type] ?? type}: {n}
                </Badge>
              ))}
              <Badge variant="destructive">
                {tr("รวม")} {events.length} {tr("ครั้ง")}
              </Badge>
            </div>

            {/* Event list */}
            <div className="space-y-3">
              {events.map((ev, i) => (
                <EventCard key={ev.id} idx={i + 1} event={ev} />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EventCard({ idx, event }: { idx: number; event: ExamProctoringEventRow }) {
  const [snapUrl, setSnapUrl] = useState<string | null>(null);
  const payload = (event.payload ?? {}) as { snapshot_path?: string; reason?: string };
  const snapshotPath = payload.snapshot_path;

  useEffect(() => {
    if (!snapshotPath) return;
    let cancelled = false;
    createSnapshotSignedUrl(snapshotPath).then((url) => {
      if (!cancelled) setSnapUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshotPath]);

  const reason = payload.reason ?? REASON_LABELS[event.event_type] ?? event.event_type;
  const time = new Date(event.created_at).toLocaleString();

  return (
    <div className="border rounded-lg p-3 flex gap-3">
      <div className="text-xs text-muted-foreground w-8 pt-1">#{idx}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="destructive" className="text-xs">
            {reason}
          </Badge>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
        {snapshotPath ? (
          snapUrl ? (
            <a href={snapUrl} target="_blank" rel="noreferrer" className="block mt-2">
              <img
                src={snapUrl}
                alt={reason}
                className="w-full max-w-md border rounded"
                loading="lazy"
              />
            </a>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> {tr("กำลังโหลดภาพ...")}
            </div>
          )
        ) : (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <Camera className="size-3" /> {tr("ไม่มีภาพหน้าจอ")}
          </div>
        )}
      </div>
    </div>
  );
}
