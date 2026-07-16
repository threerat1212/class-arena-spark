import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type XpSource = Database["public"]["Enums"]["app_xp_source"];

export type XpTransactionRow = Database["public"]["Tables"]["xp_transactions"]["Row"];

export type TimeRange = "today" | "week" | "month" | "all";

export interface XpCursor {
  created_at: string;
  id: string;
}

export interface FetchXpTransactionsParams {
  limit?: number;
  source?: XpSource | null;
  range?: TimeRange;
  cursor?: XpCursor; // (created_at, id) ของรายการสุดท้าย — composite key กัน drop row เมื่อ timestamp ซ้ำ
}

export interface XpSummary {
  totalXp: number;
  perSource: Record<string, number>;
}

/**
 * คำนวณเวลาเริ่มต้นของ range (local time → Date)
 */
function computeRangeStart(range: TimeRange): Date | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return start;
  }
  if (range === "month") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    return start;
  }
  return null;
}

/**
 * ดึงรายการ XP transactions ของ user ปัจจุบัน (RLS filter ให้อัตโนมัติ)
 */
export async function fetchXpTransactions(
  params: FetchXpTransactionsParams = {},
): Promise<{ data: XpTransactionRow[] | null; error: Error | null }> {
  const { limit = 20, source, range, cursor } = params;

  let query = supabase
    .from("xp_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (source) {
    query = query.eq("source", source);
  }

  if (cursor) {
    // Composite keyset pagination: (created_at, id) < (cursor.created_at, cursor.id)
    // ป้องกัน drop rows เมื่อหลายแถวมี created_at ตรงกัน (เช่น batch INSERT ใน close_weekly_mission)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const rangeStart = computeRangeStart(range ?? "all");
  if (rangeStart) {
    query = query.gte("created_at", rangeStart.toISOString());
  }

  const { data, error } = await query.limit(limit);
  return { data, error: error as Error | null };
}

/**
 * ดึงยอดรวม XP + แยกตาม source สำหรับ range ที่เลือก
 */
export async function fetchXpSummary(
  range: TimeRange = "all",
): Promise<{ data: XpSummary | null; error: Error | null }> {
  const rangeStart = computeRangeStart(range);

  let query = supabase.from("xp_transactions").select("amount, source");

  if (rangeStart) {
    query = query.gte("created_at", rangeStart.toISOString());
  }

  const { data, error } = await query;
  if (error || !data) {
    return { data: null, error: error as Error };
  }

  const summary: XpSummary = {
    totalXp: 0,
    perSource: {},
  };
  for (const row of data) {
    const amt = row.amount ?? 0;
    summary.totalXp += amt;
    const key = row.source as string;
    summary.perSource[key] = (summary.perSource[key] ?? 0) + amt;
  }
  return { data: summary, error: null };
}
