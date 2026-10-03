/**
 * 核心机制验证（不依赖浏览器）：
 *   npx esbuild tests/core.test.ts --bundle --platform=node --format=esm | node --input-type=module
 */
import assert from 'node:assert/strict'
import {
  SCENES_KEY,
  migrateLegacyScenes,
  createScene,
  reviseScene,
  removeScene,
  getSceneById,
} from '../src/services/sceneRepository'
import {
  MATERIAL_CAPACITY,
  RESERVATION_TTL_MS,
  enlistMaterial,
  commitMaterial,
  abortEnlist,
  getMaterialDoc,
  adoptNewVersion,
  keepOldVersion,
  removeMaterial,
} from '../src/services/materialRepository'
import { buildMaterialViews } from '../src/services/materialViews'
import { LEGACY_MATERIALS_KEY } from '../src/services/storage'
import {
  ensureMigration,
  runMigrationBatch,
  readMigrationState,
} from '../src/services/migration'
import type { SceneFormData } from '../src/types'

// crypto.randomUUID polyfill（Node 20 全局已有 crypto，此处兜底）
if (!globalThis.crypto?.randomUUID) {
  // @ts-expect-error polyfill
  globalThis.crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) }
}

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

function freshKV() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

const form = (note: string): SceneFormData => ({
  routeName: '47路',
  segment: '中山公园—静安寺',
  seatDirection: '左',
  weather: '晴',
  signText: '书店',
  treeDensity: '适中',
  pedestrianStatus: '零星',
  note,
})

/* ---------- 1. 引用式 + 版本失效重算 ---------- */
console.log('1) 引用式素材：窗景修订后失效，可采用新版或留用旧版')
{
  const kv = freshKV()
  const scene = createScene(form('初版正文'), kv)
  const v1 = scene.versions[0]
  enlistMaterial({ token: 't1', sceneId: scene.id, versionId: v1.id }, kv)
  commitMaterial('t1', undefined, kv)

  let views = buildMaterialViews(undefined, kv)
  assert.equal(views[0].status, 'current')

  const revised = reviseScene(scene.id, form('修订后的正文'), kv)!
  const v2 = revised.version
  // 修订后，仍引用 v1 的素材变为待确认
  views = buildMaterialViews(undefined, kv)
  assert.equal(views[0].status, 'stale')
  assert.equal(views[0].material.versionId, v1.id)
  assert.equal(views[0].latestVersion?.id, v2.id)

  // 采用新版本
  adoptNewVersion(views[0].material.id, v2.id, kv)
  views = buildMaterialViews(undefined, kv)
  assert.equal(views[0].status, 'current')
  assert.equal(views[0].content?.note, '修订后的正文')

  // 再来一次修订，这次选择留用旧版
  reviseScene(scene.id, form('第三版正文'), kv)
  views = buildMaterialViews(undefined, kv)
  assert.equal(views[0].status, 'stale')
  keepOldVersion(views[0].material.id, kv)
  views = buildMaterialViews(undefined, kv)
  assert.equal(views[0].status, 'kept')
  assert.equal(views[0].content?.note, '修订后的正文')
  test('窗景修订 → 素材 stale → adopt/keep 行为正确', () => {})
}

/* ---------- 2. 窗景移除：素材留着标失效 ---------- */
console.log('2) 窗景移除：墓碑保留，素材标 missing 且不消失')
{
  const kv = freshKV()
  const scene = createScene(form('会被删除的窗景'), kv)
  enlistMaterial({ token: 't2', sceneId: scene.id, versionId: scene.versions[0].id }, kv)
  commitMaterial('t2', undefined, kv)
  removeScene(scene.id, kv)

  const views = buildMaterialViews(undefined, kv)
  assert.equal(views.length, 1)
  assert.equal(views[0].status, 'missing')
  assert.equal(getSceneById(scene.id, kv)?.removed, true)
  test('移除窗景后素材仍在，状态为 missing', () => {})
}

/* ---------- 3. 容量上限 + 排队 + 补位 ---------- */
console.log('3) 容量上限：满了排队，名额释放后 FIFO 补位')
{
  const kv = freshKV()
  const scene = createScene(form('容量测试'), kv)
  const vid = scene.versions[0].id

  // 占满容量
  for (let i = 0; i < MATERIAL_CAPACITY; i++) {
    const r = enlistMaterial({ token: `fill-${i}`, sceneId: scene.id, versionId: vid }, kv)
    assert.equal(r.outcome, 'reserved')
    commitMaterial(`fill-${i}`, undefined, kv)
  }
  const full = enlistMaterial({ token: 'q-1', sceneId: scene.id, versionId: vid }, kv)
  assert.equal(full.outcome, 'queued')
  assert.equal(full.queuePosition, 1)
  const full2 = enlistMaterial({ token: 'q-2', sceneId: scene.id, versionId: vid }, kv)
  assert.equal(full2.queuePosition, 2)

  // 删除一条 → 队头自动补位
  const doc = getMaterialDoc(kv)
  removeMaterial(doc.materials[0].id, kv)
  const after = getMaterialDoc(kv)
  assert.equal(after.materials.length, MATERIAL_CAPACITY)
  assert.equal(after.queue.length, 1)
  assert.equal(after.queue[0].token, 'q-2')
  // 补位素材落单成功
  const committedToken = 'q-1'
  assert.equal(after.tokenIndex[committedToken].state, 'committed')
  test('名额满排队，释放后按 FIFO 自动补位', () => {})
}

