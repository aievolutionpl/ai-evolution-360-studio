import { readFileSync } from 'node:fs';
const structural = /\b(wall|walls|floor|flooring|ceiling|window|windows|door|stairs|staircase|column|built-in|person|people|human|sciana|sciany|podloga|sufit|okno|okna|drzwi|schody|osoba|ludzie|czlowiek)\b/i;
export function parseAnalysis(input, frames) {
    if (!input || typeof input !== 'object' || typeof input.summary !== 'string' || !Array.isArray(input.objects) || input.objects.length > 100) throw new Error('AI zwróciło nieprawidłowy raport sceny.');
    const allowed = new Set(frames.map(f => f.id));
    if (input.objects.some(o => !o || typeof o !== 'object' || Array.isArray(o))) throw new Error('AI zwróciło nieprawidłową listę obiektów.');
    const objects = input.objects.filter(o => o.movable === true && !structural.test(`${o.name} ${o.category || ''}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l'))).map((o, i) => {
        if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 140 || typeof o.description !== 'string' || o.description.length > 1000 || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1 || !Array.isArray(o.sourceFrames) || !o.sourceFrames.length || o.sourceFrames.some(f => !allowed.has(f))) throw new Error('AI zwróciło obiekt bez wiarygodnej referencji.');
        const id = `object-${i + 1}`;
        return { id, name: o.name, description: o.description, confidence: o.confidence, sourceFrames: [...new Set(o.sourceFrames)], movable: true, materials: Array.isArray(o.materials) ? o.materials.filter(v => typeof v === 'string').slice(0, 10).map(v => v.slice(0, 80)) : [] };
    });
    return { summary: input.summary.slice(0, 2000), sceneType: String(input.sceneType || 'unknown').slice(0, 80), staticElements: Array.isArray(input.staticElements) ? input.staticElements.filter(v => typeof v === 'string').slice(0, 30).map(v => v.slice(0, 100)) : [], objects };
}
export function visionProviders() {
    return [{ id: 'local', name: 'Lokalna ocena materiału', configured: true, cloud: false }, { id: 'openai', name: 'AI · rozpoznawanie obiektów', configured: Boolean(process.env.OPENAI_API_KEY), cloud: true }];
}
export async function analyseVision({ provider, frames, summary, signal, fetchImpl = fetch }) {
    if (provider === 'local') return { provider: 'local', summary: 'Wybrano ostre i zróżnicowane ujęcia. Lokalna ocena materiału nie rozpoznaje obiektów ani nie potwierdza poprawnej geometrii 3D.', sceneType: 'unclassified', staticElements: [], objects: [] };
    if (provider !== 'openai') throw new Error('Nieobsługiwany provider analizy.');
    if (!process.env.OPENAI_API_KEY) throw new Error('Brak OPENAI_API_KEY w lokalnym pliku .env. Po konfiguracji uruchom Studio ponownie.');
    const content = [{ type: 'text', text: 'Analyse these ordered views of the SAME real space. Return only a JSON object with summary (Polish), sceneType, staticElements (strings), objects: [{name (Polish), description (Polish), materials (strings), movable:true, confidence (0..1), sourceFrames (use supplied frame ids)}]. Detect separate physical movable objects only. Do not list walls, floors, ceilings, windows, doors, stairs, built-in structures or people. Do not group a table with chairs. Deduplicate the same object across views only when confident; do not invent unseen objects or 3D coordinates. These may be panoramas or distorted fisheye views. Report limitations in summary. Maximum 40 objects. Frame quality summary: ' + JSON.stringify(summary) }];
    for (const frame of frames) content.push({ type: 'text', text: `Frame ${frame.id}` }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + readFileSync(frame.absolutePath).toString('base64'), detail: 'low' } });
    const timeout = AbortSignal.timeout(180000);
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.STUDIO_VISION_MODEL || 'gpt-4.1-mini', response_format: { type: 'json_object' }, temperature: .2, max_tokens: 5000, messages: [{ role: 'user', content }] }) });
    if (!response.ok) throw new Error(`Dostawca AI odpowiedział HTTP ${response.status}. Sprawdź klucz, limit i dostępność modelu.`);
    const data = await response.json(); let parsed;
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content); } catch { throw new Error('Nie udało się odczytać odpowiedzi AI. Spróbuj ponownie.'); }
    return { provider, model: process.env.STUDIO_VISION_MODEL || 'gpt-4.1-mini', ...parseAnalysis(parsed, frames) };
}
