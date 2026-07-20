/**
 * ai-grouping.js — Cloud AI semantic grouping (DOM-free)
 *
 * Sends the open tab list to a user-configured OpenAI-compatible
 * chat-completions endpoint and parses back groups, duplicates, and close suggestions.
 * Dual-loaded: the dashboard (Smart-group button) and the service worker (aiAuto alarm)
 * both import this module; runAiTick is the shared entry point.
 *
 * Privacy: titles + URLs leave the machine ONLY when the user presses
 * "Smart group" with a configured API key. With no key, nothing here
 * ever runs.
 */

const AI_GROUP_MAX_TABS = 200; // token guard; overflow falls to domain cards

const GROUPER_SYSTEM_PROMPT = `You organize browser tabs. Respond with JSON only, no prose:
{"groups":[{"label":"...","ids":[1,2]}],"dupes":[[3,4]],"close":[{"id":5,"reason":"..."}]}

groups — cluster tabs whose entry lacks "grouped":true into task/topic groups:
- Every group has at least 2 ids. An id appears in at most one group.
- Omit tabs that fit nowhere. Never include ids flagged "grouped":true.
- Label: 2-5 words in the dominant language of the group's tab titles.
{EXISTING_LABELS}
dupes — clusters of at least 2 ids showing the same content at different URLs
(mirrors, reposts, a search page vs its result page):
- First id in each cluster = the copy to keep. An id appears in at most one cluster.

close — tabs worth closing (finished reading, expired events, outdated searches,
superseded pages):
- Never suggest ids flagged "keep":true.
- Use "age" (days since last view) as a signal, not a rule.
- "reason": at most 8 words, user-facing, in the tab title's language.
- At most 20 suggestions; empty array when nothing is clearly closable.`;

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
 * classifyUrlType(url, title)
 *
 * Classifies a URL into one of 7 page types based on path structure,
 * query parameters, and hostname patterns. Used to assign importance
 * and guide grouping heuristics.
 *
 * Returns: 'root' | 'list' | 'detail' | 'doc' | 'code' | 'search' | 'social'
 */
function classifyUrlType(url, title) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const query = u.search;
    const host = u.hostname;

    // Search pages
    if (query.includes('q=') || query.includes('search=') || path.includes('/search')) {
      return 'search';
    }

    // Social feeds
    if (/twitter\.com|x\.com/.test(host) && path === '/home') return 'social';
    if (/reddit\.com/.test(host) && /^\/(r\/[^/]+)?$/.test(path)) return 'social';

    // Documentation
    if (/docs?\.|developer\.|learn\.|guide\.|wiki\./.test(host)) return 'doc';
    if (/mdn|stackoverflow|stackexchange/.test(host)) return 'doc';

    // Code repositories
    if (/github\.com/.test(host) && /\/blob\/|\/tree\//.test(path)) return 'code';
    if (/gitlab\.com/.test(host) && /\/-\/blob\//.test(path)) return 'code';

    // GitHub repo root pages (user/repo)
    if (/github\.com/.test(host) && /^\/[^/]+\/[^/]+\/?$/.test(path)) return 'root';

    // Root/home pages
    const depth = path.split('/').filter(Boolean).length;
    if (depth <= 1) return 'root';

    // List pages (issues, PRs, directory listings)
    if (/\/(issues|pulls|discussions|commits|projects|tags)$/.test(path)) return 'list';
    if (/\/page\/\d+/.test(path)) return 'list';

    // Detail pages (specific issue, article, file)
    if (/\/(issues|pull)\/\d+/.test(path)) return 'detail';
    if (depth >= 3) return 'detail';

    // Default fallback
    return 'detail';
  } catch {
    return 'detail';
  }
}

/**
 * buildGrouperPayload(tabs, cachedGroups, now = Date.now())
 *   → { payload, systemPrompt }
 *
 * Builds the per-tab JSON payload and the mode-dependent system prompt.
 * Entry flags: grouped (url already in a cached group — model must not
 * re-group it), keep (pinned/audible/active — never suggest closing),
 * age (whole days since lastAccessed — staleness signal for close).
 * cachedGroups non-empty → incremental mode: existing labels are listed
 * in the prompt so the model reuses them.
 */
