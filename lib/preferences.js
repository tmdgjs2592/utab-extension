import { DEFAULT_OVERLAY_COLORS, DEFAULT_OVERLAY_ENABLED, DEFAULT_OVERLAY_SCALE } from "./constants.js";

let overlayEnabled = DEFAULT_OVERLAY_ENABLED;
let overlayColors = { ...DEFAULT_OVERLAY_COLORS };
let overlayScale = DEFAULT_OVERLAY_SCALE;
let overlayPreferencesReady = null;

export function getOverlayEnabled() {
  return overlayEnabled;
}

export function getOverlayColors() {
  return overlayColors;
}

export function getOverlayScale() {
  return overlayScale;
}

export function sanitizeOverlayColors(value) {
  return {
    left: normalizeHexColor(value?.left) ?? DEFAULT_OVERLAY_COLORS.left,
    right: normalizeHexColor(value?.right) ?? DEFAULT_OVERLAY_COLORS.right
  };
}

export function normalizeOverlayEnabled(value) {
  return typeof value === "boolean" ? value : DEFAULT_OVERLAY_ENABLED;
}

function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeOverlayScale(value) {
  const MIN_OVERLAY_SCALE = 0.75;
  const MAX_OVERLAY_SCALE = 1.4;
  const OVERLAY_SCALE_STEP = 0.05;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.min(MAX_OVERLAY_SCALE, Math.max(MIN_OVERLAY_SCALE, numeric));
  const stepped = Math.round(clamped / OVERLAY_SCALE_STEP) * OVERLAY_SCALE_STEP;
  return Number(stepped.toFixed(2));
}

export function loadOverlayPreferences() {
  return chrome.storage.sync.get(["overlayEnabled", "overlayColors", "overlayScale"]).then(({ overlayEnabled: storedEnabled, overlayColors: storedColors, overlayScale: storedScale }) => {
    overlayEnabled = normalizeOverlayEnabled(storedEnabled);
    overlayColors = sanitizeOverlayColors(storedColors);
    overlayScale = normalizeOverlayScale(storedScale) ?? DEFAULT_OVERLAY_SCALE;
  }).catch(() => {
    overlayEnabled = DEFAULT_OVERLAY_ENABLED;
    overlayColors = { ...DEFAULT_OVERLAY_COLORS };
    overlayScale = DEFAULT_OVERLAY_SCALE;
  });
}

export function getOverlayPreferencesReady() {
  return overlayPreferencesReady;
}

export function initPreferences() {
  if (!overlayPreferencesReady) {
    overlayPreferencesReady = loadOverlayPreferences();
  }
  return overlayPreferencesReady;
}

export function applyOverlayPreferences({ overlayEnabled: nextEnabled, overlayColors: nextColors, overlayScale: nextScale } = {}) {
  if (nextEnabled !== undefined) {
    overlayEnabled = normalizeOverlayEnabled(nextEnabled);
  }

  if (nextColors !== undefined) {
    overlayColors = sanitizeOverlayColors(nextColors);
  }

  if (nextScale !== undefined) {
    overlayScale = normalizeOverlayScale(nextScale) ?? DEFAULT_OVERLAY_SCALE;
  }

  return {
    overlayEnabled,
    overlayColors,
    overlayScale
  };
}
