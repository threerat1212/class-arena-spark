import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDecision | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDecision | null; error: { message: string } | null }>;
};

type AuthorizationDetails = {
  client?: { name?: string; client_id?: string } | null;
  scope?: string | null;
  redirect_uri?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type AuthorizationDecision = {
  redirect_url?: string | null;
  redirect_to?: string | null;
};

function oauth(): OAuthNs {
  return (supabase.auth as unknown as { oauth: OAuthNs }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { redirect: next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="max-w-md p-6 space-y-2">
        <h1 className="text-lg font-semibold">ไม่สามารถโหลดคำขอเชื่อมต่อได้</h1>
        <p className="text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "แอปภายนอก";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const res = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (res.error) {
      setBusy(false);
      setError(res.error.message);
      return;
    }
    const target = res.data?.redirect_url ?? res.data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("ผู้ให้บริการ OAuth ไม่ได้ส่ง URL กลับมา");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-background">
      <Card className="w-full max-w-md p-6 space-y-4">
        <div>
          <h1 className="font-display text-2xl">เชื่อมต่อ {clientName}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {clientName} จะสามารถใช้ tools ของแอปนี้ในนามของคุณได้ ขณะที่คุณลงชื่อเข้าใช้งาน
          </p>
        </div>

        <div className="rounded-md border p-3 text-sm space-y-1">
          <div>สิทธิ์ที่ร้องขอ:</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>ดูโปรไฟล์และอีเมลของคุณ</li>
            <li>เรียกใช้ tools ของ Scholar Hall ตามสิทธิ์ที่คุณมี</li>
          </ul>
          <p className="text-xs text-muted-foreground pt-2">
            การเชื่อมต่อนี้ไม่ข้ามสิทธิ์การเข้าถึงข้อมูลของระบบ (RLS ยังคงบังคับใช้ตามบทบาทของคุณ)
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
            ยกเลิก
          </Button>
          <Button disabled={busy} onClick={() => decide(true)}>
            อนุญาต
          </Button>
        </div>
      </Card>
    </main>
  );
}
