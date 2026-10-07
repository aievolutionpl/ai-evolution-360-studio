import { ProviderRegistry } from './provider-registry.mjs';
import { openaiVision } from './openai-vision.mjs';
export { parseAnalysis } from '../vision/analysis-schema.mjs';
const registry = new ProviderRegistry([
    { id: 'local', name: 'Lokalna ocena materiału', cloud: false, configured: () => true, run: async () => ({ provider: 'local', summary: 'Wybrano ostre i zróżnicowane ujęcia. Lokalna ocena materiału nie rozpoznaje obiektów ani nie potwierdza poprawnej geometrii 3D.', sceneType: 'unclassified', staticElements: [], objects: [] }) },
    { id: 'openai', name: 'AI · rozpoznawanie obiektów', cloud: true, configured: () => Boolean(process.env.OPENAI_API_KEY), configurationError: 'Brak OPENAI_API_KEY w lokalnym pliku .env. Po konfiguracji uruchom Studio ponownie.', run: openaiVision }
]);
export const visionProviders = () => registry.list();
export const analyseVision = context => registry.run(context.provider, context);
