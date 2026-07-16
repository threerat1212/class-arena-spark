import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Coins,
  Zap,
  Award,
  Crown,
  BookOpen,
  ClipboardList,
  Calendar,
  Users,
  Sparkles,
  ArrowRight,
  DoorOpen,
  ShieldCheck,
  CheckCircle2,
  GraduationCap,
  UserCog,
  Clock,
  TrendingUp,
  Activity,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DailyBonusCard } from "@/components/daily-bonus-card";
import { GamificationStatusPanel } from "@/components/gamification-status-panel";
import { RecentActivityCard } from "@/components/recent-activity-card";
import { ClassroomHallOfFame, GradeLeaderboard } from "@/components/showcase-sections";
import type { Database } from "@/integrations/supabase/types";

import { tr } from "@/i18n";
export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type AttendanceRecordRow = Pick<
  Database["public"]["Tables"]["attendance_records"]["Row"],
  "status" | "marked_at" | "session_id"
>;
type AttendanceSessionWithClassroom = Pick<
  Database["public"]["Tables"]["attendance_sessions"]["Row"],
  "id" | "title" | "session_date" | "classroom_id"
> & {
  classrooms?: { name: string | null } | null;
};
type AttendanceHistoryRow = AttendanceRecordRow & {
  session?: AttendanceSessionWithClassroom;
};
type ProfileNameRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "display_name">;
type RoomNameRow = Pick<Database["public"]["Tables"]["rooms"]["Row"], "id" | "name">;
type ClassroomMemberRow = Pick<
  Database["public"]["Tables"]["classroom_members"]["Row"],
  "classroom_id"
>;
type BookingActivityRow = Pick<
  Database["public"]["Tables"]["bookings"]["Row"],
  "id" | "purpose" | "status" | "created_at" | "starts_at" | "user_id" | "guest_name"
>;
type QuestActivityRow = Pick<
  Database["public"]["Tables"]["daily_quest_attempts"]["Row"],
  "id" | "completed_at" | "score" | "max_score" | "xp_awarded" | "gold_awarded" | "user_id"
>;
type SubmissionActivityRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "id" | "submitted_at" | "graded_at" | "score" | "is_late" | "user_id"
>;
type UserActivityRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "created_at" | "level" | "xp"
>;
type ActivityEvent = {
  id: string;
  kind: "booking" | "quest" | "submission" | "user";
  title: string;
  detail: string;
  at: string;
  badge: string;
  tone: "primary" | "amber" | "emerald" | "slate";
};

function Dashboard() {
  const { user, roles } = useAuth();
  if (roles.includes("room_admin") && !roles.includes("admin") && !roles.includes("teacher") && !roles.includes("student")) {
    return <Navigate to="/bookings" />;
  }
  const primary: "admin" | "teacher" | "student" = roles.includes("admin")
    ? "admin"
    : roles.includes("teacher")
      ? "teacher"
      : "student";

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10 space-y-8">
      <header>
        <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary capitalize">
          {primary} workspace
        </div>
        <h1 className="mt-3 text-4xl font-semibold">
          {tr("สวัสดี")}, {profile?.display_name ?? tr("ผู้ใช้")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {primary === "student" && tr("ภาพรวมความก้าวหน้าและกิจกรรมของคุณ")}
          {primary === "teacher" && tr("ภาพรวมห้องเรียนและงานของคุณ")}
          {primary === "admin" && tr("ภาพรวมระบบและการอนุมัติ")}
        </p>
      </header>

      {primary === "student" && <StudentDashboard userId={user!.id} profile={profile} />}
      {primary === "teacher" && <TeacherDashboard userId={user!.id} />}
      {primary === "admin" && <AdminDashboard />}
    </div>
  );
}

