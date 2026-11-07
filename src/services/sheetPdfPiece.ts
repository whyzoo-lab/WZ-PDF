// The element a spreadsheet PDF piece is printed from. Apart from sheetPdf.ts,
// which lays the sheet out and so loads the spreadsheet readers: SheetView
// gets the markup from its worker and needs only this.

export function sheetPdfPiece(html: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'wz-sheet wz-sheet-pdf'
  el.innerHTML = html
  return el
}
