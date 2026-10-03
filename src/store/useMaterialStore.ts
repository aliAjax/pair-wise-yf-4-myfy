import { create } from 'zustand'
import type { Material, QueuedMaterial, MaterialMeta } from '@/types'
import { MATERIAL_CAPACITY } from '@/types'
import { getAllScenes } from '@/services/storage'
import {
  migrateMaterials,
  getMaterialState,
  addMaterial as svcAddMaterial,
  removeMaterial as svcRemoveMaterial,
  resolveMaterial as svcResolveMaterial,
  clearOrphaned as svcClearOrphaned,
} from '@/services/materialService'

interface PendingRequest {
  sceneId: string
  requestId: string
}

interface MaterialState {
  materials: Material[]
  queue: QueuedMaterial[]
  meta: MaterialMeta
  capacity: number
  loading: boolean
  migrating: boolean
  error: string | null
  notice: string | null
  pending: PendingRequest | null

  loadAll: () => Promise<void>
  addMaterial: (sceneId: string) => Promise<void>
  removeMaterial: (id: string) => Promise<void>
  resolveMaterial: (id: string, decision: 'update' | 'keep') => Promise<void>
  clearOrphaned: () => Promise<void>
  retry: () => Promise<void>
  clearNotice: () => void
  seedLegacyForDemo: () => void
}

function refresh(set: (partial: Partial<MaterialState>) => void) {
  const { materials, queue, meta } = getMaterialState()
  set({ materials, queue, meta })
}

export const useMaterialStore = create<MaterialState>((set, get) => {
  // 跨标签页同步：别的标签页写入后，本标签页读最新余量/状态
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __busMaterialSync?: boolean }
    if (!w.__busMaterialSync) {
      w.__busMaterialSync = true
      window.addEventListener('storage', (e) => {
        if (
          e.key === 'bus_materials' ||
          e.key === 'bus_material_queue' ||
          e.key === 'bus_window_scenes'
        ) {
          const { materials, queue, meta } = getMaterialState()
          set({ materials, queue, meta })
        }
      })
    }
  }

  return {
    materials: [],
    queue: [],
    meta: { schemaVersion: 1, materialMigration: { status: 'idle', total: 0, doneIds: [] } },
    capacity: MATERIAL_CAPACITY,
    loading: false,
    migrating: false,
    error: null,
    notice: null,
    pending: null,

    loadAll: async () => {
      set({ loading: true, error: null })
      try {
        const pre = getMaterialState()
        if (pre.meta.materialMigration.status !== 'done') set({ migrating: true })
        await migrateMaterials()
        refresh(set)
        set({ loading: false, migrating: false })
      } catch {
        set({ loading: false, migrating: false, error: '加载素材失败，请刷新重试' })
      }
    },

    addMaterial: async (sceneId) => {
      const requestId = `req_${crypto.randomUUID()}`
      set({ pending: { sceneId, requestId }, error: null, notice: null })
      const result = await svcAddMaterial(sceneId, requestId)
      if (result.status === 'added') {
        set({ notice: '已收入素材单', pending: null })
      } else if (result.status === 'queued') {
        set({
          notice: `素材单已满，已排队（第 ${result.position} 位），有空位自动补入`,
          pending: null,
        })
      } else if (result.status === 'exists') {
        set({ notice: '该窗景已在素材单中', pending: null })
      } else {
        set({ error: result.reason || '保存失败，可重试', pending: { sceneId, requestId } })
      }
      refresh(set)
    },

    removeMaterial: async (id) => {
      await svcRemoveMaterial(id)
      refresh(set)
      set({ notice: '已移除素材，排队中的下一位已补入' })
    },

    resolveMaterial: async (id, decision) => {
      await svcResolveMaterial(id, decision)
      refresh(set)
      set({ notice: decision === 'update' ? '已更新到新版本' : '已留用旧版本' })
    },

    clearOrphaned: async () => {
      const result = await svcClearOrphaned()
      refresh(set)
      set({ notice: result.removed > 0 ? `已清除 ${result.removed} 条失效素材` : '没有失效素材' })
    },

    retry: async () => {
      const { pending } = get()
      if (!pending) return
      set({ error: null })
      const result = await svcAddMaterial(pending.sceneId, pending.requestId)
      if (result.status === 'added') {
        set({ notice: '已收入素材单', pending: null })
      } else if (result.status === 'queued') {
        set({ notice: '素材单已满，已排队', pending: null })
      } else if (result.status === 'exists') {
        set({ notice: '该窗景已在素材单中', pending: null })
      } else {
        // 仍是同一 requestId，服务端幂等，不会重复占位
        set({ error: result.reason || '保存失败，可重试', pending })
      }
      refresh(set)
    },

    clearNotice: () => set({ notice: null, error: null }),

    seedLegacyForDemo: () => {
      // 演示用：写入几条「内联复制正文」的旧版素材，触发引用式迁移
      const scenes = getAllScenes()
      const legacy: Record<string, unknown>[] = []
      const now = Date.now()

      const cloneAsLegacy = (s: (typeof scenes)[number], tag: string) => ({
        id: `legacy_${tag}_${Math.random().toString(36).slice(2, 7)}`,
        routeName: s.routeName,
        segment: s.segment,
        seatDirection: s.seatDirection,
        timestamp: s.timestamp,
        weather: s.weather,
        signText: s.signText,
        treeDensity: s.treeDensity,
        pedestrianStatus: s.pedestrianStatus,
        note: s.note,
        addedAt: s.timestamp,
      })

      if (scenes.length >= 1) legacy.push(cloneAsLegacy(scenes[0], 'a'))
      if (scenes.length >= 2) legacy.push(cloneAsLegacy(scenes[1], 'b'))
      // 一条找不到原窗景的旧素材 → 迁移后标失效
      legacy.push({
        id: `legacy_orphan_${Math.random().toString(36).slice(2, 7)}`,
        routeName: '已撤销线路',
        segment: '老城厢',
        seatDirection: '左',
        timestamp: new Date(now - 2 * 86400000).toISOString(),
        weather: '阴',
        signText: '拆',
        treeDensity: '稀疏',
        pedestrianStatus: '稀少',
        note: '围挡后面是空地，这段旧记录找不到对应窗景了',
        addedAt: new Date(now - 2 * 86400000).toISOString(),
      })

      localStorage.setItem('bus_materials', JSON.stringify(legacy))
      localStorage.setItem(
        'bus_meta',
        JSON.stringify({ schemaVersion: 1, materialMigration: { status: 'idle', total: 0, doneIds: [] } }),
      )
      void get().loadAll()
    },
  }
})
