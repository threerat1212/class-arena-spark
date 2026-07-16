import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { createStudentAccount } from "@/lib/student-signup.functions";
import { signInProxy } from "@/lib/student-signin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { GraduationCap, School } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

import { tr } from "@/i18n";
const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  role: z.enum(["student", "teacher"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  component: LoginPage,
});

const STUDENT_EMAIL_DOMAIN = "student.scholarhall.local";

function sanitizeId(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function toEmail(identifier: string) {
  const v = identifier.trim();
  if (v.includes("@")) return v;
  return `${sanitizeId(v)}@${STUDENT_EMAIL_DOMAIN}`;
}

function getRedirectDestination(value?: string) {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : tr("เกิดข้อผิดพลาด");
}

function LoginPage() {
  const { mode: initialMode, role: initialRole, redirect } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode ?? "signin");
  const [role, setRole] = useState<"student" | "teacher" | null>(initialRole ?? null);
  const [identifier, setIdentifier] = useState(""); // email หรือ student ID สำหรับ sign in
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const redirectDestination = getRedirectDestination(redirect);

  function finishAuth() {
    // Use window.location so paths outside the router's typed route tree
    // (e.g. the OAuth consent URL `/.lovable/oauth/consent?...`) navigate correctly.
    window.location.href = redirectDestination;
  }

  // If we came back from Google OAuth full-page redirect with a session
  // already set, forward to the intended destination automatically.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) finishAuth();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !role) {
      toast.error(tr("กรุณาเลือกบทบาทของคุณ"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        if (role === "student") {
          const id = sanitizeId(studentId);
          if (id.length < 3) {
            throw new Error(tr("ID ต้องมีอย่างน้อย 3 ตัวอักษร (a-z, 0-9, . _ -)"));
          }
          // ใช้ server function เพื่อหลบ per-IP signup rate-limit (นักเรียนทั้งห้องใช้ IP เดียวกัน)
          await createStudentAccount({
            data: { studentId: id, password, displayName: displayName || id },
          });
          const tokens = await signInProxy({ data: { identifier: id, password } });
          const { error: setErr } = await supabase.auth.setSession(tokens);
          if (setErr) throw setErr;
          toast.success(tr("สร้างบัญชีนักเรียนเรียบร้อย"));
          finishAuth();
        } else {
          if (!email) throw new Error(tr("กรุณากรอกอีเมล"));
          const nameFallback = displayName || email.split("@")[0];
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/login?redirect=${encodeURIComponent(redirectDestination)}`,
              data: { display_name: nameFallback, role: "teacher" },
            },
          });
          if (error) throw error;
          toast.success(
            tr(
              "สมัครครูเรียบร้อย รอ admin อนุมัติก่อนใช้งานสิทธิ์ครู (ตอนนี้เข้าได้ในฐานะนักเรียน)",
            ),
          );
        }
      } else {
        // ใช้ server proxy เพื่อหลบ per-IP rate-limit (โรงเรียนทั้งห้องใช้ IP เดียว)
        const tokens = await signInProxy({ data: { identifier, password } });
        const { error } = await supabase.auth.setSession(tokens);
        if (error) throw error;
        toast.success(tr("เข้าสู่ระบบสำเร็จ"));
        finishAuth();
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/login?redirect=${encodeURIComponent(redirectDestination)}`,
    });
    if (result.error) {
      toast.error(result.error.message ?? tr("Google sign-in ไม่สำเร็จ"));
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    finishAuth();
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background relative">
      <div className="absolute top-3 right-3 z-20">
        <LanguageSwitcher />
      </div>
      <aside className="hidden lg:flex flex-col justify-between bg-secondary p-12">
        <Link to="/" className="inline-flex min-h-11 items-center font-display text-xl">
          โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ
        </Link>
        <div>
          <h2 className="font-display text-4xl leading-tight">
            ห้องเรียนยุคใหม่
            <br />
            ที่ให้รางวัลกับความตั้งใจ
          </h2>
          <p className="mt-4 text-muted-foreground max-w-md">
            สะสม XP ปลดล็อกตำแหน่ง และทำเควสต์การเรียนรู้ในทุกบทเรียน
          </p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-3xl">
            {mode === "signin" ? tr("เข้าสู่ระบบ") : tr("สร้างบัญชี")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? tr("ยินดีต้อนรับกลับมา") : tr("เริ่มต้นการเรียนรู้ของคุณ")}
          </p>

          <Button
            type="button"
            variant="outline"
            className="w-full mt-6"
            onClick={handleGoogle}
            disabled={busy}
          >
            ดำเนินการต่อด้วย Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px bg-border flex-1" />
            {tr("หรือ")}
            <div className="h-px bg-border flex-1" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <>
                <div className="space-y-2">
                  <Label>{tr("คุณคือใคร?")}</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setRole("student")}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${role === "student" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                    >
                      <GraduationCap className="size-8" />
                      <span className="font-medium">{tr("นักเรียน")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("teacher")}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${role === "teacher" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                    >
                      <School className="size-8" />
                      <span className="font-medium">{tr("ครู")}</span>
                    </button>
                  </div>
                  {role === "teacher" && (
                    <p className="text-xs text-muted-foreground rounded-md bg-muted/50 border p-2">
                      {tr(
                        "บัญชีครูต้องรอ admin อนุมัติ จึงจะได้รับสิทธิ์ครู ระหว่างรอจะใช้งานในฐานะนักเรียน",
                      )}
                    </p>
                  )}
                </div>

                {role === "student" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="studentId">{tr("ID สำหรับเข้าสู่ระบบ")}</Label>
                    <Input
                      id="studentId"
                      required
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder={tr("เช่น somchai01")}
                      autoComplete="username"
                    />
                    <p className="text-xs text-muted-foreground">
                      {tr("ใช้ตัวอักษร a-z, ตัวเลข, . _ - เท่านั้น (ไม่ต้องใช้อีเมล)")}
                    </p>
                  </div>
                )}

                {role === "teacher" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="email">{tr("อีเมล")}</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="name">{tr("ชื่อ-นามสกุล")}</Label>
                  <Input
                    id="name"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={tr("เช่น สมชาย ใจดี")}
                  />
                </div>
              </>
            )}

            {mode === "signin" && (
              <div className="space-y-1.5">
                <Label htmlFor="identifier">{tr("อีเมล หรือ ID นักเรียน")}</Label>
                <Input
                  id="identifier"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={tr("เช่น somchai01 หรือ name@email.com")}
                  autoComplete="username"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">{tr("รหัสผ่าน")}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signin" ? tr("เข้าสู่ระบบ") : tr("สมัครสมาชิก")}
            </Button>
          </form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            {mode === "signin" ? tr("ยังไม่มีบัญชี?") : tr("มีบัญชีอยู่แล้ว?")}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="inline-flex min-h-11 items-center px-2 align-middle text-primary hover:underline"
            >
              {mode === "signin" ? tr("สมัครสมาชิก") : tr("เข้าสู่ระบบ")}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
