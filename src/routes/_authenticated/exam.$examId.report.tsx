import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Download, ArrowLeft, Eye, Check, X } from "lucide-react";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchExamRaw,
  fetchParticipants,
  fetchExamQuestionsRaw,
  fetchShortAnswersForGrading,
  fetchStudentAnswers,
  rpcGradeShortAnswer,
  type ShortAnswerForGrading,
  type ExamQuestionRow,
  type ExamAnswerRow,
} from "@/lib/exam.functions";


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

  const { data: shortAnswers } = useQuery({
    queryKey: ["exam-short-answers", examId],
    queryFn: () => fetchShortAnswersForGrading(examId),
    enabled: !!examId,
  });

  const [detailUserId, setDetailUserId] = useState<string | null>(null);



  const queryClient = useQueryClient();
  const gradeMutation = useMutation({
    mutationFn: rpcGradeShortAnswer,
    onSuccess: () => {
      toast.success(tr("บันทึกคะแนนเรียบร้อย"));
      queryClient.invalidateQueries({ queryKey: ["exam-participants", examId] });
      queryClient.invalidateQueries({ queryKey: ["exam-short-answers", examId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : tr("บันทึกไม่สำเร็จ"));
    },
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
      [
        tr("ชื่อ"),
        tr("คะแนน"),
        `/${maxScore}`,
        tr("โกง"),
        tr("ส่งอัตโนมัติ"),
        tr("เหตุผล"),
      ],
      ...(participants ?? []).map((p) => [
        nameById.get(p.user_id) ?? p.user_id.slice(0, 8),
        String(p.total_score ?? ""),
        "",
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
                <TableHead className="text-right">{tr("รายละเอียด")}</TableHead>
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
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDetailUserId(p.user_id)}
                      disabled={!p.submitted_at}
                    >
                      <Eye className="size-4 mr-1" />
                      {tr("ดูคำตอบ")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}

            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {shortAnswers && shortAnswers.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr("ตรวจข้อเขียนด้วยมือ")}</h2>
              <Badge variant="outline">
                {shortAnswers.filter((s) => s.answer.graded_by !== "teacher").length}{" "}
                {tr("รอตรวจ")}
              </Badge>
            </div>
            <div className="space-y-3">
              {shortAnswers.map((item) => (
                <ManualGradeRow
                  key={`${item.answer.question_id}-${item.answer.user_id}-${item.answer.graded_at ?? "null"}`}
                  item={item}
                  displayName={
                    nameById.get(item.answer.user_id) ?? item.answer.user_id.slice(0, 8)
                  }
                  isGrading={
                    gradeMutation.isPending &&
                    gradeMutation.variables?.question_id === item.answer.question_id &&
                    gradeMutation.variables?.user_id === item.answer.user_id
                  }
                  onGrade={(score, isCorrect) =>
                    gradeMutation.mutate({
                      question_id: item.answer.question_id,
                      user_id: item.answer.user_id,
                      score,
                      is_correct: isCorrect,
                    })
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ManualGradeRow({
  item,
  displayName,
  isGrading,
  onGrade,
}: {
  item: ShortAnswerForGrading;
  displayName: string;
  isGrading: boolean;
  onGrade: (score: number, isCorrect: boolean) => void;
}) {
  const maxPoints = item.question.points;
  const [scoreInput, setScoreInput] = useState(
    String(item.answer.score_awarded ?? 0),
  );

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 text-sm">
        <div className="font-medium">
          {displayName}
          <span className="text-muted-foreground ml-2">
            — ข้อ {item.question.idx + 1} ({maxPoints} {tr("คะแนน")})
          </span>
        </div>
        {item.answer.graded_by === "ai" && (
          <Badge variant="secondary">AI: {item.answer.score_awarded}</Badge>
        )}
        {item.answer.graded_by === "teacher" && (
          <Badge variant="default">{tr("ตรวจแล้ว")}</Badge>
        )}
        {item.answer.graded_by === null && (
          <Badge variant="outline">{tr("รอตรวจ")}</Badge>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <strong>{tr("โจทย์")}:</strong> {item.question.question}
      </div>
      {item.question.expected_answer && (
        <div className="text-xs text-muted-foreground">
          <strong>{tr("เกณฑ์")}:</strong> {item.question.expected_answer}
        </div>
      )}
      <div className="bg-muted/50 rounded p-2 text-sm whitespace-pre-wrap">
        {item.answer.answer_text || <em className="text-muted-foreground">—</em>}
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={maxPoints}
          value={scoreInput}
          onChange={(e) => setScoreInput(e.target.value)}
          className="w-24"
          disabled={isGrading}
          aria-label={`${tr("คะแนน")} / ${maxPoints}`}
        />
        <span className="text-sm text-muted-foreground">/ {maxPoints}</span>
        <Button
          size="sm"
          disabled={isGrading}
          onClick={() => {
            const score = Math.max(0, Math.min(maxPoints, Number(scoreInput) || 0));
            onGrade(score, score >= maxPoints * 0.5);
          }}
        >
          {item.answer.graded_by === "teacher" ? tr("แก้ไข") : tr("บันทึก")}
        </Button>
      </div>
    </div>
  );
}
