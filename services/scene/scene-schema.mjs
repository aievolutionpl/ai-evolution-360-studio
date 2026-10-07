export const SCENE_VERSION = 1;
export function relativeFile(value, label = 'Ścieżka') {
    if (typeof value !== 'string' || value.length > 500 || (value && (!/^[\w./ -]+$/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')))) throw new Error(`${label}: wymagana bezpieczna ścieżka względna.`);
    return value;
}
export function plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: wymagany obiekt.`);
    const visit = (v, depth = 0) => {
        if (depth > 12) throw new Error('Zbyt głęboka struktura danych.');
        if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Nieprawidłowa liczba.');
        if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) {
            if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Niedozwolony klucz.');
            visit(child, depth + 1);
        }
    };
    visit(value);
    return value;
}
function vector(v, name, positive = false) {
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(n) || Math.abs(n) > 1e6 || (positive && n <= 0))) throw new Error(`Nieprawidłowy wektor ${name}.`);
}
export function validateScene(scene) {
    plainObject(scene, 'Scena');
    if (JSON.stringify(scene).length > 200000) throw new Error('Manifest jest zbyt duży.');
    if (scene.version !== SCENE_VERSION) throw new Error('Nieobsługiwana wersja sceny.');
    if (!Number.isSafeInteger(scene.revision) || scene.revision < 0) throw new Error('Nieprawidłowa rewizja.');
    if (scene.environment !== null) {
        plainObject(scene.environment, 'Środowisko');
        if (scene.environment.type !== 'gaussian-splat') throw new Error('Nieobsługiwany typ środowiska.');
        for (const key of ['sog', 'ply', 'mesh']) relativeFile(scene.environment[key]);
    }
    if (!Array.isArray(scene.objects) || scene.objects.length > 500) throw new Error('Nieprawidłowa lista obiektów.');
    // Additive v1 fields: legacy manifests without these fields remain valid.
    if (scene.assets !== undefined) {
        if (!Array.isArray(scene.assets) || scene.assets.length > 500) throw new Error('Nieprawidłowy katalog assetów.');
        const assetIds = new Set();
        for (const entry of scene.assets) {
            plainObject(entry, 'Referencja assetu');
            if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || assetIds.has(entry.id)) throw new Error('Nieprawidłowy identyfikator assetu w scenie.');
            assetIds.add(entry.id);
            if (!Number.isSafeInteger(entry.version) || entry.version < 1 || !['glb', 'reference'].includes(entry.type) || !['ready', 'reference'].includes(entry.status)) throw new Error('Nieprawidłowa referencja assetu.');
            if (entry.manifest !== `assets/${entry.id}/object.json`) throw new Error('Nieprawidłowa ścieżka manifestu assetu.');
            if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 140) throw new Error('Nieprawidłowa nazwa assetu.');
        }
    }
    if (scene.analysis !== undefined && scene.analysis !== null) {
        const analysis = plainObject(scene.analysis, 'Analiza');
        if (typeof analysis.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(analysis.runId)) throw new Error('Nieprawidłowy identyfikator analizy.');
        if (analysis.frames !== `analysis/runs/${analysis.runId}/frames.json` || analysis.report !== `analysis/runs/${analysis.runId}/scene-analysis.json`) throw new Error('Nieprawidłowe ścieżki analizy.');
        if (!Number.isSafeInteger(analysis.sourceAttempt) || analysis.sourceAttempt < 0 || typeof analysis.provider !== 'string') throw new Error('Nieprawidłowa referencja analizy.');
    }
    const ids = new Set();
    for (const object of scene.objects) {
        plainObject(object, 'Obiekt');
        if (typeof object.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(object.id) || ids.has(object.id)) throw new Error('Identyfikatory obiektów muszą być unikalne.');
        ids.add(object.id);
        if (typeof object.name !== 'string' || !object.name.trim() || object.name.length > 140) throw new Error('Nieprawidłowa nazwa obiektu.');
        for (const key of ['asset', 'sourceImage', 'referenceImage']) relativeFile(object[key] ?? '');
        plainObject(object.transform, 'Transformacja');
        vector(object.transform.position, 'position'); vector(object.transform.rotation, 'rotation'); vector(object.transform.scale, 'scale', true);
        if (!['static', 'rigidbody', 'ghost'].includes(object.physics)) throw new Error('Nieprawidłowy typ fizyki.');
        if (typeof object.visible !== 'boolean') throw new Error('Nieprawidłowa widoczność.');
        plainObject(object.metadata, 'Metadane obiektu');
        if (object.assetId !== undefined && !scene.assets?.some(a => a.id === object.assetId)) throw new Error('Obiekt wskazuje nieznany asset.');
    }
    for (const key of ['lighting', 'audio', 'camera', 'metadata']) plainObject(scene[key], key);
    return scene;
}
