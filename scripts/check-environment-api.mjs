import assert from 'node:assert/strict';
const base='http://127.0.0.1:8765',health=await fetch(base+'/api/health').then(r=>r.json());
const headers={'X-Studio-Token':health.token,'Content-Type':'application/json'};
const projects=await fetch(base+'/api/projects').then(r=>r.json());
const p=projects.find(p=>p.environmentOutput?.sourceWeb===p.output?.web&&p.environmentOutput);
assert.ok(p,'Generate an environment first.');
const url=base+'/api/projects/'+p.id;
const glb=await fetch(url+'/environment-glb');assert.equal(glb.status,200);assert.match(glb.headers.get('content-disposition'),/attachment/);
const bytes=Buffer.from(await glb.arrayBuffer());assert.ok(bytes.length<=30*1024**2);assert.equal(bytes.toString('ascii',0,4),'glTF');
const file=await fetch(url+'/environment-project');assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/\.forma\.json/);
const project=await file.json();assert.equal(project.environment,'empty');assert.equal(project.instances.length,1);assert.deepEqual(Buffer.from(project.customAssets[0].data,'base64'),bytes);
assert.equal((await fetch(url+'/environment',{method:'POST',headers,body:'{"size":0}'})).status,400);
if(p.cleanedOutput&&p.originalOutput){
 const original=p.output.web===p.cleanedOutput.web?'cleaned':'original';
 const setVariant=variant=>fetch(url+'/variant',{method:'POST',headers,body:JSON.stringify({variant})});
 try{assert.equal((await setVariant(original==='cleaned'?'original':'cleaned')).status,200);assert.equal((await fetch(url+'/environment-glb')).status,400);assert.equal((await fetch(url+'/environment-project')).status,400);}
 finally{assert.equal((await setVariant(original)).status,200);}
}
console.log('Environment API passed: GLB, embedded project, limits, invalid scale, stale variant guard.');
