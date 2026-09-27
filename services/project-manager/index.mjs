import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const validId = id => /^[a-f0-9-]{36}$/.test(id);
export class ProjectStore {
    constructor(root) { this.root = root; mkdirSync(root, { recursive: true }); }
    path(id) { if (!validId(id)) throw new Error('Nieprawidłowy identyfikator projektu.'); return join(this.root, id); }
    get(id) { return JSON.parse(readFileSync(join(this.path(id), 'project.json'), 'utf8')); }
    save(project) { const p = join(this.path(project.id), 'project.json'); writeFileSync(p+'.tmp', JSON.stringify(project, null, 2)); renameSync(p+'.tmp',p); return project; }
    list() { return readdirSync(this.root).filter(validId).flatMap(id => { try { return [this.get(id)]; } catch { return []; } }).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
    create(name) {
        const project = { id: randomUUID(), name: name.slice(0,140), createdAt: new Date().toISOString(), state: 'uploading', stage: 0, progress: null, attempt: 0, archived: false };
        for (const dir of ['source','dataset','reconstruction','splat','web','logs']) mkdirSync(join(this.path(project.id), dir), { recursive: true });
        return this.save(project);
    }
    recover() {
        for(const project of this.list())if(['processing','cancelling'].includes(project.environmentExport?.status)){project.environmentExport.status='interrupted';project.environmentExport.error='Eksport środowiska przerwano. Scena i poprzednie pliki są zachowane.';this.save(project);}
        for(const project of this.list())if(['processing','cancelling'].includes(project.meshExport?.status)){project.meshExport.status='interrupted';project.meshExport.error='Eksport GLB przerwano. Scena jest zachowana; możesz ponowić eksport.';this.save(project);}
        for(const project of this.list())if(['processing','cancelling'].includes(project.cleanup?.status)){project.cleanup.status='interrupted';project.cleanup.error='Czyszczenie przerwano przy zamknięciu aplikacji. Poprzednia scena jest zachowana.';this.save(project);}
        for (const project of this.list()) if (['uploading','processing','cancelling'].includes(project.state)) {
            project.state = 'interrupted'; project.error = 'Aplikacja została zamknięta podczas pracy. Możesz ponowić zadanie lub wgrać film ponownie.'; project.finishedAt = new Date().toISOString(); this.save(project);
        }
    }
}
