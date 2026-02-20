# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MV3 Chrome extension ("ACC Supercharger") that enhances the Autodesk Construction Cloud Admin interface with member/project counts, drill-down lists, and background caching — powered by the APS (Autodesk Platform Services) REST APIs.

## Setup

No build step. Load the repository root as an unpacked extension in Chrome. Configure APS credentials (Client ID, Client Secret, Account ID) on the extension popup or Options page.

## File Structure

- `manifest.json` — MV3 manifest; permissions: `storage`, `alarms`; hosts: `acc.autodesk.com`, `developer.api.autodesk.com`
- `background.js` — Service worker; implements the data pipeline (companies + projects + users cache building)
- `content.js` — Content script injected on `acc.autodesk.com`; enhances the Companies page DOM
- `content.css` — Styles for injected UI elements
- `api.js` — High-level API orchestration used by content scripts
- `popup.html` / `popup.js` — Extension popup UI (credentials entry + cache management)
- `options.html` / `options.js` — Settings page (APS client ID/secret, account ID)
- `pageScript.js` — Script injected into the page context

### `lib/` — Reusable API modules (loaded as content scripts)

- `aps-constants.js` — Shared APS endpoint URLs and constants
- `cache-builder.js` — Caching layer for API responses
- `companies-api.js` — Companies endpoint calls
- `projects-api.js` — Projects endpoint calls
- `users-api.js` — Users endpoint calls

## Naming Conventions

- `camelCase` for functions and variables
- Constants in `UPPER_SNAKE_CASE`

## Architecture Notes

- Content scripts are loaded in order defined in `manifest.json` — `lib/` modules first, then `api.js`, then `content.js`
- `background.js` handles OAuth token management and the full cache-building pipeline
- Cache is stored in `chrome.storage.local` and auto-refreshes when older than 2 hours
- The `lib/` modules are the canonical JavaScript implementation of APS endpoint calls, auth flows, and pagination
