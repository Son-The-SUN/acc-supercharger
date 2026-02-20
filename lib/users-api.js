// lib/users-api.js - User-related APS API calls
// mirrors acc/admin.py user management functions
//
// Requires: lib/aps-constants.js (APS_BASE_URL)
//
// Exposed as the global `UsersAPI` namespace so it can be loaded in both
// the service worker (via importScripts) and content scripts (via manifest).

const UsersAPI = (() => {
  /**
   * Format a display name from any APS user object shape.
   * mirrors acc/companies_project_users.py _display_user_name()
   */
  function displayUserName(user) {
    const name = (user.name || "").trim();
    if (name) return name;
    const first = (user.first_name || user.firstName || "").trim();
    const last  = (user.last_name  || user.lastName  || "").trim();
    return `${first} ${last}`.trim();
  }

  /**
   * Fetch all account-level users, paginating through all results.
   * mirrors acc/admin.py getAllAccountUsers()
   *
   * @param {string} token     - bearer token
   * @param {string} accountId - APS account UUID
   * @returns {Promise<object[]>}
   */
  async function fetchAll(token, accountId) {
    const users = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const url = `${APS_BASE_URL}/hq/v1/accounts/${accountId}/users?limit=${limit}&offset=${offset}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`API ${resp.status} — users: ${body}`);
      }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      users.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return users;
  }

  /**
   * Fetch all members of a specific project, paginating through all results.
   * mirrors acc/admin.py getProjectMemberCount() / _get_project_users_page()
   *
   * @param {string} token     - bearer token
   * @param {string} projectId - project UUID
   * @returns {Promise<object[]>}
   */
  async function fetchProjectUsers(token, projectId) {
    const users = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const url = `${APS_BASE_URL}/construction/admin/v1/projects/${projectId}/users?offset=${offset}&limit=${limit}`;
      try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) break;
        const payload = await resp.json();
        const results = payload.results || [];
        if (!Array.isArray(results) || results.length === 0) break;
        users.push(...results);
        const total = (payload.pagination || {}).totalResults;
        offset += results.length;
        if (total != null && offset >= total) break;
        if (results.length < limit) break;
      } catch {
        break;
      }
    }

    return users;
  }

  return { displayUserName, fetchAll, fetchProjectUsers };
})();
