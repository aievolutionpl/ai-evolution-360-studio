import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
const files=process.argv.slice(2);assert.equal(files.length,2,'Pass two local INSP photo paths');
const base='http://127.0.0.1:8765';const {token}=await fetch(base+'/api/health').then(r=>r.json());const headers={'X-Studio-Token':token,'Content-Type':'application/json'};
const post=(path,data={})=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});
const p=await (await post('/api/photos',{name:'Zdjęcia Insta360 · 2 ujęcia',count:2})).json();
for(let i=0;i<files.length;i++){
 const bytes=readFileSync(files[i]);const r=await fetch(`${base}/api/projects/${p.id}/photo?name=${encodeURIComponent(basename(files[i]))}`,{method:'POST',headers:{'X-Studio-Token':token},body:bytes});assert.equal(r.status,201,await r.clone().text());
 const photo=(await r.json()).photos[i];assert.equal(photo.projection,'fisheye');assert.equal(photo.width,11904);
 const copied=readFileSync(`workspace/projects/${p.id}/source/photos/${photo.file}`);const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(copied),hash(bytes));
}
const ready=await (await post(`/api/projects/${p.id}/finishphotos`)).json();assert.equal(ready.state,'panorama');assert.equal(ready.mode,'fisheye');
assert.equal((await post(`/api/projects/${p.id}/start`,{preset:'fast',mode:'fisheye'})).status,400);
for(let i=0;i<2;i++){const preview=await fetch(`${base}/api/projects/${p.id}/panorama?index=${i}`);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/jpeg');}
writeFileSync('workspace/qa-fixtures/insp-import-test.json',JSON.stringify({id:p.id,passed:['two INSP uploads','original SHA256 preserved','lens format detected','panorama previews','insufficient view guard']},null,2));console.log('INSP import verified:',p.id);
