import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tr } from "@/i18n";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { DomTranslator } from "@/components/dom-translator";
import { PageTransition } from "@/components/motion/page-transition";
import "@/i18n";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-display text-foreground">{tr("ไม่พบหน้านี้")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">หน้าที่คุณค้นหาอาจถูกย้ายหรือไม่มีอยู่</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            กลับหน้าแรก
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-display text-foreground">{tr("เกิดข้อผิดพลาด")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{tr("ลองรีเฟรชหน้าหรือกลับหน้าแรก")}</p>
        {import.meta.env.DEV ? (
          <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground">
            {error.message}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {tr("ลองอีกครั้ง")}
          </button>
          <a
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
          >
            {tr("หน้าแรก")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: tr("โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ: ห้องเรียนและห้องประชุม") },
      {
        name: "description",
        content: tr("ศูนย์กลางสำหรับจองห้องประชุมและห้องเรียน"),
      },
      { property: "og:title", content: tr("โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ: ห้องเรียนและห้องประชุม") },
      { name: "twitter:title", content: tr("โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ: ห้องเรียนและห้องประชุม") },
      {
        property: "og:description",
        content: tr("ศูนย์กลางสำหรับจองห้องประชุมและห้องเรียน"),
      },
      {
        name: "twitter:description",
        content: tr("ศูนย์กลางสำหรับจองห้องประชุมและห้องเรียน"),
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2693ac5a-f956-4c5c-8830-1665aa66748f/id-preview-a6e8be42--d7241f57-b474-44b5-b5db-c20643f80c8b.lovable.app-1779724706735.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2693ac5a-f956-4c5c-8830-1665aa66748f/id-preview-a6e8be42--d7241f57-b474-44b5-b5db-c20643f80c8b.lovable.app-1779724706735.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css?family=Noto+Sans+Thai:400,500,600,700|Bai+Jamjuree:400,500,600,700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { i18n } = useTranslation();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DomTranslator />
        <div key={i18n.language} className="contents">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </div>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
