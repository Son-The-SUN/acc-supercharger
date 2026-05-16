// background.js - Service worker: OAuth token management, cache storage,
//                 message routing, and periodic refresh scheduling.
//
// Business logic lives in lib/. This file only handles chrome.* APIs
// (storage, alarms, runtime messages) that are unavailable to content scripts.

importScripts(
  "lib/aps-constants.js",
  "lib/users-api.js",
  "lib/companies-api.js",
  "lib/projects-api.js",
  "lib/cache-builder.js"
);

// Allow content scripts to read tokens from session storage directly.
chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
});

// ── Token Management ───────────────────────────────────────────────────
// mirrors acc/admin.py get2LeggedToken()

/**
 * Obtain a fresh 2-legged token using stored APS credentials.
 */
async function get2LeggedToken() {
  const data = await chrome.storage.local.get([
    "apsClientId",
    "apsClientSecret",
  ]);

  if (!data.apsClientId || !data.apsClientSecret) {
    throw new Error(
      "APS credentials not configured. Right-click the extension icon > Options to set them up."
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "account:read data:read",
  });

  const resp = await fetch(APS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${data.apsClientId}:${data.apsClientSecret}`),
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token request failed: ${resp.status} ${text}`);
  }

  const tokenData = await resp.json();
  const token     = tokenData.access_token;
  const expiresAt = Date.now() + tokenData.expires_in * 1000;

  // Token is account-agnostic (2-legged client credentials); account IDs are
  // read from local storage when needed, not cached in session.
  await chrome.storage.session.set({
    accBearerToken: token,
    tokenExpiresAt: expiresAt,
  });

  console.log(
    "ACC Enhancer: 2-legged token obtained, expires in",
    tokenData.expires_in,
    "seconds"
  );
  return token;
}

/**
 * Return a valid token, refreshing if missing or expiring within 5 minutes.
 */
async function ensureToken() {
  const data = await chrome.storage.session.get([
    "accBearerToken",
    "tokenExpiresAt",
  ]);

  if (
    !data.accBearerToken ||
    !data.tokenExpiresAt ||
    Date.now() > data.tokenExpiresAt - 5 * 60 * 1000
  ) {
    return get2LeggedToken();
  }

  return data.accBearerToken;
}

// ── Cache Orchestration ────────────────────────────────────────────────

let cacheBuilding = false;

function sendProgress(step, detail) {
  chrome.runtime
    .sendMessage({ type: MSG.CACHE_PROGRESS, step, detail })
    .catch(() => {}); // ignore if no listeners (popup closed, etc.)
}

/**
 * Build both caches (companies + projects) and persist them to local storage.
 * Delegates the heavy lifting to lib/cache-builder.js buildCompaniesCache().
 */
async function triggerCacheBuild() {
  if (cacheBuilding) throw new Error("Cache build already in progress.");
  cacheBuilding = true;

  try {
    const token = await ensureToken();
    const localData = await chrome.storage.local.get(["apsAccountIds"]);
    const accountIds = localData.apsAccountIds || [];
    if (accountIds.length === 0) throw new Error("No account IDs configured.");

    const allCompanies = [];
    const allProjects  = [];

    for (let i = 0; i < accountIds.length; i++) {
      const accountId = accountIds[i];
      sendProgress("account", `[${i + 1}/${accountIds.length}] Processing hub ${accountId.slice(0, 8)}...`);
      const { companiesCache, projectsCache } = await buildCompaniesCache(
        token,
        accountId,
        sendProgress
      );
      allCompanies.push(...companiesCache);
      allProjects.push(...projectsCache);
    }

    const now = Date.now();
    await chrome.storage.local.set({
      companiesCache:          allCompanies,
      companiesCacheTimestamp: now,
      projectsCache:           allProjects,
      projectsCacheTimestamp:  now,
    });

    sendProgress(
      "done",
      `Cache built: ${allCompanies.length} companies, ${allProjects.length} projects across ${accountIds.length} hub(s).`
    );
    console.log(
      `ACC Enhancer: cache built with ${allCompanies.length} companies,`,
      `${allProjects.length} projects across ${accountIds.length} hub(s)`
    );

    return allCompanies;
  } finally {
    cacheBuilding = false;
  }
}

// ── Message Handlers ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.GET_TOKEN) {
    ensureToken()
      .then(async (token) => {
        const data = await chrome.storage.local.get(["apsAccountIds"]);
        sendResponse({ token, accountIds: data.apsAccountIds || [] });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === MSG.BUILD_CACHE) {
    triggerCacheBuild()
      .then((result) => sendResponse({ success: true, count: result.length }))
      .catch((err)   => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === MSG.GET_CACHE) {
    chrome.storage.local
      .get(["companiesCache", "companiesCacheTimestamp"])
      .then((data) =>
        sendResponse({
          cache:     data.companiesCache          || null,
          timestamp: data.companiesCacheTimestamp || null,
          stale:     isCacheStale(data.companiesCacheTimestamp),
        })
      )
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === MSG.GET_PROJECTS_CACHE) {
    chrome.storage.local
      .get(["projectsCache", "projectsCacheTimestamp"])
      .then((data) =>
        sendResponse({
          cache:     data.projectsCache          || null,
          timestamp: data.projectsCacheTimestamp || null,
          stale:     isCacheStale(data.projectsCacheTimestamp),
        })
      )
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

// ── Periodic Cache Refresh ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CACHE_ALARM_NAME, {
    periodInMinutes: CACHE_REFRESH_INTERVAL_MIN,
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(CACHE_ALARM_NAME, {
    periodInMinutes: CACHE_REFRESH_INTERVAL_MIN,
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CACHE_ALARM_NAME) return;

  chrome.storage.local
    .get(["apsClientId", "apsClientSecret", "companiesCacheTimestamp"])
    .then((data) => {
      if (!data.apsClientId || !data.apsClientSecret) return;
      if (!isCacheStale(data.companiesCacheTimestamp)) return;

      console.log("ACC Enhancer: alarm triggered, rebuilding stale cache...");
      triggerCacheBuild().catch((err) =>
        console.error("ACC Enhancer: scheduled cache rebuild failed:", err)
      );
    });
});

// Pre-fetch token whenever credentials change in Options/popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.apsClientId || changes.apsClientSecret)) {
    get2LeggedToken().catch((err) =>
      console.error("ACC Enhancer: failed to get token after config change:", err)
    );
  }
});
