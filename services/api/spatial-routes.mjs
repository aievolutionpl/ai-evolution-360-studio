import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SceneManager } from '../scene/scene-manager.mjs';
import { AssetManager } from '../assets/asset-manager.mjs';
import { JobManager } from '../jobs/job-manager.mjs';
import { visionProviders } from '../providers/vision-provider.mjs';
import { analyseProject } from '../vision/scene-analyser.mjs';
const read = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
export function createSpatialRoutes({ store, json, body, asset, reconstructionBusy }) {
    const scenes = new SceneManager(store), assets = new AssetManager(store), jobs = new JobManager(store); jobs.recover();
    async function handle(req, res, url) {
        if (url.pathname === '/api/spatial/providers' && req.method === 'GET') { json(res, visionProviders()); return true; }
        const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/(spatial|scene|assets|analyse|analysis-cancel|analysis-frame)$/);
        if (!match) return false;
        const [, id, action] = match;
        if (!existsSync(join(store.path(id), 'project.json'))) { json(res, { error: 'Nie znaleziono projektu.' }, 404); return true; }
        const project = store.get(id), base = store.path(id);
        const report = () => read(join(base, 'analysis', 'scene-analysis.json'));
        if (action === 'spatial' && req.method === 'GET') json(res, { scene: scenes.get(project), assets: assets.list(project), analysis: report(), frames: read(join(base, 'analysis', 'frames.json')), job: jobs.latest(project) });
        else if (action === 'scene' && req.method === 'GET') {
            const scene = scenes.get(project);
            if (url.searchParams.has('download')) asset(res, req, join(base, 'scene.json'), true); else json(res, scene);
        } else if (action === 'scene' && req.method === 'POST') { const data = await body(req, 250000); json(res, scenes.save(project, data.scene, data.revision)); }
        else if (action === 'assets' && req.method === 'GET') json(res, assets.list(project));
        else if (action === 'assets' && req.method === 'POST') {
            const data = await body(req), analysis = report(), frames = read(join(base, 'analysis', 'frames.json'));
            if (!analysis || !frames || !Array.isArray(data.objectIds) || !data.objectIds.length || data.objectIds.length > 40 || new Set(data.objectIds).size !== data.objectIds.length) throw new Error('Zaznacz obiekty z zakończonej analizy AI.');
            if (data.runId !== analysis.runId) throw new Error('Wynik analizy się zmienił. Odśwież listę obiektów.');
            const objects = data.objectIds.map(id => analysis.objects.find(o => o.id === id));
            if (objects.some(o => !o)) throw new Error('Wynik analizy się zmienił. Odśwież listę obiektów.');
            const existing = assets.list(project), result = objects.map(object => existing.find(a => a.metadata.analysisRun === analysis.runId && a.metadata.detectionId === object.id) ?? assets.create(project, { name: object.name, provider: analysis.provider, sourceImage: frames.frames.find(f => f.id === object.sourceFrames[0]).path, metadata: { analysisRun: analysis.runId, detectionId: object.id, description: object.description, materials: object.materials, confidence: object.confidence } }));
            json(res, result, 201);
        } else if (action === 'analyse' && req.method === 'POST') {
            if (reconstructionBusy()) throw new Error('Poczekaj na zakończenie rekonstrukcji lub eksportu.');
            if (['uploading', 'processing', 'cancelling'].includes(project.state) || !project.metadata) throw new Error('Najpierw zakończ dodawanie materiału.');
            const data = await body(req), provider = data.provider || 'local';
            if (!visionProviders().some(p => p.id === provider && p.configured)) throw new Error('Wybrany provider nie jest skonfigurowany.');
            json(res, jobs.start(project, provider, (job, update) => analyseProject({ project, store, job, update, provider })), 202);
        } else if (action === 'analysis-cancel' && req.method === 'POST') { jobs.cancel(project); json(res, { ok: true }); }
        else if (action === 'analysis-frame' && req.method === 'GET') {
            const run = url.searchParams.get('run'), file = url.searchParams.get('file');
            if (!/^[a-f0-9-]{36}$/.test(run || '') || !/^frame-\d{3}\.jpg$/.test(file || '')) throw new Error('Nieprawidłowa klatka.');
            asset(res, req, join(base, 'analysis', 'runs', run, 'selected-frames', file));
        } else json(res, { error: 'Nieobsługiwana metoda.' }, 405);
        return true;
    }
    return { handle, jobs, scenes, assets };
}
