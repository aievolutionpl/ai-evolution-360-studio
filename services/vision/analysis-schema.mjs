const structural = /\b(wall|walls|floor|flooring|ceiling|window|windows|door|stairs|staircase|column|built-in|person|people|human|sciana|sciany|podloga|sufit|okno|okna|drzwi|schody|osoba|ludzie|czlowiek)\b/i;
export function parseAnalysis(input, frames) {
    if (!input || typeof input !== 'object' || typeof input.summary !== 'string' || !Array.isArray(input.objects) || input.objects.length > 100) throw new Error('AI zwróciło nieprawidłowy raport sceny.');
    const allowed = new Set(frames.map(f => f.id));
    if (input.objects.some(o => !o || typeof o !== 'object' || Array.isArray(o))) throw new Error('AI zwróciło nieprawidłową listę obiektów.');
    const objects = input.objects.filter(o => o.movable === true && !structural.test(`${o.name} ${o.category || ''}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[łŁ]/g, 'l'))).map((o, i) => {
        if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 140 || typeof o.description !== 'string' || o.description.length > 1000 || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1 || !Array.isArray(o.sourceFrames) || !o.sourceFrames.length || o.sourceFrames.some(f => !allowed.has(f))) throw new Error('AI zwróciło obiekt bez wiarygodnej referencji.');
        const observations = o.observations ?? [];
        if (!Array.isArray(observations) || observations.length > frames.length) throw new Error('Nieprawidłowe obserwacje obiektu.');
        const seen = new Set();
        for (const observation of observations) {
            if (!observation || !o.sourceFrames.includes(observation.frameId) || seen.has(observation.frameId) || !Array.isArray(observation.bbox) || observation.bbox.length !== 4 || observation.bbox.some(v => !Number.isFinite(v) || v < 0 || v > 1) || observation.bbox[2] <= 0 || observation.bbox[3] <= 0 || observation.bbox[0] + observation.bbox[2] > 1.000001 || observation.bbox[1] + observation.bbox[3] > 1.000001 || !Number.isFinite(observation.visibility) || observation.visibility < 0 || observation.visibility > 1) throw new Error('Nieprawidłowa referencja 2D obiektu.');
            seen.add(observation.frameId);
        }
        return { id: `object-${i + 1}`, name: o.name.trim(), description: o.description, confidence: o.confidence, sourceFrames: [...new Set(o.sourceFrames)], observations: observations.map(o => ({ frameId: o.frameId, bbox: [...o.bbox], visibility: o.visibility })), movable: true, materials: Array.isArray(o.materials) ? o.materials.filter(v => typeof v === 'string').slice(0, 10).map(v => v.slice(0, 80)) : [] };
    });
    return { summary: input.summary.slice(0, 2000), sceneType: String(input.sceneType || 'unknown').slice(0, 80), staticElements: Array.isArray(input.staticElements) ? input.staticElements.filter(v => typeof v === 'string').slice(0, 30).map(v => v.slice(0, 100)) : [], objects };
}
