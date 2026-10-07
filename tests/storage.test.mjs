import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../services/storage/json.mjs';
import { fixture } from './fixtures/spatial.mjs';
test('failed JSON serialization preserves last manifest and leaves no temporary file', t => {
    const { base } = fixture(t), file = join(base, 'manifest.json');
    writeJson(file, { revision: 1 }); const cyclic = {}; cyclic.self = cyclic;
    assert.throws(() => writeJson(file, cyclic));
    assert.equal(JSON.parse(readFileSync(file)).revision, 1); assert.ok(!readdirSync(base).some(f => f.endsWith('.tmp')));
});
test('failed rename cleans its unique temporary file without altering existing target', t => {
    const { base } = fixture(t), target = join(base, 'directory'); mkdirSync(target);
    assert.throws(() => writeJson(target, { revision: 2 })); assert.ok(!readdirSync(base).some(f => f.endsWith('.tmp')));
    assert.deepEqual(readdirSync(target), []);
});
