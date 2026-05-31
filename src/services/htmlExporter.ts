/**
 * HTML Viewer Export
 *
 * Creates a single self-contained HTML file that embeds the PDF as base64
 * and renders it via the browser's native PDF viewer (iframe + blob URL).
 * No external dependencies — works fully offline.
 */

import { downloadBlob, stripPdfExt } from '../utils/download'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert ArrayBuffer → base64 string (chunked to avoid call-stack overflow). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 32_768
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return btoa(binary)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── HTML template ────────────────────────────────────────────────────────────

function buildHtml(title: string, base64Pdf: string): string {
  // The PDF is decoded from base64 at runtime → Blob URL → iframe src.
  // This avoids the "data:application/pdf" URL scheme which some browsers
  // block for iframes due to CSP / mixed-content policies.
  return `<!DOCTYPE html>
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
  var d=${JSON.stringify(base64Pdf)};
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
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Export the given PDF bytes as a standalone HTML viewer file.
 * @param fileBytes  Raw PDF bytes (original or annotated)
 * @param filename   Source filename — used to derive the .html download name
 */
export function exportAsHtml(fileBytes: ArrayBuffer, filename: string): void {
  const title   = stripPdfExt(filename)
  const base64  = arrayBufferToBase64(fileBytes)
  const html    = buildHtml(title, base64)
  const blob    = new Blob([html], { type: 'text/html;charset=utf-8' })
  downloadBlob(blob, `${title}.html`)
}