function buildGrouperPayload(tabs, cachedGroups, now = Date.now()) {
  const groupedUrls = new Set();
  const labels = [];
  for (const g of cachedGroups || []) {
    if (g && typeof g.label === 'string' && g.label) labels.push(g.label);
    for (const u of (g && g.urls) || []) groupedUrls.add(u);
  }
  const payload = tabs.map(t => {
    const entry = {
      id: t.id,
      title: (t.title || '').slice(0, 80),
      url: trimUrlForPrompt(t.url),
    };
    if (groupedUrls.has(t.url)) entry.grouped = true;
    if (t.pinned || t.audible || t.active) entry.keep = true;
    if (t.lastAccessed) entry.age = Math.max(0, Math.round((now - t.lastAccessed) / 86400000));
    return entry;
  });
  const systemPrompt = GROUPER_SYSTEM_PROMPT.replace('{EXISTING_LABELS}',
    labels.length > 0
      ? `- Reuse an existing label when a tab fits it: ${labels.map(l => JSON.stringify(l)).join(', ')}. Create new labels sparingly.\n`
      : '');
  return { payload, systemPrompt };
}

/**
 * callCloudGrouper(tabs, settings, cachedGroups = [])
 *   → Promise<{ groups: [{label, urls}], dupes: [[urls]], close: [{url, reason}] }>
 *
 * One model call, three products: (incremental) groups, semantic dupes,
 * close suggestions — all URL-keyed. cachedGroups non-empty runs
 * incremental mode (only ungrouped tabs get (re)assigned, existing
 * labels reusable). Throws on HTTP error, empty response, or
 * unparseable content — the caller decides how to report it.
 */
async function callCloudGrouper(tabs, settings, cachedGroups = []) {
  // Cap the payload; when over the cap keep the most recently used tabs
  const sorted = [...tabs]
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .slice(0, AI_GROUP_MAX_TABS);

  const api = resolveApiEndpoints(settings.endpoint);
  if (!api) throw new Error('Set an endpoint in ⚙ Settings first');
  const { payload, systemPrompt } = buildGrouperPayload(sorted, cachedGroups);
  const body = JSON.stringify(payload);

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
          system: systemPrompt,
          messages: [{ role: 'user', content: body }],
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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: body },
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
  const content = extractResponseText(api.format, data);
  if (!content) {
    const reason = api.format === 'anthropic'
      ? data.stop_reason
      : data.choices && data.choices[0] && data.choices[0].finish_reason;
    throw new Error(`Empty API response${reason ? ` (stop: ${reason})` : ''}`);
  }
  return applyKeepRules(parseGrouperResponse(content, sorted), sorted);
}

/**
 * extractResponseText(format, data) → string
 *
 * Pulls the model's text out of a chat response in either wire format.
 * Anthropic `content` is a block array that may lead with non-text blocks
 * (thinking models emit {type:'thinking'} first) — collect every text
 * block, don't assume content[0]. A plain-string `content` (some proxies)
 * is used as-is. OpenAI reads choices[0].message.content.
 */
function extractResponseText(format, data) {
  if (format === 'anthropic') {
    if (data && typeof data.content === 'string') return data.content;
    const blocks = data && Array.isArray(data.content) ? data.content : [];
    return blocks
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n');
  }
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  return (msg && msg.content) || '';
}

/**
 * parseGrouperResponse(content, tabs)
 *   → { groups: [{label, urls}], dupes: [[urls]], close: [{url, reason}] }
 *
 * Defensive by contract. groups: drops bad shapes, unknown/duplicate ids
 * (first group wins), groups below 2 urls. dupes: clusters below 2 urls
 * dropped, an id belongs to at most one cluster (clusters are URL arrays;
 * first url = the copy to keep). close: unknown ids dropped, reason
 * trimmed to 120 chars, hard cap 50 entries. Throws when no JSON object
 * can be extracted at all.
 */
