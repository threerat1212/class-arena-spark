import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import { fetchTeacherExams } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/")({
  component: ExamIndexPage,
});

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

function ExamIndexPage() {
  const { user, roles } = useAuth();
  const isTeacher = roles.includes("teacher") || roles.includes("admin");

  const { data: classrooms } = useQuery({
    queryKey: ["my-classrooms-as-owner", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classrooms")
        .select("id, name")
        .eq("owner_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && isTeacher,
  });

  const { data: exams, isLoading } = useQuery({
    queryKey: ["teacher-exams", classrooms?.map((c) => c.id)],
    queryFn: () => fetchTeacherExams(classrooms!.map((c) => c.id)),
    enabled: !!classrooms && classrooms.length > 0,
  });

  if (!isTeacher) {
    return <StudentExamsList />;
  }


  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr("📝 การสอบ")}</h1>
        <Button asChild>
          <Link to="/exam/new" search={{ classroom: "" }}>
            <Plus className="size-4 mr-1" />
            {tr("สร้างข้อสอบ")}
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : !exams || exams.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="size-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{tr("ยังไม่มีข้อสอบ — สร้างข้อสอบแรกของคุณ")}</p>
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
              <CardContent className="pt-0 text-sm text-muted-foreground">
                <span>
                  {tr("รหัสเข้าร่วม")}: <code className="font-mono">{exam.join_code}</code>
                </span>
                {" · "}
                <span>
                  {tr("ระยะเวลา")} {exam.duration_minutes} {tr("นาที")}
                </span>
                {" · "}
                <span>
                  {tr("โกงสูงสุด")} {exam.violation_threshold} {tr("ครั้ง")}
                </span>
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/exam/$examId" params={{ examId: exam.id }}>
                      {tr("เปิด")}
                    </Link>
                  </Button>
                  {exam.status === "closed" && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/exam/$examId/report" params={{ examId: exam.id }}>
                        {tr("รายงาน")}
                      </Link>
                    </Button>
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

function StudentExamsList() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["my-exam-results", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: parts, error } = await supabase
        .from("exam_participants")
        .select("id, session_id, total_score, submitted_at, started_at, auto_submitted, auto_submit_reason, violation_count")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (parts ?? []).map((p) => p.session_id);
      if (ids.length === 0) return [] as Array<{ id: string; title: string; status: string; total_score: number | null; submitted_at: string | null; auto_submitted: boolean; auto_submit_reason: string | null; violation_count: number; max_points: number }>;
      const [{ data: sessions }, { data: questions }] = await Promise.all([
        supabase.from("exam_sessions").select("id, title, status").in("id", ids),
        supabase.from("exam_questions_safe").select("session_id, points").in("session_id", ids),
      ]);
      const maxByExam = new Map<string, number>();
      for (const q of questions ?? []) {
        maxByExam.set(q.session_id, (maxByExam.get(q.session_id) ?? 0) + (q.points ?? 0));
      }
      const sessMap = new Map((sessions ?? []).map((s) => [s.id, s]));
      return (parts ?? []).map((p) => {
        const s = sessMap.get(p.session_id);
        return {
          id: p.session_id,
          title: s?.title ?? "-",
          status: s?.status ?? "-",
          total_score: p.total_score,
          submitted_at: p.submitted_at,
          auto_submitted: p.auto_submitted,
          auto_submit_reason: p.auto_submit_reason,
          violation_count: p.violation_count,
          max_points: maxByExam.get(p.session_id) ?? 0,
        };
      });
    },
  });

  return (
    <div className="container max-w-3xl py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr("📝 คะแนนสอบของฉัน")}</h1>
        <Button asChild>
          <Link to="/exam/join">{tr("เข้าสอบด้วยรหัส")}</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="size-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{tr("ยังไม่มีประวัติการสอบ")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map((row) => {
            const done = !!row.submitted_at;
            const pct = row.max_points > 0 && row.total_score != null
              ? Math.round((Number(row.total_score) / row.max_points) * 100)
              : null;
            return (
              <Card key={row.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{row.title}</CardTitle>
                    {done ? (
                      <Badge variant="default">{tr("ส่งแล้ว")}</Badge>
                    ) : (
                      <Badge variant="secondary">{tr("ยังไม่ส่ง")}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 text-sm">
                  {done ? (
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-2xl font-bold text-primary">
                        {row.total_score ?? "--"}
                      </span>
                      {row.max_points > 0 && (
                        <span className="text-muted-foreground">/ {row.max_points}</span>
                      )}
                      {pct != null && (
                        <Badge variant="outline">{pct}%</Badge>
                      )}
                      {row.auto_submitted && (
                        <Badge variant="destructive" className="ml-1">
                          {row.auto_submit_reason === "violation_threshold"
                            ? tr("ส่งอัตโนมัติ (โกงครบ)")
                            : tr("ส่งอัตโนมัติ (หมดเวลา)")}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      {tr("ยังทำไม่เสร็จ — กดเปิดเพื่อทำต่อ")}
                    </p>
                  )}
                  <div className="mt-3">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/exam/$examId" params={{ examId: row.id }}>
                        {tr("เปิด")}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

