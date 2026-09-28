/**
 * HTML Viewer Export
 *
 * Creates a single self-contained HTML file that embeds the PDF as base64
 * and renders it via the browser's native PDF viewer (iframe + blob URL).
 * No external dependencies — works fully offline.
 */

import { stripDocExt } from '../utils/download'
import { t } from '../i18n'

import { HTML_EXPORT_MAX_BYTES } from '../utils/constants'

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Base64 in pieces. Each piece encodes a whole multiple of 3 bytes, so the
 * pieces join into exactly the base64 of the whole — without ever holding the
 * whole file as one binary string plus its base64 plus a JSON copy plus the
 * page around it, which was four full copies at once.
 */
function base64Pieces(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer)
  const PIECE = 3 * 256 * 1024 // 768 KB of input per piece
  const CHUNK = 32_768         // fromCharCode argument limit
  const pieces: string[] = []
  for (let at = 0; at < bytes.length; at += PIECE) {
    const piece = bytes.subarray(at, Math.min(at + PIECE, bytes.length))
    let binary = ''
    for (let i = 0; i < piece.length; i += CHUNK) {
      binary += String.fromCharCode(...piece.subarray(i, Math.min(i + CHUNK, piece.length)))
    }
    pieces.push(btoa(binary))
  }
  return pieces
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── HTML template ────────────────────────────────────────────────────────────

/** The page, split around its payload: `[before, after]`. */
function buildHtml(title: string): [string, string] {
  // The PDF is decoded from base64 at runtime → Blob URL → iframe src.
  // This avoids the "data:application/pdf" URL scheme which some browsers
  // block for iframes due to CSP / mixed-content policies.
  const before = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;background:#404040;font-family:sans-serif}
    #viewer{width:100%;height:100%;border:none;display:block}
    #msg{display:none;height:100%;align-items:center;justify-content:center;
         flex-direction:column;gap:12px;color:#ccc;text-align:center;padding:40px}
    #msg h2{font-size:1.2rem}
    #msg p{font-size:.9rem;opacity:.7}
  </style>
</head>
<body>
<iframe id="viewer"></iframe>
<div id="msg">
  <h2>PDF를 표시할 수 없습니다</h2>
  <p>Chrome, Firefox, Edge 등 최신 브라우저에서 열어주세요.</p>
</div>
<script>
(function(){
  var d="`
  const after = `";
  try{
    var s=atob(d),a=new Uint8Array(s.length);
    for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);
    var u=URL.createObjectURL(new Blob([a],{type:"application/pdf"}));
    var f=document.getElementById("viewer");
    f.src=u;
    f.onerror=function(){showMsg()};
    // Fallback: some browsers fire load but display blank for PDFs in iframes
    f.onload=function(){setTimeout(function(){
      try{if(f.contentDocument&&!f.contentDocument.body.innerHTML)showMsg()}catch(e){}
    },800)};
  }catch(e){showMsg()}
  function showMsg(){
    document.getElementById("viewer").style.display="none";
    var m=document.getElementById("msg");
    m.style.display="flex";
  }
})();
</script>
</body>
</html>`
  return [before, after]
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Export the given PDF bytes as a standalone HTML viewer file.
 * @param fileBytes  Raw PDF bytes (original or annotated)
 * @param filename   Source filename — used to derive the .html download name
 */
export function buildHtmlExport(fileBytes: ArrayBuffer, filename: string): { blob: Blob; filename: string } {
  if (fileBytes.byteLength > HTML_EXPORT_MAX_BYTES) {
    throw new Error(t('export.htmlTooLarge', { limit: `${HTML_EXPORT_MAX_BYTES / (1024 * 1024)}MB` }))
  }
  const title = stripDocExt(filename)
  const [before, after] = buildHtml(title)
  // Base64 contains no quote or backslash, so it goes into the string literal
  // as is — no JSON.stringify copy of the whole payload.
  const blob = new Blob([before, ...base64Pieces(fileBytes), after], { type: 'text/html;charset=utf-8' })
  return { blob, filename: `${title}.html` }
}