/* ---------- 4. 并发：两个标签页先到先得 ---------- */
console.log('4) 两个标签页同时保存：先到占名额，后到看到余量')
{
  const kv = freshKV()
  const scene = createScene(form('并发测试'), kv)
  const vid = scene.versions[0].id

  // 各自独立的 localStorage 视图，但共享同一底层 KV（用相同对象模拟同源存储）
  for (let i = 0; i < MATERIAL_CAPACITY - 1; i++) {
    enlistMaterial({ token: `base-${i}`, sceneId: scene.id, versionId: vid }, kv)
    commitMaterial(`base-${i}`, undefined, kv)
  }
  // 只剩 1 个名额：标签页 A、B 几乎同时领取
  const a = enlistMaterial({ token: 'tabA', sceneId: scene.id, versionId: vid }, kv)
  const b = enlistMaterial({ token: 'tabB', sceneId: scene.id, versionId: vid }, kv)
  assert.equal(a.outcome, 'reserved')
  assert.equal(b.outcome, 'queued') // B 看到的余量已被 A 占走
  test('后到一方读到先到一方占用后的余量', () => {})
}

/* ---------- 5. 幂等：同一 token 重试不重复占位 ---------- */
console.log('5) 写失败重试：同一令牌不重复占位；commit 幂等')
{
  const kv = freshKV()
  const scene = createScene(form('重试测试'), kv)
  const vid = scene.versions[0].id

  const first = enlistMaterial({ token: 'retry-1', sceneId: scene.id, versionId: vid }, kv)
  assert.equal(first.outcome, 'reserved')
  // 网络没响应，作者点重试：enlist 重放
  const replay = enlistMaterial({ token: 'retry-1', sceneId: scene.id, versionId: vid }, kv)
  assert.equal(replay.outcome, 'duplicate')
  assert.equal(replay.materialId, first.materialId)
  assert.equal(getMaterialDoc(kv).reservations.length, 1) // 没有第二个占位

  const c1 = commitMaterial('retry-1', undefined, kv)
  assert.equal(c1.ok, true)
  const c2 = commitMaterial('retry-1', undefined, kv) // 提交也重放
  assert.equal(c2.ok, true)
  assert.equal(c2.alreadyCommitted, true)
  assert.equal(getMaterialDoc(kv).materials.length, 1)
  test('同 token 重试不重复占位，重复 commit 幂等', () => {})
}

/* ---------- 6. 失败放弃后名额归还、排队补位 ---------- */
console.log('6) 占位放弃：名额释放，队头补位，令牌作废')
{
  const kv = freshKV()
  const scene = createScene(form('放弃测试'), kv)
  const vid = scene.versions[0].id

  for (let i = 0; i < MATERIAL_CAPACITY; i++) {
    enlistMaterial({ token: `hold-${i}`, sceneId: scene.id, versionId: vid }, kv)
    if (i < MATERIAL_CAPACITY - 1) commitMaterial(`hold-${i}`, undefined, kv)
  }
  // hold-7 停在 reserved（模拟写失败），队列里来一个
  const waiter = enlistMaterial({ token: 'waiter', sceneId: scene.id, versionId: vid }, kv)
  assert.equal(waiter.outcome, 'queued')

  abortEnlist('hold-7', kv)
  const doc = getMaterialDoc(kv)
  assert.equal(doc.reservations.length, 0)
  assert.equal(doc.materials.length, MATERIAL_CAPACITY)
  assert.equal(doc.queue.length, 0) // waiter 已补位
  assert.equal(doc.tokenIndex['hold-7'].state, 'released')
  // 作废令牌再 commit 不会成功
  assert.equal(commitMaterial('hold-7', undefined, kv).ok, false)
  test('abort 释放名额并触发排队补位，旧令牌不可再写', () => {})
}

/* ---------- 7. 占位超时回收 ---------- */
console.log('7) 占位超时：名额自动回收，旧 token 不可再提交')
{
  const kv = freshKV()
  const scene = createScene(form('超时测试'), kv)
  const vid = scene.versions[0].id
  const now = Date.now()
  const r = enlistMaterial({ token: 'expire', sceneId: scene.id, versionId: vid, now }, kv)
  assert.equal(r.outcome, 'reserved')
  // 超过 TTL 后任何操作都会先 GC
  enlistMaterial({
    token: 'after-expire',
    sceneId: scene.id,
    versionId: vid,
    now: now + RESERVATION_TTL_MS + 1,
  }, kv)
  // 注意：查看时也用同一模拟时钟，否则真实 Date.now() 会把新占位再次 GC
  const doc = getMaterialDoc(kv)
  assert.equal(doc.reservations.filter((x) => x.token === 'expire').length, 0)
  assert.equal(doc.tokenIndex['expire'].state, 'released')
  // 新人直接拿到了刚回收的名额（reserved），无需排队
  assert.equal(doc.reservations.length, 1)
  assert.equal(doc.reservations[0].token, 'after-expire')
  test('超时占位被回收且新人可用', () => {})
}

