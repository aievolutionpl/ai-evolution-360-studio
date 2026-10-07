import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../spirula-runner/index.mjs';
import { SceneManager } from '../scene/scene-manager.mjs';
import { commitAnalysis } from './analysis-store.mjs';
import { selectObjectReference } from './reference-selector.mjs';
import { scorePixels, selectFrames } from './frame-selector.mjs';
import { analyseVision } from '../providers/vision-provider.mjs';
function imageFiles(folder) {
    if (!existsSync(folder)) return [];
    return readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => e.isDirectory() ? imageFiles(join(folder, e.name)) : /\.(jpg|jpeg|png)$/i.test(e.name) ? [join(folder, e.name)] : []);
}
export async function analyseProject({ project, store, job, update, provider, count = 24, command = run, vision = analyseVision, sceneManager = new SceneManager(store) }) {
    const base = store.path(project.id), relative = `analysis/runs/${job.id}`, folder = join(base, relative);
    const candidates = join(folder, 'candidates'), selectedFolder = join(folder, 'selected-frames');
    mkdirSync(candidates, { recursive: true }); mkdirSync(selectedFolder, { recursive: true });
    update({ status: 'preparing', phase: 'Przygotowanie próbek materiału', progress: null });
    let sources = imageFiles(join(base, 'dataset', String(project.attempt), 'images'));
    if (!sources.length && project.kind === 'photos') sources = project.photos.map(p => join(base, 'source', 'photos', p.preview));
    if (!sources.length) {
        if (!project.sourcePath || !existsSync(project.sourcePath)) throw new Error('Dodaj poprawny materiał przed analizą.');
        const fps = Math.min(2, 72 / Math.max(1, project.metadata.duration));
        await command('ffmpeg', ['-v', 'error', '-i', project.sourcePath, '-map', '0:v:0', '-vf', `fps=${fps},scale=1280:-2`, '-frames:v', '72', '-q:v', '3', '-y', join(candidates, 'sample-%03d.jpg')], { job, timeout: 120000 });
        sources = imageFiles(candidates);
    }
    if (!sources.length) throw new Error('Nie uzyskano klatek. Sprawdź plik źródłowy.');
    const total = Math.min(72, sources.length), scored = [];
    for (let i = 0; i < total; i++) {
        update({ status: 'selecting', phase: `Ocena ostrości i podobieństwa · ${i + 1} / ${total}`, progress: Math.round(i / total * 100) });
        const sourceIndex = Math.floor(i * sources.length / total), source = sources[sourceIndex];
        const id = `frame-${String(i + 1).padStart(3, '0')}`, preview = join(selectedFolder, `${id}.jpg`), gray = join(folder, 'pixels.gray');
        await command('ffmpeg', ['-v', 'error', '-i', source, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', '-y', preview, '-frames:v', '1', '-vf', 'scale=256:144', '-pix_fmt', 'gray', '-f', 'rawvideo', '-y', gray], { job, timeout: 30000 });
        scored.push({ id, index: i, sourceIndex, path: `${relative}/selected-frames/${id}.jpg`, absolutePath: preview, ...scorePixels(readFileSync(gray), 256, 144) });
    }
    const selection = selectFrames(scored, { count });
    const chosen = new Set(selection.selected.map(f => f.id));
    for (const f of scored) if (!chosen.has(f.id)) rmSync(f.absolutePath);
    rmSync(join(folder, 'pixels.gray'), { force: true }); rmSync(candidates, { recursive: true, force: true });
    update({ status: 'analysing', phase: provider === 'local' ? 'Przygotowanie raportu jakości' : 'AI analizuje wybrane obrazy', progress: null });
    const report = await vision({ provider, frames: selection.selected, summary: selection.summary, signal: job.controller.signal });
    if (job.cancelled) throw new Error('Anulowano analizę.');
    const frames = { version: 1, runId: job.id, createdAt: new Date().toISOString(), summary: selection.summary, frames: selection.selected.map(({ absolutePath, signature, ...frame }) => frame) };
    const analysis = { ...report, version: 1, runId: job.id, createdAt: frames.createdAt, sourceAttempt: project.attempt, objects: report.objects.map(object => ({ ...object, reference: selectObjectReference(object, frames.frames) })) };
    commitAnalysis({ base, sceneManager, project, frames, analysis });
}
