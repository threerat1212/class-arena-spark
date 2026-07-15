DROP TRIGGER IF EXISTS submissions_notify_graded ON public.submissions;
DROP TRIGGER IF EXISTS submissions_award_xp ON public.submissions;
ALTER TABLE public.submissions ALTER COLUMN score TYPE numeric(6,2) USING score::numeric;
CREATE TRIGGER submissions_notify_graded AFTER UPDATE OF score, graded_at ON public.submissions FOR EACH ROW EXECUTE FUNCTION notify_submission_graded();
CREATE TRIGGER submissions_award_xp AFTER INSERT OR UPDATE OF graded_at, score ON public.submissions FOR EACH ROW EXECUTE FUNCTION award_submission_grade();