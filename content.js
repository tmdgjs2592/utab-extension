let lastDataUrl = null;
let lastPrefixText = "";
let originalIcons = []; // store originals so we can restore
const preferSize = 32;  // good balance for most favicons

// Listen for offset from background
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "OFFSET") return;

  const text = formatOffset(msg.offset);
  lastPrefixText = text;

  const href = getBestFaviconHref();
  if (!href) return;

  const badgeColor = msg.offset === 0 ? "#555"  : (msg.offset > 0 ? "#1e824c" : "#b25a00");

  const { ok, dataUrl } = await chrome.runtime.sendMessage({
    type: "COMPOSE_FAVICON",
    faviconHref: new URL(href, location.href).href,
    text,
    preferSize,
    badgeColor,
  });

  if (!ok || !dataUrl) return;

  // Swap the page's favicon to our composed data URL
  if (lastDataUrl && lastDataUrl !== dataUrl) URL.revokeObjectURL(lastDataUrl);
  lastDataUrl = dataUrl;
  ensureOriginalsSaved();
  setFavicon(dataUrl);
});

// If SPA changes/replaces the icon, reapply our overlay quickly
const headObserver = new MutationObserver(() => {
  if (lastPrefixText && !isOurFaviconApplied()) {
    // trigger recompute by asking background again (cheap)
    // chrome.runtime.sendMessage({ ping: "reapply" }).catch(() => {});
  }
});
headObserver.observe(document.documentElement, { subtree: true, childList: true });

function formatOffset(n) {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  return abs <= 9 ? `${abs}` : (n > 0 ? `${String.fromCharCode('a'.charCodeAt(0) + n - 10 - 1)}` 
                            : `${String.fromCharCode('a'.charCodeAt(0) + n - 10 - 1)}`);
}

function getBestFaviconHref() {
  const links = [...document.querySelectorAll('link[rel~="icon"]')];
  if (links.length === 0) return "/favicon.ico";

  // pick the largest sized icon if sizes attribute exists
  let best = links[0];
  let bestSize = 0;
  for (const l of links) {
    const sizes = (l.getAttribute("sizes") || "").split(/\s+/).map(s => {
      const m = /^(\d+)x\1$/.exec(s);
      return m ? parseInt(m[1], 10) : 0;
    });
    const max = Math.max(0, ...sizes);
    if (max > bestSize) { best = l; bestSize = max; }
  }
  return best.getAttribute("href") || "/favicon.ico";
}

function ensureOriginalsSaved() {
  if (originalIcons.length) return;
  originalIcons = [...document.querySelectorAll('link[rel~="icon"]')].map(l => ({
    el: l,
    href: l.getAttribute("href"),
    type: l.getAttribute("type") || "",
    sizes: l.getAttribute("sizes") || ""
  }));
}

function setFavicon(href) {
  // Remove existing icons
  document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove());
  // Add our icon
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = href;
  document.head.appendChild(link);
}

function isOurFaviconApplied() {
  const link = document.querySelector('link[rel~="icon"]');
  return !!(link && link.href && link.href.startsWith("data:image/png"));
}

// Optional: restore originals on unload (not strictly necessary)
window.addEventListener("beforeunload", () => {
  if (!originalIcons.length) return;
  document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove());
  for (const { href, type, sizes } of originalIcons) {
    const l = document.createElement("link");
    l.rel = "icon"; if (type) l.type = type; if (sizes) l.sizes = sizes; l.href = href;
    document.head.appendChild(l);
  }
});
