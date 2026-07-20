import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useTr } from "@/lib/tr";
import { AnimatePresence, motion } from "motion/react";
import { ActiveBoostsBar } from "@/components/gamification/active-boosts-bar";

export const Route = createFileRoute("/_authenticated")({ component: AuthenticatedLayout });

function AuthenticatedLayout() {
  const { user, loading, signOut, roles } = useAuth();
  const tr = useTr();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading) {
    return (
      <div
        suppressHydrationWarning
        className="min-h-screen grid place-items-center text-muted-foreground"
      >
        {tr("กำลังโหลด…")}
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center justify-between border-b border-border/70 bg-card/92 backdrop-blur px-3">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user.email}
                {(() => {
                  const primary = (["admin", "room_admin", "teacher", "student", "guest"] as const).find((r) =>
                    roles.includes(r),
                  );
                  return primary ? (
                    <span className="ml-2 inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">
                      {primary}
                    </span>
                  ) : null;
                })()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <LanguageSwitcher />
              <NotificationBell />
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="size-4" /> {tr("ออกจากระบบ")}
              </Button>
            </div>
          </header>
          <ActiveBoostsBar />
          <main className="flex-1 relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
