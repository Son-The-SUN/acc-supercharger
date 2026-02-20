# Chrome Extension — ACC Supercharger

MV3 Chrome extension enhancing the ACC Admin Companies page with member/project counts and detailed drill-down lists.

## Setup

No build step. Load `chrome-extension/` as an unpacked extension in Chrome. Configure APS credentials on the Options page.

## File Structure

- `manifest.json` — MV3 manifest; permissions: `storage`, `alarms`; hosts: `acc.autodesk.com`, `developer.api.autodesk.com`
- `background.js` — Service worker; implements the same data pipeline as `acc/companies_project_users.py`
- `content.js` — Content script injected on `acc.autodesk.com`; enhances the Companies page DOM
- `content.css` — Styles for injected UI elements
- `api.js` — High-level API orchestration used by content scripts
- `popup.html` / `popup.js` — Extension popup UI
- `options.html` / `options.js` — Settings page (APS client ID/secret, account ID)
- `pageScript.js` — Script injected into the page context

### `lib/` — Reusable API modules (loaded as content scripts)

- `aps-constants.js` — Shared APS endpoint URLs and constants
- `cache-builder.js` — Caching layer for API responses
- `companies-api.js` — Companies endpoint calls
- `projects-api.js` — Projects endpoint calls
- `users-api.js` — Users endpoint calls

## References

- **Python library** (`../acc/`) — Reference implementation for all APS endpoint calls, auth flows, pagination, and request/response shapes.
- **Example webpages** (`../example-webpage/`) — Saved ACC Admin page snapshots; use for DOM structure and CSS class reference when writing content scripts.
