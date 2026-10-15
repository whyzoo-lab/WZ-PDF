import { describe, it, expect } from 'vitest'
import { createByteCache, createReadQueue } from './imageSources'

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('read queue', () => {
  it('runs at most `limit` jobs at once', async () => {
    const q = createReadQueue(2)
    let running = 0, most = 0
    const gates = Array.from({ length: 5 }, () => deferred<void>())
    const jobs = gates.map(g => q.run(async () => { running++; most = Math.max(most, running); await g.promise; running-- }))
    await tick()
    expect(running).toBe(2)
    gates.forEach(g => g.resolve())
    await Promise.all(jobs)
    expect(most).toBe(2)
  })

  // The page on screen asked last; pages scrolled past asked first.
  it('starts the most recently queued job first once a slot frees', async () => {
    const q = createReadQueue(1)
    const order: string[] = []
    const first = deferred<void>()
    const a = q.run(async () => { order.push('a'); await first.promise })
    const b = q.run(async () => { order.push('b') })
    const c = q.run(async () => { order.push('c') })
    await tick()
    first.resolve()
    await Promise.all([a, b, c])
    expect(order).toEqual(['a', 'c', 'b'])
  })

  it('passes results and failures through, and keeps going after a failure', async () => {
    const q = createReadQueue(1)
    await expect(q.run(async () => { throw new Error('gone') })).rejects.toThrow('gone')
    await expect(q.run(async () => 7)).resolves.toBe(7)
  })
})

describe('byte cache', () => {
  const buf = (n: number) => new ArrayBuffer(n)

  it('loads once and serves later reads from memory', async () => {
    const cache = createByteCache(100)
    let loads = 0
    const load = async () => { loads++; return buf(10) }
    const [x, y] = await Promise.all([cache.get('a', load), cache.get('a', load)])
    await cache.get('a', load)
    expect(loads).toBe(1)
    expect(x).toBe(y)
  })

  it('drops the least recently used file over budget', async () => {
    const cache = createByteCache(100)
    await cache.get('a', async () => buf(40))
    await cache.get('b', async () => buf(40))
    await cache.get('a', async () => buf(40))              // a is now the newer
    await cache.get('c', async () => buf(40))              // 120 > 100: b goes
    expect(cache.peek('a')).toBeDefined()
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.peek('c')).toBeDefined()
  })

  it('does not hold a file bigger than half the budget', async () => {
    const cache = createByteCache(100)
    await cache.get('small', async () => buf(10))
    await cache.get('big', async () => buf(60))
    expect(cache.peek('big')).toBeUndefined()
    expect(cache.peek('small')).toBeDefined()
  })

  it('loads again after a failed load', async () => {
    const cache = createByteCache(100)
    await expect(cache.get('a', async () => { throw new Error('busy') })).rejects.toThrow('busy')
    await expect(cache.get('a', async () => buf(5))).resolves.toHaveProperty('byteLength', 5)
  })
})
