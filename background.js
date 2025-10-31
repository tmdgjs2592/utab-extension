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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "UTAB_JUMP_BY" && Number.isInteger(msg.offset)) {
    jumpByOffset(msg.offset).then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, err: String(e) }));
    return true; // async
  }
});

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

// Recompute whenever tab order/active changes or a page finishes loading
[
  chrome.tabs.onActivated,
  chrome.tabs.onMoved,
  chrome.tabs.onCreated,
  chrome.tabs.onRemoved,
  chrome.tabs.onUpdated,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.tabs.onReplaced,
  chrome.windows.onFocusChanged,
].forEach(ev => ev.addListener(() => updateAll().catch(() => {})));

async function updateAll() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return;
  const currentIndex = active.index;
  const tabs = await chrome.tabs.query({ currentWindow: true });

  for (const t of tabs) {
    // if (!t.id || !t.url || !/^https?:/i.test(t.url)) continue;
    const offset = t.index - currentIndex;
    // Tell each tab its current offset; content.js will reply with its favicon href
    chrome.tabs.sendMessage(t.id, { type: "OFFSET", offset }).catch(() => {});
  }
}

// Compose a favicon+badge PNG and return a data URL
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "COMPOSE_FAVICON") {
    (async () => {
      try {
        const dataUrl = await composeIcon(msg.faviconHref, msg.text, msg.preferSize || 32, msg.badgeColor);
        sendResponse({ ok: true, dataUrl });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep the message channel open for async response
  }
});

// Draw base image + bottom-right badge; fetch is allowed by host_permissions
async function composeIcon(faviconHref, text, size, badgeColor = "#1e824c") {
  // Try to fetch favicon; fall back to a blank if it fails
  let bitmap = null;
  try {
    const resp = await fetch(faviconHref, { mode: "cors" });
    const blob = await resp.blob();
    bitmap = await createImageBitmap(blob);
  } catch (_) {
    // ignore, will draw blank background
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
