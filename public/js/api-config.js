(function () {
  "use strict";

  const PRODUCTION_BACKEND = "https://ariana-backend.onrender.com";
  const LOCAL_BACKEND = "http://localhost:3000";

  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocalEnvironment =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local");

  let manualOverride = "";
  try {
    manualOverride = String(
      localStorage.getItem("ARIANA_API_BACKEND_OVERRIDE") || ""
    ).trim();
  } catch (_) {}

  const API_BACKEND = String(
    window.__ARIANA_API_BACKEND__ ||
    manualOverride ||
    (isLocalEnvironment ? LOCAL_BACKEND : PRODUCTION_BACKEND)
  ).replace(/\/+$/, "");

  window.API_ORIGIN = API_BACKEND;
  window.API_BASE = API_BACKEND + "/api";

  try {
    localStorage.setItem("API_ORIGIN", window.API_ORIGIN);
    localStorage.setItem("API_BASE", window.API_BASE);
    localStorage.setItem("API_BASE_URL", window.API_BASE);
    localStorage.setItem("ARIANA_API_ENV", isLocalEnvironment ? "local" : "production");
  } catch (_) {}

  window.resolveApiImageUrl = window.resolveApiImageUrl || function (value) {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("${")) return "";
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
      return raw;
    }
    if (raw.startsWith("/")) return window.API_ORIGIN + raw;
    return window.API_ORIGIN + "/" + raw.replace(/^\.?\//, "");
  };

  function normalizeApiUrl(url) {
    let normalized = String(url || "");
    if (!normalized) return normalized;

    normalized = normalized
      .replace(/\/undefined\/payments\b/g, "/settings/payments")
      .replace("https://ariana-move-mongo.onrender.com/api", window.API_BASE)
      .replace("https://southamerica-east1-ariana-moveis-final.cloudfunctions.net/api", window.API_BASE)
      .replace("https://ariana-backend.onrender.com/api", window.API_BASE)
      .replace("http://localhost:3000/api", window.API_BASE)
      .replace("http://127.0.0.1:3000/api", window.API_BASE);

    if (/^\/api(?:\/|$)/i.test(normalized)) {
      normalized = window.API_ORIGIN + normalized;
    } else if (/^api(?:\/|$)/i.test(normalized)) {
      normalized = window.API_ORIGIN + "/" + normalized;
    }

    return normalized;
  }

  function isAdminContextPage() {
    const pathname = String(window.location.pathname || "")
      .split("?")[0]
      .split("#")[0]
      .toLowerCase();

    const file = pathname.split("/").pop() || "";

    if (file === "admin_login.html" || file === "login_admin.html") return true;
    if (/^admin[_-].+\.html?$/.test(file)) return true;
    if (file === "admin_painel.html" || file === "admin.html") return true;
    if (/\/admin(?:\/|$)/.test(pathname)) return true;

    return false;
  }

  function clearAdminAuthentication() {
    const tokenKeys = [
      "adminToken",
      "admin_token",
      "token",
      "authToken",
      "adminRefreshToken",
      "admin_refresh_token",
      "refreshToken"
    ];

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        tokenKeys.forEach(function (key) {
          storage.removeItem(key);
        });
      } catch (_) {}
    }
  }

  function adminLoginPage() {
    const currentPath = String(window.location.pathname || "");
    const directory = currentPath.slice(0, currentPath.lastIndexOf("/") + 1);
    return directory + "admin_login.html";
  }

  function handleAdminSessionEnded(message, code) {
    if (!isAdminContextPage()) {
      console.warn(
        "[Ariana API] Resposta de autenticação administrativa ignorada fora do contexto Admin:",
        code || "admin_session_error"
      );
      return;
    }

    if (window.__ARIANA_ADMIN_SESSION_ENDING__) return;
    window.__ARIANA_ADMIN_SESSION_ENDING__ = true;

    clearAdminAuthentication();

    const overlay = document.createElement("div");
    overlay.id = "ariana-session-expired-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:20px",
      "background:rgba(2,20,48,.72)",
      "backdrop-filter:blur(4px)"
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
      "width:min(440px,100%)",
      "background:#fff",
      "border-radius:22px",
      "padding:28px",
      "box-shadow:0 28px 70px rgba(0,0,0,.3)",
      "text-align:center",
      "font-family:Inter,Arial,sans-serif"
    ].join(";");

    card.innerHTML =
      '<div style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff3cd;color:#9a6700;font-size:30px">⌛</div>' +
      '<h2 style="margin:0;color:#062b63;font-size:24px;font-weight:900">Sessão encerrada</h2>' +
      '<p style="margin:12px 0 20px;color:#4b5563;font-size:16px;line-height:1.55">' +
      String(message || "Faça login novamente.") +
      '</p>' +
      '<button id="ariana-session-login-button" type="button" style="width:100%;border:0;border-radius:13px;padding:13px 18px;background:#0047ab;color:#fff;font-size:15px;font-weight:900;cursor:pointer">Ir para o login</button>' +
      '<div style="margin-top:12px;color:#9ca3af;font-size:12px">Você será redirecionado automaticamente.</div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const redirect = function () {
      const loginUrl = new URL(adminLoginPage(), window.location.href);
      loginUrl.searchParams.set(
        "reason",
        code === "admin_token_expired" ? "expired" : "session-ended"
      );
      window.location.replace(loginUrl.toString());
    };

    const button = document.getElementById("ariana-session-login-button");
    if (button) button.addEventListener("click", redirect);
    window.setTimeout(redirect, 2200);
  }

  window.ArianaAdminSession = {
    clear: clearAdminAuthentication,
    end: handleAdminSessionEnded
  };

  const ADMIN_REFRESH_ENDPOINT = window.API_BASE + "/admin/token/refresh";
  const ADMIN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  const ADMIN_ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
  const ADMIN_REFRESH_CHECK_MS = 60 * 1000;

  let lastAdminActivityAt = Date.now();
  let adminRefreshPromise = null;
  let adminRefreshTimer = null;

  function readAdminToken() {
    const keys = ["adminToken", "admin_token", "authToken", "token"];

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (const key of keys) {
          const value = String(storage.getItem(key) || "").trim();
          if (value) return value;
        }
      } catch (_) {}
    }

    return "";
  }

  function saveRenewedAdminToken(token) {
    const value = String(token || "").trim();
    if (!value) return;

    const keys = ["adminToken", "admin_token", "authToken", "token"];
    let updatedExistingKey = false;

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (const key of keys) {
          if (storage.getItem(key)) {
            storage.setItem(key, value);
            updatedExistingKey = true;
          }
        }
      } catch (_) {}
    }

    if (!updatedExistingKey) {
      try {
        window.localStorage.setItem("adminToken", value);
        window.localStorage.setItem("admin_token", value);
      } catch (_) {}
    }
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return null;

      const normalized = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");

      return JSON.parse(
        decodeURIComponent(
          Array.prototype.map
            .call(atob(normalized), function (character) {
              return "%" + ("00" + character.charCodeAt(0).toString(16)).slice(-2);
            })
            .join("")
        )
      );
    } catch (_) {
      return null;
    }
  }

  function isAdminLoginPage() {
    return /admin_login\.html?$/i.test(
      String(window.location.pathname || "").split("?")[0]
    );
  }

  function markAdminActivity() {
    lastAdminActivityAt = Date.now();
  }

  async function renewAdminToken(options) {
    const settings = options || {};
    if (adminRefreshPromise) return adminRefreshPromise;
    if (!isAdminContextPage()) return null;

    const token = readAdminToken();
    if (!token || isAdminLoginPage()) return null;

    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) return null;

    const remainingMs = Number(payload.exp) * 1000 - Date.now();
    const userIsActive =
      Date.now() - lastAdminActivityAt <= ADMIN_ACTIVITY_WINDOW_MS;

    if (
      !settings.force &&
      (!userIsActive || remainingMs > ADMIN_REFRESH_THRESHOLD_MS)
    ) {
      return null;
    }

    if (remainingMs <= 0) {
      handleAdminSessionEnded(
        "Sua sessão expirou. Faça login novamente.",
        "admin_token_expired"
      );
      return null;
    }

    adminRefreshPromise = fetch(ADMIN_REFRESH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: settings.reason || "automatic_activity"
      })
    })
      .then(async function (response) {
        let data = {};
        try {
          data = await response.json();
        } catch (_) {}

        if (!response.ok || !data.token) {
          const error = new Error(
            data.error || "Não foi possível renovar a sessão."
          );
          error.code = data.code || "admin_refresh_failed";
          throw error;
        }

        saveRenewedAdminToken(data.token);

        try {
          window.localStorage.setItem(
            "ARIANA_ADMIN_TOKEN_RENEWED_AT",
            new Date().toISOString()
          );
          if (data.expiresAt) {
            window.localStorage.setItem(
              "ARIANA_ADMIN_TOKEN_EXPIRES_AT",
              String(data.expiresAt)
            );
          }
        } catch (_) {}

        window.dispatchEvent(
          new CustomEvent("ariana:admin-token-renewed", {
            detail: {
              expiresAt: data.expiresAt || "",
              sessionId: data.sessionId || ""
            }
          })
        );

        return data;
      })
      .catch(function (error) {
        const code = String(error?.code || "");
        if (
          [
            "admin_token_expired",
            "admin_session_invalid",
            "admin_token_version_invalid",
            "admin_token_invalid",
            "admin_user_not_found",
            "admin_user_inactive"
          ].includes(code)
        ) {
          handleAdminSessionEnded(
            code === "admin_token_expired"
              ? "Sua sessão expirou. Faça login novamente."
              : "Sua sessão foi encerrada. Faça login novamente.",
            code
          );
        }
        throw error;
      })
      .finally(function () {
        adminRefreshPromise = null;
      });

    return adminRefreshPromise;
  }

  function startAdminAutomaticRefresh() {
    if (!isAdminContextPage() || isAdminLoginPage() || !readAdminToken()) return;

    ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach(
      function (eventName) {
        window.addEventListener(eventName, markAdminActivity, {
          passive: true
        });
      }
    );

    if (adminRefreshTimer) window.clearInterval(adminRefreshTimer);

    adminRefreshTimer = window.setInterval(function () {
      renewAdminToken({ reason: "automatic_activity" }).catch(function () {});
    }, ADMIN_REFRESH_CHECK_MS);

    window.setTimeout(function () {
      renewAdminToken({ reason: "page_open" }).catch(function () {});
    }, 3000);

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        markAdminActivity();
        renewAdminToken({ reason: "page_visible" }).catch(function () {});
      }
    });
  }

  window.ArianaAdminToken = {
    read: readAdminToken,
    renew: function () {
      return renewAdminToken({ force: true, reason: "manual" });
    },
    decode: decodeJwtPayload
  };

  (function patchFetch() {
    const originalFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!originalFetch || window.__ARIANA_FETCH_PATCH__) return;

    window.__ARIANA_FETCH_PATCH__ = true;

    window.fetch = function (input, init) {
      const originalUrl =
        typeof input === "string"
          ? input
          : input && input.url
            ? input.url
            : "";

      const normalizedUrl = normalizeApiUrl(originalUrl);

      if (normalizedUrl && normalizedUrl !== originalUrl) {
        if (typeof input === "string") {
          input = normalizedUrl;
        } else if (input instanceof Request) {
          input = new Request(normalizedUrl, input);
        }
      }

      return originalFetch(input, init).then(async function (response) {
        try {
          const finalUrl = String(response.url || normalizedUrl || originalUrl || "");
          const isAdminApi =
            /\/api\/admin(?:\/|$)/i.test(finalUrl) ||
            /\/api\/enterprise\/admin(?:\/|$)/i.test(finalUrl);
          const isLoginRequest =
            /\/api\/admin\/login(?:\?|$)/i.test(finalUrl) ||
            /\/api\/admin\/auth\/login(?:\?|$)/i.test(finalUrl);

          if (
            response.status === 401 &&
            isAdminApi &&
            !isLoginRequest &&
            isAdminContextPage()
          ) {
            let payload = {};
            try {
              payload = await response.clone().json();
            } catch (_) {}

            const code = String(payload?.code || "").toLowerCase();
            const sessionFailureCodes = new Set([
              "admin_token_expired",
              "admin_session_invalid",
              "admin_token_version_invalid",
              "admin_token_invalid",
              "admin_token_missing"
            ]);

            if (sessionFailureCodes.has(code) || response.status === 401) {
              handleAdminSessionEnded(
                code === "admin_token_expired"
                  ? "Sua sessão expirou. Faça login novamente."
                  : "Sua sessão foi encerrada. Faça login novamente.",
                code
              );
            }
          }
        } catch (_) {}

        return response;
      });
    };
  })();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAdminAutomaticRefresh, {
      once: true
    });
  } else {
    startAdminAutomaticRefresh();
  }

  console.info(
    `[Ariana API] Ambiente: ${isLocalEnvironment ? "local" : "produção"} | ${window.API_BASE}`
  );
})();
