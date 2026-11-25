# ADR 0001: UI/UX Enhancements, Brand Icon Unification & Side Panel Font Sizing

## Status
Accepted

## Context
Talk To Bro (TTB) previously had legacy naming artifacts (`Talk To Bro Personally`), unnecessary header slogans (`Hey, Bro. 一個字，也值得好好弄懂。`), redundant footers (`Source: Bro Chat`, `一個 Talk，一次完整的回答。`), and small target word typography (`.speakable-word`). In addition, the toolbar action icon did not match the in-app brand icon, and side panel users required an accessible way to enlarge text font size (Zoom In / Zoom Out).

## Decision
1. **Naming & Identity**: Standardize all product titles, package definitions, manifest configs, and logs to `Talk To Bro`.
2. **Visual Hierarchy Simplification**:
   - Remove the `h2.hero-title` and `p.hero-sub` slogan elements from the header to minimize header vertical footprint.
   - Remove `.popup-footer` entirely along with `#source-line` and `#foot-settings-btn`, relying on the top-right header gear icon for settings access.
3. **Word & Phonetic Typography**:
   - Style `.speakable-word` with `h3` hierarchy (`font-size: 1.17em`, `font-weight: 600`, `line-height: 1.35`).
   - Position phonetic notation immediately adjacent to the right of the target `speakable-word` with inline layout and muted tone.
4. **Action Icon Alignment**:
   - Generate extension action icons (16px, 32px, 48px, 128px) based on the in-app Brand Icon SVG geometry (`M4 6h16v11H9l-5 3z`, `M8 11h8M8 14h5`) so the browser control bar reflects the product's identity.
5. **Side Panel Zoom & Font Size**:
   - Provide configurable font sizing in `settings:v1` (Default 16px, plus 14px, 18px, 20px options) backed by CSS custom properties (`--ttb-base-font-size`), enabling smooth text scaling in side panel and popup contexts.

## Consequences
- Clean, compact popup and side panel headers with zero distracting slogans.
- Improved legibility for target English words and phonetics.
- Unified brand presence across browser action toolbar and in-app UI.
- Direct accessibility control over font sizes in side panel mode.
