import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateScene } from './scene-schema.mjs';
import { writeJson } from '../storage/json.mjs';
import { assetReference } from '../assets/asset-schema.mjs';
import { AssetManager } from '../assets/asset-manager.mjs';
export { writeJson } from '../storage/json.mjs';
export function projectEnvironment(project) {
    if (!project.output) return null;
    return { type: 'gaussian-splat', sog: `web/${project.output.web}/scene.sog`, ply: `splat/${project.output.ply}`, mesh: project.meshOutput?.sourceWeb === project.output.web ? `mesh/${project.meshOutput.file}` : '', variant: project.output.web };
}
export class SceneManager {
    constructor(store, { assets = new AssetManager(store) } = {}) { this.store = store; this.assets = assets; }
    catalog(project) {
        return this.assets.list(project).map(assetReference);
    }
    get(project) {
        const file = join(this.store.path(project.id), 'scene.json');
        const environment = projectEnvironment(project);
        if (!existsSync(file)) {
            const scene = validateScene({ version: 1, revision: 0, environment, assets: this.catalog(project), analysis: null, objects: [], lighting: {}, audio: {}, camera: {}, metadata: { projectId: project.id, name: project.name, createdAt: project.createdAt, migratedFrom: 'project.json', coordinateSystem: { up: 'Y', units: 'scene-units', rotation: 'radians', metricScale: 'unverified' } } });
            writeJson(file, scene); return scene;
        }
        const scene = validateScene(JSON.parse(readFileSync(file, 'utf8')));
        const assets = this.catalog(project);
        if (JSON.stringify(environment) !== JSON.stringify(scene.environment) || JSON.stringify(assets) !== JSON.stringify(scene.assets) || scene.analysis === undefined) return this.save(project, { ...scene, environment, assets, analysis: scene.analysis ?? null }, scene.revision, true);
        return scene;
    }
    save(project, input, expectedRevision, sync = false) {
        const file = join(this.store.path(project.id), 'scene.json');
        const previous = sync ? validateScene(JSON.parse(readFileSync(file, 'utf8'))) : this.get(project);
        if (expectedRevision !== previous.revision) { const error = new Error('Scena została zmieniona. Odśwież dane przed zapisem.'); error.status = 409; throw error; }
        // Environment/catalog/run pointers are server-owned; composition and metadata are editable.
        const scene = validateScene({ ...input, environment: projectEnvironment(project), assets: this.catalog(project), analysis: sync ? input.analysis : previous.analysis, revision: previous.revision + 1, metadata: { ...input.metadata, projectId: project.id, updatedAt: new Date().toISOString() } });
        const history = join(this.store.path(project.id), 'scene-history'); mkdirSync(history, { recursive: true });
        writeJson(join(history, `${previous.revision}.json`), previous); writeJson(file, scene); return scene;
    }
    commitAnalysis(project, analysis) {
        const previous = this.get(project);
        return this.save(project, { ...previous, analysis }, previous.revision, true);
    }
}
