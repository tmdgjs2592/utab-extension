if (typeof window.utabCleanup === "function") {
  window.utabCleanup()
}

if (!window.utabInitialized) {
  window.utabInitialized = true

  const ORIGINAL_FAVICON_ATTR = "data-utab-original-favicon-hrefs"
  let jumpMode = false
  let neg = false
  let prevFocus = null
  let timer = null

  const MAX_SEARCH_RESULTS = 50
  const searchState = {
    open: false,
    items: [],
    filteredItems: [],
    selectedIndex: 0,
    host: null,
    input: null,
    list: null,
    empty: null,
    prevFocus: null
  }

  const onMessage = (msg, _sender, sendResponse) => {
    if (!msg?.type) return

    if (msg.type === "UTAB_JUMP_MODE") {
      closeTabSearch({ restoreFocus: false })
      neg = msg.neg
      prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      stealFocusFromPageControls()
      jumpMode = true
      clearTimeout(timer)
      timer = setTimeout(() => exitMode(), 2500)
    }

    else if (msg.type === "OFFSET") {
      if (msg.dataUrl) setFavicon(msg.dataUrl)
    }

    else if (msg.type === "CLEAR_OFFSET") {
      clearFavicon()
    }

    else if (msg.type === "UTAB_TAB_SEARCH_OPEN") {
      exitMode()
      openTabSearch(msg.items)
    }

    else if (msg.type === "UTAB_GET_FAVICON_SOURCE") {
      sendResponse({ href: getOriginalFaviconHref() })
    }
  }

  const onKeyDown = (e) => {
    if (!jumpMode) return

    e.preventDefault()
    e.stopImmediatePropagation()

    if (/^[0-9a-z]$/.test(e.key)) {
      const offset = e.key
      chrome.runtime.sendMessage({ type: "UTAB_JUMP", offset, neg })
      exitMode()
    } else if (e.key === "Escape") {
      exitMode()
    }
  }

  chrome.runtime.onMessage.addListener(onMessage)
  window.addEventListener("keydown", onKeyDown, true)

  window.utabCleanup = () => {
    clearFavicon()
    chrome.runtime.onMessage.removeListener(onMessage)
    window.removeEventListener("keydown", onKeyDown, true)
    clearTimeout(timer)
    destroyTabSearch()
    window.utabInitialized = false
  }

  function exitMode() {
    jumpMode = false
    neg = false
    clearTimeout(timer)
    restoreFocus()
  }

  let originalFaviconHrefs = null

  function getOriginalFaviconHref() {
    const storedOriginalFaviconHrefs = originalFaviconHrefs?.length
      ? originalFaviconHrefs
      : readStoredOriginalFaviconHrefs()

    if (storedOriginalFaviconHrefs.length) {
      return storedOriginalFaviconHrefs[0]
    }

    const current = Array.from(document.querySelectorAll('link[rel~="icon"]'))
      .map((element) => element.href)
      .find((href) => typeof href === "string" && href && !href.startsWith("data:"))

    return current || ""
  }

  function readStoredOriginalFaviconHrefs() {
    const stored = document.documentElement?.getAttribute(ORIGINAL_FAVICON_ATTR)
    if (!stored) return []

    try {
      const parsed = JSON.parse(stored)
      return Array.isArray(parsed) ? parsed.filter((href) => typeof href === "string" && href) : []
    } catch {
      return []
    }
  }

  function storeOriginalFaviconHrefs(hrefs) {
    if (!document.documentElement) return
    if (!Array.isArray(hrefs) || !hrefs.length) {
      document.documentElement.removeAttribute(ORIGINAL_FAVICON_ATTR)
      return
    }

    document.documentElement.setAttribute(ORIGINAL_FAVICON_ATTR, JSON.stringify(hrefs))
  }

  function setFavicon(href) {
    if (!document.head) return

    if (!originalFaviconHrefs) {
      originalFaviconHrefs = readStoredOriginalFaviconHrefs()
      if (!originalFaviconHrefs.length) {
        originalFaviconHrefs = Array.from(document.querySelectorAll('link[rel~="icon"]')).map(el => el.href)
      }
      storeOriginalFaviconHrefs(originalFaviconHrefs)
    }

    const existing = document.querySelector('link[data-utab-injected="true"]')
    if (existing) {
      if (existing.href !== href) {
        existing.href = href
      }
      document.querySelectorAll('link[rel~="icon"]:not([data-utab-injected="true"])').forEach(el => el.remove())
      return
    }

    document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove())

    const link = document.createElement("link")
    link.rel = "icon"
    link.type = "image/png"
    link.href = href
    link.dataset.utabInjected = "true"
    document.head.appendChild(link)
  }

  function clearFavicon() {
    document.querySelectorAll('link[data-utab-injected="true"]').forEach(el => el.remove())
    const storedOriginalFaviconHrefs = originalFaviconHrefs?.length ? originalFaviconHrefs : readStoredOriginalFaviconHrefs()
    if (storedOriginalFaviconHrefs.length && document.head) {
      storedOriginalFaviconHrefs.forEach(href => {
        const link = document.createElement("link")
        link.rel = "icon"
        link.href = href
        document.head.appendChild(link)
      })
    }
    originalFaviconHrefs = null
    storeOriginalFaviconHrefs([])
  }

  function stealFocusFromPageControls() {
    const ae = document.activeElement

    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
      ae.blur?.()
    }

    const trap = document.createElement("div")
    trap.tabIndex = -1
    trap.setAttribute("aria-hidden", "true")
    trap.style.cssText = "position:fixed; width:1px; height:1px; left:-9999px; top:-9999px; outline: none;"
    document.documentElement.appendChild(trap)
    trap.focus({ preventScroll: true })

    queueMicrotask(() => trap.remove())
  }

  function restoreFocus() {
    if (prevFocus && prevFocus.isConnected) {
      prevFocus.focus({ preventScroll: true })
    }
    prevFocus = null
  }

  function openTabSearch(items) {
    ensureTabSearch()

    searchState.items = Array.isArray(items) ? items.map(normalizeSearchItem) : []
    searchState.prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchState.open = true
    searchState.host.hidden = false
    searchState.input.value = ""
    searchState.selectedIndex = 0
    filterTabSearch()

    requestAnimationFrame(() => {
      searchState.input.focus({ preventScroll: true })
      searchState.input.select()
    })
  }

  function closeTabSearch(options = {}) {
    const shouldRestoreFocus = options.restoreFocus !== false
    if (!searchState.host) return

    searchState.open = false
    searchState.host.hidden = true
    searchState.filteredItems = []
    searchState.selectedIndex = 0
    searchState.input.value = ""
    searchState.input.removeAttribute("aria-activedescendant")
    searchState.list.replaceChildren()
    searchState.empty.hidden = true

    if (shouldRestoreFocus && searchState.prevFocus?.isConnected) {
      searchState.prevFocus.focus({ preventScroll: true })
    }

    searchState.prevFocus = null
  }

  function ensureTabSearch() {
    if (searchState.host) return

    const host = document.createElement("div")
    host.hidden = true

    const shadow = host.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = SEARCH_STYLE

    const layer = document.createElement("div")
    layer.className = "utab-search-layer"

    const backdrop = document.createElement("button")
    backdrop.type = "button"
    backdrop.tabIndex = -1
    backdrop.className = "utab-search-backdrop"
    backdrop.setAttribute("aria-label", "Close tab search")
    backdrop.addEventListener("click", () => closeTabSearch())

    const panel = document.createElement("section")
    panel.className = "utab-search-panel"
    panel.setAttribute("role", "dialog")
    panel.setAttribute("aria-modal", "true")
    panel.setAttribute("aria-label", "Search open tabs")

    const header = document.createElement("div")
    header.className = "utab-search-header"

    const input = document.createElement("input")
    input.className = "utab-search-input"
    input.type = "text"
    input.placeholder = "Search tabs..."
    input.autocomplete = "off"
    input.spellcheck = false
    input.setAttribute("aria-autocomplete", "list")
    input.setAttribute("aria-controls", "utab-search-results")

    const list = document.createElement("div")
    list.className = "utab-search-results"
    list.setAttribute("role", "listbox")
    list.id = "utab-search-results"

    const empty = document.createElement("div")
    empty.className = "utab-search-empty"
    empty.hidden = true

    header.append(input)
    panel.append(header, list, empty)
    layer.append(backdrop, panel)
    shadow.append(style, layer)

    input.addEventListener("keydown", onSearchInputKeyDown)
    input.addEventListener("input", () => {
      searchState.selectedIndex = 0
      filterTabSearch()
    })

    list.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button[data-index]") : null
      if (!target) return

      const index = Number(target.dataset.index)
      if (!Number.isFinite(index)) return

      searchState.selectedIndex = index
      activateSelectedTab()
    })

    list.addEventListener("mousemove", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button[data-index]") : null
      if (!target) return

      const index = Number(target.dataset.index)
      if (!Number.isFinite(index) || index === searchState.selectedIndex) return

      searchState.selectedIndex = index
      syncSelectedResult()
    })

    ;(document.body || document.documentElement).appendChild(host)

    searchState.host = host
    searchState.input = input
    searchState.list = list
    searchState.empty = empty
  }

  function destroyTabSearch() {
    if (!searchState.host) return

    searchState.host.remove()
    searchState.open = false
    searchState.items = []
    searchState.filteredItems = []
    searchState.selectedIndex = 0
    searchState.host = null
    searchState.input = null
    searchState.list = null
    searchState.empty = null
    searchState.prevFocus = null
  }

  function filterTabSearch() {
    const query = searchState.input.value.trim().toLowerCase()
    const tokens = query.split(/\s+/).filter(Boolean)
    const matches = tokens.length
      ? searchState.items.filter(item => tokens.every(token => item.searchText.includes(token) || item.url.includes(token)))
      : searchState.items

    searchState.filteredItems = matches.slice(0, MAX_SEARCH_RESULTS)

    if (query) {
      searchState.filteredItems.push({
        itemType: "google_search",
        id: "google_search",
        title: `Search Google for "${searchState.input.value.trim()}"`,
        url: `https://www.google.com/search?q=${encodeURIComponent(searchState.input.value.trim())}`,
        favIconUrl: "https://www.google.com/favicon.ico",
        active: false,
        currentWindow: false,
        searchText: ""
      })
    }

    if (!searchState.filteredItems.length) {
      searchState.selectedIndex = 0
    } else if (searchState.selectedIndex >= searchState.filteredItems.length) {
      searchState.selectedIndex = searchState.filteredItems.length - 1
    }

    renderSearchResults(matches.length, query)
  }

  function renderSearchResults(totalMatches, query) {
    searchState.list.replaceChildren()

    if (!searchState.filteredItems.length) {
      searchState.empty.textContent = query
        ? "No tabs found."
        : "No open tabs."
      searchState.empty.hidden = false
      searchState.input.removeAttribute("aria-activedescendant")
      return
    }

    searchState.empty.hidden = true

    const fragment = document.createDocumentFragment()
    for (const [index, item] of searchState.filteredItems.entries()) {
      fragment.appendChild(createResultButton(item, index))
    }

    searchState.list.appendChild(fragment)
    syncSelectedResult()
  }

  function createResultButton(item, index) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "utab-search-result"
    button.dataset.index = String(index)
    button.id = `utab-search-option-${index}`
    button.setAttribute("role", "option")
    button.setAttribute("aria-selected", String(index === searchState.selectedIndex))

    const icon = document.createElement("span")
    icon.className = "utab-search-icon"

    const fallback = document.createElement("span")
    fallback.className = "utab-search-icon-fallback"
    fallback.textContent = getFallbackGlyph(item.title)
    icon.appendChild(fallback)

    if (item.favIconUrl) {
      const img = document.createElement("img")
      img.src = item.favIconUrl
      img.alt = ""
      img.addEventListener("load", () => fallback.remove())
      img.addEventListener("error", () => img.remove())
      icon.appendChild(img)
    }

    const copy = document.createElement("span")
    copy.className = "utab-search-copy"

    const title = document.createElement("span")
    title.className = "utab-search-title"
    title.textContent = item.title

    const url = document.createElement("span")
    url.className = "utab-search-url"
    url.textContent = formatTabUrl(item.url)

    copy.append(title, url)
    button.append(icon, copy)

    if (item.active && item.currentWindow && item.itemType === "tab") {
      const meta = document.createElement("span")
      meta.className = "utab-search-meta"
      meta.textContent = "Current"
      button.append(meta)
    } else if (item.currentWindow && item.itemType === "tab") {
      const meta = document.createElement("span")
      meta.className = "utab-search-meta"
      meta.textContent = "This window"
      button.append(meta)
    } else if (item.itemType === "bookmark") {
      const meta = document.createElement("span")
      meta.className = "utab-search-meta"
      meta.textContent = "Bookmark"
      button.append(meta)
    } else if (item.itemType === "google_search") {
      const meta = document.createElement("span")
      meta.className = "utab-search-meta"
      meta.textContent = "Web Search"
      button.append(meta)
    }

    return button
  }

  function syncSelectedResult() {
    const buttons = searchState.list.querySelectorAll("button[data-index]")
    buttons.forEach((button, index) => {
      button.setAttribute("aria-selected", String(index === searchState.selectedIndex))
    })

    const selected = buttons[searchState.selectedIndex]
    if (selected) {
      searchState.input.setAttribute("aria-activedescendant", selected.id)
      selected.scrollIntoView({ block: "nearest" })
    } else {
      searchState.input.removeAttribute("aria-activedescendant")
    }
  }

  function onSearchInputKeyDown(event) {
    if (!searchState.open) return

    event.stopImmediatePropagation()

    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveSelection(1)
    }

    else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveSelection(-1)
    }

    else if (event.key === "Enter") {
      event.preventDefault()
      activateSelectedTab()
    }

    else if (event.key === "Escape") {
      event.preventDefault()
      closeTabSearch()
    }
  }

  function moveSelection(delta) {
    if (!searchState.filteredItems.length) return

    const count = searchState.filteredItems.length
    searchState.selectedIndex = (searchState.selectedIndex + delta + count) % count
    syncSelectedResult()
  }

  function activateSelectedTab() {
    const item = searchState.filteredItems[searchState.selectedIndex]
    if (!item) return

    closeTabSearch({ restoreFocus: false })
    chrome.runtime.sendMessage({
      type: "UTAB_TAB_SEARCH_ACTIVATE",
      tabId: item.id,
      windowId: item.windowId,
      itemType: item.itemType,
      url: item.url
    })
  }

  function normalizeSearchItem(item) {
    const title = typeof item?.title === "string" && item.title.trim()
      ? item.title.trim()
      : "Untitled tab"

    return {
      itemType: item?.itemType || "tab",
      id: item.id,
      windowId: item.windowId,
      title,
      url: typeof item?.url === "string" ? item.url : "",
      favIconUrl: typeof item?.favIconUrl === "string" ? item.favIconUrl : "",
      active: Boolean(item?.active),
      currentWindow: Boolean(item?.currentWindow),
      searchText: title.toLowerCase()
    }
  }

  function formatTabUrl(url) {
    if (!url) return "No URL available"

    try {
      const parsed = new URL(url)
      if (parsed.protocol === "file:") return "Local file"

      const host = parsed.hostname.replace(/^www\./, "")
      return parsed.pathname && parsed.pathname !== "/"
        ? `${host}${parsed.pathname}`
        : host
    } catch {
      return url
    }
  }

  function getFallbackGlyph(title) {
    const match = title.trim().match(/[a-z0-9]/i)
    return match ? match[0] : "?"
  }
}
