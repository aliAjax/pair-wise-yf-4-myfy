import { create } from 'zustand'
import type {
  SceneView,
  SceneFormData,
  MaterialView,
  QueuedMaterial,
  SlotReservation,
  MigrationState,
  EnlistResult,
} from '@/types'
import {
  migrateLegacyScenes,
  getSceneViews,
  createScene as repoCreateScene,
  reviseScene as repoReviseScene,
  removeScene as repoRemoveScene,
  getSceneById,
} from '@/services/sceneRepository'
import {
  getMaterialDoc,
  enlistMaterial,
  commitMaterial,
  abortEnlist as repoAbortEnlist,
  invalidateMaterialsForScene,
  adoptNewVersion as repoAdopt,
  keepOldVersion as repoKeep,
  removeMaterial as repoRemoveMaterial,
  MATERIAL_CAPACITY,
  remainingSlots,
} from '@/services/materialRepository'
import {
  ensureMigration,
  runMigrationBatch,
  readMigrationState,
  readLegacyMaterials,
  seedLegacyMaterials,
} from '@/services/migration'
import { resetMaterials } from '@/services/materialRepository'
import { buildMaterialViews } from '@/services/materialViews'

const SUBSCRIBED_KEYS = [
  'bus_window_scenes_v2',
  'bus_window_materials_v2',
  'bus_window_materials_migration',
]

type SavePhase = 'reserved' | 'queued' | 'committed' | 'failed'

/** 当前标签页自己领取但还没完成的名额（写失败/中断可见、可重试） */
interface LocalPending {
  token: string
  phase: SavePhase
  materialId?: string
  queuePosition?: number
  sceneId: string
  versionId: string
  failNext: boolean
}

interface SaveResult {
  outcome: EnlistResult
  phase: SavePhase
}

interface SceneState {
  booted: boolean
  scenes: SceneView[]
  routeNames: string[]
  currentRouteScenes: SceneView[]
  selectedRoute: string
  randomScene: SceneView | null

  materialViews: MaterialView[]
  queue: QueuedMaterial[]
  reservations: SlotReservation[]
  used: number
  capacity: number
  migration: MigrationState | null
  localPending: LocalPending | null
  notice: string | null

  loadAll: () => void
  saveScene: (data: SceneFormData) => void
  reviseScene: (id: string, data: SceneFormData) => boolean
  deleteScene: (id: string) => void
  selectRoute: (routeName: string) => void
  refreshRandom: () => void

  saveMaterial: (sceneId: string, versionId: string, failWrite?: boolean) => SaveResult
  retrySaveMaterial: () => SaveResult
  cancelSaveMaterial: () => void
  adoptVersion: (materialId: string, versionId: string) => void
  keepVersion: (materialId: string) => void
  discardMaterial: (materialId: string) => void
  clearNotice: () => void

  continueMigration: () => void
  autoMigrate: () => void
  seedLegacy: () => void
  resetAll: () => void
  simulateOtherTabGrab: (sceneId: string, versionId: string) => void
}

function hydrate(partial?: Partial<SceneState>): Partial<SceneState> {
  const scenes = getSceneViews()
  const routeNames = Array.from(new Set(scenes.map((s) => s.routeName))).sort()
  const doc = getMaterialDoc()
  const prev = useSceneStore.getState()
  const selectedRoute = partial?.selectedRoute ?? prev.selectedRoute ?? ''
  // 随机窗景若仍存在则保留，否则（如被移除）清空
  const randomScene =
    partial?.randomScene === null
      ? null
      : prev.randomScene
        ? scenes.find((s) => s.id === prev.randomScene!.id) ?? null
        : null
  return {
    scenes,
    routeNames,
    randomScene,
    currentRouteScenes: selectedRoute
      ? scenes.filter((s) => s.routeName === selectedRoute)
      : [],
    materialViews: buildMaterialViews(doc),
    queue: doc.queue,
    reservations: doc.reservations,
    used: doc.materials.length + doc.reservations.length,
    migration: readMigrationState(),
    ...(partial ?? {}),
  }
}

function pickRandomScene(scenes: SceneView[]): SceneView | null {
  if (scenes.length === 0) return null
  return scenes[Math.floor(Math.random() * scenes.length)]
}

