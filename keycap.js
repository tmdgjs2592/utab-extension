let timer = null;

/**
 * Reset the timer for closing the window.
 */
function reset() {
  clearTimeout(timer);
  timer = setTimeout(() => window.close(), 2500);
}

/**
 * Listen for users' keystrokes on this window.
 * Same method as the keystroke listerner in "content.js".
 */
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();

  if (/^[0-9a-z]$/i.test(e.key)) {
    const offset = e.key;
    chrome.runtime.sendMessage({
      type: "UTAB_JUMP",
      offset
    });
    window.close();
  }

  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

reset();
