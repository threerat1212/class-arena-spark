
-- 1) daily_quests: restrict base-table SELECT to owners/admins
DROP POLICY IF EXISTS "dq read members" ON public.daily_quests;
CREATE POLICY "dq read owners/admins"
ON public.daily_quests FOR SELECT
USING (is_classroom_owner(classroom_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- 2) exam_questions: restrict base-table SELECT to hosts/admins (members use exam_questions_safe view)
DROP POLICY IF EXISTS "Members read questions during active/closed" ON public.exam_questions;

-- 3) canva_assignments: restrict student UPDATE to opened_at only
DROP POLICY IF EXISTS "Students update own canva assignment opened_at" ON public.canva_assignments;

CREATE OR REPLACE FUNCTION public.enforce_canva_assignment_student_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Owners/admins bypass this check via the "Classroom owners manage" policy path.
  IF has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.canva_sessions s
    JOIN public.classrooms c ON c.id = s.classroom_id
    WHERE s.id = NEW.session_id AND c.owner_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;
  -- Student path: only opened_at may change.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.canva_url IS DISTINCT FROM OLD.canva_url
     OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
     OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
    RAISE EXCEPTION 'Students may only update opened_at on canva_assignments';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_canva_assignment_student_update ON public.canva_assignments;
CREATE TRIGGER trg_enforce_canva_assignment_student_update
BEFORE UPDATE ON public.canva_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_canva_assignment_student_update();

CREATE POLICY "Students mark own canva assignment opened"
ON public.canva_assignments FOR UPDATE
USING (student_id = auth.uid())
WITH CHECK (student_id = auth.uid());

-- 4) user_badges: teachers may only read badges for their own students
DROP POLICY IF EXISTS "Teachers/Admins read user badges" ON public.user_badges;
CREATE POLICY "Teachers read own students badges; admins read all"
ON public.user_badges FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'teacher'::app_role) AND is_teacher_of_user(auth.uid(), user_id))
);

-- 5) Function search_path lint
ALTER FUNCTION public.combo_multiplier(integer) SET search_path = public;
