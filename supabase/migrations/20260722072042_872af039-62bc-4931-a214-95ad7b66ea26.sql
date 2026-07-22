
CREATE POLICY "Students upload own violation snapshots"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'exam-violations'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Read own or host violation snapshots"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'exam-violations'
  AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.exam_sessions s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND s.host_id = auth.uid()
    )
  )
);
