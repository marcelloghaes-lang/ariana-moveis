import { runOnce } from './chatwoot-db-observer.mjs';

const POLL_MS = Math.max(10000, Number(process.env.ARIANA_AI_DB_OBSERVER_POLL_MS || 15000));

async function tick() {
  try {
    const count = await runOnce();
    if (count) console.log('[ariana-ai-db-observer] observed', count, 'new messages');
  } catch (error) {
    console.error('[ariana-ai-db-observer]', error?.message || error);
  } finally {
    setTimeout(tick, POLL_MS);
  }
}

console.log('[ariana-ai-db-observer] read-only shadow observer starting');
console.log('[ariana-ai-db-observer] monitored inboxes: 5 SAC, 6 Financeiro, 7 Loja, 9 Crediario');
console.log('[ariana-ai-db-observer] customer outbound messaging: disabled');
tick();
