/* public/js/layout-fit.js
   Ajuste global anti-"sobra lateral" / anti-overflow.
   Não muda layout (só impede estouro horizontal e corrige 100vw quando necessário).
*/
(() => {
  const STYLE_ID = "global-layout-fit-style";

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* 1) Base segura (quase sempre resolve 90% dos casos) */
      *, *::before, *::after { box-sizing: border-box; }

      html, body {
        width: 100%;
        max-width: 100%;
        overflow-x: hidden; /* trava rolagem lateral */
      }

      /* 2) Mídias nunca podem estourar */
      img, video, canvas, svg {
        max-width: 100%;
        height: auto;
      }

      /* 3) Qualquer container “sem querer” maior que a viewport */
      [data-no-overflow], .no-overflow {
        max-width: 100% !important;
        overflow-x: hidden !important;
      }

      /* 4) iOS notch / barras */
      body { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
    `;
    document.head.appendChild(style);
  }

  function getViewportWidth() {
    // clientWidth costuma ser mais confiável pra detectar “estouro” real
    return document.documentElement.clientWidth || window.innerWidth;
  }

  function clampOverflowingElements() {
    const vw = getViewportWidth();
    if (!vw) return;

    // Seletores que mais causam overflow na prática
    const suspects = document.querySelectorAll([
      "body *",
    ].join(","));

    // Pequena margem pra evitar ficar “mexendo” por 1px de diferença
    const MARGIN = 2;

    for (const el of suspects) {
      // Ignora tags que não ajudam
      if (!(el instanceof HTMLElement)) continue;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") continue;

      const rect = el.getBoundingClientRect();

      // Se estourou a viewport (muito comum com width:100vw + padding/margem)
      if (rect.width > vw + MARGIN) {
        el.style.maxWidth = "100%";
        el.style.boxSizing = "border-box";
      }

      // Se “vazou” para direita/esquerda
      if (rect.left < -MARGIN || rect.right > vw + MARGIN) {
        // Tenta resolver sem quebrar layout:
        // 1) limita maxWidth, 2) remove overflow horizontal local
        el.style.maxWidth = "100%";
        el.style.overflowX = "hidden";
        el.style.boxSizing = "border-box";
      }

      // Correção típica: elementos com width: 100vw dentro de body com padding
      // (100vw inclui scrollbar e pode causar “sobra”)
      const cs = window.getComputedStyle(el);
      if (cs.width === "100vw") {
        el.style.width = "100%";
      }
    }
  }

  function run() {
    injectCSS();
    clampOverflowingElements();
  }

  // Rode cedo e também após carregar tudo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  window.addEventListener("load", run);

  // Recalcula em resize/orientation
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(run, 120);
  });
})();
