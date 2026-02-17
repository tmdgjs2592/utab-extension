const KEY_SEQUENCE = [
  "0","1","2","3","4","5","6","7","8","9",
  "q","w","e","r","t","y","u","i","o","p",
  "a","s","d","f","g","h","j","k","l",
  "z","x","c","v","b","n","m"
];
const KEY_INDEX = Object.fromEntries(KEY_SEQUENCE.map((k, i) => [k, i]));
let local = false;
let local_str = "file:///";
let jumpWinId = null;
let neg = false;
let last_tab = false;

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
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "utab-jump-mode-plus" || cmd === "utab-jump-mode-minus") {

    neg = cmd.endsWith("minus");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id || !tab.url) return;
    if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url)) return;

    if(!local){
      // Ask the current page to start listening for digits
      const message = "UTAB_JUMP_MODE";
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => tab && chrome.tabs.sendMessage(tab.id, { type: message, neg: neg}));
    }
    else{
      const w = await chrome.windows.create({
        url: chrome.runtime.getURL("keycap.html"),
        type: "popup",
        focused: true,
        width: 260,
        height: 90,
        left: 20,
        top: 20
      });

      jumpWinId = w.id;

      if (jumpWinId != null) {
        try {
          await chrome.windows.update(jumpWinId, { focused: true });
          chrome.runtime.sendMessage({ type: "PANEL_ARM"}).catch(() => {});
          return;
        } catch {
          jumpWinId = null;
        }
      }
    }
  }
  else if (cmd === "utab-jump-back"){
    const [temp] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.update(last_tab, {active: true});
    last_tab = temp.id;
  }
});

/**
 * Listen for offset and switch the current tab by the amount.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "UTAB_JUMP") {
    const idx = KEY_INDEX[msg.offset?.toLowerCase?.() ?? ""];
    const offset = neg? idx: -idx;
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
    last_tab = tabs[cur].id;
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
  if (active.url.startsWith(local_str)) local = true;
  else local = false;
  const tabs = await chrome.tabs.query({ currentWindow: true });

  await Promise.all(tabs.map(t => handleOffset(t, currentIndex)));
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
  const urls = t.url.split("/");
  const url = grabURL(urls);
  const baseHref = faviconURL(t.url);

  let dataUrl = null;
  const text = formatOffset(offset);
  const badgeColor = offset === 0 ? "#555" : (offset > 0 ? "#1e824c" : "#b25a00");
  dataUrl = await composeIcon(baseHref, text, 32, badgeColor).catch(()=> null);

  chrome.tabs.sendMessage(t.id, { type: "OFFSET", offset, dataUrl }).catch(() => {});
}

/**
 * Grab the url, excluding url parameters to fetch for the correct favicon
 * @param urls url split on /
 * @returns current url without the url parameters
 */
function grabURL(urls){
  for(const url of urls){
    if(url.endsWith("com")){
      return url;
    }
  }
}

/**
 * Format the offset into the key sequence.
 * @param n number (offset)
 * @returns corresponding key sequence
 */
function formatOffset(n) {
  return KEY_SEQUENCE[Math.abs(n)];
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
  return url.toString();
}

/**
 * Draw base image + bottom-right badge; fetch is allowed by host_permissions
 * Geometry is hard-coded for now, update it to dynamic setting
 */ 
async function composeIcon(baseHref, text, size, badgeColor = "#1e824c") {
  let bitmap = null;
  try{
    const resp = await fetch(baseHref, { mode: "cors" });  // host_permissions
    const blob = await resp.blob();
    bitmap = await createImageBitmap(blob);
  } catch (e){
    bitmap = await loadDefaultFaviconBitmap();
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
  // TODO: let user change dynamically to their liking
  const fontPx = 15; 
  
  let x = 20;
  if(text === 'i') x+=2.5;
  if(text === 'w') x-=1.7;
  let y = 25.5;
  ctx.font = `bold ${fontPx}px system-ui, -apple-system, Segoe UI, Arial`;
  ctx.textBaseline = "middle";

  drawCircle(ctx);
  ctx.fillStyle = badgeColor;
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  // Convert blob to data URL
  const buf = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `data:image/png;base64,${base64}`;
}

/**
 * Draw a circle for overlay icon.
 * @param ctx canvas 
 */
function drawCircle(ctx) {
  ctx.beginPath();
  ctx.arc(24.5, 24.6, 7.4, 0, 2 * Math.PI);
  ctx.closePath();
}

/**
 * Load default chrome favicon when favicon cannot be found.
 * Default favicon is obtained by fetching to chrome with empty url.
 * @returns bitmap of default favicon.
 */
async function loadDefaultFaviconBitmap() {
  const url = chrome.runtime.getURL("");
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`[UTAB] default icon fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const blob = await resp.blob();
  try {
    const bmp = await createImageBitmap(blob);
    console.log("[UTAB] bitmap:", bmp.width, bmp.height);
    return bmp;
  } catch (e) {
    console.error("[UTAB] createImageBitmap failed:", e);
    throw e;
  }
}