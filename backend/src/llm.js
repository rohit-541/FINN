// Model routing. Two tiers, one OpenAI-compatible wire format, so the provider is a config
// choice: "fast" does bulk extraction from documents, "smart" does the one reasoning step.
// Every answer is cached on a hash of its prompt, so a document is only ever read once.
import { cached, sha } from './store.js';

const PRESETS = {
  gemini: { key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', fast: 'gemini-2.5-flash-lite', smart: 'gemini-2.5-flash', json: true },
  groq: { key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', fast: 'llama-3.1-8b-instant', smart: 'llama-3.3-70b-versatile', json: true },
  glm: { key: 'GLM_API_KEY', base: process.env.GLM_BASE_URL, fast: process.env.GLM_MODEL || 'hyde/glm-5.3-flash', smart: process.env.GLM_MODEL || 'hyde/glm-5.3-flash', json: false, thinks: true },
  custom: { key: 'LLM_API_KEY', base: process.env.LLM_BASE_URL, fast: null, smart: null, json: true },
};

function config() {
  // a preset counts only when it has both a key and somewhere to send it
  const name = Object.keys(PRESETS).find((n) => process.env[PRESETS[n].key] && (PRESETS[n].base || process.env.LLM_BASE_URL));
  if (!name) return null;
  const p = PRESETS[name];
  return {
    provider: name,
    apiKey: process.env[p.key],
    base: (process.env.LLM_BASE_URL || p.base || '').replace(/\/$/, ''),
    fast: process.env.LLM_FAST_MODEL || p.fast,
    smart: process.env.LLM_SMART_MODEL || p.smart || process.env.LLM_FAST_MODEL || p.fast,
    json: p.json,
    // a reasoning model spends tokens thinking before it answers; give it room or the answer comes back empty
    thinkBudget: p.thinks || process.env.LLM_THINKS ? Number(process.env.LLM_THINK_TOKENS || 6000) : 0,
  };
}

export const usage = { fast: { calls: 0, in: 0, out: 0 }, smart: { calls: 0, in: 0, out: 0 }, cacheHits: 0 };

// A hard ceiling on fresh model tokens per UTC day, so a leaked URL or a loop cannot run up the bill.
// Cached answers cost nothing and are not counted. LLM_DAILY_TOKENS=0 turns the cap off.
const DAILY_CAP = Number(process.env.LLM_DAILY_TOKENS ?? 2_000_000);
const today = { day: '', tokens: 0 };
function spend(n) {
  const d = new Date().toISOString().slice(0, 10);
  if (today.day !== d) Object.assign(today, { day: d, tokens: 0 });
  today.tokens += n;
}
function overBudget() {
  const d = new Date().toISOString().slice(0, 10);
  return DAILY_CAP > 0 && today.day === d && today.tokens >= DAILY_CAP;
}

export function llmInfo() {
  const c = config();
  if (c) return { enabled: true, provider: c.provider, fast: c.fast, smart: c.smart, usage };
  const keyOnly = Object.values(PRESETS).find((p) => process.env[p.key]);
  return { enabled: false, usage, problem: keyOnly ? `${keyOnly.key} is set but ${keyOnly.key.replace('_API_KEY', '')}_BASE_URL is missing` : null };
}

/** The first complete JSON object or array in the text; models sometimes add a line after it. */
export function parseJson(text) {
  const s = text.replace(/```(?:json)?/g, '');
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error('model returned no JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('model reply was cut off before its JSON ended');
}

async function call(c, model, system, user, maxTokens, effort, attempt = 0) {
  const res = await fetch(`${c.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens + c.thinkBudget,
      temperature: 0.1,
      ...(c.json ? { response_format: { type: 'json_object' } } : {}),
      // reading documents needs no deliberation; judging gets some
      ...(c.thinkBudget ? { reasoning_effort: effort } : {}),
    }),
    signal: AbortSignal.timeout(180000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { // free tiers throttle: wait, retry
    await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
    return call(c, model, system, user, maxTokens, effort, attempt + 1);
  }
  if (!res.ok) throw new Error(`model ${model}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Ask for JSON. tier: 'fast' | 'smart'. Throws when no key is configured. */
export async function llmJson({ tier = 'fast', system, user, maxTokens = 2000 }) {
  const c = config();
  if (!c) throw new Error('NO_LLM');
  const model = c[tier];
  let hit = true;
  const out = await cached(`llm:${sha(model + '\n' + system + '\n' + user)}`, Infinity, async () => {
    hit = false;
    if (overBudget()) throw new Error('daily model budget reached; cached answers still work');
    const d = await call(c, model, system + '\nReply with one JSON object and nothing else.', user, maxTokens, process.env.LLM_SMART_EFFORT && tier === 'smart' ? process.env.LLM_SMART_EFFORT : 'low');
    usage[tier].calls++;
    usage[tier].in += d.usage?.prompt_tokens || 0;
    usage[tier].out += d.usage?.completion_tokens || 0;
    spend((d.usage?.prompt_tokens || 0) + (d.usage?.completion_tokens || 0));
    const choice = d.choices?.[0];
    const content = choice?.message?.content || '';
    if (!content.trim()) throw new Error(`model gave no answer (stopped: ${choice?.finish_reason || 'unknown'})`);
    return parseJson(content);
  });
  if (hit) usage.cacheHits++;
  return out;
}
