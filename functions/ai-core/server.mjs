import http from 'http';
import fs from 'fs';
import { createHash } from 'crypto';
import { classifyCurrentMessage, extractEnvelope } from './router.mjs';

const PORT = Math.max(1, Number(process.env.ARIANA_AI_CORE_PORT || 8098));
const HOST = '127.0.0.1';
const LOG_FILE = process.env.ARIANA_AI_SHADOW_LOG || '/root/ariana-ai-core/shadow-decisions.ndjson';
const MAX_BODY = 1024 * 1024;

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data)
  });
  res.end(data);
}

function fingerprint(envelope) {
  const source = [
    envelope.channel, envelope.text, envelope.transcription,
    envelope.caption, envelope.mediaType
  ].join('|');
  return createHash('sha256').update(source).digest('hex').slice(0, 20);
}

function appendDecision(envelope, decision) {
  const row = {
    at: new Date().toISOString(),
    fingerprint: fingerprint(envelope),
    channel: decision.channel,
    route: decision.route,
    reason: decision.reason,
    currentMessageWins: true,
    outboundAllowed: false,
    mode: 'shadow'
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n');
  return row;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const path = String(req.url || '').split('?')[0];

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'ariana-ai-core',
      mode: 'shadow',
      outboundAllowed: false,
      gustavoProductionModified: false
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  try {
    const payload = await readJson(req);
    const envelope = extractEnvelope(payload);
    const decision = classifyCurrentMessage(envelope);

    if (path === '/v1/route') {
      return sendJson(res, 200, { ok: true, envelope, decision });
    }

    if (path === '/v1/shadow/webhook') {
      const audit = appendDecision(envelope, decision);
      return sendJson(res, 202, {
        ok: true,
        accepted: true,
        audit,
        responseSentToCustomer: false
      });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    const status = error?.message === 'payload_too_large' ? 413 : 400;
    return sendJson(res, status, {
      ok: false,
      error: String(error?.message || error)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log('[ariana-ai-core] shadow mode on', `${HOST}:${PORT}`);
  console.log('[ariana-ai-core] outbound messaging is disabled');
});

function close() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
