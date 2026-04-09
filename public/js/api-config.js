(function () {
  const API_BACKEND = "https://ariana-backend.onrender.com";

  window.API_ORIGIN = API_BACKEND;
  window.API_BASE = API_BACKEND + "/api";

  try {
    localStorage.setItem("API_BASE", window.API_BASE);
    localStorage.setItem("API_BASE_URL", window.API_BASE);
  } catch (_) {}

  window.resolveApiImageUrl = window.resolveApiImageUrl || function (value) {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("${")) return "";
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) return raw;
    if (raw.startsWith("/")) return window.API_ORIGIN + raw;
    return window.API_ORIGIN + "/" + raw.replace(/^\.?\//, "");
  };

  (function () {
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!origFetch || window.__ARIANA_FETCH_PATCH__) return;
    window.__ARIANA_FETCH_PATCH__ = true;

    window.fetch = function (input, init) {
      let url = typeof input === "string" ? input : (input && input.url ? input.url : "");

      if (url) {
        url = url
          .replace(/\/undefined\/payments\b/g, "/settings/payments")
          .replace("https://ariana-move-mongo.onrender.com/api", window.API_BASE)
          .replace("https://southamerica-east1-ariana-moveis-final.cloudfunctions.net/api", window.API_BASE);

        if (typeof input === "string") input = url;
        else if (input instanceof Request) input = new Request(url, input);
      }

      return origFetch(input, init);
    };
  })();
})();