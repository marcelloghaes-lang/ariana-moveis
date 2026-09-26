import http from 'http';
import fs from 'fs';
import { createHash } from 'crypto';
import { classifyCurrentMessage, extractEnvelope } from './router.mjs';
import { policyForChannel } from './channel-policy.mjs';

const PORT = Math.max(1, Number(process.env.ARIANA_AI_CORE_PORT || 8098));
const HOST = '127.0.0.1';
const LOG_FILE = process.env.ARIANA_AI_SHADOW_LOG || '/root/ariana-ai-core/shadow-decisions.ndjson';
const COMPARE_LOG = process.env.ARIANA_AI_COMPARE_LOG || '/root/ariana-ai-core/shadow-comparisons.ndjson';
const MEDIA_LOG = process.env.ARIANA_AI_MEDIA_LOG || '/root/ariana-ai-core/media-shadow-decisions.ndjson';
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


function readNdjson(path) {
  try {
    return fs.readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = String(row?.[key] || 'unknown');
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function auditSummary() {
  const decisions = readNdjson(LOG_FILE);
  const comparisons = readNdjson(COMPARE_LOG);
  const media = readNdjson(MEDIA_LOG);
  const mismatches = comparisons.filter(row => row.origin === 'gustavo' && row.mismatch === true);

  return {
    ok: true,
    mode: 'shadow',
    outboundAllowed: false,
    totals: {
      decisions: decisions.length,
      comparisons: comparisons.length,
      gustavoMismatches: mismatches.length,
      media: media.length,
      mediaInterpreted: media.filter(row => row.status === 'interpreted').length,
      mediaErrors: media.filter(row => row.status === 'error').length
    },
    routes: countBy(decisions, 'route'),
    mediaKinds: countBy(media, 'kind'),
    recentComparisons: comparisons.slice(-20).reverse().map(row => ({
      at: row.at,
      conversationId: row.conversationId,
      channel: row.channel,
      route: row.route,
      origin: row.origin,
      mismatch: row.mismatch,
      comparisonReason: row.comparisonReason,
      mediaType: row.mediaType
    })),
    recentMedia: media.slice(-20).reverse().map(row => ({
      at: row.at,
      messageId: row.messageId,
      conversationId: row.conversationId,
      channel: row.channel,
      mediaType: row.mediaType,
      status: row.status,
      kind: row.kind,
      confidence: row.confidence ?? null,
      route: row.route || null,
      categoryHint: row.categoryHint || '',
      paymentMethod: row.paymentMethod || ''
    }))
  };
}

function auditHtml() {
  return [
    '<!doctype html>',
    '<html lang="pt-BR"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Ariana AI Core — Auditoria Sombra</title>',
    '<style>',
    'body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f4f7fb;color:#162033}',
    'main{max-width:1100px;margin:0 auto;padding:24px}',
    'h1{margin:0 0 6px}.muted{color:#657086}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}',
    '.card{background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:16px}',
    '.big{font-size:28px;font-weight:700} table{width:100%;border-collapse:collapse;background:#fff}',
    'th,td{text-align:left;padding:10px;border-bottom:1px solid #e6ecf4;font-size:14px}',
    '.bad{font-weight:700}.ok{font-weight:700}.section{margin-top:24px}',
    '</style></head><body><main>',
    '<h1>Ariana AI Core</h1>',
    '<div class="muted">Auditoria em modo sombra — não envia mensagens aos clientes.</div>',
    '<div id="app">Carregando…</div>',
    '<script>',
    'const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;"}[c]));',
    'fetch("/v1/audit/summary").then(r=>r.json()).then(d=>{',
    'const t=d.totals||{};',
    'let h="<div class=\\\"grid\\\">";',
    'h+="<div class=\\\"card\\\"><div class=\\\"muted\\\">Decisões</div><div class=\\\"big\\\">"+(t.decisions||0)+"</div></div>";',
    'h+="<div class=\\\"card\\\"><div class=\\\"muted\\\">Comparações</div><div class=\\\"big\\\">"+(t.comparisons||0)+"</div></div>";',
    'h+="<div class=\\\"card\\\"><div class=\\\"muted\\\">Divergências Gustavo</div><div class=\\\"big\\\">"+(t.gustavoMismatches||0)+"</div></div>";',
    'h+="<div class=\\\"card\\\"><div class=\\\"muted\\\">Mídias interpretadas</div><div class=\\\"big\\\">"+(t.mediaInterpreted||0)+"</div></div>";',
    'h+="<div class=\\\"card\\\"><div class=\\\"muted\\\">Erros de mídia</div><div class=\\\"big\\\">"+(t.mediaErrors||0)+"</div></div></div>";',
    'h+="<div class=\\\"section\\\"><h2>Mídias recentes</h2><table><thead><tr><th>Hora</th><th>Canal</th><th>Tipo</th><th>Classificação</th><th>Confiança</th><th>Rota</th></tr></thead><tbody>";',
    'for(const x of (d.recentMedia||[])){h+="<tr><td>"+esc(x.at)+"</td><td>"+esc(x.channel)+"</td><td>"+esc(x.mediaType)+"</td><td>"+esc(x.kind)+"</td><td>"+(x.confidence==null?"—":Math.round(x.confidence*100)+"%")+"</td><td>"+esc(x.route||"—")+"</td></tr>";}',
    'h+="</tbody></table></div>";',
    'h+="<div class=\\\"section\\\"><h2>Comparações recentes</h2><table><thead><tr><th>Hora</th><th>Canal</th><th>Rota</th><th>Origem</th><th>Resultado</th></tr></thead><tbody>";',
    'for(const x of (d.recentComparisons||[])){h+="<tr><td>"+esc(x.at)+"</td><td>"+esc(x.channel)+"</td><td>"+esc(x.route)+"</td><td>"+esc(x.origin)+"</td><td class=\\\""+(x.mismatch?"bad":"ok")+"\\\">"+(x.mismatch?"Divergência":"Compatível")+"</td></tr>";}',
    'h+="</tbody></table></div>";',
    'document.getElementById("app").innerHTML=h;',
    '}).catch(e=>document.getElementById("app").textContent="Falha ao carregar auditoria: "+e.message);',
    '</script></main></body></html>'
  ].join('\n');
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

  if (req.method === 'GET' && path === '/v1/audit/summary') {
    return sendJson(res, 200, auditSummary());
  }

  if (req.method === 'GET' && path === '/audit') {
    const html = auditHtml();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html)
    });
    return res.end(html);
  }

  if (req.method === 'GET' && path.startsWith('/v1/policy/')) {
    const channel = decodeURIComponent(path.slice('/v1/policy/'.length));
    return sendJson(res, 200, { ok: true, policy: policyForChannel(channel) });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }

  try {
    const payload = await readJson(req);
    const envelope = extractEnvelope(payload);
    const decision = classifyCurrentMessage(envelope);

    if (path === '/v1/route') {
      return sendJson(res, 200, {
        ok: true,
        envelope,
        decision,
        policy: policyForChannel(envelope.channel)
      });
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
