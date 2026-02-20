// lib/cache-builder.js - Builds the companies + projects + users hierarchy cache
// mirrors acc/companies_project_users.py build_companies_projects_users_payload()
//
// Requires (in load order):
//   lib/aps-constants.js  (CACHE_MAX_AGE_MS)
//   lib/users-api.js      (UsersAPI)
//   lib/companies-api.js  (CompaniesAPI)
//   lib/projects-api.js   (ProjectsAPI)

/**
 * Return true when the stored cache timestamp is missing or older than
 * CACHE_MAX_AGE_MS.
 *
 * @param {number|null} timestamp - epoch ms, or null/undefined
 * @returns {boolean}
 */
function isCacheStale(timestamp) {
  return !timestamp || Date.now() - timestamp > CACHE_MAX_AGE_MS;
}

/**
 * Fetch all raw data and assemble two caches:
 *   - companiesCache : companies indexed with nested projects + users
 *   - projectsCache  : projects indexed with nested companies + members
 *
 * mirrors acc/companies_project_users.py build_companies_projects_users_payload()
 *
 * @param {string}   token      - valid 2-legged bearer token
 * @param {string}   accountId  - APS account UUID
 * @param {Function} onProgress - optional callback(step, detail)
 * @returns {Promise<{companiesCache: object[], projectsCache: object[]}>}
 */
async function buildCompaniesCache(token, accountId, onProgress) {
  const notify = typeof onProgress === "function" ? onProgress : () => {};

  // ── Step 1: Fetch top-level entities ────────────────────────────────

  notify("companies", "Fetching companies...");
  const companies = await CompaniesAPI.fetchAll(token, accountId);
  notify("companies", `Found ${companies.length} companies.`);

  notify("users", "Fetching account users...");
  const users = await UsersAPI.fetchAll(token, accountId);
  notify("users", `Found ${users.length} users.`);

  notify("projects", "Fetching projects...");
  const projects = await ProjectsAPI.fetchAll(token, accountId);
  notify("projects", `Found ${projects.length} projects.`);

  // ── Step 2: Index lookups ───────────────────────────────────────────

  // users grouped by company_id
  const usersByCompany = {};
  for (const user of users) {
    const companyId = user.company_id || user.companyId;
    if (companyId) {
      (usersByCompany[companyId] ||= []).push(user);
    }
  }

  // projects indexed by id
  const projectsById = {};
  for (const project of projects) {
    if (project.id) projectsById[project.id] = project;
  }

  // companies indexed by id (for name resolution in projects cache)
  const companiesById = {};
  for (const comp of companies) {
    if (comp.id) companiesById[comp.id] = comp;
  }

  // ── Step 3: Map companies → projects and cache project members ──────
  // mirrors acc/companies_project_users.py map_project_ids_by_company()

  notify("mapping", "Mapping companies to projects...");
  const projectIdsByCompany = {}; // companyId → Set<projectId>
  const projectUsersCache   = {}; // projectId → member[]

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (!project.id) continue;

    notify("mapping", `[${i + 1}/${projects.length}] ${project.name || project.id}`);

    const projectCompanies = await CompaniesAPI.fetchProjectCompanies(token, accountId, project.id);
    for (const comp of projectCompanies) {
      if (comp.id) {
        (projectIdsByCompany[comp.id] ||= new Set()).add(project.id);
      }
    }

    projectUsersCache[project.id] = await UsersAPI.fetchProjectUsers(token, project.id);
  }

  // ── Step 4: Assemble companies payload ──────────────────────────────

  notify("assembling", "Assembling companies cache...");
  const companiesResult = [];

  for (const comp of companies) {
    if (!comp.id) continue;

    const companyUsers = usersByCompany[comp.id] || [];
    const userRecords = companyUsers
      .filter((u) => u.id)
      .map((u) => ({ name: UsersAPI.displayUserName(u), uuid: u.id, email: u.email || "" }))
      .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

    const companyProjectIds = projectIdsByCompany[comp.id]
      ? [...projectIdsByCompany[comp.id]].sort()
      : [];

    const projectRecords = companyProjectIds.map((pid) => {
      const project = projectsById[pid] || {};
      const members = (projectUsersCache[pid] || [])
        .filter((pu) => pu.companyId === comp.id && pu.id)
        .map((pu) => ({ name: UsersAPI.displayUserName(pu), uuid: pu.id, email: pu.email || "" }))
        .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
      return {
        name:     project.name     || "",
        uuid:     pid,
        platform: project.platform || "",
        members,
      };
    }).sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

    companiesResult.push({
      name:     comp.name || "",
      uuid:     comp.id,
      projects: projectRecords,
      users:    userRecords,
    });
  }

  companiesResult.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

  // ── Step 5: Assemble projects payload ───────────────────────────────

  notify("assembling", "Assembling projects cache...");
  const projectsResult = [];

  for (const project of projects) {
    if (!project.id) continue;

    const members = (projectUsersCache[project.id] || [])
      .filter((pu) => pu.id)
      .map((pu) => ({
        name:      UsersAPI.displayUserName(pu),
        uuid:      pu.id,
        email:     pu.email     || "",
        companyId: pu.companyId || "",
      }))
      .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

    // Reverse-lookup: which companies appear in this project?
    const companyIdsForProject = new Set();
    for (const [compId, pidSet] of Object.entries(projectIdsByCompany)) {
      if (pidSet.has(project.id)) companyIdsForProject.add(compId);
    }
    const projectCompanies = [...companyIdsForProject]
      .map((cid) => {
        const comp = companiesById[cid];
        return { name: comp ? comp.name || "" : "", uuid: cid };
      })
      .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

    projectsResult.push({
      name:      project.name     || "",
      uuid:      project.id,
      platform:  project.platform || "",
      members,
      companies: projectCompanies,
    });
  }

  projectsResult.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

  return { companiesCache: companiesResult, projectsCache: projectsResult };
}
