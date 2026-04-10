const KEY_SEQUENCE = [
  "0","1","2","3","4","5","6","7","8","9",
  "q","w","e","r","t","y","u","i","o","p",
  "a","s","d","f","g","h","j","k","l",
  "z","x","c","v","b","n","m"
];
const KEY_INDEX = Object.fromEntries(KEY_SEQUENCE.map((k, i) => [k, i]));
const DEFAULT_OVERLAY_COLORS = Object.freeze({
  left: "#b25a00",
  right: "#1e824c"
});
const DEFAULT_OVERLAY_SCALE = 1;
const MIN_OVERLAY_SCALE = 0.75;
const MAX_OVERLAY_SCALE = 1.4;
const OVERLAY_SCALE_STEP = 0.05;
const CURRENT_BADGE_COLOR = "#5f5964";

let composited_icon_cache = new Map();
let favicon_cache = new Map();
let tab_state_cache = new Map();
let last_tab = null;
let overlayColors = { ...DEFAULT_OVERLAY_COLORS };
let overlayScale = DEFAULT_OVERLAY_SCALE;
const overlayPreferencesReady = loadOverlayPreferences();

/**
 * Upon installed, inject content.js file to existing tabs.
 */
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    // Skip restricted pages where injection is not allowed
    if (/^(chrome|edge|about|chrome-extension):/i.test(t.url)) continue;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id },
        files: ["content.js"],
        world: "ISOLATED"
      });
    } catch {
      // Injection is not available on every existing tab during install.
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;

  let shouldRefresh = false;

  if (changes.overlayColors) {
    overlayColors = sanitizeOverlayColors(changes.overlayColors.newValue);
    shouldRefresh = true;
  }

  if (changes.overlayScale) {
    overlayScale = sanitizeOverlayScale(changes.overlayScale.newValue);
    shouldRefresh = true;
  }

  if (!shouldRefresh) return;

  composited_icon_cache.clear();
  tab_state_cache.clear();
  scheduleUpdate();
});

/**
 * Listen for jump mode.
 * Parse for the direction and send the message to the tab.
 * @cmd comes from the shortcut (Ctrl + U/I).
 */
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "utab-jump-mode-plus" || cmd === "utab-jump-mode-minus") {
    const neg = cmd.endsWith("minus");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url) return;
    if (isRestrictedUrl(tab.url)) return;

    await ensureContentScript(tab.id, tab.url);

    // Ask the current page to start listening for digits
    const message = "UTAB_JUMP_MODE";
    chrome.tabs.sendMessage(tab.id, { type: message, neg: neg }).catch(() => {});
  }
  else if (cmd === "utab-jump-back"){
    const [temp] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(last_tab != null){
      const target = await chrome.tabs.get(last_tab).catch(() => null);
      if (target?.windowId != null) {
        await chrome.windows.update(target.windowId, { focused: true }).catch(() => {});
      }
      await chrome.tabs.update(last_tab, {active: true});
      last_tab = temp?.id ?? null;
    }
  }
  else if (cmd === "utab-search") {
    await openTabSearch();
  }
});

/**
 * Listen for offset and switch the current tab by the amount.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "UTAB_JUMP") {
    const idx = KEY_INDEX[msg.offset?.toLowerCase?.() ?? ""];
    if (typeof idx !== "number") return false;

    const offset = msg.neg ? idx : -idx;
    jumpByOffset(offset, sender.tab?.windowId);
    return true; // async
  }

  if (msg?.type === "UTAB_TAB_SEARCH_ACTIVATE") {
    activateTabById(msg.tabId, msg.windowId, sender.tab?.id).catch(() => {});
    return true;
  }
});

/**
 * Invalidate jump back feature upon removing the last tab.
 */
chrome.tabs.onRemoved.addListener(function(tabId) {
  if (tabId === last_tab) {
    last_tab = null;
  }
  tab_state_cache.delete(tabId);
});

/**
 * function to switch the current tab by the specified offset
 * @param: offset
 * @result update the current tab
 */
async function jumpByOffset(offset, windowId){
  const query = windowId !== undefined ? { windowId } : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  if (!tabs.length) return;

  const cur = tabs.findIndex(t=> t.active);
  let next = cur + offset;
  if (next >= tabs.length || next < 0) return;

  const target = tabs[next];
  if (target?.id) {
    last_tab = tabs[cur].id;
    await chrome.tabs.update(target.id, {active: true});
  }
}

async function openTabSearch() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !activeTab.url) return;
  if (isRestrictedUrl(activeTab.url)) return;

  await ensureContentScript(activeTab.id, activeTab.url);

  const tabs = await chrome.tabs.query({});
  const items = buildTabSearchItems(tabs, activeTab);

  chrome.tabs.sendMessage(activeTab.id, {
    type: "UTAB_TAB_SEARCH_OPEN",
    items
  }).catch(() => {});
}

