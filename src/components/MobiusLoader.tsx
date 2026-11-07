import { useEffect, useRef } from 'react'

/**
 * The "opening…" animation: a glowing round tube in the shape of ∞ — the
 * endless loop of a Möbius band — at the centre, an aura of light flowing round
 * it, and a ring of light threaded on the tube, travelling along it.
 *
 * How it got here, so nobody walks the same road again. A textbook Möbius
 * strip (a circle with the half twist spread round it) read as two loops when
 * drawn as lines and as a tilted dish when solid. An ∞-shaped ribbon with the
 * half twist at the crossing read as a Möbius strip, and a flattened tube made
 * it feel solid — but the reader found the twist at the centre unnecessary
 * (the tube's endless ∞ already says it), the squarish loops of a lemniscate of
 * Gerono and the flattened tube's sharp sides too angular (it looked like a
 * company logo), and the white lines along those sides too much. So: no twist,
 * a round cross-section, the rounder lemniscate of Bernoulli, no edge lines.
 * The two passes at the crossing are held apart in depth, so the tube goes
 * over and under itself.
 *
 * Drawn on a 2D canvas with its own perspective projection — a 3D library
 * would be hundreds of KB on the startup path for a spinner. The tube's far
 * side is culled, and the rest and the ring's segments are painted back to
 * front together, so the ring passes behind the tube as it really would. Each
 * quad is one opaque fill with its highlight and rim light mixed in: added as
 * separate "lighter" fills, the antialiased borders of neighbouring quads took
 * the light twice and the tube showed a grid. Drawn at 30 fps (it shares the
 * main thread with the document being opened). On the light theme a dark lens
 * is drawn behind it: added light vanishes into a pale page. Readers who ask
 * for less motion get one still frame.
 */

const SEGMENTS = 120         // along the tube, evenly by length
const AROUND = 24              // quads round it (a plump tube shows its facets below this)
const R = 0.23                // the tube's radius: plump, as the reader asked
const SCALE_X = 1.0            // half the width of the ∞
const SCALE_Y = 1.6            // loops' height, against Bernoulli's own: round, chubby loops
const DEPTH = 0.34             // how far apart the two passes at the crossing are (> R, or they meet)
const BREATHE_S = 2.4          // the tube swells and settles a little, like breathing
const RING_POINTS = 44
const LAP_S = 3.6              // one trip of the ring round the tube
const SWAY_S = 8               // one sway, there and back
const TRAIL = 1.3              // radians (of 2π) of tube lit behind the ring

interface Spark { s: number; life: number; dx: number; dy: number; dz: number }

