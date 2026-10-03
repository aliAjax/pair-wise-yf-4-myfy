import type {
  WindowScene,
  Material,
  QueuedMaterial,
  MaterialMeta,
  LegacyMaterial,
  MaterialStatus,
} from '@/types'
import { MATERIAL_CAPACITY } from '@/types'
import { getAllScenes } from './storage'
import { withLock } from '@/utils/lock'

const MATERIALS_KEY = 'bus_materials'
const QUEUE_KEY = 'bus_material_queue'
const META_KEY = 'bus_meta'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------- 底层读写 ----------

function readRawMaterials(): unknown[] {
  try {
    const raw = localStorage.getItem(MATERIALS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeRawMaterials(arr: unknown[]): void {
  localStorage.setItem(MATERIALS_KEY, JSON.stringify(arr))
}

function isMaterial(m: unknown): m is Material {
  return (
    !!m &&
    typeof m === 'object' &&
    typeof (m as Material).id === 'string' &&
    typeof (m as Material).sceneId === 'string' &&
    typeof (m as Material).snapshot === 'object'
  )
}

function isLegacy(m: unknown): m is LegacyMaterial {
  return (
    !!m &&
    typeof m === 'object' &&
    typeof (m as LegacyMaterial).id === 'string' &&
    typeof (m as Material).sceneId !== 'string'
  )
}

function readMaterials(): Material[] {
  return readRawMaterials().filter(isMaterial)
}

function writeMaterials(materials: Material[]): void {
  writeRawMaterials(materials)
}

function readQueue(): QueuedMaterial[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as QueuedMaterial[]) : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedMaterial[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

function defaultMeta(): MaterialMeta {
  return { schemaVersion: 1, materialMigration: { status: 'idle', total: 0, doneIds: [] } }
}

function readMeta(): MaterialMeta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return defaultMeta()
    const parsed = JSON.parse(raw) as Partial<MaterialMeta>
    const mm: Partial<MaterialMeta['materialMigration']> = parsed.materialMigration ?? {}
    return {
      schemaVersion: parsed.schemaVersion ?? 1,
      materialMigration: {
        status: mm.status ?? 'idle',
        total: mm.total ?? 0,
        doneIds: Array.isArray(mm.doneIds) ? mm.doneIds : [],
        startedAt: mm.startedAt,
        finishedAt: mm.finishedAt,
      },
    }
  } catch {
    return defaultMeta()
  }
}

function writeMeta(meta: MaterialMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

// ---------- 状态重算 ----------

/**
 * 根据窗景当前版本重算素材状态：
 * - kept：作者已主动留用旧版，保持
 * - 窗景不存在 → orphaned（素材留着标失效）
 * - 素材版本 < 窗景版本 → stale（窗景已修订）
 * - 否则 valid
 */
export function recomputeStatus(materials: Material[], scenes: WindowScene[]): Material[] {
  let changed = false
  const next = materials.map((m) => {
    if (m.status === 'kept') return m
    let status: MaterialStatus
    if (!m.sceneId) {
      status = 'orphaned'
    } else {
      const scene = scenes.find((s) => s.id === m.sceneId)
      if (!scene) {
        status = 'orphaned'
      } else {
        const sceneVersion = scene.version ?? 1
        status = m.version < sceneVersion ? 'stale' : 'valid'
      }
    }
    if (status !== m.status) {
      changed = true
      return { ...m, status }
    }
    return m
  })
  return changed ? next : materials
}

/** 窗景增删改后调用：刷新素材状态并落盘 */
export function refreshMaterialStatuses(): void {
  const scenes = getAllScenes()
  const materials = recomputeStatus(readMaterials(), scenes)
  writeMaterials(materials)
}

// ---------- 旧数据迁移（引用式） ----------

function legacyToScene(item: LegacyMaterial): WindowScene {
  return {
    id: '',
    routeName: item.routeName ?? '',
    segment: item.segment ?? '',
    seatDirection: item.seatDirection ?? '左',
    timestamp: item.timestamp ?? item.addedAt ?? new Date().toISOString(),
    weather: item.weather ?? '晴',
    signText: item.signText ?? '',
    treeDensity: item.treeDensity ?? '适中',
    pedestrianStatus: item.pedestrianStatus ?? '稀少',
    note: item.note ?? '',
    version: 1,
  }
}

function convertLegacy(item: LegacyMaterial, scenes: WindowScene[]): Material {
  // 引用式迁移：按内容匹配回对应的窗景
  const match =
    scenes.find(
      (s) =>
        s.routeName === item.routeName &&
        s.segment === item.segment &&
        (item.signText == null || s.signText === item.signText) &&
        (item.note == null || s.note === item.note),
    ) ?? scenes.find((s) => s.routeName === item.routeName && s.segment === item.segment)

  if (match) {
    return {
      id: item.id,
      sceneId: match.id,
      version: match.version ?? 1,
      snapshot: match,
      status: 'valid',
      addedAt: item.addedAt ?? new Date().toISOString(),
      requestId: item.id,
    }
  }
  // 原窗景已移除：素材留着，标成失效
  return {
    id: item.id,
    sceneId: '',
    version: 0,
    snapshot: legacyToScene(item),
    status: 'orphaned',
    addedAt: item.addedAt ?? new Date().toISOString(),
    requestId: item.id,
  }
}

/**
 * 把旧版「内联复制正文」的素材迁移成引用式。
 * 进度逐条落盘（doneIds + 原地替换），中途中断后下次调用会跳过已迁移项接着补。
 */
export async function migrateMaterials(): Promise<{ migrated: number; total: number; ran: boolean }> {
  const meta = readMeta()
  if (meta.materialMigration.status === 'done') return { migrated: 0, total: 0, ran: false }

  const scenes = getAllScenes()
  const raw = readRawMaterials()
  const legacy = raw.filter(isLegacy)

  if (legacy.length === 0) {
    meta.materialMigration.status = 'done'
    meta.materialMigration.total = 0
    meta.materialMigration.finishedAt = new Date().toISOString()
    writeMeta(meta)
    return { migrated: 0, total: 0, ran: false }
  }

  meta.materialMigration.status = 'running'
  meta.materialMigration.total = legacy.length
  if (!meta.materialMigration.startedAt) meta.materialMigration.startedAt = new Date().toISOString()
  writeMeta(meta)

  let migrated = 0
  for (const item of legacy) {
    if (meta.materialMigration.doneIds.includes(item.id)) continue
    const idx = raw.findIndex((m) => isLegacy(m) && (m as LegacyMaterial).id === item.id)
    if (idx < 0) continue

    raw[idx] = convertLegacy(item, scenes)
    meta.materialMigration.doneIds.push(item.id)
    migrated++
    writeRawMaterials(raw)
    writeMeta(meta)
    // 让出事件循环：进度可观察；即便这里被打断，下次也能从 doneIds 续跑
    await delay(60)
  }

  meta.materialMigration.status = 'done'
  meta.materialMigration.finishedAt = new Date().toISOString()
  writeMeta(meta)
  return { migrated, total: legacy.length, ran: true }
}

// ---------- 查询 ----------

export interface MaterialState {
  materials: Material[]
  queue: QueuedMaterial[]
  meta: MaterialMeta
}

export function getMaterialState(): MaterialState {
  const scenes = getAllScenes()
  const materials = recomputeStatus(readMaterials(), scenes)
  return { materials, queue: readQueue(), meta: readMeta() }
}

// ---------- 写入操作（全部在跨标签页锁内进行） ----------

export type AddResult =
  | { status: 'added'; material: Material; remaining: number }
  | { status: 'queued'; queueEntry: QueuedMaterial; position: number; remaining: number }
  | { status: 'exists'; material: Material; remaining: number }
  | { status: 'error'; reason: string }

function remainingSlots(materials: Material[]): number {
  return Math.max(0, MATERIAL_CAPACITY - materials.length)
}

/**
 * 收录素材。
 * - 整个「读余量 → 占位 → 写回」在锁内执行，两个标签页并发时先到先得，
 *   后到的一定能读到最新余量。
 * - requestId 幂等：写失败后用同一 requestId 重试，不会重复占位。
 */
export async function addMaterial(sceneId: string, requestId: string): Promise<AddResult> {
  try {
    return await withLock(() => {
      const materials = readMaterials()
      const queue = readQueue()
      const scenes = getAllScenes()

      // 幂等去重：同一次请求重试，或同一窗景已收录 → 直接返回，不占名额
      const dupMaterial = materials.find(
        (m) => m.requestId === requestId || (sceneId !== '' && m.sceneId === sceneId),
      )
      if (dupMaterial) {
        return { status: 'exists', material: dupMaterial, remaining: remainingSlots(materials) }
      }
      const dupQueue = queue.find((q) => q.requestId === requestId || q.sceneId === sceneId)
      if (dupQueue) {
        return { status: 'queued', queueEntry: dupQueue, position: dupQueue.position, remaining: 0 }
      }

      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return { status: 'error', reason: '找不到对应的窗景，可能已被删除' }

      const now = new Date().toISOString()

      if (materials.length >= MATERIAL_CAPACITY) {
        // 容量满：新素材先排队
        const entry: QueuedMaterial = {
          id: `q_${crypto.randomUUID()}`,
          sceneId,
          version: scene.version ?? 1,
          snapshot: { ...scene },
          queuedAt: now,
          requestId,
          position: queue.length + 1,
        }
        queue.push(entry)
        writeQueue(queue)
        return { status: 'queued', queueEntry: entry, position: entry.position, remaining: 0 }
      }

      const material: Material = {
        id: `m_${crypto.randomUUID()}`,
        sceneId,
        version: scene.version ?? 1,
        snapshot: { ...scene },
        status: 'valid',
        addedAt: now,
        requestId,
      }
      materials.push(material)
      writeMaterials(materials)
      return { status: 'added', material, remaining: remainingSlots(materials) }
    })
  } catch (e) {
    return { status: 'error', reason: e instanceof Error ? e.message : '保存失败，请重试' }
  }
}

function promoteQueue(
  materials: Material[],
  queue: QueuedMaterial[],
): { materials: Material[]; queue: QueuedMaterial[] } {
  if (queue.length === 0) return { materials, queue }
  const [next, ...rest] = queue
  const promoted: Material = {
    id: `m_${crypto.randomUUID()}`,
    sceneId: next.sceneId,
    version: next.version,
    snapshot: next.snapshot,
    status: 'valid',
    addedAt: new Date().toISOString(),
    requestId: next.requestId,
  }
  materials.push(promoted)
  return { materials, queue: rest.map((q, i) => ({ ...q, position: i + 1 })) }
}

/** 移除素材；若有空位，排队中的队首自动补入 */
export async function removeMaterial(id: string): Promise<{ removed: boolean }> {
  return await withLock(() => {
    const materials = readMaterials()
    const idx = materials.findIndex((m) => m.id === id)
    if (idx < 0) return { removed: false }
    materials.splice(idx, 1)

    const queue = readQueue()
    const result = promoteQueue(materials, queue)
    writeMaterials(result.materials)
    writeQueue(result.queue)
    return { removed: true }
  })
}

/** 清空所有失效（orphaned）素材，空位由排队补入 */
export async function clearOrphaned(): Promise<{ removed: number }> {
  return await withLock(() => {
    const scenes = getAllScenes()
    let materials = recomputeStatus(readMaterials(), scenes)
    const orphaned = materials.filter((m) => m.status === 'orphaned')
    if (orphaned.length === 0) return { removed: 0 }
    materials = materials.filter((m) => m.status !== 'orphaned')

    let queue = readQueue()
    // 空位由排队依次补入，直到填满或队列空
    while (queue.length > 0 && materials.length < MATERIAL_CAPACITY) {
      const [next, ...rest] = queue
      materials.push({
        id: `m_${crypto.randomUUID()}`,
        sceneId: next.sceneId,
        version: next.version,
        snapshot: next.snapshot,
        status: 'valid',
        addedAt: new Date().toISOString(),
        requestId: next.requestId,
      })
      queue = rest.map((q, i) => ({ ...q, position: i + 1 }))
    }
    writeMaterials(materials)
    writeQueue(queue)
    return { removed: orphaned.length }
  })
}

/**
 * 处理失效素材：
 * - update：重新快照当前窗景（更新到新版本）；窗景已删则保持失效
 * - keep：留用旧版本（不再提示）
 */
export async function resolveMaterial(
  id: string,
  decision: 'update' | 'keep',
): Promise<{ ok: boolean }> {
  return await withLock(() => {
    const materials = readMaterials()
    const idx = materials.findIndex((m) => m.id === id)
    if (idx < 0) return { ok: false }
    const m = materials[idx]

    if (decision === 'keep') {
      materials[idx] = { ...m, status: 'kept' }
    } else {
      const scenes = getAllScenes()
      const scene = scenes.find((s) => s.id === m.sceneId)
      if (scene) {
        materials[idx] = {
          ...m,
          version: scene.version ?? 1,
          snapshot: { ...scene },
          status: 'valid',
        }
      } else {
        materials[idx] = { ...m, status: 'orphaned' }
      }
    }
    writeMaterials(materials)
    return { ok: true }
  })
}
