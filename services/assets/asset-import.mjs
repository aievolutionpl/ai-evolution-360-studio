import { run } from '../spirula-runner/index.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
export const IMPORT_LIMITS = { '.glb': 100 * 1024 ** 2, '.jpg': 20 * 1024 ** 2, '.jpeg': 20 * 1024 ** 2, '.png': 20 * 1024 ** 2, '.webp': 20 * 1024 ** 2 };

export async function validateGlb(bytes) {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Nieprawidłowy plik GLB 2.0.');
    let offset = 12, document = null, chunks = 0, binLength = 0;
    while (offset < bytes.length) {
        if (offset + 8 > bytes.length) throw new Error('Niepełny plik GLB.');
        const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
        if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Nieprawidłowa długość bloku GLB.');
        if (chunks === 0) {
            if (type !== 0x4e4f534a || length > 5 * 1024 ** 2) throw new Error('Brak poprawnego manifestu GLB.');
            try { document = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8')); } catch { throw new Error('Nieprawidłowy JSON modelu GLB.'); }
        } else if (chunks > 1 || type !== 0x004e4942) throw new Error('Nieobsługiwane bloki GLB.');
        else binLength = length;
        offset += 8 + length; chunks++;
    }
    if (document?.asset?.version !== '2.0' || !Array.isArray(document.meshes) || !document.meshes.length) throw new Error('GLB nie zawiera modelu glTF 2.0.');
    for (const resource of [...(document.buffers ?? []), ...(document.images ?? [])]) {
        if (resource.uri !== undefined && (typeof resource.uri !== 'string' || !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,[A-Za-z0-9+/=]+$/.test(resource.uri))) throw new Error('GLB musi zawierać wszystkie tekstury i bufory; zewnętrzne adresy są niedozwolone.');
    }
    for (const buffer of document.buffers ?? []) if (!buffer.uri && (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || buffer.byteLength > binLength)) throw new Error('Nieprawidłowy bufor modelu GLB.');
    try {
        const parsed = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
        if (!parsed.getRoot().listScenes().length || !parsed.getRoot().listMeshes().some(mesh => mesh.listPrimitives().some(p => p.getAttribute('POSITION')?.getCount() >= 3))) throw new Error('Brak geometrii modelu.');
    } catch { throw new Error('Nie można odczytać geometrii GLB. Sprawdź bufory i wymagane kompresje modelu.'); }
    return document;
}
export async function inspectImage(file, thumbnail, command = run) {
    const data = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { timeout: 15000 }));
    const image = data.streams?.find(s => s.codec_type === 'video');
    if (!image || !['png', 'mjpeg', 'webp'].includes(image.codec_name) || Number(image.nb_frames || 1) > 1 || data.streams.filter(s => s.codec_type === 'video').length !== 1 || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || image.width * image.height > 36000000) throw new Error('Nieprawidłowe zdjęcie lub zbyt duża rozdzielczość (maks. 36 MP, bok 8192 px).');
    await command('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-q:v', '3', '-y', thumbnail], { timeout: 30000 });
    return { width: image.width, height: image.height };
}
