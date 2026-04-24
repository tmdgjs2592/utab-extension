globalThis.SEARCH_STYLE ??= `
    :host {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      color-scheme: light dark;
      font-family: "Avenir Next", "Segoe UI Variable Text", "Trebuchet MS", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .utab-search-layer {
      position: fixed;
      inset: 0;
      display: grid;
      align-items: start;
      justify-items: center;
      padding: clamp(16px, 4vw, 64px);
    }

    .utab-search-backdrop {
      position: absolute;
      inset: 0;
      border: 0;
      background: oklch(0.18 0.012 300 / 0.15);
      backdrop-filter: blur(4px);
      cursor: default;
    }

    .utab-search-panel {
      position: relative;
      width: 700px;
      max-height: min(70vh, 512px);
      display: flex;
      flex-direction: column;
      border: 1px solid light-dark(oklch(0.85 0.01 85 / 0.5), oklch(0.3 0.01 300 / 0.5));
      border-radius: 12px;
      background: light-dark(oklch(0.98 0.005 85 / 0.95), oklch(0.2 0.01 300 / 0.95));
      box-shadow: light-dark(0 16px 40px oklch(0.38 0.02 304 / 0.1), 0 16px 40px oklch(0.02 0.01 300 / 0.3));
      color: light-dark(oklch(0.2 0.02 305), oklch(0.95 0.01 300));
      overflow: hidden;
      animation: utab-search-enter 150ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .utab-search-header {
      display: flex;
      align-items: center;
      padding: 12px 20px;
      border-bottom: 1px solid light-dark(oklch(0.9 0.01 85), oklch(0.28 0.01 300));
    }

    .utab-search-input {
      flex: 1;
      width: 100%;
      min-width: 0;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 20px;
    }

    .utab-search-input::placeholder {
      color: light-dark(oklch(0.6 0.01 85), oklch(0.5 0.01 300));
    }

    .utab-search-results {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .utab-search-result {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .utab-search-result[aria-selected="true"] {
      background: light-dark(oklch(0.94 0.01 85), oklch(0.26 0.01 300));
    }

    .utab-search-result:active {
      background: light-dark(oklch(0.9 0.01 85), oklch(0.3 0.01 300));
    }

    .utab-search-icon {
      position: relative;
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: transparent;
      overflow: hidden;
      flex-shrink: 0;
    }

    .utab-search-icon img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .utab-search-icon-fallback {
      color: light-dark(oklch(0.5 0.01 85), oklch(0.7 0.01 300));
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .utab-search-copy {
      min-width: 0;
      flex: 1;
      display: flex;
      align-items: baseline;
      gap: 8px;
      overflow: hidden;
    }

    .utab-search-title {
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .utab-search-url {
      color: light-dark(oklch(0.5 0.01 85), oklch(0.6 0.01 300));
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .utab-search-meta {
      color: light-dark(oklch(0.5 0.01 85), oklch(0.6 0.01 300));
      font-size: 12px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .utab-search-empty {
      padding: 48px 16px;
      text-align: center;
      color: light-dark(oklch(0.5 0.01 85), oklch(0.6 0.01 300));
      font-size: 14px;
    }

    @keyframes utab-search-enter {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.99);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `