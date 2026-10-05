const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const liveStatuses = ['queued', 'preparing', 'selecting', 'analysing', 'cancelling'];
export function initSpatial({ api, getState, toast }) {
    const flow = document.createElement('div'); flow.className = 'workflow-strip';
    flow.innerHTML = '<div data-step="source"><span>01</span><strong>Dodaj materiał</strong><small>Film lub zdjęcia 360°</small></div><i>→</i><div data-step="reconstruct"><span>02</span><strong>Odtwórz przestrzeń</strong><small>Lokalnie · High Quality</small></div><i>→</i><div data-step="analyse"><span>03</span><strong>Poznaj scenę</strong><small>Jakość klatek i obiekty</small></div><i>→</i><div data-step="export"><span>04</span><strong>Zabierz projekt</strong><small>SOG · PLY · GLB · scena</small></div>';
    document.querySelector('.studio-grid').before(flow);
    for (const id of ['cleanup-panel', 'blender-panel', 'environment-panel']) {
        const section = document.getElementById(id), heading = section.querySelector('.panel-heading');
        const details = document.createElement('details'), summary = document.createElement('summary');
        details.className = 'operation-details'; summary.append(heading);
        details.append(summary, ...section.childNodes); section.append(details);
    }
    const panel = document.createElement('section'); panel.id = 'spatial-panel'; panel.className = 'panel spatial-panel';
    panel.innerHTML = `<div class="panel-heading"><span class="step-pill">AI</span><div><p class="eyebrow">SCENE INTELLIGENCE</p><h2>Poznaj swoją przestrzeń</h2></div><span class="badge">NOWE W 0.6</span></div>
    <p class="spatial-intro">Wybierz najlepsze ujęcia, oceń materiał i przygotuj referencje obiektów do dalszej pracy.</p>
    <div id="analysis-empty" class="analysis-empty">Dodaj materiał lub otwórz projekt z biblioteki, aby rozpocząć analizę.</div>
    <div id="analysis-content" hidden><div class="analysis-controls"><label for="vision-provider">Tryb analizy<select id="vision-provider"><option value="local">Lokalna ocena materiału</option></select></label><button class="primary compact" id="analyse-scene">Analizuj materiał ↗</button></div>
    <p id="provider-note" class="footnote">Lokalnie: ocena ostrości, podobieństwa i wybór ujęć. Bez wysyłania obrazów.</p>
    <details class="provider-help"><summary>Jak włączyć rozpoznawanie obiektów AI?</summary><p>Skopiuj <code>.env.example</code> do <code>.env</code> w katalogu Studio, wpisz <code>OPENAI_API_KEY</code> i uruchom aplikację ponownie. Następnie wybierz tryb AI. Wybrane klatki zostaną wysłane do OpenAI; analiza korzysta z płatnego API. Klucz pozostaje na Twoim komputerze.</p></details>
    <div id="analysis-working" class="analysis-working" hidden><div><span class="mini-spinner"></span><strong id="analysis-phase"></strong><button class="text-button" id="analysis-cancel">Anuluj</button></div><progress id="analysis-progress" max="100" aria-label="Postęp bieżącego etapu analizy"></progress></div>
    <p id="analysis-error" class="analysis-error" role="alert" hidden></p><div id="analysis-result" hidden><div class="analysis-metrics" id="analysis-metrics"></div><p id="analysis-summary"></p><ul id="analysis-warnings" class="analysis-warnings"></ul>
    <div class="section-label"><h3>Wybrane ujęcia</h3><span id="frames-count"></span></div><div id="selected-frames" class="frame-grid"></div>
    <div class="section-label"><h3>Obiekty w scenie</h3><span id="objects-count"></span></div><p id="objects-note" class="footnote"></p><div id="detected-objects" class="object-list"></div><button id="save-references" class="secondary full" hidden>Zapisz zaznaczone referencje w bibliotece ↓</button></div>
    <div id="asset-section" hidden><div class="section-label"><h3>Biblioteka assetów</h3><span id="asset-count"></span></div><p class="footnote">Zapisane referencje są punktem startowym do modeli 3D. Nie są jeszcze izolowanymi obiektami ani gotowymi GLB.</p><div id="asset-list" class="asset-list"></div></div>
    <div class="scene-footer"><div><strong>Manifest sceny</strong><span id="scene-info"></span></div><a id="download-scene" class="secondary" download>Pobierz scene.json ↓</a></div></div>`;
    document.querySelector('.preview-column').append(panel);
    const $ = id => document.getElementById(id);
    let data = null, projectId = null, loading = false, resultKey = '', providersLoaded = false, disposed = false;
    function providerNote() {
        const cloud = $('vision-provider').value === 'openai';
        $('provider-note').textContent = cloud ? 'AI wyśle wybrane klatki do OpenAI. Analiza może wiązać się z kosztem API; materiał źródłowy pozostaje lokalnie.' : 'Lokalnie: ocena ostrości, podobieństwa i wybór ujęć. Bez wysyłania obrazów.';
        $('analyse-scene').textContent = cloud ? 'Analizuj obiekty AI ↗' : 'Analizuj materiał ↗';
    }
    async function providers() {
        if (providersLoaded) return;
        try {
            const options = await api('/api/spatial/providers');
            $('vision-provider').replaceChildren(...options.map(p => { const option = new Option(p.name + (!p.configured ? ' · wymaga klucza' : ''), p.id); option.disabled = !p.configured; return option; }));
            providersLoaded = true; providerNote();
        } catch { /* Connection is reported by the main health panel. */ }
    }
    function frameUrl(frame) { return `/api/projects/${projectId}/analysis-frame?run=${encodeURIComponent(data.frames.runId)}&file=${encodeURIComponent(frame.id + '.jpg')}`; }
    function render() {
        const { selected, health } = getState(), job = data?.job, busy = liveStatuses.includes(job?.status);
        for (const [id, status] of [['cleanup-panel', selected?.cleanup?.status], ['blender-panel', selected?.meshExport?.status], ['environment-panel', selected?.environmentExport?.status]]) {
            if (['processing', 'cancelling'].includes(status)) document.querySelector(`#${id} details`).open = true;
        }
        const source = Boolean(selected?.metadata), ready = selected?.state === 'ready';
        for (const [name, complete] of [['source', source], ['reconstruct', ready], ['analyse', Boolean(data?.analysis)], ['export', ready]]) flow.querySelector(`[data-step="${name}"]`).classList.toggle('complete', complete);
        flow.querySelector('[data-step="reconstruct"]').classList.toggle('working', selected?.state === 'processing');
        flow.querySelector('[data-step="analyse"]').classList.toggle('working', busy);
        $('analysis-empty').hidden = Boolean(selected); $('analysis-content').hidden = !selected;
        if (!selected) return;
        $('analyse-scene').disabled = !source || Boolean(health.busy) || busy || ['uploading', 'processing', 'cancelling'].includes(selected.state);
        $('vision-provider').disabled = busy;
        $('analysis-working').hidden = !busy; $('analysis-phase').textContent = job?.phase || '';
        $('analysis-cancel').disabled = job?.status === 'cancelling';
        if (job?.progress == null) $('analysis-progress').removeAttribute('value'); else $('analysis-progress').value = job.progress;
        $('analysis-error').hidden = !job?.error; $('analysis-error').textContent = job?.error || '';
        $('scene-info').textContent = data?.scene ? `v${data.scene.version} · rewizja ${data.scene.revision} · ${data.scene.objects.length} obiektów 3D` : 'Wczytywanie manifestu…';
        $('download-scene').href = `/api/projects/${selected.id}/scene?download=1`;
        const result = data?.analysis, frames = data?.frames;
        $('analysis-result').hidden = !result || !frames;
        if (result && frames && resultKey !== result.runId) {
            resultKey = result.runId;
            const s = frames.summary;
            $('analysis-metrics').innerHTML = `<div><strong>${s.selected}</strong><span>wybranych ujęć</span></div><div><strong>${s.sampled}</strong><span>ocenionych próbek</span></div><div><strong>${s.similar}</strong><span>podobnych widoków</span></div><div><strong>${result.provider === 'local' ? '—' : result.objects.length}</strong><span>${result.provider === 'local' ? 'AI opcjonalnie' : 'obiektów AI'}</span></div>`;
            $('analysis-summary').textContent = result.summary;
            $('analysis-warnings').innerHTML = s.warnings.map(w => `<li>${escape(w)}</li>`).join('');
            $('frames-count').textContent = `${s.selected} ujęć · kliknij, aby powiększyć`;
            $('selected-frames').innerHTML = frames.frames.map(f => `<button class="frame-card" data-frame="${f.id}" aria-label="Powiększ ujęcie ${f.index + 1}"><img loading="lazy" src="${frameUrl(f)}" alt="Wybrane ujęcie ${f.index + 1}"><span>${String(f.index + 1).padStart(2, '0')} <small>ostrość ${Math.round(f.sharpness)}</small></span></button>`).join('');
            $('objects-count').textContent = result.provider === 'local' ? 'TYLKO W TRYBIE AI' : `${result.objects.length} rozpoznanych`;
            $('objects-note').textContent = result.provider === 'local' ? 'Ocena lokalna nie rozpoznaje obiektów. Wybierz skonfigurowany tryb AI, aby otrzymać listę referencji.' : 'Rozpoznanie AI może się mylić. Sprawdź referencje przed zapisem. Ściany i podłogi pozostają częścią środowiska.';
            $('detected-objects').innerHTML = result.objects.map(o => `<label class="detected-object"><input type="checkbox" value="${escape(o.id)}"><div><strong>${escape(o.name)}</strong><p>${escape(o.description)}</p><small>${escape(o.materials.join(' · '))}</small></div><span>${Math.round(o.confidence * 100)}%<small>pewność AI</small></span></label>`).join('');
            $('save-references').hidden = !result.objects.length;
            $('save-references').disabled = true;
        }
        $('asset-section').hidden = !data?.assets?.length;
        if (data?.assets?.length) {
            $('asset-count').textContent = `${data.assets.length} referencji`;
            $('asset-list').innerHTML = data.assets.map(a => `<article class="asset-card"><span class="asset-glyph">◇</span><div><strong>${escape(a.name)}</strong><p>${escape(a.metadata.description || 'Referencja obiektu')}</p></div><span class="badge">REFERENCJA · V${a.version}</span></article>`).join('');
        }
    }
    async function refresh() {
        if (loading || disposed || !projectId) return;
        loading = true; const id = projectId;
        try { const response = await api(`/api/projects/${id}/spatial`); if (id === projectId) { data = response; render(); } }
        catch (e) { if (id === projectId) { $('analysis-error').hidden = false; $('analysis-error').textContent = e.message; } }
        finally { loading = false; }
    }
    window.addEventListener('studio-project-change', () => {
        const id = getState().selected?.id || null;
        if (projectId !== id) { projectId = id; data = null; resultKey = ''; refresh(); }
        render(); providers();
    });
    $('vision-provider').onchange = providerNote;
    $('analyse-scene').onclick = async () => {
        $('analyse-scene').disabled = true;
        try { const job = await api(`/api/projects/${projectId}/analyse`, { provider: $('vision-provider').value }); data = { ...data, job }; render(); await refresh(); }
        catch (e) { toast(e.message); render(); }
    };
    $('analysis-cancel').onclick = async () => { try { await api(`/api/projects/${projectId}/analysis-cancel`, {}); await refresh(); } catch (e) { toast(e.message); } };
    $('detected-objects').onchange = () => { $('save-references').disabled = !$('detected-objects').querySelector('input:checked'); };
    $('save-references').onclick = async () => {
        $('save-references').disabled = true;
        try { await api(`/api/projects/${projectId}/assets`, { runId: data.analysis.runId, objectIds: [...$('detected-objects').querySelectorAll('input:checked')].map(i => i.value) }); await refresh(); toast('Referencje zapisane w bibliotece projektu.'); }
        catch (e) { toast(e.message); }
        finally { $('save-references').disabled = !$('detected-objects').querySelector('input:checked'); }
    };
    const dialog = document.createElement('dialog'); dialog.className = 'frame-dialog';
    dialog.innerHTML = '<form method="dialog"><button class="secondary" aria-label="Zamknij podgląd">Zamknij ✕</button></form><img alt="Powiększona wybrana klatka"><p></p>'; document.body.append(dialog);
    $('selected-frames').onclick = e => { const button = e.target.closest('[data-frame]'); if (!button) return; const frame = data.frames.frames.find(f => f.id === button.dataset.frame); dialog.querySelector('img').src = frameUrl(frame); dialog.querySelector('p').textContent = `Ujęcie ${frame.index + 1} · ostrość ${Math.round(frame.sharpness)} · próbka materiału źródłowego`; dialog.showModal(); };
    dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
    const timer = setInterval(refresh, 2200);
    window.addEventListener('pagehide', () => { disposed = true; clearInterval(timer); });
    providers(); render();
}
