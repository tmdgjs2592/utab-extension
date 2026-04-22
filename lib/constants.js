export const KEY_SEQUENCE = [
  "0","1","2","3","4","5","6","7","8","9",
  "q","w","e","r","t","y","u","i","o","p",
  "a","s","d","f","g","h","j","k","l",
  "z","x","c","v","b","n","m"
];

export const KEY_INDEX = Object.fromEntries(KEY_SEQUENCE.map((k, i) => [k, i]));

export const DEFAULT_OVERLAY_COLORS = Object.freeze({
  left: "#b25a00",
  right: "#1e824c"
});

export const DEFAULT_OVERLAY_SCALE = 1;
export const MIN_OVERLAY_SCALE = 0.75;
export const MAX_OVERLAY_SCALE = 1.4;
export const OVERLAY_SCALE_STEP = 0.05;
export const CURRENT_BADGE_COLOR = "#5f5964";

export const OFFSET_EVENTS = [
  chrome.tabs.onActivated,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.tabs.onRemoved,
  chrome.windows.onFocusChanged
];
