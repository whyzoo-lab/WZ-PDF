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

## PaddleOCR — PP-OCRv5 models + @paddleocr/paddleocr-js — Apache License 2.0

On-device OCR toolkit and PP-OCRv5 detection / recognition models. Bundled
offline under `public/ocr/` (models + onnxruntime-web wasm).

> Copyright PaddlePaddle Authors. Licensed under the Apache License,
> Version 2.0. Source: <https://github.com/PaddlePaddle/PaddleOCR>.

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
- **Model weights** ([`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3))
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
the model page linked above. Using WZ PDF's read-aloud feature means accepting
those terms for the audio it produces.

## onnxruntime-node — MIT

Speech synthesis runs on [ONNX Runtime](https://github.com/microsoft/onnxruntime)
(MIT). Only the CPU provider ships; the DirectML provider's libraries are
excluded from the build.
