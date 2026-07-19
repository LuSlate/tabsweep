/**
 * ai-grouping.js — Cloud AI semantic grouping (DOM-free)
 *
 * Sends the open tab list to a user-configured OpenAI-compatible
 * chat-completions endpoint and parses back task/topic clusters.
 * Loaded by the dashboard only (<script> in index.html) — the
 * background auto-grouping stays domain-based and never calls this.
 *
 * Privacy: titles + URLs leave the machine ONLY when the user presses
 * "Smart group" with a configured API key. With no key, nothing here
 * ever runs.
 */

const AI_GROUP_MAX_TABS = 200; // token guard; overflow falls to domain cards

const GROUPER_SYSTEM_PROMPT = `You cluster browser tabs into task or topic groups.
Rules:
- Only group tabs that clearly belong to the same task or topic.
- Every group must contain at least 2 tab ids.
- A tab id may appear in at most one group.
- Omit tabs that do not clearly belong anywhere.
- Give each group a short label (2-5 words) in the dominant language of its tab titles.
- Respond with JSON only, no prose: {"groups":[{"label":"...","ids":[1,2]}]}`;

/**
 * trimUrlForPrompt(url)
 *
 * Strips the hash and truncates a long query string (60 chars) — keeps
 * search queries visible for semantics while bounding token count.
 */
function trimUrlForPrompt(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.search.length > 61) u.search = u.search.slice(0, 61);
    return u.toString();
  } catch { return url; }
}

/**
 * callCloudGrouper(tabs, { endpoint, apiKey, model })
 *   → Promise<Array<{ label: string, urls: string[] }>>
 *
 * tabs: real web tabs [{ id, url, title, lastAccessed, ... }].
 * Supports both wire formats — OpenAI chat/completions and Anthropic
 * messages — picked by resolveApiEndpoints(settings.endpoint).
 * Throws on HTTP error, empty response, or unparseable content — the
 * caller toasts and leaves the current grouping untouched.
 */
async function callCloudGrouper(tabs, settings) {
  // Cap the payload; when over the cap keep the most recently used tabs
  const sorted = [...tabs]
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .slice(0, AI_GROUP_MAX_TABS);

  const api = resolveApiEndpoints(settings.endpoint);
  if (!api) throw new Error('Set an endpoint in ⚙ Settings first');
  const payload = JSON.stringify(sorted.map(t => ({
    id: t.id,
    title: (t.title || '').slice(0, 80),
    url: trimUrlForPrompt(t.url),
  })));

  const request = api.format === 'anthropic'
    ? {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          // Anthropic's own guard for browser-origin calls; harmless elsewhere
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model: settings.model,
          max_tokens: 4096,
          temperature: 0,
          system: GROUPER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: payload }],
        },
      }
    : {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: {
          model: settings.model,
          temperature: 0,
          messages: [
            { role: 'system', content: GROUPER_SYSTEM_PROMPT },
            { role: 'user', content: payload },
          ],
        },
      };

  const res = await fetch(api.chatUrl, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const content = api.format === 'anthropic'
    ? (data.content && data.content[0] && data.content[0].text)
    : (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
  if (!content) throw new Error('Empty API response');
  return parseGroupsResponse(content, sorted);
}

/**
 * parseGroupsResponse(content, tabs)
 *   → Array<{ label, urls }> — the cache shape (URL-keyed, restart-safe)
 *
 * Defensive by contract: drops groups with bad shape, ids that don't
 * exist in `tabs`, duplicate ids across groups (first group wins), and
 * groups that shrink below 2 urls after filtering. Throws when no JSON
 * object can be extracted at all.
 */
function parseGroupsResponse(content, tabs) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const match = text.match(/\{[\s\S]*\}/); // tolerate ```json fences
  if (!match) throw new Error('No JSON in model response');
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { throw new Error('Invalid JSON in model response'); }

  const urlById = new Map(tabs.map(t => [t.id, t.url]));
  const claimed = new Set();
  const groups = [];
  const rawGroups = parsed && Array.isArray(parsed.groups) ? parsed.groups : [];
  for (const g of rawGroups) {
    if (!g || typeof g.label !== 'string' || !Array.isArray(g.ids)) continue;
    const urls = [];
    for (const rawId of g.ids) {
      const id = typeof rawId === 'string' ? parseInt(rawId, 10) : rawId;
      if (!urlById.has(id) || claimed.has(id)) continue;
      claimed.add(id);
      urls.push(urlById.get(id));
    }
    if (urls.length >= 2) {
      groups.push({ label: g.label.trim().slice(0, 60) || 'Task', urls });
    }
  }
  return groups;
}

/**
 * resolveApiEndpoints(endpoint)
 *   → { format: 'openai'|'anthropic', chatUrl, modelsUrl } | null
 *
 * Accepts the shapes users actually paste and normalizes them — no
 * single URL shape is forced:
 *   https://api.openai.com/v1/chat/completions → openai, sibling /models
 *   https://api.anthropic.com[/v1]             → anthropic /v1/messages + /v1/models
 *   https://api.deepseek.com/anthropic[/v1]    → anthropic (proxy speaks the messages format)
 *   …/v1/messages                              → anthropic, sibling /models
 *   http://localhost:8000/v1 (any other base)  → openai, /chat/completions appended
 * Returns null for empty input.
 */
function resolveApiEndpoints(endpoint) {
  const url = (endpoint || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  if (/\/messages$/.test(url)) {
    return { format: 'anthropic', chatUrl: url, modelsUrl: url.replace(/\/messages$/, '/models') };
  }
  if (/\/chat\/completions$/.test(url)) {
    return { format: 'openai', chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/, '/models') };
  }
  const base = /\/v1$/.test(url) ? url : `${url}/v1`;
  if (/anthropic/i.test(url)) {
    return { format: 'anthropic', chatUrl: `${base}/messages`, modelsUrl: `${base}/models` };
  }
  return { format: 'openai', chatUrl: `${base}/chat/completions`, modelsUrl: `${base}/models` };
}

/**
 * listModels({ endpoint, apiKey })
 *   → Promise<string[]> sorted model ids
 *
 * GETs the endpoint's /models listing — powers the settings panel's
 * "Test connection" button: proves connectivity + key validity and
 * auto-detects which models the account can use. Works for both wire
 * formats (OpenAI Bearer auth / Anthropic x-api-key); both return a
 * `data: [{id, …}]` listing. Throws with a readable message on
 * unresolvable endpoint, HTTP error, or an empty/unexpected response.
 */
async function listModels(settings) {
  const api = resolveApiEndpoints(settings.endpoint);
  if (!api) throw new Error('Set an endpoint first');
  const headers = api.format === 'anthropic'
    ? { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' }
    : { 'Authorization': `Bearer ${settings.apiKey}` };
  const res = await fetch(api.modelsUrl, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const ids = (data && Array.isArray(data.data) ? data.data : [])
    .map(m => m && m.id)
    .filter(id => typeof id === 'string' && id)
    .sort();
  if (ids.length === 0) throw new Error('No models in /models response');
  return ids;
}
