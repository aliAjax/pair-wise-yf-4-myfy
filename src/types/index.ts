export type SeatDirection = '左' | '右'

export type Weather = '晴' | '多云' | '阴' | '小雨' | '大雨' | '雪' | '雾'

export type TreeDensity = '稀疏' | '适中' | '茂密'

export type PedestrianStatus = '稀少' | '零星' | '密集'

/** 窗景正文：素材单不再抄录这些字段，只引用版本 */
export interface SceneContent {
  routeName: string
  segment: string
  seatDirection: SeatDirection
  weather: Weather
  signText: string
  treeDensity: TreeDensity
  pedestrianStatus: PedestrianStatus
  note: string
}

export type SceneFormData = SceneContent

/** 一次修订生成一个不可变版本 */
export interface SceneVersion {
  id: string
  /** 从 1 开始的版本号 */
  version: number
  createdAt: string
  content: SceneContent
}

/** 窗景主体：身份是 id，正文挂在版本上；移除后保留墓碑 */
export interface WindowScene {
  id: string
  versions: SceneVersion[]
  createdAt: string
  removed: boolean
  removedAt?: string
}

/** 页面消费的扁平视图：指向当前最新版本 */
export interface SceneView extends SceneContent {
  id: string
  versionId: string
  version: number
  createdAt: string
  timestamp: string
  versionCount: number
  removed: boolean
}

/* ---------------- 素材单 ---------------- */

/** 作者对失效素材的处置：auto=待确认 / kept=留用旧版 / adopted=已采用新版 */
export type MaterialDecision = 'auto' | 'kept' | 'adopted'

/** 引用式素材：只记窗景与版本，不抄正文 */
export interface Material {
  id: string
  sceneId: string
  versionId: string
  decided: MaterialDecision
  addedAt: string
  /** 迁移来源的素材，保留旧快照仅作窗景失链时的兜底展示 */
  legacySnapshot?: Partial<SceneContent>
  migrationNote?: string
}

export interface QueuedMaterial {
  id: string
  sceneId: string
  versionId: string
  enqueuedAt: string
  /** 排队时发放的幂等令牌，补位时核销 */
  token: string
}

export interface SlotReservation {
  /** 幂等令牌：同一令牌重试只返回同一个占位 */
  token: string
  kind: 'material' | 'queue'
  materialId: string
  sceneId: string
  versionId: string
  createdAt: number
  expiresAt: number
}

export type EnlistOutcome = 'reserved' | 'queued' | 'duplicate'

export interface EnlistResult {
  outcome: EnlistOutcome
  token?: string
  materialId?: string
  /** 排队位置（从 1 开始） */
  queuePosition?: number
  /** 占位/排队后剩余名额 */
  remaining: number
}

export interface CommitResult {
  ok: boolean
  /** true 表示这次提交其实早已完成（幂等重试） */
  alreadyCommitted?: boolean
  materialId?: string
  remaining: number
}

export type MaterialStatus = 'current' | 'stale' | 'kept' | 'missing'

export interface MaterialView {
  material: Material
  status: MaterialStatus
  scene?: WindowScene
  referencedVersion?: SceneVersion
  latestVersion?: SceneVersion
  /** 展示用正文：优先引用版本，窗景失链时回退迁移快照 */
  content: Partial<SceneContent> | null
}

/* ---------------- 旧数据迁移 ---------------- */

/** 旧版素材：直接抄了一份窗景正文 */
export interface LegacyMaterial extends Partial<SceneContent> {
  id?: string
  sceneId?: string
  /** 旧数据若记录过版本快照 id */
  snapshotId?: string
  version?: number
  addedAt?: string
}

export type MigrationStatus = 'idle' | 'running' | 'interrupted' | 'done'

export interface MigrationState {
  total: number
  /** 已处理条数，中断后从这里续跑 */
  cursor: number
  status: MigrationStatus
  updatedAt: string
}
