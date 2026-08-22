# Vendored: Supertonic inference helper

`helper.js` is copied **verbatim** from the official Supertonic repository and
must stay that way, for the same reason the project never patches a dependency
in place: a local edit is invisible to an upgrade and silently disappears — or
silently blocks it. Any workaround belongs in `electron/ttsWorker.ts`, which
wraps this file, with a comment saying why.

| | |
|---|---|
| Source | https://github.com/supertone-inc/supertonic — `nodejs/helper.js` |
| Revision | `7e2804f96016a7028cb1ed627353c61c1e9dd281` (2026-07-23) |
| Licence | MIT (the sample code; **the model weights are OpenRAIL-M** — see below) |

It is vendored rather than installed because there is no usable package: the
`supertonic` name on npm is a 627-byte placeholder, not the runtime.

To update, copy the file again from the same path and record the new revision
here. Check `loadTextToSpeech` / `loadVoiceStyle` / `TextToSpeech.call`
signatures afterwards — `ttsWorker.ts` calls all three positionally, and they
are not covered by any type declaration:

```js
loadTextToSpeech(onnxDir, useGpu = false)          // -> TextToSpeech
loadVoiceStyle(voiceStylePaths /* ARRAY */, verbose = false)
textToSpeech.call(text, lang, style, totalStep, speed = 1.05, silenceDuration = 0.3)
```

`package.json` beside it marks the directory as ESM. Without it Node inherits
`electron/package.json`'s `"type": "commonjs"`, fails to parse the file, and
either throws or reparses it with a warning printed to stderr.

## Licence split — this matters

The **code** here is MIT. The **model weights** the app downloads at runtime are
under the **OpenRAIL-M** licence, which is not an OSI open-source licence: it
permits commercial use but carries use-based restrictions that must be passed on
to downstream users as an enforceable term. That is why the weights are *not*
bundled in the installer and why `THIRD_PARTY_NOTICES.md` reproduces the
restrictions.
