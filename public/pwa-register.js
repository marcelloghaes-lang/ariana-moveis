(() => {
  const script = document.currentScript;
  const swUrl = script?.dataset?.sw || '';
  const scope = script?.dataset?.scope || '';

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
