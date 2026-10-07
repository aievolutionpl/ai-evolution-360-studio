import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ProjectStore } from '../../services/project-manager/index.mjs';
export function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'spatial-foundation-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const store = new ProjectStore(root), project = store.create('Test');
    project.state = 'uploaded'; project.metadata = { duration: 3 }; store.save(project);
    return { root, store, project, base: store.path(project.id) };
}
export async function modelGlb() {
    const document = new Document(), buffer = document.createBuffer();
    const position = document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const mesh = document.createMesh().addPrimitive(document.createPrimitive().setAttribute('POSITION', position));
    document.createScene().addChild(document.createNode().setMesh(mesh));
    return Buffer.from(await new NodeIO().writeBinary(document));
}
