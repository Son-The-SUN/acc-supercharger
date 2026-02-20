// content.js - Enhances the ACC Companies sidebar with clickable member/project counts

// In-memory caches to avoid re-fetching on every company click
let cachedUsers = null;
let cachedProjects = null;
// Map of projectId -> [companyId, ...] for project-company associations
let cachedProjectCompanyMap = null;

// Pre-built caches (from background.js cache builder)
let companiesCache = null;
let projectsCache = null;

// ── Cache Loading ─────────────────────────────────────────────────────

async function loadCompaniesCache() {
  try {
    const { cache, stale } = await getCompaniesCache();
    if (cache && Array.isArray(cache)) {
      companiesCache = cache;
      console.log(`ACC Enhancer: loaded cache with ${cache.length} companies (stale: ${stale})`);
      if (stale) {
        console.log("ACC Enhancer: cache is stale, triggering rebuild...");
        triggerCacheBuild().catch((err) =>
          console.warn("ACC Enhancer: background cache rebuild failed:", err)
        );
      }
    } else {
      console.log("ACC Enhancer: no cache available, triggering build...");
      triggerCacheBuild().catch((err) =>
        console.warn("ACC Enhancer: background cache build failed:", err)
      );
    }
  } catch (err) {
    console.warn("ACC Enhancer: could not load cache:", err);
  }

  // Load projects cache alongside companies cache
  try {
    const { cache } = await getProjectsCache();
    if (cache && Array.isArray(cache)) {
      projectsCache = cache;
      console.log(`ACC Enhancer: loaded projects cache with ${cache.length} projects`);
    }
  } catch (err) {
    console.warn("ACC Enhancer: could not load projects cache:", err);
  }
}

// ── MutationObserver Setup ──────────────────────────────────────────────

function initObserver() {
  const observer = new MutationObserver(() => {
    tryEnhanceSidebar();
    tryEnhanceProjectsTable();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Run once immediately in case the sidebar/table is already visible
  tryEnhanceSidebar();
  tryEnhanceProjectsTable();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    loadCompaniesCache();
    initObserver();
  });
} else {
  loadCompaniesCache();
  initObserver();
}

// ── Sidebar Detection ───────────────────────────────────────────────────

function tryEnhanceSidebar() {
  // Strategy 1: Look inside the ACC CompanyProfilePanel (identified by data-testid)
  const panel = document.querySelector(
    '[data-testid="CompanyProfilePanel_CloseButton"]'
  )?.closest('[class*="Animation"]');

  if (panel) {
    const candidates = panel.querySelectorAll("div");
    for (const el of candidates) {
      checkAndEnhance(el);
    }
    return;
  }

  // Strategy 2: Full TreeWalker scan as fallback
  tryEnhanceFallback();
}

function tryEnhanceFallback() {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const text = node.textContent?.trim() || "";
        if (/^\d+\s+(members?|projects?)$/i.test(text)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      },
    }
  );

  while (walker.nextNode()) {
    const parentEl = walker.currentNode.parentElement;
    if (parentEl) {
      checkAndEnhance(parentEl);
    }
  }
}

/**
 * Check if an element contains "X members" or "X projects" text and enhance it.
 * Returns true if enhancement was applied.
 */
function checkAndEnhance(el) {
  if (el.dataset?.accEnhanced) return false;

  // Skip elements outside the Company Profile Panel (e.g. Member Profile Panel,
  // Project Picker dropdown, navigation sidebar)
  if (el.closest('[data-testid="AccountMemberProfilePanel"]') ||
      el.closest('[data-testid*="MemberProfilePanel"]') ||
      el.closest('[data-testid*="ProjectPicker"]') ||
      el.closest('[data-testid*="TopNavigation"]')) {
    return false;
  }

  const text = el.textContent?.trim() || "";

  // Only match leaf-ish elements (avoid matching parent containers)
  if (el.children.length > 2) return false;

  const membersMatch = text.match(/^(\d+)\s+members?$/i);
  const projectsMatch = text.match(/^(\d+)\s+projects?$/i);

  if (membersMatch) {
    enhanceCountElement(el, "members", parseInt(membersMatch[1]));
    return true;
  }
  if (projectsMatch) {
    enhanceCountElement(el, "projects", parseInt(projectsMatch[1]));
    return true;
  }
  return false;
}

