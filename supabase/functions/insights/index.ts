// Edge Function "insights": asks Gemini for the AI Insights cards of the Analytics page
// (4 insights about the period, 2 predictions from the 4-week forecast and 3 business decisions).
// The page sends the JSON summary of the numbers it shows; Gemini sends back 9 items.
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

const PROMPT = `You are a senior business analyst and advisor for an LPG (cooking gas) distributor in the
Philippines with several branches. Below is a JSON summary of sales, orders and cylinder inventory
for the selected branch and period. Money is in Philippine pesos. Sizes are cylinder weights in kg.
"previousPeriod" is the same-length period before, for comparison.
"expensesByBranch" compares branches. "bySize" is sales per cylinder size. "customerMix" splits
walk-in, commercial and delivered orders. "inventory" is the current filled / empty / borrowed count.
"forecast" holds projections already computed from the last 4 weeks of sales (weekday averages
and the recent trend): next 7 days, this month's projected revenue / expenses / net income,
and the day each cylinder size runs out at the current pace.

Write exactly 9 items for the owner, in this order:

A) 4 with "kind": "insight": what happened and WHY it matters. Cover the most important of:
   revenue and net income vs the previous period (with the % change), the margin and the biggest
   cost pressure, the strongest and weakest branch or size, the customer mix, stock health.
   Explain the likely cause and the consequence, not just the number.

B) 2 with "kind": "prediction", based on "forecast": the month-end outlook (revenue, expenses, net)
   and the stock-out risk (which size runs out first, on what day, how many to order to cover
   the next 7 days). If "forecast" is null, predict what to watch next period from the trend.

C) 3 with "kind": "decision": concrete, prudent business decisions the owner can take this week,
   ranked by expected value. Each must follow from the numbers (pricing, restocking amounts per
   size, cutting a specific expense, shifting stock between branches, pushing commercial or
   delivery customers, staffing busy days, collecting utang, etc.). Weigh the risk: prefer
   low-cost, reversible steps; say what to avoid when the data shows a danger (e.g. selling at a
   loss, overstocking a slow size).

Each item:
- "title": 2-5 words
- "text": 2-3 sentences, max 55 words, quoting real numbers from the data (₱, %, kg, units, days)
- "action": for decisions and predictions, one imperative sentence: exactly what to do, with a number
  (amount, size, branch or date) when the data allows. For insights, the one thing to watch. Max 25 words.
- "impact": for decisions, the expected result in numbers or a clear outcome (max 20 words);
  for the others, an empty string.
- "priority": "high", "medium" or "low": how urgent or valuable it is.
Use only numbers that are in the data or simply derived from it (sums, differences, percentages).
Never invent figures. If something has no data, say what to start tracking instead.
Write plainly, for a busy owner, no jargon.

DATA:
`;

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      kind: { type: "STRING", enum: ["insight", "prediction", "decision"] },
      title: { type: "STRING" },
      text: { type: "STRING" },
      action: { type: "STRING" },
      impact: { type: "STRING" },
      priority: { type: "STRING", enum: ["high", "medium", "low"] },
    },
    required: ["kind", "title", "text", "action", "priority"],
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
    const kinds = ["insight", "prediction", "decision"];
    const priorities = ["high", "medium", "low"];
    const items = list.map((x) => ({
      kind: kinds.includes(x?.kind) ? x.kind : "insight",
      title: String(x?.title ?? "").slice(0, 80),
      text: String(x?.text ?? "").slice(0, 600),
      action: String(x?.action ?? "").slice(0, 300),
      impact: String(x?.impact ?? "").slice(0, 250),
      priority: priorities.includes(x?.priority) ? x.priority : "medium",
    }));
    return reply(200, { items, model: MODEL });
  } catch {
    return reply(502, { error: "Gemini sent an answer that could not be read" });
  }
});
