import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'

/**
 * Plays an animated picture (GIF, animated WebP) on its page.
 *
 * Canvas only ever draws an animated image's first frame, and the page is a
 * canvas (Konva). So the frames come from WebCodecs' ImageDecoder, through
 * `ViewerDoc.images.animation`, and are painted one at a time into a canvas of
 * the page raster's size that replaces the raster on screen. Print, export,
 * thumbnails and OCR keep using the raster — the first frame — which is what
 * a picture of an animation can show on paper.
 *
 * Runs only while the page is mounted (pages two screens away unmount), and
 * idles while the window is hidden. Returns the canvas to draw, or null for a
 * still picture.
 */
export function usePageAnimation(
  doc: ViewerDoc,
  pageNumber: number,
  raster: { width: number; height: number } | null,
  layerRef: RefObject<{ batchDraw(): unknown } | null>,
): HTMLCanvasElement | null {
  const [frames, setFrames] = useState<HTMLCanvasElement | null>(null)
  const images = doc.images
  const width = raster?.width ?? 0
  const height = raster?.height ?? 0

  useEffect(() => {
    if (!images || !width || !height) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let close: (() => void) | null = null

    images.animation(pageNumber).then(anim => {
      if (!anim) return
      if (stopped) { anim.close(); return }
      close = () => anim.close()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      let index = 0
      let shown = false
      const step = async () => {
        if (stopped) return
        // A hidden window paints nothing; check back in a while.
        if (document.hidden) { timer = setTimeout(step, 500); return }
        try {
          const { image, duration } = await anim.frame(index)
          if (stopped) { image.close(); return }
          ctx.clearRect(0, 0, width, height)
          ctx.drawImage(image, 0, 0, width, height)
          image.close()
          if (!shown) { shown = true; setFrames(canvas) }
          layerRef.current?.batchDraw()
          index = (index + 1) % anim.frameCount
          timer = setTimeout(step, duration)
        } catch {
          // A frame that will not decode: stay on the last good one.
        }
      }
      void step()
    }).catch(() => { /* a still picture after all */ })

    return () => {
      stopped = true
      clearTimeout(timer)
      close?.()
      setFrames(null)
    }
  }, [images, pageNumber, width, height, layerRef])

  return frames
}