// ── Enhancement Logic ───────────────────────────────────────────────────

function enhanceCountElement(el, type, count) {
  el.dataset.accEnhanced = "true";
  el.classList.add("acc-enhancer-clickable");
  el.title = `Click to show ${type}`;

  // Create expandable container (hidden initially)
  const listContainer = document.createElement("div");
  listContainer.className = "acc-enhancer-list";
  listContainer.style.display = "none";

  // Insert after the element (or after its parent if it's a text-only span)
  const insertAfter =
    el.parentElement?.children.length === 1 ? el.parentElement : el;
  insertAfter.parentElement.insertBefore(listContainer, insertAfter.nextSibling);

  let expanded = false;

  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    expanded = !expanded;

    if (!expanded) {
      listContainer.style.display = "none";
      return;
    }

    listContainer.style.display = "block";
    listContainer.innerHTML =
      '<div class="acc-enhancer-loading">Loading...</div>';

    try {
      const companyName = extractCurrentCompanyName();
      listContainer.innerHTML =
        `<div class="acc-enhancer-loading">Company name: <b>${companyName || "NOT FOUND"}</b><br>Looking up company ID...</div>`;

      const companyId = await findCompanyId(companyName);
      listContainer.innerHTML =
        `<div class="acc-enhancer-loading">Company name: <b>${companyName}</b><br>Company ID: <b>${companyId || "NOT FOUND"}</b><br>Fetching ${type}...</div>`;

      if (type === "members") {
        await renderMembersList(listContainer, companyName, companyId);
      } else {
        await renderProjectsList(listContainer, companyName, companyId);
      }
    } catch (err) {
      listContainer.innerHTML += `<div class="acc-enhancer-error">${err.message}</div>`;
      console.error("ACC Enhancer error:", err);
    }
  });
}

// ── Cache Lookup Helpers ────────────────────────────────────────────────

/**
 * Find a company entry in the pre-built cache by name (case-insensitive).
 */
function findCachedCompany(companyName) {
  if (!companiesCache || !companyName) return null;
  const lower = companyName.toLowerCase();
  return companiesCache.find((c) => (c.name || "").toLowerCase() === lower) || null;
}

/**
 * Find a company entry in the pre-built cache by uuid.
 */
function findCachedCompanyById(companyId) {
  if (!companiesCache || !companyId) return null;
  return companiesCache.find((c) => c.uuid === companyId) || null;
}

/**
 * Find a project entry in the pre-built projects cache by uuid.
 */
function findCachedProject(projectId) {
  if (!projectsCache || !projectId) return null;
  return projectsCache.find((p) => p.uuid === projectId) || null;
}

// ── Company Identification ──────────────────────────────────────────────

/**
 * Extract the currently selected company name from the sidebar.
 */
function extractCurrentCompanyName() {
  // Primary: use the data-testid attribute from ACC's React components
  const nameEl = document.querySelector(
    '[data-testid="CompanyProfilePanel_inlineEdit_name"]'
  );
  if (nameEl) {
    // The actual text is nested inside styled divs
    const innerDiv = nameEl.querySelector(
      '[class*="InlineEdit___StyledDiv"]'
    );
    const text = (innerDiv || nameEl).textContent?.trim();
    if (text) return text;
  }

  // Fallback: look for company name near the close button
  const closeBtn = document.querySelector(
    '[data-testid="CompanyProfilePanel_CloseButton"]'
  );
  if (closeBtn) {
    const header = closeBtn.closest("header");
    if (header) {
      // Find the bold text div (font-weight: 700) that contains the company name
      const boldDivs = header.querySelectorAll("div");
      for (const div of boldDivs) {
        const style = div.getAttribute("style") || "";
        if (style.includes("font-weight: 700") || style.includes("font-weight:700")) {
          const text = div.textContent?.trim();
          if (text) return text;
        }
      }
    }
  }

  return null;
}

/**
 * Find company ID by searching the cache first, then the API.
 */
