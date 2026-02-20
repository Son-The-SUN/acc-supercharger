// popup.js - Compact popup for APS credentials and cache management

document.addEventListener("DOMContentLoaded", () => {
  // Load saved values
  chrome.storage.local.get(
    ["apsClientId", "apsClientSecret", "apsAccountId"],
    (data) => {
      if (data.apsClientId) document.getElementById("clientId").value = data.apsClientId;
      if (data.apsClientSecret) document.getElementById("clientSecret").value = data.apsClientSecret;
      if (data.apsAccountId) document.getElementById("accountId").value = data.apsAccountId;
    }
  );

  document.getElementById("save").addEventListener("click", () => {
    const clientId = document.getElementById("clientId").value.trim();
    const clientSecret = document.getElementById("clientSecret").value.trim();
    const accountId = document.getElementById("accountId").value.trim();
    const statusEl = document.getElementById("status");

    if (!clientId || !clientSecret || !accountId) {
      statusEl.textContent = "All fields are required.";
      statusEl.className = "status error";
      return;
    }

    chrome.storage.local.set(
      { apsClientId: clientId, apsClientSecret: clientSecret, apsAccountId: accountId },
      () => {
        statusEl.textContent = "Saved!";
        statusEl.className = "status";
      }
    );
  });

  // ── Cache Management ──────────────────────────────────────────────────

  const cacheInfoEl = document.getElementById("cacheInfo");
  const buildCacheBtn = document.getElementById("buildCache");
  const cacheProgressEl = document.getElementById("cacheProgress");

  loadCacheStatus();

  // Listen for progress updates from background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.CACHE_PROGRESS) {
      cacheProgressEl.textContent = msg.detail || "";
    }
  });

  buildCacheBtn.addEventListener("click", () => {
    buildCacheBtn.disabled = true;
    buildCacheBtn.textContent = "Building...";
    cacheProgressEl.textContent = "Starting...";

    chrome.runtime.sendMessage(
      { type: MSG.BUILD_CACHE },
      (response) => {
        buildCacheBtn.disabled = false;
        buildCacheBtn.textContent = "Build Cache";

        if (chrome.runtime.lastError) {
          cacheProgressEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
          return;
        }

        if (response?.error) {
          cacheProgressEl.textContent = `Error: ${response.error}`;
          return;
        }

        cacheProgressEl.textContent = `Done! ${response.count} companies cached.`;
        loadCacheStatus();
      }
    );
  });

  function loadCacheStatus() {
    chrome.storage.local.get(
      ["companiesCache", "companiesCacheTimestamp", "projectsCache"],
      (data) => {
        if (data.companiesCacheTimestamp) {
          const date = new Date(data.companiesCacheTimestamp);
          const companyCount = Array.isArray(data.companiesCache) ? data.companiesCache.length : 0;
          const projectCount = Array.isArray(data.projectsCache) ? data.projectsCache.length : 0;
          const age = Date.now() - data.companiesCacheTimestamp;
          const hoursAgo = Math.round(age / (1000 * 60 * 60) * 10) / 10;
          const stale = age > 24 * 60 * 60 * 1000;
          cacheInfoEl.textContent = `${companyCount} companies, ${projectCount} projects | ${date.toLocaleDateString()} ${date.toLocaleTimeString()} (${hoursAgo}h ago)${stale ? " — stale" : ""}`;
        } else {
          cacheInfoEl.textContent = "No cache built yet.";
        }
      }
    );
  }
});
