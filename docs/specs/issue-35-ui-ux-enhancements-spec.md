# Specification: Issue #35 TTB UI/UX Enhancements

## 1. Scope and Goals
Implement 6 core enhancements for Talk To Bro:
1. Standardize all title/text occurrences to `Talk To Bro`.
2. Remove slogans (`Hey, Bro. 一個字，也值得好好弄懂。`, `Source: Bro Chat`, `一個 Talk，一次完整的回答。`) and remove `.popup-footer`.
3. Increase `.speakable-word` font size to `h3` hierarchy (`font-size: 1.17em`, `font-weight: 600`, `line-height: 1.35`).
4. Place phonetic notation to the immediate right of `speakable-word`.
5. Update extension action icons to match the UI brand icon.
6. Support font scaling / zoom in side panel with a user-configurable font size setting (default 16px).

## 2. Component Details

### 2.1 Manifest and Identity
- `package.json`: `name` = `"talk-to-bro"`
- `manifest.json`: `name` = `"Talk To Bro"`, `description` = `"Chrome MV3 Extension for Talk To Bro"`, `action.default_title` = `"Talk To Bro"`
- `src/sw/index.ts`: update comments and console logs from `Talk To Bro Personally` to `Talk To Bro`.

### 2.2 Header & Footer UI
- In `src/popup/popup.html`:
  - Remove `<h2 class="hero-title">Hey, Bro.</h2>` and `<p class="hero-sub">一個字，也值得好好弄懂。</p>`.
  - Remove `<footer class="popup-footer">...</footer>`.
  - In `#answer-container`, remove `.answer-meta` line referencing `Source: Bro Chat`.
- In `src/popup/popup.ts`:
  - Remove references and event listeners for `#foot-settings-btn` and `#source-line`.
- In `src/popup/popup.css`:
  - Clean up `.popup-footer`, adjust `.popup-header` padding for compact layout.

### 2.3 Speakable Words & Phonetics
- In `src/popup/popup.css`:
  - `.speakable-word { font-size: 1.17em; font-weight: 600; line-height: 1.35; ... }`
  - `.answer-content .phonetic { display: inline-block; margin-left: 6px; font-size: 0.9em; color: var(--muted); vertical-align: baseline; }`
- In `src/popup/pronunciation.ts`:
  - Ensure words are wrapped cleanly and if followed by phonetic brackets or `.phonetic`, they stay inline adjacent.

### 2.4 Control Bar / Action Icon
- Generate PNGs in `icons/` (16, 32, 48, 128px) featuring the speech bubble with line marks brand icon from the UI.

### 2.5 Side Panel Zoom & Font Size
- In `src/shared/types.ts` & `src/shared/storage.ts`:
  - Add optional `fontSize?: number` (e.g. 14, 16, 18, 20; default 16) to `Settings`.
- In `src/popup/popup.html`:
  - Add Font Size setting field in `#settings` section.
- In `src/popup/popup.ts`:
  - Load and apply `fontSize` to `document.documentElement.style.setProperty('--ttb-font-size', ...)`.
  - Bind change event on font size controls.
- In `src/popup/popup.css`:
  - Base font-size on `var(--ttb-font-size, 16px)`.

## 3. Verification
- `npm test`: Update existing tests to reflect removed footer and header elements, and verify new settings.
- E2E/CfT verification: Verify popup & sidepanel render without error and layout stays clean.
