import { KEY_INDEX, CURRENT_BADGE_COLOR } from "./constants.js";
import { isRestrictedUrl, faviconURL, formatOffset } from "./utils.js";
import { getOverlayColors, getOverlayScale } from "./preferences.js";
import { composeIcon, clearCompositedIconCache, clearIconCaches, invalidateCachedIconSources } from "./icon.js";

const tab_state_cache = new Map();
const tab_favicon_source_cache = new Map();
const pending_favicon_tabs = new Set();
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

export function handleTabCreated(tab) {
  if (!tab?.id) return

  const tabUrl = getTrackableTabUrl({}, tab)
  beginTabFaviconLifecycle(tab.id, tabUrl, tab.favIconUrl ?? "")
}

export function handleTabUpdated(tabId, changeInfo = {}, tab) {
  if (typeof tabId !== "number") return false

  const tabUrl = getTrackableTabUrl(changeInfo, tab)
  const favIconUrl = changeInfo.favIconUrl ?? tab?.favIconUrl ?? ""
  const isLoading = changeInfo.status === "loading"
  const urlChanged = typeof changeInfo.url === "string"
  const faviconChanged = Object.prototype.hasOwnProperty.call(changeInfo, "favIconUrl")

  if (isLoading || urlChanged) {
    beginTabFaviconLifecycle(tabId, tabUrl, favIconUrl)
    if (isLoading) {
      return false
    }
  }

  if (!tabUrl || isRestrictedUrl(tabUrl)) {
    pending_favicon_tabs.delete(tabId)
    return false
  }

  if (faviconChanged) {
    invalidateTabRenderState(tabId, { tabUrl, favIconUrl })
  }

  if (!pending_favicon_tabs.has(tabId) && !faviconChanged) {
    return false
  }

  const tabComplete = changeInfo.status === "complete" || tab?.status === "complete"
  if (!tabComplete) {
    return false
  }

  pending_favicon_tabs.delete(tabId)
  return true
}

export async function handleWindowFocusChanged(windowId) {
  if (typeof windowId !== "number" || windowId === chrome.windows.WINDOW_ID_NONE) return
  return scheduleActiveContextReconcile()
}

export function invalidateJumpBackOnRemove(tabId) {
  if (tabId === last_tab) last_tab = null;
  if (active_context?.tabId === tabId) active_context = null;
  pending_favicon_tabs.delete(tabId)
  invalidateTabRenderState(tabId);
}

export function invalidateTabRenderState(tabId, options = {}) {
  const cachedFaviconSource = tab_favicon_source_cache.get(tabId)
  const sourcesToInvalidate = []

  if (cachedFaviconSource?.href) {
    sourcesToInvalidate.push(cachedFaviconSource.href)
  }

  if (typeof options.tabUrl === "string" && options.tabUrl) {
    sourcesToInvalidate.push(faviconURL(options.tabUrl).toString())
  }

  if (typeof options.favIconUrl === "string" && options.favIconUrl && !options.favIconUrl.startsWith("data:")) {
    sourcesToInvalidate.push(options.favIconUrl)
  }

  invalidateCachedIconSources(sourcesToInvalidate)
  tab_state_cache.delete(tabId)
  tab_favicon_source_cache.delete(tabId)
}

/**
 * track life cycle on new tabs.
 * Entry point to handling tab updated.
 */
function beginTabFaviconLifecycle(tabId, tabUrl, favIconUrl = "") {
  if (typeof tabId !== "number" || !tabUrl || isRestrictedUrl(tabUrl)) {
    pending_favicon_tabs.delete(tabId)
    return false
  }

  pending_favicon_tabs.add(tabId)
  invalidateTabRenderState(tabId, { tabUrl, favIconUrl })
  return true
}

function getTrackableTabUrl(changeInfo = {}, tab) {
  if (typeof changeInfo.url === "string" && changeInfo.url) return changeInfo.url
  if (typeof tab?.pendingUrl === "string" && tab.pendingUrl) return tab.pendingUrl
  if (typeof tab?.url === "string" && tab.url) return tab.url
  return ""
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
  const { href: fetchIdentity, isReady } = await resolveFaviconSource(
    t.id,
    t.url,
    rawFavIconUrl,
    isCompositedDataUrl,
    baseHref,
    t.status
  )

  if (!isReady) {
    tab_state_cache.delete(t.id)
    return
  }

  // Once the content script swaps in our composited favicon, Chrome may expose that
  // data URL back through `tab.favIconUrl`. Ignore it, and keep using the first real
  // favicon URL we saw for the current page, so later resizes do not re-compose from
  // an already badged browser-cached variant.
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

async function resolveFaviconSource(tabId, tabUrl, rawFavIconUrl, isCompositedDataUrl, baseHref, tabStatus) {
  const cachedFaviconSource = tab_favicon_source_cache.get(tabId)
  const cachedSourceForUrl = cachedFaviconSource?.url === tabUrl ? cachedFaviconSource.href : ""
  if (cachedSourceForUrl) {
    return { href: cachedSourceForUrl, isReady: true }
  }

  if (!isCompositedDataUrl && rawFavIconUrl) {
    tab_favicon_source_cache.set(tabId, { url: tabUrl, href: rawFavIconUrl })
    return { href: rawFavIconUrl, isReady: true }
  }

  const pageSourceHref = await readOriginalFaviconSourceFromPage(tabId)
  if (pageSourceHref) {
    tab_favicon_source_cache.set(tabId, { url: tabUrl, href: pageSourceHref })
    return { href: pageSourceHref, isReady: true }
  }

  if (tabStatus === "loading") {
    return { href: baseHref, isReady: false }
  }

  return {
    href: isCompositedDataUrl ? baseHref : (rawFavIconUrl || baseHref),
    isReady: true
  }
}

async function readOriginalFaviconSourceFromPage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "UTAB_GET_FAVICON_SOURCE" })
    return typeof response?.href === "string" && response.href && !response.href.startsWith("data:")
      ? response.href
      : ""
  } catch {
    return ""
  }
}

