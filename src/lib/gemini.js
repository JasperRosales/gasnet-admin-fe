// AI Insights of the Analytics page. Gemini is called by the Supabase Edge Function "insights"
// (supabase/functions/insights), which keeps the Gemini API key on the server and checks that
// the user is logged in. This file only sends the page's numbers and caches the answer.
import { cached, hashKey } from './cache'
import { supabase } from './supabaseClient'

const PROMPT_VERSION = 5 // bump to drop old cached answers after editing the prompt (in the function)
const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// set VITE_AI_INSIGHTS=off to hide the AI Insights (for example before the function is deployed)
export const geminiReady = import.meta.env.VITE_AI_INSIGHTS !== 'off'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// the message of a failed call, from the function's { error } answer when there is one
async function errorOf(error) {
  try {
    const body = await error.context?.json?.()
    if (body?.error) return { message: body.error, status: error.context.status }
  } catch {
    // not JSON
  }
  return { message: error.message || 'Could not reach the insights service', status: error.context?.status ?? 0 }
}

// Retries a busy / unreachable service (503, network errors) with backoff: 1s, 2s, 4s
async function callInsights(summary) {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.functions.invoke('insights', { body: { summary } })
    if (!error) {
      const items = Array.isArray(data?.items) ? data.items : []
      if (items.length === 0) throw new Error('Gemini returned no insights')
      // insights first, then predictions
      return [...items.filter((x) => x.kind === 'insight'), ...items.filter((x) => x.kind === 'prediction')].slice(0, 6)
    }
    const { message, status } = await errorOf(error)
    if (![0, 503].includes(status) || attempt >= 3) throw new Error(message)
    await sleep(1000 * 2 ** attempt)
  }
}

// Same data -> same cache key, so switching filters back and forth costs no new calls
export async function getInsights(summary, { force = false } = {}) {
  const key = 'ai-insights:' + (await hashKey({ v: PROMPT_VERSION, summary }))
  return cached(key, TTL_MS, () => callInsights(summary), { force })
}
