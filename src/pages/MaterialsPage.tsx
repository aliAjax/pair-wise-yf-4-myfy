import { useEffect, useState } from 'react'
import {
  ClipboardList,
  Plus,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  History,
  Trash2,
  Bus,
  ListOrdered,
  DatabaseZap,
  Hourglass,
  Link2,
} from 'lucide-react'
import { useSceneStore } from '@/store/useSceneStore'
import { MATERIAL_CAPACITY } from '@/services/materialRepository'
import {
  getWeatherIcon,
  getTreeIcon,
  getPedestrianIcon,
  formatTimestamp,
} from '@/utils/sceneHelpers'
import type { MaterialView, SceneView, WindowScene } from '@/types'
import { getSceneById } from '@/services/sceneRepository'

const STATUS_META: Record<
  MaterialView['status'],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  current: {
    label: '最新',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon: CheckCircle2,
  },
  stale: {
    label: '窗景已修订 · 待确认',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: AlertTriangle,
  },
  kept: {
    label: '已留用旧版',
    className: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    icon: History,
  },
  missing: {
    label: '窗景已移除 · 失效',
    className: 'bg-red-500/15 text-red-300 border-red-500/30',
    icon: AlertTriangle,
  },
}

export default function MaterialsPage() {
  const {
    materialViews,
    queue,
    reservations,
    used,
    migration,
    localPending,
    notice,
    scenes,
    loadAll,
    saveMaterial,
    retrySaveMaterial,
    cancelSaveMaterial,
    adoptVersion,
    keepVersion,
    discardMaterial,
    continueMigration,
    clearNotice,
    seedLegacy,
    resetAll,
  } = useSceneStore()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [failNext, setFailNext] = useState(false)
  const [showDemo, setShowDemo] = useState(false)

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const staleCount = materialViews.filter(
    (v) => v.status === 'stale' || v.status === 'missing',
  ).length

  const capacityPct = Math.min(100, (used / MATERIAL_CAPACITY) * 100)

  return (
    <div className="min-h-screen bg-teal-950 p-4 pb-24 md:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* 头部 + 容量 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-serif text-2xl text-mist-100">
              <ClipboardList className="w-6 h-6 text-dusk-400" />
              素材单
            </h1>
            <p className="mt-1 text-xs text-mist-400 flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              只引用窗景与版本，不抄正文 · 窗景变动自动失效重算
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-dusk-400 px-4 py-2 text-sm font-medium text-teal-950 active:scale-[0.98] transition"
          >
            <Plus className="w-4 h-4" />
            收素材
          </button>
        </div>

        <section className="rounded-2xl border border-teal-800 bg-teal-900/40 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-mist-300">
              名额
              <span className="ml-2 font-semibold text-mist-100">
                {used}
              </span>
              <span className="text-mist-500"> / {MATERIAL_CAPACITY}</span>
              {reservations.length > 0 && (
                <span className="ml-2 text-xs text-amber-300">
                  （{reservations.length} 个占位中）
                </span>
              )}
            </span>
            <span className="text-xs text-mist-500">
              {MATERIAL_CAPACITY - used} 个余量
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-teal-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-dusk-500 to-dusk-300 transition-all duration-500"
              style={{ width: `${capacityPct}%` }}
            />
          </div>
          {staleCount > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              {staleCount} 条素材等待确认新版本
            </p>
          )}
        </section>

        {/* 迁移进度 */}
        {migration && migration.status !== 'done' && (
          <MigrationCard migration={migration} onContinue={continueMigration} />
        )}
        {migration?.status === 'done' && migration.total > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
            <DatabaseZap className="w-4 h-4" />
            旧数据已全部迁移为引用式（{migration.total} 条）
          </div>
        )}

        {/* 本标签页保存状态 */}
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-dusk-400/25 bg-dusk-400/10 px-4 py-3 text-sm text-mist-100">
            <span>{notice}</span>
            <button onClick={clearNotice} className="text-mist-400 hover:text-mist-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {localPending && localPending.phase !== 'committed' && (
          <PendingCard
            pending={localPending}
            queueLength={queue.length}
            onRetry={retrySaveMaterial}
            onCancel={cancelSaveMaterial}
          />
        )}

        {/* 队列 */}
        {queue.length > 0 && (
          <section className="rounded-2xl border border-teal-800 bg-teal-900/40 p-4">
            <h2 className="flex items-center gap-2 font-serif text-base text-mist-200">
              <ListOrdered className="w-4 h-4 text-dusk-400" />
              排队中
              <span className="text-xs text-mist-500">（名额释放后按顺序自动补位）</span>
            </h2>
            <ol className="mt-3 space-y-2">
              {queue.map((q, i) => (
                <li
                  key={q.token}
                  className="flex items-center gap-3 rounded-lg bg-teal-850/60 px-3 py-2 text-sm text-mist-300"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dusk-400/20 text-xs text-dusk-300">
                    {i + 1}
                  </span>
                  <QueueLabel sceneId={q.sceneId} versionId={q.versionId} />
                  <span className="ml-auto text-xs text-mist-500">
                    {formatTimestamp(q.enqueuedAt)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* 素材列表 */}
        {materialViews.length === 0 && queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-teal-800 py-20 text-center">
            <ClipboardList className="mb-4 w-12 h-12 text-dusk-400/30" />
            <p className="font-serif text-mist-200">素材单还是空的</p>
            <p className="mt-1 text-xs text-mist-500">
              点击「收素材」引用一段窗景，或在时间线里把窗景加入素材单
            </p>
          </div>
        ) : (
          <section className="space-y-3">
            {materialViews.map((view) => (
              <MaterialCard
                key={view.material.id}
                view={view}
                onAdopt={adoptVersion}
                onKeep={keepVersion}
                onDiscard={discardMaterial}
              />
            ))}
          </section>
        )}

        {/* 演示/调试 */}
        <section className="rounded-2xl border border-teal-800/60 p-4">
          <button
            onClick={() => setShowDemo((v) => !v)}
            className="text-xs text-mist-500 hover:text-mist-300"
          >
            {showDemo ? '收起' : '演示工具（迁移 / 写失败 / 并发）'}
          </button>
          {showDemo && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={seedLegacy}
                disabled={scenes.length === 0}
                className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs text-mist-200 hover:bg-teal-700 disabled:opacity-40"
                title="植入旧版「抄正文」素材单，触发引用式迁移"
              >
                植入旧素材触发迁移
              </button>
              <button
                onClick={() => setFailNext((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  failNext
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-teal-800 text-mist-200 hover:bg-teal-700'
                }`}
              >
                下次保存模拟写失败：{failNext ? '开' : '关'}
              </button>
              <button
                onClick={resetAll}
                className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs text-red-300 hover:bg-teal-700"
              >
                清空素材单
              </button>
            </div>
          )}
        </section>
      </div>

      {pickerOpen && (
        <ScenePicker
          failWrite={failNext}
          onClose={() => setPickerOpen(false)}
          onPick={(sceneId, versionId) => {
            const result = saveMaterial(sceneId, versionId, failNext)
            setPickerOpen(false)
            if (result.phase === 'committed' && !failNext) setFailNext(false)
          }}
        />
      )}
    </div>
  )
}

function MigrationCard({
  migration,
  onContinue,
}: {
  migration: NonNullable<ReturnType<typeof useSceneStore.getState>['migration']>
  onContinue: () => void
}) {
  const pct = migration.total === 0 ? 100 : Math.round((migration.cursor / migration.total) * 100)
  const interrupted = migration.status === 'interrupted'
  return (
    <section className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-serif text-base text-sky-200">
          <DatabaseZap className="w-4 h-4" />
          旧数据迁移：抄正文 → 引用式
        </h2>
        <button
          onClick={onContinue}
          className="flex items-center gap-1 rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/30"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {interrupted ? '接着补' : '继续一批'}
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-teal-800">
        <div
          className="h-full rounded-full bg-sky-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-sky-300/80">
        已迁移 {migration.cursor} / {migration.total}
        {interrupted && ' · 上次中断，可从这里续跑'}
        {migration.status === 'running' && ' · 迁移中…'}
      </p>
    </section>
  )
}

function PendingCard({
  pending,
  queueLength,
  onRetry,
  onCancel,
}: {
  pending: NonNullable<ReturnType<typeof useSceneStore.getState>['localPending']>
  queueLength: number
  onRetry: () => void
  onCancel: () => void
}) {
  const queued = pending.phase === 'queued'
  const failed = pending.phase === 'failed'
  return (
    <section
      className={`rounded-2xl border p-4 ${
        failed
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-amber-500/30 bg-amber-500/5'
      }`}
    >
      <div className="flex items-center gap-2 text-sm text-mist-100">
        <Hourglass className="w-4 h-4 text-amber-300" />
        {queued
          ? `已排队（当前第 ${pending.queuePosition ?? queueLength} 位），有名额会自动补位`
          : failed
            ? '写入失败：名额仍被你的占位保留，重试不会重复占位'
            : '名额占位中，等待写入…'}
      </div>
      <div className="mt-3 flex gap-2">
        {!queued && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 rounded-lg bg-dusk-400 px-3 py-1.5 text-xs font-medium text-teal-950"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重试写入
          </button>
        )}
        <button
          onClick={onCancel}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-xs text-mist-300 hover:bg-teal-800"
        >
          {queued ? '取消排队' : '放弃（释放名额）'}
        </button>
      </div>
    </section>
  )
}

function QueueLabel({ sceneId, versionId }: { sceneId: string; versionId: string }) {
  const scene = getSceneById(sceneId)
  const version = scene?.versions.find((v) => v.id === versionId)
  const content = version?.content
  if (!content) {
    return <span className="text-xs text-mist-500">引用已失链（{sceneId.slice(0, 8)}）</span>
  }
  return (
    <span className="truncate text-xs">
      {content.routeName} · {content.segment} · v{version?.version}
    </span>
  )
}

function MaterialCard({
  view,
  onAdopt,
  onKeep,
  onDiscard,
}: {
  view: MaterialView
  onAdopt: (materialId: string, versionId: string) => void
  onKeep: (materialId: string) => void
  onDiscard: (materialId: string) => void
}) {
  const meta = STATUS_META[view.status]
  const StatusIcon = meta.icon
  const content = view.content
  const referenced = view.referencedVersion
  const latest = view.latestVersion

  return (
    <article className="rounded-2xl border border-teal-800 bg-teal-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-mist-400">
          <Bus className="w-4 h-4 text-dusk-400" />
          <span className="font-medium text-mist-100">{content?.routeName ?? '失链窗景'}</span>
          <span>·</span>
          <span>{content?.segment ?? '—'}</span>
          {referenced && <span className="text-xs text-mist-500">v{referenced.version}</span>}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${meta.className}`}
        >
          <StatusIcon className="w-3 h-3" />
          {meta.label}
        </span>
      </div>

      {content?.note && (
        <p className="mt-2 font-serif text-sm leading-relaxed text-mist-200">
          {content.note}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-mist-400">
        {content?.weather && getWeatherIcon(content.weather)}
        {content?.treeDensity && getTreeIcon(content.treeDensity)}
        {content?.pedestrianStatus && getPedestrianIcon(content.pedestrianStatus)}
        {content?.signText && (
          <span className="rounded bg-teal-800/70 px-1.5 py-0.5">{content.signText}</span>
        )}
        <span className="ml-auto text-mist-500">
          收录于 {formatTimestamp(view.material.addedAt)}
        </span>
      </div>

      {view.material.migrationNote && (
        <p className="mt-2 rounded-lg bg-teal-850/60 px-2 py-1 text-[11px] text-mist-500">
          {view.material.migrationNote}
        </p>
      )}

      {/* 失效处理：采用新版本 / 留用旧版本；窗景被移除时只可丢弃 */}
      {view.status === 'stale' && latest && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-200">
            该窗景已修订到 v{latest.version}
            {latest.content.note ? `：「${latest.content.note}」` : ''}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onAdopt(view.material.id, latest.id)}
              className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/30"
            >
              采用新版本 v{latest.version}
            </button>
            <button
              onClick={() => onKeep(view.material.id)}
              className="rounded-lg border border-teal-700 px-3 py-1.5 text-xs text-mist-300 hover:bg-teal-800"
            >
              留用旧版本 v{referenced?.version}
            </button>
          </div>
        </div>
      )}

      {view.status === 'missing' && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs text-red-300/80">
            窗景已被移除，素材保留（正文为迁移快照或已不可读）
          </p>
          <button
            onClick={() => onDiscard(view.material.id)}
            className="flex items-center gap-1 rounded-lg bg-red-900/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/60"
          >
            <Trash2 className="w-3.5 h-3.5" />
            丢弃素材
          </button>
        </div>
      )}

      {view.status !== 'missing' && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => onDiscard(view.material.id)}
            className="text-[11px] text-mist-500 hover:text-red-300"
          >
            移出素材单
          </button>
        </div>
      )}
    </article>
  )
}

function ScenePicker({
  failWrite,
  onClose,
  onPick,
}: {
  failWrite: boolean
  onClose: () => void
  onPick: (sceneId: string, versionId: string) => void
}) {
  const scenes = useSceneStore((s) => s.scenes)
  const [selectedSceneId, setSelectedSceneId] = useState<string>(scenes[0]?.id ?? '')
  const fullScene: WindowScene | null = selectedSceneId
    ? getSceneById(selectedSceneId)
    : null
  const [versionId, setVersionId] = useState('')

  useEffect(() => {
    if (fullScene) {
      setVersionId(fullScene.versions[fullScene.versions.length - 1].id)
    }
  }, [selectedSceneId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedScene: SceneView | undefined = scenes.find((s) => s.id === selectedSceneId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-scale-in rounded-2xl border border-teal-700 bg-teal-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg text-dusk-400">收录窗景到素材单</h2>
          <button onClick={onClose} className="text-mist-400 hover:text-mist-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {scenes.length === 0 ? (
          <p className="py-6 text-center text-sm text-mist-400">
            还没有窗景，先去「记录」页采样一段吧
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-mist-400">选择窗景</label>
              <select
                value={selectedSceneId}
                onChange={(e) => setSelectedSceneId(e.target.value)}
                className="w-full rounded-xl border border-teal-700 bg-teal-850 px-3 py-2 text-sm text-mist-100 outline-none focus:border-dusk-400"
              >
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.routeName} · {s.segment}
                    {s.versionCount > 1 ? `（${s.versionCount} 个版本）` : ''}
                  </option>
                ))}
              </select>
            </div>

            {fullScene && fullScene.versions.length > 1 && (
              <div>
                <label className="mb-1 block text-xs text-mist-400">引用版本</label>
                <div className="space-y-1.5">
                  {fullScene.versions
                    .slice()
                    .reverse()
                    .map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVersionId(v.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                          versionId === v.id
                            ? 'border-dusk-400 bg-dusk-400/15 text-mist-100'
                            : 'border-teal-700 bg-teal-850 text-mist-400 hover:border-teal-600'
                        }`}
                      >
                        <span className="font-medium">v{v.version}</span>
                        <span className="ml-2 text-mist-500">{formatTimestamp(v.createdAt)}</span>
                        {v.content.note && (
                          <span className="mt-0.5 block truncate text-mist-400">{v.content.note}</span>
                        )}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {selectedScene && (
              <p className="text-[11px] text-mist-500">
                素材只保存窗景引用，不复制正文。窗景修订后这里会提示失效重算。
              </p>
            )}

            <button
              disabled={!versionId}
              onClick={() => versionId && onPick(selectedSceneId, versionId)}
              className="w-full rounded-xl bg-dusk-400 py-2.5 text-sm font-medium text-teal-950 transition active:scale-[0.98] disabled:opacity-40"
            >
              {failWrite ? '保存（本次将模拟写失败）' : '保存到素材单'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
