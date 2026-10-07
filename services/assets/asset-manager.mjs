import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeJson } from '../storage/json.mjs';
import { validAssetId, validateAsset, FILE_SLOTS } from './asset-schema.mjs';
import { validateGlb, inspectImage, IMPORT_LIMITS } from './asset-import.mjs';
export { validAssetId } from './asset-schema.mjs';
export class AssetManager {
    constructor(store, { imageInspector = inspectImage } = {}) { this.store = store; this.imageInspector = imageInspector; this.importing = new Set(); }
    folder(project, id) {
        if (!validAssetId(id)) throw new Error('Nieprawidłowy identyfikator assetu.');
        return join(this.store.path(project.id), 'assets', id);
    }
    get(project, id) {
        const file = join(this.folder(project, id), 'object.json');
        if (!existsSync(file)) { const e = new Error('Nie znaleziono assetu.'); e.status = 404; throw e; }
        const value = validateAsset(JSON.parse(readFileSync(file, 'utf8')));
        if (value.id !== id) throw new Error('Niespójny identyfikator assetu.');
        return value;
    }
    list(project) {
        const folder = join(this.store.path(project.id), 'assets');
        return existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory() && validAssetId(e.name) && existsSync(join(folder, e.name, 'object.json'))).map(e => this.get(project, e.name)).sort((a, b) => a.id.localeCompare(b.id)) : [];
    }
    create(project, input) {
        if (this.list(project).length >= 500) throw new Error('Biblioteka może zawierać do 500 assetów.');
        return this.save(project, { id: randomUUID(), version: 0, name: input.name, status: 'reference', files: { model: '', sourceImage: input.sourceImage ?? '', referenceImage: '', thumbnail: input.sourceImage ?? '' }, provider: input.provider ?? 'manual', metadata: input.metadata ?? {}, createdAt: new Date().toISOString() });
    }
    save(project, input, expectedVersion) {
        const folder = this.folder(project, input.id), file = join(folder, 'object.json');
        const previous = existsSync(file) ? this.get(project, input.id) : null;
        if (!previous && this.list(project).length >= 500) throw new Error('Biblioteka może zawierać do 500 assetów.');
        if (previous && expectedVersion !== previous.version) { const e = new Error('Asset został zmieniony. Odśwież bibliotekę.'); e.status = 409; throw e; }
        const value = validateAsset({ ...input, createdAt: previous?.createdAt ?? input.createdAt, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() });
        mkdirSync(join(folder, 'versions'), { recursive: true });
        writeJson(join(folder, 'versions', `${value.version}.json`), value); writeJson(file, value); return value;
    }
    edit(project, id, patch, version) {
        const previous = this.get(project, id);
        if (!patch || Object.keys(patch).some(key => !['name', 'metadata'].includes(key))) throw new Error('Możesz zmienić nazwę i metadane assetu.');
        return this.save(project, { ...previous, ...patch }, version);
    }
    file(project, id, slot) {
        if (!FILE_SLOTS.includes(slot)) throw new Error('Nieobsługiwany plik assetu.');
        const value = this.get(project, id), path = value.files[slot], base = realpathSync(this.store.path(project.id));
        if (!path || !existsSync(join(base, path))) { const e = new Error('Nie znaleziono pliku assetu.'); e.status = 404; throw e; }
        const actual = realpathSync(join(base, path));
        if (!actual.startsWith(base + sep) || !statSync(actual).isFile()) throw new Error('Plik poza katalogiem projektu.');
        if (!/^\.(glb|jpg|jpeg|png|webp)$/i.test(extname(actual))) throw new Error('Niedozwolony format pliku assetu.');
        return actual;
    }
    async importStream(project, stream, { name, id, version, provider = 'manual', metadata = {} }) {
        const extension = extname(String(name)).toLowerCase(), model = extension === '.glb';
        if (!Object.hasOwn(IMPORT_LIMITS, extension)) throw new Error('Wybierz GLB, JPG, PNG lub WebP.');
        const limit = IMPORT_LIMITS[extension], size = Number(stream.headers?.['content-length']);
        if (stream.headers?.['content-length'] !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > limit)) { const e = new Error('Przekroczono limit pliku: GLB 100 MiB, zdjęcie 20 MiB.'); e.status = 413; throw e; }
        const assetId = id ?? randomUUID(), key = `${project.id}/${assetId}`;
        if (this.importing.has(key)) { const e = new Error('Trwa aktualizacja tego assetu.'); e.status = 409; throw e; }
        const previous = id ? this.get(project, id) : null;
        if (previous && previous.version !== version) { const e = new Error('Asset został zmieniony. Odśwież bibliotekę.'); e.status = 409; throw e; }
        if (!previous && this.list(project).length >= 500) throw new Error('Biblioteka może zawierać do 500 assetów.');
        const folder = join(this.folder(project, assetId), 'files', randomUUID());
        this.importing.add(key);
        try {
            let received = 0; const chunks = [];
            for await (const chunk of stream) { received += chunk.length; if (received <= limit) chunks.push(chunk); }
            if (!received || received > limit || (Number.isFinite(size) && received !== size)) throw new Error('Plik nie został przesłany w całości lub przekracza limit.');
            const bytes = Buffer.concat(chunks);
            if (model) await validateGlb(bytes);
            mkdirSync(folder, { recursive: true });
            const filename = model ? 'model.glb' : `reference${extension}`;
            writeFileSync(join(folder, filename), bytes, { flag: 'wx' });
            let image = null;
            if (!model) image = await this.imageInspector(join(folder, filename), join(folder, 'thumbnail.jpg'));
            const base = resolve(this.store.path(project.id));
            const relative = path => resolve(path).slice(base.length + 1).split(sep).join('/');
            const files = previous ? { ...previous.files } : { model: '', sourceImage: '', referenceImage: '', thumbnail: '' };
            if (model) files.model = relative(join(folder, filename));
            else { files.sourceImage ||= relative(join(folder, filename)); files.referenceImage = relative(join(folder, filename)); files.thumbnail = relative(join(folder, 'thumbnail.jpg')); }
            return this.save(project, { ...previous, id: assetId, version: previous?.version ?? 0, name: previous?.name ?? String(name).replace(/\.[^.]+$/, '').slice(0, 140), status: files.model ? 'ready' : 'reference', files, provider: previous?.provider ?? provider, metadata: { ...previous?.metadata, ...metadata, imports: [...(previous?.metadata.imports ?? []), { bytes: received, format: extension, provider, ...(image ?? {}) }].slice(-30) }, createdAt: previous?.createdAt ?? new Date().toISOString() }, version);
        } catch (error) { rmSync(folder, { recursive: true, force: true }); throw error; }
        finally { this.importing.delete(key); }
    }
}
