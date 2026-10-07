import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeJson } from '../storage/json.mjs';
import { stopChild } from '../spirula-runner/index.mjs';
const running = new Set(['queued', 'preparing', 'selecting', 'analysing', 'cancelling']);
export class JobManager {
    constructor(store) { this.store = store; this.active = null; this.persistenceFailure = null; }
    file(project, id) {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Nieprawidłowe zadanie.');
        return join(this.store.path(project.id), 'jobs', `${id}.json`);
    }
    list(project) {
        const folder = join(this.store.path(project.id), 'jobs');
        if (!existsSync(folder)) return [];
        return readdirSync(folder).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(folder, f), 'utf8'))).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
    latest(project) { return this.persistenceFailure?.projectId === project.id ? this.persistenceFailure : this.list(project)[0] ?? null; }
    recover() {
        for (const project of this.store.list()) {
            for (const job of this.list(project)) if (running.has(job.status)) writeJson(this.file(project, job.id), { ...job, status: 'interrupted', completedAt: new Date().toISOString(), error: 'Analiza została przerwana. Możesz uruchomić ją ponownie; poprzednie wyniki są zachowane.' });
        }
    }
    start(project, provider, task) {
        if (this.active) throw new Error('Trwa inne zadanie analizy. Poczekaj lub anuluj je.');
        mkdirSync(join(this.store.path(project.id), 'jobs'), { recursive: true });
        const data = { id: randomUUID(), projectId: project.id, type: 'scene-analysis', provider, status: 'queued', progress: null, phase: 'Przygotowanie analizy', startedAt: new Date().toISOString(), completedAt: null, error: null };
        const context = { id: data.id, projectId: project.id, cancelled: false, child: null, controller: new AbortController() };
        const update = patch => { if (context.cancelled) throw new Error('Anulowano analizę.'); Object.assign(data, patch); writeJson(this.file(project, data.id), data); };
        update({});
        this.active = context; this.persistenceFailure = null;
        context.promise = Promise.resolve().then(() => task(context, update)).then(() => update({ status: 'completed', phase: 'Analiza gotowa', progress: 100 })).catch(error => {
            Object.assign(data, { status: context.cancelled ? 'cancelled' : 'failed', progress: null, error: context.cancelled ? 'Anulowano analizę. Poprzedni wynik pozostaje dostępny.' : error.message });
        }).finally(() => {
            data.completedAt = new Date().toISOString();
            try { writeJson(this.file(project, data.id), data); }
            catch { this.persistenceFailure = { ...data, status: 'failed', error: 'Nie udało się zapisać statusu zadania. Sprawdź wolne miejsce i uprawnienia katalogu projektu.' }; }
            finally { this.active = null; }
        });
        return { ...data };
    }
    cancel(project) {
        const context = this.active;
        if (!context || context.projectId !== project.id) throw new Error('Analiza nie jest aktywna.');
        context.cancelled = true; context.controller.abort(); stopChild(context.child);
        const job = this.list(project).find(j => j.id === context.id); writeJson(this.file(project, context.id), { ...job, status: 'cancelling', phase: 'Zatrzymywanie analizy' });
    }
}