async function findCompanyId(companyName) {
  if (!companyName) return null;

  // Try the pre-built cache first
  const cached = findCachedCompany(companyName);
  if (cached) return cached.uuid;

  // Search companies by name via API
  try {
    const results = await searchCompanyByName(companyName);
    if (Array.isArray(results) && results.length > 0) {
      const exact = results.find(
        (c) => c.name.toLowerCase() === companyName.toLowerCase()
      );
      return exact ? exact.id : results[0].id;
    }
  } catch {
    // Fall through to user-based detection
  }

  // Fallback: get company ID from cached users
  if (cachedUsers) {
    const userWithCompany = cachedUsers.find(
      (u) => u.company_name?.toLowerCase() === companyName.toLowerCase()
    );
    if (userWithCompany) return userWithCompany.company_id;
  }

  return null;
}

// ── Rendering ───────────────────────────────────────────────────────────

async function renderMembersList(container, companyName, companyId) {
  // Try pre-built cache first
  const cachedCompany = findCachedCompanyById(companyId) || findCachedCompany(companyName);
  if (cachedCompany && cachedCompany.users) {
    renderMembersFromCache(container, cachedCompany.users);
    return;
  }

  // Fallback to on-demand fetch
  if (!cachedUsers) {
    cachedUsers = await fetchAllUsers();
  }

  let companyMembers;
  if (companyId) {
    companyMembers = cachedUsers.filter((u) => u.company_id === companyId);
  } else if (companyName) {
    companyMembers = cachedUsers.filter(
      (u) => u.company_name?.toLowerCase() === companyName.toLowerCase()
    );
  } else {
    container.innerHTML =
      '<div class="acc-enhancer-error">Could not determine company.</div>';
    return;
  }

  if (companyMembers.length === 0) {
    container.innerHTML =
      '<div class="acc-enhancer-empty">No members found.</div>';
    return;
  }

  companyMembers.sort((a, b) =>
    (a.name || a.email || "").localeCompare(b.name || b.email || "")
  );

  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "acc-enhancer-header";
  header.textContent = `${companyMembers.length} member(s)`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "acc-enhancer-copy-btn";
  copyBtn.textContent = "Copy emails";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const emails = companyMembers
      .map((m) => m.email)
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(emails);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy emails"), 2000);
  });
  header.appendChild(copyBtn);

  const list = document.createElement("ul");
  list.className = "acc-enhancer-items";

  for (const member of companyMembers) {
    const li = document.createElement("li");
    li.className = "acc-enhancer-item";
    const name =
      member.name ||
      `${member.firstName || ""} ${member.lastName || ""}`.trim();
    li.textContent =
      name && member.email
        ? `${name} (${member.email})`
        : member.email || name || "Unknown";
    list.appendChild(li);
  }

  container.appendChild(header);
  container.appendChild(list);
}

/**
 * Render members list from pre-built cache data.
 */
function renderMembersFromCache(container, users) {
  if (!users || users.length === 0) {
    container.innerHTML =
      '<div class="acc-enhancer-empty">No members found.</div>';
    return;
  }

  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "acc-enhancer-header";
  header.textContent = `${users.length} member(s)`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "acc-enhancer-copy-btn";
  copyBtn.textContent = "Copy emails";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const emails = users.map((m) => m.email).filter(Boolean).join("\n");
    navigator.clipboard.writeText(emails);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy emails"), 2000);
  });
  header.appendChild(copyBtn);

  const list = document.createElement("ul");
  list.className = "acc-enhancer-items";

  for (const member of users) {
    const li = document.createElement("li");
    li.className = "acc-enhancer-item";
    li.textContent =
      member.name && member.email
        ? `${member.name} (${member.email})`
        : member.email || member.name || "Unknown";
    list.appendChild(li);
  }

  container.appendChild(header);
  container.appendChild(list);
}

