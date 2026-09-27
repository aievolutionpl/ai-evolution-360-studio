import {NodeIO, getBounds} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {weld, simplify, prune} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const GLB_LIMIT=30*1024*1024;
export function environmentOptions(options={}){
 const size=Number(options.size??20);
 if(!Number.isFinite(size)||size<2||size>60)throw new Error('Dłuższy bok przestrzeni musi mieć od 2 do 60 m.');
 return {size};
}
const triangleCount=doc=>doc.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||0)/3,0),0);

export async function buildEnvironment(input,{size=20,name='Moja przestrzeń',id='scene'}={}){
 ({size}=environmentOptions({size}));
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
 const doc=await io.readBinary(new Uint8Array(input));
 const root=doc.getRoot(),scene=root.getDefaultScene()||root.listScenes()[0];
 if(!scene||!root.listMeshes().length)throw new Error('GLB nie zawiera przestrzeni. Najpierw przygotuj siatkę.');
 for(const m of root.listMeshes())for(const p of m.listPrimitives()){
  if(p.getMode()!==4||!p.getIndices()||!p.getAttribute('POSITION')||!p.getAttribute('COLOR_0'))throw new Error('Eksport środowiska wymaga siatki trójkątów z kolorami wierzchołków.');
 }
 const before=triangleCount(doc);
 console.log('Optymalizacja siatki do przeglądarki…');
 await MeshoptSimplifier.ready;
 if(before>250000)await doc.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:250000/before,error:0.002}),prune());
 // Photogrammetry colors already contain lighting. Avoid lighting them a second time.
 const unlit=doc.createExtension(KHRMaterialsUnlit);
 for(const m of root.listMaterials())m.setName('Skan · kolory z nagrania').setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true).setAlphaMode('OPAQUE').setExtension('KHR_materials_unlit',unlit.createUnlit());
 const bounds=getBounds(scene),extent=bounds.max.map((v,i)=>v-bounds.min[i]);
 if([...bounds.min,...bounds.max].some(v=>!Number.isFinite(v))||Math.max(extent[0],extent[2])<=0)throw new Error('Nieprawidłowe wymiary siatki.');
 const scale=size/Math.max(extent[0],extent[2]);
 const wrapper=doc.createNode('Environment · AI Evolution').setScale([scale,scale,scale]).setTranslation([-(bounds.min[0]+bounds.max[0])/2*scale,-bounds.min[1]*scale,-(bounds.min[2]+bounds.max[2])/2*scale]);
 for(const node of scene.listChildren()){scene.removeChild(node);wrapper.addChild(node);}scene.addChild(wrapper);
 const dimensions=extent.map(v=>v*scale);
 wrapper.setExtras({role:'environment-reference',source:'AI Evolution 360 Studio',scaleApproximate:true,dimensions,collision:false});
 root.setDefaultScene(scene);
 const glb=Buffer.from(await io.writeBinary(doc));
 if(glb.length>GLB_LIMIT)throw new Error('Siatka po optymalizacji przekracza limit 30 MB Smart Concept Designer. Przygotuj mniejszy fragment sceny.');
 const assetId=`custom-studio-${id}`,label=String(name).slice(0,60);
 const project={version:1,name:label,environment:'empty',width:Math.max(8,Math.min(80,Math.ceil(dimensions[0]+4))),depth:Math.max(8,Math.min(80,Math.ceil(dimensions[2]+4))),time:14,grid:false,snap:false,landscapeVersion:1,layers:{buildings:false,planting:false,boundary:false},environmentEdits:{},surfaces:{},instances:[{id:`environment-${id}`,assetId,x:0,z:0,rotation:0,scale:1}],customAssets:[{id:assetId,name:label+' · environment',data:glb.toString('base64')}],studioExport:{version:1,dimensions,scaleApproximate:true,collisions:false}};
 return {glb,project,summary:{bytes:glb.length,before,faces:triangleCount(doc),dimensions,size}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [input,output,optionsFile]=process.argv.slice(2),options=JSON.parse(readFileSync(optionsFile,'utf8'));
  const result=await buildEnvironment(readFileSync(input),options);
  writeFileSync(output+'.glb',result.glb);writeFileSync(output+'.forma.json',JSON.stringify(result.project));writeFileSync(output+'.summary.json',JSON.stringify(result.summary));
  console.log('Środowisko GLB i projekt Smart Concept Designer są gotowe.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
