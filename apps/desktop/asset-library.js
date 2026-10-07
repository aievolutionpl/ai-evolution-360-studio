const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function initAssetLibrary({ api, getData, getProjectId, refresh, toast }) {
    const section = document.getElementById('asset-section');
    section.innerHTML = `<div class="section-label"><h3>Biblioteka assetów</h3><span id="asset-count"></span></div>
    <div class="asset-toolbar"><label>Wyszukaj asset<input id="asset-search" type="search" placeholder="Nazwa lub opis"></label><label>Typ<select id="asset-filter"><option value="all">Wszystkie</option><option value="glb">Modele GLB</option><option value="reference">Referencje</option></select></label><button id="asset-import" class="secondary">Dodaj plik</button><input id="asset-file" type="file" accept=".glb,.jpg,.jpeg,.png,.webp" hidden></div>
    <p class="footnote">GLB do 100 MiB · JPG, PNG, WebP do 20 MiB. Pliki zostają lokalnie. Biblioteka nie umieszcza jeszcze modeli w podglądzie 3D.</p>
    <p id="asset-feedback" role="status" hidden></p><div id="asset-list" class="asset-list"></div>`;
    const $ = id => document.getElementById(id);
    const dialog = document.createElement('dialog'); dialog.className = 'asset-dialog';
    dialog.innerHTML = '<form method="dialog"><button class="secondary">Zamknij</button></form><h3></h3><div class="asset-dialog-body"></div>';
    document.body.append(dialog); dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
    let importing = false, target = null, signature = '';
    const fileUrl = (project, id, slot) => `/api/projects/${project}/assets/${id}/file?slot=${slot}`;
    function render() {
        const project = getProjectId(), assets = getData()?.assets ?? [];
        section.hidden = !project; $('asset-import').disabled = importing;
        $('asset-feedback').hidden = !importing; $('asset-feedback').textContent = importing ? 'Importowanie i sprawdzanie pliku…' : '';
        $('asset-count').textContent = `${assets.length} assetów`;
        const query = $('asset-search').value.toLocaleLowerCase('pl'), type = $('asset-filter').value;
        const key = JSON.stringify([project, assets.map(a => [a.id, a.version]), query, type, importing]);
        if (signature === key) return; signature = key;
        const visible = assets.filter(a => (type === 'all' || a.type === type) && `${a.name} ${a.metadata.description ?? ''}`.toLocaleLowerCase('pl').includes(query));
        $('asset-list').innerHTML = visible.length ? visible.map(a => `<article class="asset-card">${a.files.thumbnail ? `<img class="asset-thumbnail" loading="lazy" src="${fileUrl(project, a.id, 'thumbnail')}" alt="Referencja ${escape(a.name)}">` : '<span class="asset-glyph" aria-hidden="true">◇</span>'}<div><strong>${escape(a.name)}</strong><p>${escape(a.metadata.description ?? (a.type === 'glb' ? 'Model GLB · gotowy do dalszej pracy' : 'Zdjęcie referencyjne · bez izolacji'))}</p><small>${a.type === 'glb' ? 'GLB' : 'REFERENCJA'} · V${a.version}</small></div><div class="asset-actions">${a.files.model ? `<a class="text-button" href="${fileUrl(project, a.id, 'model')}&download=1">Pobierz GLB</a>` : ''}${a.files.referenceImage || a.files.sourceImage ? `<a class="text-button" href="${fileUrl(project, a.id, a.files.referenceImage ? 'referenceImage' : 'sourceImage')}&download=1">Pobierz zdjęcie</a>` : ''}<button class="text-button" data-action="replace" data-id="${a.id}" ${importing ? 'disabled' : ''}>Dodaj wersję</button><button class="text-button" data-action="rename" data-id="${a.id}" ${importing ? 'disabled' : ''}>Zmień nazwę</button><button class="text-button" data-action="history" data-id="${a.id}">Historia</button></div></article>`).join('') : `<p class="asset-empty">${assets.length ? 'Brak assetów pasujących do filtrów.' : 'Dodaj model GLB lub zdjęcie. Możesz też zapisać referencje z analizy AI.'}</p>`;
    }
    $('asset-search').oninput = render; $('asset-filter').onchange = render;
    $('asset-import').onclick = () => { target = null; $('asset-file').click(); };
    $('asset-file').onchange = async () => {
        const file = $('asset-file').files[0], project = getProjectId(), replacement = target;
        $('asset-file').value = ''; if (!file || !project) return;
        importing = true; render();
        try {
            const suffix = replacement ? `${replacement.id}/import?version=${replacement.version}&` : 'import?';
            await api(`/api/projects/${project}/assets/${suffix}name=${encodeURIComponent(file.name)}`, file);
            await refresh(); toast('Plik zapisany. Poprzednie wersje są zachowane.');
        } catch (error) { toast(error.message); }
        finally { importing = false; render(); }
    };
    $('asset-list').onclick = async event => {
        const button = event.target.closest('[data-action]'); if (!button) return;
        const project = getProjectId(), asset = getData()?.assets.find(a => a.id === button.dataset.id); if (!asset) return;
        if (button.dataset.action === 'replace') { target = { id: asset.id, version: asset.version }; $('asset-file').click(); return; }
        dialog.querySelector('h3').textContent = asset.name;
        const content = dialog.querySelector('.asset-dialog-body');
        if (button.dataset.action === 'rename') {
            content.innerHTML = '<form class="asset-rename"><label>Nazwa assetu<input name="name" maxlength="140" required></label><button class="primary compact">Zapisz</button><p role="alert"></p></form>';
            const form = content.querySelector('form'); form.elements.name.value = asset.name;
            form.onsubmit = async e => {
                e.preventDefault(); form.querySelector('button').disabled = true;
                try { await api(`/api/projects/${project}/assets/${asset.id}`, { version: asset.version, patch: { name: form.elements.name.value.trim() } }, 'PATCH'); dialog.close(); await refresh(); }
                catch (error) { form.querySelector('[role="alert"]').textContent = error.message; }
                finally { form.querySelector('button').disabled = false; }
            };
            dialog.showModal(); form.elements.name.focus();
        } else {
            content.textContent = 'Wczytywanie historii…'; dialog.showModal();
            try {
                const versions = await api(`/api/projects/${project}/assets/${asset.id}/versions`);
                content.innerHTML = '<ol class="asset-history">' + versions.map(v => `<li><strong>V${v.version} · ${escape(v.name)}</strong><span>${escape(new Date(v.updatedAt).toLocaleString('pl-PL'))} · ${v.files.model ? 'GLB' : 'referencja'}</span></li>`).join('') + '</ol>';
            } catch (error) { content.textContent = error.message; }
        }
    };
    return { render };
}
