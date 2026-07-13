import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { ZOOM_STEP, MIN_ZOOM, MAX_ZOOM } from '../utils/constants'
import { MIN_ZOOM_SPOT, MAX_ZOOM_SPOT } from '../utils/presentTools'

type Spot = { scale: number; x: number; y: number } | null

interface PresenterWheelDeps {
  step: number
  maxPage: number
  spot: Spot
  setSpot: Dispatch<SetStateAction<Spot>>
  setZoom: Dispatch<SetStateAction<number>>
  setCurrentPage: Dispatch<SetStateAction<number>>
}

/**
 * Fullscreen mouse-wheel handling: wheel over the spotlight scales it; Ctrl+wheel
 * zooms the page; horizontal two-finger swipe (accumulated) flips pages; plain
 * vertical wheel flips pages with a cooldown so one flick advances one page.
 */
export function usePresenterWheel({ step, maxPage, spot, setSpot, setZoom, setCurrentPage }: PresenterWheelDeps) {
  const wheelCooldownRef = useRef(false)
  const deltaXAccRef     = useRef(0)     // 수평 스와이프 누산기

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (spot) {
        const d = e.deltaY < 0 ? 0.25 : -0.25
        setSpot(s => (s ? { ...s, scale: Math.max(MIN_ZOOM_SPOT, Math.min(MAX_ZOOM_SPOT, s.scale + d)) } : s))
        return
      }

      // Ctrl + wheel → 줌
      if (e.ctrlKey) {
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
        setZoom(z => +(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)).toFixed(2)))
        return
      }

      // 수평 스와이프 (터치패드 두 손가락 좌우): |deltaX| > |deltaY| 이면 수평 우선
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        deltaXAccRef.current += e.deltaX
        if (deltaXAccRef.current > 80) {
          deltaXAccRef.current = 0
          setCurrentPage(p => Math.min(p + step, maxPage))
        } else if (deltaXAccRef.current < -80) {
          deltaXAccRef.current = 0
          setCurrentPage(p => Math.max(p - step, 1))
        }
        return
      }

      // 수직 스크롤 시 수평 누산기 리셋 (대각선 스와이프 오작동 방지)
      deltaXAccRef.current = 0

      // 수직 scroll → 페이지 전환 (기존 쿨다운 로직 유지)
      if (wheelCooldownRef.current) return
      if (e.deltaY === 0) return
      wheelCooldownRef.current = true
      setTimeout(() => { wheelCooldownRef.current = false }, 350)
      if (e.deltaY > 0) {
        setCurrentPage(p => Math.min(p + step, maxPage))
      } else {
        setCurrentPage(p => Math.max(p - step, 1))
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [step, maxPage, spot, setSpot, setZoom, setCurrentPage])
}
