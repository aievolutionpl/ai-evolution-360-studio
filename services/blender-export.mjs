import {readFileSync,writeFileSync,mkdirSync,copyFileSync,linkSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './spirula-runner/index.mjs';
export function prepareBlenderGlb(buffer){
 if(buffer.length<28||buffer.toString('ascii',0,4)!=='glTF'||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length||buffer.readUInt32LE(16)!==0x4e4f534a)throw new Error('Nieprawidłowy plik GLB.');
 const size=buffer.readUInt32LE(12);if(size+20>buffer.length)throw new Error('Niepełny GLB.');
 const data=JSON.parse(buffer.toString('utf8',20,20+size));let vertices=0,faces=0;
 for(const mesh of data.meshes||[])for(const primitive of mesh.primitives||[]){if((primitive.mode??4)!==4)throw new Error('Eksport nie zawiera siatki trójkątów.');vertices+=data.accessors?.[primitive.attributes?.POSITION]?.count||0;faces+=(data.accessors?.[primitive.indices]?.count||0)/3;}
 if(!vertices||!faces||!Number.isInteger(faces))throw new Error('Eksport nie zawiera poprawnych powierzchni.');
 const textured=Boolean(data.images?.length)&&data.images.every(i=>Number.isInteger(i.bufferView));const colored=data.meshes.every(m=>m.primitives.every(p=>p.attributes.COLOR_0!==undefined));if(!textured&&!colored)throw new Error('Brak kolorów lub osadzonej tekstury w GLB.');
 // Native coordinates -> Studio's Y-up frame. Blender's glTF importer then converts Y-up to Z-up.
 const scene=data.scenes[data.scene||0],children=scene.nodes;scene.nodes=[data.nodes.length];data.nodes.push({name:'AI Evolution · przestrzeń',children,rotation:[0,Math.SQRT1_2,Math.SQRT1_2,0]});
 data.asset.extras={...data.asset.extras,studio:'AI Evolution Polska',units:'Scale is reconstructed; not a surveyed metric model.'};
 const encoded=Buffer.from(JSON.stringify(data)),json=Buffer.alloc(Math.ceil(encoded.length/4)*4,32);encoded.copy(json);const tail=buffer.subarray(20+size),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+tail.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
 return {buffer:Buffer.concat([header,json,tail]),vertices,faces,textures:data.images?.length||0};
}
export async function exportBlender({base,engine,project,job,log,onLine}){
 const key=`${project.attempt}-${Date.now()}`,folder=join(base,'mesh',key),input=join(folder,'input');mkdirSync(input,{recursive:true});
 const ply=join(base,'splat',project.output.ply),sourceConfig=join(base,'splat',String(project.attempt),'run','config.json');
 copyFileSync(sourceConfig,join(folder,'config.json'));
 try{linkSync(ply,join(input,'splat.ply'));}catch{copyFileSync(ply,join(input,'splat.ply'));}
 await run(engine,['mesh',join(input,'splat.ply'),'--output',join(folder,'scene'),'--format','glb','--color','vertex','--max-cameras','64','--max-grid-res','256','--floater-min-faces','100'],{job,log,onLine,timeout:1800000});
 const path=join(folder,'scene.glb'),result=prepareBlenderGlb(readFileSync(path));writeFileSync(path,result.buffer);
 return {file:`${key}/scene.glb`,sourceWeb:project.output.web,bytes:statSync(path).size,vertices:result.vertices,faces:result.faces,textures:result.textures};
}
