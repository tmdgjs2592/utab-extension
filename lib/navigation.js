import { KEY_INDEX, CURRENT_BADGE_COLOR } from "./constants.js";
import { isRestrictedUrl, faviconURL, formatOffset } from "./utils.js";
import { getOverlayColors, getOverlayScale } from "./preferences.js";
import { composeIcon, clearCompositedIconCache, clearIconCaches } from "./icon.js";

const tab_state_cache = new Map();
const tab_favicon_source_cache = new Map();
let last_tab = null;
let active_context = null;
let active_context_reconcile = null;
let active_context_reconcile_pending = false;
let renderVersion = 0;

function getBadgeColor(offset) {
  if (offset === 0) return CURRENT_BADGE_COLOR;
  const colors = getOverlayColors();
  return offset > 0 ? colors.right : colors.left;
}

export async function ensureContentScript(tabId, tabUrl) {
  if (isRestrictedUrl(tabUrl)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["styles/search_style.js", "content.js"],
      world: "ISOLATED"
    });
  } catch {}
}

export async function jumpByOffset(offset, windowId) {
  const query = windowId !== undefined ? { windowId } : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  if (!tabs.length) return;

  const cur = tabs.findIndex(t => t.active);
  let next = cur + offset;
  if (next >= tabs.length || next < 0) return;

  const target = tabs[next];
  if (target?.id) {
    last_tab = tabs[cur].id;
    await chrome.tabs.update(target.id, { active: true });
  }
}

export function handleJumpMessage(msg, sender) {
  const idx = KEY_INDEX[msg.offset?.toLowerCase?.() ?? ""];
  if (typeof idx !== "number") return false;
  const offset = msg.neg ? idx : -idx;
  jumpByOffset(offset, sender.tab?.windowId);
}

export async function activateTabById(tabId, windowId, sourceTabId) {
  if (typeof tabId !== "number") return;
  if (typeof sourceTabId === "number") {
    last_tab = sourceTabId;
  }
  if (typeof windowId === "number") {
    await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true });
}

export function handleTabSearchActivate(msg, senderTabId) {
  if (msg.itemType === "bookmark" || msg.itemType === "google_search") {
    chrome.tabs.create({ url: msg.url }).catch(() => {});
  } else {
    activateTabById(msg.tabId, msg.windowId, senderTabId).catch(() => {});
  }
}

export async function handleJumpModeCommand(cmd) {
  const neg = cmd.endsWith("minus");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;
  if (isRestrictedUrl(tab.url)) return;
  await ensureContentScript(tab.id, tab.url);
  chrome.tabs.sendMessage(tab.id, { type: "UTAB_JUMP_MODE", neg }).catch(() => {});
}

export async function handleJumpBackCommand() {
  const [temp] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (last_tab != null) {
    const target = await chrome.tabs.get(last_tab).catch(() => null);
    if (target?.windowId != null) {
      await chrome.windows.update(target.windowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(last_tab, { active: true });
    last_tab = temp?.id ?? null;
  }
}

export async function initJumpBackTracking() {
  active_context = await getActiveContext()
}

export function handleTabActivated(activeInfo) {
  if (!activeInfo || typeof activeInfo.tabId !== "number" || typeof activeInfo.windowId !== "number") return
  scheduleActiveContextReconcile()
}

export async function handleWindowFocusChanged(windowId) {
  if (typeof windowId !== "number" || windowId === chrome.windows.WINDOW_ID_NONE) return
  return scheduleActiveContextReconcile()
}

export function invalidateJumpBackOnRemove(tabId) {
  if (tabId === last_tab) last_tab = null;
  if (active_context?.tabId === tabId) active_context = null;
  tab_state_cache.delete(tabId);
  tab_favicon_source_cache.delete(tabId);
}

async function getActiveContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [])
  if (!tab?.id || typeof tab.windowId !== "number") return null

  return {
    tabId: tab.id,
    windowId: tab.windowId
  }
}

