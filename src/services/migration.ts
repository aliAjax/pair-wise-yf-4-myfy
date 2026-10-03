import type {
  LegacyMaterial,
  MigrationState,
  SceneContent,
  WindowScene,
} from '@/types'
import { defaultKV, readJSON, writeJSON, LEGACY_MATERIALS_KEY } from './storage'
import type { KV } from './storage'
import { getAllScenes, SCENES_KEY } from './sceneRepository'
import { insertMigratedMaterial } from './materialRepository'

export const MIGRATION_STATE_KEY = 'bus_window_materials_migration'
const MIGRATION_BATCH_SIZE = 2

function defaultState(total: number): MigrationState {
  return {
    total,
    cursor: 0,
    status: total === 0 ? 'done' : 'idle',
    updatedAt: new Date().toISOString(),
  }
}

export function readLegacyMaterials(kv: KV = defaultKV): LegacyMaterial[] {
  return readJSON<LegacyMaterial[]>(kv, LEGACY_MATERIALS_KEY, [])
}

export function readMigrationState(kv: KV = defaultKV): MigrationState | null {
  return readJSON<MigrationState | null>(kv, MIGRATION_STATE_KEY, null)
}

function writeMigrationState(kv: KV, state: MigrationState): void {
  writeJSON(kv, MIGRATION_STATE_KEY, state)
}

/**
 * 首次加载时确保存在迁移进度。没有旧数据直接 done；
 * 有旧数据则记录总数、cursor=0，等驱动方开始跑。
 */
export function ensureMigration(kv: KV = defaultKV): MigrationState {
  const existing = readMigrationState(kv)
  if (existing) return existing
  const legacy = readLegacyMaterials(kv)
  const state = defaultState(legacy.length)
  writeMigrationState(kv, state)
  return state
}

function snapshotOf(legacy: LegacyMaterial): Partial<SceneContent> {
  const snapshot: Partial<SceneContent> = {}
  const keys: (keyof SceneContent)[] = [
    'routeName',
    'segment',
    'seatDirection',
    'weather',
    'signText',
    'treeDensity',
    'pedestrianStatus',
    'note',
  ]
  for (const key of keys) {
    const value = legacy[key]
    if (value !== undefined && value !== '') snapshot[key] = value as never
  }
  return snapshot
}

/**
 * 在版本化窗景中为旧素材找到对应版本引用。
 * 命中优先级：sceneId 直挂 → 快照 id → 正文完全一致 → 关键字段一致；
 * 都对不上则失链（窗景已删），素材仍以引用形式落单并保留快照兜底。
 */
function resolveReference(
  legacy: LegacyMaterial,
  scenes: WindowScene[],
): { sceneId: string; versionId: string; found: boolean } {
  if (legacy.sceneId) {
    const scene = scenes.find((s) => s.id === legacy.sceneId)
    if (scene) {
      const pinned =
        (legacy.snapshotId &&
          scene.versions.find((v) => v.id === legacy.snapshotId)) ||
        scene.versions[scene.versions.length - 1]
      return { sceneId: scene.id, versionId: pinned.id, found: true }
    }
  }

  const snapshot = snapshotOf(legacy)
  for (const scene of scenes) {
    for (const version of scene.versions) {
      const c = version.content
      if (
        (legacy.snapshotId && version.id === legacy.snapshotId) ||
        (legacy.note !== undefined &&
          legacy.note !== '' &&
          c.note === legacy.note &&
          c.segment === legacy.segment &&
          c.routeName === legacy.routeName) ||
        (c.routeName === snapshot.routeName &&
          c.segment === snapshot.segment &&
          c.weather === snapshot.weather &&
          c.signText === snapshot.signText &&
          c.note === snapshot.note &&
          (snapshot.note !== undefined || snapshot.segment !== undefined))
      ) {
        return { sceneId: scene.id, versionId: version.id, found: true }
      }
    }
  }

  // 找不到窗景：引用指向不存在的目标，渲染时呈现「失效」，快照兜底
  return {
    sceneId: legacy.sceneId ?? `missing:${legacy.id ?? crypto.randomUUID()}`,
    versionId: legacy.snapshotId ?? 'missing',
    found: false,
  }
}

