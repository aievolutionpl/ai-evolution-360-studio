import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Unique temporary files avoid collisions; readers only see complete JSON.
export function writeJson(file, data) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
        renameSync(temporary, file);
    } finally {
        rmSync(temporary, { force: true });
    }
}
