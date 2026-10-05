import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { relativeFile, plainObject } from '../scene/scene-schema.mjs';
import { writeJson } from '../scene/scene-manager.mjs';
export const validAssetId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export class AssetManager {
    constructor(store) { this.store = store; }
    folder(project, id) {
        if (!validAssetId(id)) throw new Error('Nieprawidłowy identyfikator assetu.');
        return join(this.store.path(project.id), 'assets', id);
    }
    get(project, id) { return JSON.parse(readFileSync(join(this.folder(project, id), 'object.json'), 'utf8')); }
    list(project) {
        const folder = join(this.store.path(project.id), 'assets');
        return existsSync(folder) ? readdirSync(folder).filter(validAssetId).map(id => this.get(project, id)) : [];
    }
    create(project, input) {
        const id = randomUUID();
        return this.save(project, { id, version: 0, name: input.name, status: 'reference', files: { model: '', sourceImage: input.sourceImage ?? '', referenceImage: '', thumbnail: input.sourceImage ?? '' }, provider: input.provider ?? 'manual', metadata: input.metadata ?? {}, createdAt: new Date().toISOString() });
    }
    save(project, input, expectedVersion) {
        const folder = this.folder(project, input.id), file = join(folder, 'object.json');
        const previous = existsSync(file) ? this.get(project, input.id) : null;
        if (previous && expectedVersion !== previous.version) { const e = new Error('Asset został zmieniony. Odśwież bibliotekę.'); e.status = 409; throw e; }
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 140) throw new Error('Podaj nazwę assetu (do 140 znaków).');
        plainObject(input.files, 'Pliki assetu'); plainObject(input.metadata, 'Metadane');
        for (const value of Object.values(input.files)) relativeFile(value);
        if (!['reference', 'ready'].includes(input.status)) throw new Error('Nieprawidłowy status assetu.');
        const value = { ...input, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
        mkdirSync(join(folder, 'versions'), { recursive: true });
        writeJson(join(folder, 'versions', `${value.version}.json`), value); writeJson(file, value); return value;
    }
}
