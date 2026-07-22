import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  GraduationCap,
  KeyRound,
  LogIn,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { TestimonialsMarquee } from "@/components/testimonials-marquee";
import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { AnimatedBackground } from "@/components/motion/animated-background";

import { tr } from "@/i18n";

export const Route = createFileRoute("/")({ component: Landing });

const vehicleManagementUrl =
  "https://script.google.com/macros/s/AKfycbwu0D-LS8pF5CQ6PRgJ0ubF2caPUsn1gZyDWuyPKAggBhiL2Z4m8HUm0U3dFyz7Xs0a/exec";
const facilitiesRepairUrl =
  "https://script.google.com/macros/s/AKfycbybGK2s9BNfCtRJ6Z8Om5REYKQl1dRu7eyVHveKhsiK27GdLIHE3Bi1dte-Gxx2ZUGM/exec";

function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/92 backdrop-blur">
        <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <Link to="/" className="group flex min-h-11 min-w-0 items-center gap-2">
            <div className="grid size-9 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-transform group-hover:-translate-y-0.5">
              SH
            </div>
            <span className="font-semibold leading-tight">โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ</span>
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LanguageSwitcher />
            {user ? (
              <>
                <Button asChild variant="outline">
                  <Link to="/book">
                    <DoorOpen className="size-4" />
                    {tr("จองห้อง")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link to="/dashboard">{tr("เข้าสู่แดชบอร์ด")}</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="outline">
                  <Link to="/book">
                    <DoorOpen className="size-4" />
                    {tr("จองห้อง")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link to="/login">
                    <LogIn className="size-4" />
                    {tr("เข้าห้องเรียน")}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border/70">
          <AnimatedBackground />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/25"
            aria-hidden
          />
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-14">
            <div className="scholar-entrance max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-medium text-primary float-slow">
                <MonitorPlay className="size-4" />
                {tr("Connected classroom สำหรับโรงเรียน")}
              </div>
              <h1 className="mt-6 text-5xl font-semibold leading-[1.05] text-balance sm:text-6xl gradient-text">
                โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty">
                {tr("ศูนย์กลางสำหรับจองห้องประชุมและห้องเรียน")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild className="min-h-12" size="lg">
                  <Link to="/book">
                    <DoorOpen className="size-4" />
                    {tr("จองห้องประชุม")}
                  </Link>
                </Button>
                <Button asChild className="min-h-12" size="lg" variant="outline">
                  <Link to={user ? "/classrooms" : "/login"}>
                    <BookOpen className="size-4" />
                    {user ? tr("เปิดห้องเรียน") : tr("เข้าสู่ระบบห้องเรียน")}
                  </Link>
                </Button>
              </div>
            </div>

            <EntryGateway isSignedIn={!!user} />
          </div>

          <ProductPreview />
        </section>

        <section className="border-y border-border/70 bg-secondary/55">
          <div className="mx-auto grid max-w-6xl gap-0 px-5 py-8 sm:px-6 md:grid-cols-4">
            <ProofPoint
              icon={<Calendar className="size-5" />}
              label={tr("จองห้อง")}
              value={tr("ผู้เยี่ยมชมใช้ได้ทันที")}
            />
            <ProofPoint
              icon={<Users className="size-5" />}
              label={tr("ห้องเรียน")}
              value={tr("ครูและนักเรียนทำงานร่วมกัน")}
            />
            <ProofPoint
              icon={<Trophy className="size-5" />}
              label={tr("รางวัล")}
              value={tr("XP, Gold, Achievement")}
            />
            <ProofPoint
              icon={<ShieldCheck className="size-5" />}
              label={tr("แอดมิน")}
              value={tr("อนุมัติและดูแลระบบ")}
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-12 sm:px-6 lg:py-16">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <h2 className="text-3xl font-semibold leading-tight text-balance">
                {tr("ออกแบบให้แต่ละคนเห็นงานของตัวเองก่อน")}
              </h2>
              <p className="mt-3 max-w-xl text-muted-foreground leading-relaxed">
                {tr(
                  "หน้า public พาไปจองห้องหรือเข้าสู่ระบบ ส่วนหลังบ้านแยกงานนักเรียน ครู และแอดมินให้สแกนเร็วกว่าเดิม",
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <RoleLine
                icon={<DoorOpen className="size-5" />}
                title={tr("ผู้จองทั่วไป")}
                text={tr("เลือกห้อง กรอกข้อมูล รออนุมัติ")}
              />
              <RoleLine
                icon={<BookOpen className="size-5" />}
                title={tr("นักเรียน")}
                text={tr("เข้าเรียน ทำเควสต์ สะสม XP")}
              />
              <RoleLine
                icon={<ClipboardCheck className="size-5" />}
                title={tr("ครู")}
                text={tr("สร้างห้อง สั่งงาน เช็กชื่อ")}
              />
              <RoleLine
                icon={<ShieldCheck className="size-5" />}
                title={tr("แอดมิน")}
                text={tr("ดูแลผู้ใช้ ห้อง และคำขอจอง")}
              />
            </div>
          </div>
        </section>

        <TestimonialsMarquee />
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto max-w-6xl px-5 py-6 text-sm text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ
        </div>
      </footer>
    </div>
  );
}

function EntryGateway({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <div className="scholar-entrance scholar-entrance-delay-1">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">
          <Sparkles className="size-4 text-gold" />
          {tr("เลือกทางเข้า")}
        </div>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {tr("บริการโรงเรียน")}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <article className="scholar-spotlight-card scholar-sheen rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </span>
            <span className="rounded-full border border-primary/20 bg-background px-2.5 py-1 text-xs font-medium text-primary">
              {tr("Public")}
            </span>
          </div>
          <h2 className="mt-5 text-2xl font-semibold leading-tight">{tr("ห้องประชุม")}</h2>
          <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">
            {tr("จองห้องประชุมและส่งคำขอใช้งานได้ทันที โดยไม่ต้องเข้าสู่ระบบ")}
          </p>
          <Button asChild className="mt-5 min-h-12 w-full" size="lg">
            <Link to="/book">
              <DoorOpen className="size-4" />
              {tr("จองห้องประชุม")}
            </Link>
          </Button>
        </article>

        <article className="scholar-spotlight-card scholar-sheen rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md bg-gold/15 text-gold">
              <GraduationCap className="size-5" />
            </span>
            <span className="rounded-full border border-gold/25 bg-background px-2.5 py-1 text-xs font-medium text-foreground">
              {isSignedIn ? tr("Ready") : tr("Login")}
            </span>
          </div>
          <h2 className="mt-5 text-2xl font-semibold leading-tight">{tr("ห้องเรียน")}</h2>
          <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">
            {tr("ครูและนักเรียนเข้าสู่ระบบเพื่อจัดการห้อง เควสต์ คะแนน และ leaderboard")}
          </p>
          <div className="mt-5 grid gap-2">
            <Button asChild className="min-h-12 w-full" size="lg">
              <Link to={isSignedIn ? "/classrooms" : "/login"}>
                <KeyRound className="size-4" />
                {isSignedIn ? tr("เปิดห้องเรียน") : tr("เข้าสู่ระบบห้องเรียน")}
              </Link>
            </Button>
            {!isSignedIn ? (
              <Button asChild className="min-h-12 w-full" variant="outline">
                <Link to="/login" search={{ mode: "signup" }}>
                  {tr("สมัครสมาชิก")}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : null}
          </div>
        </article>

        <article className="scholar-spotlight-card scholar-sheen rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Calendar className="size-5" />
            </span>
            <span className="rounded-full border border-primary/20 bg-background px-2.5 py-1 text-xs font-medium text-primary">
              {tr("บริการภายนอก")}
            </span>
          </div>
          <h2 className="mt-5 text-2xl font-semibold leading-tight">
            {tr("ระบบบริหารยานพาหนะราชการ")}
          </h2>
          <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">
            {tr("จองและติดตามการใช้ยานพาหนะราชการผ่านระบบกลาง")}
          </p>
          <Button asChild className="mt-5 min-h-12 w-full" size="lg" variant="outline">
            <a href={vehicleManagementUrl} target="_blank" rel="noreferrer">
              <ArrowRight className="size-4" />
              {tr("เปิดระบบ")}
            </a>
          </Button>
        </article>

        <article className="scholar-spotlight-card scholar-sheen rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md bg-gold/15 text-gold">
              <ClipboardCheck className="size-5" />
            </span>
            <span className="rounded-full border border-gold/25 bg-background px-2.5 py-1 text-xs font-medium text-foreground">
              {tr("บริการภายนอก")}
            </span>
          </div>
          <h2 className="mt-5 text-2xl font-semibold leading-tight">
            {tr("ระบบแจ้งซ่อมอาคารสถานที่")}
          </h2>
          <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">
            {tr("แจ้งปัญหาอาคาร สถานที่ และติดตามงานซ่อมจากระบบออนไลน์")}
          </p>
          <Button asChild className="mt-5 min-h-12 w-full" size="lg" variant="outline">
            <a href={facilitiesRepairUrl} target="_blank" rel="noreferrer">
              <ArrowRight className="size-4" />
              {tr("เปิดระบบ")}
            </a>
          </Button>
        </article>
      </div>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="scholar-entrance scholar-entrance-delay-2 scholar-spotlight-card mx-5 mb-10 max-w-5xl overflow-hidden rounded-lg border bg-card shadow-sm sm:mx-6 lg:mx-auto lg:mb-14">
      <div className="grid gap-3 border-b bg-secondary/70 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <span className="font-semibold text-foreground">{tr("Live classroom hub")}</span>
          <p className="text-xs text-muted-foreground">
            {tr("ตารางสอน งานค้าง และสถานะห้องอยู่ในหน้าจอเดียว")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <SignalPill icon={<CheckCircle2 className="size-3.5" />} label={tr("พร้อมสอน")} />
          <SignalPill icon={<Bot className="size-3.5" />} label={tr("AI พร้อมตอบ")} />
        </div>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-[1fr_1fr_1.1fr]">
        <PreviewPanel
          icon={<Calendar className="size-4" />}
          title={tr("คำขอจอง")}
          value="12"
          detail={tr("รออนุมัติ 3 รายการ")}
        />
        <PreviewPanel
          icon={<BookOpen className="size-4" />}
          title={tr("ห้องเรียน")}
          value="8"
          detail={tr("มีบทเรียนและเควสต์ที่เปิดใช้งาน")}
        />
        <div className="bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Bot className="size-4" />
            </span>
            <span className="text-xs text-muted-foreground">{tr("AI ผู้ช่วย")}</span>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="rounded-lg bg-secondary/65 px-3 py-2">
              {tr("สรุปบทเรียนล่าสุดให้นักเรียนอ่านซ้ำได้")}
            </div>
            <div className="rounded-lg bg-primary/10 px-3 py-2 text-primary">
              {tr("Daily Quest จากเนื้อหาที่ครูสอน")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background px-2.5 py-1 font-medium text-primary">
      {icon}
      {label}
    </span>
  );
}

function PreviewPanel({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="text-xs text-muted-foreground">{title}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold leading-none">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function ProofPoint({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border/70 py-4 md:border-r md:px-5 md:first:pl-0 md:last:border-r-0">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{value}</p>
    </div>
  );
}

function RoleLine({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="scholar-spotlight-card rounded-lg border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <div>
          <h3 className="text-xl font-semibold leading-tight">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      <ArrowRight className="mt-4 size-4 text-primary" aria-hidden />
    </div>
  );
}