async function renderProjectsList(container, companyName, companyId) {
  // Try pre-built cache first
  const cachedCompany = findCachedCompanyById(companyId) || findCachedCompany(companyName);
  if (cachedCompany && cachedCompany.projects) {
    renderProjectsFromCache(container, cachedCompany.projects);
    return;
  }

  // Fallback to on-demand fetch
  if (!cachedProjects) {
    container.innerHTML =
      '<div class="acc-enhancer-loading">Fetching all projects...</div>';
    cachedProjects = await fetchAllProjects();
  }

  if (!companyId) {
    container.innerHTML =
      '<div class="acc-enhancer-error">Could not determine company ID.</div>';
    return;
  }

  // Check project-company associations via per-project API
  if (!cachedProjectCompanyMap) {
    cachedProjectCompanyMap = {};
    const total = cachedProjects.length;
    const batchSize = 10;

    for (let i = 0; i < total; i += batchSize) {
      container.innerHTML =
        `<div class="acc-enhancer-loading">Checking project associations... ${Math.min(i + batchSize, total)}/${total}</div>`;
      const batch = cachedProjects.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (project) => {
          try {
            const companies = await fetchProjectCompanies(project.id);
            cachedProjectCompanyMap[project.id] = companies.map(
              (c) => c.id
            );
          } catch {
            cachedProjectCompanyMap[project.id] = [];
          }
        })
      );
    }
  }

  const companyProjects = cachedProjects.filter((p) => {
    const companyIds = cachedProjectCompanyMap[p.id] || [];
    return companyIds.includes(companyId);
  });

  if (companyProjects.length === 0) {
    container.innerHTML =
      '<div class="acc-enhancer-empty">No projects found.</div>';
    return;
  }

  companyProjects.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "acc-enhancer-header";
  header.textContent = `${companyProjects.length} project(s)`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "acc-enhancer-copy-btn";
  copyBtn.textContent = "Copy names";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const names = companyProjects
      .map((p) => p.name)
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(names);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy names"), 2000);
  });
  header.appendChild(copyBtn);

  const list = document.createElement("ul");
  list.className = "acc-enhancer-items";

  for (const project of companyProjects) {
    const li = document.createElement("li");
    li.className = "acc-enhancer-item";
    const platform = project.platform ? ` [${project.platform}]` : "";
    li.textContent = (project.name || project.id) + platform;
    list.appendChild(li);
  }

  container.appendChild(header);
  container.appendChild(list);
}

/**
 * Render projects list from pre-built cache data (includes members).
 * Splits into two sections: projects with members and projects without.
 */
function renderProjectsFromCache(container, projects) {
  if (!projects || projects.length === 0) {
    container.innerHTML =
      '<div class="acc-enhancer-empty">No projects found.</div>';
    return;
  }

  const withMembers = projects.filter((p) => p.members && p.members.length > 0);
  const noMembers = projects.filter((p) => !p.members || p.members.length === 0);

  container.innerHTML = "";

  const totalHeader = document.createElement("div");
  totalHeader.className = "acc-enhancer-header";
  totalHeader.textContent = `${projects.length} PROJECT(S)`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "acc-enhancer-copy-btn";
  copyBtn.textContent = "Copy names";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const names = projects.map((p) => p.name).filter(Boolean).join("\n");
    navigator.clipboard.writeText(names);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy names"), 2000);
  });
  totalHeader.appendChild(copyBtn);
  container.appendChild(totalHeader);

  // Section 1: Projects with members
  if (withMembers.length > 0) {
    const section = document.createElement("div");
    section.className = "acc-enhancer-section";

    const sectionHeader = document.createElement("div");
    sectionHeader.className = "acc-enhancer-section-header";
    sectionHeader.textContent = `With members (${withMembers.length})`;
    section.appendChild(sectionHeader);

    const list = document.createElement("ul");
    list.className = "acc-enhancer-items";

    for (const project of withMembers) {
      const li = document.createElement("li");
      li.className = "acc-enhancer-item acc-enhancer-expandable";
      const platform = project.platform ? ` [${project.platform}]` : "";
      const memberCount = ` (${project.members.length} members)`;
      li.textContent = (project.name || project.uuid) + platform + memberCount;

      // Expandable member sub-list
      const memberList = document.createElement("ul");
      memberList.className = "acc-enhancer-sub-items";
      memberList.style.display = "none";

      for (const member of project.members) {
        const mLi = document.createElement("li");
        mLi.className = "acc-enhancer-sub-item";
        mLi.textContent =
          member.name && member.email
            ? `${member.name} (${member.email})`
            : member.email || member.name || "Unknown";
        memberList.appendChild(mLi);
      }

      li.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = memberList.style.display !== "none";
        memberList.style.display = isVisible ? "none" : "block";
        li.classList.toggle("acc-enhancer-expanded", !isVisible);
      });

      li.appendChild(memberList);
      list.appendChild(li);
    }

    section.appendChild(list);
    container.appendChild(section);
  }

  // Section 2: Projects without members
  if (noMembers.length > 0) {
    const section = document.createElement("div");
    section.className = "acc-enhancer-section";

    const sectionHeader = document.createElement("div");
    sectionHeader.className = "acc-enhancer-section-header";
    sectionHeader.textContent = `No members (${noMembers.length})`;
    section.appendChild(sectionHeader);

    const list = document.createElement("ul");
    list.className = "acc-enhancer-items";

    for (const project of noMembers) {
      const li = document.createElement("li");
      li.className = "acc-enhancer-item";
      const platform = project.platform ? ` [${project.platform}]` : "";
      li.textContent = (project.name || project.uuid) + platform + " (0 members)";
      list.appendChild(li);
    }

    section.appendChild(list);
    container.appendChild(section);
  }
}