async function activateTabById(tabId, windowId, sourceTabId) {
  if (typeof tabId !== "number") return;

  if (typeof sourceTabId === "number") {
    last_tab = sourceTabId;
  }

  if (typeof windowId === "number") {
    await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  }

  await chrome.tabs.update(tabId, { active: true });
}

function buildTabSearchItems(tabs, activeTab) {
  return tabs
    .filter(tab => typeof tab.id === "number" && typeof tab.windowId === "number")
    .sort((a, b) => compareSearchTabs(a, b, activeTab))
    .map(tab => ({
      id: tab.id,
      windowId: tab.windowId,
      title: formatTabSearchTitle(tab),
      url: tab.url ?? "",
      favIconUrl: tab.favIconUrl ?? "",
      active: Boolean(tab.active),
      currentWindow: tab.windowId === activeTab.windowId
    }));
}

function compareSearchTabs(a, b, activeTab) {
  const sameWindowDelta = Number(b.windowId === activeTab.windowId) - Number(a.windowId === activeTab.windowId);
  if (sameWindowDelta !== 0) return sameWindowDelta;

  const accessA = typeof a.lastAccessed === "number" ? a.lastAccessed : 0;
  const accessB = typeof b.lastAccessed === "number" ? b.lastAccessed : 0;
  if (accessA !== accessB) return accessB - accessA;

  if (a.windowId !== b.windowId) return a.windowId - b.windowId;
  return (a.index ?? 0) - (b.index ?? 0);
}

function formatTabSearchTitle(tab) {
  if (typeof tab.title === "string" && tab.title.trim()) return tab.title.trim();
  if (typeof tab.url !== "string" || !tab.url) return "Untitled tab";

  try {
    return new URL(tab.url).hostname || tab.url;
  } catch {
    return tab.url;
  }
}

async function ensureContentScript(tabId, tabUrl) {
  if (isRestrictedUrl(tabUrl)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["search_style.js", "content.js"],
      world: "ISOLATED"
    });
  } catch {
    // Injection is unavailable for some pages even after filtering.
  }
}

function isRestrictedUrl(url) {
  return /^(chrome|edge|about|chrome-extension):/i.test(url);
}

/**
 * Update the offset in events:
 * @onActivated When an active tab changes.
 * @onMoved When a tab is moved within an window, 
 *            not fired when other tabs move in response to
 *            the current moving tab.
 * @onAttached When a tab is attached to the current window
 *               from different window.
 * @onDetached When a tab is detached from the current window.
 * @onRemoved When a tab is removed.
 * @onFocusChanged When a focused window changes.
 */
const OFFSET_EVENTS = [
  chrome.tabs.onActivated,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.tabs.onRemoved,
  chrome.windows.onFocusChanged
];

let updateTimeout = null;
function scheduleUpdate() {
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    updateAll().catch(() => {});
  }, 100);
}

OFFSET_EVENTS.forEach(ev => ev.addListener(scheduleUpdate));
scheduleUpdate();

/**
 * Update function that handles offset calculation for all tabs.
 * Async computation through Promise.all() method.
 */
async function updateAll() {
  await overlayPreferencesReady;

  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.tabs) continue;
    const activeTab = win.tabs.find(t => t.active);
    if (!activeTab) continue;
    const currentIndex = activeTab.index;
    await Promise.all(win.tabs.map(t => handleOffset(t, currentIndex)));
  }
}

/**
 * Entry point for handling offset and composing overlay icons for all tabs.
 * Overlay icon is placed on top of the original favicon of the website.
 * @param t tab 
 * @param currentIndex index pointing to the active tab 
 * @sends to content side the formed overlay icon
 */
async function handleOffset(t, currentIndex){
  if (!t || !t.id) return;
  // Skip restricted or empty
  if (!t.url || /^(chrome|edge|about|chrome-extension):/i.test(t.url)) return;

  if(typeof currentIndex !== "number"){
    currentIndex = 0;
  }

  const offset = (typeof t.index === "number" ? t.index: 0) - currentIndex;

  const lastState = tab_state_cache.get(t.id);
  if (lastState && lastState.offset === offset && lastState.url === t.url) {
    return;
  }

  const baseHref = faviconURL(t.url).toString();

  let dataUrl = null;
  const text = formatOffset(offset);
  const badgeColor = getBadgeColor(offset);
  dataUrl = await composeIcon(baseHref, t.url, text, 32, badgeColor, overlayScale).catch(()=> null);

  tab_state_cache.set(t.id, { offset, url: t.url });
  chrome.tabs.sendMessage(t.id, { type: "OFFSET", offset, dataUrl }).catch(() => {});
}

