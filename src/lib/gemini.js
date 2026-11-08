import { cached, hashKey } from './cache'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-flash-lite-latest'
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

const PROMPT_VERSION = 3 // bump to drop old cached answers after editing the prompt
const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const TIMEOUT_MS = 30_000 // per attempt

export const geminiReady = Boolean(API_KEY)

const PROMPT = `You are a business analyst for an LPG (cooking gas) distributor in the Philippines.
Below is a JSON summary of sales, orders and cylinder inventory for the selected branch and period.
Money is in Philippine pesos. Sizes are cylinder weights in kg.

Write exactly 4 short, practical insights for the owner. Each one:
- "title": 2-4 words
- "text": one or two sentences, max 35 words, quoting real numbers from the data
Cover different angles (best seller, revenue vs expenses and net income, inventory or empties, customer mix or delivery).
If something has no data, say what to start tracking instead. Do not invent numbers.

DATA:
`

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { title: { type: 'STRING' }, text: { type: 'STRING' } },
    required: ['title', 'text'],
  },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retries timeouts and busy/rate-limited responses (429, 500, 503) with backoff: 1s, 2s, 4s
async function callGemini(summary) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(summary)
    } catch (e) {
      if (!e.retry || attempt >= 3) throw e
      await sleep(1000 * 2 ** attempt)
    }
  }
}

async function callOnce(summary) {
  let res
  try {
    res = await fetch(URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT + JSON.stringify(summary) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
    })
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' ? 'Gemini took too long to answer' : e.message)
    err.retry = true
    throw err
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error?.message || `Gemini request failed (${res.status})`)
    err.retry = [429, 500, 503].includes(res.status)
    throw err
  }

  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]'
  const list = JSON.parse(text)
  if (!Array.isArray(list) || list.length === 0) throw new Error('Gemini returned no insights')
  return list.slice(0, 4).map((x) => ({ title: String(x.title), text: String(x.text) }))
}

// Same data -> same cache key, so switching filters back and forth costs no new calls
export async function getInsights(summary, { force = false } = {}) {
  if (!geminiReady) throw new Error('Set VITE_GEMINI_API_KEY in .env')
  const key = 'ai-insights:' + (await hashKey({ v: PROMPT_VERSION, model: MODEL, summary }))
  return cached(key, TTL_MS, () => callGemini(summary), { force })
}
