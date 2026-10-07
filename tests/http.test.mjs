import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { body, safePath, asset } from '../services/api/http.mjs';
import { fixture } from './fixtures/spatial.mjs';
test('JSON body limits measure bytes and invalid JSON fails explicitly', async () => {
    assert.deepEqual(await body(Readable.from([Buffer.from('{"name":"żółć"}')])), { name: 'żółć' });
    await assert.rejects(body(Readable.from([Buffer.from('"żółć"')]), 6), e => e.status === 413);
    await assert.rejects(body(Readable.from([Buffer.from('{bad')])), /JSON/);
});
test('safe HTTP file paths reject traversal and GLB ranges preserve content headers', t => {
    const { base } = fixture(t); assert.throws(() => safePath(base, '../outside')); assert.throws(() => safePath(base, base));
    const file = join(base, 'test.glb'); writeFileSync(file, 'glbdata');
    let status, headers;
    const res = { writeHead: (s, h) => { status = s; headers = h; }, end: () => {} };
    asset(res, { method: 'HEAD', headers: { range: 'bytes=0-2' } }, file, true);
    assert.equal(status, 206); assert.equal(headers['Content-Length'], 3); assert.equal(headers['Content-Type'], 'model/gltf-binary');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff'); assert.ok(headers['Content-Disposition'].includes('attachment'));
    asset(res, { method: 'HEAD', headers: { range: 'bytes=50-' } }, file); assert.equal(status, 416);
});
