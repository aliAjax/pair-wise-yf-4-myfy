export type SeatDirection = '左' | '右'

export type Weather = '晴' | '多云' | '阴' | '小雨' | '大雨' | '雪' | '雾'

export type TreeDensity = '稀疏' | '适中' | '茂密'

export type PedestrianStatus = '稀少' | '零星' | '密集'

export interface WindowScene {
  id: string
  routeName: string
  segment: string
  seatDirection: SeatDirection
  timestamp: string
  weather: Weather
  signText: string
  treeDensity: TreeDensity
  pedestrianStatus: PedestrianStatus
  note: string
  /** 窗景版本号：每次修订递增，素材据此判断是否失效 */
  version: number
}

export interface SceneFormData {
  routeName: string
  segment: string
  seatDirection: SeatDirection
  weather: Weather
  signText: string
  treeDensity: TreeDensity
  pedestrianStatus: PedestrianStatus
  note: string
}

/**
 * 素材状态
 * - valid: 与当前窗景版本一致
 * - stale: 窗景已修订，素材停留在旧版本（待作者选择）
 * - orphaned: 引用的窗景已被移除，素材留作失效
 * - kept: 作者主动选择留用旧版本
 */
export type MaterialStatus = 'valid' | 'stale' | 'orphaned' | 'kept'

/** 素材单容量上限 */
export const MATERIAL_CAPACITY = 12

/**
 * 素材：只记录引用的窗景 + 收录时的版本快照。
 * 窗景一修订，相关素材即失效，作者可更新到新版本或留用旧版本。
 */
export interface Material {
  id: string
  /** 引用的窗景 id（引用式，不再内联复制正文） */
  sceneId: string
  /** 收录时窗景的版本号 */
  version: number
  /** 该版本下窗景内容的快照（留用旧版本时查看的就是它） */
  snapshot: WindowScene
  status: MaterialStatus
  addedAt: string
  /** 幂等键：写失败重试时凭它去重，不重复占位 */
  requestId: string
  label?: string
}

/** 容量满后排队的素材（FIFO，有空位自动补入） */
export interface QueuedMaterial {
  id: string
  sceneId: string
  version: number
  snapshot: WindowScene
  queuedAt: string
  requestId: string
  position: number
}

/** 旧版素材：早期把正文内联复制进来，没有 sceneId 引用 —— 迁移源 */
export interface LegacyMaterial {
  id: string
  routeName?: string
  segment?: string
  seatDirection?: SeatDirection
  timestamp?: string
  weather?: Weather
  signText?: string
  treeDensity?: TreeDensity
  pedestrianStatus?: PedestrianStatus
  note?: string
  addedAt?: string
  migrated?: boolean
}

/** 素材迁移进度：持久化，中断后下次回来接着补 */
export interface MaterialMigrationState {
  status: 'idle' | 'running' | 'done'
  total: number
  /** 已迁移的旧素材 id，续跑时跳过 */
  doneIds: string[]
  startedAt?: string
  finishedAt?: string
}

export interface MaterialMeta {
  schemaVersion: number
  materialMigration: MaterialMigrationState
}
