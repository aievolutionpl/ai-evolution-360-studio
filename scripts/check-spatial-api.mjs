import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from '../services/spirula-runner/index.mjs';
import { Document, NodeIO } from '@gltf-transform/core';
const url = process.argv[2] || 'http://127.0.0.1:8766';
const folder = resolve('docs/verification'); mkdirSync(folder, { recursive: true });
const video = join(folder, 'spatial-integration.mp4');
await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=512x256:rate=12:duration=14', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video], { timeout: 30000 });
const health = await (await fetch(url + '/api/health')).json();
assert.equal(health.product, 'AI Evolution 360 Studio'); assert.equal(health.version, '0.6.0');
const headers = { 'X-Studio-Token': health.token, 'Content-Type': 'application/json' };
async function api(path, data) {
    const response = await fetch(url + path, data === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(data) });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`); return result;
}
const upload = await fetch(url + '/api/upload?name=Spatial-integration.mp4', { method: 'POST', headers: { 'X-Studio-Token': health.token, 'Content-Type': 'application/octet-stream' }, body: readFileSync(video) });
const project = await upload.json(); assert.equal(upload.status, 201, JSON.stringify(project));
const prefix = `/api/projects/${project.id}`;
const initial = await api(prefix + '/spatial'); assert.equal(initial.scene.version, 1); assert.equal(initial.scene.environment, null);
const saved = await api(prefix + '/scene', { scene: { ...initial.scene, lighting: { exposure: 1.2 } }, revision: initial.scene.revision }); assert.equal(saved.revision, 1);
const conflict = await fetch(url + prefix + '/scene', { method: 'POST', headers, body: JSON.stringify({ scene: initial.scene, revision: 0 }) }); assert.equal(conflict.status, 409);
const denied = await fetch(url + prefix + '/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(denied.status, 403);
const job = await api(prefix + '/analyse', { provider: 'local' }); assert.equal(job.status, 'queued');
const deadline = Date.now() + 120000; let spatial;
while (Date.now() < deadline) {
    spatial = await api(prefix + '/spatial');
    if (['completed', 'failed', 'cancelled'].includes(spatial.job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
}
assert.equal(spatial.job.status, 'completed', JSON.stringify(spatial.job)); assert.equal(spatial.analysis.provider, 'local'); assert.equal(spatial.analysis.objects.length, 0);
assert.ok(spatial.frames.frames.length > 1); assert.ok(spatial.frames.summary.sampled <= 72); assert.ok(spatial.frames.frames.length <= 24);
const frame = spatial.frames.frames[0]; const image = await fetch(url + prefix + `/analysis-frame?run=${spatial.frames.runId}&file=${frame.id}.jpg`);
assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg'); assert.ok((await image.arrayBuffer()).byteLength > 100);
const traversal = await fetch(url + prefix + '/analysis-frame?run=../../secret&file=x'); assert.equal(traversal.status, 400);
const manifest = await fetch(url + prefix + '/scene?download=1'); assert.ok(manifest.headers.get('content-disposition').includes('attachment')); assert.equal((await manifest.json()).revision, spatial.scene.revision);
assert.equal(spatial.scene.analysis.runId, spatial.analysis.runId);
const binaryHeaders = { 'X-Studio-Token': health.token, 'Content-Type': 'application/octet-stream' };
async function importAsset(suffix, bytes, status = 201) {
    const response = await fetch(url + prefix + '/assets/' + suffix, { method: 'POST', headers: binaryHeaders, body: bytes });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}
const jpg = Buffer.from(await (await fetch(url + prefix + `/analysis-frame?run=${spatial.frames.runId}&file=${frame.id}.jpg`)).arrayBuffer());
const reference = await importAsset('import?name=Reference.jpg', jpg);
assert.equal(reference.type, 'reference'); assert.ok(reference.files.thumbnail);
const document = new Document(), buffer = document.createBuffer();
const positions = document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(document.createPrimitive().setAttribute('POSITION', positions))));
const glb = await new NodeIO().writeBinary(document);
const generated = await importAsset(`${reference.id}/import?name=Object.glb&version=1`, glb, 200);
assert.equal(generated.type, 'glb'); assert.equal(generated.files.sourceImage, reference.files.sourceImage);
const stale = await fetch(url + prefix + `/assets/${reference.id}/import?name=Object.glb&version=1`, { method: 'POST', headers: binaryHeaders, body: glb }); assert.equal(stale.status, 409);
const deniedImport = await fetch(url + prefix + '/assets/import?name=Object.glb', { method: 'POST', body: glb }); assert.equal(deniedImport.status, 403);
const deniedOrigin = await fetch(url + prefix + '/assets/import?name=Object.glb', { method: 'POST', headers: { ...binaryHeaders, Origin: 'https://example.com' }, body: glb }); assert.equal(deniedOrigin.status, 403);
const renamedResponse = await fetch(url + prefix + `/assets/${reference.id}`, { method: 'PATCH', headers, body: JSON.stringify({ version: 2, patch: { name: 'Reference + GLB' } }) });
assert.equal(renamedResponse.status, 200); assert.equal((await renamedResponse.json()).version, 3);
const downloaded = await fetch(url + prefix + `/assets/${reference.id}/file?slot=model&download=1`); assert.equal(downloaded.headers.get('content-type'), 'model/gltf-binary'); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from(glb));
const thumbnail = await fetch(url + prefix + `/assets/${reference.id}/file?slot=thumbnail`); assert.equal(thumbnail.status, 200); assert.equal(thumbnail.headers.get('content-type'), 'image/jpeg');
assert.equal((await api(prefix + `/assets/${reference.id}/versions`)).length, 3);
const inventory = (await api(prefix + '/scene')).assets; assert.equal(inventory.length, 1); assert.equal(inventory[0].version, 3);
const invalidImport = await fetch(url + prefix + '/assets/import?name=Bad.glb', { method: 'POST', headers: binaryHeaders, body: Buffer.from('invalid') }); assert.equal(invalidImport.status, 400);
assert.equal((await api(prefix + '/assets')).length, 1);
const previousRun = spatial.analysis.runId;
await api(prefix + '/analyse', { provider: 'local' }); await api(prefix + '/analysis-cancel', {});
const cancelDeadline = Date.now() + 15000;
while (Date.now() < cancelDeadline) {
    const state = await api(prefix + '/spatial');
    if (state.job.status === 'cancelled') { assert.equal(state.analysis.runId, previousRun); break; }
    assert.ok(!['failed', 'completed'].includes(state.job.status), JSON.stringify(state.job));
    await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal((await api(prefix + '/spatial')).job.status, 'cancelled');
await api(prefix + '/archive', {});
console.log(`Spatial API + real FFmpeg + asset import/versioning/security: PASS; ${spatial.frames.frames.length}/${spatial.frames.summary.sampled} frames; project ${project.id} archived.`);
