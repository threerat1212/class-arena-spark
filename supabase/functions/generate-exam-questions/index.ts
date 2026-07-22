// Generate exam questions from a topic/content — teacher/admin only.
// AI writes questions + options only. Teacher fills in the correct answer.
// Returns { questions: [{ question_type, question, options?, points }] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["teacher", "admin"]);
    if (!roleRows || roleRows.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const topic: string = typeof body.topic === "string" ? body.topic : "";
    const content: string = typeof body.content === "string" ? body.content : "";
    const optionsCount: number = Math.min(6, Math.max(2, Number(body.options_count) || 4));
    const questionType: "multiple_choice" | "short_answer" | "essay" | "mixed" =
      body.question_type === "short_answer" ||
      body.question_type === "essay" ||
      body.question_type === "mixed"
        ? body.question_type
        : "multiple_choice";
    const difficulty: string =
      typeof body.difficulty === "string" ? body.difficulty : "ปานกลาง";

    // distribution: { easy, medium, hard } overrides count + difficulty when provided
    const dist = body.distribution && typeof body.distribution === "object"
      ? {
          easy: Math.max(0, Math.min(30, Number(body.distribution.easy) || 0)),
          medium: Math.max(0, Math.min(30, Number(body.distribution.medium) || 0)),
          hard: Math.max(0, Math.min(30, Number(body.distribution.hard) || 0)),
        }
      : null;
    const distTotal = dist ? dist.easy + dist.medium + dist.hard : 0;
    const count: number = dist && distTotal > 0
      ? Math.min(30, distTotal)
      : Math.min(30, Math.max(1, Number(body.count) || 5));

    if (!content.trim() && !topic.trim()) {
      return new Response(JSON.stringify({ error: "topic or content required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (content.length > 15000) {
      return new Response(JSON.stringify({ error: "content too long (max 15000 chars)" }), {
        status: 413,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (topic.length > 500) {
      return new Response(JSON.stringify({ error: "topic too long" }), {
        status: 413,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const typeInstruction =
      questionType === "multiple_choice"
        ? `ทุกข้อเป็นปรนัย (multiple_choice) มีตัวเลือก ${optionsCount} ตัว (ก, ข, ค, ง...)`
        : questionType === "short_answer"
          ? "ทุกข้อเป็นเติมคำสั้น (short_answer) ไม่ต้องมีตัวเลือก"
          : questionType === "essay"
            ? "ทุกข้อเป็นข้อเขียนตอบยาว (essay) ให้นักเรียนอธิบาย/วิเคราะห์ ไม่ต้องมีตัวเลือก"
            : `ผสม multiple_choice (มี ${optionsCount} ตัวเลือก), short_answer และ essay ตามความเหมาะสม`;

    const difficultyInstruction = dist && distTotal > 0
      ? `แบ่งความยากตามนี้เป๊ะๆ (รวม ${distTotal} ข้อ):
  • ง่าย ${dist.easy} ข้อ (points 1)
  • ปานกลาง ${dist.medium} ข้อ (points 2-3)
  • ยาก ${dist.hard} ข้อ (points 4-5)
สลับลำดับข้อผสมกันไป ไม่ต้องเรียงจากง่ายไปยาก`
      : `ระดับความยากรวม: ${difficulty}`;

    const system = `คุณคือ AI ช่วยครูออกแบบข้อสอบภาษาไทยจากเนื้อหาที่กำหนด
- ออกข้อสอบจำนวน ${count} ข้อ จากเนื้อหานี้เท่านั้น ห้ามออกนอกเรื่อง
- ${difficultyInstruction}
- ${typeInstruction}
- คำถามชัดเจน ไม่กำกวม เหมาะกับนักเรียน
- ตัวเลือกในปรนัยต้องสมเหตุสมผลและใกล้เคียงกัน ไม่มีตัวเลือกตลกหรือชัดเจนเกินไป
- **ห้ามเฉลยหรือระบุคำตอบที่ถูก** ครูจะเลือกคำตอบเอง
- points ต่อข้อระหว่าง 1-5 ตามความยาก`;

    const userPrompt = `หัวข้อ: ${topic || "-"}\n\nเนื้อหา:\n${content || "(ใช้เฉพาะหัวข้อ)"}\n\nออกข้อสอบ ${count} ข้อ (ไม่ต้องเฉลย)`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "design_exam",
              description: "Design exam questions from content (no answer key)",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question_type: {
                          type: "string",
                          enum: ["multiple_choice", "short_answer", "essay"],
                        },
                        question: { type: "string" },
                        options: {
                          type: "array",
                          items: { type: "string" },
                          description:
                            "options for multiple_choice; empty array for short_answer",
                        },
                        points: { type: "number" },
                      },
                      required: ["question_type", "question", "options", "points"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "design_exam" } },
      }),
    });
    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (res.status === 402) {
      return new Response(JSON.stringify({ error: "credits" }), {
        status: 402,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!res.ok) {
      const errText = await res.text();
      console.error("[generate-exam-questions] AI error", res.status, errText);
      return new Response(JSON.stringify({ error: errText }), {
        status: res.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const j = await res.json();
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? JSON.parse(args) : { questions: [] };
    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[generate-exam-questions] crashed", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
