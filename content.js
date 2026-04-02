if(!window.utabInitialized){
  if (typeof window.utabCleanup === "function"){
    window.utabCleanup();
  }

  let jumpMode = false;
  let neg = false;
  let prevFocus = null;
  let timer = null;
  const preferSize = 32; 

  const onMessage = async (msg) => {
    if (!msg.type) return;
      /**
       * Listen for jump mode from the background.
       * Message contains either PLUS or MINUS jump mode.
       * Sets the jump mode to true.
       */
      if (msg?.type === "UTAB_JUMP_MODE") {
        neg = msg.neg;
        prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        stealFocusFromPageControls();
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
  };

  const onKeyDown = (e) => {
    if(!jumpMode) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (/^[0-9a-z]$/.test(e.key)){
      const offset = e.key;
      chrome.runtime.sendMessage({ type: "UTAB_JUMP", offset, neg});
      exitMode();
    } else if (e.key === "Escape"){
      exitMode();
    }
  };

  /**
   * Listen for jump mode and favicon signals.
   */
  chrome.runtime.onMessage.addListener(onMessage);

  /**
   * Listen for key stroke and send the information to background.
   * Keys pressed during the jump mode do not propagate to the website.
   */
  window.addEventListener("keydown", onKeyDown);

  /**
   * Cleanup function for the extension reloads.
   */
  window.utabCleanup = () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("keydown", onKeyDown);
    clearTimeout(timer);
  };

  /**
   * Exit jump mode by turning the jump mode off.
   */
  function exitMode(){
    jumpMode = false;
    neg = false;
    clearTimeout(timer);
    restoreFocus();
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

  /**
   * Enable keystroke listener through focusing out of the editing field.
   */
  function stealFocusFromPageControls() {
    const ae = document.activeElement;

    // Blur common editable targets
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
      ae.blur?.();
    }

    // Temporary focusable element 
    const trap = document.createElement("div");
    trap.tabIndex = -1;
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:fixed; width:1px; height:1px; left:-9999px; top:-9999px;";
    document.documentElement.appendChild(trap);
    trap.focus({ preventScroll: true });

    // Cleanup
    queueMicrotask(() => trap.remove());
  }

  /**
   * Focus what the user was editing before jump mode
   */
  function restoreFocus() {
    
    if (prevFocus && prevFocus.isConnected) {
      prevFocus.focus({ preventScroll: true });
    }
    prevFocus = null;
  }
}
