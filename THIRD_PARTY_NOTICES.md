# Third-Party Notices

WZ PDF redistributes the following open-source components.  Their licenses
are reproduced below as required.

---

## pdfjs-dist — Apache License 2.0

Mozilla pdf.js project.

> Licensed under the Apache License, Version 2.0 (the "License"); you may
> not use this file except in compliance with the License. You may obtain
> a copy of the License at <https://www.apache.org/licenses/LICENSE-2.0>.
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS,
> WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

Full license: `node_modules/pdfjs-dist/LICENSE`

---

## JSZip — MIT (selected from dual MIT / GPL-3.0-or-later)

> Copyright (c) 2009-2016 Stuart Knightley
>
> JSZip is dual-licensed. WZ PDF uses it under the **MIT License** terms.

Full license: `node_modules/jszip/LICENSE.markdown`

---

## Noto Sans KR — SIL Open Font License 1.1

Google Noto fonts, Korean variant. Bundled at
`public/fonts/NotoSansKR-Regular.otf` (used both by the web/Electron app
for live preview and by the MCP server's `pdf-lib` embedding pipeline).

> Copyright 2014-2025 Adobe (http://www.adobe.com/), with Reserved Font
> Name "Source Han". Source Han is a trademark of Adobe in the United
> States and/or other countries.
>
> Licensed under the SIL Open Font License, Version 1.1.

Permissions granted by OFL 1.1: bundling, redistribution, and use within
any document — including selling documents produced with the font. The
font itself cannot be sold standalone.

Full license: <https://scripts.sil.org/OFL>

---

## react / react-dom / react-konva / konva / pdf-lib / @pdf-lib/fontkit / @modelcontextprotocol/sdk / and other runtime deps — MIT

All under the standard MIT License. See each package's `LICENSE` file
under `node_modules/`.

---

## Electron / Electron-builder — MIT

Bundled Chromium and Node.js portions carry their own permissive licenses
(BSD-style, MIT, etc.). The packaged installer ships
`LICENSES.chromium.html` (generated automatically by electron-builder)
which enumerates each component license.

---

## Build / development tooling

Vite, TypeScript, Tailwind CSS, ESLint, Vitest, and related devDependencies
are MIT-licensed. They do not ship in the user-facing distribution.