/* ---------- STUDENT ---------- */
function StudentDashboard({ userId, profile }: { userId: string; profile?: ProfileRow | null }) {
  const { data: badgeCount } = useQuery({
    queryKey: ["badge-count", userId],
    queryFn: async () => {
      const { count } = await supabase
        .from("user_badges")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      return count ?? 0;
    },
  });
  const { data: achievementCount } = useQuery({
    queryKey: ["ach-count", userId],
    queryFn: async () => {
      const { count } = await supabase
        .from("user_achievements")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      return count ?? 0;
    },
  });

  const xp = profile?.xp ?? 0;
  const level = profile?.level ?? 1;

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-2">
        <ClassroomHallOfFame userId={userId} />
        <GradeLeaderboard userId={userId} />
      </section>

      <DailyBonusCard profile={profile} />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Zap className="size-5" style={{ color: "var(--xp)" }} />}
          label={tr("XP รวม")}
          value={xp.toLocaleString()}
        />
        <Stat
          icon={<Coins className="size-5" style={{ color: "var(--gold)" }} />}
          label={tr("เหรียญทอง")}
          value={(profile?.gold ?? 0).toLocaleString()}
        />
        <Stat
          icon={<Crown className="size-5 text-primary" />}
          label={tr("เลเวล")}
          value={String(level)}
        />
        <Stat
          icon={<Award className="size-5 text-primary" />}
          label={tr("เหรียญตรา / Achievement")}
          value={`${badgeCount ?? 0} / ${achievementCount ?? 0}`}
        />
      </section>

      <GamificationStatusPanel
        profile={profile}
        badgeCount={badgeCount ?? 0}
        achievementCount={achievementCount ?? 0}
      />

      <RecentActivityCard />

      <AttendanceHistoryCard userId={userId} />

      <section className="grid gap-4 md:grid-cols-3">
        <QuickLink
          to="/classrooms"
          icon={<BookOpen className="size-5" />}
          title={tr("ห้องเรียนของฉัน")}
          desc={tr("เข้าเรียน ส่งงาน")}
        />
        <QuickLink
          to="/weekly-missions"
          icon={<Sparkles className="size-5" />}
          title={tr("ภารกิจสัปดาห์")}
          desc={tr("ดูงานหลัก, Practice Quest และ Flashcard")}
        />
        <QuickLink
          to="/hall-of-fame"
          icon={<Crown className="size-5" />}
          title="Hall of Fame"
          desc={tr("ดูอันดับนักเรียน")}
        />
      </section>
    </>
  );
}

