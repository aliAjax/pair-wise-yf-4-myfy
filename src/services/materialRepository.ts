import type {
  Material,
  QueuedMaterial,
  SlotReservation,
  EnlistResult,
  CommitResult,
  SceneContent,
} from '@/types'
import { defaultKV, readJSON, writeJSON } from './storage'
import type { KV } from './storage'

export const MATERIALS_KEY = 'bus_window_materials_v2'

/** 素材单容量上限（含正在占位的名额） */
export const MATERIAL_CAPACITY = 8
/** 占位保留时长：超时视为写入中断，名额回收 */
export const RESERVATION_TTL_MS = 5 * 60 * 1000

type TokenState = 'reserved' | 'committed' | 'queued' | 'released'

interface TokenRecord {
  kind: 'material' | 'queue'
  materialId: string
  state: TokenState
  versionId: string
  sceneId: string
}

export interface MaterialDoc {
  materials: Material[]
  queue: QueuedMaterial[]
  reservations: SlotReservation[]
  tokenIndex: Record<string, TokenRecord>
}

function emptyDoc(): MaterialDoc {
  return { materials: [], queue: [], reservations: [], tokenIndex: {} }
}

function readDoc(kv: KV): MaterialDoc {
  const doc = readJSON<MaterialDoc>(kv, MATERIALS_KEY, emptyDoc())
  return {
    materials: doc.materials ?? [],
    queue: doc.queue ?? [],
    reservations: doc.reservations ?? [],
    tokenIndex: doc.tokenIndex ?? {},
  }
}

function writeDoc(kv: KV, doc: MaterialDoc): void {
  writeJSON(kv, MATERIALS_KEY, doc)
}

/** 有效（未超时）的占位 */
function activeReservations(doc: MaterialDoc, now: number): SlotReservation[] {
  return doc.reservations.filter((r) => r.expiresAt > now)
}

/** 已占用名额 = 已落单素材 + 有效占位 */
export function usedSlots(doc: MaterialDoc, now = Date.now()): number {
  return doc.materials.length + activeReservations(doc, now).length
}

export function remainingSlots(doc: MaterialDoc, now = Date.now()): number {
  return Math.max(0, MATERIAL_CAPACITY - usedSlots(doc, now))
}

/**
 * 回收超时占位：把名额让出来，令牌记为 released
 * （之后拿同一令牌重提不会重复占第二个名额）。
 */
function gcReservations(doc: MaterialDoc, now: number): void {
  const alive: SlotReservation[] = []
  for (const r of doc.reservations) {
    if (r.expiresAt > now) {
      alive.push(r)
    } else {
      const rec = doc.tokenIndex[r.token]
      if (rec && rec.state === 'reserved') rec.state = 'released'
    }
  }
  doc.reservations = alive
}

/**
 * 排队补位：有名额空余时，按排队先后自动落单（落单即已提交，无需再占位）。
 */
function pumpQueue(doc: MaterialDoc, now: number): void {
  while (doc.queue.length > 0 && usedSlots(doc, now) < MATERIAL_CAPACITY) {
    const head = doc.queue.shift()!
    const material: Material = {
      id: head.id,
      sceneId: head.sceneId,
      versionId: head.versionId,
      decided: 'auto',
      addedAt: new Date(now).toISOString(),
    }
    doc.materials.push(material)
    const rec = doc.tokenIndex[head.token]
    if (rec) {
      rec.state = 'committed'
      rec.materialId = head.id
    }
  }
}

export interface EnlistOptions {
  token: string
  sceneId: string
  versionId: string
  now?: number
}

/**
 * 第一阶段：领取名额。
 *
 * - 有余量：占位（reserved），作者随后必须 commit 写入；
 * - 无余量：排队（queued），名额释放后按 FIFO 自动补位；
 * - 同一 token 重复调用：原样返回第一次的结果，绝不二次占位。
 *
 * 整个「读余量 → 占位/排队 → 写回」是一个同步 CAS，
 * 两个标签页同时领取时，后写者一定能读到先写者占掉的名额。
 */
