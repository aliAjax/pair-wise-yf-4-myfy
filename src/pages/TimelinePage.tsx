import { useEffect, useState } from 'react'
import { Search, Route, X, Trash2, Clock, MapPin, Pencil, Check } from 'lucide-react'
import { useSceneStore } from '@/store/useSceneStore'
import {
  formatTimestamp,
  getTimeOfDay,
  getWeatherIcon,
  getTreeIcon,
  getPedestrianIcon,
} from '@/utils/sceneHelpers'
import type { WindowScene, SceneFormData, Weather, TreeDensity, PedestrianStatus, SeatDirection } from '@/types'

const WEATHERS: Weather[] = ['晴', '多云', '阴', '小雨', '大雨', '雪', '雾']
const TREES: TreeDensity[] = ['稀疏', '适中', '茂密']
const PEDESTRIANS: PedestrianStatus[] = ['稀少', '零星', '密集']

export default function TimelinePage() {
  const { routeNames, selectedRoute, currentRouteScenes, selectRoute, loadAll, deleteScene, updateScene } =
    useSceneStore()
  const [search, setSearch] = useState('')
  const [detailScene, setDetailScene] = useState<WindowScene | null>(null)
  const [editingScene, setEditingScene] = useState<WindowScene | null>(null)
  const [editForm, setEditForm] = useState<SceneFormData | null>(null)

  useEffect(() => {
    loadAll()
  }, [loadAll])

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

  const openEdit = (scene: WindowScene) => {
    setEditingScene(scene)
    setEditForm({
      routeName: scene.routeName,
      segment: scene.segment,
      seatDirection: scene.seatDirection,
      weather: scene.weather,
      signText: scene.signText,
      treeDensity: scene.treeDensity,
      pedestrianStatus: scene.pedestrianStatus,
      note: scene.note,
    })
  }

  const handleEditSubmit = () => {
    if (!editingScene || !editForm) return
    updateScene(editingScene.id, editForm)
    setEditingScene(null)
    setEditForm(null)
    setDetailScene(null)
  }

  const updateEdit = <K extends keyof SceneFormData>(key: K, val: SceneFormData[K]) =>
    setEditForm((prev) => (prev ? { ...prev, [key]: val } : prev))

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
                    onClick={() => setDetailScene(scene)}
                    className="group flex-1 rounded-xl border border-teal-800 bg-teal-900/50 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-dusk-400/40 hover:shadow-lg hover:shadow-dusk-400/10"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {getWeatherIcon(scene.weather)}
                      <span className="text-sm font-semibold text-mist-100">
                        {scene.segment}
                      </span>
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
            className="relative mx-4 w-full max-w-md animate-scale-in rounded-2xl border border-teal-700 bg-teal-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setDetailScene(null)}
              className="absolute right-4 top-4 text-mist-400 hover:text-mist-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-4 flex items-center gap-3">
              {getWeatherIcon(detailScene.weather)}
              <h2 className="text-xl font-bold text-dusk-400">{detailScene.segment}</h2>
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

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => openEdit(detailScene)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-dusk-400 py-2.5 text-sm font-medium text-teal-950 transition-colors hover:bg-dusk-300"
              >
                <Pencil className="w-4 h-4" />
                修订此窗景
              </button>
              <button
                onClick={() => handleDelete(detailScene.id)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-900/40 py-2.5 text-sm text-red-300 transition-colors hover:bg-red-900/60"
              >
                <Trash2 className="w-4 h-4" />
                删除此窗景
              </button>
            </div>
          </div>
        </div>
      )}

      {editingScene && editForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => { setEditingScene(null); setEditForm(null) }}
        >
          <div
            className="relative mx-4 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-teal-700 bg-teal-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setEditingScene(null); setEditForm(null) }}
              className="absolute right-4 top-4 text-mist-400 hover:text-mist-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-4">
              <h2 className="text-xl font-bold text-dusk-400 flex items-center gap-2">
                <Pencil className="w-5 h-5" />
                修订窗景
              </h2>
              <p className="mt-1 text-xs text-mist-400">
                修订后版本号 +1，引用它的素材会标记为「窗景已更新」
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-mist-300 text-xs mb-1 block">线路</label>
                  <input className="w-full rounded-lg border border-teal-800 bg-teal-900/60 px-3 py-2 text-mist-100 outline-none focus:border-dusk-400"
                    value={editForm.routeName} onChange={(e) => updateEdit('routeName', e.target.value)} />
                </div>
                <div>
                  <label className="text-mist-300 text-xs mb-1 block">区间</label>
                  <input className="w-full rounded-lg border border-teal-800 bg-teal-900/60 px-3 py-2 text-mist-100 outline-none focus:border-dusk-400"
                    value={editForm.segment} onChange={(e) => updateEdit('segment', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-mist-300 text-xs mb-1 block">座位方向</label>
                <div className="flex gap-2">
                  {(['左', '右'] as SeatDirection[]).map((d) => (
                    <button key={d} type="button" onClick={() => updateEdit('seatDirection', d)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${editForm.seatDirection === d ? 'bg-dusk-400/20 text-dusk-400 border border-dusk-400' : 'bg-teal-800/60 text-mist-300 border border-transparent'}`}>
                      {d}侧
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-mist-300 text-xs mb-1 block">天气</label>
                <div className="grid grid-cols-4 gap-2">
                  {WEATHERS.map((w) => (
                    <button key={w} type="button" onClick={() => updateEdit('weather', w)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-lg text-xs transition ${editForm.weather === w ? 'bg-dusk-400/20 border border-dusk-400 text-dusk-400' : 'bg-teal-800/60 border border-transparent text-mist-300'}`}>
                      {getWeatherIcon(w)}{w}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-mist-300 text-xs mb-1 block">招牌文字</label>
                <input className="w-full rounded-lg border border-teal-800 bg-teal-900/60 px-3 py-2 text-mist-100 outline-none focus:border-dusk-400"
                  value={editForm.signText} onChange={(e) => updateEdit('signText', e.target.value)} />
              </div>

              <div>
                <label className="text-mist-300 text-xs mb-1 block">树木密度</label>
                <div className="grid grid-cols-3 gap-2">
                  {TREES.map((t) => (
                    <button key={t} type="button" onClick={() => updateEdit('treeDensity', t)}
                      className={`flex items-center justify-center gap-1 py-2 rounded-lg text-xs transition ${editForm.treeDensity === t ? 'bg-dusk-400/20 border border-dusk-400 text-dusk-400' : 'bg-teal-800/60 border border-transparent text-mist-300'}`}>
                      {getTreeIcon(t)}{t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-mist-300 text-xs mb-1 block">行人状态</label>
                <div className="grid grid-cols-3 gap-2">
                  {PEDESTRIANS.map((p) => (
                    <button key={p} type="button" onClick={() => updateEdit('pedestrianStatus', p)}
                      className={`flex items-center justify-center gap-1 py-2 rounded-lg text-xs transition ${editForm.pedestrianStatus === p ? 'bg-dusk-400/20 border border-dusk-400 text-dusk-400' : 'bg-teal-800/60 border border-transparent text-mist-300'}`}>
                      {getPedestrianIcon(p)}{p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-mist-300 text-xs mb-1 block">观察笔记</label>
                <textarea className="w-full resize-none rounded-lg border border-teal-800 bg-teal-900/60 px-3 py-2 text-mist-100 outline-none focus:border-dusk-400 h-20"
                  value={editForm.note} onChange={(e) => updateEdit('note', e.target.value)} />
              </div>
            </div>

            <button
              onClick={handleEditSubmit}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-dusk-400 py-2.5 text-sm font-medium text-teal-950 transition-colors hover:bg-dusk-300"
            >
              <Check className="w-4 h-4" />
              保存修订
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
