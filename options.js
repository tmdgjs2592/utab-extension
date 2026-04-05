const DEFAULT_OVERLAY_COLORS = Object.freeze({
  left: "#b25a00",
  right: "#1e824c"
});

const state = {
  colors: { ...DEFAULT_OVERLAY_COLORS },
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

initialize().catch(() => {
  reflectColors(DEFAULT_OVERLAY_COLORS);
  setStatus("Using the default palette. Changes will save when you edit a color.", "muted");
});

async function initialize() {
  bindEvents();

  const { overlayColors } = await chrome.storage.sync.get("overlayColors");
  const colors = sanitizeOverlayColors(overlayColors);
  reflectColors(colors);
  setStatus("Changes save automatically and sync with Chrome.", "muted");

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.overlayColors) return;

    const nextColors = sanitizeOverlayColors(changes.overlayColors.newValue);
    const nextSignature = colorsSignature(nextColors);

    if (state.pendingStorageSignature === nextSignature) {
      state.pendingStorageSignature = null;
      return;
    }

    reflectColors(nextColors);
    setStatus("Palette updated.", "success");
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
    reflectColors(DEFAULT_OVERLAY_COLORS);
    await persistColors("Defaults restored.");
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

function reflectColors(colors) {
  state.colors = { ...colors };

  for (const direction of Object.keys(inputPairs)) {
    syncInputs(direction, colors[direction]);
  }

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
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  setStatus("Saving changes...", "muted");
  state.saveTimer = window.setTimeout(() => {
    persistColors("Saved to Chrome sync.");
  }, 140);
}

async function persistColors(message) {
  window.clearTimeout(state.saveTimer);

  try {
    state.pendingStorageSignature = colorsSignature(state.colors);
    await chrome.storage.sync.set({ overlayColors: { ...state.colors } });
    setStatus(message, "success");
  } catch (error) {
    state.pendingStorageSignature = null;
    setStatus("Chrome could not save the palette right now.", "error");
  }
}

function colorsSignature(colors) {
  return `${colors.left}|${colors.right}`;
}

function sanitizeOverlayColors(value) {
  return {
    left: normalizeHexColor(value?.left) ?? DEFAULT_OVERLAY_COLORS.left,
    right: normalizeHexColor(value?.right) ?? DEFAULT_OVERLAY_COLORS.right
  };
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