export function enlistMaterial(
  options: EnlistOptions,
  kv: KV = defaultKV,
): EnlistResult {
  const { token, sceneId, versionId } = options
  const now = options.now ?? Date.now()
  const doc = readDoc(kv)
  gcReservations(doc, now)
  pumpQueue(doc, now)

  const existing = doc.tokenIndex[token]
  if (existing && existing.state !== 'released') {
    if (existing.state === 'committed') {
      return {
        outcome: 'duplicate',
        materialId: existing.materialId,
        remaining: remainingSlots(doc, now),
      }
    }
    if (existing.state === 'queued') {
      const position = doc.queue.findIndex((q) => q.token === token) + 1
      return {
        outcome: 'duplicate',
        token,
        materialId: existing.materialId,
        queuePosition: position > 0 ? position : undefined,
        remaining: 0,
      }
    }
    // reserved：写入中断后重试，沿用原占位
    return {
      outcome: 'duplicate',
      token,
      materialId: existing.materialId,
      remaining: remainingSlots(doc, now),
    }
  }

  const materialId = crypto.randomUUID()
  let outcome: EnlistResult['outcome']

  if (usedSlots(doc, now) < MATERIAL_CAPACITY) {
    doc.reservations.push({
      token,
      kind: 'material',
      materialId,
      sceneId,
      versionId,
      createdAt: now,
      expiresAt: now + RESERVATION_TTL_MS,
    })
    doc.tokenIndex[token] = {
      kind: 'material',
      materialId,
      state: 'reserved',
      versionId,
      sceneId,
    }
    outcome = 'reserved'
  } else {
    doc.queue.push({
      id: materialId,
      sceneId,
      versionId,
      enqueuedAt: new Date(now).toISOString(),
      token,
    })
    doc.tokenIndex[token] = {
      kind: 'queue',
      materialId,
      state: 'queued',
      versionId,
      sceneId,
    }
    outcome = 'queued'
  }

  const queuePosition =
    outcome === 'queued'
      ? doc.queue.findIndex((q) => q.token === token) + 1
      : undefined

  writeDoc(kv, doc)
  return {
    outcome,
    token,
    materialId,
    queuePosition,
    remaining: remainingSlots(readDoc(kv), now),
  }
}

/**
 * 第二阶段：凭令牌写入素材，核销占位。
 * 同一令牌重复提交幂等返回，不会再落一条素材。
 */
export function commitMaterial(
  token: string,
  extras?: { legacySnapshot?: Partial<SceneContent>; migrationNote?: string },
  kv: KV = defaultKV,
): CommitResult {
  const now = Date.now()
  const doc = readDoc(kv)
  gcReservations(doc, now)

  const rec = doc.tokenIndex[token]
  if (!rec) return { ok: false, remaining: remainingSlots(doc, now) }

  if (rec.state === 'committed') {
    pumpQueue(doc, now)
    writeDoc(kv, doc)
    return {
      ok: true,
      alreadyCommitted: true,
      materialId: rec.materialId,
      remaining: remainingSlots(readDoc(kv), now),
    }
  }

  if (rec.state !== 'reserved') {
    return { ok: false, remaining: remainingSlots(doc, now) }
  }

  const idx = doc.reservations.findIndex((r) => r.token === token)
  if (idx === -1) {
    rec.state = 'released'
    writeDoc(kv, doc)
    return { ok: false, remaining: remainingSlots(readDoc(kv), now) }
  }

  const reservation = doc.reservations[idx]
  doc.reservations.splice(idx, 1)
  doc.materials.push({
    id: reservation.materialId,
    sceneId: reservation.sceneId,
    versionId: reservation.versionId,
    decided: 'auto',
    addedAt: new Date(now).toISOString(),
    legacySnapshot: extras?.legacySnapshot,
    migrationNote: extras?.migrationNote,
  })
  rec.state = 'committed'
  pumpQueue(doc, now)
  writeDoc(kv, doc)
  return {
    ok: true,
    materialId: reservation.materialId,
    remaining: remainingSlots(readDoc(kv), now),
  }
}

/**
 * 写入失败回滚：释放占位/取消排队，令牌作废（released），
 * 并立刻让排队素材补位。之后可重新领取、重试，不会残留重复名额。
 */
export function abortEnlist(token: string, kv: KV = defaultKV): number {
  const now = Date.now()
  const doc = readDoc(kv)
  gcReservations(doc, now)

  const rec = doc.tokenIndex[token]
  if (rec && rec.state === 'reserved') {
    doc.reservations = doc.reservations.filter((r) => r.token !== token)
    rec.state = 'released'
  } else if (rec && rec.state === 'queued') {
    doc.queue = doc.queue.filter((q) => q.token !== token)
    rec.state = 'released'
  }

  pumpQueue(doc, now)
  writeDoc(kv, doc)
  return remainingSlots(readDoc(kv), now)
}

