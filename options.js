const DEFAULT_OVERLAY_COLORS = Object.freeze({
  left: "#252126",
  right: "#315fcb"
});
const DEFAULT_OVERLAY_SCALE = 1;
const MIN_OVERLAY_SCALE = 0.75;
const MAX_OVERLAY_SCALE = 1.4;
const OVERLAY_SCALE_STEP = 0.05;

const state = {
  colors: { ...DEFAULT_OVERLAY_COLORS },
  scale: DEFAULT_OVERLAY_SCALE,
  saveTimer: null,
  pendingStorageSignature: null
};

const formEl = document.getElementById("overlay-form");
const inputPairs = {
  left: {
    picker: document.getElementById("left-color"),
    hex: document.getElementById("left-hex")
  },
  right: {
    picker: document.getElementById("right-color"),
    hex: document.getElementById("right-hex")
  }
};

const statusEl = document.getElementById("status");
const resetButton = document.getElementById("reset-button");
const sizeInputEl = document.getElementById("overlay-size");
const sizeValueEl = document.getElementById("overlay-size-value");

initialize().catch(() => {
  reflectSettings({
    colors: { ...DEFAULT_OVERLAY_COLORS },
    scale: DEFAULT_OVERLAY_SCALE
  });
  setStatus("Using the default overlay settings. Changes save automatically when you edit them.", "muted");
});

async function initialize() {
  bindEvents();

  const stored = await chrome.storage.sync.get(["overlayColors", "overlayScale"]);
  reflectSettings(sanitizeOverlaySettings(stored));
  setStatus("Changes save automatically and sync with Chrome.", "muted");

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (!changes.overlayColors && !changes.overlayScale) return;

    const nextSettings = sanitizeOverlaySettings({
      overlayColors: changes.overlayColors ? changes.overlayColors.newValue : state.colors,
      overlayScale: changes.overlayScale ? changes.overlayScale.newValue : state.scale
    });
    const nextSignature = settingsSignature(nextSettings);

    if (state.pendingStorageSignature === nextSignature) {
      state.pendingStorageSignature = null;
      return;
    }

    reflectSettings(nextSettings);
    setStatus("Overlay settings updated.", "success");
  });
}

function bindEvents() {
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  for (const [direction, pair] of Object.entries(inputPairs)) {
    pair.picker.addEventListener("input", () => {
      applyColor(direction, pair.picker.value, { source: "picker", save: true });
    });

    pair.hex.addEventListener("input", () => {
      const normalized = normalizeHexColor(pair.hex.value);

      if (!normalized) {
        pair.hex.setAttribute("aria-invalid", "true");
        setStatus("Enter a full hex color like #315fcb.", "muted");
        return;
      }

      applyColor(direction, normalized, { source: "hex", save: true });
    });

    pair.hex.addEventListener("blur", () => {
      pair.hex.value = state.colors[direction];
      pair.hex.removeAttribute("aria-invalid");
    });
  }

  resetButton.addEventListener("click", async () => {
    reflectSettings({
      colors: { ...DEFAULT_OVERLAY_COLORS },
      scale: DEFAULT_OVERLAY_SCALE
    });
    await persistSettings("Defaults restored.");
  });

  sizeInputEl.addEventListener("input", () => {
    applyScale(sizePercentToScale(sizeInputEl.value), { save: true });
  });
}

function applyColor(direction, value, options = {}) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return;

  state.colors = {
    ...state.colors,
    [direction]: normalized
  };

  syncInputs(direction, normalized, options.source);
  updatePreview();

  if (options.save) {
    scheduleSave();
  }
}

function applyScale(value, options = {}) {
  const normalized = normalizeOverlayScale(value);
  if (normalized == null) return;

  state.scale = normalized;
  syncSizeInput(normalized);
  updatePreview();

  if (options.save) {
    scheduleSave();
  }
}

function reflectSettings(settings) {
  state.colors = { ...settings.colors };
  state.scale = settings.scale;

  for (const direction of Object.keys(inputPairs)) {
    syncInputs(direction, settings.colors[direction]);
  }

  syncSizeInput(settings.scale);
  updatePreview();
}

function syncInputs(direction, value, source) {
  const pair = inputPairs[direction];
  if (source !== "picker") pair.picker.value = value;
  if (source !== "hex") pair.hex.value = value;
  pair.hex.removeAttribute("aria-invalid");
}

function updatePreview() {
  document.documentElement.style.setProperty("--preview-left", state.colors.left);
  document.documentElement.style.setProperty("--preview-right", state.colors.right);
  document.documentElement.style.setProperty("--preview-scale", String(state.scale));
  const formattedScale = formatScalePercent(state.scale);
  sizeValueEl.value = formattedScale;
  sizeValueEl.textContent = formattedScale;
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  setStatus("Saving changes...", "muted");
  state.saveTimer = window.setTimeout(() => {
    persistSettings("Saved to Chrome sync.");
  }, 140);
}

async function persistSettings(message) {
  window.clearTimeout(state.saveTimer);

  try {
    state.pendingStorageSignature = settingsSignature(state);
    await chrome.storage.sync.set({
      overlayColors: { ...state.colors },
      overlayScale: state.scale
    });
    setStatus(message, "success");
  } catch (error) {
    state.pendingStorageSignature = null;
    setStatus("Chrome could not save the overlay settings right now.", "error");
  }
}

function settingsSignature(settings) {
  return `${settings.colors.left}|${settings.colors.right}|${settings.scale.toFixed(2)}`;
}

function sanitizeOverlaySettings(value) {
  return {
    colors: sanitizeOverlayColors(value?.overlayColors),
    scale: sanitizeOverlayScale(value?.overlayScale)
  };
}

function sanitizeOverlayColors(value) {
  return {
    left: normalizeHexColor(value?.left) ?? DEFAULT_OVERLAY_COLORS.left,
    right: normalizeHexColor(value?.right) ?? DEFAULT_OVERLAY_COLORS.right
  };
}

function sanitizeOverlayScale(value) {
  return normalizeOverlayScale(value) ?? DEFAULT_OVERLAY_SCALE;
}

function normalizeOverlayScale(value) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;

  const clamped = Math.min(MAX_OVERLAY_SCALE, Math.max(MIN_OVERLAY_SCALE, numeric));
  const stepped = Math.round(clamped / OVERLAY_SCALE_STEP) * OVERLAY_SCALE_STEP;
  return Number(stepped.toFixed(2));
}

function syncSizeInput(scale) {
  sizeInputEl.value = String(Math.round(scale * 100));
}

function sizePercentToScale(value) {
  return Number(value) / 100;
}

function formatScalePercent(scale) {
  return `${Math.round(scale * 100)}%`;
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

function setStatus(message, tone) {
  statusEl.textContent = message;
  if (tone) {
    statusEl.dataset.tone = tone;
  } else {
    delete statusEl.dataset.tone;
  }
}
