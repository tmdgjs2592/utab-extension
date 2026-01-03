let lastDataUrl = null;
let jumpMode = false;
let neg = false;
let timer = null;
const preferSize = 32; 

chrome.runtime.onMessage.addListener(async (msg) =>{
  if (!msg.type) return;
  /**
   * Listen for jump mode from the background.
   * Message contains either PLUS or MINUS jump mode.
   * Sets the jump mode to true.
   */
  if (msg?.type === "UTAB_ENTER_JUMP_MODE_PLUS" || msg?.type === "UTAB_ENTER_JUMP_MODE_MINUS") {
    neg = msg.type.endsWith("MINUS");
    jumpMode = true;
    clearTimeout(timer);
    timer = setTimeout(() => exitMode(), 2500); // auto-exit after 2.5s
  }
  
  /**
   * Listen for favicon link and set the current tab's favicon.
   * Message contains favicon link.
   */
  else if(msg.type === "OFFSET"){
    if (msg.dataUrl) setFavicon(msg.dataUrl);
  }
});

/**
 * Listen for key stroke and send the information to background.
 * Keys pressed during the jump mode do not propagate to the website.
 */
window.addEventListener("keydown", (e) => {
  if(!jumpMode) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  if (/^[0-9a-z]$/.test(e.key)){
    const offset = e.key;
    const sign = neg? "NEG" : "POS";
    chrome.runtime.sendMessage({ type: "UTAB_JUMP_BY_" + sign, offset});
    exitMode();
  } else if (e.key === "Escape"){
    exitMode();
  }
});

/**
 * Exit jump mode by turning the jump mode off.
 */
function exitMode(){
  jumpMode = false;
  neg = false;
  clearTimeout(timer);
}

/**
 * Switch the favicon of the tab through DOM.
 * @param href favicon with overlay url
 */
function setFavicon(href) {
  document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove());

  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = href;
  document.head.appendChild(link);
}