// Edge Function "insights": asks Gemini for the AI Insights cards of the Analytics page
// (3 insights about the period and 3 predictions from the 4-week forecast).
// The page sends the JSON summary of the numbers it shows; Gemini sends back 6 short items.
// The Gemini API key is the Supabase secret GEMINI_API_KEY (it never reaches the browser);
// GEMINI_MODEL is optional. Deploy: supabase functions deploy insights
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-lite-latest";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_SUMMARY = 40_000; // characters of JSON; the page sends about 3-5k

// the website calls this function from the browser
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const PROMPT = `You are a business analyst for an LPG (cooking gas) distributor in the Philippines.
Below is a JSON summary of sales, orders and cylinder inventory for the selected branch and period.
Money is in Philippine pesos. Sizes are cylinder weights in kg.
"forecast" holds projections already computed from the last 4 weeks of sales (weekday averages
and the recent trend): next 7 days, this month's projected revenue / expenses / net income,
and the day each cylinder size runs out at the current pace.

Write exactly 6 short, practical items for the owner:
- 3 with "kind": "insight" about what happened in the period (best seller, revenue vs expenses and
  net income, customer mix, payments or delivery).
- 3 with "kind": "prediction" about what is coming, based on "forecast": the month-end outlook,
  which size runs out first and when (and how many to order), and the busy / quiet days ahead.
  Say what the owner should do about it.
Each item:
- "title": 2-4 words
- "text": one or two sentences, max 35 words, quoting real numbers from the data
If something has no data, say what to start tracking instead. Do not invent numbers.
If "forecast" is null, make the predictions about what to watch next period instead.

DATA:
`;

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      kind: { type: "STRING", enum: ["insight", "prediction"] },
      title: { type: "STRING" },
      text: { type: "STRING" },
    },
    required: ["kind", "title", "text"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "GEMINI_API_KEY is not set on the server" });

  // ---- only approved admin and staff accounts can use it (it costs money per call) ----
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return reply(401, { error: "Please log in again." });
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || profile.status !== "approved" || !["admin", "staff"].includes(profile.role)) {
    return reply(403, { error: "Only staff and the admin can get insights." });
  }

  // ---- the numbers sent by the page ----
  let summary: unknown;
  try {
    summary = (await req.json())?.summary;
  } catch {
    return reply(400, { error: "Invalid request" });
  }
  const data = JSON.stringify(summary ?? null);
  if (!summary || typeof summary !== "object" || data.length > MAX_SUMMARY) {
    return reply(400, { error: "Invalid summary" });
  }

  // ---- ask Gemini ----
  let res: Response;
  try {
    res = await fetch(URL, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT + data }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      }),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return reply(503, { error: timeout ? "Gemini took too long to answer" : "Could not reach Gemini" });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 429 / 500 / 503 are worth a retry; pass the status on so the page knows
    const status = [429, 500, 503].includes(res.status) ? 503 : 502;
    return reply(status, { error: body.error?.message || `Gemini request failed (${res.status})` });
  }

  try {
    const text = body.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") || "[]";
    const list = JSON.parse(text);
    if (!Array.isArray(list) || list.length === 0) return reply(502, { error: "Gemini returned no insights" });
    const items = list.map((x) => ({
      kind: x?.kind === "prediction" ? "prediction" : "insight",
      title: String(x?.title ?? "").slice(0, 80),
      text: String(x?.text ?? "").slice(0, 400),
    }));
    return reply(200, { items, model: MODEL });
  } catch {
    return reply(502, { error: "Gemini sent an answer that could not be read" });
  }
});
