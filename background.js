const BASE_HREF_BY_TAB = new Map();   // tabId -> original http(s) href
const BASE_BITMAP_BY_HREF = new Map(); // href -> ImageBitmap (decoded once)

const KEY_SEQUENCE = [
  "1","2","3","4","5","6","7","8","9","0",
  "q","w","e","r","t","y","u","i","o","p",
  "a","s","d","f","g","h","j","k","l",
  "z","x","c","v","b","n","m"
];

// For reverse lookup
const KEY_INDEX = Object.fromEntries(KEY_SEQUENCE.map((k, i) => [k, i]));

// Clean up when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  BASE_HREF_BY_TAB.delete(tabId);
});

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
    } catch (e) {
      console.log("Content script failed: ", e);
    }
  }
});

/**
 * Listen for jump mode.
 * Parse for the direction and send the message to the tab.
 * @cmd comes from the shortcut (Ctrl + U/I).
 */
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "utab-jump-mode-plus" || cmd === "utab-jump-mode-minus") {
    // Ask the current page to start listening for digits
    const cmds = cmd.split("-");
    const symb = cmds[cmds.length -1];
    const message = "UTAB_ENTER_JUMP_MODE_" + symb.toUpperCase();
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => tab && chrome.tabs.sendMessage(tab.id, { type: message}));
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "UTAB_JUMP_BY_NEG" || msg?.type === "UTAB_JUMP_BY_POS") {
    console.log("HI");
    const neg = msg.type.endsWith("NEG")? true:false;
    const idx = KEY_INDEX[msg.offset?.toLowerCase?.() ?? ""] + 1;
    const offset = neg? idx: -idx;
    console.log(offset);
    jumpByOffset(offset);
    return true; // async
  }
});

/**
 * function to switch the current tab by the specified offset
 * @param: offset
 * @result update the current tab
 */
async function jumpByOffset(offset){
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (!tabs.length) return;

  const cur = tabs.findIndex(t=> t.active);
  let next = cur + offset;
  if (next >= tabs.length || next < 0) return;

  const target = tabs[next];
  if (target?.id) {
    await chrome.tabs.update(target.id, {active: true});
  }
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
OFFSET_EVENTS.forEach(ev => ev.addListener(() => updateAll().catch(() => {})));


/**
 * Update function that handles offset calculation for all tabs.
 * Async computation through Promise.all() method.
 */
async function updateAll() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return;
  const currentIndex = active.index;
  const tabs = await chrome.tabs.query({ currentWindow: true });

  await Promise.all(tabs.map(t => handleOffset(t, currentIndex)));
}

/**
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
  const baseHref = await getBaseFaviconHref(t).catch(() => null);

  let dataUrl = null;
  if(baseHref){
    const text = formatOffset(offset);
    const badgeColor = offset === 0 ? "#555" : (offset > 0 ? "#1e824c" : "#b25a00");
    dataUrl = await composeIcon(baseHref, text, 32, badgeColor).catch(() => null);
  }
  else{
    console.log("FAVICON not found");
  }

  chrome.tabs.sendMessage(t.id, { type: "OFFSET", offset, dataUrl }).catch(() => {});
}

/**
 * 
 * @param n number (offset)
 * @returns corresponding key sequence
 */
function formatOffset(n) {
  return KEY_SEQUENCE[Math.abs(n)];
}

async function getBaseFaviconHref(tab) {
  // Reuse if we already found the real base for this tab
  if (BASE_HREF_BY_TAB.has(tab.id)) return BASE_HREF_BY_TAB.get(tab.id);

  // If Chrome reports chrome://favicon... or a data: URL (our overlay),
  // ask the page for its <link rel="icon">
  const href = await queryPageFaviconHref(tab.id).catch(() => null);
  if (href) {
    BASE_HREF_BY_TAB.set(tab.id, href);
    return href;
  }

  return null;
}

async function queryPageFaviconHref(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        const links = [...document.querySelectorAll('link[rel~="icon"]')];
        if (links.length === 0) return null;
        // pick largest if sizes present
        let best = links[0], bestSize = 0;
        for (const l of links) {
          const sizes = (l.getAttribute("sizes") || "").split(/\s+/)
            .map(s => { const m = /^(\d+)x\1$/.exec(s); return m ? +m[1] : 0; });
          const max = Math.max(0, ...sizes);
          if (max > bestSize) { best = l; bestSize = max; }
        }
        const href = best.getAttribute("href") || "/favicon.ico";
        return new URL(href, location.href).href; // absolutize
      } catch { return null; }
    }
  });
  return result || null;
}

// Draw base image + bottom-right badge; fetch is allowed by host_permissions
async function composeIcon(baseHref, text, size, badgeColor = "#1e824c") {
  // let bitmap = BASE_BITMAP_BY_HREF.get(baseHref);
  try{
    const resp = await fetch(baseHref, { mode: "cors" });  // host_permissions required
    const blob = await resp.blob();
    bitmap = await createImageBitmap(blob);
    BASE_BITMAP_BY_HREF.set(baseHref, bitmap);
  } catch (e){
    console.log("Fetching for ", baseHref, "failed: ", e);
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

  // Badge geometry
  const pad = Math.max(1, Math.round(size * 0.08));
  const fontPx = 16; //Math.max(8, Math.floor(size * 0.55));
  ctx.font = `bold ${fontPx}px system-ui, -apple-system, Segoe UI, Arial`;
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const textH = fontPx;

  const badgeW = Math.ceil(textW + pad * 2);
  const badgeH = Math.ceil(textH + pad * 0.9);
  const x = size - badgeW - 1;
  const y = size - badgeH - 1;

  roundRect(ctx, x, y, badgeW, badgeH);
  ctx.fillStyle = badgeColor;
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + (badgeW - textW) / 1.1, y + badgeH / 1.5);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  // Convert blob to data URL
  const buf = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `data:image/png;base64,${base64}`;
}

function roundRect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.arc(x+w/1.5, y+h/1.5, w/2.3, 0, 2 * Math.PI);
  ctx.closePath();
}
