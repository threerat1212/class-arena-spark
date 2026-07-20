
-- grant_inventory_item (internal use — SECURITY DEFINER, callable via other RPCs)
CREATE OR REPLACE FUNCTION public.grant_inventory_item(
  _user_id UUID, _kind TEXT, _code TEXT, _qty INT DEFAULT 1, _source TEXT DEFAULT NULL, _meta JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id UUID; _existing UUID;
BEGIN
  IF _kind IN ('avatar_frame','name_color','banner','title') THEN
    SELECT id INTO _existing FROM public.user_inventory
      WHERE user_id=_user_id AND item_kind=_kind AND item_code=_code LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
    INSERT INTO public.user_inventory(user_id,item_kind,item_code,quantity,source,metadata)
      VALUES (_user_id,_kind,_code,1,_source,_meta) RETURNING id INTO _id;
  ELSE
    SELECT id INTO _existing FROM public.user_inventory
      WHERE user_id=_user_id AND item_kind=_kind AND item_code=_code LIMIT 1;
    IF _existing IS NOT NULL THEN
      UPDATE public.user_inventory SET quantity = quantity + _qty WHERE id=_existing;
      RETURN _existing;
    END IF;
    INSERT INTO public.user_inventory(user_id,item_kind,item_code,quantity,source,metadata)
      VALUES (_user_id,_kind,_code,_qty,_source,_meta) RETURNING id INTO _id;
  END IF;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.grant_inventory_item(UUID,TEXT,TEXT,INT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;

-- grant_level_unlocks: called on level-up
CREATE OR REPLACE FUNCTION public.grant_level_unlocks(_user_id UUID, _new_level INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r RECORD; _count INT := 0;
BEGIN
  FOR _r IN SELECT * FROM public.level_unlocks WHERE level <= _new_level LOOP
    IF _r.reward_kind IN ('avatar_frame','name_color','banner','title') THEN
      IF NOT EXISTS(SELECT 1 FROM public.user_inventory
        WHERE user_id=_user_id AND item_kind=_r.reward_kind AND item_code=_r.reward_code) THEN
        PERFORM public.grant_inventory_item(_user_id, _r.reward_kind, _r.reward_code, 1, 'level_unlock:'||_r.level);
        INSERT INTO public.notifications(user_id,type,title,body,link)
          VALUES (_user_id,'level_unlock','🎁 ปลดล็อกรางวัล Lv.'||_r.level, COALESCE(_r.label,_r.reward_code), '/rewards');
        _count := _count + 1;
      END IF;
    ELSE
      -- consumables: only grant once per level
      IF NOT EXISTS(SELECT 1 FROM public.user_inventory
        WHERE user_id=_user_id AND source='level_unlock:'||_r.level AND item_kind=_r.reward_kind AND item_code=_r.reward_code) THEN
        PERFORM public.grant_inventory_item(_user_id, _r.reward_kind, _r.reward_code, COALESCE(_r.reward_amount,1), 'level_unlock:'||_r.level);
        INSERT INTO public.notifications(user_id,type,title,body,link)
          VALUES (_user_id,'level_unlock','🎁 ปลดล็อกรางวัล Lv.'||_r.level, COALESCE(_r.label,_r.reward_code)||' ×'||COALESCE(_r.reward_amount,1), '/rewards');
        _count := _count + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN _count;
END $$;
REVOKE EXECUTE ON FUNCTION public.grant_level_unlocks(UUID,INT) FROM PUBLIC, anon, authenticated;

-- equip_cosmetic
CREATE OR REPLACE FUNCTION public.equip_cosmetic(_kind TEXT, _code TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _code IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.user_inventory WHERE user_id=uid AND item_kind=_kind AND item_code=_code
  ) THEN RAISE EXCEPTION 'ยังไม่มีไอเทมนี้'; END IF;
  IF _kind='avatar_frame' THEN UPDATE public.profiles SET active_frame_code=_code WHERE id=uid;
  ELSIF _kind='banner' THEN UPDATE public.profiles SET active_banner_code=_code WHERE id=uid;
  ELSIF _kind='name_color' THEN UPDATE public.profiles SET active_name_color=_code WHERE id=uid;
  ELSE RAISE EXCEPTION 'unsupported cosmetic kind: %', _kind;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.equip_cosmetic(TEXT,TEXT) TO authenticated;

-- use_boost: activate a boost from inventory
CREATE OR REPLACE FUNCTION public.use_boost(_kind TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); inv_id UUID; expires TIMESTAMPTZ; mult NUMERIC;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT id INTO inv_id FROM public.user_inventory
    WHERE user_id=uid AND item_kind=_kind AND quantity>0 LIMIT 1 FOR UPDATE;
  IF inv_id IS NULL THEN RAISE EXCEPTION 'ไม่มีบูสต์นี้ในกระเป๋า'; END IF;

  IF _kind='xp_potion' THEN
    IF EXISTS(SELECT 1 FROM public.boost_effects WHERE user_id=uid AND effect_kind='xp_potion' AND consumed_at IS NULL AND expires_at>now()) THEN
      RAISE EXCEPTION 'ยาบูสต์ XP กำลังทำงานอยู่';
    END IF;
    expires := now() + interval '60 minutes'; mult := 1.5;
    INSERT INTO public.boost_effects(user_id,effect_kind,multiplier,expires_at)
      VALUES (uid,'xp_potion',mult,expires);
  ELSIF _kind='combo_shield' THEN
    IF EXISTS(SELECT 1 FROM public.boost_effects WHERE user_id=uid AND effect_kind='combo_shield' AND consumed_at IS NULL) THEN
      RAISE EXCEPTION 'มีโล่ combo ติดตัวอยู่แล้ว';
    END IF;
    INSERT INTO public.boost_effects(user_id,effect_kind) VALUES (uid,'combo_shield');
  ELSIF _kind='streak_freeze' THEN
    IF EXISTS(SELECT 1 FROM public.boost_effects WHERE user_id=uid AND effect_kind='streak_freeze' AND consumed_at IS NULL) THEN
      RAISE EXCEPTION 'มีโล่ streak ติดตัวอยู่แล้ว';
    END IF;
    INSERT INTO public.boost_effects(user_id,effect_kind) VALUES (uid,'streak_freeze');
  ELSE RAISE EXCEPTION 'unsupported boost kind: %', _kind;
  END IF;

  UPDATE public.user_inventory SET quantity=quantity-1 WHERE id=inv_id;
  DELETE FROM public.user_inventory WHERE id=inv_id AND quantity<=0;
  RETURN jsonb_build_object('ok',true,'kind',_kind,'expires_at',expires);
END $$;
GRANT EXECUTE ON FUNCTION public.use_boost(TEXT) TO authenticated;

-- consume_token: generic consume for utility tokens (hint/retry/extra_time)
CREATE OR REPLACE FUNCTION public.consume_token(_kind TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); inv_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _kind NOT IN ('hint_token','retry_token','extra_time') THEN
    RAISE EXCEPTION 'unsupported token kind: %', _kind;
  END IF;
  SELECT id INTO inv_id FROM public.user_inventory
    WHERE user_id=uid AND item_kind=_kind AND quantity>0 LIMIT 1 FOR UPDATE;
  IF inv_id IS NULL THEN RAISE EXCEPTION 'ไม่มีโทเคนนี้ในกระเป๋า'; END IF;
  UPDATE public.user_inventory SET quantity=quantity-1 WHERE id=inv_id;
  DELETE FROM public.user_inventory WHERE id=inv_id AND quantity<=0;
  RETURN jsonb_build_object('ok',true,'kind',_kind);
END $$;
GRANT EXECUTE ON FUNCTION public.consume_token(TEXT) TO authenticated;

-- purchase_shop_item_v2: extends existing purchase logic to route items into inventory by kind_code metadata
CREATE OR REPLACE FUNCTION public.purchase_shop_item_v2(_item_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item RECORD; current_gold INT; uid UUID := auth.uid();
  reward_kind TEXT; reward_code TEXT; reward_qty INT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO item FROM public.shop_items WHERE id=_item_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบไอเทม'; END IF;
  SELECT gold INTO current_gold FROM public.profiles WHERE id=uid;
  IF current_gold < item.gold_price THEN RAISE EXCEPTION 'ทองไม่พอ'; END IF;

  -- read reward from item metadata (falls back to legacy title_id behavior)
  reward_kind := item.metadata->>'reward_kind';
  reward_code := item.metadata->>'reward_code';
  reward_qty  := COALESCE((item.metadata->>'reward_amount')::int, 1);

  -- one-time cosmetics: block duplicate purchase
  IF reward_kind IN ('avatar_frame','name_color','banner','title') OR item.title_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.shop_purchases WHERE user_id=uid AND item_id=_item_id) THEN
      RAISE EXCEPTION 'คุณซื้อไอเทมนี้ไปแล้ว';
    END IF;
  END IF;

  UPDATE public.profiles SET gold = gold - item.gold_price WHERE id=uid;
  INSERT INTO public.shop_purchases(user_id,item_id,gold_spent) VALUES (uid,_item_id,item.gold_price);

  IF item.title_id IS NOT NULL THEN
    INSERT INTO public.user_titles(user_id,title_id) VALUES (uid,item.title_id) ON CONFLICT DO NOTHING;
  END IF;
  IF reward_kind IS NOT NULL AND reward_code IS NOT NULL THEN
    PERFORM public.grant_inventory_item(uid, reward_kind, reward_code, reward_qty, 'shop:'||_item_id::text);
  END IF;

  INSERT INTO public.notifications(user_id,title,body,type,link)
  VALUES (uid,'🛒 ซื้อสำเร็จ','ได้รับ: '||item.name,'shop','/rewards');
  RETURN jsonb_build_object('ok',true,'item',item.name);
END $$;
GRANT EXECUTE ON FUNCTION public.purchase_shop_item_v2(UUID) TO authenticated;

-- Add metadata column to shop_items if missing (for reward_kind/reward_code linkage)
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Hook grant_level_unlocks into award_xp automatically via trigger on profiles.level change
CREATE OR REPLACE FUNCTION public.on_profile_level_up()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.level > COALESCE(OLD.level,0) THEN
    PERFORM public.grant_level_unlocks(NEW.id, NEW.level);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_profile_level_up ON public.profiles;
CREATE TRIGGER trg_profile_level_up AFTER UPDATE OF level ON public.profiles
  FOR EACH ROW WHEN (NEW.level IS DISTINCT FROM OLD.level)
  EXECUTE FUNCTION public.on_profile_level_up();
