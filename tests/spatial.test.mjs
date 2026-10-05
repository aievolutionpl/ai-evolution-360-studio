import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../services/project-manager/index.mjs';
import { SceneManager } from '../services/scene/scene-manager.mjs';
import { validateScene, relativeFile } from '../services/scene/scene-schema.mjs';
import { AssetManager } from '../services/assets/asset-manager.mjs';
import { scorePixels, selectFrames } from '../services/vision/frame-selector.mjs';
import { parseAnalysis, analyseVision, visionProviders } from '../services/providers/vision-provider.mjs';
import { JobManager } from '../services/jobs/job-manager.mjs';
import { analyseProject } from '../services/vision/scene-analyser.mjs';
import { createSpatialRoutes } from '../services/api/spatial-routes.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'spatial-studio-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const store = new ProjectStore(root), project = store.create('Testowa przestrzeń');
    project.state = 'uploaded'; project.metadata = { duration: 20 }; store.save(project);
    return { root, store, project, base: store.path(project.id) };
}
const object = { id: 'chair', name: 'Fotel', asset: 'assets/chair/model.glb', sourceImage: '', referenceImage: '', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: 'static', visible: true, metadata: {} };
test('old projects migrate without modifying sources or project.json', t => {
    const { store, project, base } = fixture(t), scenes = new SceneManager(store), previous = readFileSync(join(base, 'project.json'), 'utf8');
    writeFileSync(join(base, 'source', 'keep.txt'), 'original');
    const scene = scenes.get(project); assert.equal(scene.version, 1); assert.equal(scene.environment, null);
    assert.deepEqual(scenes.get(project), scene); assert.equal(readFileSync(join(base, 'project.json'), 'utf8'), previous); assert.equal(readFileSync(join(base, 'source', 'keep.txt'), 'utf8'), 'original');
});
test('manifest sync follows cleaned variants and only matching meshes; objects survive', t => {
    const { store, project } = fixture(t), scenes = new SceneManager(store);
    const scene = scenes.get(project); scene.objects.push(structuredClone(object)); scenes.save(project, scene, 0);
    project.output = { web: '1-clean', ply: '1/run/step/splat.ply' }; project.meshOutput = { sourceWeb: '1', file: '1/scene.glb' };
    let result = scenes.get(project); assert.equal(result.environment.sog, 'web/1-clean/scene.sog'); assert.equal(result.environment.mesh, ''); assert.equal(result.objects.length, 1);
    project.meshOutput.sourceWeb = '1-clean'; result = scenes.get(project); assert.equal(result.environment.mesh, 'mesh/1/scene.glb');
});
test('scene writes create history and reject stale revisions', t => {
    const { store, project, base } = fixture(t), scenes = new SceneManager(store), initial = scenes.get(project);
    const saved = scenes.save(project, { ...initial, lighting: { exposure: 1 } }, initial.revision);
    assert.equal(saved.revision, 1); assert.ok(existsSync(join(base, 'scene-history', '0.json')));
    assert.throws(() => scenes.save(project, initial, 0), error => error.status === 409);
});
test('scene validation rejects duplicates, unsafe paths, invalid transforms and future versions', t => {
    const { store, project } = fixture(t), scene = new SceneManager(store).get(project);
    const withObject = { ...scene, objects: [structuredClone(object)] };
    assert.equal(validateScene(withObject), withObject);
    assert.throws(() => validateScene({ ...scene, version: 99 }), /wersja/);
    assert.throws(() => validateScene({ ...scene, objects: [object, object] }), /unikalne/);
    for (const path of ['../outside', 'C:/private', '/private', 'assets/../../x', 'assets\\x', 'https://host/x']) assert.throws(() => relativeFile(path));
    const bad = structuredClone(withObject); bad.objects[0].transform.scale[0] = 0; assert.throws(() => validateScene(bad), /wektor/);
    bad.objects[0].transform.scale[0] = Infinity; assert.throws(() => validateScene(bad));
    assert.throws(() => validateScene(JSON.parse('{"version":1,"metadata":{"__proto__":{}}}')), /klucz/);
});
test('asset manager persists version history, metadata and safe relative files', t => {
    const { store, project, base } = fixture(t), assets = new AssetManager(store);
    const first = assets.create(project, { name: 'Fotel', sourceImage: 'analysis/runs/test/selected-frames/frame-001.jpg', metadata: { confidence: .9 }, provider: 'openai' });
    assert.equal(first.version, 1); assert.equal(assets.list(project).length, 1);
    const next = assets.save(project, { ...first, name: 'Fotel przy oknie' }, first.version);
    assert.equal(next.version, 2); assert.equal(assets.get(project, first.id).name, 'Fotel przy oknie');
    assert.ok(existsSync(join(base, 'assets', first.id, 'versions', '1.json')));
    assert.throws(() => assets.save(project, first, 1), error => error.status === 409);
    assert.throws(() => assets.get(project, '../secret'));
});
test('invalid asset creation leaves library usable', t => {
    const { store, project } = fixture(t), assets = new AssetManager(store);
    assert.throws(() => assets.create(project, { name: '', sourceImage: '../secret' })); assert.deepEqual(assets.list(project), []);
});
test('sharpness distinguishes textured image from blurred flat image', () => {
    const flat = Buffer.alloc(256 * 144, 100), sharp = Buffer.from(flat.map((_, i) => i % 2 ? 255 : 0));
    assert.equal(scorePixels(flat, 256, 144).sharpness, 0); assert.ok(scorePixels(sharp, 256, 144).sharpness > 1000);
    assert.throws(() => scorePixels(flat, 10, 10));
});
test('frame selector prioritizes sharpness, removes duplicates and covers timeline', () => {
    const frames = Array.from({ length: 30 }, (_, index) => ({ index, sharpness: index % 3 === 1 ? 100 : 20, signature: Array.from({ length: 144 }, (_, k) => .5 + .5 * Math.sin((index + 1) * (k + 1) * .97)), exposure: .5 }));
    const result = selectFrames(frames, { count: 10 }); assert.equal(result.selected.length, 10);
    assert.ok(result.selected.every(f => f.index % 3 === 1)); assert.ok(result.selected[0].index < 3); assert.ok(result.selected.at(-1).index > 26);
    const same = selectFrames(frames.map(f => ({ ...f, signature: frames[0].signature }))); assert.equal(same.selected.length, 1); assert.ok(same.summary.similar > 0); assert.ok(same.summary.warnings.length);
    assert.throws(() => selectFrames([], {})); assert.throws(() => selectFrames(frames, { count: 50 }));
});
const detection = { name: 'Fotel', description: 'Zielony fotel', movable: true, confidence: .9, sourceFrames: ['frame-001'], materials: ['tkanina'] };
test('AI parser rejects hallucinated references and filters structures and people marked immovable', () => {
    const frames = [{ id: 'frame-001' }];
    const parsed = parseAnalysis({ summary: 'Salon', objects: [detection, { ...detection, name: 'wall' }, { ...detection, name: 'Ściana' }, { ...detection, name: 'Person', movable: true }] }, frames);
    assert.equal(parsed.objects.length, 1); assert.equal(parsed.objects[0].name, 'Fotel');
    assert.throws(() => parseAnalysis({ summary: 'Salon', objects: [{ ...detection, sourceFrames: ['fake'] }] }, frames), /referencji/);
    assert.throws(() => parseAnalysis({ summary: 'Salon', objects: [{ ...detection, confidence: 2 }] }, frames));
    assert.throws(() => parseAnalysis({ objects: [] }, frames));
    assert.throws(() => parseAnalysis({ summary: 'Salon', objects: [null] }, frames));
});
test('local provider makes no API calls and creates no invented detections', async () => {
    const result = await analyseVision({ provider: 'local', frames: [], summary: {}, fetchImpl: () => { throw new Error('network'); } });
    assert.equal(result.provider, 'local'); assert.deepEqual(result.objects, []); assert.equal(visionProviders()[0].configured, true);
});
test('cloud provider keeps key out of public configuration and normalizes structured response', async t => {
    const { base } = fixture(t), path = join(base, 'frame.jpg'); writeFileSync(path, 'fixture');
    const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key-not-a-secret';
    t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
    let called = false;
    const result = await analyseVision({ provider: 'openai', frames: [{ id: 'frame-001', absolutePath: path }], summary: {}, fetchImpl: async (url, options) => { called = true; assert.equal(url, 'https://api.openai.com/v1/chat/completions'); assert.ok(options.headers.Authorization); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Salon', objects: [detection] }) } }] }) }; } });
    assert.ok(called); assert.equal(result.objects.length, 1); assert.ok(!JSON.stringify(visionProviders()).includes('test-key'));
    await assert.rejects(analyseVision({ provider: 'openai', frames: [], summary: {}, fetchImpl: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
});
test('jobs report stages, reject concurrency, complete and persist', async t => {
    const { store, project } = fixture(t), jobs = new JobManager(store);
    const job = jobs.start(project, 'local', async (_, update) => { update({ status: 'selecting', progress: 50 }); });
    assert.equal(job.status, 'queued'); assert.throws(() => jobs.start(project, 'local', () => {}));
    await jobs.active.promise; assert.equal(jobs.latest(project).status, 'completed'); assert.equal(jobs.active, null);
});
test('job cancellation aborts provider and preserves truthful cancelled status', async t => {
    const { store, project } = fixture(t), jobs = new JobManager(store);
    jobs.start(project, 'openai', async context => new Promise(resolve => { context.controller.signal.addEventListener('abort', resolve); }));
    const pending = jobs.active.promise; await new Promise(resolve => setImmediate(resolve)); jobs.cancel(project); await pending;
    assert.equal(jobs.latest(project).status, 'cancelled'); assert.match(jobs.latest(project).error, /Anulowano/);
});
test('unfinished jobs recover as interrupted; failures remain visible', async t => {
    const { store, project } = fixture(t), jobs = new JobManager(store);
    const folder = join(store.path(project.id), 'jobs'); mkdirSync(folder);
    const id = '11111111-1111-4111-a111-111111111111'; writeFileSync(join(folder, `${id}.json`), JSON.stringify({ id, status: 'analysing', startedAt: new Date().toISOString() }));
    jobs.recover(); assert.equal(jobs.latest(project).status, 'interrupted');
    jobs.start(project, 'local', async () => { throw new Error('Material error'); }); await jobs.active.promise;
    assert.equal(jobs.latest(project).status, 'failed'); assert.equal(jobs.latest(project).error, 'Material error');
});
test('analysis pipeline commits selected frames and local report, keeps sources', async t => {
    const { store, project, base } = fixture(t); project.kind = 'photos'; project.photos = [];
    const folder = join(base, 'source', 'photos'); mkdirSync(folder);
    for (let i = 0; i < 6; i++) { const file = `${i}.jpg`; writeFileSync(join(folder, file), 'source'); project.photos.push({ preview: file }); }
    const job = { id: '11111111-1111-4111-a111-111111111111', cancelled: false, controller: new AbortController() }, updates = [];
    await analyseProject({ project, store, job, update: value => updates.push(value), provider: 'local', command: async (_, args) => { const output = args.at(-1); writeFileSync(output, Buffer.alloc(256 * 144, 70 + updates.length * 25)); const preview = args[args.indexOf('-y') + 1]; writeFileSync(preview, 'preview'); } });
    const frames = JSON.parse(readFileSync(join(base, 'analysis', 'frames.json'))), report = JSON.parse(readFileSync(join(base, 'analysis', 'scene-analysis.json')));
    assert.equal(frames.runId, job.id); assert.equal(report.provider, 'local'); assert.ok(frames.frames.length > 1); assert.deepEqual(report.objects, []);
    assert.ok(!JSON.stringify(frames).includes('absolutePath')); assert.equal(readFileSync(join(folder, '0.jpg'), 'utf8'), 'source'); assert.ok(updates.some(u => u.status === 'selecting'));
});
test('spatial API serves migrated scene, denies unknown methods and validates frame paths', async t => {
    const { store, project } = fixture(t); let response;
    const routes = createSpatialRoutes({ store, json: (_, data, status = 200) => { response = { data, status }; }, body: async () => ({}), asset: () => { throw new Error('must not serve unsafe file'); }, reconstructionBusy: () => false });
    const url = action => new URL(`http://localhost/api/projects/${project.id}/${action}`);
    assert.equal(await routes.handle({ method: 'GET' }, {}, url('spatial')), true); assert.equal(response.data.scene.version, 1);
    await routes.handle({ method: 'DELETE' }, {}, url('scene')); assert.equal(response.status, 405);
    await assert.rejects(routes.handle({ method: 'GET' }, {}, url('analysis-frame?run=../../secret&file=x')), /klatka/);
});
test('saving AI references is idempotent and rejects outdated analysis runs', async t => {
    const { store, project, base } = fixture(t); let response, input;
    const folder = join(base, 'analysis'); mkdirSync(folder);
    writeFileSync(join(folder, 'scene-analysis.json'), JSON.stringify({ runId: 'run-1', provider: 'openai', objects: [{ ...detection, id: 'object-1' }] }));
    writeFileSync(join(folder, 'frames.json'), JSON.stringify({ runId: 'run-1', frames: [{ id: 'frame-001', path: 'analysis/runs/run-1/selected-frames/frame-001.jpg' }] }));
    const routes = createSpatialRoutes({ store, json: (_, data) => { response = data; }, body: async () => input, asset: () => {}, reconstructionBusy: () => false });
    const url = new URL(`http://localhost/api/projects/${project.id}/assets`);
    input = { runId: 'run-1', objectIds: ['object-1'] };
    await routes.handle({ method: 'POST' }, {}, url); const id = response[0].id;
    await routes.handle({ method: 'POST' }, {}, url); assert.equal(response[0].id, id); assert.equal(routes.assets.list(project).length, 1);
    assert.equal(response[0].files.model, ''); assert.equal(response[0].status, 'reference');
    input.runId = 'old'; await assert.rejects(routes.handle({ method: 'POST' }, {}, url), /zmienił/);
});
