// lib/companies-api.js - Company-related APS API calls
// mirrors acc/company.py
//
// Requires: lib/aps-constants.js (APS_BASE_URL)
//
// Exposed as the global `CompaniesAPI` namespace so it can be loaded in both
// the service worker (via importScripts) and content scripts (via manifest).

const CompaniesAPI = (() => {
  /**
   * Fetch all account-level companies, paginating through all results.
   * mirrors acc/company.py listCompanies()
   *
   * @param {string} token     - bearer token
   * @param {string} accountId - APS account UUID
   * @returns {Promise<object[]>}
   */
  async function fetchAll(token, accountId) {
    const companies = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const url = `${APS_BASE_URL}/hq/v1/accounts/${accountId}/companies?limit=${limit}&offset=${offset}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`API ${resp.status} — companies: ${body}`);
      }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      companies.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return companies;
  }

  /**
   * Fetch all companies assigned to a specific project, paginating through all results.
   * Silently returns [] on any error (some project types don't support this endpoint).
   * mirrors acc/company.py listProjectCompanies()
   *
   * @param {string} token     - bearer token
   * @param {string} accountId - APS account UUID
   * @param {string} projectId - project UUID
   * @returns {Promise<object[]>}
   */
  async function fetchProjectCompanies(token, accountId, projectId) {
    const baseUrl = `${APS_BASE_URL}/hq/v1/accounts/${accountId}/projects/${projectId}/companies`;
    try {
      const allCompanies = [];
      let offset = 0;
      const limit = 100;

      while (true) {
        const url = `${baseUrl}?limit=${limit}&offset=${offset}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) break;
        const batch = await resp.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        allCompanies.push(...batch);
        if (batch.length < limit) break;
        offset += limit;
      }

      return allCompanies;
    } catch {
      return [];
    }
  }

  /**
   * Search companies by name.
   * mirrors acc/company.py getCompanyByName()
   *
   * @param {string} token       - bearer token
   * @param {string} accountId   - APS account UUID
   * @param {string} companyName - search term
   * @returns {Promise<object[]>}
   */
  async function searchByName(token, accountId, companyName) {
    const url = `${APS_BASE_URL}/hq/v1/accounts/${accountId}/companies/search?name=${encodeURIComponent(companyName)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401) throw new Error("Token expired. Reload the page to refresh.");
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`API ${resp.status} — company search: ${body}`);
    }
    return resp.json();
  }

  return { fetchAll, fetchProjectCompanies, searchByName };
})();
