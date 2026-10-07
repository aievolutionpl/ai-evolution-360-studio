import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function createAssetRoutes({ store, assets, scenes, json, body, asset }) {
    return async (req, res, url) => {
        const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/assets\/([a-zA-Z0-9_-]+)(?:\/(import|file|versions))?$/);
        if (!match) return false;
        const [, projectId, id, operation] = match;
        if (!existsSync(join(store.path(projectId), 'project.json'))) { json(res, { error: 'Nie znaleziono projektu.' }, 404); return true; }
        const project = store.get(projectId);
        if (req.method === 'POST' && (operation === 'import' || (id === 'import' && !operation))) {
            const name = url.searchParams.get('name'), version = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : undefined;
            const value = await assets.importStream(project, req, { name, id: operation ? id : undefined, version });
            scenes.get(store.get(projectId)); json(res, value, operation ? 200 : 201);
        } else if (req.method === 'GET' && operation === 'file') asset(res, req, assets.file(project, id, url.searchParams.get('slot') ?? 'model'), url.searchParams.has('download'));
        else if (req.method === 'GET' && operation === 'versions') {
            const current = assets.get(project, id);
            const folder = join(assets.folder(project, id), 'versions');
            json(res, readdirSync(folder).filter(f => /^\d+\.json$/.test(f) && Number(f.slice(0, -5)) <= current.version).map(f => JSON.parse(readFileSync(join(folder, f), 'utf8'))).sort((a, b) => b.version - a.version));
        } else if (req.method === 'GET' && !operation) json(res, assets.get(project, id));
        else if (req.method === 'PATCH' && !operation) {
            const data = await body(req, 60000), value = assets.edit(project, id, data.patch, data.version);
            scenes.get(store.get(projectId)); json(res, value);
        } else json(res, { error: 'Nieobsługiwana metoda.' }, 405);
        return true;
    };
}
