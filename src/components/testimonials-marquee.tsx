import { Quote, GraduationCap, ClipboardCheck, ShieldCheck, BookOpen } from "lucide-react";
import { tr } from "@/i18n";

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  icon: React.ReactNode;
};

function getTestimonials(): Testimonial[] {
  return [
    {
      quote: tr("เด็กๆ ตื่นเต้นกับ Daily Quest ทุกเช้า ทำงานส่งเร็วขึ้นแบบไม่ต้องตามเลย"),
      name: tr("ครูพิมพ์"),
      role: tr("ครูประจำชั้น ป.5"),
      icon: <ClipboardCheck className="size-4" />,
    },
    {
      quote: tr("ชอบที่เก็บ XP กับเหรียญทองได้ เหมือนเล่นเกมแต่ได้ความรู้จริงๆ"),
      name: tr("น้องเฟิร์น"),
      role: tr("นักเรียน ม.2"),
      icon: <GraduationCap className="size-4" />,
    },
    {
      quote: tr("จองห้องประชุมในไม่กี่คลิก ระบบอนุมัติชัดเจน ไม่ต้องเดินเอกสารอีกแล้ว"),
      name: tr("คุณอนันต์"),
      role: tr("ผู้ปกครอง / ผู้จอง"),
      icon: <BookOpen className="size-4" />,
    },
    {
      quote: tr("เห็นภาพรวมผู้ใช้ ห้อง และคำขอจองในหน้าเดียว ลดงานซ้ำซ้อนได้เยอะมาก"),
      name: tr("ครูใหญ่สมชาย"),
      role: tr("ผู้ดูแลระบบ"),
      icon: <ShieldCheck className="size-4" />,
    },
    {
      quote: tr("AI ช่วยสรุปบทเรียน แล้วนักเรียนถามต่อได้เอง ครูมีเวลาดูเด็กที่ต้องช่วยจริงๆ"),
      name: tr("ครูณัฐ"),
      role: tr("ครูวิทยาศาสตร์"),
      icon: <ClipboardCheck className="size-4" />,
    },
    {
      quote: tr("Leaderboard ทำให้เพื่อนๆ ในห้องช่วยกันเรียน ไม่ใช่แข่งกันอย่างเดียว"),
      name: tr("น้องภูมิ"),
      role: tr("นักเรียน ม.3"),
      icon: <GraduationCap className="size-4" />,
    },
  ];
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <article className="group relative flex w-[320px] shrink-0 flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 sm:w-[380px]">
      <Quote className="size-5 text-primary/40" aria-hidden />
      <p className="text-sm leading-relaxed text-foreground">{t.quote}</p>
      <div className="mt-auto flex items-center gap-3 border-t border-border/60 pt-4">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          {t.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{t.name}</p>
          <p className="truncate text-xs text-muted-foreground">{t.role}</p>
        </div>
      </div>
    </article>
  );
}

export function TestimonialsMarquee() {
  const testimonials = getTestimonials();

  return (
    <section
      aria-label={tr("เสียงจากผู้ใช้งาน")}
      className="relative overflow-hidden border-t border-border/70 bg-secondary/40 py-12 sm:py-16"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="mb-8 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Quote className="size-3.5" />
              {tr("เสียงจากห้องเรียนจริง")}
            </span>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-balance sm:text-4xl">
              {tr("ครู นักเรียน และผู้ดูแล ใช้งานทุกวัน")}
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {tr("เครื่องมือเดียวที่ทำให้บทบาทต่างๆ ในโรงเรียนทำงานร่วมกันได้ลื่นไหล")}
          </p>
        </div>
      </div>

      <div className="group/marquee relative">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-secondary/80 to-transparent sm:w-32"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-secondary/80 to-transparent sm:w-32"
          aria-hidden
        />

        <div className="flex gap-4 overflow-hidden">
          <div className="marquee-track flex shrink-0 gap-4 pr-4">
            {testimonials.map((t, i) => (
              <TestimonialCard key={`a-${i}`} t={t} />
            ))}
          </div>
          <div className="marquee-track flex shrink-0 gap-4 pr-4" aria-hidden>
            {testimonials.map((t, i) => (
              <TestimonialCard key={`b-${i}`} t={t} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
