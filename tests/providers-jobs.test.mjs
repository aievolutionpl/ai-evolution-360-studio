import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '../services/providers/provider-registry.mjs';
import { openaiVision } from '../services/providers/openai-vision.mjs';
import { JobManager } from '../services/jobs/job-manager.mjs';
import { fixture } from './fixtures/spatial.mjs';
test('provider registry validates plugins, exposes capabilities and observes cancellation', async () => {
    const plugin = { id: 'custom', name: 'Custom', cloud: true, privateField: 'hidden', configured: () => true, run: async () => ({ summary: 'Room' }) };
    const registry = new ProviderRegistry([plugin]);
    assert.ok(!JSON.stringify(registry.list()).includes('hidden'));
    assert.equal((await registry.run('custom', {})).summary, 'Room');
    await assert.rejects(registry.run('missing', {})); assert.throws(() => new ProviderRegistry([plugin, plugin]));
    assert.throws(() => new ProviderRegistry([{ ...plugin, id: undefined }]));
    await assert.rejects(new ProviderRegistry([{ ...plugin, configured: () => false }]).run('custom', {}), /Custom/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(registry.run('custom', { signal: controller.signal }), e => e.name === 'AbortError');
});
function key(t) { const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'fixture'; t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }); }
const success = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"summary":"Room","objects":[]}' } }] }) });
test('OpenAI retries only transient HTTP failures within a bounded budget', async t => {
    key(t); let calls = 0;
    const context = { provider: 'openai', frames: [], summary: {}, retryDelays: [0, 0] };
    const result = await openaiVision({ ...context, fetchImpl: async () => ++calls < 3 ? { ok: false, status: 429 } : success() });
    assert.equal(calls, 3); assert.equal(result.provider, 'openai');
    calls = 0; await assert.rejects(openaiVision({ ...context, fetchImpl: async () => { calls++; return { ok: false, status: 401 }; } }), /HTTP 401/); assert.equal(calls, 1);
    calls = 0; await assert.rejects(openaiVision({ ...context, fetchImpl: async () => { calls++; return { ok: false, status: 503 }; } }), /HTTP 503/); assert.equal(calls, 3);
});
test('OpenAI cancellation interrupts retry delay and malformed responses fail', async t => {
    key(t); const controller = new AbortController(); let calls = 0;
    await assert.rejects(openaiVision({ provider: 'openai', frames: [], summary: {}, signal: controller.signal, fetchImpl: async () => { calls++; controller.abort(); return { ok: false, status: 429 }; } }), e => e.name === 'AbortError');
    assert.equal(calls, 1);
    await assert.rejects(openaiVision({ provider: 'openai', frames: [], summary: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [] }) }) }), /odczytać/);
});
test('recovery interrupts all unfinished jobs even if newest is completed', t => {
    const { store, project, base } = fixture(t), folder = join(base, 'jobs'); mkdirSync(folder);
    const older = '11111111-1111-4111-a111-111111111111', newer = '22222222-2222-4222-a222-222222222222';
    writeFileSync(join(folder, `${older}.json`), JSON.stringify({ id: older, status: 'analysing', startedAt: '2026-10-01T00:00:00Z' }));
    writeFileSync(join(folder, `${newer}.json`), JSON.stringify({ id: newer, status: 'completed', startedAt: '2026-10-02T00:00:00Z' }));
    const jobs = new JobManager(store); jobs.recover();
    assert.equal(JSON.parse(readFileSync(join(folder, `${older}.json`))).status, 'interrupted'); assert.equal(jobs.latest(project).status, 'completed');
});
test('job persistence failure releases active lock and remains visible', async t => {
    const { store, project, base } = fixture(t), jobs = new JobManager(store);
    jobs.start(project, 'local', async () => { rmSync(join(base, 'jobs'), { recursive: true }); });
    await jobs.active.promise; assert.equal(jobs.active, null); assert.equal(jobs.latest(project).status, 'failed'); assert.match(jobs.latest(project).error, /zapisać/);
    jobs.start(project, 'local', async () => {}); await jobs.active.promise; assert.equal(jobs.latest(project).status, 'completed');
});
