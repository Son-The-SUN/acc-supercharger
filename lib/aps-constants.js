// lib/aps-constants.js - Shared constants for the ACC Supercharger extension
// mirrors acc/apsConstants.py

const APS_BASE_URL = "https://developer.api.autodesk.com";
const APS_TOKEN_URL = `${APS_BASE_URL}/authentication/v2/token`;

// Cache configuration
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const CACHE_ALARM_NAME = "acc-enhancer-cache-refresh";
const CACHE_REFRESH_INTERVAL_MIN = 60; // 1 hour

// Message types for chrome.runtime.sendMessage — used by both
// content scripts (api.js) and extension pages (popup.js, options.js)
const MSG = Object.freeze({
  GET_TOKEN:          "ACC_ENHANCER_GET_TOKEN",
  BUILD_CACHE:        "ACC_ENHANCER_BUILD_CACHE",
  GET_CACHE:          "ACC_ENHANCER_GET_CACHE",
  GET_PROJECTS_CACHE: "ACC_ENHANCER_GET_PROJECTS_CACHE",
  CACHE_PROGRESS:     "ACC_ENHANCER_CACHE_PROGRESS",
});
