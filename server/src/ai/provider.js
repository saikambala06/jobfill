/**
 * Pluggable LLM provider. Groq is primary (fast + cheap, which matters when a
 * single page can trigger a 40-field plan); Anthropic is the fallback and the
 * preferred model for long-form written answers where quality beats latency.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

class ProviderError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function callGroq({ system, user, json, temperature = 0.2, maxTokens = 4096 }) {
  if (!process.env.GROQ_API_KEY) throw new ProviderError('GROQ_API_KEY is not set', 500);

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) throw new ProviderError(`Groq ${res.status}: ${await res.text()}`, res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic({ system, user, json, temperature = 0.2, maxTokens = 4096 }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new ProviderError('ANTHROPIC_API_KEY is not set', 500);

  // Anthropic has no JSON mode flag; prefilling the assistant turn with "{" is the
  // supported way to force the model straight into a JSON object.
  const messages = [{ role: 'user', content: user }];
  if (json) messages.push({ role: 'assistant', content: '{' });

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, system, temperature, max_tokens: maxTokens, messages }),
  });

  if (!res.ok) throw new ProviderError(`Anthropic ${res.status}: ${await res.text()}`, res.status);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return json ? `{${text}` : text;
}

function parseJson(raw) {
  const cleaned = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Models occasionally trail a sentence after the object. Take the outermost braces.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new ProviderError('Model did not return parseable JSON', 502);
  }
}

/**
 * @param {object} opts
 * @param {'groq'|'anthropic'} [opts.provider] force a provider; otherwise Groq with Anthropic failover
 */
export async function complete({ provider, ...opts }) {
  const order = provider === 'anthropic'
    ? [callAnthropic]
    : [callGroq, callAnthropic];

  let lastErr;
  for (const fn of order) {
    try {
      const raw = await fn(opts);
      return opts.json ? parseJson(raw) : raw;
    } catch (err) {
      lastErr = err;
      // Config errors on the primary are worth failing past; auth errors are not
      // retryable on the same key, so we simply try the next provider.
      if (!process.env.ANTHROPIC_API_KEY) break;
    }
  }
  throw lastErr;
}

export { ProviderError };
