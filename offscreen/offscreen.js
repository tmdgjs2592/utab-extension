setInterval(() => {
  chrome.runtime.sendMessage({ type: "KEEP_ALIVE" }).catch(() => {})
}, 20000)
