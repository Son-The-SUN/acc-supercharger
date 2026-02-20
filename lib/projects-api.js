// lib/projects-api.js - Project-related APS API calls
// mirrors acc/admin.py project management functions
//
// Requires: lib/aps-constants.js (APS_BASE_URL)
//
// Exposed as the global `ProjectsAPI` namespace so it can be loaded in both
// the service worker (via importScripts) and content scripts (via manifest).

const ProjectsAPI = (() => {
  /**
   * Fetch all account projects across all statuses and platforms,
   * paginating through all results.
   * mirrors acc/admin.py getActiveProjects()
   *
   * @param {string} token     - bearer token
   * @param {string} accountId - APS account UUID
   * @returns {Promise<object[]>}
   */
  async function fetchAll(token, accountId) {
    const projects = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const url = `${APS_BASE_URL}/construction/admin/v1/accounts/${accountId}/projects?offset=${offset}&limit=${limit}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`API ${resp.status} — projects: ${body}`);
      }
      const payload = await resp.json();
      const batch = payload.results || payload;
      if (!Array.isArray(batch) || batch.length === 0) break;
      projects.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return projects;
  }

  return { fetchAll };
})();