async function reconcileActiveContext() {
  const nextContext = await getActiveContext()
  if (!nextContext) return

  if (
    active_context &&
    active_context.tabId === nextContext.tabId &&
    active_context.windowId === nextContext.windowId
  ) {
    return
  }

  if (typeof active_context?.tabId === "number" && active_context.tabId !== nextContext.tabId) {
    last_tab = active_context.tabId
  }

  active_context = nextContext
}

function scheduleActiveContextReconcile() {
  if (active_context_reconcile) {
    active_context_reconcile_pending = true
    return active_context_reconcile
  }

  const run = async () => {
    try {
      await reconcileActiveContext()
    } catch {}

    if (active_context_reconcile_pending) {
      active_context_reconcile_pending = false
      active_context_reconcile = run()
    } else {
      active_context_reconcile = null
    }

    return active_context_reconcile
  }

  active_context_reconcile = run()
  return active_context_reconcile
}

export async function handleOffset(t, currentIndex, keySequence) {
  if (!t || !t.id) return;
  if (!t.url || /^(chrome|edge|about|chrome-extension):/i.test(t.url)) return;

  if (typeof currentIndex !== "number") currentIndex = 0;
  const offset = (typeof t.index === "number" ? t.index : 0) - currentIndex;

  const baseHref = faviconURL(t.url).toString()
  const rawFavIconUrl = typeof t.favIconUrl === "string" && t.favIconUrl ? t.favIconUrl : ""
  const isCompositedDataUrl = rawFavIconUrl.startsWith("data:")
  const cachedFaviconSource = tab_favicon_source_cache.get(t.id)
  const cachedSourceForUrl = cachedFaviconSource?.url === t.url ? cachedFaviconSource.href : ""

  if (!isCompositedDataUrl && rawFavIconUrl) {
    tab_favicon_source_cache.set(t.id, { url: t.url, href: rawFavIconUrl })
  }

  // Once the content script swaps in our composited favicon, Chrome may expose that
  // data URL back through `tab.favIconUrl`. Ignore it, and keep using the first real
  // favicon URL we saw for the current page, so later resizes do not re-compose from
  // an already badged browser-cached variant.
  const fetchIdentity = cachedSourceForUrl || (isCompositedDataUrl ? baseHref : (rawFavIconUrl || baseHref))
  const stateIdentity = `${fetchIdentity}|${baseHref}`
  const lastState = tab_state_cache.get(t.id);
  if (
    lastState &&
    lastState.offset === offset &&
    lastState.url === t.url &&
    lastState.stateIdentity === stateIdentity
  ) {
    return;
  }

  const text = formatOffset(offset, keySequence);
  const badgeColor = getBadgeColor(offset);
  const currentRenderVersion = renderVersion
  const dataUrl = await composeIcon(baseHref, fetchIdentity, text, 32, badgeColor, getOverlayScale()).catch(() => null);

  if (currentRenderVersion !== renderVersion) {
    return
  }

  chrome.tabs.sendMessage(t.id, { type: "OFFSET", offset, dataUrl }).catch(() => {});
  tab_state_cache.set(t.id, { offset, url: t.url, stateIdentity });
}

export async function updateAll(keySequence) {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (!win.tabs) continue;
    const activeTab = win.tabs.find(t => t.active);
    if (!activeTab) continue;
    const currentIndex = activeTab.index;
    await Promise.all(win.tabs.map(t => handleOffset(t, currentIndex, keySequence)));
  }
}

let updatePromise = null;
let pendingUpdate = false;
export function scheduleUpdate(updateFn) {
  if (updatePromise) {
    pendingUpdate = true;
    return;
  }
  const run = async () => {
    try {
      await updateFn();
    } catch {}
    if (pendingUpdate) {
      pendingUpdate = false;
      updatePromise = run();
    } else {
      updatePromise = null;
    }
  };
  updatePromise = run();
}

export function clearCaches(options = {}) {
  renderVersion += 1
  if (options.includeFaviconCache) {
    clearIconCaches()
  } else {
    clearCompositedIconCache()
  }
  tab_state_cache.clear();
  tab_favicon_source_cache.clear();
}