// ── Projects Table Enhancement ──────────────────────────────────────────

// In-memory cache for all companies (for resolving company IDs to names)
let cachedCompanies = null;

/**
 * Detect the Projects table and make member/company count cells clickable.
 */
function tryEnhanceProjectsTable() {
  // Only run on the Projects page
  if (!document.querySelector('[data-testid="AccountProjectsTabActive"]') &&
      !document.querySelector('[data-testid="AccountProjectsTab"]')) {
    return;
  }

  // Find the header row to determine column indices dynamically
  const memberHeader = document.querySelector('[data-testid="header-memberCount"]');
  const companyHeader = document.querySelector('[data-testid="header-companyCount"]');
  if (!memberHeader || !companyHeader) return;

  // Get column indices from the header row
  const headerRow = memberHeader.closest("tr");
  if (!headerRow) return;
  const headers = [...headerRow.children];
  const memberColIdx = headers.indexOf(memberHeader);
  const companyColIdx = headers.indexOf(companyHeader);
  if (memberColIdx < 0 || companyColIdx < 0) return;

  // Find all data rows
  const rows = document.querySelectorAll('[data-testid^="row-"]');
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length <= Math.max(memberColIdx, companyColIdx)) continue;

    enhanceProjectCell(row, cells[memberColIdx], "members", cells);
    enhanceProjectCell(row, cells[companyColIdx], "companies", cells);
  }
}

/**
 * Make a project table cell clickable to show a slide-out panel.
 */
function enhanceProjectCell(row, cell, type, allCells) {
  if (cell.dataset?.accProjectEnhanced) return;
  cell.dataset.accProjectEnhanced = "true";

  // Find the inner div containing the number text
  const textDiv = cell.querySelector('[class*="OverflowTooltip"]');
  if (!textDiv) return;

  const count = parseInt(textDiv.textContent?.trim(), 10);
  if (isNaN(count) || count === 0) return;

  textDiv.classList.add("acc-enhancer-clickable");
  textDiv.title = `Click to show ${type}`;

  textDiv.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();

    // Extract project name from the first cell
    const nameDiv = allCells[0]?.querySelector('[class*="OverflowTooltip"]');
    const projectName = nameDiv?.textContent?.trim() || "Unknown Project";

    // Find the project ID
    const projectId = await resolveProjectId(projectName);

    if (!projectId) {
      console.error("ACC Enhancer: could not resolve project ID for", projectName);
      return;
    }

    if (type === "members") {
      showProjectPanel(projectName, "Members", projectId, renderProjectMembersPanel);
    } else {
      showProjectPanel(projectName, "Companies", projectId, renderProjectCompaniesPanel);
    }
  });
}

/**
 * Resolve a project name to its project ID using the cache or API.
 */