function parseGrouperResponse(content, tabs) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const match = text.match(/\{[\s\S]*\}/); // tolerate ```json fences
  if (!match) throw new Error('No JSON in model response');
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { throw new Error('Invalid JSON in model response'); }

  const urlById = new Map(tabs.map(t => [t.id, t.url]));
  const coerceId = raw => typeof raw === 'string' ? parseInt(raw, 10) : raw;

  const claimed = new Set();
  const groups = [];
  const rawGroups = parsed && Array.isArray(parsed.groups) ? parsed.groups : [];
  for (const g of rawGroups) {
    if (!g || typeof g.label !== 'string' || !Array.isArray(g.ids)) continue;
    const urls = [];
    for (const rawId of g.ids) {
      const id = coerceId(rawId);
      if (!urlById.has(id) || claimed.has(id)) continue;
      claimed.add(id);
      urls.push(urlById.get(id));
    }
    if (urls.length >= 2) {
      groups.push({ label: g.label.trim().slice(0, 60) || 'Task', urls });
    }
  }

  const dupeClaimed = new Set();
  const dupes = [];
  const rawDupes = parsed && Array.isArray(parsed.dupes) ? parsed.dupes : [];
  for (const cluster of rawDupes) {
    if (!Array.isArray(cluster)) continue;
    const urls = [];
    for (const rawId of cluster) {
      const id = coerceId(rawId);
      if (!urlById.has(id) || dupeClaimed.has(id)) continue;
      dupeClaimed.add(id);
      urls.push(urlById.get(id));
    }
    if (urls.length >= 2) dupes.push(urls);
  }

  const closeClaimed = new Set();
  const close = [];
  const rawClose = parsed && Array.isArray(parsed.close) ? parsed.close : [];
  for (const c of rawClose) {
    if (close.length >= 50) break;
    if (!c) continue;
    const id = coerceId(c.id);
    if (!urlById.has(id) || closeClaimed.has(id)) continue;
    closeClaimed.add(id);
    close.push({ url: urlById.get(id), reason: String(c.reason || '').trim().slice(0, 120) });
  }

  return { groups, dupes, close };
}

/**
 * applyKeepRules(result, tabs) → same shape as parseGrouperResponse
 *
 * The model is TOLD not to close pinned/audible/active tabs — this is
 * the belt-and-suspenders enforcement: filter them out of close, and
 * when a dupe cluster contains a keep-tab, move its url to the front
 * (the kept copy) so the safe one survives.
 */
function applyKeepRules(result, tabs) {
  const keepUrls = new Set(
    tabs.filter(t => t.pinned || t.audible || t.active).map(t => t.url));
  const close = result.close.filter(c => !keepUrls.has(c.url));
  const dupes = result.dupes.map(cluster => {
    const idx = cluster.findIndex(u => keepUrls.has(u));
    if (idx <= 0) return cluster;
    const reordered = [...cluster];
    const [u] = reordered.splice(idx, 1);
    reordered.unshift(u);
    return reordered;
  });
  return { groups: result.groups, dupes, close };
}

/**
 * mergeGroupsIntoCache(cachedGroups, freshGroups) → groups array
 *
 * Incremental merge: fresh groups claiming a url steal it from any
 * cached group; a fresh group whose label matches a cached one unions
 * urls (cached order first); new labels append. Groups below 2 urls
 * after the merge are dropped (they dissolve back to domain rows).
 */
