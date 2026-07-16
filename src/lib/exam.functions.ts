import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type ExamSessionRow = Database["public"]["Tables"]["exam_sessions"]["Row"];
export type ExamQuestionRow = Database["public"]["Tables"]["exam_questions"]["Row"];
export type ExamQuestionSafeRow = Database["public"]["Views"]["exam_questions_safe"]["Row"];
export type ExamParticipantRow = Database["public"]["Tables"]["exam_participants"]["Row"];
export type ExamAnswerRow = Database["public"]["Tables"]["exam_answers"]["Row"];
export type ExamProctoringEventRow = Database["public"]["Tables"]["exam_proctoring_events"]["Row"];
export type ExamStatus = ExamSessionRow["status"];
export type QuestionType = ExamQuestionRow["question_type"];
export type ViolationEventType = ExamProctoringEventRow["event_type"];

// ===== Teacher queries =====

export async function fetchTeacherExams(classroomIds: string[]): Promise<ExamSessionRow[]> {
  if (classroomIds.length === 0) return [];
  const { data, error } = await supabase
    .from("exam_sessions")
    .select("*")
    .in("classroom_id", classroomIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchExamRaw(examId: string): Promise<ExamSessionRow | null> {
  const { data, error } = await supabase
    .from("exam_sessions")
    .select("*")
    .eq("id", examId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchExamQuestionsRaw(examId: string): Promise<ExamQuestionRow[]> {
  // host/admin only (raw table includes correct_idx)
  const { data, error } = await supabase
    .from("exam_questions")
    .select("*")
    .eq("session_id", examId)
    .order("idx", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchParticipants(examId: string): Promise<ExamParticipantRow[]> {
  const { data, error } = await supabase
    .from("exam_participants")
    .select("*")
    .eq("session_id", examId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ===== Student queries =====

export async function fetchExamQuestionsSafe(examId: string): Promise<ExamQuestionSafeRow[]> {
  // uses _safe view — correct_idx/expected_answer null until closed
  const { data, error } = await supabase
    .from("exam_questions_safe")
    .select("*")
    .eq("session_id", examId)
    .order("idx", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyExamAnswers(examId: string): Promise<ExamAnswerRow[]> {
  const { data, error } = await supabase.from("exam_answers").select("*").eq("session_id", examId);
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyParticipant(examId: string): Promise<ExamParticipantRow | null> {
  const { data, error } = await supabase
    .from("exam_participants")
    .select("*")
    .eq("session_id", examId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ===== RPC wrappers =====

export async function rpcCreateExam(args: {
  classroom_id: string;
  title: string;
  duration_minutes: number;
  violation_threshold: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_exam", {
    _classroom_id: args.classroom_id,
    _title: args.title,
    _duration_minutes: args.duration_minutes,
    _violation_threshold: args.violation_threshold,
  });
  if (error) throw error;
  return data as string;
}

export async function rpcUpdateExamQuestions(examId: string, questions: unknown[]): Promise<void> {
  const { error } = await supabase.rpc("update_exam_questions", {
    _exam_id: examId,
    _questions: questions as Json,
  });
  if (error) throw error;
}

export async function rpcPublishExam(
  examId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  const { error } = await supabase.rpc("publish_exam", {
    _exam_id: examId,
    _starts_at: startsAt,
    _ends_at: endsAt,
  });
  if (error) throw error;
}

export async function rpcOpenExam(examId: string): Promise<void> {
  const { error } = await supabase.rpc("open_exam", { _exam_id: examId });
  if (error) throw error;
}

export async function rpcCloseExam(
  examId: string,
): Promise<{ user_id: string; auto_submitted: boolean }[]> {
  const { data, error } = await supabase.rpc("close_exam", { _exam_id: examId });
  if (error) throw error;
  return (data as { user_id: string; auto_submitted: boolean }[]) ?? [];
}

export async function rpcJoinExamByCode(code: string): Promise<{ exam_id: string; title: string }> {
  const { data, error } = await supabase.rpc("join_exam_by_code", { _code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("ไม่พบข้อสอบ");
  return row;
}

export async function rpcStartExamAttempt(examId: string): Promise<{
  ends_at: string;
  violation_threshold: number;
  duration_minutes: number;
  started_at: string;
}> {
  const { data, error } = await supabase.rpc("start_exam_attempt", { _exam_id: examId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("ไม่สามารถเริ่มสอบได้");
  return row;
}

export async function rpcSubmitExamAnswer(args: {
  question_id: string;
  answer_idx?: number | null;
  answer_text?: string | null;
}): Promise<{ is_correct: boolean | null; score_awarded: number | null }> {
  const { data, error } = await supabase.rpc("submit_exam_answer", {
    _question_id: args.question_id,
    _answer_idx: (args.answer_idx ?? null) as number,
    _answer_text: (args.answer_text ?? null) as string,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { is_correct: null, score_awarded: null };
}

export async function rpcRecordViolation(args: {
  exam_id: string;
  event_type: ViolationEventType;
  payload?: Record<string, unknown>;
}): Promise<{ violation_count: number; auto_submitted: boolean }> {
  const { data, error } = await supabase.rpc("record_exam_violation", {
    _exam_id: args.exam_id,
    _event_type: args.event_type,
    _payload: (args.payload ?? {}) as Json,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { violation_count: 0, auto_submitted: false };
}

export async function rpcSubmitExam(
  examId: string,
): Promise<{ total_score: number; xp_awarded: number }> {
  const { data, error } = await supabase.rpc("submit_exam", { _exam_id: examId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { total_score: 0, xp_awarded: 0 };
}
