import { useEffect, useState } from 'react'
import { Search, Route, X, Trash2, Clock, MapPin, ClipboardList, GitBranch } from 'lucide-react'
import { useSceneStore } from '@/store/useSceneStore'
import {
  formatTimestamp,
  getTimeOfDay,
  getWeatherIcon,
  getTreeIcon,
  getPedestrianIcon,
} from '@/utils/sceneHelpers'
import type { SceneView, SceneFormData } from '@/types'

export default function TimelinePage() {
  const { routeNames, selectedRoute, currentRouteScenes, selectRoute, loadAll, deleteScene } =
    useSceneStore()
  const [search, setSearch] = useState('')
  const [detailScene, setDetailScene] = useState<SceneView | null>(null)
  const [revising, setRevising] = useState(false)

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 修订后详情要跟着新版本视图更新：内容变化时才 setState，避免渲染环
  const scenesVersion = useSceneStore(
    (s) => s.scenes.find((x) => x.id === detailScene?.id)?.versionId,
  )
  useEffect(() => {
    if (!detailScene || !scenesVersion) return
    if (detailScene.versionId === scenesVersion) return
    const fresh = useSceneStore.getState().scenes.find((s) => s.id === detailScene.id)
    if (fresh) setDetailScene(fresh)
  }, [detailScene, scenesVersion])

  const filteredRoutes = routeNames.filter((r) =>
    r.toLowerCase().includes(search.toLowerCase())
  )

  const sorted = [...currentRouteScenes].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const handleDelete = (id: string) => {
    deleteScene(id)
    setDetailScene(null)
  }

  return (
    <div className="min-h-screen bg-teal-950 font-serif text-mist-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-3xl font-bold tracking-wide text-dusk-400">
          窗景时间线
        </h1>

        <div className="mb-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-mist-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索路线..."
              className="w-full rounded-lg border border-teal-800 bg-teal-900/60 py-2.5 pl-10 pr-4 text-sm text-mist-100 placeholder:text-mist-500 focus:border-dusk-400 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => selectRoute('')}
              className={`rounded-full px-3.5 py-1.5 text-xs transition-colors ${
                !selectedRoute
                  ? 'bg-dusk-400 text-teal-950'
                  : 'bg-teal-900 text-mist-300 hover:bg-teal-800'
              }`}
            >
              全部
            </button>
            {filteredRoutes.map((name) => (
              <button
                key={name}
                onClick={() => selectRoute(name)}
                className={`rounded-full px-3.5 py-1.5 text-xs transition-colors ${
                  selectedRoute === name
                    ? 'bg-dusk-400 text-teal-950'
                    : 'bg-teal-900 text-mist-300 hover:bg-teal-800'
                }`}
              >
                <Route className="mr-1 inline w-3 h-3" />
                {name}
              </button>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-mist-400">
            <div className="mb-4 text-6xl opacity-30">🪟</div>
            <p className="text-lg">
              {selectedRoute ? '该路线暂无窗景记录' : '选择一条路线，开始浏览窗景'}
            </p>
          </div>
        ) : (
          <div className="relative pl-8">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-teal-800" />
            <div className="space-y-6">
              {sorted.map((scene) => (
                <div key={scene.id} className="relative flex gap-4">
                  <div className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full bg-dusk-400 ring-4 ring-teal-950" />
                  <div className="w-20 shrink-0 pt-0.5 text-right">
                    <p className="text-xs text-dusk-400">
                      {formatTimestamp(scene.timestamp)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-mist-500">
                      {getTimeOfDay(scene.timestamp)}
                    </p>
                  </div>
                  <button
                    onClick={() => { setDetailScene(scene); setRevising(false) }}
                    className="group flex-1 rounded-xl border border-teal-800 bg-teal-900/50 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-dusk-400/40 hover:shadow-lg hover:shadow-dusk-400/10"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {getWeatherIcon(scene.weather)}
                      <span className="text-sm font-semibold text-mist-100">
                        {scene.segment}
                      </span>
                      {scene.versionCount > 1 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                          <GitBranch className="w-3 h-3" />
                          v{scene.version}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mb-1.5 text-mist-400">
                      <MapPin className="w-3 h-3" />
                      <span className="text-xs">{scene.routeName}</span>
                      <span className="mx-1 text-teal-700">·</span>
                      <span className="text-xs">{scene.seatDirection}侧</span>
                    </div>
                    {scene.note && (
                      <p className="text-xs text-mist-400 line-clamp-2">
                        {scene.note}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      {getTreeIcon(scene.treeDensity)}
                      {getPedestrianIcon(scene.pedestrianStatus)}
                      {scene.signText && (
                        <span className="rounded bg-teal-800/60 px-1.5 py-0.5 text-[10px] text-mist-300">
                          {scene.signText}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {detailScene && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setDetailScene(null)}
        >
          <div
            className="relative mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto animate-scale-in rounded-2xl border border-teal-700 bg-teal-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setDetailScene(null)}
              className="absolute right-4 top-4 text-mist-400 hover:text-mist-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {!revising ? (
              <>
                <div className="mb-4 flex items-center gap-3 pr-8">
                  {getWeatherIcon(detailScene.weather)}
                  <h2 className="text-xl font-bold text-dusk-400">{detailScene.segment}</h2>
                  {detailScene.versionCount > 1 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">
                      <GitBranch className="w-3.5 h-3.5" />
                      已修订 {detailScene.versionCount} 版 · 当前 v{detailScene.version}
                    </span>
                  )}
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-mist-300">
                    <MapPin className="w-4 h-4 text-dusk-400" />
                    <span>{detailScene.routeName}</span>
                    <span className="text-teal-600">·</span>
                    <span>{detailScene.seatDirection}侧</span>
                  </div>
                  <div className="flex items-center gap-2 text-mist-300">
                    <Clock className="w-4 h-4 text-dusk-400" />
                    <span>{formatTimestamp(detailScene.timestamp)}</span>
                    <span className="text-teal-600">·</span>
                    <span>{getTimeOfDay(detailScene.timestamp)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-mist-300">
                    {getTreeIcon(detailScene.treeDensity)}
                    <span>{detailScene.treeDensity}</span>
                    {getPedestrianIcon(detailScene.pedestrianStatus)}
                    <span>{detailScene.pedestrianStatus}</span>
                  </div>
                  {detailScene.signText && (
                    <div className="rounded-lg bg-teal-800/50 px-3 py-2 text-mist-200">
                      招牌: {detailScene.signText}
                    </div>
                  )}
                  {detailScene.note && (
                    <div className="rounded-lg border border-teal-800 px-3 py-2 text-mist-300">
                      {detailScene.note}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-col gap-2">
                  <button
                    onClick={() => setRevising(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500/15 py-2.5 text-sm text-sky-300 transition-colors hover:bg-sky-500/25"
                  >
                    <GitBranch className="w-4 h-4" />
                    修订此窗景（生成新版本）
                  </button>
                  <button
                    onClick={() => {
                      useSceneStore.getState().saveMaterial(detailScene.id, detailScene.versionId)
                      setDetailScene(null)
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-dusk-400/15 py-2.5 text-sm text-dusk-300 transition-colors hover:bg-dusk-400/25"
                  >
                    <ClipboardList className="w-4 h-4" />
                    收进素材单（引用此版本）
                  </button>
                  <button
                    onClick={() => handleDelete(detailScene.id)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-900/40 py-2.5 text-sm text-red-300 transition-colors hover:bg-red-900/60"
                  >
                    <Trash2 className="w-4 h-4" />
                    移除窗景（素材保留并标失效）
                  </button>
                </div>
              </>
            ) : (
              <ReviseForm
                scene={detailScene}
                onDone={() => {
                  const fresh = useSceneStore.getState().scenes.find(
                    (s) => s.id === detailScene.id,
                  )
                  if (fresh) setDetailScene(fresh)
                  setRevising(false)
                }}
                onCancel={() => setRevising(false)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ReviseForm({
  scene,
  onDone,
  onCancel,
}: {
  scene: SceneView
  onDone: () => void
  onCancel: () => void
}) {
  const reviseScene = useSceneStore((s) => s.reviseScene)
  const [form, setForm] = useState<SceneFormData>({
    routeName: scene.routeName,
    segment: scene.segment,
    seatDirection: scene.seatDirection,
    weather: scene.weather,
    signText: scene.signText,
    treeDensity: scene.treeDensity,
    pedestrianStatus: scene.pedestrianStatus,
    note: scene.note,
  })

  const update = <K extends keyof SceneFormData>(key: K, val: SceneFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  return (
    <div>
      <h2 className="mb-1 font-serif text-lg text-dusk-400">修订窗景</h2>
      <p className="mb-4 text-xs text-mist-500">
        保存后生成 v{scene.version + 1}，旧版本保留；引用旧版的素材将被标为待确认。
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-mist-400">区间</label>
          <input
            className="w-full rounded-lg border border-teal-700 bg-teal-850 px-3 py-2 text-sm text-mist-100 outline-none focus:border-dusk-400"
            value={form.segment}
            onChange={(e) => update('segment', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-mist-400">招牌文字</label>
          <input
            className="w-full rounded-lg border border-teal-700 bg-teal-850 px-3 py-2 text-sm text-mist-100 outline-none focus:border-dusk-400"
            value={form.signText}
            onChange={(e) => update('signText', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-mist-400">观察笔记（正文）</label>
          <textarea
            className="h-24 w-full resize-none rounded-lg border border-teal-700 bg-teal-850 px-3 py-2 text-sm text-mist-100 outline-none focus:border-dusk-400"
            value={form.note}
            onChange={(e) => update('note', e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => {
            reviseScene(scene.id, form)
            onDone()
          }}
          className="flex-1 rounded-lg bg-dusk-400 py-2.5 text-sm font-medium text-teal-950"
        >
          生成新版本
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-teal-700 px-4 py-2.5 text-sm text-mist-300 hover:bg-teal-800"
        >
          取消
        </button>
      </div>
    </div>
  )
}
