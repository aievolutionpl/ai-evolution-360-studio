import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateScene } from './scene-schema.mjs';
export function writeJson(path, data) {
    writeFileSync(path + '.tmp', JSON.stringify(data, null, 2));
    renameSync(path + '.tmp', path);
}
export function projectEnvironment(project) {
    if (!project.output) return null;
    return { type: 'gaussian-splat', sog: `web/${project.output.web}/scene.sog`, ply: `splat/${project.output.ply}`, mesh: project.meshOutput?.sourceWeb === project.output.web ? `mesh/${project.meshOutput.file}` : '', variant: project.output.web };
}
export class SceneManager {
    constructor(store) { this.store = store; }
    get(project) {
        const file = join(this.store.path(project.id), 'scene.json');
        const environment = projectEnvironment(project);
        if (!existsSync(file)) {
            const scene = validateScene({ version: 1, revision: 0, environment, objects: [], lighting: {}, audio: {}, camera: {}, metadata: { projectId: project.id, name: project.name, createdAt: project.createdAt, migratedFrom: 'project.json', coordinateSystem: { up: 'Y', units: 'scene-units', rotation: 'radians', metricScale: 'unverified' } } });
            writeJson(file, scene); return scene;
        }
        const scene = validateScene(JSON.parse(readFileSync(file, 'utf8')));
        if (JSON.stringify(environment) !== JSON.stringify(scene.environment)) return this.save(project, { ...scene, environment }, scene.revision, true);
        return scene;
    }
    save(project, input, expectedRevision, sync = false) {
        const file = join(this.store.path(project.id), 'scene.json');
        const previous = sync ? validateScene(JSON.parse(readFileSync(file, 'utf8'))) : this.get(project);
        if (expectedRevision !== previous.revision) { const error = new Error('Scena została zmieniona. Odśwież dane przed zapisem.'); error.status = 409; throw error; }
        const scene = validateScene({ ...input, environment: projectEnvironment(project), revision: previous.revision + 1, metadata: { ...input.metadata, projectId: project.id, updatedAt: new Date().toISOString() } });
        const history = join(this.store.path(project.id), 'scene-history'); mkdirSync(history, { recursive: true });
        writeJson(join(history, `${previous.revision}.json`), previous); writeJson(file, scene); return scene;
    }
}