function AttendanceHistoryCard({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-attendance-history", userId],
    queryFn: async () => {
      const { data: recs, error } = await supabase
        .from("attendance_records")
        .select("status, marked_at, session_id")
        .eq("user_id", userId)
        .order("marked_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      const sessionIds = Array.from(new Set((recs ?? []).map((r) => r.session_id)));
      if (sessionIds.length === 0) return [];
      const { data: sess } = await supabase
        .from("attendance_sessions")
        .select("id, title, session_date, classroom_id, classrooms(name)")
        .in("id", sessionIds);
      const byId = new Map(
        ((sess ?? []) as AttendanceSessionWithClassroom[]).map((s) => [s.id, s]),
      );
      return ((recs ?? []) as AttendanceRecordRow[]).map(
        (r): AttendanceHistoryRow => ({ ...r, session: byId.get(r.session_id) }),
      );
    },
  });

  const xpFor = (s: string) => (s === "present" ? 15 : s === "late" ? 5 : 0);
  const goldFor = (s: string) => (s === "present" ? 5 : s === "late" ? 2 : 0);
  const labelFor = (s: string) =>
    s === "present" ? tr("มา") : s === "late" ? tr("สาย") : s === "excused" ? tr("ลา") : tr("ขาด");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <CheckCircle2 className="size-5 text-primary" />
          {tr("ประวัติการเช็กชื่อ")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{tr("กำลังโหลด…")}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("ยังไม่มีประวัติการเช็กชื่อ")}</p>
        ) : (
          <ul className="divide-y">
            {data.map((r, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {r.session?.classrooms?.name ?? "—"} • {r.session?.title ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.marked_at
                      ? new Date(r.marked_at).toLocaleString("th-TH", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={
                      r.status === "present"
                        ? "default"
                        : r.status === "late"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {labelFor(r.status)}
                  </Badge>
                  {xpFor(r.status) > 0 && (
                    <span className="text-xs text-muted-foreground">
                      +{xpFor(r.status)} XP · +{goldFor(r.status)} {tr("ทอง")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- TEACHER ---------- */
function TeacherDashboard({ userId }: { userId: string }) {
  const { data: classrooms } = useQuery({
    queryKey: ["teacher-classrooms", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("classrooms")
        .select("id, name, subject")
        .eq("owner_id", userId);
      return data ?? [];
    },
  });
  const classroomIds = classrooms?.map((c) => c.id) ?? [];

  const { data: studentCount } = useQuery({
    queryKey: ["teacher-students", userId, classroomIds.join(",")],
    queryFn: async () => {
      if (classroomIds.length === 0) return 0;
      const { count } = await supabase
        .from("classroom_members")
        .select("*", { count: "exact", head: true })
        .in("classroom_id", classroomIds);
      return count ?? 0;
    },
    enabled: !!classrooms,
  });

  const { data: assignmentIds } = useQuery({
    queryKey: ["teacher-assignment-ids", classroomIds.join(",")],
    queryFn: async () => {
      if (classroomIds.length === 0) return [] as string[];
      const { data } = await supabase
        .from("assignments")
        .select("id")
        .in("classroom_id", classroomIds);
      return (data ?? []).map((a) => a.id);
    },
    enabled: !!classrooms,
  });

  const { data: pendingGrades } = useQuery({
    queryKey: ["teacher-pending", (assignmentIds ?? []).join(",")],
    queryFn: async () => {
      if (!assignmentIds || assignmentIds.length === 0) return 0;
      const { count } = await supabase
        .from("submissions")
        .select("*", { count: "exact", head: true })
        .in("assignment_id", assignmentIds)
        .is("graded_at", null);
      return count ?? 0;
    },
    enabled: !!assignmentIds,
  });

  const { data: myBookings } = useQuery({
    queryKey: ["teacher-bookings", userId],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("id, status").eq("user_id", userId);
      return data ?? [];
    },
  });
  const pendingBookings = myBookings?.filter((b) => b.status === "pending").length ?? 0;

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<BookOpen className="size-5 text-primary" />}
          label={tr("ห้องเรียนที่สอน")}
          value={String(classrooms?.length ?? 0)}
        />
        <Stat
          icon={<Users className="size-5 text-primary" />}
          label={tr("นักเรียนรวม")}
          value={String(studentCount ?? 0)}
        />
        <Stat
          icon={<ClipboardList className="size-5 text-primary" />}
          label={tr("งานรอตรวจ")}
          value={String(pendingGrades ?? 0)}
        />
        <Stat
          icon={<Calendar className="size-5 text-primary" />}
          label={tr("การจองรออนุมัติ")}
          value={String(pendingBookings)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <QuickLink
          to="/classrooms"
          icon={<BookOpen className="size-5" />}
          title={tr("จัดการห้องเรียน")}
          desc={tr("สร้างห้อง / สั่งงาน / เช็กชื่อ")}
        />
        <QuickLink
          to="/bookings"
          icon={<Calendar className="size-5" />}
          title={tr("จองห้องประชุม")}
          desc={tr("ใช้สำหรับสอนพิเศษ ประชุม")}
        />
        <QuickLink
          to="/profile"
          icon={<Sparkles className="size-5" />}
          title={tr("โปรไฟล์ของฉัน")}
          desc={tr("แก้ไขข้อมูลของคุณ")}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">{tr("ห้องเรียนของฉัน")}</CardTitle>
        </CardHeader>
        <CardContent>
          {classrooms && classrooms.length > 0 ? (
            <ul className="divide-y">
              {classrooms.map((c) => (
                <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.subject ?? "—"} • {tr("รหัสเข้าร่วม")}: <JoinCode classroomId={c.id} />
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/classrooms/$id" params={{ id: c.id }}>
                      {tr("เปิด")}
                      <ArrowRight className="size-4 ml-1" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-muted-foreground">
              {tr("ยังไม่มีห้องเรียน")}{" "}
              <Link to="/classrooms" className="text-primary underline">
                {tr("สร้างห้องแรก")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ---------- ADMIN ---------- */
function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [
        users,
        rooms,
        classrooms,
        pending,
        approved,
        rejected,
        roles,
        teacherApps,
        newUsers7d,
        dqActive,
        dqAttempts7d,
        submissions,
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("rooms").select("*", { count: "exact", head: true }),
        supabase.from("classrooms").select("*", { count: "exact", head: true }),
        supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("status", "approved"),
        supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("status", "rejected"),
        supabase.from("user_roles").select("role"),
        supabase
          .from("teacher_applications")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .gte("created_at", since7d),
        supabase
          .from("daily_quests")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true),
        supabase
          .from("daily_quest_attempts")
          .select("*", { count: "exact", head: true })
          .gte("completed_at", since7d),
        supabase
          .from("submissions")
          .select("*", { count: "exact", head: true })
          .gte("submitted_at", since30d),
      ]);
      const roleRows = (roles.data ?? []) as { role: string }[];
      return {
        users: users.count ?? 0,
        rooms: rooms.count ?? 0,
        classrooms: classrooms.count ?? 0,
        pending: pending.count ?? 0,
        approved: approved.count ?? 0,
        rejected: rejected.count ?? 0,
        admins: roleRows.filter((r) => r.role === "admin").length,
        teachers: roleRows.filter((r) => r.role === "teacher").length,
        students: roleRows.filter((r) => r.role === "student").length,
        teacherApps: teacherApps.count ?? 0,
        newUsers7d: newUsers7d.count ?? 0,
        dqActive: dqActive.count ?? 0,
        dqAttempts7d: dqAttempts7d.count ?? 0,
        submissions30d: submissions.count ?? 0,
      };
    },
  });

  const { data: pendingBookings } = useQuery({
    queryKey: ["admin-pending-bookings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("id, purpose, starts_at, ends_at, user_id, guest_name, room_id")
        .eq("status", "pending")
        .order("starts_at", { ascending: true })
        .limit(5);
      const rows = data ?? [];
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]));
      const roomIds = Array.from(new Set(rows.map((r) => r.room_id)));
      const [profiles, roomsRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("id, display_name").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
        roomIds.length
          ? supabase.from("rooms").select("id, name").in("id", roomIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const pMap = new Map(
        ((profiles.data ?? []) as ProfileNameRow[]).map((p) => [p.id, p.display_name]),
      );
      const rMap = new Map(((roomsRes.data ?? []) as RoomNameRow[]).map((r) => [r.id, r.name]));
      return rows.map((r) => ({
        ...r,
        who: r.user_id ? (pMap.get(r.user_id) ?? "—") : (r.guest_name ?? tr("ผู้เยี่ยม")),
        room_name: rMap.get(r.room_id) ?? "—",
      }));
    },
  });

  const { data: recentUsers } = useQuery({
    queryKey: ["admin-recent-users"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, created_at, level, xp")
        .order("created_at", { ascending: false })
        .limit(6);
      return data ?? [];
    },
  });

  const { data: topClassrooms } = useQuery({
    queryKey: ["admin-top-classrooms"],
    queryFn: async () => {
      const { data: cls } = await supabase.from("classrooms").select("id, name, subject");
      const ids = (cls ?? []).map((c) => c.id);
      if (ids.length === 0) return [];
      const { data: mem } = await supabase
        .from("classroom_members")
        .select("classroom_id")
        .in("classroom_id", ids);
      const counts = new Map<string, number>();
      ((mem ?? []) as ClassroomMemberRow[]).forEach((m) =>
        counts.set(m.classroom_id, (counts.get(m.classroom_id) ?? 0) + 1),
      );
      return (cls ?? [])
        .map((c) => ({ ...c, members: counts.get(c.id) ?? 0 }))
        .sort((a, b) => b.members - a.members)
        .slice(0, 5);
    },
  });

  const totalRoles = (stats?.admins ?? 0) + (stats?.teachers ?? 0) + (stats?.students ?? 0);
  const pct = (n: number) => (totalRoles > 0 ? Math.round((n / totalRoles) * 100) : 0);

  return (
    <>
      {/* Hero stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Users className="size-5 text-primary" />}
          label={tr("ผู้ใช้ทั้งหมด")}
          value={String(stats?.users ?? 0)}
          hint={`+${stats?.newUsers7d ?? 0} ${tr("ใน 7 วัน")}`}
        />
        <Stat
          icon={<BookOpen className="size-5 text-primary" />}
          label={tr("ห้องเรียน")}
          value={String(stats?.classrooms ?? 0)}
          hint={`${stats?.dqActive ?? 0} ${tr("Practice Quest ที่เปิด")}`}
        />
        <Stat
          icon={<DoorOpen className="size-5 text-primary" />}
          label={tr("ห้องประชุม")}
          value={String(stats?.rooms ?? 0)}
          hint={`${stats?.approved ?? 0} ${tr("จองสำเร็จ")}`}
        />
        <Stat
          icon={<ShieldCheck className="size-5 text-primary" />}
          label={tr("รออนุมัติ")}
          value={String((stats?.pending ?? 0) + (stats?.teacherApps ?? 0))}
          hint={`${stats?.pending ?? 0} ${tr("จอง")} • ${stats?.teacherApps ?? 0} ${tr("สมัครครู")}`}
        />
      </section>

      <AdminActivityCenter />

      {/* Role breakdown + booking status */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <UserCog className="size-5 text-primary" />
              {tr("สัดส่วนผู้ใช้ตามบทบาท")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{tr("กำลังโหลด…")}</p>
            ) : (
              <>
                <RoleRow
                  icon={<ShieldCheck className="size-4" />}
                  label={tr("ผู้ดูแลระบบ")}
                  count={stats?.admins ?? 0}
                  pct={pct(stats?.admins ?? 0)}
                />
                <RoleRow
                  icon={<GraduationCap className="size-4" />}
                  label={tr("ครู")}
                  count={stats?.teachers ?? 0}
                  pct={pct(stats?.teachers ?? 0)}
                />
                <RoleRow
                  icon={<Users className="size-4" />}
                  label={tr("นักเรียน")}
                  count={stats?.students ?? 0}
                  pct={pct(stats?.students ?? 0)}
                />
                <div className="grid grid-cols-3 gap-3 pt-2 border-t">
                  <MiniStat
                    icon={<Activity className="size-4" />}
                    label={tr("Practice Quest (7 วัน)")}
                    value={stats?.dqAttempts7d ?? 0}
                  />
                  <MiniStat
                    icon={<ClipboardList className="size-4" />}
                    label={tr("ส่งงาน (30 วัน)")}
                    value={stats?.submissions30d ?? 0}
                  />
                  <MiniStat
                    icon={<TrendingUp className="size-4" />}
                    label={tr("ผู้ใช้ใหม่ (7 วัน)")}
                    value={stats?.newUsers7d ?? 0}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Target className="size-5 text-primary" />
              {tr("สถานะการจอง")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <BookingPill color="bg-amber-500" label={tr("รออนุมัติ")} value={stats?.pending ?? 0} />
            <BookingPill
              color="bg-sky-500"
              label={tr("อนุมัติแล้ว")}
              value={stats?.approved ?? 0}
            />
            <BookingPill color="bg-rose-500" label={tr("ปฏิเสธ")} value={stats?.rejected ?? 0} />
            <Button asChild size="sm" variant="outline" className="w-full mt-2">
              <Link to="/bookings">
                {tr("จัดการการจอง")} <ArrowRight className="size-4 ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Pending bookings + Recent users */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Clock className="size-5 text-primary" />
              {tr("การจองที่ต้องอนุมัติ")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!pendingBookings || pendingBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("ไม่มีรายการรออนุมัติ")}</p>
            ) : (
              <ul className="divide-y">
                {pendingBookings.map((b) => (
                  <li key={b.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.purpose}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {b.who} • {b.room_name} •{" "}
                        {new Date(b.starts_at).toLocaleString("th-TH", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {tr("รออนุมัติ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              {tr("ผู้ใช้ใหม่ล่าสุด")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!recentUsers || recentUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("ยังไม่มีข้อมูล")}</p>
            ) : (
              <ul className="divide-y">
                {recentUsers.map((u) => (
                  <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.display_name ?? tr("ไม่ระบุชื่อ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("th-TH", {
                          dateStyle: "medium",
                        })}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      Lv. {u.level} • {u.xp.toLocaleString()} XP
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Top classrooms */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            {tr("ห้องเรียนยอดนิยม")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!topClassrooms || topClassrooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("ยังไม่มีห้องเรียน")}</p>
          ) : (
            <ul className="divide-y">
              {topClassrooms.map((c) => (
                <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.subject ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="size-4" /> {c.members}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/classrooms/$id" params={{ id: c.id }}>
                        {tr("เปิด")}
                        <ArrowRight className="size-4 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <section className="grid gap-4 md:grid-cols-3">
        <QuickLink
          to="/bookings"
          icon={<Calendar className="size-5" />}
          title={tr("อนุมัติการจอง")}
          desc={tr("ตรวจการจองห้องประชุม")}
        />
        <QuickLink
          to="/admin/rooms"
          icon={<DoorOpen className="size-5" />}
          title={tr("จัดการห้องประชุม")}
          desc={tr("เพิ่ม/แก้ไข/ลบห้อง")}
        />
        <QuickLink
          to="/admin/users"
          icon={<Users className="size-5" />}
          title={tr("จัดการผู้ใช้")}
          desc={tr("กำหนดบทบาท")}
        />
      </section>
    </>
  );
}

function AdminActivityCenter() {
  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-activity-center"],
    queryFn: async () => {
      const [bookingRes, questRes, submissionRes, userRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("id, purpose, status, created_at, starts_at, user_id, guest_name")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("daily_quest_attempts")
          .select("id, completed_at, score, max_score, xp_awarded, gold_awarded, user_id")
          .order("completed_at", { ascending: false })
          .limit(8),
        supabase
          .from("submissions")
          .select("id, submitted_at, graded_at, score, is_late, user_id")
          .order("submitted_at", { ascending: false })
          .limit(8),
        supabase
          .from("profiles")
          .select("id, display_name, created_at, level, xp")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      const bookings = (bookingRes.data ?? []) as BookingActivityRow[];
      const questAttempts = (questRes.data ?? []) as QuestActivityRow[];
      const submissions = (submissionRes.data ?? []) as SubmissionActivityRow[];
      const users = (userRes.data ?? []) as UserActivityRow[];
      const userIds = Array.from(
        new Set(
          [
            ...bookings.map((b) => b.user_id),
            ...questAttempts.map((q) => q.user_id),
            ...submissions.map((s) => s.user_id),
          ].filter((id): id is string => !!id),
        ),
      );
      const { data: profileRows } = userIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
        : { data: [] as ProfileNameRow[] };
      const names = new Map(
        ((profileRows ?? []) as ProfileNameRow[]).map((p) => [p.id, p.display_name]),
      );
      const nameFor = (id: string | null, fallback?: string | null) =>
        id ? (names.get(id) ?? tr("ผู้ใช้")) : (fallback ?? tr("ผู้เยี่ยม"));

      const activity: ActivityEvent[] = [
        ...bookings.map((b) => ({
          id: `booking-${b.id}`,
          kind: "booking" as const,
          title: `${bookingStatusLabel(b.status)}: ${b.purpose}`,
          detail: `${nameFor(b.user_id, b.guest_name)} • ${formatActivityTime(b.starts_at)}`,
          at: b.created_at,
          badge: tr("การจอง"),
          tone: b.status === "pending" ? ("amber" as const) : ("primary" as const),
        })),
        ...questAttempts.map((q) => ({
          id: `quest-${q.id}`,
          kind: "quest" as const,
          title: tr("นักเรียนทำ Practice Quest"),
          detail: `${nameFor(q.user_id)} • ${q.score}/${q.max_score} • +${q.xp_awarded} XP, +${q.gold_awarded} ${tr("ทอง")}`,
          at: q.completed_at,
          badge: tr("Quest"),
          tone: "emerald" as const,
        })),
        ...submissions.map((s) => ({
          id: `submission-${s.id}`,
          kind: "submission" as const,
          title: s.graded_at ? tr("ตรวจงานแล้ว") : tr("มีงานส่งใหม่"),
          detail: `${nameFor(s.user_id)}${s.score !== null ? ` • ${tr("คะแนน")} ${s.score}` : ""}${s.is_late ? ` • ${tr("ส่งช้า")}` : ""}`,
          at: s.submitted_at,
          badge: tr("งาน"),
          tone: s.graded_at ? ("primary" as const) : ("amber" as const),
        })),
        ...users.map((u) => ({
          id: `user-${u.id}`,
          kind: "user" as const,
          title: tr("ผู้ใช้ใหม่เข้าระบบ"),
          detail: `${u.display_name ?? tr("ไม่ระบุชื่อ")} • Lv.${u.level} • ${u.xp} XP`,
          at: u.created_at,
          badge: tr("ผู้ใช้"),
          tone: "slate" as const,
        })),
      ];

      return activity
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 10);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Activity className="size-5 text-primary" />
          {tr("Activity Center")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{tr("กำลังโหลด…")}</p>
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("ยังไม่มีกิจกรรมล่าสุด")}</p>
        ) : (
          <ul className="divide-y">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-lg ${activityToneClass(event.tone)}`}
                  >
                    <ActivityIcon kind={event.kind} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{event.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{event.detail}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <Badge variant="outline">{event.badge}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatActivityTime(event.at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function bookingStatusLabel(status: Database["public"]["Enums"]["booking_status"]) {
  return status === "pending"
    ? tr("รออนุมัติ")
    : status === "approved"
      ? tr("อนุมัติแล้ว")
      : tr("ปฏิเสธ");
}

function formatActivityTime(value: string) {
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function activityToneClass(tone: ActivityEvent["tone"]) {
  return tone === "amber"
    ? "bg-amber-100 text-amber-800"
    : tone === "emerald"
      ? "bg-sky-100 text-sky-800"
      : tone === "slate"
        ? "bg-slate-100 text-slate-700"
        : "bg-primary/10 text-primary";
}

function ActivityIcon({ kind }: { kind: ActivityEvent["kind"] }) {
  if (kind === "booking") return <Calendar className="size-4" />;
  if (kind === "quest") return <Sparkles className="size-4" />;
  if (kind === "submission") return <ClipboardList className="size-4" />;
  return <Users className="size-4" />;
}

function RoleRow({
  icon,
  label,
  count,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="inline-flex items-center gap-2 text-sm">
          {icon}
          {label}
        </span>
        <span className="text-sm text-muted-foreground">
          {count.toLocaleString()} <span className="text-xs">({pct}%)</span>
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function BookingPill({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-sm">
        <span className={`inline-block size-2.5 rounded-full ${color}`} />
        {label}
      </span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

/* ---------- shared ---------- */
function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="bg-card/95">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon}
        </div>
        <p className="mt-2 text-3xl font-semibold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function QuickLink({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group block rounded-xl border bg-card p-5 transition-colors hover:border-primary/45 hover:bg-secondary/40"
    >
      <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <p className="mt-3 text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-primary text-sm font-medium">
        เปิด <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}

function JoinCode({ classroomId }: { classroomId: string }) {
  const { data } = useQuery({
    queryKey: ["classroom-join-code", classroomId],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_classroom_join_code", {
        _classroom_id: classroomId,
      });
      return (data as string | null) ?? null;
    },
  });
  return <span className="font-mono">{data ?? "—"}</span>;
}
