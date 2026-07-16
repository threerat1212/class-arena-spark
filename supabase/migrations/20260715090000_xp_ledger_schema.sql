-- XP Activity Ledger: enum + table + indexes + RLS
-- Spec: docs/superpowers/specs/2026-07-15-xp-activity-ledger-design.md

-- 1. Enum แหล่งที่มาของ XP
CREATE TYPE public.app_xp_source AS ENUM (
  'daily_quest',
  'attendance',
  'weekly_mission',
  'daily_bonus',
  'achievement',
  'shop_purchase',
  'admin_adjustment'
);

-- 2. ตาราง ledger (append-only)
CREATE TABLE public.xp_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount          int  NOT NULL,
  source          public.app_xp_source NOT NULL,
  source_label    text NOT NULL,
  subject         text,
  ref_table       text,
  ref_id          uuid,
  classroom_id    uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  balance_after   int  NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX idx_xpt_user_time
  ON public.xp_transactions (user_id, created_at DESC);

CREATE INDEX idx_xpt_user_source
  ON public.xp_transactions (user_id, source);

-- Partial unique index สำหรับ idempotency (NULL ไม่ enforce)
CREATE UNIQUE INDEX uq_xpt_idempotency
  ON public.xp_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. RLS
ALTER TABLE public.xp_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "xp_transactions read own or admin"
  ON public.xp_transactions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- ไม่มี INSERT/UPDATE/DELETE policy
-- → ผู้ใช้เขียนตรงไม่ได้ ต้องผ่าน SECURITY DEFINER RPC เท่านั้น

-- 5. Grants — client อ่านได้ (RLS filter ให้), เขียนต้องผ่าน RPC เท่านั้น
GRANT SELECT ON public.xp_transactions TO authenticated;
GRANT SELECT ON public.xp_transactions TO anon;
GRANT ALL    ON public.xp_transactions TO service_role;
