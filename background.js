import { KEY_SEQUENCE, OFFSET_EVENTS } from "./lib/constants.js";
import { initPreferences, getOverlayColors, sanitizeOverlayColors, normalizeOverlayScale } from "./lib/preferences.js";
import { clearCaches, handleJumpMessage, handleTabSearchActivate, handleJumpModeCommand, handleJumpBackCommand, invalidateJumpBackOnRemove, scheduleUpdate, updateAll } from "./lib/navigation.js";
import { openTabSearch } from "./lib/search.js";

const overlayPreferencesReady = initPreferences();

async function ensureOffscreenDocument() {
  try {
    if (typeof chrome.runtime.getContexts === "function") {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      if (contexts.length > 0) return;
    }
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Keep service worker responsive for keyboard commands"
    });
  } catch {}
}

chrome.runtime.onInstalled.addListener(async () => {
  ensureOffscreenDocument().catch(() => {});
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    if (/^(chrome|edge|about|chrome-extension):/i.test(t.url)) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id },
        files: ["content.js"],
        world: "ISOLATED"
      });
    } catch {}
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  let shouldRefresh = false;
  if (changes.overlayColors) {
    sanitizeOverlayColors(changes.overlayColors.newValue);
    shouldRefresh = true;
  }
  if (changes.overlayScale) {
    normalizeOverlayScale(changes.overlayScale.newValue);
    shouldRefresh = true;
  }
  if (!shouldRefresh) return;
  clearCaches();
  scheduleUpdate(() => updateAll(KEY_SEQUENCE));
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "utab-jump-mode-plus" || cmd === "utab-jump-mode-minus") {
    await handleJumpModeCommand(cmd);
  } else if (cmd === "utab-jump-back") {
    await handleJumpBackCommand();
  } else if (cmd === "utab-search") {
    await openTabSearch();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "KEEP_ALIVE") {
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "UTAB_JUMP") {
    handleJumpMessage(msg, sender);
  }
  if (msg?.type === "UTAB_TAB_SEARCH_ACTIVATE") {
    handleTabSearchActivate(msg, sender.tab?.id);
  }
});

chrome.tabs.onRemoved.addListener(invalidateJumpBackOnRemove);

OFFSET_EVENTS.forEach(ev => ev.addListener(() => scheduleUpdate(() => updateAll(KEY_SEQUENCE))));
ensureOffscreenDocument().catch(() => {});
scheduleUpdate(() => updateAll(KEY_SEQUENCE));
