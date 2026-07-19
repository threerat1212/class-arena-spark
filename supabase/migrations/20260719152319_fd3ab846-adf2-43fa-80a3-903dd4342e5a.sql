
-- 1) Private profile table
CREATE TABLE IF NOT EXISTS public.profiles_private (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  birthday date,
  bio text,
  grade_level text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles_private TO authenticated;
GRANT ALL ON public.profiles_private TO service_role;
ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own private profile select" ON public.profiles_private;
CREATE POLICY "own private profile select" ON public.profiles_private
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "own private profile write" ON public.profiles_private;
CREATE POLICY "own private profile write" ON public.profiles_private
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));

-- 2) Migrate existing data
INSERT INTO public.profiles_private (user_id, birthday, bio, grade_level)
SELECT id, birthday, bio, grade_level FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- 3) Drop sensitive columns from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS birthday;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bio;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS grade_level;

-- 4) Update birthday-related functions to use profiles_private
CREATE OR REPLACE FUNCTION public.check_birthday_visit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  bday date;
  visited boolean;
  today_bkk date;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT pp.birthday, p.birthday_visited INTO bday, visited
    FROM public.profiles p
    LEFT JOIN public.profiles_private pp ON pp.user_id = p.id
    WHERE p.id = uid;
  IF bday IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_birthday'); END IF;
  today_bkk := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  IF EXTRACT(MONTH FROM bday) = EXTRACT(MONTH FROM today_bkk)
     AND EXTRACT(DAY FROM bday) = EXTRACT(DAY FROM today_bkk)
     AND NOT COALESCE(visited, false) THEN
    UPDATE public.profiles SET birthday_visited = true WHERE id = uid;
    PERFORM public.check_and_award_achievements(uid);
    RETURN jsonb_build_object('ok', true, 'birthday', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'birthday', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_birthday_flag_if_needed(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bday date;
  visited boolean;
  today_bkk date;
BEGIN
  SELECT pp.birthday, p.birthday_visited INTO bday, visited
    FROM public.profiles p
    LEFT JOIN public.profiles_private pp ON pp.user_id = p.id
    WHERE p.id = _user_id;
  IF bday IS NULL OR NOT COALESCE(visited,false) THEN RETURN; END IF;
  today_bkk := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  IF EXTRACT(MONTH FROM bday) <> EXTRACT(MONTH FROM today_bkk)
     OR EXTRACT(DAY FROM bday) <> EXTRACT(DAY FROM today_bkk) THEN
    UPDATE public.profiles SET birthday_visited = false WHERE id = _user_id;
  END IF;
END;
$function$;

-- 5) Add WITH CHECK on profiles UPDATE policies to prevent gamification field forging.
--    A companion trigger public.protect_profile_stats already exists; the WITH CHECK
--    is defense-in-depth so PostgREST rejects such updates outright.
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND xp                = (SELECT xp                FROM public.profiles WHERE id = auth.uid())
    AND gold              = (SELECT gold              FROM public.profiles WHERE id = auth.uid())
    AND level             = (SELECT level             FROM public.profiles WHERE id = auth.uid())
    AND streak_days       = (SELECT streak_days       FROM public.profiles WHERE id = auth.uid())
    AND quests_completed  = (SELECT quests_completed  FROM public.profiles WHERE id = auth.uid())
    AND perfect_scores    = (SELECT perfect_scores    FROM public.profiles WHERE id = auth.uid())
    AND last_quest_date IS NOT DISTINCT FROM (SELECT last_quest_date FROM public.profiles WHERE id = auth.uid())
  );
