import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sandboxDir = mkdtempSync(join(tmpdir(), 'ariana-loja-live-'));
const sourcePath = resolve(here, '../scripts/loja-whatsapp-bot.js');
const modulePath = join(sandboxDir, 'loja-whatsapp-bot-live.mjs');

process.env.LOJA_BOT_TEST_MODE = '1';
process.env.LOJA_BOT_STATE_FILE = join(sandboxDir, 'state.json');
process.env.ARIANA_BACKEND_URL = process.env.ARIANA_BACKEND_URL || 'https://ariana-backend.onrender.com';

copyFileSync(sourcePath, modulePath);
const imported = await import(pathToFileURL(modulePath).href + '?v=' + Date.now());
const bot = imported.__test;
const smokeStartedAt = Date.now();

let failures = 0;
let warnings = 0;

function ok(label, detail = '') {
  console.log('✅ ' + label + (detail ? ' — ' + detail : ''));
}

function fail(label, detail = '') {
  failures += 1;
  console.log('❌ ' + label + (detail ? ' — ' + detail : ''));
}

function warn(label, detail = '') {
  warnings += 1;
  console.log('⚠️  ' + label + (detail ? ' — ' + detail : ''));
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

console.log('\nARIANA LOJA — SMOKE TEST DO AMBIENTE REAL\n');

try {
  const raw = execFileSync('pm2', ['jlist'], { encoding: 'utf8' });
  const jsonStart = raw.indexOf('[{');
  const jsonEnd = raw.lastIndexOf('}]');
  const json = jsonStart >= 0 && jsonEnd >= jsonStart
    ? raw.slice(jsonStart, jsonEnd + 2)
    : raw.trim();
  const apps = JSON.parse(json);
  const loja = apps.find((app) => app.name === 'loja-bot');
  if (!loja) {
    fail('PM2 loja-bot', 'processo não encontrado');
  } else if (loja.pm2_env?.status !== 'online') {
    fail('PM2 loja-bot', 'status ' + String(loja.pm2_env?.status || 'desconhecido'));
  } else {
    ok('PM2 loja-bot', 'online');
  }
} catch (error) {
  warn('PM2 loja-bot', 'não foi possível interpretar a saída do PM2');
}

try {
  const local = await getJson('http://127.0.0.1:8093/health');
  if (!local.response.ok || local.body?.ok !== true) {
    fail('Health local 8093', 'HTTP ' + local.response.status);
  } else {
    ok('Health local 8093', 'serviço ' + String(local.body.service || 'ok'));
    if (Number(local.body.manualHumanPauseMinutes) === 60) {
      ok('Pausa humana', '60 minutos');
    } else {
      fail('Pausa humana', 'esperado 60, recebido ' + String(local.body.manualHumanPauseMinutes));
    }

    if (local.body?.visionConfigured === true) {
      ok(
        'Visão de imagens',
        String(local.body.visionModel || 'modelo configurado') +
          ' / detalhe ' + String(local.body.visionDetail || 'auto')
      );
    } else {
      warn('Visão de imagens', 'chave da API de visão ainda não configurada');
    }

    if (
      local.body?.audioTranscriptionConfigured === true &&
      String(local.body?.audioTranscriptionModel || '') === 'gpt-transcribe' &&
      Number(local.body?.audioMaxMinutes) === 10
    ) {
      ok(
        'Áudio de clientes',
        'transcrição ativa com ' + String(local.body.audioTranscriptionModel) + ' / máximo 10 minutos'
      );
    } else {
      warn('Áudio de clientes', 'transcrição ainda não está ativa na produção atual');
    }

    const aiBudget = local.body?.aiBudget || local.body?.visionBudget || {};
    if (Number(aiBudget.limitBrl) === 30 && Number(aiBudget.stopAtBrl) === 29.5) {
      const used = Number(aiBudget.usedBrl || 0).toFixed(2);
      if (aiBudget.blocked === true) {
        warn('Limite mensal da IA', `bloqueado em R$ ${used} / R$ 30,00`);
      } else {
        ok(
          'Limite mensal da IA',
          `R$ ${used} usados / R$ 30,00 | áudios: ${Number(aiBudget.audioRequests || 0)}`
        );
      }
    } else {
      warn(
        'Limite mensal da IA',
        'esperado R$ 30,00 com margem preventiva em R$ 29,50'
      );
    }
  }
} catch (error) {
  fail('Health local 8093', error.message);
}

try {
  const https = await getJson('https://atendimento.arianamoveis.com.br/loja-bot/health');
  if (!https.response.ok || https.body?.ok !== true) {
    fail('Health HTTPS', 'HTTP ' + https.response.status);
  } else {
    ok('Health HTTPS', 'proxy Nginx respondendo');
  }
} catch (error) {
  fail('Health HTTPS', error.message);
}

try {
  const backend = String(process.env.ARIANA_BACKEND_URL || '').replace(/\/$/, '');
  let probe = null;
  let lastStatus = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      probe = await getJson(backend + '/api/products?limit=1');
      lastStatus = Number(probe.response.status || 0);
      if (probe.response.ok) break;
    } catch (error) {
      lastError = error;
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }

  if (!probe?.response?.ok) {
    fail(
      'Catálogo público',
      lastStatus ? 'HTTP ' + lastStatus + ' após 3 tentativas' : (lastError?.message || 'falha após 3 tentativas')
    );
  } else {
    const rows = Array.isArray(probe.body) ? probe.body : (Array.isArray(probe.body?.products) ? probe.body.products : []);
    ok('Catálogo público', rows.length ? 'respondendo com produtos' : 'respondendo sem erro');
  }
} catch (error) {
  fail('Catálogo público', error.message);
}

