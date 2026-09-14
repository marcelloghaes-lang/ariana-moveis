(() => {
  const script = document.currentScript;
  const swUrl = script?.dataset?.sw || '';
  const scope = script?.dataset?.scope || '';

  function installFiscalPermissionUi() {
    if (location.pathname !== '/admin_usuarios.html') return;
    const groups = document.getElementById('permission-groups');
    if (!groups || groups.querySelector('.perm[value="fiscal:nfe:emit"]')) return;

    const card = document.createElement('div');
    card.className = 'permission-group';
    card.innerHTML = `
      <label class="font-black flex items-center mb-2 cursor-pointer">
        <input type="checkbox" class="module-all mr-2" data-module="Fiscal / NF-e">
        <span>Fiscal / NF-e</span>
        <span class="ml-auto text-xs text-gray-400">Selecionar tudo</span>
      </label>
      <div class="space-y-2">
        <label class="block text-sm">
          <input type="checkbox" class="perm mr-2" value="fiscal:nfe:emit" data-module="Fiscal / NF-e">
          Emitir nota fiscal (NF-e)
        </label>
      </div>`;
    groups.appendChild(card);

    const master = card.querySelector('.module-all');
    const fiscal = card.querySelector('.perm');
    master?.addEventListener('change', () => {
      fiscal.checked = master.checked;
      const preset = document.getElementById('preset');
      if (preset) preset.value = 'custom';
    });
    fiscal?.addEventListener('change', () => {
      master.checked = fiscal.checked;
      const preset = document.getElementById('preset');
      if (preset) preset.value = 'custom';
    });

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      let parsed = null;
      try { parsed = new URL(rawUrl, location.href); } catch {}
      const isUserSave = parsed && /\/api\/admin\/users(?:\/[^/?]+)?$/.test(parsed.pathname) && (method === 'POST' || method === 'PUT');
      const fiscalEnabled = fiscal.checked === true;

      const response = await originalFetch(input, init);
      if (!isUserSave || !response.ok) return response;

      try {
        const data = await response.clone().json();
        const userId = String(data?.user?.id || '').trim();
        if (!userId) return response;

        const marker = parsed.pathname.indexOf('/api/admin/users');
        const prefix = marker >= 0 ? parsed.pathname.slice(0, marker) : '';
        const permissionUrl = new URL(parsed.toString());
        permissionUrl.pathname = `${prefix}/api/admin/users/${encodeURIComponent(userId)}/fiscal-permission`;
        permissionUrl.search = '';

        const headers = new Headers(init?.headers || {});
        headers.set('Content-Type', 'application/json');
        const permissionResponse = await originalFetch(permissionUrl.toString(), {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ enabled: fiscalEnabled }),
          credentials: init?.credentials,
          mode: init?.mode,
          cache: 'no-store'
        });

        if (!permissionResponse.ok) {
          const err = await permissionResponse.json().catch(() => ({}));
          return new Response(JSON.stringify({
            ok: false,
            error: err.error || 'O usuário foi salvo, mas a permissão de NF-e não pôde ser atualizada. Tente salvar novamente.'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      } catch (error) {
        console.error('[Ariana usuários] Falha ao sincronizar permissão fiscal:', error);
      }
      return response;
    };
  }

  installFiscalPermissionUi();

  if (!swUrl || !scope || !('serviceWorker' in navigator)) return;

  async function removeLegacySharedWorkers() {
    const registrations = await navigator.serviceWorker.getRegistrations();

    await Promise.all(registrations.map(async (registration) => {
      const scopePath = new URL(registration.scope).pathname;
      const workerUrl =
        registration.active?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        '';
      const workerName = workerUrl ? new URL(workerUrl).pathname.split('/').pop() : '';

      const isLegacySharedWorker =
        scopePath === '/' &&
        ['service-worker.js', 'sw.js'].includes(workerName);

      if (isLegacySharedWorker) {
        await registration.unregister();
      }
    }));
  }

  window.addEventListener('load', async () => {
    try {
      await removeLegacySharedWorkers();
      await navigator.serviceWorker.register(swUrl, { scope });
      console.info('[Ariana PWA] Aplicativo isolado registrado:', { swUrl, scope });
    } catch (error) {
      console.error('[Ariana PWA] Falha ao registrar aplicativo isolado:', error);
    }
  });
})();
