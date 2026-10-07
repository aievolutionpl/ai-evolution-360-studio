// Object-specific visibility takes precedence; older reports fall back to image sharpness.
export function selectObjectReference(object, frames) {
    const candidates = frames.filter(f => object.sourceFrames.includes(f.id));
    if (!candidates.length) throw new Error('Brak klatki źródłowej obiektu.');
    const maxSharpness = Math.max(1, ...candidates.map(f => f.sharpness ?? 0));
    const rank = frame => {
        const observation = object.observations?.find(o => o.frameId === frame.id);
        const quality = (frame.sharpness ?? 0) / maxSharpness;
        return observation ? 1 + observation.visibility * .6 + observation.bbox[2] * observation.bbox[3] * .2 + quality * .2 : quality;
    };
    const best = [...candidates].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))[0];
    const observation = object.observations?.find(o => o.frameId === best.id);
    return { frameId: best.id, path: best.path, method: observation ? 'visibility-and-quality' : 'frame-quality', ...(observation ? { bbox: observation.bbox, visibility: observation.visibility } : {}), isolated: false };
}
