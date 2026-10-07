import { readFileSync } from 'node:fs';
import { parseAnalysis } from '../vision/analysis-schema.mjs';
import { analysisPrompt } from '../vision/analysis-prompt.mjs';
import { setTimeout as delay } from 'node:timers/promises';
export async function openaiVision({ provider, frames, summary, signal, fetchImpl = fetch, retryDelays = [500, 1000] }) {
    if (!process.env.OPENAI_API_KEY) throw new Error('Brak OPENAI_API_KEY w lokalnym pliku .env. Po konfiguracji uruchom Studio ponownie.');
    const content = [{ type: 'text', text: analysisPrompt(summary) }];
    for (const frame of frames) content.push({ type: 'text', text: `Frame ${frame.id}` }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + readFileSync(frame.absolutePath).toString('base64'), detail: 'low' } });
    const timeout = AbortSignal.timeout(180000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    for (let attempt = 0; ; attempt++) {
        requestSignal.throwIfAborted();
        response = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: requestSignal, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.STUDIO_VISION_MODEL || 'gpt-4.1-mini', response_format: { type: 'json_object' }, temperature: .2, max_tokens: 5000, messages: [{ role: 'user', content }] }) });
        if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt >= retryDelays.length) break;
        await response.body?.cancel();
        const retryAfter = Number(response.headers?.get('retry-after')) * 1000;
        await delay(Math.min(5000, Math.max(retryDelays[attempt], Number.isFinite(retryAfter) ? retryAfter : 0)), undefined, { signal: requestSignal });
    }
    if (!response.ok) throw new Error(`Dostawca AI odpowiedział HTTP ${response.status}. Sprawdź klucz, limit i dostępność modelu.`);
    const data = await response.json(); let parsed;
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content); } catch { throw new Error('Nie udało się odczytać odpowiedzi AI. Spróbuj ponownie.'); }
    return { provider, model: process.env.STUDIO_VISION_MODEL || 'gpt-4.1-mini', ...parseAnalysis(parsed, frames) };
}
