let lastDataUrl = null;
let lastPrefixText = "";
let originalIcons = []; // store originals so we can restore
let jumpMode = false;
let neg = false;
let timer = null;
const preferSize = 32; 

chrome.runtime.onMessage.addListener(async (msg) =>{
  if (!msg.type) return;
  if (msg?.type === "UTAB_ENTER_JUMP_MODE_PLUS" || msg?.type === "UTAB_ENTER_JUMP_MODE_MINUS") {
    neg = msg.type.endsWith("MINUS");
    jumpMode = true;
    clearTimeout(timer);
    timer = setTimeout(() => exitMode(), 2500); // auto-exit after 2.5s
  }
  
  else if(msg?.type === "OFFSET"){
    handleOffset(msg.offset).catch(() => {});
  }
})

// Listen for keydown when in jump mode
window.addEventListener("keydown", (e) => {
  if(!jumpMode) return;
  if (/^[1-9]$/.test(e.key)){
    const offset = neg? +parseInt(e.key): -parseInt(e.key);
    chrome.runtime.sendMessage({ type: "UTAB_JUMP_BY", offset});
    exitMode();
  } else if (e.key === "Escape"){
    exitMode();
  }
});

function exitMode(){
  jumpMode = false;
  neg = false;
  clearTimeout(timer);
}

// Listen for offset from background
async function handleOffset(offset){

  const text = formatOffset(offset);
  lastPrefixText = text;

  const href = getBestFaviconHref();
  if (!href) return;

  const badgeColor = offset === 0 ? "#555"  : (offset > 0 ? "#1e824c" : "#b25a00");

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
};

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
