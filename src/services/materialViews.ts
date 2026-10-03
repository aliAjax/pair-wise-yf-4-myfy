import type {
  Material,
  MaterialStatus,
  MaterialView,
  SceneContent,
  WindowScene,
} from '@/types'
import { getAllScenes } from './sceneRepository'
import { getMaterialDoc } from './materialRepository'
import type { MaterialDoc } from './materialRepository'
import { defaultKV } from './storage'
import type { KV } from './storage'

function statusOf(
  material: Material,
  scene: WindowScene | null,
  referencedVersionExists: boolean,
  isLatest: boolean,
): MaterialStatus {
  // 窗景被移除，或引用的版本彻底找不到：失效（素材本身保留）
  if (!scene || scene.removed || !referencedVersionExists) return 'missing'
  if (material.decided === 'kept') return 'kept'
  if (!isLatest) return 'stale'
  return 'current'
}

export function buildMaterialViews(doc?: MaterialDoc, kv: KV = defaultKV): MaterialView[] {
  const realDoc = doc ?? getMaterialDoc(kv)
  const scenes = getAllScenes(kv)
  const sceneMap = new Map(scenes.map((s) => [s.id, s]))

  return realDoc.materials
    .slice()
    .sort(
      (a, b) =>
        new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
    )
    .map((material): MaterialView => {
      const scene = sceneMap.get(material.sceneId) ?? null
      const referencedVersion =
        scene?.versions.find((v) => v.id === material.versionId) ?? null
      const latestVersion = scene ? scene.versions[scene.versions.length - 1] : null
      const status = statusOf(
        material,
        scene,
        referencedVersion !== null,
        referencedVersion?.id === latestVersion?.id,
      )
      const content: Partial<SceneContent> | null = referencedVersion
        ? referencedVersion.content
        : material.legacySnapshot ?? null

      return {
        material,
        status,
        scene: scene ?? undefined,
        referencedVersion: referencedVersion ?? undefined,
        latestVersion: latestVersion ?? undefined,
        content,
      }
    })
}

/** 当前是否还有需要作者处理的失效素材（待确认） */
export function hasPendingStale(views: MaterialView[]): boolean {
  return views.some((v) => v.status === 'stale' || v.status === 'missing')
}
