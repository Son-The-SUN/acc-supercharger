// api.js - Content script: authenticated API calls and cache message bridge.
//
// lib/aps-constants.js, lib/users-api.js, lib/companies-api.js, and
// lib/projects-api.js are loaded before this file via manifest.json,
// so APS_BASE_URL, MSG, UsersAPI, CompaniesAPI, and ProjectsAPI are available
// as globals.

// ── Credentials bridge ─────────────────────────────────────────────────

/**
 * Get a valid 2-legged token and account ID from the background service worker.
 */
async function getAccCredentials() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: MSG.GET_TOKEN }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve({ token: response.token, accountId: response.accountId });
      }
    });
  });
}

// ── Account-level fetchers ─────────────────────────────────────────────
// Each function gets credentials then delegates to the appropriate lib module.

/**
 * Fetch all account users. Delegates to lib/users-api.js UsersAPI.fetchAll().
 */
async function fetchAllUsers() {
  const { token, accountId } = await getAccCredentials();
  return UsersAPI.fetchAll(token, accountId);
}

/**
 * Fetch all account projects. Delegates to lib/projects-api.js ProjectsAPI.fetchAll().
 */
async function fetchAllProjects() {
  const { token, accountId } = await getAccCredentials();
  const projects = await ProjectsAPI.fetchAll(token, accountId);
  console.log(
    `ACC Enhancer: fetched ${projects.length} projects`,
    `(platforms: ${[...new Set(projects.map((p) => p.platform))].join(", ")})`
  );
  return projects;
}

/**
 * Fetch all account companies. Delegates to lib/companies-api.js CompaniesAPI.fetchAll().
 */
async function fetchAllCompanies() {
  const { token, accountId } = await getAccCredentials();
  const companies = await CompaniesAPI.fetchAll(token, accountId);
  console.log(`ACC Enhancer: fetched ${companies.length} companies`);
  return companies;
}

/**
 * Search companies by name. Delegates to lib/companies-api.js CompaniesAPI.searchByName().
 */
async function searchCompanyByName(companyName) {
  const { token, accountId } = await getAccCredentials();
  return CompaniesAPI.searchByName(token, accountId, companyName);
}

// ── Project-level fetchers ─────────────────────────────────────────────

/**
 * Fetch all members for a specific project.
 * Delegates to lib/users-api.js UsersAPI.fetchProjectUsers().
 */
async function fetchProjectMembers(projectId) {
  const { token } = await getAccCredentials();
  const members = await UsersAPI.fetchProjectUsers(token, projectId);
  console.log(`ACC Enhancer: fetched ${members.length} members for project ${projectId}`);
  return members;
}

/**
 * Get companies assigned to a specific project.
 *
 * Tries the HQ v1 endpoint first via CompaniesAPI (works for BIM 360 projects).
 * Falls back to extracting unique company IDs from project members when the
 * primary endpoint returns nothing — this covers ACC-platform projects.
 */
async function fetchProjectCompanies(projectId) {
  const { token, accountId } = await getAccCredentials();

  // Primary: HQ v1 endpoint (lib/companies-api.js)
  const allCompanies = await CompaniesAPI.fetchProjectCompanies(token, accountId, projectId);
  console.log(`ACC Enhancer: total project companies = ${allCompanies.length}`);
  if (allCompanies.length > 0) return allCompanies;

  // Fallback: derive companies from project member company IDs (ACC platform)
  const membersUrl = `${APS_BASE_URL}/construction/admin/v1/projects/${projectId}/users?limit=200`;
  try {
    const resp = await fetch(membersUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const payload = await resp.json();
      const members = payload.results || payload;
      if (Array.isArray(members)) {
        const companyIds = new Set();
        for (const m of members) {
          if (m.companyId) companyIds.add(m.companyId);
        }
        return [...companyIds].map((id) => ({ id }));
      }
    }
  } catch {
    // Both approaches failed
  }

  console.warn(`ACC Enhancer: could not get companies for project ${projectId}`);
  return [];
}

// ── Cache helpers ──────────────────────────────────────────────────────

/**
 * Get the pre-built companies cache from background.js.
 * Returns { cache, timestamp, stale } or throws on error.
 */
async function getCompaniesCache() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: MSG.GET_CACHE }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Get the pre-built projects cache from background.js.
 * Returns { cache, timestamp, stale } or throws on error.
 */
async function getProjectsCache() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: MSG.GET_PROJECTS_CACHE }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Trigger a cache build in the background.
 * Returns { success, count } or throws on error.
 */
async function triggerCacheBuild() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: MSG.BUILD_CACHE }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}