type V3 = [number, number, number]
interface Projected { x: number; y: number; z: number; k: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** HSL (h in degrees, s and l 0–1) to RGB 0–255. */
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

// ── The tube, in its own space (x right, y up, z towards the viewer) ──────

/** Centre line: a lemniscate of Bernoulli, the crossing at t = π/2 and 3π/2. */
const centre = (t: number): V3 => {
  const q = 1 + Math.sin(t) ** 2
  return [SCALE_X * Math.cos(t) / q, SCALE_X * SCALE_Y * Math.sin(t) * Math.cos(t) / q, DEPTH * Math.sin(t)]
}

interface Station { c: V3; n: V3; b: V3 }

/**
 * The centre line sampled evenly by length, with two directions across it at
 * each point to build the tube's rings from. Computed once — the tube itself
 * does not change, only how it is seen.
 */
const STATIONS: Station[] = (() => {
  const FINE = 2000
  const ts: number[] = [], len: number[] = [0]
  for (let i = 0; i <= FINE; i++) ts.push((i / FINE) * Math.PI * 2)
  for (let i = 1; i <= FINE; i++) len.push(len[i - 1] + Math.hypot(...sub(centre(ts[i]), centre(ts[i - 1]))))
  const total = len[FINE]
  const out: Station[] = []
  let k = 0
  for (let i = 0; i <= SEGMENTS; i++) {
    const want = (i / SEGMENTS) * total
    while (k < FINE - 1 && len[k + 1] < want) k++
    const f = (want - len[k]) / (len[k + 1] - len[k] || 1)
    const t = ts[k] + f * (ts[k + 1] - ts[k])
    const tan = unit(sub(centre(t + 1e-4), centre(t - 1e-4)))
    const n = unit(cross([0, 0, 1], tan))
    out.push({ c: centre(t), n, b: cross(tan, n) })
  }
  return out
})()

/** A point on the tube at angle `theta` round station `st`, `r` from its centre. */
const around = (st: Station, theta: number, r: number): V3 => {
  const u = r * Math.cos(theta), v = r * Math.sin(theta)
  return [st.c[0] + u * st.n[0] + v * st.b[0], st.c[1] + u * st.n[1] + v * st.b[1], st.c[2] + u * st.n[2] + v * st.b[2]]
}

// ── Seeing it ─────────────────────────────────────────────────────────────

/** Distance of the eye from the centre, in the tube's units. */
const VIEW_D = 3.6

function makeView(size: number, t: number) {
  // A gentle sway about the vertical and a look from a little above: enough
  // to show it is solid, never so far that a loop turns edge-on.
  const yaw = 0.36 * Math.sin((t / SWAY_S) * Math.PI * 2)
  const pitch = 0.34 + 0.06 * Math.sin((t / SWAY_S) * Math.PI * 4)
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const f = size * 0.38 * VIEW_D / (SCALE_X + R)
  const turn = ([x, y, z]: V3): V3 => {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp]
  }
  const project = ([x, y, z]: V3): Projected => {
    const s = f / (VIEW_D - z)
    // k: line-width scale, 1 at middle depth and 128 px, larger when nearer.
    return { x: size / 2 + x * s, y: size / 2 - y * s, z, k: (s / (f / VIEW_D)) * (size / 128) }
  }
  return { turn, project }
}

const LIGHT = unit([-0.4, 0.6, 0.8])                    // from the upper left, in front

/** How far `s` lies behind `ring`, the way the ring travels, as a fraction in [0, 1). */
const behind = (ring: number, s: number) => {
  const d = (ring - s) % 1
  return d < 0 ? d + 1 : d
}

/** One thing to paint, in depth order. */
interface Piece { z: number; paint: () => void }

function drawAura(ctx: CanvasRenderingContext2D, size: number, t: number): void {
  const c = size / 2
  const glow = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5)
  glow.addColorStop(0, 'rgba(70,110,255,0.26)')
  glow.addColorStop(0.5, 'rgba(70,60,230,0.1)')
  glow.addColorStop(1, 'rgba(40,30,160,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  // Wisps: closed curves round the tube, wider than tall like it, whose
  // radius ripples and flows — pink outside, a blue one inside.
  const wisps: [number, number, number, number, number][] = [
    // radius, hue, speed, ripple, phase
    [0.45, 318, 0.9, 0.02, 0], [0.47, 300, -0.7, 0.022, 2], [0.43, 326, 1.3, 0.016, 4], [0.41, 210, -1.1, 0.014, 1],
  ]
  ctx.lineCap = 'round'
  for (const [radius, hue, speed, ripple, phase] of wisps) {
    for (const [width, alpha] of [[7, 0.05], [3, 0.09], [1, 0.24]] as const) {
      ctx.beginPath()
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2
        const r = size * (radius
          + ripple * Math.sin(3 * a + t * speed * 2 + phase)
          + ripple * 0.6 * Math.sin(5 * a - t * speed * 3 + phase * 2)
          + ripple * 0.4 * Math.sin(8 * a + t * speed * 1.3))
        const x = c + Math.cos(a + t * speed * 0.3) * r
        const y = c + Math.sin(a + t * speed * 0.3) * r * 0.72
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      // Brighter on some stretches than others, so it reads as flowing light.
      const g = ctx.createConicGradient(t * speed + phase, c, c)
      g.addColorStop(0, `hsla(${hue},100%,66%,${alpha})`)
      g.addColorStop(0.3, `hsla(${hue},100%,70%,${alpha * 0.15})`)
      g.addColorStop(0.55, `hsla(${hue},100%,66%,${alpha})`)
      g.addColorStop(0.8, `hsla(${hue},100%,72%,${alpha * 0.3})`)
      g.addColorStop(1, `hsla(${hue},100%,66%,${alpha})`)
      ctx.strokeStyle = g
      ctx.lineWidth = width * (size / 128)
      ctx.stroke()
    }
  }
}