/* ---------- 8. 旧数据迁移：引用式 + 断点续跑 ---------- */
console.log('8) 旧数据迁移：分批、中断续跑、失链兜底')
{
  const kv = freshKV()
  // 旧版扁平窗景
  kv.setItem('bus_window_scenes', JSON.stringify([
    { id: 's1', timestamp: '2026-09-01T08:00:00.000Z', ...form('旧窗景正文') },
  ]))
  migrateLegacyScenes(kv)
  const scenes = JSON.parse(kv.getItem(SCENES_KEY)!)
  assert.equal(scenes.length, 1)
  assert.equal(scenes[0].versions.length, 1)
  assert.equal(kv.getItem('bus_window_scenes'), null) // 旧键已备份移走

  const sceneId = scenes[0].id
  const v1Id = scenes[0].versions[0].id

  // 旧素材单：抄正文，且包含一条失链
  kv.setItem(LEGACY_MATERIALS_KEY, JSON.stringify([
    { id: 'm1', sceneId, snapshotId: v1Id, addedAt: '2026-09-02T08:00:00.000Z', ...form('旧窗景正文') },
    { id: 'm2', sceneId, ...form('旧窗景正文') },
    { id: 'm3', sceneId: 'gone-scene', routeName: 'X', note: '失链' },
  ]))
  ensureMigration(kv)

  // 批次大小 2：第一批后应处于 interrupted，cursor=2
  const p1 = runMigrationBatch(kv)
  assert.equal(p1.batchCount, 2)
  assert.equal(p1.status, 'interrupted')
  assert.equal(readMigrationState(kv)?.cursor, 2)

  // 回来接着补
  const p2 = runMigrationBatch(kv)
  assert.equal(p2.batchCount, 1)
  assert.equal(p2.status, 'done')
  assert.equal(readMigrationState(kv)?.cursor, 3)
  assert.equal(kv.getItem(LEGACY_MATERIALS_KEY), null)

  const views = buildMaterialViews(undefined, kv)
  assert.equal(views.length, 3)
  const m3 = views.find((v) => v.material.id === 'm3')!
  assert.equal(m3.status, 'missing')
  assert.equal(m3.content?.note, '失链') // 快照兜底
  const m1 = views.find((v) => v.material.id === 'm1')!
  assert.equal(m1.status, 'current')
  assert.equal(m1.referencedVersion?.id, v1Id)
  test('迁移分批可中断续跑，引用解析与失链兜底正确', () => {})
}

/* ---------- 9. 迁移遇容量上限：溢出进队列，补位后落单 ---------- */
console.log('9) 迁移尊重容量：满了进迁移队列，释放后补位')
{
  const kv = freshKV()
  const s1 = createScene(form('迁移容量A'), kv)
  const s2 = createScene(form('迁移容量B'), kv)

  // 10 条旧素材（容量 8 → 必然溢出）
  const legacy = Array.from({ length: 10 }, (_, i) => ({
    id: `lm-${i}`,
    sceneId: i % 2 === 0 ? s1.id : s2.id,
    snapshotId: s1.versions[0].id,
    addedAt: new Date(2026, 8, i + 1).toISOString(),
    ...form(`旧素材 ${i}`),
  }))
  kv.setItem(LEGACY_MATERIALS_KEY, JSON.stringify(legacy))

  // 先占掉大部分名额，只留 4 个
  const vid = s1.versions[0].id
  const OCCUPIED = MATERIAL_CAPACITY - 4
  for (let i = 0; i < OCCUPIED; i++) {
    enlistMaterial({ token: `block-${i}`, sceneId: s1.id, versionId: vid }, kv)
    commitMaterial(`block-${i}`, undefined, kv)
  }

  ensureMigration(kv)
  // 连续跑迁移直到结束：4 条直接落单，6 条排队
  let guard = 0
  while (readMigrationState(kv)?.status !== 'done' && guard++ < 20) {
    runMigrationBatch(kv)
  }
  assert.equal(readMigrationState(kv)?.status, 'done')
  const doc = getMaterialDoc(kv)
  assert.equal(doc.materials.length, MATERIAL_CAPACITY)
  assert.equal(doc.queue.length, 6)

  // 释放 2 个名额，2 条迁移素材依次补位
  removeMaterial(doc.materials[0].id, kv)
  removeMaterial(getMaterialDoc(kv).materials[0].id, kv)
  const after = getMaterialDoc(kv)
  assert.equal(after.materials.length, MATERIAL_CAPACITY)
  assert.equal(after.queue.length, 4)
  test('迁移溢出进队列，释放名额后自动补位', () => {})
}

console.log(`\n全部 ${passed} 组断言通过 ✅`)
