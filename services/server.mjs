import http from 'node:http';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, statfsSync, readdirSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {exportBlender} from './blender-export.mjs';
import {environmentOptions} from './environment-export.mjs';
import {cleanScene,cleanupPresets} from './scene-cleanup.mjs';
import { receivePhoto } from './photo-upload.mjs';
import { cameraSettings } from './viewer-camera.mjs';
import { ProjectStore, validId } from './project-manager/index.mjs';
import { run, stopChild, trainingProgress } from './spirula-runner/index.mjs';
import { json, body, asset, safePath } from './api/http.mjs';
import { createSpatialRoutes } from './api/spatial-routes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const port = Number(process.env.STUDIO_PORT || 8765);
const token = randomBytes(24).toString('hex');
const store = new ProjectStore(join(resolve(process.env.STUDIO_WORKSPACE || join(root, 'workspace')), 'projects'));
store.recover();
const engine = ['toolchain/spirula-build-source/build_vulkan/spirula.exe','toolchain/spirula/spirula.exe'].map(p=>join(root,p)).find(existsSync);
const presets = { fast: { frames:100, size:1280, iterations:3000, cap:150000, quality:'low' }, standard:{ frames:180,size:1600,iterations:10000,cap:400000,quality:'medium' }, max:{frames:400,size:2048,iterations:30000,cap:1000000,quality:'high'} };
let active = null, uploadBusy = false;
const health = { product:'AI Evolution 360 Studio', version:'0.6.0', ready:false, engine:'Sprawdzanie silnika…', gpu:'Sprawdzanie GPU…' };
if (engine) Promise.all([run(engine,['--help'],{timeout:15000}),run(engine,['sam','devices'],{timeout:15000}),run('ffprobe',['-version'],{timeout:15000}),run('ffmpeg',['-version'],{timeout:15000})]).then(([version,gpu])=>Object.assign(health,{ready:true,engine:version.split('\n')[0],gpu:gpu.split('\n').find(l=>/NVIDIA|AMD|Intel/.test(l))?.replace(/\s+/g,' ').trim() || 'Vulkan'})).catch(e=>Object.assign(health,{ready:false,engine:e.message}));
else health.engine = 'Nie znaleziono Spirula. Sprawdź toolchain.';

