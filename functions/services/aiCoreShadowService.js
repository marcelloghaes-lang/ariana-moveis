import { createHmac } from 'crypto';

const DEFAULT_TIMEOUT_MS = 1800;

function clean(value = '', max = 1500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildSiteShadowPayload(input = {}) {
  const page = input.page || {};
  return {
    message: clean(input.message || input.text || '', 1500),
    page: {
      path: clean(page.path || '/', 180),
      productId: clean(page.productId || '', 120),
      query: clean(page.query || '', 180),
      title: clean(page.title || '', 180)
    },
    sessionId: clean(input.sessionId || '', 180),
    previousIntent: clean(input.previousIntent || '', 80)
  };
}

export function buildSignedSiteShadowRequest({ secret, payload, timestamp = Date.now() } = {}) {
  const rawBody = JSON.stringify(buildSiteShadowPayload(payload));
  const ts = String(timestamp);
  const digest = createHmac('sha256', String(secret || ''))
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'x-ariana-timestamp': ts,
      'x-ariana-signature': `v1=${digest}`
    }
  };
}

export async function mirrorSiteShadow(payload = {}, options = {}) {
  const url = clean(options.url || process.env.ARIANA_AI_CORE_SITE_SHADOW_URL || '', 500);
  const secret = String(options.secret || process.env.ARIANA_AI_SITE_SHARED_SECRET || '');
  if (!url || !secret) return { sent: false, reason: 'disabled' };

  const { rawBody, headers } = buildSignedSiteShadowRequest({ secret, payload });
  const timeoutMs = Math.max(300, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      console.warn('[ARIANA_AI_CORE_SHADOW] mirror_http', response.status);
      return { sent: false, reason: `http_${response.status}` };
    }
    return { sent: true, status: response.status };
  } catch (error) {
    console.warn('[ARIANA_AI_CORE_SHADOW] mirror_failed', error?.message || error);
    return { sent: false, reason: 'request_failed' };
  }
}
