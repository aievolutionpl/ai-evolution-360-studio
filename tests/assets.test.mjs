import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AssetManager } from '../services/assets/asset-manager.mjs';
import { validateAsset } from '../services/assets/asset-schema.mjs';
import { validateGlb, inspectImage, IMPORT_LIMITS } from '../services/assets/asset-import.mjs';
import { fixture, modelGlb } from './fixtures/spatial.mjs';
function upload(bytes, declared = bytes.length) { const stream = Readable.from([bytes.subarray(0, 11), bytes.subarray(11)]); stream.headers = { 'content-length': String(declared) }; return stream; }
test('GLB imports preserve bytes and replacing a model preserves history and references', async t => {
    const { store, project, base } = fixture(t), assets = new AssetManager(store), bytes = await modelGlb();
    const first = await assets.importStream(project, upload(bytes), { name: 'Chair.glb', provider: 'fal', metadata: { generationId: 'request-1' } });
    assert.equal(first.type, 'glb'); assert.equal(first.status, 'ready'); assert.equal(first.provider, 'fal');
    assert.deepEqual(readFileSync(assets.file(project, first.id, 'model')), bytes);
    const second = await assets.importStream(project, upload(bytes), { name: 'Replacement.glb', id: first.id, version: 1 });
    assert.equal(second.id, first.id); assert.equal(second.version, 2); assert.equal(second.metadata.generationId, 'request-1');
    assert.notEqual(second.files.model, first.files.model); assert.ok(existsSync(join(base, first.files.model)));
    assert.equal(JSON.parse(readFileSync(join(base, 'assets', first.id, 'versions', '1.json'))).files.model, first.files.model);
    await assert.rejects(assets.importStream(project, upload(bytes), { name: 'Old.glb', id: first.id, version: 1 }), e => e.status === 409);
});
test('photo references can gain a generated GLB without losing source image or provenance', async t => {
    const { store, project } = fixture(t);
    const assets = new AssetManager(store, { imageInspector: async (_, thumb) => { writeFileSync(thumb, 'thumbnail'); return { width: 640, height: 480 }; } });
    const image = await assets.importStream(project, upload(Buffer.from('image')), { name: 'Reference.jpg' });
    assert.equal(image.type, 'reference'); assert.equal(image.metadata.imports[0].width, 640);
    const model = await assets.importStream(project, upload(await modelGlb()), { name: 'Generated.glb', id: image.id, version: image.version, provider: 'fal' });
    assert.equal(model.type, 'glb'); assert.equal(model.files.sourceImage, image.files.sourceImage); assert.equal(model.files.thumbnail, image.files.thumbnail);
    assert.equal(model.metadata.imports.at(-1).provider, 'fal');
});
test('asset metadata edits enforce revisions and reject file/provider mutation', t => {
    const { store, project } = fixture(t), assets = new AssetManager(store), first = assets.create(project, { name: 'Chair' });
    assert.equal(assets.edit(project, first.id, { name: 'Armchair' }, 1).version, 2);
    assert.throws(() => assets.edit(project, first.id, { name: 'Stale' }, 1), e => e.status === 409);
    assert.throws(() => assets.edit(project, first.id, { files: {} }, 2));
    assert.throws(() => validateAsset({ ...first, status: 'ready' }));
    assert.throws(() => validateAsset({ ...first, provider: '../../secret' }));
});
test('invalid, oversized and incomplete imports leave no published asset', async t => {
    const { store, project } = fixture(t), assets = new AssetManager(store);
    await assert.rejects(assets.importStream(project, upload(Buffer.from('bad')), { name: 'Bad.glb' }));
    await assert.rejects(assets.importStream(project, upload(Buffer.from('bad')), { name: 'Bad.svg' }));
    await assert.rejects(assets.importStream(project, upload(Buffer.from('bad'), IMPORT_LIMITS['.glb'] + 1), { name: 'Big.glb' }), e => e.status === 413);
    await assert.rejects(assets.importStream(project, upload(Buffer.from('bad'), 4), { name: 'Short.glb' }));
    assert.deepEqual(assets.list(project), []);
});
test('failed decoding and interrupted asset folders do not break the library', async t => {
    const { store, project, base } = fixture(t), assets = new AssetManager(store, { imageInspector: async () => { throw new Error('Decode failed'); } });
    mkdirSync(join(base, 'assets', 'interrupted'), { recursive: true }); writeFileSync(join(base, 'assets', 'notes.txt'), 'notes');
    await assert.rejects(assets.importStream(project, upload(Buffer.from('bad image')), { name: 'Image.png' }), /Decode/);
    assert.deepEqual(assets.list(project), []);
});
test('concurrent replacements and edits during decoding cannot silently overwrite a version', async t => {
    const { store, project } = fixture(t); let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const assets = new AssetManager(store, { imageInspector: async (_, thumb) => { started(); await new Promise(resolve => { release = resolve; }); writeFileSync(thumb, 'thumb'); return {}; } });
    const first = assets.create(project, { name: 'Chair' });
    const pending = assets.importStream(project, upload(Buffer.from('image')), { name: 'Image.jpg', id: first.id, version: 1 });
    await ready;
    await assert.rejects(assets.importStream(project, upload(Buffer.from('image')), { name: 'Image.jpg', id: first.id, version: 1 }), e => e.status === 409);
    assets.edit(project, first.id, { name: 'Edited' }, 1); release();
    await assert.rejects(pending, e => e.status === 409); assert.equal(assets.get(project, first.id).name, 'Edited');
});
test('asset downloads reject missing slots, traversal and non-media files', t => {
    const { store, project } = fixture(t), assets = new AssetManager(store), value = assets.create(project, { name: 'Reference', sourceImage: 'project.json' });
    assert.throws(() => assets.file(project, value.id, 'sourceImage'), /format/);
    assert.throws(() => assets.file(project, value.id, '../../secret'));
    assert.throws(() => assets.file(project, value.id, 'model'), e => e.status === 404);
    assert.throws(() => assets.get(project, 'missing'), e => e.status === 404);
});
test('GLB validation rejects malformed chunks, external textures and invalid geometry', async () => {
    const valid = await modelGlb(); assert.equal((await validateGlb(valid)).asset.version, '2.0');
    const corrupt = Buffer.from(valid); corrupt.writeUInt32LE(1000000, 12); await assert.rejects(validateGlb(corrupt));
    await assert.rejects(validateGlb(valid.subarray(0, -1)));
    const encode = document => { let json = Buffer.from(JSON.stringify(document)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]); const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length, 8); head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16); return Buffer.concat([head, json]); };
    await assert.rejects(validateGlb(encode({ asset: { version: '2.0' }, meshes: [{}], images: [{ uri: 'https://evil/image.png' }] })), /zewnętrzne/);
    await assert.rejects(validateGlb(encode({ asset: { version: '2.0' }, meshes: [{}] })), /geometrii/);
});
test('image inspection rejects disguised videos, animated input and decompression-sized images', async () => {
    for (const changes of [{ codec_name: 'h264' }, { nb_frames: '2' }, { width: 9000 }, { width: 8000, height: 8000 }]) {
        await assert.rejects(inspectImage('input', 'thumb', async () => JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'png', width: 640, height: 480, ...changes }] })));
    }
    let thumbnail = false;
    const info = await inspectImage('input', 'thumb', async (command, args) => { if (command === 'ffmpeg') { thumbnail = true; assert.equal(args.at(-1), 'thumb'); return ''; } return JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'png', width: 640, height: 480 }] }); });
    assert.ok(thumbnail); assert.equal(info.width, 640);
});
