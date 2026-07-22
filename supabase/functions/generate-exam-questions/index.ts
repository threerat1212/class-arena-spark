// Generate exam questions from a topic/content — teacher/admin only.
// Returns { questions: [{ question_type, question, options?, correct_idx?, expected_answer?, points }] }
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
    const count: number = Math.min(20, Math.max(1, Number(body.count) || 5));
    const questionType: "multiple_choice" | "short_answer" | "mixed" =
      body.question_type === "short_answer" || body.question_type === "mixed"
        ? body.question_type
        : "multiple_choice";
    const difficulty: string =
      typeof body.difficulty === "string" ? body.difficulty : "ปานกลาง";

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
        ? "ทุกข้อเป็นปรนัย (multiple_choice) มีตัวเลือก 4 ตัว และระบุ correct_idx (0-3)"
        : questionType === "short_answer"
          ? "ทุกข้อเป็นเติมคำสั้น (short_answer) มี expected_answer เป็นคำตอบหรือคำสำคัญ"
          : "ผสมกันระหว่าง multiple_choice และ short_answer ตามความเหมาะสม";

    const system = `คุณคือ AI ช่วยครูออกแบบข้อสอบภาษาไทยจากเนื้อหาที่กำหนด
- ออกข้อสอบจำนวน ${count} ข้อ จากเนื้อหานี้เท่านั้น ห้ามออกนอกเรื่อง
- ระดับความยากรวม: ${difficulty}
- ${typeInstruction}
- คำถามชัดเจน ไม่กำกวม เหมาะกับนักเรียน
- ตัวเลือกในปรนัยต้องสมเหตุสมผล ไม่มีตัวเลือกตลกหรือชัดเจนเกินไป
- expected_answer สำหรับ short_answer ให้เป็นคำตอบหลักหรือคำสำคัญที่นักเรียนต้องตอบ
- points ต่อข้อระหว่าง 1-5 ตามความยาก`;

    const userPrompt = `หัวข้อ: ${topic || "-"}\n\nเนื้อหา:\n${content || "(ใช้เฉพาะหัวข้อ)"}\n\nออกข้อสอบ ${count} ข้อ`;

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
              description: "Design exam questions from content",
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
                          enum: ["multiple_choice", "short_answer"],
                        },
                        question: { type: "string" },
                        options: {
                          type: "array",
                          items: { type: "string" },
                          description: "4 options for multiple_choice, empty for short_answer",
                        },
                        correct_idx: {
                          type: "number",
                          description: "0-3 for multiple_choice, ignored otherwise",
                        },
                        expected_answer: {
                          type: "string",
                          description: "correct answer or keyword for short_answer",
                        },
                        points: { type: "number" },
                      },
                      required: [
                        "question_type",
                        "question",
                        "options",
                        "correct_idx",
                        "expected_answer",
                        "points",
                      ],
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
