
/* ============================================================
   ALERTAS SONOROS + NOTIFICAÇÃO DO DISPOSITIVO - ARIANA MÓVEIS
   Funciona no painel admin e no painel seller.
   ============================================================ */
(function(){
  if (window.__ARIANA_PANEL_ALERTS_V3__) return;
  window.__ARIANA_PANEL_ALERTS_V3__ = true;

  const isSellerPage = /seller_/i.test(location.pathname) || !!localStorage.getItem('seller_token');
  const isAdminPage = /admin/i.test(location.pathname) || !!localStorage.getItem('admin_token');
  const role = isSellerPage && !/admin_painel/i.test(location.pathname) ? 'seller' : 'admin';
  const API = (window.API_BASE || localStorage.getItem('API_BASE') || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
  const endpoint = role === 'seller' ? '/seller/notifications?limit=30' : '/admin/notifications?limit=30';
  const tokenKey = role === 'seller' ? 'seller_token' : 'admin_token';
  const storageKey = `ariana_${role}_alert_seen_ids_v3`;
  let booted = false;
  let audioCtx = null;

  function token(){ return localStorage.getItem(tokenKey) || ''; }
  function idOf(n){ return String(n?.id || n?._id || n?.relatedId || `${n?.title||''}-${n?.message||''}-${n?.createdAt||''}`); }
  function unread(n){ return String(n?.status || 'unread').toLowerCase() !== 'read'; }
  function seenSet(){ try { return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch(_) { return new Set(); } }
  function saveSeen(ids){ try { localStorage.setItem(storageKey, JSON.stringify(Array.from(ids).slice(0, 120))); } catch(_) {} }

  function ensureToastBox(){
    let box = document.getElementById('ariana-device-alert-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ariana-device-alert-box';
      box.style.cssText = 'position:fixed;right:18px;top:82px;z-index:999999;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 28px));pointer-events:none;';
      document.body.appendChild(box);
    }
    return box;
  }
  function screenAlert(title, message){
    const box = ensureToastBox();
    const el = document.createElement('div');
    el.style.cssText = 'pointer-events:auto;background:#0f172a;color:white;border-radius:18px;padding:15px 17px;box-shadow:0 18px 45px rgba(0,0,0,.28);font-family:Inter,Arial,sans-serif;border-left:6px solid #16a34a;';
    el.innerHTML = `<div style="font-weight:900;font-size:15px;margin-bottom:4px;">🔔 ${escapeHtml(title || 'Nova movimentação')}</div><div style="font-size:13px;line-height:1.35;color:#e5e7eb;">${escapeHtml(message || 'Há uma nova venda ou atualização de pedido.')}</div>`;
    box.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch(_){} }, 9000);
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  function unlockAudio(){
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    } catch(_) {}
  }
  function playSound(){
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtx || (Ctx ? new Ctx() : null);
      if (!ctx) return;
      audioCtx = ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
      const notes = [880, 1175, 880];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.24, t + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.17);
      });
    } catch(_) {}
  }
  async function askPermission(){
    unlockAudio();
    try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch(_) {}
    const btn = document.getElementById('ariana-enable-alerts-btn');
    if (btn && (!('Notification' in window) || Notification.permission === 'granted')) btn.remove();
  }
  function deviceNotification(n){
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const title = n?.title || 'Nova movimentação no painel';
      const body = n?.message || 'Há uma nova venda ou atualização de pedido.';
      const notify = new Notification(title, { body, icon: './favicon.png', tag: idOf(n), requireInteraction: true });
      notify.onclick = () => { window.focus(); notify.close(); if (role === 'seller') location.href = 'seller_pedidos.html'; else if (window.changeView) window.changeView('orders'); };
    } catch(_) {}
  }
  function addEnableButton(){
    if (!('Notification' in window) || Notification.permission === 'granted' || document.getElementById('ariana-enable-alerts-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ariana-enable-alerts-btn';
    btn.type = 'button';
    btn.textContent = '🔔 Ativar alertas';
    btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:999999;background:#1d4ed8;color:white;border:0;border-radius:999px;padding:12px 16px;font-weight:900;box-shadow:0 12px 30px rgba(0,0,0,.24);cursor:pointer;font-family:Inter,Arial,sans-serif;';
    btn.onclick = askPermission;
    document.body.appendChild(btn);
  }
  async function fetchRows(){
    if (!token()) return [];
    const res = await fetch(API + endpoint, { headers: { Authorization: 'Bearer ' + token() }});
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : (data.items || data.notifications || data.results || []);
  }
  async function checkAlerts(){
    try {
      const rows = (await fetchRows()).filter(unread);
      const currentIds = new Set(rows.map(idOf).filter(Boolean));
      const seen = seenSet();
      if (!booted) {
        saveSeen(currentIds);
        booted = true;
        return;
      }
      const fresh = rows.filter(n => !seen.has(idOf(n)));
      if (fresh.length) {
        const n = fresh[0];
        playSound();
        screenAlert(n.title || 'Nova venda ou movimentação', n.message || 'Existe uma nova atualização no painel.');
        deviceNotification(n);
        if (typeof window.loadNotifications === 'function') window.loadNotifications().catch?.(()=>{});
        if (typeof window.loadOrders === 'function') window.loadOrders().catch?.(()=>{});
      }
      const merged = new Set([...seen, ...currentIds]);
      saveSeen(merged);
    } catch(_) {}
  }
  document.addEventListener('click', askPermission, { once: true, passive: true });
  document.addEventListener('touchstart', askPermission, { once: true, passive: true });
  window.addEventListener('focus', checkAlerts);
  document.addEventListener('DOMContentLoaded', function(){ addEnableButton(); setTimeout(checkAlerts, 800); setInterval(checkAlerts, 10000); });
})();
