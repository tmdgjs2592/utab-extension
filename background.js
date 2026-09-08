import { KEY_SEQUENCE } from "./lib/constants.js";
import { initPreferences, applyOverlayPreferences, getOverlayEnabled } from "./lib/preferences.js";
import { clearCaches, handleJumpMessage, handleTabSearchActivate, handleJumpModeCommand, handleJumpBackCommand, handleTabActivated, handleTabCreated, handleTabUpdated, handleWindowFocusChanged, initJumpBackTracking, invalidateJumpBackOnRemove, scheduleAllUpdate, scheduleTabUpdate, scheduleWindowUpdate } from "./lib/navigation.js";
import { openTabSearch } from "./lib/search.js";
import { isRestrictedUrl } from "./lib/utils.js";

const overlayPreferencesReady = initPreferences();

async function ensureOffscreenDocument() {
  try {
    if (typeof chrome.runtime.getContexts === "function") {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      if (contexts.length > 0) return;
    }
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Keep service worker responsive for keyboard commands"
    });
  } catch {}
}

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
  initJumpBackTracking().catch(() => {})
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return

  let shouldRefresh = false
  if (changes.overlayEnabled) {
    applyOverlayPreferences({ overlayEnabled: changes.overlayEnabled.newValue })
    shouldRefresh = true
  }
  if (changes.overlayColors) {
    applyOverlayPreferences({ overlayColors: changes.overlayColors.newValue })
    shouldRefresh = true
  }
  if (changes.overlayScale) {
    applyOverlayPreferences({ overlayScale: changes.overlayScale.newValue })
    shouldRefresh = true
  }
  if (!shouldRefresh) return

  clearCaches()
  if (getOverlayEnabled()) {
    scheduleAllUpdate(KEY_SEQUENCE)
  } else {
    clearAllOffsets()
  }
})

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
  handleRuntimeMessage(msg, sender).then(sendResponse)
  return true
})

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  invalidateJumpBackOnRemove(tabId)
  if (removeInfo?.isWindowClosing) return
  refreshWindowOffsetsIfAllowed(removeInfo?.windowId).catch(() => {})
});
chrome.tabs.onActivated.addListener((activeInfo) => {
  handleTabActivated(activeInfo)
  refreshWindowOffsetsIfAllowed(activeInfo?.windowId).catch(() => {})
});
chrome.tabs.onCreated.addListener((tab) => {
  handleTabCreated(tab)
  refreshWindowOffsetsIfAllowed(tab?.windowId).catch(() => {})
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!handleTabUpdated(tabId, changeInfo, tab)) return
  refreshTabOffsetIfAllowed(tabId).catch(() => {})
});
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  refreshWindowOffsetsIfAllowed(moveInfo?.windowId).catch(() => {})
});
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  refreshWindowOffsetsIfAllowed(attachInfo?.newWindowId).catch(() => {})
});
chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  refreshWindowOffsetsIfAllowed(detachInfo?.oldWindowId).catch(() => {})
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  handleWindowFocusChanged(windowId).catch(() => {})
});
ensureOffscreenDocument().catch(() => {});
initJumpBackTracking().catch(() => {})
refreshAllOffsetsIfAllowed().then((didRefresh) => {
  if (!didRefresh) {
    clearAllOffsets()
  }
});

async function handleRuntimeMessage(msg, sender) {
  if (msg?.type === "KEEP_ALIVE") {
    return { ok: true }
  }

  if (msg?.type === "UTAB_JUMP") {
    handleJumpMessage(msg, sender)
    return { ok: true }
  }

  if (msg?.type === "UTAB_TAB_SEARCH_ACTIVATE") {
    handleTabSearchActivate(msg, sender.tab?.id)
    return { ok: true }
  }

  return { ok: false, reason: "unknown_message" }
}

async function refreshAllOffsetsIfAllowed() {
  return scheduleScopedRefresh(() => {
    scheduleAllUpdate(KEY_SEQUENCE)
  })
}

async function refreshWindowOffsetsIfAllowed(windowId) {
  if (typeof windowId !== "number") return false

  return scheduleScopedRefresh(() => {
    scheduleWindowUpdate(windowId, KEY_SEQUENCE)
  })
}

async function refreshTabOffsetIfAllowed(tabId) {
  if (typeof tabId !== "number") return false

  return scheduleScopedRefresh(() => {
    scheduleTabUpdate(tabId, KEY_SEQUENCE)
  })
}

async function scheduleScopedRefresh(scheduleFn) {
  if (!getOverlayEnabled()) return false

  scheduleFn()
  return true
}

function clearAllOffsets() {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (!t.id) continue;
      chrome.tabs.sendMessage(t.id, { type: "CLEAR_OFFSET" }).catch(() => {});
      if (!t.url || isRestrictedUrl(t.url)) continue;
      chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: clearInjectedOffsetFavicon
      }).catch(() => {});
    }
  })
}

function clearInjectedOffsetFavicon() {
  const originalFaviconAttr = "data-utab-original-favicon-hrefs"
  document.querySelectorAll('link[data-utab-injected="true"]').forEach((element) => element.remove())

  const stored = document.documentElement?.getAttribute(originalFaviconAttr)
  if (!stored || !document.head) {
    document.documentElement?.removeAttribute(originalFaviconAttr)
    return
  }

  try {
    const hrefs = JSON.parse(stored)
    if (Array.isArray(hrefs)) {
      hrefs.filter((href) => typeof href === "string" && href).forEach((href) => {
        const link = document.createElement("link")
        link.rel = "icon"
        link.href = href
        document.head.appendChild(link)
      })
    }
  } catch {}

  document.documentElement?.removeAttribute(originalFaviconAttr)
}
