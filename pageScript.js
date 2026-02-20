// pageScript.js - Runs in the PAGE context (not extension context)
// Intercepts the auth token from ACC's own fetch calls, and handles
// API requests from the content script via postMessage.

(function () {
  const ACC_API_BASE = "https://developer.api.autodesk.com";
  let capturedToken = null;
  let capturedAccountId = null;

  // ── Intercept fetch to capture the bearer token ─────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const [input, init] = args;
    const url = typeof input === "string" ? input : input?.url || "";

    // Capture auth header from ACC's own API calls
    if (url.includes("developer.api.autodesk.com")) {
      const headers = init?.headers;
      let authValue = null;

      if (headers instanceof Headers) {
        authValue = headers.get("Authorization");
      } else if (headers && typeof headers === "object") {
        authValue =
          headers["Authorization"] || headers["authorization"];
      }

      if (authValue && authValue.startsWith("Bearer ")) {
        capturedToken = authValue.substring(7);
        console.log("ACC Enhancer: captured token from", url.substring(0, 80) + "...");
      }

      // Extract account_id from URL
      const accountMatch = url.match(/\/accounts\/([a-f0-9-]{36})\//i);
      if (accountMatch) {
        capturedAccountId = accountMatch[1];
      }
    }

    return originalFetch.apply(this, args);
  };

  // Also try to extract account ID from the page URL
  const pageAccountMatch = window.location.href.match(
    /\/accounts\/([a-f0-9-]{36})/i
  );
  if (pageAccountMatch) {
    capturedAccountId = pageAccountMatch[1];
  }

  // ── Handle API requests from content script ─────────────────────────
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "ACC_ENHANCER_REQUEST") return;

    const { requestId, action, params } = event.data;

    try {
      if (!capturedToken) {
        throw new Error(
          "No token captured yet. Navigate around ACC to trigger API calls, then try again."
        );
      }

      let result;
      switch (action) {
        case "fetchAllUsers":
          result = await _fetchAllUsers();
          break;
        case "fetchAllProjects":
          result = await _fetchAllProjects();
          break;
        case "fetchProjectCompanies":
          result = await _fetchProjectCompanies(params.projectId);
          break;
        case "searchCompany":
          result = await _searchCompany(params.companyName);
          break;
        case "getCredentials":
          result = {
            token: capturedToken ? "captured" : null,
            accountId: capturedAccountId,
          };
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      window.postMessage(
        { type: "ACC_ENHANCER_RESPONSE", requestId, result },
        "*"
      );
    } catch (err) {
      window.postMessage(
        { type: "ACC_ENHANCER_RESPONSE", requestId, error: err.message },
        "*"
      );
    }
  });

  // ── API functions (run in page context with page's auth) ────────────

  async function _authenticatedFetch(url) {
    console.log("ACC Enhancer: fetching", url);
    const resp = await originalFetch(url, {
      headers: { Authorization: `Bearer ${capturedToken}` },
    });
    if (resp.status === 401) {
      capturedToken = null;
      throw new Error(
        "Token expired. Navigate within ACC to refresh, then try again."
      );
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("ACC Enhancer: API failed", resp.status, url, body);
      throw new Error(`API failed: ${resp.status} ${resp.statusText} — ${url.split("?")[0]}`);
    }
    return resp;
  }

  async function _fetchAllUsers() {
    if (!capturedAccountId) throw new Error("No account ID available.");
    const users = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const url = `${ACC_API_BASE}/hq/v1/accounts/${capturedAccountId}/users?limit=${limit}&offset=${offset}`;
      const resp = await _authenticatedFetch(url);
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      users.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }
    return users;
  }

  async function _fetchAllProjects() {
    if (!capturedAccountId) throw new Error("No account ID available.");
    const projects = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const url = `${ACC_API_BASE}/construction/admin/v1/accounts/${capturedAccountId}/projects?offset=${offset}&limit=${limit}`;
      const resp = await _authenticatedFetch(url);
      const payload = await resp.json();
      const batch = payload.results || payload;
      if (!Array.isArray(batch) || batch.length === 0) break;
      projects.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }
    return projects;
  }

  async function _fetchProjectCompanies(projectId) {
    if (!capturedAccountId) throw new Error("No account ID available.");
    const url = `${ACC_API_BASE}/hq/v1/accounts/${capturedAccountId}/projects/${projectId}/companies`;
    const resp = await _authenticatedFetch(url);
    return resp.json();
  }

  async function _searchCompany(companyName) {
    if (!capturedAccountId) throw new Error("No account ID available.");
    const url = `${ACC_API_BASE}/hq/v1/accounts/${capturedAccountId}/companies/search?name=${encodeURIComponent(companyName)}`;
    const resp = await _authenticatedFetch(url);
    return resp.json();
  }

  console.log("ACC Companies Enhancer: page script loaded");
})();
