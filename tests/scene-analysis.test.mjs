import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SceneManager } from '../services/scene/scene-manager.mjs';
import { AssetManager } from '../services/assets/asset-manager.mjs';
import { commitAnalysis, readAnalysis } from '../services/vision/analysis-store.mjs';
import { validateScene } from '../services/scene/scene-schema.mjs';
import { selectObjectReference } from '../services/vision/reference-selector.mjs';
import { parseAnalysis } from '../services/vision/analysis-schema.mjs';
import { fixture } from './fixtures/spatial.mjs';
const detection = { name: 'Chair', description: 'Wooden chair', movable: true, confidence: .9, sourceFrames: ['frame-001', 'frame-002'] };
const frames = [{ id: 'frame-001', path: 'first.jpg', sharpness: 5 }, { id: 'frame-002', path: 'best.jpg', sharpness: 100 }];
test('legacy v1 manifests acquire catalog without changing user objects or project sources', t => {
    const { store, project, base } = fixture(t), scenes = new SceneManager(store), assets = new AssetManager(store);
    const legacy = scenes.get(project); delete legacy.assets; delete legacy.analysis;
    legacy.metadata.custom = 'keep'; writeFileSync(join(base, 'scene.json'), JSON.stringify(legacy));
    const asset = assets.create(project, { name: 'Chair' }), before = readFileSync(join(base, 'project.json'));
    const migrated = scenes.get(project);
    assert.equal(migrated.version, 1); assert.equal(migrated.assets[0].id, asset.id); assert.equal(migrated.metadata.custom, 'keep');
    assert.deepEqual(readFileSync(join(base, 'project.json')), before); assert.equal(JSON.parse(readFileSync(join(base, 'scene-history', '0.json'))).assets, undefined);
    assert.equal(scenes.get(project).revision, migrated.revision);
});
test('asset versions update scene catalog and clients cannot replace managed run/catalog fields', t => {
    const { store, project } = fixture(t), scenes = new SceneManager(store), assets = new AssetManager(store);
    const first = assets.create(project, { name: 'Chair' }), initial = scenes.get(project);
    assets.edit(project, first.id, { name: 'Armchair' }, first.version);
    assert.throws(() => scenes.save(project, initial, initial.revision), e => e.status === 409);
    const current = scenes.get(project), saved = scenes.save(project, { ...current, assets: [], analysis: { runId: 'fake' } }, current.revision);
    assert.equal(saved.assets[0].version, 2); assert.equal(saved.analysis, null);
    assert.throws(() => validateScene({ ...saved, assets: [saved.assets[0], saved.assets[0]] }));
    assert.throws(() => validateScene({ ...saved, analysis: { runId: 'fake', frames: '../secret' } }));
});
test('legacy project saves synchronise outputs without overwriting composition', t => {
    const { store, project, base } = fixture(t), scenes = new SceneManager(store);
    scenes.get(project); store.onSave = value => scenes.get(value);
    project.output = { web: '1', ply: '1/splat.ply' }; store.save(project);
    assert.equal(JSON.parse(readFileSync(join(base, 'scene.json'))).environment.variant, '1');
    project.output = { web: '1-clean', ply: '1-clean/splat.ply' }; store.save(project);
    assert.equal(JSON.parse(readFileSync(join(base, 'scene.json'))).environment.variant, '1-clean');
});
test('analysis publishes immutable artifacts through one scene pointer and ignores broken aliases', t => {
    const { store, project, base } = fixture(t), sceneManager = new SceneManager(store);
    const bundle = runId => ({ frames: { runId, frames }, analysis: { runId, provider: 'local', sourceAttempt: 0, objects: [] } });
    commitAnalysis({ base, sceneManager, project, ...bundle('run-1') });
    writeFileSync(join(base, 'analysis', 'frames.json'), '{broken alias');
    let scene = sceneManager.get(project); assert.equal(readAnalysis(base, scene).analysis.runId, 'run-1');
    assert.throws(() => commitAnalysis({ base, project, sceneManager: { commitAnalysis: () => { throw new Error('Interrupted'); } }, ...bundle('run-2') }), /Interrupted/);
    scene = sceneManager.get(project); assert.equal(readAnalysis(base, scene).frames.runId, 'run-1');
    assert.ok(existsSync(join(base, 'analysis', 'runs', 'run-2', 'frames.json')));
    commitAnalysis({ base, sceneManager, project, ...bundle('run-3') });
    assert.equal(readAnalysis(base, sceneManager.get(project)).analysis.runId, 'run-3');
});
test('analysis reader rejects inconsistent legacy pairs and run path traversal', t => {
    const { base } = fixture(t);
    assert.deepEqual(readAnalysis(base, { analysis: null }), { frames: null, analysis: null });
    assert.throws(() => readAnalysis(base, { analysis: { frames: '../secret', report: '../secret' } }));
});
test('reference selection uses visibility then quality and provides a truthful legacy fallback', () => {
    assert.equal(selectObjectReference(detection, frames).frameId, 'frame-002');
    const object = { ...detection, observations: [{ frameId: 'frame-001', bbox: [.1, .1, .7, .7], visibility: 1 }, { frameId: 'frame-002', bbox: [.1, .1, .1, .1], visibility: .1 }] };
    const best = selectObjectReference(object, frames); assert.equal(best.frameId, 'frame-001'); assert.equal(best.isolated, false);
    assert.equal(best.method, 'visibility-and-quality'); assert.throws(() => selectObjectReference({ sourceFrames: ['missing'] }, frames));
});
test('AI observations validate frame IDs, bounds, visibility and duplicates', () => {
    const observation = { frameId: 'frame-001', bbox: [.1, .2, .3, .4], visibility: .8 };
    const parse = observations => parseAnalysis({ summary: 'Room', objects: [{ ...detection, observations }] }, frames);
    assert.equal(parse([observation]).objects[0].observations.length, 1);
    for (const observations of [[{ ...observation, frameId: 'fake' }], [{ ...observation, bbox: [.9, .2, .3, .4] }], [{ ...observation, visibility: 2 }], [observation, observation], [{ ...observation, bbox: [0, 0, 0, 1] }]]) assert.throws(() => parse(observations));
});
