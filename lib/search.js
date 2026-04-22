import { isRestrictedUrl, faviconURL } from "./utils.js";
import { ensureContentScript } from "./navigation.js";

export async function openTabSearch() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !activeTab.url) return;
  if (isRestrictedUrl(activeTab.url)) return;

  await ensureContentScript(activeTab.id, activeTab.url);

  const tabs = await chrome.tabs.query({});
  let bookmarks = [];
  try {
    const bookmarkTree = await chrome.bookmarks.getTree();
    bookmarks = flattenBookmarks(bookmarkTree);
  } catch (e) {
    console.error("Failed to fetch bookmarks", e);
  }

  const items = buildSearchItems(tabs, bookmarks, activeTab);
  chrome.tabs.sendMessage(activeTab.id, { type: "UTAB_TAB_SEARCH_OPEN", items }).catch(() => {});
}

function flattenBookmarks(nodes, result = []) {
  for (const node of nodes) {
    if (node.url) result.push(node);
    if (node.children) flattenBookmarks(node.children, result);
  }
  return result;
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

function buildSearchItems(tabs, bookmarks, activeTab) {
  const tabItems = tabs
    .filter(tab => typeof tab.id === "number" && typeof tab.windowId === "number")
    .sort((a, b) => compareSearchTabs(a, b, activeTab))
    .map(tab => ({
      itemType: "tab",
      id: tab.id,
      windowId: tab.windowId,
      title: formatTabSearchTitle(tab),
      url: tab.url ?? "",
      favIconUrl: tab.favIconUrl ?? "",
      active: Boolean(tab.active),
      currentWindow: tab.windowId === activeTab.windowId
    }));

  const bookmarkItems = bookmarks.map(bm => ({
    itemType: "bookmark",
    id: bm.id,
    title: bm.title || formatTabSearchTitle({ url: bm.url }),
    url: bm.url,
    favIconUrl: faviconURL(bm.url).toString(),
    active: false,
    currentWindow: false
  }));

  return [...tabItems, ...bookmarkItems];
}