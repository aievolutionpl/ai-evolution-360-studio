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
    const ids = new Set();
    for (const object of scene.objects) {
        plainObject(object, 'Obiekt');
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(object.id) || ids.has(object.id)) throw new Error('Identyfikatory obiektów muszą być unikalne.');
        ids.add(object.id);
        if (typeof object.name !== 'string' || !object.name.trim() || object.name.length > 140) throw new Error('Nieprawidłowa nazwa obiektu.');
        for (const key of ['asset', 'sourceImage', 'referenceImage']) relativeFile(object[key] ?? '');
        plainObject(object.transform, 'Transformacja');
        vector(object.transform.position, 'position'); vector(object.transform.rotation, 'rotation'); vector(object.transform.scale, 'scale', true);
        if (!['static', 'rigidbody', 'ghost'].includes(object.physics)) throw new Error('Nieprawidłowy typ fizyki.');
        if (typeof object.visible !== 'boolean') throw new Error('Nieprawidłowa widoczność.');
        plainObject(object.metadata, 'Metadane obiektu');
    }
    for (const key of ['lighting', 'audio', 'camera', 'metadata']) plainObject(scene[key], key);
    return scene;
}
