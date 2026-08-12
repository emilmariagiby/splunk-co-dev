const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ── Constants ─────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const getUserHash = (req) => {
    if (!req || !req.splunk) return 'default';
    return crypto.createHash('md5').update(`${req.splunk.url}-${req.splunk.username}`).digest('hex');
};

const getSessionFile = (req) => {
    return path.join(__dirname, `../data/session_${getUserHash(req)}.json`);
};
const GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';

// llama-3.1-8b-instant: ~10x faster than 70B (300ms vs 3s), perfect for copilot
// llama-3.3-70b-versatile: kept for the /analyze endpoint where accuracy matters
const FAST_MODEL     = 'llama-3.1-8b-instant';
const ACCURATE_MODEL = 'llama-3.3-70b-versatile';

// ── In-memory caches ──────────────────────────────────────────────────────────

// Workspace context is cached in memory after first read.
const _workspaceCache = new Map();

// Session cache: avoid file read on every /track and /suggest
const _sessionCache = new Map();

// ── Session helpers ───────────────────────────────────────────────────────────

const readSession = (req) => {
  const hash = getUserHash(req);
  if (_sessionCache.has(hash)) return _sessionCache.get(hash);
  try {
    const data = JSON.parse(fs.readFileSync(getSessionFile(req), 'utf8'));
    _sessionCache.set(hash, data);
    return data;
  } catch {
    _sessionCache.set(hash, {});
    return {};
  }
};

const writeSession = (req, data) => {
  const hash = getUserHash(req);
  _sessionCache.set(hash, data);
  // Use sync write to prevent race conditions on heavy API usage
  try {
    fs.writeFileSync(getSessionFile(req), JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
};

// ── Workspace context helper ──────────────────────────────────────────────────

function getWorkspaceContext(req) {
  const hash = getUserHash(req);
  // Use cache if available
  if (_workspaceCache.has(hash)) return _workspaceCache.get(hash);

  try {
    const { readWorkspace } = require('./workspace');
    const workspace = readWorkspace(req);

    if (!workspace || !workspace.files?.length) {
      _workspaceCache.set(hash, null);
      return null;
    }

    // Compress: take top 10 files, max 4 lines each, truncate long lines
    const snippets = workspace.files
      .slice(0, 10)
      .map(f => {
        const lines = f.logLines
          .slice(0, 4)
          .map(l => `  ${f.file}:${l.line}: ${l.code.substring(0, 120)}`)
          .join('\n');
        return lines;
      })
      .filter(Boolean)
      .join('\n');

    _workspaceCache.set(hash, {
      folderName: workspace.folderName,
      totalFiles: workspace.totalFiles,
      totalLogLines: workspace.totalLogLines,
      snippets,
    });
  } catch {
    _workspaceCache.set(hash, null);
  }

  return _workspaceCache.get(hash);
}

// Called by workspace.js when a new scan completes
function invalidateWorkspaceCache(req) {
  _workspaceCache.delete(getUserHash(req));
}

// ── Build compact context string ──────────────────────────────────────────────
// Kept short intentionally — fewer tokens = faster response

function buildContext(req, session) {
  const q = session.queries?.slice(-5) ?? [];
  const l = session.logs?.slice(-5) ?? [];
  const ws = getWorkspaceContext(req);

  const parts = [];

  if (q.length) {
    parts.push(`RECENT QUERIES:\n${q.map(x => `- ${x.fixed}`).join('\n')}`);
  }
  if (l.length) {
    parts.push(`ONBOARDED LOGS:\n${l.map(x => `- ${x.sourcetype}: ${x.description?.slice(0, 80)}`).join('\n')}`);
  }
  if (ws) {
    parts.push(`CODEBASE (${ws.folderName}, ${ws.totalFiles} files, ${ws.totalLogLines} log lines):\n${ws.snippets}`);
  }

  return parts.length ? parts.join('\n\n') : 'No context yet — session is empty.';
}

// ── SSE streaming helper ──────────────────────────────────────────────────────

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering if proxied
  res.flushHeaders();
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/copilot/session
router.get('/session', (req, res) => {
  res.json(readSession(req));
});

// POST /api/copilot/track
router.post('/track', (req, res) => {
  const { type, data } = req.body;
  const session = readSession(req);

  if (!session.queries)  session.queries  = [];
  if (!session.logs)     session.logs     = [];
  if (!session.timeline) session.timeline = [];

  if (type === 'query') {
    session.queries.push({ query: data.original, fixed: data.fixed, timestamp: new Date().toISOString() });
  } else if (type === 'log') {
    session.logs.push({ sourcetype: data.sourcetype, description: data.description, timestamp: new Date().toISOString() });
  }

  session.timeline.push({ type, summary: type === 'query' ? data.original : data.sourcetype, timestamp: new Date().toISOString() });
  session.timeline = session.timeline.slice(-20);
  session.queries  = session.queries.slice(-10);
  session.logs     = session.logs.slice(-10);

  writeSession(req, session);
  res.json({ success: true });
});

// POST /api/copilot/suggest — streaming SSE endpoint
// ── Optimizations applied:
//    1. llama-3.1-8b-instant (10x faster than 70B)
//    2. SSE streaming (first token appears in ~200ms)
//    3. In-memory workspace + session cache (zero file I/O per request)
//    4. Compressed context (fewer tokens = faster completion)
//    5. Async file write for session tracking (non-blocking)
router.post('/suggest', async (req, res) => {
  const { question } = req.body;
  const session = readSession(req);
  const context = buildContext(req, session);

  // Set up SSE so client gets tokens as they arrive
  setupSSE(res);

  const systemPrompt = `You are Splunk Co>Dev, an expert Splunk developer assistant. Be direct, specific, and concise. Always reference the developer's actual queries, logs, and code when giving advice.`;

  const userPrompt = `Developer context:
${context}

Question: "${question || 'What should I work on next?'}"

Respond in this EXACT JSON format, no markdown, no backticks:
{"summary":"1-2 sentence summary of what they're building","next_steps":["specific step 1","specific step 2","specific step 3"],"suggested_queries":[{"description":"what it does","spl":"the SPL query"},{"description":"what it does","spl":"the SPL query"}],"insights":"key pattern or optimization from their actual code/queries"}`;

  let accumulated = '';

  try {
    const groqRes = await axios.post(
      GROQ_URL,
      {
        model: FAST_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1200,
        stream: true,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 15000,
      }
    );

    let buffer = '';
    groqRes.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const token = parsed.choices?.[0]?.delta?.content ?? '';
          if (token) {
            accumulated += token;
            // Send each token to the client immediately
            sseWrite(res, 'token', { token });
          }
        } catch { /* ignore malformed chunks */ }
      }
    });

    groqRes.data.on('end', () => {
      try {
        // Clean up any markdown wrappers that sneak in
        const cleaned = accumulated.replace(/```json|```/g, '').trim();
        const result = JSON.parse(cleaned);
        // Send the final parsed object so frontend can render structured UI
        sseWrite(res, 'done', result);
      } catch {
        // If JSON parsing fails, send raw text as a fallback
        sseWrite(res, 'done', { summary: accumulated, next_steps: [], suggested_queries: [], insights: '' });
      }
      res.end();
    });

    groqRes.data.on('error', (err) => {
      console.error('[Copilot stream error]', err.message);
      sseWrite(res, 'error', { error: 'Stream interrupted' });
      res.end();
    });

  } catch (error) {
    console.error('[Copilot] Error:', error.response?.data || error.message);
    sseWrite(res, 'error', { error: 'Copilot failed to generate suggestions' });
    res.end();
  }
});

