
-- 1. user_inventory
CREATE TABLE public.user_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('avatar_frame','name_color','banner','title','xp_potion','combo_shield','streak_freeze','hint_token','retry_token','extra_time','cosmetic_voucher','rare_title')),
  item_code TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT
);
CREATE INDEX idx_user_inventory_user ON public.user_inventory(user_id);
CREATE INDEX idx_user_inventory_kind ON public.user_inventory(user_id, item_kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_inventory TO authenticated;
GRANT ALL ON public.user_inventory TO service_role;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own inventory read" ON public.user_inventory FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own inventory no direct write" ON public.user_inventory FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 2. level_unlocks
CREATE TABLE public.level_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level INT NOT NULL,
  reward_kind TEXT NOT NULL,
  reward_code TEXT NOT NULL,
  reward_amount INT DEFAULT 1,
  label TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(level, reward_kind, reward_code)
);
GRANT SELECT ON public.level_unlocks TO authenticated, anon;
GRANT ALL ON public.level_unlocks TO service_role;
ALTER TABLE public.level_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read level unlocks" ON public.level_unlocks FOR SELECT TO authenticated, anon USING (true);

-- 3. boost_effects
CREATE TABLE public.boost_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  effect_kind TEXT NOT NULL CHECK (effect_kind IN ('xp_potion','combo_shield','streak_freeze')),
  multiplier NUMERIC(4,2),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_boost_effects_active ON public.boost_effects(user_id, effect_kind) WHERE consumed_at IS NULL;
GRANT SELECT ON public.boost_effects TO authenticated;
GRANT ALL ON public.boost_effects TO service_role;
ALTER TABLE public.boost_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own boosts read" ON public.boost_effects FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. profiles cosmetic columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_frame_code TEXT,
  ADD COLUMN IF NOT EXISTS active_banner_code TEXT,
  ADD COLUMN IF NOT EXISTS active_name_color TEXT;
