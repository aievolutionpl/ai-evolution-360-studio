import {openSync,readSync,closeSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './spirula-runner/index.mjs';
export const cleanupPresets={gentle:{label:'Delikatne',opacity:0.04,solid:0.10},balanced:{label:'Standard',opacity:0.12,solid:0.18},strong:{label:'Mocne',opacity:0.25,solid:0.30}};
export function cleanupArgs(input,output,strength){const p=cleanupPresets[strength];if(!Object.hasOwn(cleanupPresets,strength))throw new Error('Wybierz poprawną siłę czyszczenia.');return [input,'--filter-nan','--filter-value',`opacity,gt,${p.opacity}`,'--filter-floaters',`0.05,${p.solid},0.004`,output];}
export function plyCount(path){const fd=openSync(path,'r');try{const buffer=Buffer.alloc(65536);const n=readSync(fd,buffer,0,buffer.length,0),header=buffer.subarray(0,n).toString('ascii').split('end_header')[0];const match=header.match(/^element vertex (\d+)\r?$/m);if(!match)throw new Error('Nieprawidłowy nagłówek PLY.');return Number(match[1]);}finally{closeSync(fd);}}
export async function cleanScene({root,base,original,strength,attempt,job,log,onLine}){
 const stamp=Date.now().toString(),web=`${attempt}-clean-${stamp}`,ply=`${attempt}/cleanup-${stamp}/scene.ply`;
 const input=join(base,'splat',original.ply),output=join(base,'splat',ply),webDir=join(base,'web',web);mkdirSync(join(base,'splat',`${attempt}/cleanup-${stamp}`),{recursive:true});mkdirSync(webDir,{recursive:true});
 const cli=join(root,'vendor/splat-transform/bin/cli.mjs');const before=plyCount(input);
 await run(process.execPath,[cli,...cleanupArgs(input,output,strength)],{job,log,onLine,timeout:600000});
 const after=plyCount(output);if(!after||after<before*.2)throw new Error('Filtr usunął zbyt dużo sceny. Oryginał zachowano; wybierz delikatniejsze czyszczenie.');
 onLine('Kompresja oczyszczonej sceny do SOG…');
 await run(process.execPath,[cli,output,'--rotate=-90,0,0',join(webDir,'scene.sog')],{job,log,onLine,timeout:300000});
 copyFileSync(join(base,'web',original.web,'settings.json'),join(webDir,'settings.json'));
 const bytes=statSync(join(webDir,'scene.sog')).size;if(bytes<100)throw new Error('Pusty wynik czyszczenia.');
 return {output:{web,ply,bytes},before,after,removed:before-after};
}
