import { spawn } from 'node:child_process';
import { access, cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings, validateSettings } from '../vendor/supersplat-viewer/dist/settings.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [input, output] = process.argv.slice(2);
if (!input || !output) {
    console.error('AI Evolution Polska — eksport testowy PLY → SOG → Web\nUżycie: node scripts/export-web.mjs model.ply pusty-folder-wyjściowy');
    process.exit(2);
}
try {
    const ply = resolve(input);
    const web = resolve(output);
    await access(ply);
    await access(resolve(root, 'vendor/supersplat-viewer/public/index.js'));
    await mkdir(web, { recursive: true });
    if ((await readdir(web)).length) throw new Error('Folder wyjściowy musi być pusty. Poprzedni eksport pozostaje zachowany.');
    const exitCode = await new Promise((done, reject) => {
        const child = spawn(process.execPath, [resolve(root, 'vendor/splat-transform/bin/cli.mjs'), ply, resolve(web, 'scene.sog')], { shell: false, stdio: 'inherit', windowsHide: true });
        child.once('error', reject);
        child.once('close', (code) => done(code));
    });
    if (exitCode !== 0) throw new Error(`SplatTransform zakończył się kodem ${exitCode}`);
    await cp(resolve(root, 'vendor/supersplat-viewer/public'), web, { recursive: true });
    const settings = defaultSettings('object');
    validateSettings(settings);
    await writeFile(resolve(web, 'settings.json'), JSON.stringify(settings, null, 2));
    await writeFile(resolve(web, 'export.json'), JSON.stringify({ brand: 'AI Evolution Polska', input: ply, exportedAt: new Date().toISOString(), viewer: 'SuperSplat Viewer (unmodified)', scene: 'scene.sog', scope: 'Local export; camera framing requires review on real captures.' }, null, 2));
    console.log(`Eksport gotowy: ${web}\nUruchom serwer HTTP tego folderu i otwórz /?content=scene.sog&noanim`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
