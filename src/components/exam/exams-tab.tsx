import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, FileText, FlaskConical, ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { rpcDeleteExam } from "@/lib/exam.functions";
import type { ExamSessionRow } from "@/lib/exam.functions";


interface ExamsTabProps {
  classroomId: string;
  isOwner: boolean;
}

function statusBadge(status: string) {
  const map: Record<
    string,
    { label: string; variant: "secondary" | "default" | "destructive" | "outline" }
  > = {
    draft: { label: tr("ฉบับร่าง"), variant: "secondary" },
    scheduled: { label: tr("รอเปิดสอบ"), variant: "outline" },
    active: { label: tr("กำลังสอบ"), variant: "default" },
    closed: { label: tr("ปิดแล้ว"), variant: "destructive" },
  };
  const m = map[status] ?? map.draft;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function ExamsTab({ classroomId, isOwner }: ExamsTabProps) {
  const { data: exams, isLoading } = useQuery({
    queryKey: ["classroom-exams", classroomId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_sessions")
        .select("*")
        .eq("classroom_id", classroomId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ExamSessionRow[];
    },
  });

  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (id: string) => rpcDeleteExam(id),
    onSuccess: () => {
      toast.success(tr("ลบข้อสอบแล้ว"));
      qc.invalidateQueries({ queryKey: ["classroom-exams", classroomId] });
    },
    onError: (e: unknown) =>
      toast.error(tr("ลบไม่สำเร็จ: ") + (e instanceof Error ? e.message : String(e))),
  });


  return (
    <div className="space-y-4 mt-4">
      {/* Demo test banner — มองเห็นได้ทั้งครูและนักเรียน */}
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="pt-6 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary/15 grid place-items-center shrink-0">
              <FlaskConical className="size-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{tr("ทดสอบระบบสอบก่อนขึ้นจริง")}</p>
              <p className="text-sm text-muted-foreground">
                {tr(
                  "ลองหน้าจอสอบ + ระบบป้องกันการโกง (fullscreen, counter, แจ้งเตือน) — ไม่มีการบันทึกคะแนนจริง",
                )}
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to={"/exam/demo" as string}>
              <FlaskConical className="size-4 mr-1" />
              {tr("เริ่มทดสอบ")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      {isOwner && (
        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link to="/exam/new" search={{ classroom: classroomId }}>
              <Plus className="size-4 mr-1" />
              {tr("สร้างข้อสอบ")}
            </Link>
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : !exams || exams.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <FileText className="size-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {isOwner
                ? tr("ยังไม่มีข้อสอบในห้องนี้ — กด 'สร้างข้อสอบ' ด้านบน")
                : tr("ยังไม่มีข้อสอบในห้องนี้")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {exams.map((exam) => (
            <Card key={exam.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{exam.title}</CardTitle>
                  {statusBadge(exam.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground space-y-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    {tr("รหัส")}: <code className="font-mono">{exam.join_code}</code>
                  </span>
                  <span>
                    {tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")}
                  </span>
                  <span>
                    {tr("โกงสูงสุด")} {exam.violation_threshold} {tr("ครั้ง")}
                  </span>
                  {exam.starts_at && (
                    <span>
                      {tr("เปิด")}: {new Date(exam.starts_at).toLocaleString("th-TH")}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {isOwner ? (
                    <>
                      <Button asChild size="sm" variant="outline">
                        <Link to="/exam/$examId" params={{ examId: exam.id }}>
                          <ExternalLink className="size-3 mr-1" />
                          {tr("จัดการ")}
                        </Link>
                      </Button>
                      {exam.status === "closed" && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/exam/$examId/report" params={{ examId: exam.id }}>
                            {tr("รายงาน")}
                          </Link>
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="size-3 mr-1" />
                            {tr("ลบ")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{tr("ลบข้อสอบ?")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {tr("จะลบข้อสอบ \"")}
                              {exam.title}
                              {tr("\" พร้อมคำถาม คำตอบ และผู้เข้าสอบทั้งหมดอย่างถาวร — ไม่สามารถกู้คืนได้")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tr("ยกเลิก")}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90"
                              onClick={() => deleteMut.mutate(exam.id)}
                            >
                              {tr("ลบถาวร")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                    </>
                  ) : exam.status === "active" ? (
                    <Button asChild size="sm">
                      <Link to="/exam/$examId" params={{ examId: exam.id }}>
                        {tr("เข้าสอบ")}
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {exam.status === "scheduled"
                        ? tr("ยังไม่เปิดสอบ")
                        : exam.status === "closed"
                          ? tr("ปิดสอบแล้ว")
                          : tr("รอครูเปิดสอบ")}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
