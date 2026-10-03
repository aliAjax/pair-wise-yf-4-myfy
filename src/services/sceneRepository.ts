import type {
  SceneContent,
  SceneFormData,
  SceneVersion,
  WindowScene,
  SceneView,
} from '@/types'
import { defaultKV, readJSON, writeJSON, LEGACY_SCENES_KEY } from './storage'
import type { KV } from './storage'

export const SCENES_KEY = 'bus_window_scenes_v2'

export interface LegacyFlatScene extends Partial<SceneContent> {
  id?: string
  timestamp?: string
}

function toView(scene: WindowScene): SceneView {
  const latest = scene.versions[scene.versions.length - 1]
  return {
    ...latest.content,
    id: scene.id,
    versionId: latest.id,
    version: latest.version,
    createdAt: scene.createdAt,
    timestamp: latest.createdAt,
    versionCount: scene.versions.length,
    removed: scene.removed,
  }
}

function readScenes(kv: KV): WindowScene[] {
  return readJSON<WindowScene[]>(kv, SCENES_KEY, [])
}

/**
 * 旧窗景迁移：扁平记录（id + 正文 + timestamp）→ 版本化记录。
 * 幂等：数据已是新形态时直接返回。迁移后旧键改作备份，不再读取。
 */
export function migrateLegacyScenes(kv: KV = defaultKV): void {
  const raw = kv.getItem(LEGACY_SCENES_KEY)
  if (!raw) return
  // 已有新数据说明迁移完成
  if (kv.getItem(SCENES_KEY)) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    writeJSON(kv, SCENES_KEY, [])
    return
  }
  // 已经是版本化形态则直接搬键
  const first = parsed[0] as Record<string, unknown>
  if (first && Array.isArray(first.versions)) {
    writeJSON(kv, SCENES_KEY, parsed as WindowScene[])
    kv.setItem(`${LEGACY_SCENES_KEY}_backup`, raw)
    kv.removeItem(LEGACY_SCENES_KEY)
    return
  }

  const scenes: WindowScene[] = (parsed as LegacyFlatScene[]).map((flat, i) => {
    const content: SceneContent = {
      routeName: flat.routeName ?? '',
      segment: flat.segment ?? '',
      seatDirection: flat.seatDirection ?? '左',
      weather: flat.weather ?? '晴',
      signText: flat.signText ?? '',
      treeDensity: flat.treeDensity ?? '适中',
      pedestrianStatus: flat.pedestrianStatus ?? '稀少',
      note: flat.note ?? '',
    }
    const createdAt = flat.timestamp ?? new Date().toISOString()
    const version: SceneVersion = {
      id: crypto.randomUUID(),
      version: 1,
      createdAt,
      content,
    }
    return {
      id: flat.id ?? `legacy-${i}-${crypto.randomUUID()}`,
      versions: [version],
      createdAt,
      removed: false,
    }
  })

  writeJSON(kv, SCENES_KEY, scenes)
  kv.setItem(`${LEGACY_SCENES_KEY}_backup`, raw)
  kv.removeItem(LEGACY_SCENES_KEY)
}

export function getAllScenes(kv: KV = defaultKV): WindowScene[] {
  return readScenes(kv)
}

/** 页面/选择器用的扁平视图，默认不含已移除的窗景 */
export function getSceneViews(kv: KV = defaultKV, includeRemoved = false): SceneView[] {
  return readScenes(kv)
    .filter((s) => includeRemoved || !s.removed)
    .map(toView)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
}

export function getSceneById(id: string, kv: KV = defaultKV): WindowScene | null {
  return readScenes(kv).find((s) => s.id === id) ?? null
}

export function getVersion(sceneId: string, versionId: string, kv: KV = defaultKV) {
  const scene = getSceneById(sceneId, kv)
  if (!scene) return { scene: null, version: null }
  return {
    scene,
    version: scene.versions.find((v) => v.id === versionId) ?? null,
  }
}

export function createScene(data: SceneFormData, kv: KV = defaultKV): WindowScene {
  const scenes = readScenes(kv)
  const now = new Date().toISOString()
  const scene: WindowScene = {
    id: crypto.randomUUID(),
    createdAt: now,
    removed: false,
    versions: [
      {
        id: crypto.randomUUID(),
        version: 1,
        createdAt: now,
        content: { ...data },
      },
    ],
  }
  scenes.push(scene)
  writeJSON(kv, SCENES_KEY, scenes)
  return scene
}

export interface RevisedScene {
  scene: WindowScene
  version: SceneVersion
}

/**
 * 修订窗景：追加一个不可变新版本，旧版本保留。
 * 引用旧版本的素材由素材单仓库负责标失效。
 */
export function reviseScene(
  sceneId: string,
  data: SceneFormData,
  kv: KV = defaultKV,
): RevisedScene | null {
  const scenes = readScenes(kv)
  const scene = scenes.find((s) => s.id === sceneId)
  if (!scene || scene.removed) return null

  const version: SceneVersion = {
    id: crypto.randomUUID(),
    version: scene.versions.length + 1,
    createdAt: new Date().toISOString(),
    content: { ...data },
  }
  scene.versions.push(version)
  writeJSON(kv, SCENES_KEY, scenes)
  return { scene, version }
}

/** 移除窗景：墓碑式保留，引用它的素材留下来标「失效」 */
export function removeScene(sceneId: string, kv: KV = defaultKV): WindowScene | null {
  const scenes = readScenes(kv)
  const scene = scenes.find((s) => s.id === sceneId)
  if (!scene) return null
  scene.removed = true
  scene.removedAt = new Date().toISOString()
  writeJSON(kv, SCENES_KEY, scenes)
  return scene
}

/** 供素材单解析引用 */
export function findSceneVersion(
  scenes: WindowScene[],
  sceneId: string,
  versionId?: string,
) {
  const scene = scenes.find((s) => s.id === sceneId) ?? null
  if (!scene) return { scene: null, version: null }
  const version =
    (versionId ? scene.versions.find((v) => v.id === versionId) : null) ??
    scene.versions[scene.versions.length - 1]
  return { scene, version }
}