const publicProject = p => ({...p, sourcePath:undefined, logPath:undefined});
function requireDiskSpace(project){const disk=statfsSync(store.path(project.id));if(disk.bavail*disk.bsize<5*1024**3)throw new Error('Za mało miejsca na dysku projektu. Zwolnij co najmniej 5 GB przed generacją lub eksportem GLB (duże filmy mogą wymagać więcej).');}
async function probe(project) {
    const raw = await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',project.sourcePath],{timeout:30000});
    const info=JSON.parse(raw), videos=info.streams.filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
    if(!videos.length)throw new Error('Plik nie zawiera strumienia wideo.');
    const v=videos[0], [n,d]=String(v.avg_frame_rate||v.r_frame_rate).split('/').map(Number), fps=n/(d||1);
    const duration=Number(info.format.duration||v.duration);
    if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(fps)||fps<=0)throw new Error('Nie można odczytać czasu lub klatek filmu.');
    const spherical=(v.side_data_list||[]).some(s=>/spherical/i.test(s.side_data_type));
    project.metadata={width:v.width,height:v.height,fps,duration,streams:videos.length,codec:v.codec_name,bytes:statSync(project.sourcePath).size,frames:Math.round(duration*fps),telemetry:'Do sprawdzenia przez Spirula podczas rekonstrukcji',suggestedMode:extname(project.sourcePath)==='.insv'?'fisheye':spherical?'equirect':'perspective'};
    project.state='uploaded';store.save(project);
    try {await run('ffmpeg',['-v','error','-ss',String(Math.min(1,duration/2)),'-i',project.sourcePath,'-frames:v','1','-vf','scale=960:-2','-y',join(store.path(project.id),'source','poster.jpg')],{timeout:30000});}catch{}
}
async function processProject(project, options) {
    if(active||spatial.jobs.active)throw new Error('Inny projekt jest przetwarzany. Poczekaj lub anuluj go.');
    if(!health.ready)throw new Error('Silnik nie jest gotowy.');
    const photos=project.kind==='photos',rawPhotos=photos&&project.photos?.[0]?.projection==='fisheye';
    if(photos&&(!project.uploadComplete||project.photos?.length<3))throw new Error('Rekonstrukcja wymaga minimum 3 zdjęć INSP lub zszytych panoram z różnych pozycji. Zalecamy 12–30; mała liczba zdjęć nie gwarantuje poprawnej geometrii.');
    if(!project.metadata||!existsSync(project.sourcePath||''))throw new Error('Dodaj materiał ponownie.');
    requireDiskSpace(project);options.preset??='max';const preset=Object.hasOwn(presets,options.preset)?presets[options.preset]:null;if(!preset)throw new Error('Nieprawidłowy preset.');
    const mode=photos?(rawPhotos?'fisheye':'equirect'):options.mode==='auto'?project.metadata.suggestedMode:options.mode;
    if(!['fisheye','equirect','perspective'].includes(mode))throw new Error('Wybierz typ nagrania.');
    if(mode==='fisheye'&&!photos&&project.metadata.streams!==2)throw new Error('Ten tryb wymaga dwóch strumieni w jednym INSV. Dla plików rozdzielonych wyeksportuj panoramę 360° 2:1 w Insta360 Studio i wybierz „Panorama 360°”.');
    if(mode==='equirect'&&Math.abs(project.metadata.width/project.metadata.height-2)>.05)throw new Error('Panorama 360° powinna mieć proporcje 2:1. Sprawdź eksport i wybrany typ materiału.');
    const job={id:project.id,cancelled:false,child:null};active=job;
    project.qualitySettings={...preset};project.meshExport=null;project.meshOutput=null;project.originalOutput=null;project.cleanedOutput=null;project.cleanup=null;project.attempt++;project.preset=options.preset;project.mode=mode;project.state='processing';project.startedAt=new Date().toISOString();project.finishedAt=null;project.error=null;project.progress=null;project.stage=0;project.lastLine='Przygotowanie materiału';project.output=null;
    const base=store.path(project.id), attempt=String(project.attempt);
    const dataset=join(base,'dataset',attempt), recon=join(base,'reconstruction',attempt), splat=join(base,'splat',attempt), web=join(base,'web',attempt);
    for(const p of [dataset,recon,splat,web])mkdirSync(p,{recursive:true});
    const log=join(base,'logs',`${attempt}.log`);project.logPath=log;store.save(project);
    const stage=n=>{if(job.cancelled)throw new Error('Anulowano zadanie.');project.stage=n;project.progress=null;store.save(project);};
    let lastSave=0;
    const onLine=line=>{project.lastLine=line;const progress=trainingProgress(line);if(progress!==null)project.progress=progress;if(Date.now()-lastSave>500){store.save(project);lastSave=Date.now();}};
    const command=(exe,args)=>run(exe,args,{log,onLine,job});
    (async()=>{
        try {
            const images=join(dataset,'images');
            if(photos){
                stage(1);mkdirSync(images,{recursive:true});
                for(let i=0;i<project.photos.length;i++){
                    const photo=project.photos[i];
                    if(rawPhotos){
                        for(let lens=0;lens<2;lens++){
                            const folder=join(images,`cam${lens}`);mkdirSync(folder,{recursive:true});
                            await command('ffmpeg',['-v','error','-i',join(project.sourcePath,photo.file),'-frames:v','1','-vf',`crop=iw/2:ih:${lens}*iw/2:0,scale=${Math.min(preset.size,photo.height)}:-2`,'-q:v','1','-y',join(folder,`${String(i).padStart(4,'0')}.jpg`)]);
                        }
                    }else{
                        await command('ffmpeg',['-v','error','-i',join(project.sourcePath,photo.file),'-frames:v','1','-vf',`scale=${Math.min(3840,preset.size*2)}:-2`,'-q:v','2','-y',join(images,`${String(i).padStart(4,'0')}.jpg`)]);
                    }
                }
            }else{
                await command(engine,['sam','video','--info',project.sourcePath]);
                stage(1);
                const skip=Math.max(1,Math.ceil(project.metadata.fps/(options.preset==='max'?3:2)),Math.ceil(project.metadata.frames/preset.frames));
                const scale=Math.min(1,preset.size/project.metadata.width);
                await command(engine,['sam','extract',project.sourcePath,'-o',images,'--skip',String(skip),'--max-frames',String(preset.frames),'--scale',String(scale),'--sync','--adaptive']);
            }
            stage(2);
            const groups=readdirSync(images,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
            // Packed INSP lenses need a wide-angle initial focal; with sparse captures the engine cannot run its focal sweep. BA refines this approximate prior.
            const cameras=(groups.length?groups:['']).map(prefix=>({prefix,model:mode==='fisheye'?'thin-prism-fisheye':mode==='equirect'?'equirectangular':'opencv',...(rawPhotos?{focal:Math.min(preset.size,project.photos[0].height)*.29}:{})}));
            const manifest={image_dir:images, camera_mode:groups.length?'folder':'single',cameras,captures:cameras.map(c=>({prefix:c.prefix,telemetry:project.sourcePath,fps:project.metadata.fps})),sequences:[{members:groups.length?groups:['.']}]};
            if(photos){delete manifest.captures;delete manifest.sequences;}
            if(mode==='fisheye'){if(groups.length!==2)throw new Error('Nie uzyskano obu soczewek. Sprawdź log ekstrakcji.');manifest.rigs=[{name:'Insta360',kind:'dual-fisheye',members:groups}];}
            writeFileSync(join(dataset,'manifest.json'),JSON.stringify(manifest,null,2));
            stage(3);
            await command(engine,['sfm','auto',images,'-o',recon,'--manifest',join(dataset,'manifest.json'),'--data-type',photos?'individual':'video','--quality',preset.quality,...(rawPhotos?['--max-features','16384']:[])]);
            const sparse=join(recon,'sparse','0');
            const points=join(sparse,'points3D.bin');
            if(!existsSync(points)||statSync(points).size<=8)throw new Error('Nie udało się odtworzyć geometrii. Nagraj spokojny spacer ze zmianą pozycji i większą liczbą szczegółów.');
            if(photos){project.sparsePoints=Number(readFileSync(points).readBigUInt64LE(0));if(project.sparsePoints<100)throw new Error('Za mało wiarygodnych punktów przestrzeni. Dodaj 12–30 zdjęć z mniejszymi odstępami i nieruchomą sceną.');}
            const registered=join(sparse,'images.bin');
            if(existsSync(registered)){const count=Number(readFileSync(registered).readBigUInt64LE(0));project.registeredCameras=count;if(count<3)throw new Error('Za mało odtworzonych pozycji kamery. Potrzeba ruchu z paralaksą i wyraźnych detali.');}
            if(photos&&project.registeredCameras!==project.photos.length*(rawPhotos?2:1))throw new Error(`Połączono tylko ${project.registeredCameras} z ${project.photos.length*(rawPhotos?2:1)} widoków obiektywów. Dodaj zdjęcia pośrednie ze wspólnymi detalami; nie wszystkie zdjęcia tworzą jedną przestrzeń.`);
            stage(4);
            await command(engine,['train',mode==='fisheye'||mode==='equirect'?'360-camera':'3dgs','--data',dataset,'--data-format','colmap','--colmap-recon-dir',sparse,'--output-dir-prefix',splat,'--output-dir-name','run','--quality',preset.quality,'--train-resolution-divisor','1','--num-iterations',String(preset.iterations),'--cap-max',String(preset.cap),'--disable-viewer','1','--keep-viewer-alive','0']);
            const runs=join(splat,'run');const checkpoints=readdirSync(runs).filter(n=>/^step-\d+\.ckpt$/.test(n)).sort();
            if(!checkpoints.length)throw new Error('Silnik nie zapisał checkpointu.');
            const ply=join(runs,checkpoints.at(-1),'splat.ply');if(!existsSync(ply)||statSync(ply).size<100)throw new Error('Brak poprawnego PLY.');
            stage(5);
            await command(process.execPath,[join(root,'vendor/splat-transform/bin/cli.mjs'),ply,'--rotate=-90,0,0',join(web,'scene.sog')]);
            if(!existsSync(join(web,'scene.sog'))||statSync(join(web,'scene.sog')).size<100)throw new Error('Eksport SOG jest pusty.');
            stage(6);const { defaultSettings } = await import('../vendor/supersplat-viewer/dist/settings.js');const settings=cameraSettings(defaultSettings('object'),registered,join(runs,'scene_transform.json'));settings.background.color=[0.035,0.059,0.094];writeFileSync(join(web,'settings.json'),JSON.stringify(settings));
            project.output={web:attempt,ply: `${attempt}/run/${checkpoints.at(-1)}/splat.ply`,bytes:statSync(join(web,'scene.sog')).size};
            project.stage=7;project.state='ready';project.progress=null;project.lastLine='Scena gotowa do obejrzenia.';
        } catch(error){project.state=job.cancelled?'cancelled':'failed';project.error=job.cancelled?'Zadanie anulowane. Materiał źródłowy jest zachowany.':photos&&project.stage===3?'Nie udało się wiarygodnie połączyć zdjęć. Dodaj więcej ujęć pośrednich z różnych pozycji (najlepiej 12–30), unikaj poruszających się osób. Szczegóły są w logu.':error.message;project.progress=null;}
        finally {project.finishedAt=new Date().toISOString();store.save(project);active=null;}
    })();
    return project;
}

async function cleanupProject(project,strength){
    if(active||spatial.jobs.active)throw new Error('Inne zadanie już trwa. Poczekaj na zakończenie.');
    if(project.state!=='ready'||!project.output)throw new Error('Najpierw utwórz scenę 3D.');
    if(!Object.hasOwn(cleanupPresets,strength))throw new Error('Nieprawidłowa siła czyszczenia.');
    const original=project.originalOutput||project.output;project.originalOutput={...original};
    const job={id:project.id,kind:'cleanup',cancelled:false,child:null};active=job;
    const log=join(store.path(project.id),'logs',`cleanup-${Date.now()}.log`);project.logPath=log;
    project.cleanup={status:'processing',strength,phase:'Usuwanie półprzezroczystych splatów i odizolowanych artefaktów…',startedAt:new Date().toISOString()};store.save(project);
    let saved=0;
    (async()=>{try{
        const result=await cleanScene({root,base:store.path(project.id),original,strength,attempt:project.attempt,job,log,onLine:line=>{project.cleanup.phase=line;if(Date.now()-saved>800){store.save(project);saved=Date.now();}}});
        if(job.cancelled)throw new Error('Anulowano czyszczenie.');
        project.cleanedOutput=result.output;project.output=result.output;
        Object.assign(project.cleanup,{status:'ready',before:result.before,after:result.after,removed:result.removed,phase:'Oczyszczona scena gotowa.'});
    }catch(error){project.cleanup.status=job.cancelled?'cancelled':'failed';project.cleanup.error=job.cancelled?'Czyszczenie anulowane. Poprzedni wynik zachowano.':error.message;}
    finally{project.cleanup.finishedAt=new Date().toISOString();store.save(project);active=null;}})();
    return project;
}

async function meshProject(project){
    if(active||spatial.jobs.active)throw new Error('Poczekaj na zakończenie bieżącego zadania.');
    if(project.state!=='ready'||!project.output)throw new Error('Najpierw wygeneruj przestrzeń 3D.');
    requireDiskSpace(project);
    const job={id:project.id,kind:'mesh',cancelled:false,child:null};active=job;
    const log=join(store.path(project.id),'logs',`mesh-${Date.now()}.log`);project.logPath=log;
    project.meshExport={status:'processing',phase:'Budowanie siatki i kolorów powierzchni…',sourceWeb:project.output.web,startedAt:new Date().toISOString()};store.save(project);let saved=0;
    (async()=>{try{
        const output=await exportBlender({base:store.path(project.id),engine,project,job,log,onLine:line=>{project.meshExport.phase=line;if(Date.now()-saved>800){saved=Date.now();store.save(project);}}});
        if(job.cancelled)throw new Error('Anulowano eksport.');
        project.meshOutput=output;project.meshExport.status='ready';project.meshExport.phase='Kolorowa siatka GLB jest gotowa.';
    }catch(error){project.meshExport.status=job.cancelled?'cancelled':'failed';project.meshExport.error=job.cancelled?'Anulowano eksport. Scena jest zachowana.':error.message;}
    finally{project.meshExport.finishedAt=new Date().toISOString();store.save(project);active=null;}})();return project;
}

async function environmentProject(project,options){
    if(active||spatial.jobs.active)throw new Error('Poczekaj na zakończenie bieżącego zadania.');
    if(project.state!=='ready'||!project.output)throw new Error('Najpierw wygeneruj przestrzeń 3D.');
    const settings=environmentOptions(options),base=store.path(project.id);
    const reuse=project.meshOutput?.sourceWeb===project.output.web;
    if(!reuse)requireDiskSpace(project);
    else {const d=statfsSync(base);if(d.bavail*d.bsize<256*1024**2)throw new Error('Eksport wymaga co najmniej 256 MB wolnego miejsca.');}
    const key=`${project.attempt}-${Date.now()}`,folder=join(base,'environment',key);mkdirSync(folder,{recursive:true});
    const job={id:project.id,kind:'environment',cancelled:false,child:null};
    const log=join(base,'logs',`environment-${Date.now()}.log`);project.logPath=log;
    project.environmentExport={status:'processing',phase:reuse?'Optymalizacja istniejącej siatki…':'Budowanie siatki środowiska…',sourceWeb:project.output.web,startedAt:new Date().toISOString()};store.save(project);active=job;let saved=0;
    const onLine=line=>{project.environmentExport.phase=line;if(Date.now()-saved>800){saved=Date.now();store.save(project);}};
    (async()=>{try{
        if(!reuse)project.meshOutput=await exportBlender({base,engine,project,job,log,onLine});
        const config=join(folder,'options.json');writeFileSync(config,JSON.stringify({...settings,name:project.name,id:key}));
        await run(process.execPath,[join(root,'services/environment-export.mjs'),join(base,'mesh',project.meshOutput.file),join(folder,'environment'),config],{job,log,onLine,timeout:600000});
        if(job.cancelled)throw new Error('Anulowano eksport.');
        const summary=JSON.parse(readFileSync(join(folder,'environment.summary.json'),'utf8'));
        project.environmentOutput={...summary,file:`${key}/environment`,sourceWeb:project.output.web};
        project.environmentExport.status='ready';project.environmentExport.phase='Środowisko gotowe do importu.';
    }catch(error){project.environmentExport.status=job.cancelled?'cancelled':'failed';project.environmentExport.error=job.cancelled?'Anulowano eksport. Poprzednie pliki zachowano.':error.message;}
    finally{project.environmentExport.finishedAt=new Date().toISOString();store.save(project);active=null;}})();return project;
}

const spatial = createSpatialRoutes({ store, json, body, asset, reconstructionBusy: () => Boolean(active) });
// Keep manifests current when legacy reconstruction/export code changes project outputs.
store.onSave = project => {
    if (existsSync(join(store.path(project.id), 'scene.json'))) {
        try { spatial.scenes.get(project); }
        catch (error) { console.warn('Manifest sceny wymaga naprawy: ' + error.message); }
    }
};
const server=http.createServer(async(req,res)=>{
    try {
        if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);return res.end();}
        const url=new URL(req.url,`http://127.0.0.1:${port}`), path=url.pathname;
        if(req.method!=='GET'&&req.method!=='HEAD'){
            if(req.headers['x-studio-token']!==token)return json(res,{error:'Odśwież aplikację przed wykonaniem tej operacji.'},403);
            if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return json(res,{error:'Niedozwolone źródło żądania.'},403);
        }
        if(path==='/api/health')return json(res,{...health,token,busy:active?.id||spatial.jobs.active?.projectId||null,presets});
        if(await spatial.handle(req,res,url))return;
        if(path==='/api/shutdown'&&req.method==='POST'){json(res,{ok:true});setTimeout(shutdown,100);return;}
        if(path==='/api/projects'&&req.method==='GET')return json(res,store.list().map(publicProject));
        if(path==='/api/photos'&&req.method==='POST'){
            const data=await body(req);
            if(!Number.isInteger(data.count)||data.count<1||data.count>100)throw new Error('Dodaj od 1 do 100 zdjęć.');
            const project=store.create(typeof data.name==='string'?data.name:'Zdjęcia 360');
            project.kind='photos';project.photos=[];project.expectedPhotos=data.count;project.sourcePath=join(store.path(project.id),'source','photos');store.save(project);
            return json(res,publicProject(project),201);
        }
        if(path==='/api/upload'&&req.method==='POST'){
            if(uploadBusy)return json(res,{error:'Trwa przesyłanie innego pliku.'},409);
            const name=basename(url.searchParams.get('name')||'video.mp4');const extension=extname(name).toLowerCase();
            if(!['.mp4','.mov','.insv'].includes(extension))return json(res,{error:'Wybierz MP4, MOV lub INSV.'},400);
            const size=Number(req.headers['content-length']);const limit=20*1024**3;
            if(!Number.isFinite(size)||size<=0||size>limit)return json(res,{error:'Obsługiwane są pliki do 20 GB. Na początek wybierz krótki klip.'},413);
            uploadBusy=true;const project=store.create(name.replace(/\.[^.]+$/,''));project.sourceName=name;project.sourcePath=join(store.path(project.id),'source','video'+extension);store.save(project);
            try {
                let received=0;const guard=new Transform({transform(chunk,enc,callback){received+=chunk.length;callback(received>limit?new Error('Przekroczono limit pliku.'):null,chunk);}});
                await pipeline(req,guard,createWriteStream(project.sourcePath+'.part',{flags:'wx'}));
                if(received!==size)throw new Error('Film nie został w całości przesłany.');
                renameSync(project.sourcePath+'.part',project.sourcePath);await probe(project);json(res,publicProject(project),201);
            }catch(e){project.state='failed';project.error='Nie udało się odczytać filmu. '+e.message;store.save(project);if(!res.destroyed)json(res,{error:project.error,project:publicProject(project)},400);}finally{uploadBusy=false;}return;
        }
        const match=path.match(/^\/api\/projects\/([a-f0-9-]+)(?:\/([a-z0-9_-]+))?$/);
        if(match){const [,id,action]=match;if(!validId(id)||!existsSync(join(store.path(id),'project.json')))return json(res,{error:'Nie znaleziono projektu.'},404);const project=store.get(id);
            if(!action&&req.method==='GET')return json(res,publicProject(project));
            if(action==='photo'&&req.method==='POST'){
                if(uploadBusy)throw new Error('Trwa przesyłanie innego pliku.');uploadBusy=true;
                try{return json(res,publicProject(await receivePhoto(req,project,store,url.searchParams.get('name')||'')),201);}finally{uploadBusy=false;}
            }
            if(action==='finishphotos'&&req.method==='POST'){
                if(project.kind!=='photos'||project.state!=='uploading'||project.photos.length!==project.expectedPhotos)throw new Error('Nie przesłano wszystkich zdjęć. Dodaj zestaw ponownie.');
                project.uploadComplete=true;project.mode=project.photos[0].projection||'equirect';project.state=project.photos.length<3?'panorama':'uploaded';project.sourceName=`${project.photos.length} zdjęć 360°`;
                project.metadata={width:project.photos[0].width,height:project.photos[0].height,bytes:project.photos.reduce((s,p)=>s+p.bytes,0),suggestedMode:project.mode,count:project.photos.length};
                return json(res,publicProject(store.save(project)));
            }
            if(action==='abortphotos'&&req.method==='POST'){
                if(project.kind!=='photos'||project.state!=='uploading')throw new Error('Sesja jest zamknięta.');
                project.state='cancelled';project.error='Nieukończony zestaw zdjęć. Dodaj komplet ponownie.';return json(res,publicProject(store.save(project)));
            }
            if(action==='panorama'&&req.method==='GET'){
                const i=Number(url.searchParams.get('index')||0);
                if(project.kind!=='photos'||!Number.isInteger(i)||!project.photos[i])throw new Error('Nie znaleziono panoramy.');
                return asset(res,req,join(store.path(id),'source','photos',project.photos[i].preview));
            }
            if(action==='environment'&&req.method==='POST')return json(res,publicProject(await environmentProject(project,await body(req))),202);
            if(action==='cancelenvironment'&&req.method==='POST'){if(active?.id!==id||active.kind!=='environment')throw new Error('Eksport środowiska nie jest aktywny.');active.cancelled=true;project.environmentExport.status='cancelling';store.save(project);stopChild(active.child);return json(res,{ok:true});}
            if(['environment-glb','environment-project'].includes(action)&&req.method==='GET'){
                if(!project.environmentOutput||project.environmentOutput.sourceWeb!==project.output?.web)throw new Error('Przygotuj środowisko dla aktualnego wariantu sceny.');
                return asset(res,req,safePath(join(store.path(id),'environment'),project.environmentOutput.file+(action==='environment-glb'?'.glb':'.forma.json')),true);
            }
            if(action==='mesh'&&req.method==='POST')return json(res,publicProject(await meshProject(project)),202);
            if(action==='cancelmesh'&&req.method==='POST'){if(active?.id!==id||active.kind!=='mesh')throw new Error('Eksport nie jest aktywny.');active.cancelled=true;project.meshExport.status='cancelling';store.save(project);stopChild(active.child);return json(res,{ok:true});}
            if(action==='glb'&&project.meshOutput){if(project.meshOutput.sourceWeb!==project.output?.web)throw new Error('Wygeneruj GLB dla aktualnego wariantu sceny.');return asset(res,req,safePath(join(store.path(id),'mesh'),project.meshOutput.file),true);}
            if(action==='cleanup'&&req.method==='POST'){const data=await body(req);return json(res,publicProject(await cleanupProject(project,data.strength)),202);}
            if(action==='cancelcleanup'&&req.method==='POST'){if(active?.id!==id||active.kind!=='cleanup')throw new Error('Czyszczenie nie jest aktywne.');active.cancelled=true;project.cleanup.status='cancelling';store.save(project);stopChild(active.child);return json(res,{ok:true});}
            if(action==='variant'&&req.method==='POST'){
                if(active?.id===id)throw new Error('Poczekaj na zakończenie zadania.');
                const data=await body(req);const output=data.variant==='original'?project.originalOutput:data.variant==='cleaned'?project.cleanedOutput:null;
                if(!output)throw new Error('Ten wariant nie jest jeszcze dostępny.');project.output=output;return json(res,publicProject(store.save(project)));
            }
            if(action==='start'&&req.method==='POST')return json(res,publicProject(await processProject(project,await body(req))),202);
            if(action==='cancel'&&req.method==='POST'){if(active?.id!==id)return json(res,{error:'Projekt nie jest przetwarzany.'},409);active.cancelled=true;project.state='cancelling';store.save(project);stopChild(active.child);return json(res,{ok:true});}
            if(action==='archive'&&req.method==='POST'){if(active?.id===id||spatial.jobs.active?.projectId===id)return json(res,{error:'Najpierw zakończ zadanie.'},409);project.archived=!project.archived;store.save(project);return json(res,publicProject(project));}
            if(action==='logs'&&req.method==='GET'){if(!project.logPath)return json(res,{text:'Log pojawi się po uruchomieniu przetwarzania.'});return json(res,{text:readFileSync(project.logPath,'utf8').slice(-24000)});}
            if(action==='logfile')return asset(res,req,project.logPath||'',true);
            if(action==='poster')return asset(res,req,join(store.path(id),'source','poster.jpg'));
            if(action==='video')return asset(res,req,project.sourcePath||'');
            if(action==='sog'&&project.output)return asset(res,req,safePath(join(store.path(id),'web'),project.output.web+'/scene.sog'),url.searchParams.has('download'));
            if(action==='settings'&&project.output)return asset(res,req,safePath(join(store.path(id),'web'),project.output.web+'/settings.json'));
            if(action==='ply'&&project.output)return asset(res,req,safePath(join(store.path(id),'splat'),project.output.ply),true);
        }
        if(path==='/api/demo'&&req.method==='GET')return json(res,{available:existsSync(join(root,'workspace/source-export/scene.sog'))});
        if(path.startsWith('/demo/')){const name=path.slice(6);if(!['scene.sog','settings.json'].includes(name)){res.writeHead(404);return res.end();}return asset(res,req,join(root,'workspace/source-export',name));}
        if(path.startsWith('/panorama-lib/')){const file=path.slice(14);if(!['pannellum.js','pannellum.css'].includes(file)){res.writeHead(404);return res.end();}return asset(res,req,join(root,'vendor/panorama/node_modules/pannellum/build',file));}
        if(path.startsWith('/viewer/'))return asset(res,req,safePath(join(root,'vendor/supersplat-viewer/public'),decodeURIComponent(path.slice(8))));
        if(path.startsWith('/api/'))return json(res,{error:'Nieznana operacja.'},404);
        return asset(res,req,safePath(join(root,'apps/desktop'),path==='/'?'index.html':decodeURIComponent(path.slice(1))));
    }catch(error){if(!res.headersSent)json(res,{error:error.message},error.status||400);else res.destroy();}
});
server.requestTimeout=0;
server.listen(port,'127.0.0.1',()=>console.log(`AI Evolution 360 Studio: http://127.0.0.1:${port}`));
function shutdown(){if(active){active.cancelled=true;stopChild(active.child);}if(spatial.jobs.active)spatial.jobs.cancel({id:spatial.jobs.active.projectId});server.close();const timer=setInterval(()=>{if(!active&&!spatial.jobs.active){clearInterval(timer);process.exit(0);}},100);setTimeout(()=>process.exit(0),5000).unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