let hydrated = false

export const useSceneStore = create<SceneState>((set, get) => {
  const reload = (overrides: Partial<SceneState> = {}) => {
    set(hydrate(overrides) as Partial<SceneState>)
  }

  /** 后台逐批迁移：每批之间让出主线程，中断/刷新后下次进来接着补 */
  const autoMigrate = () => {
    const step = () => {
      const state = readMigrationState()
      const legacy = readLegacyMaterials()
      if (!state || state.status === 'done' || legacy.length === 0) {
        reload({ migration: state })
        return
      }
      if (state.status === 'interrupted' && state.cursor >= state.total) {
        reload({ migration: state })
        return
      }
      runMigrationBatch()
      reload()
      const next = readMigrationState()
      if (next && next.status !== 'done') {
        setTimeout(step, 400)
      }
    }
    setTimeout(step, 300)
  }

  const boot = () => {
    migrateLegacyScenes()
    ensureMigration()
    reload({ booted: true })
    autoMigrate()
  }

  // 其它标签页落库后，本页通过 storage 事件看到新余量（不包含本页自身改动）
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (!e.key || !SUBSCRIBED_KEYS.includes(e.key)) return
      const { selectedRoute, localPending } = get()
      set(hydrate({ selectedRoute, localPending }) as Partial<SceneState>)
    })
  }

  return {
    booted: false,
    scenes: [],
    routeNames: [],
    currentRouteScenes: [],
    selectedRoute: '',
    randomScene: null,
    materialViews: [],
    queue: [],
    reservations: [],
    used: 0,
    capacity: MATERIAL_CAPACITY,
    migration: null,
    localPending: null,
    notice: null,

    loadAll: () => {
      if (!hydrated) {
        hydrated = true
        boot()
        return
      }
      reload({ booted: true })
    },

    saveScene: (data) => {
      repoCreateScene(data)
      reload()
    },

    reviseScene: (id, data) => {
      const revised = repoReviseScene(id, data)
      if (!revised) return false
      // 窗景一改，引用它的素材全部回到「待确认」状态
      invalidateMaterialsForScene(id)
      reload()
      return true
    },

    deleteScene: (id) => {
      repoRemoveScene(id)
      // 素材不删：引用失效由视图层呈现「窗景已移除」
      const { randomScene } = get()
      reload({ randomScene: randomScene?.id === id ? null : randomScene })
    },

    selectRoute: (routeName) => {
      const scenes = getSceneViews()
      set({
        selectedRoute: routeName,
        currentRouteScenes: routeName
          ? scenes.filter((s) => s.routeName === routeName)
          : [],
      })
    },

    refreshRandom: () => {
      set({ randomScene: pickRandomScene(getSceneViews()) })
    },

    /* ---------- 素材单：两阶段占位 + 幂等重试 ---------- */

    saveMaterial: (sceneId, versionId, failWrite = false) => {
      const token = crypto.randomUUID()
      const outcome = enlistMaterial({ token, sceneId, versionId })

      if (outcome.outcome === 'queued') {
        reload({
          localPending: {
            token,
            phase: 'queued',
            materialId: outcome.materialId,
            queuePosition: outcome.queuePosition,
            sceneId,
            versionId,
            failNext: false,
          },
          notice: '素材单已满，已进入排队，有名额释放时自动补位',
        })
        return { outcome, phase: 'queued' }
      }

      if (failWrite) {
        // 模拟「写失败」：占位已拿到但提交失败，名额保留可重试
        reload({
          localPending: {
            token,
            phase: 'failed',
            materialId: outcome.materialId,
            sceneId,
            versionId,
            failNext: true,
          },
          notice: '写入失败：名额已为你保留，可重试或放弃',
        })
        return { outcome, phase: 'failed' }
      }

      const committed = commitMaterial(token)
      reload({
        localPending: {
          token,
          phase: committed.ok ? 'committed' : 'failed',
          materialId: committed.materialId,
          sceneId,
          versionId,
          failNext: false,
        },
        notice: committed.alreadyCommitted ? '该素材此前已保存（幂等）' : null,
      })
      // 已提交的本地占位稍后清掉，让用户看到瞬时反馈即可
      if (committed.ok) {
        setTimeout(() => {
          if (get().localPending?.token === token) {
            set({ localPending: null })
          }
        }, 1200)
      }
      return { outcome, phase: committed.ok ? 'committed' : 'failed' }
    },

    retrySaveMaterial: () => {
      const pending = get().localPending
      if (!pending) {
        return {
          outcome: { outcome: 'duplicate', remaining: get().capacity - get().used },
          phase: 'failed',
        }
      }
      if (pending.phase === 'queued') {
        reload({
          localPending: { ...pending },
          notice: `仍在排队中（第 ${pending.queuePosition ?? '?'} 位）`,
        })
        return {
          outcome: {
            outcome: 'duplicate',
            token: pending.token,
            materialId: pending.materialId,
            queuePosition: pending.queuePosition,
            remaining: 0,
          },
          phase: 'queued',
        }
      }
      // 同一 token 重新提交：已占位则核销，绝不会重复占第二个名额
      const committed = commitMaterial(pending.token)
      if (committed.ok) {
        reload({
          localPending: { ...pending, phase: 'committed', failNext: false },
          notice: committed.alreadyCommitted ? '该素材此前已保存（幂等）' : '重试成功，素材已写入',
        })
        setTimeout(() => {
          if (get().localPending?.token === pending.token) {
            set({ localPending: null })
          }
        }, 1200)
        return {
          outcome: {
            outcome: 'duplicate',
            token: pending.token,
            materialId: committed.materialId,
            remaining: committed.remaining,
          },
          phase: 'committed',
        }
      }
      // 占位已超时被回收：先释放旧令牌记录，再走全新领取
      repoAbortEnlist(pending.token)
      const fresh = enlistMaterial({
        token: crypto.randomUUID(),
        sceneId: pending.sceneId,
        versionId: pending.versionId,
      })
      if (fresh.outcome === 'queued') {
        reload({
          localPending: {
            ...pending,
            token: fresh.token!,
            phase: 'queued',
            queuePosition: fresh.queuePosition,
          },
          notice: '原占位超时已回收，当前名额被占满，转为排队',
        })
        return { outcome: fresh, phase: 'queued' }
      }
      const second = commitMaterial(fresh.token!)
      reload({
        localPending: {
          ...pending,
          token: fresh.token!,
          phase: second.ok ? 'committed' : 'failed',
          failNext: false,
        },
        notice: second.ok ? '重试成功，素材已写入' : '写入仍失败，可再次重试',
      })
      if (second.ok) {
        setTimeout(() => {
          if (get().localPending?.token === fresh.token) set({ localPending: null })
        }, 1200)
      }
      return { outcome: fresh, phase: second.ok ? 'committed' : 'failed' }
    },

    cancelSaveMaterial: () => {
      const pending = get().localPending
      if (pending) {
        repoAbortEnlist(pending.token)
        // 释放名额会自动让排队素材补位
      }
      reload({ localPending: null, notice: null })
    },

    adoptVersion: (materialId, versionId) => {
      repoAdopt(materialId, versionId)
      reload()
    },

    keepVersion: (materialId) => {
      repoKeep(materialId)
      reload()
    },

    discardMaterial: (materialId) => {
      repoRemoveMaterial(materialId)
      // 删除后空位立即补位（removeMaterial 内部已 pump 队列）
      reload({ notice: '素材已移除，排队素材自动补位' })
    },

    clearNotice: () => set({ notice: null }),

    continueMigration: () => {
      const progress = runMigrationBatch()
      reload({ migration: progress })
    },

    autoMigrate,

    seedLegacy: () => {
      seedLegacyMaterials()
      ensureMigration()
      reload()
      autoMigrate()
    },

    resetAll: () => {
      resetMaterials()
      reload({ localPending: null, notice: null })
    },

    /**
     * 演示用：模拟「另一个标签页」直接占走一个名额并写入，
     * 本页下次保存时只能看到被抢走之后的余量。
     */
    simulateOtherTabGrab: (sceneId, versionId) => {
      const token = crypto.randomUUID()
      enlistMaterial({ token, sceneId, versionId })
      commitMaterial(token)
      reload({ notice: '另一标签页已抢先占走一个名额' })
    },
  }
})

export { MATERIAL_CAPACITY, remainingSlots, getSceneById }
