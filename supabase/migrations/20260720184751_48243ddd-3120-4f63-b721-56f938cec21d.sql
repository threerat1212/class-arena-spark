
-- Auto top-up teachers to max level & gold for testing
CREATE OR REPLACE FUNCTION public.topup_teacher_profile(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET level = GREATEST(COALESCE(level, 0), 100),
         xp = GREATEST(COALESCE(xp, 0), 1000000),
         gold = GREATEST(COALESCE(gold, 0), 999999999)
   WHERE id = _user_id;
END;
$$;

-- Trigger: when a teacher (or admin) role is granted, top up the profile
CREATE OR REPLACE FUNCTION public.on_role_grant_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('teacher', 'admin') THEN
    PERFORM public.topup_teacher_profile(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_grant_topup ON public.user_roles;
CREATE TRIGGER trg_role_grant_topup
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.on_role_grant_topup();

-- Backfill: top up all current teachers and admins now
UPDATE public.profiles p
   SET level = GREATEST(COALESCE(p.level, 0), 100),
       xp = GREATEST(COALESCE(p.xp, 0), 1000000),
       gold = GREATEST(COALESCE(p.gold, 0), 999999999)
  FROM public.user_roles ur
 WHERE ur.user_id = p.id
   AND ur.role IN ('teacher', 'admin');
