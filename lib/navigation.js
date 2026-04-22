import { KEY_INDEX, CURRENT_BADGE_COLOR } from "./constants.js";
import { isRestrictedUrl, faviconURL, formatOffset } from "./utils.js";
import { getOverlayColors, getOverlayScale } from "./preferences.js";
import { composeIcon, clearIconCaches } from "./icon.js";

const tab_state_cache = new Map();
let last_tab = null;

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
  return true;
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
  return true;
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

export function invalidateJumpBackOnRemove(tabId) {
  if (tabId === last_tab) last_tab = null;
  tab_state_cache.delete(tabId);
}

export async function handleOffset(t, currentIndex, keySequence) {
  if (!t || !t.id) return;
  if (!t.url || /^(chrome|edge|about|chrome-extension):/i.test(t.url)) return;

  if (typeof currentIndex !== "number") currentIndex = 0;
  const offset = (typeof t.index === "number" ? t.index : 0) - currentIndex;

  const lastState = tab_state_cache.get(t.id);
  if (lastState && lastState.offset === offset && lastState.url === t.url) {
    return;
  }

  const baseHref = faviconURL(t.url).toString();
  const text = formatOffset(offset, keySequence);
  const badgeColor = getBadgeColor(offset);
  const dataUrl = await composeIcon(baseHref, t.url, text, 32, badgeColor, getOverlayScale()).catch(() => null);

  tab_state_cache.set(t.id, { offset, url: t.url });
  chrome.tabs.sendMessage(t.id, { type: "OFFSET", offset, dataUrl }).catch(() => {});
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

let updateTimeout = null;
export function scheduleUpdate(updateFn) {
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    updateFn().catch(() => {});
  }, 100);
}

export function clearCaches() {
  clearIconCaches();
  tab_state_cache.clear();
}
