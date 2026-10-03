/**
 * 通用 KV 层。
 *
 * 所有数据共用 localStorage，并发正确性依赖浏览器的两个保证：
 * 1. 同步 JS 执行块不会被另一个标签页中断；
 * 2. 一次 `setItem` 对其它标签页是原子可见的。
 * 因此「读 → 改 → 写」放在同一个同步函数里，就是一次 CAS；
 * 标签页之间通过 `storage` 事件看到对方提交后的余量。
 */

export interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const memoryStore = new Map<string, string>()

/** 非浏览器环境（单测）下的内存实现 */
export const memoryKV: KV = {
  getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key)! : null),
  setItem: (key, value) => void memoryStore.set(key, value),
  removeItem: (key) => void memoryStore.delete(key),
}

export const defaultKV: KV =
  typeof localStorage !== 'undefined'
    ? localStorage
    : memoryKV

export function readJSON<T>(kv: KV, key: string, fallback: T): T {
  try {
    const raw = kv.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJSON(kv: KV, key: string, value: unknown): void {
  kv.setItem(key, JSON.stringify(value))
}

/** 旧素材单的存储键 */
export const LEGACY_MATERIALS_KEY = 'bus_window_materials'
/** 旧窗景列表的存储键（迁移后备份保留） */
export const LEGACY_SCENES_KEY = 'bus_window_scenes'