/**
 * Format the offset into the key sequence.
 * @param n number (offset)
 * @returns corresponding key sequence
 */
function formatOffset(n) {
  return KEY_SEQUENCE[Math.abs(n)] ?? "";
}

function getBadgeColor(offset) {
  if (offset === 0) return CURRENT_BADGE_COLOR;
  return offset > 0 ? overlayColors.right : overlayColors.left;
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

async function loadOverlayPreferences() {
  try {
    const { overlayColors: storedColors, overlayScale: storedScale } = await chrome.storage.sync.get(["overlayColors", "overlayScale"]);
    overlayColors = sanitizeOverlayColors(storedColors);
    overlayScale = sanitizeOverlayScale(storedScale);
  } catch (error) {
    overlayColors = { ...DEFAULT_OVERLAY_COLORS };
    overlayScale = DEFAULT_OVERLAY_SCALE;
  }
}

/**
 * Grab favicon href through fetching to chrome.
 * @param tabId 
 * @returns href
 */
function faviconURL(u) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', u);
  url.searchParams.set('size', '32');
  return url;
}

/**
 * Draw base image + bottom-right badge; fetch is allowed by host_permissions.
 * Badge geometry stays fixed to match the current overlay icon.
 */ 
async function composeIcon(baseHref, pageUrl, offset, size, badgeColor = "#1e824c", badgeScale = DEFAULT_OVERLAY_SCALE) {
  const origin = new URL(pageUrl).origin;
  const normalizedScale = sanitizeOverlayScale(badgeScale);
  const composite = `${origin}_${offset}_${badgeColor}_${normalizedScale.toFixed(2)}`;

  if (composited_icon_cache.has(composite)){
    return await composited_icon_cache.get(composite);
  }

  const composePromise = (async () => {
    let bitmap = null;
    if (favicon_cache.has(origin)){
      bitmap = await favicon_cache.get(origin);
    }
    else{
      const fetchPromise = (async () => {
        try{
          const resp = await fetch(baseHref.toString(), { mode: "cors" });  // host_permissions
          const blob = await resp.blob();
          return await createImageBitmap(blob);
        } catch (e){
          return await loadDefaultFaviconBitmap();
        }
      })(); 
      favicon_cache.set(origin, fetchPromise);
      bitmap = await fetchPromise;
    }
    
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);

    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, size, size);
    } else {
      // neutral bg if favicon couldn't be fetched
      ctx.fillStyle = "#888";
      ctx.fillRect(0, 0, size, size);
    }

    const badgeGeometry = getBadgeGeometry(size, normalizedScale);
    let textX = badgeGeometry.centerX;
    if (offset === "i") textX += badgeGeometry.radius * 0.24;
    if (offset === "w") textX -= badgeGeometry.radius * 0.16;
    const textY = badgeGeometry.centerY + badgeGeometry.radius * 0.12;

    ctx.font = `bold ${badgeGeometry.fontPx}px system-ui, -apple-system, Segoe UI, Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    drawCircle(ctx, badgeGeometry);
    ctx.fillStyle = badgeColor;
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.fillText(offset, textX, textY);

    const blob = await canvas.convertToBlob({ type: "image/png" });
    // Convert blob to data URL
    const buf = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `data:image/png;base64,${base64}`;
  })();

  composited_icon_cache.set(composite, composePromise);
  return await composePromise;
}


/**
 * Draw a circle for overlay icon.
 * @param ctx canvas 
 */
function drawCircle(ctx, geometry) {
  ctx.beginPath();
  ctx.arc(geometry.centerX, geometry.centerY, geometry.radius, 0, 2 * Math.PI);
  ctx.closePath();
}

function getBadgeGeometry(size, scale) {
  const radius = size * 0.23125 * scale;
  const edgeMargin = size * 0.003125;
  const centerX = size - edgeMargin - radius;
  const centerY = size - edgeMargin - radius;

  return {
    centerX,
    centerY,
    radius,
    fontPx: size * 0.46875 * scale
  };
}

/**
 * Load default chrome favicon when favicon cannot be found.
 * Default favicon is obtained by fetching to chrome with empty url.
 * @returns bitmap of default favicon.
 */
let defaultFaviconPromise = null;

async function loadDefaultFaviconBitmap() {
  if (defaultFaviconPromise) return defaultFaviconPromise;

  defaultFaviconPromise = (async () => {
    try {
      const url = chrome.runtime.getURL("");
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`[UTAB] default icon fetch failed: ${resp.status} ${resp.statusText}`);
      }

      const blob = await resp.blob();
      return await createImageBitmap(blob);
    } catch (error) {
      defaultFaviconPromise = null;
      throw error;
    }
  })();

  return defaultFaviconPromise;
}
