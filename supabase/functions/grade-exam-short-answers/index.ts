// AI grading edge function for exam short-answer questions
// Uses Lovable AI Gateway with JSON-mode response. Mirrors generate-quest pattern.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { exam_id } = await req.json();
    if (!exam_id) {
      return new Response(JSON.stringify({ error: "exam_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!supabaseUrl || !serviceKey) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    }
    if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

    // service-role client bypasses RLS for grading writes
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // fetch ungraded short answers joined with their question
    const { data: answers, error: aErr } = await sb
      .from("exam_answers")
      .select(`
        id, question_id, user_id, answer_text,
        exam_questions!inner(expected_answer, question, points)
      `)
      .eq("session_id", exam_id)
      .is("graded_by", null)
      .not("answer_text", "is", null);
    if (aErr) {
      return new Response(JSON.stringify({ error: aErr }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!answers || answers.length === 0) {
      return new Response(JSON.stringify({ graded: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let graded = 0;
    for (const a of answers) {
      const q = a.exam_questions as unknown as {
        expected_answer: string;
        question: string;
        points: number;
      };
      // call AI gateway
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${lovableKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                'You grade Thai student short answers. Compare the student\'s answer against the expected answer/key terms. Return JSON only: {"is_correct": bool, "score": int (0 to max_points), "reason": "short explanation in Thai"}. Be lenient with typos, synonyms, and equivalent phrasings in Thai.',
            },
            {
              role: "user",
              content: `Question: ${q.question}\nExpected answer: ${q.expected_answer}\nMax points: ${q.points}\nStudent answer: ${a.answer_text}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const aiJson = await aiRes.json();
      try {
        const result = JSON.parse(aiJson.choices[0].message.content);
        await sb.rpc("grade_short_answer", {
          _question_id: a.question_id,
          _user_id: a.user_id,
          _is_correct: !!result.is_correct,
          _score: Math.max(0, Math.min(q.points, Number(result.score) || 0)),
          _graded_by: "ai",
        });
        graded++;
      } catch (e) {
        console.error("Grade failed for", a.id, e);
      }
    }

    return new Response(JSON.stringify({ graded }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
