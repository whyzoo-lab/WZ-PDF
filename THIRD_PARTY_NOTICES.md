# Third-Party Notices

WZ Reader redistributes the following open-source components.  Their licenses
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
> JSZip is dual-licensed. WZ Reader uses it under the **MIT License** terms.

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

## PaddleOCR — PP-OCRv5 models + @paddleocr/paddleocr-js — Apache License 2.0

On-device OCR toolkit and PP-OCRv5 detection / recognition models. Bundled
offline under `public/ocr/` (models + onnxruntime-web wasm).

> Copyright PaddlePaddle Authors. Licensed under the Apache License,
> Version 2.0. Source: <https://github.com/PaddlePaddle/PaddleOCR>.

---

## docx-preview — Apache License 2.0

> Copyright Volodymyr Baydalka. Licensed under the Apache License, Version 2.0.
> Source: <https://github.com/VolodymyrBaydalka/docxjs>. Used unmodified to
> display Word (.docx) documents.

Full license: `node_modules/docx-preview/LICENSE`

---

## @aiden0z/pptx-renderer — Apache License 2.0

> Copyright aiden0z. Licensed under the Apache License, Version 2.0.
> Source: <https://github.com/aiden0z/pptx-renderer>. Used unmodified to
> display PowerPoint (.pptx) presentations.

Full license: `node_modules/@aiden0z/pptx-renderer/LICENSE`. It bundles the
components below, also unmodified; its own notices are in
`node_modules/@aiden0z/pptx-renderer/THIRD_PARTY_NOTICES.md`.

- **mtx-decompressor 1.8.0 — Mozilla Public License 2.0.** Distributed in
  executable (bundled, minified) form without source modifications. The
  corresponding source is available at
  <https://github.com/ChristopherVR/mtx-decompressor/tree/v1.8.0>; the license
  text is `node_modules/@aiden0z/pptx-renderer/licenses/mtx-decompressor-MPL-2.0.txt`.
- **ECMA-376 DrawingML preset geometry** — a generated subset of the shape
  definitions; notice in
  `node_modules/@aiden0z/pptx-renderer/licenses/ECMA-text-copyright-notice.txt`.
- **Apache ECharts 6.1.0 — Apache License 2.0** (charts in slides), and its
  renderer **zrender 6.1.0 — BSD 3-Clause**. Copyright The Apache Software
  Foundation / Baidu Inc. Full licenses: `node_modules/echarts/LICENSE`,
  `node_modules/zrender/LICENSE`.

---

## Mediabunny — Mozilla Public License 2.0

> Copyright Vanilagy. Licensed under the Mozilla Public License, Version 2.0.
> Source: <https://github.com/Vanilagy/mediabunny>. Used unmodified, bundled
> and minified, to write MP4 files (a PowerPoint deck saved as a narrated
> video). The corresponding source of the version shipped is the npm package
> `mediabunny@1.61.3` (its `src/` folder ships with it) and the tag of the
> same version in the repository above.

Full license: `node_modules/mediabunny/LICENSE`

---

## PdfCraft — Apache License 2.0 / MIT (designs and algorithms adapted)

> Copyright the PdfCraft contributors. Source: <https://github.com/storytold/pdfcraft>,
> dual-licensed Apache-2.0 / MIT. No PdfCraft code ships with this app; these
> parts were rewritten in TypeScript after its designs and algorithms:
> the command-palette ranking (`palette.rs` → `src/components/toolbar/commandSearch.ts`),
> the autosave / crash-recovery store (`recovery.rs` → `electron/recovery.ts`),
> find-as-you-type behaviour (`canvas.rs`, `text/search.rs` → `src/hooks/useSearch.ts`,
> `src/services/textSearch.ts`), the outline filter that keeps parents visible,
> the theme / reading-colours settings, and the comments: text markup and
> notes saved as PDF annotations with appearance streams (`crates/annot` →
> `src/services/pdfComments.ts`), read back from a file
> (`src/services/pdfCommentImport.ts`), and the comments panel
> (`comments_panel.rs` → `src/components/comments/`); form filling
> (`crates/forms` → `src/services/pdfForms.ts`) and Fill & Sign
> (`fill_sign.rs` → `src/components/fill/`); the page-import and pruning
> rules that keep links, bookmarks and fields working (`crates/organize`
> → `src/services/pdfStructure.ts`); and the word comparison
> (`crates/compare` → `src/services/textCompare.ts`).

---

## PKI.js (pkijs) and ASN1.js (asn1js) — BSD 3-Clause License

> PKI.js: Copyright (c) 2014, GlobalSign; Copyright (c) 2015-2019, Peculiar Ventures.
> ASN1.js: Copyright (c) 2014, GMO GlobalSign; Copyright (c) 2015-2022, Peculiar Ventures.
> Author 2014-2019, Yury Strozhevsky. <https://github.com/PeculiarVentures/PKI.js>,
> <https://github.com/PeculiarVentures/ASN1.js>. Used to read, check and create
> CMS (PKCS #7) signatures and to open PKCS #12 certificate files.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
> 1. Redistributions of source code must retain the above copyright notice, this
>    list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors
>    may be used to endorse or promote products derived from this software
>    without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
> ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
> WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
> DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
> FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
> DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
> THE POSSIBILITY OF SUCH DAMAGE.

---

## hucre — MIT License

> Copyright (c) 2026 productdevbook. Licensed under the MIT License.
> Source: <https://github.com/productdevbook/hucre>. Used unmodified to read
> spreadsheets (.xlsx, .xls, .ods, .csv).

Full license: `node_modules/hucre/LICENSE`

---

## ONNX Runtime Web — onnxruntime-web — MIT License

> Copyright (c) Microsoft Corporation. Licensed under the MIT License.
> Source: <https://github.com/microsoft/onnxruntime>.

---

## OpenCV — opencv.js via @techstark/opencv-js — Apache License 2.0

> Copyright OpenCV team. Licensed under the Apache License, Version 2.0.
> Source: <https://github.com/opencv/opencv>.

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

---

## Supertonic 3 (text-to-speech) — code MIT, **model weights OpenRAIL-M**

Reading documents aloud uses [Supertonic](https://github.com/supertone-inc/supertonic)
by Supertone Inc. The two halves carry different licences, and the difference
matters:

- **Inference code** — MIT. A copy of `nodejs/helper.js` is vendored verbatim at
  `electron/vendor/supertonic/helper.js`, with its provenance recorded in the
  README beside it.
- **Model weights** ([`supertone-oss-archive/supertonic-3`](https://huggingface.co/supertone-oss-archive/supertonic-3), formerly [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3); Supertone archived the project in 2026 and the files are identical)
  — **OpenRAIL-M**. These are **not** included in the installer. They are
  downloaded once, on request, when the user first turns on reading aloud.

OpenRAIL-M is **not an OSI open-source licence**. It permits commercial use,
modification and redistribution, but attaches *use-based restrictions* that must
be passed on: anyone redistributing the weights, or a derivative of them, has to
include those restrictions as an enforceable term and give notice of them. The
restrictions cover applications such as generating speech to impersonate a
person without consent, to deceive, harass or defame, or otherwise to cause
foreseeable harm.

The full text accompanies the weights in the download and is also published at
the model page linked above. Using WZ Reader's read-aloud feature means accepting
those terms for the audio it produces.

## onnxruntime-node — MIT

Speech synthesis runs on [ONNX Runtime](https://github.com/microsoft/onnxruntime)
(MIT). Only the CPU provider ships; the DirectML provider's libraries are
excluded from the build.
