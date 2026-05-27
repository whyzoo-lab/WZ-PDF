import { useCallback, useEffect } from 'react'

/**
 * Print the current viewer: each Konva canvas is composited into a single
 * image and inserted before its container while the container is hidden,
 * so the browser's print pipeline sees high-quality bitmaps rather than
 * trying to print the WebGL/Canvas2D layers directly.
 *
 * Also listens for the `wz-print` CustomEvent so Ctrl+P (dispatched from
 * the global shortcut handler) can trigger the same flow.
 */
export function usePrint() {
  const handlePrint = useCallback(async () => {
    const list: Array<{ container: HTMLDivElement; img: HTMLImageElement }> = []
    document.querySelectorAll<HTMLDivElement>('.konvajs-content').forEach(container => {
      const canvases = Array.from(container.querySelectorAll<HTMLCanvasElement>('canvas'))
      if (!canvases.length) return
      const [first] = canvases
      const comp = document.createElement('canvas')
      comp.width  = first.width
      comp.height = first.height
      const ctx = comp.getContext('2d')
      if (ctx) canvases.forEach(c => ctx.drawImage(c, 0, 0))
      const img = document.createElement('img')
      img.src = comp.toDataURL('image/jpeg', 0.95)
      img.setAttribute('data-wz-print', '')
      img.style.cssText = [
        `width:${container.offsetWidth}px`,
        `height:${container.offsetHeight}px`,
        'display:block',
        'max-width:100%',
      ].join(';')
      container.before(img)
      container.setAttribute('data-wz-hide', '')
      container.style.display = 'none'
      list.push({ container, img })
    })
    // Electron's webContents.print is async; awaiting keeps the canvases
    // hidden until the print dialog closes, otherwise they'd snap back
    // before the OS captured the image versions.
    if (window.electronAPI?.printWindow) {
      await window.electronAPI.printWindow()
    } else {
      window.print()
    }
    list.forEach(({ container, img }) => {
      img.remove()
      container.style.display = ''
      container.removeAttribute('data-wz-hide')
    })
  }, [])

  useEffect(() => {
    const onPrint = () => { handlePrint() }
    document.addEventListener('wz-print', onPrint)
    return () => document.removeEventListener('wz-print', onPrint)
  }, [handlePrint])

  return { handlePrint }
}
