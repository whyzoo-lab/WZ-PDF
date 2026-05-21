export interface StampPreset {
  id: string
  label: string
  svg: string
}

function makeSvg(text: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
  <rect x="4" y="4" width="192" height="72" rx="8" ry="8"
    fill="none" stroke="${color}" stroke-width="4"/>
  <text x="100" y="52" font-family="Arial, sans-serif" font-size="26"
    font-weight="bold" fill="${color}" text-anchor="middle">${text}</text>
</svg>`
}

export const STAMP_PRESETS: StampPreset[] = [
  { id: 'approved',     label: 'APPROVED',     svg: makeSvg('APPROVED',     '#16a34a') },
  { id: 'rejected',     label: 'REJECTED',     svg: makeSvg('REJECTED',     '#dc2626') },
  { id: 'confidential', label: 'CONFIDENTIAL', svg: makeSvg('CONFIDENTIAL', '#2563eb') },
  { id: 'draft',        label: 'DRAFT',        svg: makeSvg('DRAFT',        '#6b7280') },
]

/** Converts an SVG string to a base64 PNG data URL via an offscreen canvas */
export function svgToPng(svg: string, width = 200, height = 80): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image(width, height)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')) }
    img.src = url
  })
}
