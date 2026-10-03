/**
 * 跨标签页互斥锁。
 *
 * 两个标签页同时保存时，需要保证「读余量 → 占位 → 写回」这一段临界区
 * 同一时刻只有一个标签页在执行，从而先到的一方占名额、后到的一方能看到
 * 最新余量。
 *
 * 优先使用浏览器原生 Web Locks API（跨标签页/跨 worker 互斥）；
 * 不支持时退化为基于 localStorage 的租约锁（token + TTL，崩溃自动释放）。
 */

const LOCK_KEY = 'bus_material_lock'
const LOCK_TTL = 4000 // 租约有效期(ms)，持锁方崩溃后自动释放
const LOCK_TIMEOUT = 8000 // 最长等待锁的时间
const POLL_INTERVAL = 30

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function makeToken(): string {
  return JSON.stringify({ t: Date.now(), r: Math.random().toString(36).slice(2) })
}

interface LockManagerLike {
  request: <T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => T | Promise<T>,
  ) => Promise<T>
}

function getWebLocks(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks
  return locks ?? null
}

async function withWebLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const locks = getWebLocks()!
  return await locks.request(key, { mode: 'exclusive' }, async () => await fn())
}

/** localStorage 租约锁：靠「写后重读确认归属」解决两个标签页同时写的竞态 */
async function withStorageLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const start = Date.now()
  let token = ''

  for (;;) {
    const raw = localStorage.getItem(key)
    const now = Date.now()
    let expired = true
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { t?: number }
        expired = typeof parsed.t === 'number' && now - parsed.t > LOCK_TTL ? true : !parsed.t
      } catch {
        expired = true
      }
    }

    if (!raw || expired) {
      token = makeToken()
      localStorage.setItem(key, token)
      // 写完再读一次确认归属：两个标签页同时 setItem 时后写者占优，
      // 先写者重读发现不是自己的 token，说明锁被抢走，需重新排队。
      if (localStorage.getItem(key) === token) break
    }

    if (Date.now() - start > LOCK_TIMEOUT) {
      throw new Error('获取素材锁超时，请稍后重试')
    }
    await delay(POLL_INTERVAL + Math.random() * 40)
  }

  try {
    return await fn()
  } finally {
    // 只释放自己持有的锁，避免误删别人的锁
    if (localStorage.getItem(key) === token) localStorage.removeItem(key)
  }
}

export async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  if (getWebLocks()) {
    try {
      return await withWebLock(LOCK_KEY, fn)
    } catch {
      // Web Locks 异常（如权限策略禁用）时退回 localStorage 锁
    }
  }
  return await withStorageLock(LOCK_KEY, fn)
}
