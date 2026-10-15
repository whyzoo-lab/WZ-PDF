# Side rail UI — design (approved 2026-10-14)

## Goal
Move the tools out of the 48 px top bar into a vertical icon rail on the left,
and make the top a thin title bar that shows the document and the window
controls, in one colour with the page background (reference: KakaoTalk PC).

## Layout (desktop, md and up)
- **Tool rail** (dark, #111827, full window height, ~52 px): WZ logo at the
  top (window drag area), then icons; a bottom group pinned to the end.
- **Edit rail** (dark, beside the tool rail): only while editing a page
  document, not presenting. Icons with a small label under each.
- **Title bar** (32 px, light grey, the page background colour): file name
  centred (amber dot when unsaved); on the right the page counter, zoom
  (- % +) and fit-width; then the OS window controls (Electron
  titleBarOverlay, height 32, same colour, dark symbols). Draggable.
- Page background lightened from gray-300 (#d1d5db) to a softer **#e6e7ea**
  (single CSS token), title bar the same.

## Tool rail items (in order; hidden when they do not apply)
| group | items |
|---|---|
| file | Open (menu: file / URL), Save (menu: PDF Ctrl+S, original, booklet, HTML, images, EXE), Print, Video (deck with notes) |
| view | Page list, Layout (menu: single / two-page / all pages), Rotate (menu: left / right), Fullscreen, Speaker notes (deck) |
| tools | Find (new; same as Ctrl+F), OCR (menu: this page / all; progress + cancel), Read aloud, Eraser (when markups exist) |
| bottom (pinned) | Edit switch, Password |

- Icons with a menu open a flyout to the right (above, on the bottom bar).
- When the rail is too short, the lowest items move into a "..." menu;
  this replaces the hamburger collapse of the old bar.
- Embed / private mode hides open, save, edit and password, as before.

## Edit rail items
Undo, Redo | Select, Stamp (menu: presets, my stamps, upload), Signature,
Watermark | Delete (when something is selected).

## Narrow screens (< 600 px, phones)
Title bar stays (no window controls on the web). The tool rail becomes a
bottom bar with the same items and its own "..." overflow; the edit rail a
row just above it. The page list stays a drawer. Floating bars (read-aloud,
toast, find, update) move clear of the new bars.

## Structure
- `ActionBar` keeps its props (App unchanged apart from layout) and now lays
  out the chrome around the document area it is given as children.
- `TitleBar`, `ToolRail` (vertical or horizontal), `EditRail`, `RailButton`,
  `RailFlyout` (portal, positioned beside its button) and `useRailOverflow`.
- Rail items are one list of `{ id, label, icon, onClick | menu, state }`, drawn
  by the rail, the bottom bar and the overflow menu alike.
- Electron: `titleBarOverlay` 32 px, light colour, dark symbols;
  `app.html` first-paint shell redrawn to match; `.is-electron header` CSS
  becomes a title-bar class (Markdown and mail have their own `<header>`).

## Testing
- ActionBar tests updated (they query by accessible name, which stays).
- New tests: overflow arithmetic, flyout open/close, title bar contents.
- Packaged build over CDP: screenshots at desktop and phone width, window
  drag area, every rail action reachable.
