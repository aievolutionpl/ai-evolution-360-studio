import { plainObject, relativeFile } from '../scene/scene-schema.mjs';

export const validAssetId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export const FILE_SLOTS = ['model', 'sourceImage', 'referenceImage', 'thumbnail'];
export function validateAsset(input) {
    plainObject(input, 'Asset');
    if (!validAssetId(input.id)) throw new Error('Nieprawidłowy identyfikator assetu.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 140) throw new Error('Podaj nazwę assetu (do 140 znaków).');
    if (!Number.isSafeInteger(input.version) || input.version < 0) throw new Error('Nieprawidłowa wersja assetu.');
    if (typeof input.provider !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.provider)) throw new Error('Nieprawidłowy provider assetu.');
    plainObject(input.files, 'Pliki assetu'); plainObject(input.metadata, 'Metadane');
    if (JSON.stringify(input).length > 50000) throw new Error('Metadane assetu są zbyt duże.');
    for (const [slot, value] of Object.entries(input.files)) {
        if (!FILE_SLOTS.includes(slot)) throw new Error('Nieobsługiwany plik assetu.');
        relativeFile(value);
    }
    for (const slot of FILE_SLOTS) if (typeof input.files[slot] !== 'string') throw new Error('Niepełna lista plików assetu.');
    if (!['reference', 'ready'].includes(input.status) || (input.status === 'ready' && !input.files.model)) throw new Error('Nieprawidłowy status assetu.');
    if (input.files.model && !input.files.model.endsWith('.glb')) throw new Error('Model assetu musi być plikiem GLB.');
    return { ...input, type: input.files.model ? 'glb' : 'reference' };
}
export function assetReference(asset) {
    return { id: asset.id, name: asset.name, version: asset.version, type: asset.type, status: asset.status, manifest: `assets/${asset.id}/object.json` };
}
