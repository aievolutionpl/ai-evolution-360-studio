import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../storage/json.mjs';
import { relativeFile } from '../scene/scene-schema.mjs';

const read = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
export function readAnalysis(base, scene) {
    const frames = scene.analysis ? read(join(base, relativeFile(scene.analysis.frames))) : read(join(base, 'analysis', 'frames.json'));
    const analysis = scene.analysis ? read(join(base, relativeFile(scene.analysis.report))) : read(join(base, 'analysis', 'scene-analysis.json'));
    if (!frames && !analysis) return { frames: null, analysis: null };
    if (!frames || !analysis || frames.runId !== analysis.runId || (scene.analysis && analysis.runId !== scene.analysis.runId)) throw new Error('Niespójny raport analizy. Uruchom analizę ponownie.');
    return { frames, analysis };
}
export function commitAnalysis({ base, sceneManager, project, frames, analysis }) {
    if (frames.runId !== analysis.runId || !/^[a-zA-Z0-9_-]{1,80}$/.test(analysis.runId)) throw new Error('Niespójny identyfikator analizy.');
    const folder = join(base, 'analysis', 'runs', analysis.runId);
    mkdirSync(folder, { recursive: true });
    writeJson(join(folder, 'frames.json'), frames); writeJson(join(folder, 'scene-analysis.json'), analysis);
    // One atomic scene write publishes BOTH immutable run artifacts.
    sceneManager.commitAnalysis(project, { runId: analysis.runId, frames: `analysis/runs/${analysis.runId}/frames.json`, report: `analysis/runs/${analysis.runId}/scene-analysis.json`, provider: analysis.provider, sourceAttempt: analysis.sourceAttempt });
    // Compatibility copies for tools written for v0.6. Readers use the manifest pointer.
    writeJson(join(base, 'analysis', 'frames.json'), frames); writeJson(join(base, 'analysis', 'scene-analysis.json'), analysis);
}
