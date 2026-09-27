import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function run(executable, args, { log, onLine = () => {}, job, timeout = 0 } = {}) {
    return new Promise((resolve, reject) => {
        if (job?.cancelled) return reject(new Error('Anulowano zadanie.'));
        const child = spawn(executable, args, { shell: false, windowsHide: true, env: { ...process.env, SS_LANG: 'en' } });
        if (job) job.child = child;
        let output = '', timer, timedOut = false;
        if (log) appendFileSync(log, `\n$ ${JSON.stringify([executable, ...args])}\n`);
        function line(text) {
            if (!text.trim()) return;
            output = (output + text + '\n').slice(-256000);
            if (log) appendFileSync(log, text + '\n');
            onLine(text);
        }
        for (const stream of [child.stdout, child.stderr]) {
            stream.setEncoding('utf8');
            let pending = '';
            stream.on('data', chunk => { pending += chunk; const lines = pending.split(/[\r\n]+/); pending = lines.pop(); lines.forEach(line); });
            stream.on('end', () => { if (pending) line(pending); });
        }
        if (timeout) timer = setTimeout(() => { timedOut = true; stopChild(child); }, timeout);
        child.once('error', error => { clearTimeout(timer); if (job) job.child = null; reject(error); });
        child.once('close', code => {
            clearTimeout(timer);
            if (job) job.child = null;
            if (job?.cancelled) reject(new Error('Anulowano zadanie.'));
            else if (timedOut) reject(new Error('Przekroczono czas odpowiedzi narzędzia.'));
            else if (code !== 0) reject(new Error(`Proces zakończył się kodem ${code}. ${output.slice(-1200)}`));
            else resolve(output);
        });
    });
}

export function stopChild(child) {
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
    } else child.kill('SIGTERM');
}

export function trainingProgress(line) {
    const match = line.match(/step\s+(\d+)\/(\d+)/);
    return match && Number(match[2]) > 0 ? Math.min(100, Math.round(100 * Number(match[1]) / Number(match[2]))) : null;
}
