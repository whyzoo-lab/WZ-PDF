#!/usr/bin/env python3
"""
Build the bundled OCR assets into public/ocr/ for offline PaddleOCR.

These assets are large binaries (~56 MB) and are intentionally NOT committed to
git (see .gitignore). Run this once before building the app:

    python scripts/build-ocr-assets.py
    # or: npm run setup:ocr

What it produces:
    public/ocr/models/PP-OCRv5_mobile_det.tar         (detection, from Baidu CDN)
    public/ocr/models/korean_PP-OCRv5_mobile_rec.tar  (Korean recognition, repackaged)
    public/ocr/wasm/ort-wasm-simd-threaded(.jsep).{wasm,mjs}  (onnxruntime-web runtime)

The Korean recognition model is repackaged from the community ONNX export
(monkt/paddleocr-onnx) into the .tar layout the @paddleocr/paddleocr-js SDK
expects: a top-level dir containing inference.onnx + inference.yml, where the
yml carries the character dictionary and the RecResizeImg image_shape.

Requires: Python 3 + pyyaml  (pip install pyyaml)
The onnxruntime-web wasm files come from node_modules, so run `npm install` first.
"""
import io
import os
import shutil
import tarfile
import urllib.request

import yaml  # pip install pyyaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(ROOT, "public", "ocr", "models")
WASM_DIR = os.path.join(ROOT, "public", "ocr", "wasm")
ORT_DIST = os.path.join(ROOT, "node_modules", "onnxruntime-web", "dist")

CDN = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0"
HF_KO = "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean"

# Confirmed empirically from the ONNX model input tensor: [batch, 3, 48, dynamic_w].
# (The community config.json says 32, but the actual model is 48 — verified.)
REC_IMAGE_SHAPE = [3, 48, 320]

# onnxruntime-web runtime files needed at wasmPaths (/ocr/wasm/). Both the plain
# and jsep variants are bundled so backend selection ('wasm' / WebGPU) just works.
WASM_FILES = [
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
    "ort-wasm-simd-threaded.jsep.mjs",
]


def fetch(url: str) -> bytes:
    print(f"  -> {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "wz-pdf-ocr-setup"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def build_det():
    os.makedirs(MODELS_DIR, exist_ok=True)
    out = os.path.join(MODELS_DIR, "PP-OCRv5_mobile_det.tar")
    data = fetch(f"{CDN}/PP-OCRv5_mobile_det_onnx.tar")
    with open(out, "wb") as f:
        f.write(data)
    print(f"  [ok] {out} ({len(data)//1024} kB)")


def build_korean_rec():
    name = "korean_PP-OCRv5_mobile_rec"
    onnx = fetch(f"{HF_KO}/rec.onnx")
    dict_txt = fetch(f"{HF_KO}/dict.txt").decode("utf-8")
    chars = [line for line in dict_txt.split("\n")]
    if chars and chars[-1] == "":
        chars = chars[:-1]
    print(f"  dict entries: {len(chars)}")

    cfg = {
        "Global": {"model_name": name},
        "PreProcess": {
            "transform_ops": [
                {"DecodeImage": {"channel_first": False, "img_mode": "BGR"}},
                {"RecResizeImg": {"image_shape": REC_IMAGE_SHAPE}},
                {"KeepKeys": {"keep_keys": ["image"]}},
            ]
        },
        "PostProcess": {"name": "CTCLabelDecode", "character_dict": chars},
    }
    yml = yaml.safe_dump(
        cfg, allow_unicode=True, default_flow_style=False, sort_keys=False, width=1000
    ).encode("utf-8")

    out = os.path.join(MODELS_DIR, f"{name}.tar")
    with tarfile.open(out, "w", format=tarfile.USTAR_FORMAT) as tar:
        di = tarfile.TarInfo(f"{name}/inference.onnx")
        di.size = len(onnx)
        tar.addfile(di, io.BytesIO(onnx))
        yi = tarfile.TarInfo(f"{name}/inference.yml")
        yi.size = len(yml)
        tar.addfile(yi, io.BytesIO(yml))
    print(f"  [ok] {out} ({os.path.getsize(out)//1024} kB)")


def copy_wasm():
    os.makedirs(WASM_DIR, exist_ok=True)
    if not os.path.isdir(ORT_DIST):
        raise SystemExit(
            "node_modules/onnxruntime-web not found — run `npm install` first."
        )
    for fn in WASM_FILES:
        src = os.path.join(ORT_DIST, fn)
        if not os.path.exists(src):
            raise SystemExit(f"missing ort runtime file: {src}")
        shutil.copy2(src, os.path.join(WASM_DIR, fn))
        print(f"  [ok] wasm/{fn}")


def main():
    print("Building detection model...")
    build_det()
    print("Building Korean recognition model...")
    build_korean_rec()
    print("Copying onnxruntime-web runtime...")
    copy_wasm()
    print("Done. OCR assets are in public/ocr/.")


if __name__ == "__main__":
    main()
