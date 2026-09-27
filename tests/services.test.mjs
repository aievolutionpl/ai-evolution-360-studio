import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../services/project-manager/index.mjs';
import { run, stopChild, trainingProgress } from '../services/spirula-runner/index.mjs';

test('paths stay inside project storage and interrupted jobs recover',()=>{
    const root=mkdtempSync(join(tmpdir(),'evolution-test-'));
    try{const store=new ProjectStore(root);assert.throws(()=>store.path('../outside'));const p=store.create('Film');p.state='processing';store.save(p);store.recover();assert.equal(store.get(p.id).state,'interrupted');assert.equal(store.list().length,1);}finally{rmSync(root,{recursive:true,force:true});}
});
test('argument arrays preserve shell metacharacters literally',async()=>{
    const literal='a & echo wrong; $(bad) " spaced';const out=await run(process.execPath,['-e','console.log(process.argv[1])',literal]);assert.equal(out.trim(),literal);
});
test('nonzero exits fail instead of marking ready',async()=>{await assert.rejects(run(process.execPath,['-e','console.error("test failure");process.exit(7)']),/kodem 7/);});
test('cancellation stops the owned process',async()=>{
    const job={cancelled:false,child:null};const pending=run(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)'],{job,onLine:()=>{job.cancelled=true;stopChild(job.child);}});await assert.rejects(pending,/Anulowano/);
});
test('only native training counts produce percentages',()=>{assert.equal(trainingProgress('step 10/100 (10%)'),10);assert.equal(trainingProgress('mapping cameras'),null);});
