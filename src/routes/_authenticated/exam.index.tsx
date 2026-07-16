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
    return (
      <div className="container max-w-3xl py-6">
        <p className="text-muted-foreground">
          {tr("หน้านี้สำหรับครูเท่านั้น — นักเรียนใช้การเข้าสอบด้วยรหัส")}
        </p>
        <Button asChild className="mt-4">
          <Link to="/exam/join">{tr("เข้าสอบด้วยรหัส")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr("📝 การสอบ")}</h1>
        <Button asChild>
          <Link to="/exam/new">
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
