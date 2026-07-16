import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Download, ArrowLeft } from "lucide-react";
import { tr } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamRaw, fetchParticipants, fetchExamQuestionsRaw } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/$examId/report")({
  component: ExamReportPage,
});

function ExamReportPage() {
  const { examId } = Route.useParams();
  const { data: exam } = useQuery({
    queryKey: ["exam", examId],
    queryFn: () => fetchExamRaw(examId),
  });
  const { data: participants } = useQuery({
    queryKey: ["exam-participants", examId],
    queryFn: () => fetchParticipants(examId),
  });
  const { data: questions } = useQuery({
    queryKey: ["exam-questions-raw", examId],
    queryFn: () => fetchExamQuestionsRaw(examId),
  });

  // get display names
  const userIds = (participants ?? []).map((p) => p.user_id);
  const { data: profiles } = useQuery({
    queryKey: ["exam-report-profiles", userIds],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
      return (data ?? []) as { id: string; display_name: string }[];
    },
    enabled: userIds.length > 0,
  });
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const maxScore = (questions ?? []).reduce((s, q) => s + q.points, 0);
  const submittedCount = (participants ?? []).filter((p) => p.submitted_at).length;
  const autoCount = (participants ?? []).filter((p) => p.auto_submitted).length;

  function exportCsv() {
    const rows = [
      [tr("ชื่อ"), tr("คะแนน"), `/${maxScore}`, tr("โกง"), tr("ส่งอัตโนมัติ"), tr("เหตุผล")],
      ...(participants ?? []).map((p) => [
        nameById.get(p.user_id) ?? p.user_id.slice(0, 8),
        String(p.total_score ?? ""),
        String(p.violation_count),
        p.auto_submitted ? tr("ใช่") : tr("ไม่"),
        p.auto_submit_reason ?? "",
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exam?.title ?? "exam"}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!exam || !participants)
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/exam/$examId" params={{ examId }}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">
          {tr("รายงาน: ")}
          {exam.title}
        </h1>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">
              {submittedCount}/{participants.length}
            </div>
            <div className="text-xs text-muted-foreground">{tr("ส่งแล้ว")}</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">{autoCount}</div>
            <div className="text-xs text-muted-foreground">{tr("ส่งอัตโนมัติ")}</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{maxScore}</div>
            <div className="text-xs text-muted-foreground">{tr("คะแนนเต็ม")}</div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={exportCsv} variant="outline">
          <Download className="size-4 mr-1" /> {tr("Export CSV")}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("นักเรียน")}</TableHead>
                <TableHead className="text-right">{tr("คะแนน")}</TableHead>
                <TableHead className="text-center">{tr("โกง")}</TableHead>
                <TableHead className="text-center">{tr("สถานะ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{nameById.get(p.user_id) ?? p.user_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {p.total_score ?? "--"} / {maxScore}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.violation_count > 0 ? (
                      <Badge variant="outline">⚠ {p.violation_count}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.auto_submitted ? (
                      <Badge variant="destructive">{tr("อัตโนมัติ")}</Badge>
                    ) : p.submitted_at ? (
                      <Badge>{tr("ส่งเอง")}</Badge>
                    ) : (
                      <Badge variant="outline">{tr("ยังไม่ส่ง")}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