async function resolveProjectId(projectName) {
  // Try the projects cache first (O(1) by name scan)
  if (projectsCache) {
    const cached = projectsCache.find((p) => p.name === projectName);
    if (cached) return cached.uuid;
  }

  // Try the companies cache (projects nested inside companies)
  if (companiesCache) {
    for (const company of companiesCache) {
      if (!company.projects) continue;
      for (const project of company.projects) {
        if (project.name === projectName) return project.uuid;
      }
    }
  }

  // Fall back to fetching all projects
  if (!cachedProjects) {
    cachedProjects = await fetchAllProjects();
  }

  const project = cachedProjects.find((p) => p.name === projectName);
  return project?.id || null;
}

// ── Slide-out Panel ──────────────────────────────────────────────────────

let activePanel = null;
let activePanelOverlay = null;

function closeProjectPanel() {
  if (activePanel) {
    activePanel.classList.remove("acc-enhancer-panel-open");
    setTimeout(() => {
      activePanel?.remove();
      activePanelOverlay?.remove();
      activePanel = null;
      activePanelOverlay = null;
    }, 250);
  }
}

/**
 * Show a slide-out panel for a project.
 * @param {string} projectName
 * @param {string} label - "Members" or "Companies"
 * @param {string} projectId
 * @param {Function} renderFn - async function(bodyEl, projectId)
 */
function showProjectPanel(projectName, label, projectId, renderFn) {
  // Close any existing panel first
  if (activePanel) {
    activePanel.remove();
    activePanelOverlay?.remove();
    activePanel = null;
    activePanelOverlay = null;
  }

  // Overlay
  const overlay = document.createElement("div");
  overlay.className = "acc-enhancer-panel-overlay";
  overlay.addEventListener("click", closeProjectPanel);
  document.body.appendChild(overlay);
  activePanelOverlay = overlay;

  // Panel
  const panel = document.createElement("div");
  panel.className = "acc-enhancer-panel";

  // Header
  const header = document.createElement("div");
  header.className = "acc-enhancer-panel-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "acc-enhancer-panel-title";
  title.textContent = projectName;
  title.title = projectName;
  const subtitle = document.createElement("div");
  subtitle.className = "acc-enhancer-panel-subtitle";
  subtitle.textContent = label;
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);
  titleWrap.style.overflow = "hidden";
  titleWrap.style.flex = "1";
  titleWrap.style.marginRight = "12px";

  const closeBtn = document.createElement("button");
  closeBtn.className = "acc-enhancer-panel-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", closeProjectPanel);

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "acc-enhancer-panel-body";
  body.innerHTML = '<div class="acc-enhancer-loading">Loading...</div>';

  panel.appendChild(header);
  panel.appendChild(body);
  document.body.appendChild(panel);
  activePanel = panel;

  // Trigger slide-in animation
  requestAnimationFrame(() => {
    panel.classList.add("acc-enhancer-panel-open");
  });

  // Render content
  renderFn(body, projectId).catch((err) => {
    body.innerHTML = `<div class="acc-enhancer-error">${err.message}</div>`;
    console.error("ACC Enhancer panel error:", err);
  });
}

/**
 * Render project members into the panel body.
 */
async function renderProjectMembersPanel(body, projectId) {
  // Try projects cache first (O(1) lookup)
  let members = null;
  const cachedProject = findCachedProject(projectId);
  if (cachedProject && cachedProject.members && cachedProject.members.length > 0) {
    members = cachedProject.members;
  }

  // Fall back to companies cache — collect all members for this project across companies
  if (!members && companiesCache) {
    members = [];
    const seen = new Set();
    for (const company of companiesCache) {
      if (!company.projects) continue;
      for (const project of company.projects) {
        if (project.uuid === projectId && project.members) {
          for (const m of project.members) {
            const key = m.uuid || m.email;
            if (!seen.has(key)) {
              seen.add(key);
              members.push(m);
            }
          }
        }
      }
    }
    // If cache had no members for this project, fall back to API
    if (members.length === 0) members = null;
  }

  if (!members) {
    body.innerHTML = '<div class="acc-enhancer-loading">Fetching members...</div>';
    const raw = await fetchProjectMembers(projectId);
    members = raw.map((m) => ({
      name: m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim(),
      email: m.email,
      uuid: m.id || m.autodeskId,
    }));
  }

  if (members.length === 0) {
    body.innerHTML = '<div class="acc-enhancer-empty">No members found.</div>';
    return;
  }

  members.sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));

  body.innerHTML = "";

  const header = document.createElement("div");
  header.className = "acc-enhancer-header";
  header.textContent = `${members.length} MEMBER(S)`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "acc-enhancer-copy-btn";
  copyBtn.textContent = "Copy emails";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const emails = members.map((m) => m.email).filter(Boolean).join("\n");
    navigator.clipboard.writeText(emails);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy emails"), 2000);
  });
  header.appendChild(copyBtn);

  const list = document.createElement("ul");
  list.className = "acc-enhancer-items";

  for (const member of members) {
    const li = document.createElement("li");
    li.className = "acc-enhancer-item";
    li.textContent =
      member.name && member.email
        ? `${member.name} (${member.email})`
        : member.email || member.name || "Unknown";
    list.appendChild(li);
  }

  body.appendChild(header);
  body.appendChild(list);
}

