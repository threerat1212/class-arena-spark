// Types for the Engagement Engine gamification layer.
// Mirrors the award_xp() return shape and the new tables added in
// supabase/migrations/20260720100000_engagement_engine.sql

export type AwardOutcome = "success" | "perfect" | "fail" | null;

export interface LuckyDropReward {
  id: string;
  kind: "gold" | "xp" | "cosmetic_voucher" | "rare_title";
  amount: number | null;
  status: "granted" | "pending" | "revoked";
}

/** Return shape of the rewritten award_xp() RPC. */
export interface AwardXpResult {
  transaction_id: string;
  new_xp: number;
  new_level: number;
  leveled_up: boolean;
  base_amount: number;
  combo_applied: number;
  multiplier_applied: number;
  perfect_bonus: number;
  lucky_drop: LuckyDropReward | null;
}

/** Bonus math stored in xp_transactions.metadata.bonus_breakdown. */
export interface BonusBreakdownMeta {
  base: number;
  combo_multiplier: number;
  combo_count: number;
  event_multiplier: number;
  event_id: string | null;
  outcome: AwardOutcome;
}

/** combo_state row. */
export interface ComboStateRow {
  user_id: string;
  current_combo: number;
  max_combo: number;
  last_success_at: string | null;
  last_ref_id: string | null;
  updated_at: string;
}

/** multiplier_events row. `multiplier` is a string in Supabase types
 *  (numeric column) — coerce with Number() at the UI boundary. */
export interface MultiplierEventRow {
  id: string;
  starts_at: string;
  ends_at: string;
  multiplier: string | number;
  label: string;
  scope: "global" | "classroom";
  classroom_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/** lucky_drop_log row. */
export interface LuckyDropLogRow {
  id: string;
  user_id: string;
  source_ref: string | null;
  reward_kind: "gold" | "xp" | "cosmetic_voucher" | "rare_title";
  reward_amount: number | null;
  reward_code: string | null;
  status: "granted" | "pending" | "revoked";
  granted_at: string | null;
  created_at: string;
}

/** Combo tier metadata for UI styling. */
export interface ComboTier {
  min: number;
  multiplier: number;
  /** i18n key suffix under gamification.combo.tier.<label>. */
  label: string;
  /** tailwind classes for the badge text/glow. */
  glowClass: string;
}

export const COMBO_TIERS: ComboTier[] = [
  { min: 0, multiplier: 1.0, label: "warm", glowClass: "" },
  { min: 3, multiplier: 1.2, label: "spark", glowClass: "text-amber-500" },
  { min: 5, multiplier: 1.5, label: "blaze", glowClass: "text-orange-500" },
  { min: 7, multiplier: 1.8, label: "inferno", glowClass: "text-red-500" },
  { min: 10, multiplier: 2.0, label: "max", glowClass: "text-fuchsia-500" },
];

export function comboTierFor(combo: number): ComboTier {
  let tier = COMBO_TIERS[0];
  for (const t of COMBO_TIERS) {
    if (combo >= t.min) tier = t;
  }
  return tier;
}

/** Coerce the multiplier column (string from Postgres numeric) to a number. */
export function eventMultiplier(e: MultiplierEventRow): number {
  return Number(e.multiplier);
}
