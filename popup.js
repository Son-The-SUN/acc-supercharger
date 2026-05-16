// popup.js - Compact popup for APS credentials and cache management

// ── Account ID list helpers ────────────────────────────────────────────

function renderAccountIdsList(accountIds) {
  const list = document.getElementById("accountIdsList");
  list.innerHTML = "";
  for (const id of accountIds) {
    addAccountIdRow(id);
  }
}

function addAccountIdRow(value = "") {
  const list = document.getElementById("accountIdsList");

  const row = document.createElement("div");
  row.className = "account-id-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "account-id-input";
  input.placeholder = "e.g. 00000000-0000-0000-0000-000000000000";
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-account-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = "Remove this account";
  removeBtn.addEventListener("click", () => {
    const rows = list.querySelectorAll(".account-id-row");
    if (rows.length > 1) {
      row.remove();
    } else {
      input.value = "";
    }
  });

  row.appendChild(input);
  row.appendChild(removeBtn);
  list.appendChild(row);
}

function getAccountIdsFromUI() {
  return [...document.querySelectorAll("#accountIdsList .account-id-input")]
    .map((inp) => inp.value.trim())
    .filter(Boolean);
}

// ── Init ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Load saved values; migrate legacy single apsAccountId → apsAccountIds array
  chrome.storage.local.get(
    ["apsClientId", "apsClientSecret", "apsAccountId", "apsAccountIds"],
    (data) => {
      if (data.apsClientId) document.getElementById("clientId").value = data.apsClientId;
      if (data.apsClientSecret) document.getElementById("clientSecret").value = data.apsClientSecret;

      let accountIds = data.apsAccountIds;
      if (!accountIds && data.apsAccountId) {
        accountIds = [data.apsAccountId]; // one-time migration
      }
      renderAccountIdsList(accountIds && accountIds.length ? accountIds : [""]);
    }
  );

  document.getElementById("addAccountId").addEventListener("click", () => addAccountIdRow());

  document.getElementById("save").addEventListener("click", () => {
    const clientId = document.getElementById("clientId").value.trim();
    const clientSecret = document.getElementById("clientSecret").value.trim();
    const accountIds = getAccountIdsFromUI();
    const statusEl = document.getElementById("status");

    if (!clientId || !clientSecret) {
      statusEl.textContent = "Client ID and Secret are required.";
      statusEl.className = "status error";
      return;
    }
    if (accountIds.length === 0) {
      statusEl.textContent = "At least one Account ID is required.";
      statusEl.className = "status error";
      return;
    }

    chrome.storage.local.set(
      { apsClientId: clientId, apsClientSecret: clientSecret, apsAccountIds: accountIds },
      () => {
        chrome.storage.local.remove("apsAccountId");
        statusEl.textContent = `Saved! (${accountIds.length} hub${accountIds.length > 1 ? "s" : ""})`;
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