export async function updateAll(keySequence) {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    await updateTabsInWindow(win.tabs, keySequence)
  }
}

export async function updateWindow(windowId, keySequence) {
  if (typeof windowId !== "number") return

  const win = await chrome.windows.get(windowId, { populate: true }).catch(() => null)
  await updateTabsInWindow(win?.tabs, keySequence)
}

export async function updateTab(tabId, keySequence) {
  if (typeof tabId !== "number") return

  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab?.id || typeof tab.windowId !== "number") return

  const currentIndex = await getWindowActiveIndex(tab.windowId)
  if (typeof currentIndex !== "number") return

  await handleOffset(tab, currentIndex, keySequence)
}

async function updateTabsInWindow(tabs, keySequence) {
  if (!Array.isArray(tabs) || !tabs.length) return

  const activeTab = tabs.find(t => t.active)
  if (!activeTab) return

  const currentIndex = activeTab.index
  await Promise.all(tabs.map(t => handleOffset(t, currentIndex, keySequence)))
}

let updatePromise = null;
let pendingUpdate = false;
let updateDebounceTimer = null;
let scheduledKeySequence = null;
let scheduledUpdateScope = createScheduledUpdateScope();

export function scheduleAllUpdate(keySequence) {
  scheduledKeySequence = keySequence
  scheduledUpdateScope = {
    all: true,
    windowIds: new Set(),
    tabIds: new Set()
  }
  schedulePendingUpdates()
}

export function scheduleWindowUpdate(windowId, keySequence) {
  if (typeof windowId !== "number") return

  scheduledKeySequence = keySequence
  if (!scheduledUpdateScope.all) {
    scheduledUpdateScope.windowIds.add(windowId)
  }
  schedulePendingUpdates()
}

export function scheduleTabUpdate(tabId, keySequence) {
  if (typeof tabId !== "number") return

  scheduledKeySequence = keySequence
  if (!scheduledUpdateScope.all) {
    scheduledUpdateScope.tabIds.add(tabId)
  }
  schedulePendingUpdates()
}

function schedulePendingUpdates() {
  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer);
  }
  updateDebounceTimer = setTimeout(() => {
    updateDebounceTimer = null;
    if (updatePromise) {
      pendingUpdate = true;
      return;
    }
    const run = async () => {
      try {
        await flushScheduledUpdates();
      } catch {}
      if (pendingUpdate) {
        pendingUpdate = false;
        updatePromise = run();
      } else {
        updatePromise = null;
      }
    };
    updatePromise = run();
  }, 50);
}

async function flushScheduledUpdates() {
  const keySequence = scheduledKeySequence
  if (!keySequence) return

  const request = scheduledUpdateScope
  scheduledUpdateScope = createScheduledUpdateScope()

  if (request.all) {
    await updateAll(keySequence)
    return
  }

  const updatedWindowIds = new Set(request.windowIds)
  const activeIndexByWindow = new Map()
  await Promise.all([...updatedWindowIds].map((windowId) => updateWindow(windowId, keySequence)))

  await Promise.all([...request.tabIds].map(async (tabId) => {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab?.id || updatedWindowIds.has(tab.windowId)) return

    const currentIndex = await getCachedWindowActiveIndex(tab.windowId, activeIndexByWindow)
    if (typeof currentIndex !== "number") return

    await handleOffset(tab, currentIndex, keySequence)
  }))
}

async function getWindowActiveIndex(windowId) {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId }).catch(() => [])
  return typeof activeTab?.index === "number" ? activeTab.index : null
}

async function getCachedWindowActiveIndex(windowId, cache) {
  if (cache.has(windowId)) {
    return cache.get(windowId)
  }

  const currentIndex = await getWindowActiveIndex(windowId)
  cache.set(windowId, currentIndex)
  return currentIndex
}

function createScheduledUpdateScope() {
  return {
    all: false,
    windowIds: new Set(),
    tabIds: new Set()
  }
}

export function clearCaches(options = {}) {
  renderVersion += 1
  scheduledUpdateScope = createScheduledUpdateScope()
  scheduledKeySequence = null
  pendingUpdate = false
  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer)
    updateDebounceTimer = null
  }
  if (options.includeFaviconCache) {
    clearIconCaches()
  } else {
    clearCompositedIconCache()
  }
  tab_state_cache.clear();
  tab_favicon_source_cache.clear();
}