function mergeGroupsIntoCache(cachedGroups, freshGroups) {
  const merged = (cachedGroups || []).map(g => ({ label: g.label, urls: [...(g.urls || [])] }));
  const freshClaims = new Set();
  for (const g of freshGroups || []) for (const u of g.urls || []) freshClaims.add(u);
  for (const g of merged) g.urls = g.urls.filter(u => !freshClaims.has(u));
  for (const fresh of freshGroups || []) {
    const hit = merged.find(g => g.label === fresh.label);
    if (hit) {
      for (const u of fresh.urls || []) if (!hit.urls.includes(u)) hit.urls.push(u);
    } else {
      merged.push({ label: fresh.label, urls: [...(fresh.urls || [])] });
    }
  }
  return merged.filter(g => g.urls.length >= 2);
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
    const ep = { format: 'anthropic', chatUrl: `${base}/messages`, modelsUrl: `${base}/models` };
    // DeepSeek's /anthropic proxy speaks messages for chat, but its model
    // listing lives on the OpenAI-compatible root with Bearer auth — with
    // a valid key the proxied /models route 404s (auth middleware masks it
    // as 401 for bad keys).
    if (/^https:\/\/api\.deepseek\.com\/anthropic/.test(url)) {
      ep.modelsUrl = 'https://api.deepseek.com/v1/models';
      ep.modelsAuth = 'bearer';
    }
    return ep;
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
  const headers = api.modelsAuth === 'bearer' || api.format !== 'anthropic'
    ? { 'Authorization': `Bearer ${settings.apiKey}` }
    : { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' };
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

/**
 * probeChatEndpoint(settings)
 *   → resolves on success, throws a readable Error otherwise
 *
 * Fallback connectivity check for endpoints with no /models listing
 * (e.g. api.deepseek.com/anthropic 404s there): sends a 1-token chat
 * request with the configured model. Distinguishes the three failure
 * modes the user can act on: bad key (401/403), bad URL (404), and
 * everything else (provider's own message).
 */
async function probeChatEndpoint(settings) {
  const api = resolveApiEndpoints(settings.endpoint);
  if (!api) throw new Error('Set an endpoint first');
  const headers = api.format === 'anthropic'
    ? {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    : {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      };
  const res = await fetch(api.chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw new Error('API key rejected (401/403)');
  if (res.status === 404) throw new Error('Endpoint not found (404) — check the URL');
  throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 120)}`);
}

/**
 * runAiTick(settings, { force } = {})
 *   → Promise<{ groups, dupes, close } | null>
 *
 * The whole AI tick, shared by the dashboard Smart-group button
 * (force: true) and the background aiAuto alarm. Queries tabs itself,
 * skips quietly (null) when the sorted-URL signature is unchanged since
 * the last tick — idle browsers don't burn tokens. Throws on missing
 * apiKey or API failure; the background caller catches and warns.
 *
 * Storage written per successful tick:
 *   aiGroupCache       { groups, dupes, ts }   — merged incremental groups
 *   aiSweepSuggestions { items, ts }           — close suggestions (replaced)
 *   lastAiSig          string                  — change detection
 *   lastAiTick         { at, groups, dupes, close } — dashboard toast
 */
async function runAiTick(settings, { force = false } = {}) {
  if (!settings || !settings.apiKey) throw new Error('Set an API key in ⚙ Settings first');

  const all = await chrome.tabs.query({});
  const tabs = all.filter(t => /^https?:/.test(t.url || '') || (t.url || '').startsWith('file://'));

  const sig = tabs.map(t => t.url).sort().join('\n');
  if (!force) {
    const { lastAiSig } = await chrome.storage.local.get('lastAiSig');
    if (lastAiSig === sig) return null;
  }

  const { aiGroupCache } = await chrome.storage.local.get('aiGroupCache');
  const cachedGroups = aiGroupCache && Array.isArray(aiGroupCache.groups) ? aiGroupCache.groups : [];
  const result = await callCloudGrouper(tabs, settings, cachedGroups);
  const merged = mergeGroupsIntoCache(cachedGroups, result.groups);
  const dupeExtras = result.dupes.reduce((n, c) => n + c.length - 1, 0);
  const now = Date.now();

  await chrome.storage.local.set({
    aiGroupCache: { groups: merged, dupes: result.dupes, ts: now },
    aiSweepSuggestions: { items: result.close, ts: now },
    lastAiSig: sig,
    lastAiTick: { at: new Date(now).toISOString(), groups: merged.length, dupes: dupeExtras, close: result.close.length },
  });
  return { groups: merged, dupes: result.dupes, close: result.close };
}
