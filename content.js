let lastDataUrl = null;
let jumpMode = false;
let neg = false;
let timer = null;
const preferSize = 32; 

chrome.runtime.onMessage.addListener(async (msg) =>{
  if (!msg.type) return;
  if (msg.type === "UTAB_ENTER_JUMP_MODE_PLUS" || msg?.type === "UTAB_ENTER_JUMP_MODE_MINUS") {
    neg = msg.type.endsWith("MINUS");
    jumpMode = true;
    clearTimeout(timer);
    timer = setTimeout(() => exitMode(), 2500); // auto-exit after 2.5s
  }
  
  else if(msg.type === "OFFSET"){
    if (msg.dataUrl) setFavicon(msg.dataUrl);
  }
})

// Listen for keydown when in jump mode
window.addEventListener("keydown", (e) => {
  if(!jumpMode) return;
  if (/^[0-9a-z]$/.test(e.key)){
    const offset = e.key;
    const sign = neg? "NEG" : "POS";
    chrome.runtime.sendMessage({ type: "UTAB_JUMP_BY_" + sign, offset});
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