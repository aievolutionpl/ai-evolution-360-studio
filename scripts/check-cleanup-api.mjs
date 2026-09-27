import assert from 'node:assert/strict';
const base='http://127.0.0.1:8765';const {token}=await fetch(base+'/api/health').then(r=>r.json());const headers={'X-Studio-Token':token,'Content-Type':'application/json'};
const post=(id,action,data={})=>fetch(`${base}/api/projects/${id}/${action}`,{method:'POST',headers,body:JSON.stringify(data)});
const projects=await fetch(base+'/api/projects').then(r=>r.json());const scene=projects.find(p=>p.cleanedOutput&&p.cleanup?.status==='ready');assert.ok(scene,'Need completed cleanup');
assert.equal((await post(scene.id,'cleanup',{strength:'invalid'})).status,400);
assert.equal((await post(scene.id,'variant',{variant:'missing'})).status,400);
for(const variant of ['original','cleaned']){const r=await post(scene.id,'variant',{variant});assert.equal(r.status,200);const p=await r.json();assert.deepEqual(p.output,p[variant+'Output']);const data=await fetch(`${base}/api/projects/${scene.id}/sog`,{headers:{Range:'bytes=0-1'}});assert.equal(await data.text(),'PK');}
const fixture=projects.find(p=>p.name==='Test syntetyczny · 12 panoram');assert.ok(fixture);const output=fixture.output;
assert.equal((await post(fixture.id,'cleanup',{strength:'gentle'})).status,202);
assert.equal((await post(fixture.id,'cleanup',{strength:'gentle'})).status,400);
assert.equal((await post(fixture.id,'variant',{variant:'original'})).status,400);
assert.equal((await post(fixture.id,'cancelcleanup')).status,200);
let p;for(let i=0;i<40;i++){p=await fetch(`${base}/api/projects/${fixture.id}`).then(r=>r.json());if(p.cleanup.status==='cancelled')break;await new Promise(r=>setTimeout(r,250));}
assert.equal(p.cleanup.status,'cancelled');assert.equal(p.state,'ready');assert.deepEqual(p.output,output);
console.log('Cleanup API passed: invalid inputs, A/B outputs, SOG exports, job lock, cancellation, original preservation.');
