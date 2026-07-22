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
  // host/admin only (raw table includes correct_idx). Use the edit RPC so the
  // edit page can load the full question set even when direct table reads are
  // tightened by RLS/security-view changes.
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: Error | null }>)
  ("get_exam_questions_for_edit", { _exam_id: examId });
  if (error) throw error;
  return ((data as ExamQuestionRow[] | null) ?? []).sort((a, b) => a.idx - b.idx);
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

/** Host/admin: fetch all answers for a specific student in an exam */
export async function fetchStudentAnswers(
  examId: string,
  userId: string,
): Promise<ExamAnswerRow[]> {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("*")
    .eq("session_id", examId)
    .eq("user_id", userId);
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

export async function rpcDeleteExam(examId: string): Promise<void> {
  const { error } = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: unknown }>
  )("delete_exam", { _exam_id: examId });
  if (error) throw error;
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

export interface ExamSubmitBonus {
  combo_applied?: number;
  multiplier_applied?: number;
  perfect_bonus?: number;
  lucky_drop?: {
    id: string;
    kind: "gold" | "xp" | "cosmetic_voucher" | "rare_title";
    amount: number | null;
    status: "granted" | "pending" | "revoked";
  } | null;
}

export async function rpcSubmitExam(
  examId: string,
): Promise<{ total_score: number; xp_awarded: number; base_amount?: number } & ExamSubmitBonus> {
  const { data, error } = await supabase.rpc("submit_exam", { _exam_id: examId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { total_score: 0, xp_awarded: 0 };
}

// ===== Teacher grading helpers =====

/**
 * ตอบ short_answer พร้อมข้อมูล question (สำหรับ UI ครูตรวจข้อเขียน)
 *
 * หมายเหตุ: เรา select * แล้ว cast เอง เพราะ migration 20260719100000
 * เพิ่ม columns graded_by/graded_at ที่ types.ts (Schema B) ยังไม่รู้จัก
 * เมื่อมีการ regenerate types แล้ว สามารถเปลี่ยนไปใช้ generated Row type ได้
 */
export type ShortAnswerForGrading = {
  answer: {
    id: string;
    question_id: string;
    session_id: string;
    user_id: string;
    answer_text: string | null;
    score_awarded: number | null;
    graded_by: "server" | "ai" | "teacher" | null;
    graded_at: string | null;
  };
  question: ExamQuestionRow;
};

export async function fetchShortAnswersForGrading(
  examId: string,
): Promise<ShortAnswerForGrading[]> {
  const { data, error } = await supabase
    .from("exam_answers")
    .select(`*, question:exam_questions!inner(*)`)
    .eq("session_id", examId)
    .not("answer_text", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      answer: {
        id: r.id as string,
        question_id: r.question_id as string,
        session_id: r.session_id as string,
        user_id: r.user_id as string,
        answer_text: r.answer_text as string | null,
        score_awarded: r.score_awarded as number | null,
        graded_by: (r.graded_by as ShortAnswerForGrading["answer"]["graded_by"]) ?? null,
        graded_at: (r.graded_at as string | null) ?? null,
      },
      question: r.question as ExamQuestionRow,
    };
  });
}

/**
 * ครูให้คะแนน short_answer ด้วยมือ (graded_by='teacher')
 * เขียนทับคะแนน AI ได้ และแก้ไขคะแนนตัวเองได้
 */
export async function rpcGradeShortAnswer(args: {
  question_id: string;
  user_id: string;
  is_correct: boolean;
  score: number;
}): Promise<void> {
  // cast เพราะ types.ts (Schema B) ยังไม่รู้จัก RPC นี้ — หลัง regenerate types แล้วเอา cast ออกได้
  const { error } = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: unknown }>
  )("grade_short_answer", {
    _question_id: args.question_id,
    _user_id: args.user_id,
    _is_correct: args.is_correct,
    _score: args.score,
    _graded_by: "teacher",
  });
  if (error) throw error;
}

// ===== Proctoring events (teacher review) =====

export async function fetchProctoringEventsForUser(
  examId: string,
  userId: string,
): Promise<ExamProctoringEventRow[]> {
  const { data, error } = await supabase
    .from("exam_proctoring_events")
    .select("*")
    .eq("session_id", examId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createSnapshotSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("exam-violations")
    .createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}