/** 窗景修订后，引用该窗景的素材全部失效重算（重新等作者选择） */
export function invalidateMaterialsForScene(
  sceneId: string,
  kv: KV = defaultKV,
): void {
  const doc = readDoc(kv)
  let changed = false
  for (const m of doc.materials) {
    if (m.sceneId === sceneId && m.decided !== 'auto') {
      m.decided = 'auto'
      changed = true
    }
  }
  if (changed) writeDoc(kv, doc)
}

/** 采用窗景新版本 */
export function adoptNewVersion(
  materialId: string,
  newVersionId: string,
  kv: KV = defaultKV,
): void {
  const doc = readDoc(kv)
  const material = doc.materials.find((m) => m.id === materialId)
  if (!material) return
  material.versionId = newVersionId
  material.decided = 'adopted'
  writeDoc(kv, doc)
}

/** 留用旧版本 */
export function keepOldVersion(materialId: string, kv: KV = defaultKV): void {
  const doc = readDoc(kv)
  const material = doc.materials.find((m) => m.id === materialId)
  if (!material) return
  material.decided = 'kept'
  writeDoc(kv, doc)
}

export function removeMaterial(materialId: string, kv: KV = defaultKV): void {
  const now = Date.now()
  const doc = readDoc(kv)
  gcReservations(doc, now)
  doc.materials = doc.materials.filter((m) => m.id !== materialId)
  for (const rec of Object.values(doc.tokenIndex)) {
    if (rec.materialId === materialId && rec.state === 'committed') {
      rec.state = 'released'
    }
  }
  pumpQueue(doc, now)
  writeDoc(kv, doc)
}

export interface MigrationInsert {
  id: string
  sceneId: string
  versionId: string
  legacySnapshot?: Partial<SceneContent>
  migrationNote?: string
  addedAt?: string
}

/**
 * 迁移专用写入：旧素材转成引用式落单。
 * 尊重容量——满了同样进队列，等名额释放后补位。
 */
export function insertMigratedMaterial(
  entry: MigrationInsert,
  kv: KV = defaultKV,
): { queued: boolean; position: number; materialId: string } {
  const now = Date.now()
  const doc = readDoc(kv)
  gcReservations(doc, now)
  pumpQueue(doc, now)

  const token = `migrate:${entry.id}`
  if (doc.tokenIndex[token]) {
    const position = doc.queue.findIndex((q) => q.token === token) + 1
    return {
      queued: position > 0,
      position: position > 0 ? position : 0,
      materialId: entry.id,
    }
  }

  if (usedSlots(doc, now) >= MATERIAL_CAPACITY) {
    doc.queue.push({
      id: entry.id,
      sceneId: entry.sceneId,
      versionId: entry.versionId,
      enqueuedAt: entry.addedAt ?? new Date(now).toISOString(),
      token,
    })
    doc.tokenIndex[token] = {
      kind: 'queue',
      materialId: entry.id,
      state: 'queued',
      versionId: entry.versionId,
      sceneId: entry.sceneId,
    }
    const position = doc.queue.length
    writeDoc(kv, doc)
    return { queued: true, position, materialId: entry.id }
  }

  doc.materials.push({
    id: entry.id,
    sceneId: entry.sceneId,
    versionId: entry.versionId,
    decided: 'auto',
    addedAt: entry.addedAt ?? new Date(now).toISOString(),
    legacySnapshot: entry.legacySnapshot,
    migrationNote: entry.migrationNote,
  })
  doc.tokenIndex[token] = {
    kind: 'material',
    materialId: entry.id,
    state: 'committed',
    versionId: entry.versionId,
    sceneId: entry.sceneId,
  }
  writeDoc(kv, doc)
  return { queued: false, position: 0, materialId: entry.id }
}

export function getMaterialDoc(kv: KV = defaultKV): MaterialDoc {
  const now = Date.now()
  const doc = readDoc(kv)
  gcReservations(doc, now)
  return doc
}

/** 仅用于开发/演示：清空素材单 */
export function resetMaterials(kv: KV = defaultKV): void {
  writeDoc(kv, emptyDoc())
}