const liveFamilies = [
  ['tv', /rack|painel|home para tv|suporte|tv box/i],
  ['geladeira', /freezer|frigobar/i],
  ['tanquinho', null],
  ['caixa de som', null],
  ['guarda-roupa', null]
];

for (const [family, forbidden] of liveFamilies) {
  try {
    const rows = await bot.searchProducts(family, 'teste automático ' + family);
    if (!rows.length) {
      warn('Família ' + family, 'nenhum item disponível no catálogo agora');
      continue;
    }

    if (rows.some((item) => Number(item.stock || 0) <= 0)) {
      fail('Família ' + family, 'retornou produto sem estoque');
      continue;
    }

    if (forbidden) {
      const contaminated = rows.find((item) => forbidden.test(String(item.name || '')));
      if (contaminated) {
        fail('Família ' + family, 'resultado indevido: ' + contaminated.name);
        continue;
      }
    }

    ok('Família ' + family, String(rows.length) + ' produto(s) válido(s)');
  } catch (error) {
    fail('Família ' + family, error.message);
  }
}

const evoUrl = String(process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const evoKey = String(process.env.EVOLUTION_API_KEY || '').trim();
const evoInstance = String(process.env.LOJA_EVOLUTION_INSTANCE || 'ariana loja').trim();

if (!evoKey) {
  warn('Webhook Evolution', 'EVOLUTION_API_KEY não está no ambiente do teste');
} else {
  try {
    const result = await getJson(
      evoUrl + '/webhook/find/' + encodeURIComponent(evoInstance),
      { headers: { apikey: evoKey } }
    );

    if (!result.response.ok) {
      fail('Webhook Evolution', 'HTTP ' + result.response.status);
    } else {
      const raw = JSON.stringify(result.body);
      const hasUrl = /atendimento\.arianamoveis\.com\.br\/loja-bot/i.test(raw);
      const hasEvent = /MESSAGES_UPSERT/i.test(raw);
      if (hasUrl && hasEvent) {
        ok('Webhook Evolution', 'loja-bot + MESSAGES_UPSERT');
      } else {
        fail('Webhook Evolution', 'URL/evento esperado não encontrado');
      }
    }
  } catch (error) {
    fail('Webhook Evolution', error.message);
  }
}


try {
  const ps = execFileSync('docker', ['ps', '--format', '{{.ID}}\t{{.Image}}\t{{.Names}}'], { encoding: 'utf8' });
  const row = ps.split('\n').find((line) => /chatwoot/i.test(line) && !/postgres|redis/i.test(line));
  if (!row) {
    warn('Chatwoot Televendas', 'container do Chatwoot não encontrado');
  } else {
    const containerId = row.split('\t')[0];
    const ruby = [
      "i=Inbox.find_by(name: 'Ariana Loja - Televendas') || Inbox.find_by(id: 7)",
      "if i.nil?; puts 'NOT_FOUND'; exit; end",
      "wh=i.respond_to?(:working_hours_enabled) ? i.working_hours_enabled : nil",
      "gr=i.respond_to?(:greeting_enabled) ? i.greeting_enabled : nil",
      "puts([i.id, i.name, wh, gr].join('|'))"
    ].join(';');

    const result = execFileSync(
      'docker',
      ['exec', containerId, 'bundle', 'exec', 'rails', 'runner', ruby],
      {
        encoding: 'utf8',
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024
      }
    ).trim();

    if (/NOT_FOUND/.test(result)) {
      fail('Chatwoot Televendas', 'inbox não encontrado');
    } else {
      const line = result.split('\n').filter(Boolean).pop() || '';
      const parts = line.split('|');
      const workingHours = String(parts[2] || '').trim().toLowerCase();
      const greeting = String(parts[3] || '').trim().toLowerCase();

      if (workingHours === 'false' && greeting === 'false') {
        ok('Chatwoot Televendas', 'sem saudação automática e sem fora do horário');
      } else {
        fail(
          'Chatwoot Televendas',
          'working_hours_enabled=' + workingHours + ', greeting_enabled=' + greeting
        );
      }
    }
  }
} catch (error) {
  if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') {
    warn('Chatwoot Televendas', 'validação excedeu 45 segundos; configuração não foi alterada');
  } else {
    warn('Chatwoot Televendas', 'não foi possível validar automaticamente');
  }
}

if (existsSync('/root/.pm2/logs/loja-bot-error.log')) {
  try {
    const logPath = '/root/.pm2/logs/loja-bot-error.log';
    const tail = execFileSync('tail', ['-n', '30', logPath], { encoding: 'utf8' }).trim();
    const modifiedAt = statSync(logPath).mtimeMs;

    if (!tail) {
      ok('Log de erro', 'vazio');
    } else if (modifiedAt < smokeStartedAt) {
      ok('Log de erro', 'sem novos erros durante este smoke test');
    } else {
      warn('Log de erro', 'houve nova gravação durante o smoke test');
    }
  } catch {
    warn('Log de erro', 'não foi possível ler');
  }
}

console.log('\nResumo: ' + failures + ' falha(s), ' + warnings + ' aviso(s).');
console.log('Este smoke test não envia mensagens reais pelo WhatsApp.\n');

rmSync(sandboxDir, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