// POST /api/copilot/analyze — AI analysis of live Splunk results
// Uses 8B model with streaming for instant feedback
router.post('/analyze', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  setupSSE(res);

  let accumulated = '';

  try {
    const groqRes = await axios.post(
      GROQ_URL,
      {
        model: ACCURATE_MODEL,
        messages: [
          { role: 'system', content: 'You are a Splunk data analyst. Analyze search results concisely. Highlight anomalies, patterns, security concerns, and recommended actions.' },
          { role: 'user', content: message },
        ],
        temperature: 0.2,
        max_tokens: 500,
        stream: true,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 15000,
      }
    );

    let analyzeBuffer = '';
    groqRes.data.on('data', (chunk) => {
      analyzeBuffer += chunk.toString();
      const lines = analyzeBuffer.split('\n');
      analyzeBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const token = parsed.choices?.[0]?.delta?.content ?? '';
          if (token) {
            accumulated += token;
            sseWrite(res, 'token', { token });
          }
        } catch { }
      }
    });

    groqRes.data.on('end', () => {
      sseWrite(res, 'done', { response: accumulated });
      res.end();
    });

    groqRes.data.on('error', () => {
      sseWrite(res, 'error', { error: 'Analysis stream failed' });
      res.end();
    });

  } catch (error) {
    console.error('[Analyze] Error:', error.response?.data || error.message);
    sseWrite(res, 'error', { error: 'Failed to analyze results' });
    res.end();
  }
});

// DELETE /api/copilot/reset
router.delete('/reset', (req, res) => {
  writeSession(req, {});
  res.json({ success: true });
});

module.exports = router;
module.exports.invalidateWorkspaceCache = invalidateWorkspaceCache;