function drawLoader(ctx: CanvasRenderingContext2D, size: number, t: number, dark: boolean, sparks: Spark[]): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, size, size)
  const { turn, project } = makeView(size, t)
  const ring = (t / LAP_S) % 1                          // fraction of the way round

  if (!dark) {
    const c = size / 2
    const lens = ctx.createRadialGradient(c, c, size * 0.1, c, c, size / 2)
    lens.addColorStop(0, 'rgba(16,20,54,0.97)')
    lens.addColorStop(0.82, 'rgba(10,12,34,0.94)')
    lens.addColorStop(0.92, 'rgba(10,12,34,0.5)')
    lens.addColorStop(1, 'rgba(10,12,34,0)')
    ctx.fillStyle = lens
    ctx.fillRect(0, 0, size, size)
  }
  ctx.globalCompositeOperation = 'lighter'
  drawAura(ctx, size, t)

  // The tube's grid — rings of points round the centre line — turned once.
  const r = R * (1 + 0.04 * Math.sin((t / BREATHE_S) * Math.PI * 2))
  const grid: V3[][] = STATIONS.map(st => {
    const row: V3[] = []
    for (let j = 0; j <= AROUND; j++) row.push(turn(around(st, (j / AROUND) * Math.PI * 2, r)))
    return row
  })
  const flat = grid.map(row => row.map(project))
  const pieces: Piece[] = []
  const eye: V3 = [0, 0, VIEW_D]

  for (let i = 0; i < SEGMENTS; i++) {
    const s = (i + 0.5) / SEGMENTS
    const lit = Math.exp(-behind(ring, s) * Math.PI * 2 / (TRAIL / 3)) + 0.35 * Math.exp(-behind(s, ring) * Math.PI * 2 / 0.1)
    // Blue round one loop, violet round the other, pinker where the ring passed.
    const hue = 218 + 48 * (0.5 - 0.5 * Math.cos(s * Math.PI * 2)) + lit * 45
    for (let j = 0; j < AROUND; j++) {
      const p00 = grid[i][j], p10 = grid[i + 1][j], p01 = grid[i][j + 1], p11 = grid[i + 1][j + 1]
      const mid: V3 = [(p00[0] + p11[0]) / 2, (p00[1] + p11[1]) / 2, (p00[2] + p11[2]) / 2]
      // Outward normal (along x around points inward on this tube).
      const n = unit(cross(sub(p01, p00), sub(p10, p00)))
      const toEye = unit(sub(eye, mid))
      const facing = dot(n, toEye)
      if (facing <= 0) continue                          // the far side of the tube
      const diffuse = Math.max(0, dot(n, LIGHT))
      // A broad, soft highlight, like a glossy toy, rather than a glint.
      const spec = Math.max(0, dot(n, unit([LIGHT[0] + toEye[0], LIGHT[1] + toEye[1], LIGHT[2] + toEye[2]]))) ** 9
      const rim = (1 - facing) ** 3
      // Glossy tube — lit body, the highlight, a soft coloured glow at the
      // rim (not a white outline) — mixed into one colour.
      const body = hslRgb(hue, 0.85, (14 + diffuse * 44 + lit * 16) / 100)
      const glow = hslRgb(hue + 30, 1, 0.55)
      const sp = Math.min(0.6, spec * 0.7), rm = rim * 0.35
      const fill = `rgb(${[0, 1, 2].map(k => Math.min(255, Math.round(body[k] + sp * [225, 240, 255][k] + rm * glow[k]))).join(',')})`
      const a = flat[i][j], b = flat[i + 1][j], c = flat[i + 1][j + 1], d = flat[i][j + 1]
      pieces.push({
        z: mid[2],
        paint: () => {
          ctx.globalCompositeOperation = 'source-over'
          ctx.fillStyle = fill
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath()
          ctx.fill()
          ctx.strokeStyle = fill                           // close the hairlines between quads
          ctx.lineWidth = 0.6
          ctx.stroke()
        },
      })
    }
  }

  // The ring, threaded on the tube: a circle round the centre line, in the
  // plane across it, wider than the tube, painted with the tube in depth
  // order so it goes behind it and comes out in front.
  const at = ring * SEGMENTS
  const i0 = Math.floor(at) % SEGMENTS, i1 = i0 + 1, f = at - Math.floor(at)
  const lerp = (p: V3, q: V3): V3 => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]
  const st: Station = { c: lerp(STATIONS[i0].c, STATIONS[i1].c), n: unit(lerp(STATIONS[i0].n, STATIONS[i1].n)), b: unit(lerp(STATIONS[i0].b, STATIONS[i1].b)) }
  const ringPts: V3[] = []
  for (let i = 0; i <= RING_POINTS; i++) ringPts.push(turn(around(st, (i / RING_POINTS) * Math.PI * 2, r * 1.4)))
  const ringFlat = ringPts.map(project)
  for (let i = 0; i < RING_POINTS; i++) {
    const a = ringFlat[i], b = ringFlat[i + 1]
    pieces.push({
      z: (ringPts[i][2] + ringPts[i + 1][2]) / 2 + 0.01,
      paint: () => {
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (const [style, width] of [
          ['hsla(318,100%,62%,0.2)', 8], ['hsla(305,100%,68%,0.34)', 4.2], ['hsla(200,100%,76%,0.7)', 2.1], ['hsla(190,100%,97%,1)', 1],
        ] as const) {
          ctx.strokeStyle = style
          ctx.lineWidth = a.k * width
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        }
      },
    })
  }

  ctx.lineJoin = 'round'
  pieces.sort((p, q) => p.z - q.z)
  for (const p of pieces) p.paint()

  // A soft flare where the ring is, and sparks shed behind it.
  ctx.globalCompositeOperation = 'lighter'
  const c = project(turn(st.c))
  const flare = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, size * 0.12)
  flare.addColorStop(0, 'rgba(170,215,255,0.28)')
  flare.addColorStop(0.45, 'rgba(200,110,255,0.09)')
  flare.addColorStop(1, 'rgba(120,80,255,0)')
  ctx.fillStyle = flare
  ctx.fillRect(c.x - size * 0.12, c.y - size * 0.12, size * 0.24, size * 0.24)
  for (const spark of sparks) {
    const age = 1 - spark.life
    const base = STATIONS[Math.min(SEGMENTS, Math.max(0, Math.round((((spark.s % 1) + 1) % 1) * SEGMENTS)))].c
    const p = project(turn([base[0] + spark.dx * age * 0.5, base[1] + spark.dy * age * 0.5, base[2] + spark.dz * age * 0.5]))
    ctx.fillStyle = `hsla(${300 + spark.dz * 40},100%,82%,${spark.life * 0.65})`
    ctx.beginPath(); ctx.arc(p.x, p.y, p.k * 1.1 * (0.3 + spark.life), 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export default function MobiusLoader({ size = 150 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    let ctx: CanvasRenderingContext2D | null = null
    try { ctx = canvas?.getContext('2d') ?? null } catch { /* no canvas (tests) */ }
    if (!canvas || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const isDark = () => document.documentElement.classList.contains('dark')
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (still) { drawLoader(ctx, size, 0.6, isDark(), []); return }

    const sparks: Spark[] = []
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const start = performance.now()
    let last = start
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      // 30 frames a second: the motion is slow, and this shares the main
      // thread with the document being opened.
      if (now - last < 1000 / 30 - 2) return
      const t = (now - start) / 1000
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      // ~20 alive at a time.
      if (rand() < 0.3 * dt * 60) {
        sparks.push({ s: (t / LAP_S) - rand() * 0.02, life: 1, dx: (rand() - 0.5) * 0.8, dy: (rand() - 0.5) * 0.8, dz: (rand() - 0.5) * 0.8 })
      }
      for (const spark of sparks) spark.life -= dt / 1.1
      while (sparks.length && sparks[0].life <= 0) sparks.shift()
      drawLoader(ctx, size, t, isDark(), sparks)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [size])

  return <canvas ref={ref} aria-hidden="true" style={{ width: size, height: size }} />
}
