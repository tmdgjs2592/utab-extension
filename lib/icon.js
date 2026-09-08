import { DEFAULT_OVERLAY_SCALE } from "./constants.js";
import { faviconURL, getBadgeGeometry, drawCircle } from "./utils.js";

const composited_icon_cache = new Map();
const favicon_cache = new Map();
let defaultFaviconPromise = null;
let sharedCanvas = null;
let renderQueue = Promise.resolve();

function loadDefaultFaviconBitmap() {
  if (defaultFaviconPromise) return defaultFaviconPromise;
  defaultFaviconPromise = (async () => {
    try {
      const url = chrome.runtime.getURL("");
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`[UTAB] default icon fetch failed: ${resp.status}`);
      const blob = await resp.blob();
      return await createImageBitmap(blob);
    } catch (error) {
      defaultFaviconPromise = null;
      throw error;
    }
  })();
  return defaultFaviconPromise;
}

export async function composeIcon(baseHref, faviconIdentity, offset, size, badgeColor, badgeScale) {
  const sourceHref = faviconIdentity || baseHref;
  const normalizedScale = badgeScale;
  const composite = `${sourceHref}_${offset}_${badgeColor}_${normalizedScale.toFixed(2)}`;

  if (composited_icon_cache.has(composite)) {
    return await composited_icon_cache.get(composite);
  }

  const composePromise = (async () => {
    let bitmap = null;
    if (favicon_cache.has(sourceHref)) {
      bitmap = await favicon_cache.get(sourceHref);
    } else {
      const fetchPromise = (async () => {
        try {
          const resp = await fetch(
            sourceHref,
            sourceHref === baseHref ? { mode: "cors" } : undefined
          )
          if (!resp.ok) throw new Error(`favicon fetch failed: ${resp.status}`)
          const blob = await resp.blob()
          return await createImageBitmap(blob)
        } catch {
          if (sourceHref !== baseHref) {
            try {
              const resp = await fetch(baseHref, { mode: "cors" })
              if (!resp.ok) throw new Error(`fallback fetch failed: ${resp.status}`)
              const blob = await resp.blob()
              return await createImageBitmap(blob)
            } catch {}
          }
          return await loadDefaultFaviconBitmap()
        }
      })()
      favicon_cache.set(sourceHref, fetchPromise);
      bitmap = await fetchPromise;
    }

    const base64 = await new Promise((resolve, reject) => {
      renderQueue = renderQueue.then(async () => {
        try {
          if (!sharedCanvas) {
            sharedCanvas = new OffscreenCanvas(size, size);
          } else {
            sharedCanvas.width = size; // Clears the canvas
          }
          
          const ctx = sharedCanvas.getContext("2d");
          ctx.clearRect(0, 0, size, size);
          if (bitmap) {
            ctx.drawImage(bitmap, 0, 0, size, size);
          } else {
            ctx.fillStyle = "#888";
            ctx.fillRect(0, 0, size, size);
          }
          const badgeGeometry = getBadgeGeometry(size, normalizedScale);
          let textX = badgeGeometry.centerX;
          if (offset === "i") textX += badgeGeometry.radius * 0.24;
          if (offset === "w") textX -= badgeGeometry.radius * 0.16;
          const textY = badgeGeometry.centerY + badgeGeometry.radius * 0.12;
          ctx.font = `bold ${badgeGeometry.fontPx}px system-ui, -apple-system, Segoe UI, Arial`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          drawCircle(ctx, badgeGeometry);
          ctx.fillStyle = badgeColor;
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.fillText(offset, textX, textY);
          const blob = await sharedCanvas.convertToBlob({ type: "image/png" });
          const buf = await blob.arrayBuffer();
          resolve(btoa(String.fromCharCode(...new Uint8Array(buf))));
        } catch (e) {
          reject(e);
        }
      });
    });
    return `data:image/png;base64,${base64}`;
  })();

  composited_icon_cache.set(composite, composePromise);
  return await composePromise;
}

export function clearCompositedIconCache() {
  composited_icon_cache.clear();
}

export function clearFaviconCache() {
  favicon_cache.clear();
}

export function invalidateCachedIconSources(sourceHrefs = []) {
  const uniqueSources = [...new Set(sourceHrefs.filter((href) => typeof href === "string" && href))]
  if (!uniqueSources.length) return

  for (const href of uniqueSources) {
    favicon_cache.delete(href)
  }

  for (const compositeKey of composited_icon_cache.keys()) {
    if (uniqueSources.some((href) => compositeKey.startsWith(`${href}_`))) {
      composited_icon_cache.delete(compositeKey)
    }
  }
}

export function clearIconCaches() {
  clearCompositedIconCache()
  clearFaviconCache()
}
