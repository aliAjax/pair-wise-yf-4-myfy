import { useEffect, useMemo } from 'react'
import {
  Bookmark,
  BookmarkPlus,
  Trash2,
  RefreshCw,
  ArrowUpCircle,
  Pin,
  Clock,
  MapPin,
  Signpost,
  Armchair,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FlaskConical,
  Layers,
} from 'lucide-react'
import { useSceneStore } from '@/store/useSceneStore'
import { useMaterialStore } from '@/store/useMaterialStore'
import { MATERIAL_CAPACITY } from '@/types'
import type { MaterialStatus, WindowScene } from '@/types'
import {
  getWeatherIcon,
  getTreeIcon,
  getPedestrianIcon,
  formatTimestamp,
} from '@/utils/sceneHelpers'

const statusMeta: Record<MaterialStatus, { label: string; cls: string }> = {
  valid: { label: '已是最新', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  stale: { label: '窗景已更新', cls: 'bg-dusk-400/15 text-dusk-300 border-dusk-400/40' },
  orphaned: { label: '原窗景已移除', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  kept: { label: '已留用旧版', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
}

function SceneTags({ scene }: { scene: WindowScene }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-mist-400">
      <span className="inline-flex items-center gap-1">{getWeatherIcon(scene.weather)}{scene.weather}</span>
      <span className="inline-flex items-center gap-1">{getTreeIcon(scene.treeDensity)}{scene.treeDensity}</span>
      <span className="inline-flex items-center gap-1">{getPedestrianIcon(scene.pedestrianStatus)}{scene.pedestrianStatus}</span>
      <span className="inline-flex items-center gap-1"><Armchair className="w-3.5 h-3.5 text-mist-500" />{scene.seatDirection}侧</span>
    </div>
  )
}

export default function MaterialsPage() {
  const scenes = useSceneStore((s) => s.scenes)
  const loadScenes = useSceneStore((s) => s.loadAll)

  const {
    materials,
    queue,
    meta,
    loading,
    migrating,
    error,
    notice,
    pending,
    loadAll,
    addMaterial,
    removeMaterial,
    resolveMaterial,
    clearOrphaned,
    retry,
    clearNotice,
    seedLegacyForDemo,
  } = useMaterialStore()

  useEffect(() => {
    loadScenes()
    void loadAll()
  }, [loadScenes, loadAll])

  const materialSceneIds = useMemo(
    () => new Set(materials.map((m) => m.sceneId).filter(Boolean)),
    [materials],
  )
  const queuedSceneIds = useMemo(() => new Set(queue.map((q) => q.sceneId)), [queue])

  const remaining = Math.max(0, MATERIAL_CAPACITY - materials.length)
  const migration = meta.materialMigration
  const showMigrationBanner = migrating || (migration.status === 'done' && migration.total > 0)

  return (
    <div className="min-h-screen bg-teal-950 font-serif text-mist-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* 头部 */}
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-wide text-dusk-400 flex items-center gap-2">
              <Bookmark className="w-7 h-7" />
              素材单
            </h1>
            <p className="mt-1 text-sm text-mist-400">
              只收录窗景的引用与版本，窗景修订后可更新到新版或留用旧版
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-teal-800 bg-teal-900/60 px-4 py-2 text-sm">
            <Layers className="w-4 h-4 text-dusk-400" />
            <span className="text-mist-300">
              已用 <span className="text-dusk-300 font-semibold">{materials.length}</span>
              <span className="text-mist-500"> / {MATERIAL_CAPACITY}</span>
            </span>
            {queue.length > 0 && (
              <span className="ml-2 text-mist-400">
                · 排队 <span className="text-dusk-300">{queue.length}</span>
              </span>
            )}
          </div>
        </div>

        {/* 容量条 */}
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-teal-800/60">
          <div
            className="h-full rounded-full bg-dusk-400/70 transition-all duration-300"
            style={{ width: `${(materials.length / MATERIAL_CAPACITY) * 100}%` }}
          />
        </div>

        {/* 通知 / 错误 */}
        {notice && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="flex-1">{notice}</span>
            <button onClick={clearNotice} className="text-emerald-300/70 hover:text-emerald-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            {pending && (
              <button
                onClick={() => void retry()}
                className="inline-flex items-center gap-1 rounded-md bg-red-500/20 px-2.5 py-1 text-xs hover:bg-red-500/30"
              >
                <RefreshCw className="w-3 h-3" />
                重试
              </button>
            )}
            <button onClick={clearNotice} className="text-red-300/70 hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 迁移横幅 */}
        {showMigrationBanner && (
          <div className="mb-6 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
            {migrating ? (
              <div className="flex items-center gap-2 text-sm text-sky-200">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>
                  正在把旧版素材迁移为引用式…
                  {migration.doneIds.length} / {migration.total}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-sky-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  旧版素材已全部迁移为引用式（共 {migration.total} 条），中断后重开也会自动接着补
                </span>
              </div>
            )}
          </div>
        )}

        {/* 收录窗景 */}
        <section className="mb-8">
          <h2 className="mb-3 text-dusk-400 font-serif text-lg flex items-center gap-2">
            <BookmarkPlus className="w-4 h-4" />
            收录窗景
            {remaining === 0 && (
              <span className="ml-2 text-xs text-red-300/80 border border-red-500/30 rounded-full px-2 py-0.5">
                素材单已满，新素材排队
              </span>
            )}
          </h2>
          {scenes.length === 0 ? (
            <p className="text-sm text-mist-500 rounded-xl border border-teal-800 bg-teal-900/40 px-4 py-6 text-center">
              还没有窗景记录，先去「记录」页采一段窗景
            </p>
          ) : (
            <div className="space-y-2">
              {scenes.map((scene) => {
                const inMaterial = materialSceneIds.has(scene.id)
                const inQueue = queuedSceneIds.has(scene.id)
                const disabled = inMaterial || inQueue
                return (
                  <div
                    key={scene.id}
                    className="flex items-center gap-3 rounded-xl border border-teal-800 bg-teal-900/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm text-mist-100">
                        <MapPin className="w-3.5 h-3.5 text-dusk-400 shrink-0" />
                        <span className="truncate">{scene.routeName} · {scene.segment}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-mist-500">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(scene.timestamp)}
                        {scene.signText && <span className="truncate">· {scene.signText}</span>}
                      </div>
                    </div>
                    <button
                      disabled={disabled || loading}
                      onClick={() => void addMaterial(scene.id)}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        inMaterial
                          ? 'bg-teal-800/60 text-mist-500 cursor-default'
                          : inQueue
                            ? 'bg-dusk-400/15 text-dusk-300 cursor-default'
                            : remaining === 0
                              ? 'bg-dusk-400/20 text-dusk-200 hover:bg-dusk-400/30'
                              : 'bg-dusk-400 text-teal-950 hover:bg-dusk-300'
                      }`}
                    >
                      {inMaterial ? (
                        '已收录'
                      ) : inQueue ? (
                        '排队中'
                      ) : remaining === 0 ? (
                        <>排队收录</>
                      ) : (
                        <>收录</>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 排队中 */}
        {queue.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-dusk-400 font-serif text-lg flex items-center gap-2">
              <Clock className="w-4 h-4" />
              排队中（{queue.length}）
            </h2>
            <div className="space-y-2">
              {queue.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-xl border border-dusk-400/25 bg-dusk-400/5 px-4 py-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dusk-400/20 text-dusk-300 text-xs font-semibold">
                    {q.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-mist-200 truncate">
                      {q.snapshot.routeName} · {q.snapshot.segment}
                    </div>
                    <div className="text-xs text-mist-500">
                      素材单有空位后自动补入 · 收录 v{q.version}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 素材列表 */}
        <section>
          <h2 className="mb-3 text-dusk-400 font-serif text-lg flex items-center gap-2">
            <Bookmark className="w-4 h-4" />
            我的素材（{materials.length}）
          </h2>
          {materials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-mist-400">
              <div className="mb-3 text-5xl opacity-30">🔖</div>
              <p className="text-base">素材单还是空的</p>
              <p className="mt-1 text-sm text-mist-500">从上方收录一段窗景，开始攒写作素材</p>
            </div>
          ) : (
            <div className="space-y-3">
              {materials.map((m) => {
                const badge = statusMeta[m.status]
                const snap = m.snapshot
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border bg-teal-900/50 p-4 transition ${
                      m.status === 'stale'
                        ? 'border-dusk-400/40'
                        : m.status === 'orphaned'
                          ? 'border-red-500/30 opacity-80'
                          : 'border-teal-800'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-mist-100">
                        {snap.routeName} · {snap.segment}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${badge.cls}`}>
                        {m.status === 'stale' && <ArrowUpCircle className="w-3 h-3" />}
                        {m.status === 'orphaned' && <AlertTriangle className="w-3 h-3" />}
                        {m.status === 'kept' && <Pin className="w-3 h-3" />}
                        {badge.label}
                      </span>
                      <span className="ml-auto text-[11px] text-mist-500">
                        {m.status === 'valid' ? `v${m.version}` : `收录 v${m.version}`}
                      </span>
                    </div>

                    {snap.signText && (
                      <div className="mb-2 flex items-center gap-1.5 text-xs text-mist-300">
                        <Signpost className="w-3.5 h-3.5 text-dusk-400 shrink-0" />
                        {snap.signText}
                      </div>
                    )}
                    {snap.note && (
                      <p className="mb-2 text-sm text-mist-300 leading-relaxed line-clamp-2">{snap.note}</p>
                    )}
                    <div className="mb-3 flex items-center gap-2 text-[11px] text-mist-500">
                      <Clock className="w-3 h-3" />
                      {formatTimestamp(snap.timestamp)}
                    </div>
                    <SceneTags scene={snap} />

                    {/* 失效提示与操作 */}
                    {m.status === 'stale' && (
                      <div className="mt-3 rounded-lg bg-dusk-400/10 px-3 py-2 text-xs text-dusk-200">
                        窗景已修订到新版本，素材停留在 v{m.version}。
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => void resolveMaterial(m.id, 'update')}
                            className="inline-flex items-center gap-1 rounded-md bg-dusk-400 px-2.5 py-1 text-teal-950 font-medium hover:bg-dusk-300"
                          >
                            <ArrowUpCircle className="w-3 h-3" />
                            更新到新版
                          </button>
                          <button
                            onClick={() => void resolveMaterial(m.id, 'keep')}
                            className="inline-flex items-center gap-1 rounded-md border border-dusk-400/40 px-2.5 py-1 hover:bg-dusk-400/10"
                          >
                            <Pin className="w-3 h-3" />
                            留用旧版
                          </button>
                        </div>
                      </div>
                    )}
                    {m.status === 'orphaned' && (
                      <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        原窗景已被移除，素材保留但已失效。
                      </div>
                    )}
                    {m.status === 'kept' && (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-sky-300/80">已固定使用此旧版本</span>
                        <button
                          onClick={() => void resolveMaterial(m.id, 'update')}
                          className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-500/10"
                        >
                          <ArrowUpCircle className="w-3 h-3" />
                          改用新版
                        </button>
                      </div>
                    )}

                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => void removeMaterial(m.id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-mist-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3 h-3" />
                        移除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {materials.some((m) => m.status === 'orphaned') && (
            <button
              onClick={() => void clearOrphaned()}
              className="mt-4 w-full rounded-lg border border-red-500/30 bg-red-500/5 py-2 text-xs text-red-300 hover:bg-red-500/15"
            >
              清除全部失效素材（{materials.filter((m) => m.status === 'orphaned').length}），空位由排队补入
            </button>
          )}
        </section>

        {/* 演示：导入旧版数据触发迁移 */}
        <div className="mt-10 border-t border-teal-800/60 pt-4 text-center">
          <button
            onClick={seedLegacyForDemo}
            className="inline-flex items-center gap-1.5 text-xs text-mist-500 hover:text-dusk-300"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            导入旧版素材（演示引用式迁移，可中断续跑）
          </button>
        </div>
      </div>
    </div>
  )
}
