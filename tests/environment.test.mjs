import test from 'node:test';
import assert from 'node:assert/strict';
import {Document,NodeIO,getBounds} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {buildEnvironment,environmentOptions,GLB_LIMIT} from '../services/environment-export.mjs';

async function fixture(){
 const d=new Document(),b=d.createBuffer();
 const p=d.createPrimitive().setAttribute('POSITION',d.createAccessor().setType('VEC3').setArray(new Float32Array([2,3,4,6,3,4,2,5,6])).setBuffer(b)).setAttribute('COLOR_0',d.createAccessor().setType('VEC3').setArray(new Float32Array([1,0,0,0,1,0,0,0,1])).setBuffer(b)).setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,1,2])).setBuffer(b)).setMaterial(d.createMaterial());
 d.createScene().addChild(d.createNode().setMesh(d.createMesh().addPrimitive(p)));
 return new NodeIO().writeBinary(d);
}
test('environment is self-contained, grounded, scaled and compatible with Designer project schema',async()=>{
 const {glb,project,summary}=await buildEnvironment(await fixture(),{size:20,name:'Test',id:'sample'});
 assert.ok(glb.length<GLB_LIMIT);assert.equal(summary.faces,1);assert.deepEqual(summary.dimensions,[20,10,10]);
 const d=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(glb),bounds=getBounds(d.getRoot().listScenes()[0]);
 assert.deepEqual(bounds.min,[-10,0,-5]);assert.deepEqual(bounds.max,[10,10,5]);
 assert.ok(d.getRoot().listMaterials()[0].getExtension('KHR_materials_unlit'));
 assert.deepEqual(Array.from(d.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0').getArray()),[1,0,0,0,1,0,0,0,1]);
 assert.equal(project.version,1);assert.equal(project.environment,'empty');assert.equal(project.instances[0].assetId,project.customAssets[0].id);
 assert.deepEqual(Buffer.from(project.customAssets[0].data,'base64'),glb);assert.ok(project.width>=8&&project.width<=80);assert.ok(project.depth>=8&&project.depth<=80);
});
test('invalid scale or splat input is rejected',async()=>{
 for(const size of [0,-1,61,NaN,Infinity])assert.throws(()=>environmentOptions({size}));
 await assert.rejects(buildEnvironment(Buffer.from('not a glb')));
});
