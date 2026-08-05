DROP POLICY IF EXISTS "uploads read own or staff" ON storage.objects;
CREATE POLICY "uploads read own or staff" ON storage.objects
FOR SELECT USING (
  bucket_id = 'uploads'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'teacher'::public.app_role)
      AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      AND public.is_teacher_of_user(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  )
);