/**
 * Render project companies into the panel body.
 */
async function renderProjectCompaniesPanel(body, projectId) {
  // Try projects cache first (O(1) lookup)
  const cachedProject = findCachedProject(projectId);
  if (cachedProject && cachedProject.companies && cachedProject.companies.length > 0) {
    const companies = cachedProject.companies.slice().sort(
      (a, b) => (a.name || "").localeCompare(b.name || "")
    );

    body.innerHTML = "";

    const header = document.createElement("div");
    header.className = "acc-enhancer-header";
    header.textContent = `${companies.length} COMPANY(IES)`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "acc-enhancer-copy-btn";
    copyBtn.textContent = "Copy names";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const names = companies.map((c) => c.name).filter(Boolean).join("\n");
      navigator.clipboard.writeText(names);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy names"), 2000);
    });
    header.appendChild(copyBtn);

    const list = document.createElement("ul");
    list.className = "acc-enhancer-items";

    for (const company of companies) {
      const li = document.createElement("li");
      li.className = "acc-enhancer-item";
      li.textContent = company.name || company.uuid;
      list.appendChild(li);
    }

    body.appendChild(header);
    body.appendChild(list);
    return;
  }

  body.innerHTML = '<div class="acc-enhancer-loading">Fetching companies...</div>';

  // Fetch companies assigned to the project
  const rawCompanies = await fetchProjectCompanies(projectId);

  if (!rawCompanies || rawCompanies.length === 0) {
    body.innerHTML = '<div class="acc-enhancer-empty">No companies found.</div>';
    return;
  }

  // Resolve company names — rawCompanies may only have { id } from the fallback path
  let companies = [];
  for (const c of rawCompanies) {
    if (c.name) {
      companies.push({ name: c.name, id: c.id });
      continue;
    }
    // Try to resolve name from companies cache
    const cached = findCachedCompanyById(c.id);
    if (cached) {
      companies.push({ name: cached.name, id: c.id });
      continue;
    }
    // Will resolve below via full companies fetch
    companies.push({ name: null, id: c.id });
  }

  // If any companies still lack names, fetch all companies to resolve
  const unresolved = companies.filter((c) => !c.name);
  if (unresolved.length > 0) {
    if (!cachedCompanies) {
      cachedCompanies = await fetchAllCompanies();
    }
    const companyMap = new Map(cachedCompanies.map((c) => [c.id, c.name]));
    for (const c of unresolved) {
      c.name = companyMap.get(c.id) || c.id;
    }
  }

  companies.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  body.innerHTML = "";

  const header = document.createElement("div");
  header.className = "acc-enhancer-header";
  header.textContent = `${companies.length} COMPANY(IES)`;

  const copyBtn = document.createElement("button");
  copyBtn.className = "acc-enhancer-copy-btn";
  copyBtn.textContent = "Copy names";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const names = companies.map((c) => c.name).filter(Boolean).join("\n");
    navigator.clipboard.writeText(names);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy names"), 2000);
  });
  header.appendChild(copyBtn);

  const list = document.createElement("ul");
  list.className = "acc-enhancer-items";

  for (const company of companies) {
    const li = document.createElement("li");
    li.className = "acc-enhancer-item";
    li.textContent = company.name || company.id;
    list.appendChild(li);
  }

  body.appendChild(header);
  body.appendChild(list);
}
