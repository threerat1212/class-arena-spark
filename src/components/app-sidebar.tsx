import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Calendar,
  CalendarCheck,
  BookOpen,
  Users,
  Trophy,
  Sparkles,
  MessagesSquare,
  DoorOpen,
  Crown,
  UserCircle,
  Zap,
  BarChart3,
  Layers,
  UserCheck,
  UserPlus,
  ScrollText,
  Store,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { useTr } from "@/lib/tr";

type Item = { label: string; url: string; icon: LucideIcon; roles?: AppRole[] };
type Group = { label: string; items: Item[]; roles?: AppRole[] };

const groups: Group[] = [
  {
    label: "ทั่วไป",
    roles: ["student", "teacher", "admin", "guest"],
    items: [
      {
        label: "แดชบอร์ด",
        url: "/dashboard",
        icon: LayoutDashboard,
        roles: ["student", "teacher", "admin", "guest"],
      },
      {
        label: "ภารกิจสัปดาห์",
        url: "/weekly-missions",
        icon: CalendarCheck,
        roles: ["student", "teacher", "admin", "guest"],
      },
      {
        label: "คะแนนพิเศษ",
        url: "/bonus-center",
        icon: Trophy,
        roles: ["student", "teacher", "admin", "guest"],
      },
      {
        label: "ห้องเรียน",
        url: "/classrooms",
        icon: BookOpen,
        roles: ["student", "teacher", "admin", "guest"],
      },
      {
        label: "บัตรคำศัพท์",
        url: "/flashcards",
        icon: Layers,
        roles: ["student", "teacher", "admin", "guest"],
      },
      {
        label: "บันทึกกิจกรรม",
        url: "/activity",
        icon: ScrollText,
        roles: ["student", "teacher", "admin"],
      },
      {
        label: "โปรไฟล์",
        url: "/profile",
        icon: UserCircle,
        roles: ["student", "teacher", "admin", "guest", "room_admin"],
      },
    ],
  },
  {
    label: "การเรียน",
    roles: ["student", "admin"],
    items: [
      { label: "เควสต์", url: "/quests", icon: Sparkles, roles: ["student", "admin"] },
      { label: "เข้าร่วมควิซ", url: "/quiz/join", icon: Zap, roles: ["student", "admin"] },
      { label: "รางวัล", url: "/rewards", icon: Trophy, roles: ["student", "admin"] },
      { label: "หอเกียรติยศ", url: "/hall-of-fame", icon: Crown, roles: ["student", "admin"] },
      { label: "AI ผู้ช่วย", url: "/ai-chat", icon: MessagesSquare, roles: ["student", "admin"] },
    ],
  },
  {
    label: "การสอน",
    roles: ["teacher", "admin"],
    items: [
      { label: "การจองห้อง", url: "/bookings", icon: Calendar, roles: ["teacher", "admin"] },
      {
        label: "วิเคราะห์ห้องเรียน",
        url: "/analytics",
        icon: BarChart3,
        roles: ["teacher", "admin"],
      },
    ],
  },
  {
    label: "ห้องประชุม",
    roles: ["room_admin"],
    items: [
      { label: "การจองห้อง", url: "/bookings", icon: Calendar, roles: ["room_admin"] },
      { label: "จัดการห้อง", url: "/admin/rooms", icon: DoorOpen, roles: ["room_admin"] },
    ],
  },
  {
    label: "การจัดการ",
    roles: ["admin"],
    items: [
      { label: "จัดการห้อง", url: "/admin/rooms", icon: DoorOpen, roles: ["admin"] },
      { label: "จัดการผู้ใช้", url: "/admin/users", icon: Users, roles: ["admin"] },
      { label: "อนุมัติครู", url: "/admin/teachers", icon: UserCheck, roles: ["admin"] },
      { label: "เพิ่มนักเรียน", url: "/admin/students", icon: UserPlus, roles: ["admin"] },
      { label: "กิจกรรม XP ×", url: "/admin/multiplier-events", icon: Sparkles, roles: ["admin"] },
      { label: "XP Ledger", url: "/admin/xp-ledger", icon: Sparkles, roles: ["admin"] },
      { label: "รางวัล & ร้านค้า", url: "/admin/rewards-catalog", icon: Store, roles: ["admin"] },
    ],
  },
];

function hasAny(userRoles: AppRole[], needed?: AppRole[]) {
  if (!needed || needed.length === 0) return true;
  return needed.some((r) => userRoles.includes(r));
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { roles } = useAuth();
  const tr = useTr();

  const visibleGroups = groups
    .filter((g) => hasAny(roles, g.roles))
    .map((g) => ({ ...g, items: g.items.filter((i) => hasAny(roles, i.roles)) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link to="/dashboard" className="flex min-h-11 min-w-0 items-center gap-2">
          <div className="grid size-9 place-items-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
            SH
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ
              </span>
              <span className="block truncate text-xs text-sidebar-foreground/65">
                {tr("Connected classroom")}
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && <SidebarGroupLabel>{tr(group.label)}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={path === item.url || path.startsWith(item.url + "/")}
                      tooltip={tr(item.label)}
                      className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary/90 data-[active=true]:hover:text-sidebar-primary-foreground"
                    >
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="size-4" />
                        {!collapsed && <span>{tr(item.label)}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