export interface MigrationProgress extends MigrationState {
  batchCount: number
  queuedCount: number
}

/**
 * 跑一批迁移。每完成一批就落一次 cursor —— 中断后回来接着补。
 */
export function runMigrationBatch(kv: KV = defaultKV): MigrationProgress {
  const legacy = readLegacyMaterials(kv)
  let state = readMigrationState(kv) ?? defaultState(legacy.length)

  if (state.status === 'done') {
    return { ...state, batchCount: 0, queuedCount: 0 }
  }

  state = { ...state, status: 'running', updatedAt: new Date().toISOString() }
  // 先标记 running，保证这批处理中页面被关掉也能识别为「中断」
  writeMigrationState(kv, state)

  const scenes = getAllScenes(kv)
  const end = Math.min(state.cursor + MIGRATION_BATCH_SIZE, legacy.length)
  let batchCount = 0
  let queuedCount = 0

  for (let i = state.cursor; i < end; i++) {
    const item = legacy[i]
    const id = item.id ?? `legacy-material-${i}`
    const resolved = resolveReference(item, scenes)
    const result = insertMigratedMaterial(
      {
        id,
        sceneId: resolved.sceneId,
        versionId: resolved.versionId,
        legacySnapshot: snapshotOf(item),
        migrationNote: resolved.found
          ? '由旧版正文快照迁移为引用'
          : '旧窗景已不存在，保留快照兜底',
        addedAt: item.addedAt,
      },
      kv,
    )
    if (result.queued) queuedCount++
    batchCount++
  }

  state = {
    ...state,
    cursor: end,
    status: end >= legacy.length ? 'done' : 'interrupted',
    updatedAt: new Date().toISOString(),
  }
  writeMigrationState(kv, state)

  // 全部迁移完成后，旧素材键备份移走（旧窗景迁移时也用了同样的备份约定）
  if (state.status === 'done' && kv.getItem(LEGACY_MATERIALS_KEY)) {
    kv.setItem(
      `${LEGACY_MATERIALS_KEY}_backup`,
      JSON.stringify(legacy),
    )
    kv.removeItem(LEGACY_MATERIALS_KEY)
  }

  return { ...state, batchCount, queuedCount }
}

/** 开发/演示用：植入一批「抄正文」的旧素材，便于展示迁移 */
export function seedLegacyMaterials(kv: KV = defaultKV): void {
  const existing = readLegacyMaterials(kv)
  if (existing.length > 0) return
  if (!kv.getItem(SCENES_KEY)) return

  const scenes = getAllScenes(kv).filter((s) => !s.removed)
  if (scenes.length === 0) return

  const v0 = scenes[0].versions[0]
  const v1 = scenes[0].versions[scenes[0].versions.length - 1]
  const legacy: LegacyMaterial[] = [
    {
      id: 'seed-legacy-1',
      sceneId: scenes[0].id,
      snapshotId: v0.id,
      addedAt: v0.createdAt,
      ...v0.content,
    },
    {
      id: 'seed-legacy-2',
      sceneId: scenes[0].id,
      snapshotId: v1.id,
      addedAt: v1.createdAt,
      ...v1.content,
    },
  ]
  if (scenes[1]) {
    const v = scenes[1].versions[0]
    legacy.push({
      id: 'seed-legacy-3',
      sceneId: scenes[1].id,
      snapshotId: v.id,
      addedAt: v.createdAt,
      ...v.content,
    })
  }
  // 一条失链数据：引用的窗景已不存在
  legacy.push({
    id: 'seed-legacy-orphan',
    sceneId: 'scene-that-was-removed',
    routeName: '停运线路 999',
    segment: '已拆除的老站',
    weather: '雾',
    note: '这条记录对应的窗景后来被删掉了',
    signText: '',
    seatDirection: '左',
    treeDensity: '适中',
    pedestrianStatus: '稀少',
  })

  writeJSON(kv, LEGACY_MATERIALS_KEY, legacy)
  kv.removeItem(MIGRATION_STATE_KEY)
}
