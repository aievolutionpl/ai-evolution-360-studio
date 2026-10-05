export function scorePixels(pixels, width, height) {
    if (pixels.length !== width * height || width < 3 || height < 3) throw new Error('Nieprawidłowa próbka obrazu.');
    let sum = 0, squared = 0, n = 0;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x, lap = pixels[i - 1] + pixels[i + 1] + pixels[i - width] + pixels[i + width] - 4 * pixels[i];
        sum += lap; squared += lap * lap; n++;
    }
    const signature = [];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) {
        let total = 0, count = 0;
        for (let yy = Math.floor(y * height / 9); yy < Math.floor((y + 1) * height / 9); yy++) for (let xx = Math.floor(x * width / 16); xx < Math.floor((x + 1) * width / 16); xx++) { total += pixels[yy * width + xx]; count++; }
        signature.push(total / Math.max(1, count) / 255);
    }
    const exposure = pixels.reduce((a, b) => a + b, 0) / pixels.length / 255;
    return { sharpness: Math.max(0, squared / n - (sum / n) ** 2), exposure, signature };
}
export function frameDistance(a, b) {
    if (a.length !== b.length || !a.length) throw new Error('Nieprawidłowy podpis obrazu.');
    return a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
}
export function selectFrames(frames, { count = 24, duplicateThreshold = .035 } = {}) {
    if (!frames.length) throw new Error('Brak klatek do analizy.');
    if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('Wybierz od 1 do 30 klatek.');
    const sorted = [...frames].sort((a, b) => a.index - b.index), selected = [], duplicates = new Set();
    const choose = candidates => {
        for (const frame of [...candidates].sort((a, b) => b.sharpness - a.sharpness)) {
            if (selected.some(f => f.index === frame.index)) continue;
            if (selected.some(f => frameDistance(f.signature, frame.signature) < duplicateThreshold)) { duplicates.add(frame.index); continue; }
            selected.push(frame); return;
        }
    };
    const bins = Math.min(count, sorted.length);
    for (let i = 0; i < bins; i++) choose(sorted.slice(Math.floor(i * sorted.length / bins), Math.floor((i + 1) * sorted.length / bins)));
    while (selected.length < Math.min(count, frames.length)) { const n = selected.length; choose(sorted); if (n === selected.length) break; }
    selected.sort((a, b) => a.index - b.index);
    const warnings = [];
    if (selected.length < 12) warnings.push('Mało różnych widoków. Do dokładniejszej analizy przygotuj więcej ujęć z różnych pozycji.');
    if (selected.some(f => f.sharpness < 15)) warnings.push('Część wybranych klatek ma mało ostrych detali. Sprawdź ostrość i światło.');
    if (selected.some(f => f.exposure < .08 || f.exposure > .92)) warnings.push('Część klatek jest bardzo ciemna lub jasna.');
    return { selected, summary: { sampled: frames.length, selected: selected.length, similar: duplicates.size, meanSharpness: selected.reduce((n, f) => n + f.sharpness, 0) / selected.length, coverage: 'temporal-samples', warnings } };
}
