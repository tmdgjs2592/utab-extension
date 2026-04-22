export function isRestrictedUrl(url) {
  return /^(chrome|edge|about|chrome-extension):/i.test(url);
}

export function faviconURL(u) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', u);
  url.searchParams.set('size', '32');
  return url;
}

export function getBadgeGeometry(size, scale) {
  const radius = size * 0.23125 * scale;
  const edgeMargin = size * 0.003125;
  const centerX = size - edgeMargin - radius;
  const centerY = size - edgeMargin - radius;
  return {
    centerX,
    centerY,
    radius,
    fontPx: size * 0.46875 * scale
  };
}

export function drawCircle(ctx, geometry) {
  ctx.beginPath();
  ctx.arc(geometry.centerX, geometry.centerY, geometry.radius, 0, 2 * Math.PI);
  ctx.closePath();
}

export function formatOffset(n, KEY_SEQUENCE) {
  return KEY_SEQUENCE[Math.abs(n)] ?? "";
}

export function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeOverlayScale(value, MIN_OVERLAY_SCALE, MAX_OVERLAY_SCALE, OVERLAY_SCALE_STEP) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.min(MAX_OVERLAY_SCALE, Math.max(MIN_OVERLAY_SCALE, numeric));
  const stepped = Math.round(clamped / OVERLAY_SCALE_STEP) * OVERLAY_SCALE_STEP;
  return Number(stepped.toFixed(2));
}