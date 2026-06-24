import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type AuthContext = { supabase: SupabaseClient<Database>; userId: string };

function getMetadataString(metadata: Json | undefined, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

async function assertAdmin(ctx: AuthContext) {
  const { data: roleRow } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) throw new Error("เฉพาะ admin เท่านั้น");
}

export const listAuthUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const users: {
      id: string;
      email: string | null;
      student_id: string | null;
      display_name: string | null;
      created_at: string;
      last_sign_in_at: string | null;
    }[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        users.push({
          id: u.id,
          email: u.email ?? null,
          student_id: getMetadataString(u.user_metadata, "student_id"),
          display_name: getMetadataString(u.user_metadata, "display_name"),
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < 200) break;
    }
    return { users };
  });

const ResetSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(6).max(128),
});

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ResetSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("student_passwords")
      .upsert(
        { user_id: data.userId, password: data.password, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    return { ok: true };
  });

const ResetDefaultSchema = z.object({ userId: z.string().uuid() });

export const adminResetPasswordDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ResetDefaultSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const defaultPw = "Student@2026";
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: defaultPw,
      email_confirm: true,
    });
    if (error) {
      if (/weak|pwned|compromis/i.test(error.message)) {
        throw new Error("รหัสเริ่มต้นถูกระบบความปลอดภัยปฏิเสธ กรุณาตั้งรหัสใหม่ด้วยตนเอง");
      }
      throw new Error(error.message);
    }
    await supabaseAdmin
      .from("student_passwords")
      .upsert(
        { user_id: data.userId, password: defaultPw, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    return { ok: true, password: defaultPw };
  });

export const listStudentPasswords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("student_passwords")
      .select("user_id, password, updated_at");
    if (error) throw new Error(error.message);
    return { passwords: data ?? [] };
  });

const DeleteSchema = z.object({ userId: z.string().uuid() });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("ลบบัญชีตัวเองไม่ได้");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
