import http from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, readdirSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { dirname, join, resolve, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ProjectStore, validId } from './project-manager/index.mjs';
import { run, stopChild, trainingProgress } from './spirula-runner/index.mjs';
import { defaultSettings } from '../vendor/supersplat-viewer/dist/settings.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.STUDIO_PORT || 8765);
const token = randomBytes(24).toString('hex');
const store = new ProjectStore(join(root, 'workspace/projects'));
store.recover();
const engine = ['toolchain/spirula-build-source/build_vulkan/spirula.exe','toolchain/spirula/spirula.exe'].map(p=>join(root,p)).find(existsSync);
const presets = { fast: { frames:100, size:1280, iterations:3000, cap:150000, quality:'low' }, standard:{ frames:180,size:1600,iterations:10000,cap:400000,quality:'medium' }, max:{frames:300,size:1920,iterations:20000,cap:800000,quality:'high'} };
let active = null, uploadBusy = false;
const health = { product:'AI Evolution 360 Studio', version:'0.2.0', ready:false, engine:'Sprawdzanie silnika…', gpu:'Sprawdzanie GPU…' };
if (engine) Promise.all([run(engine,['--help'],{timeout:15000}),run(engine,['sam','devices'],{timeout:15000}),run('ffprobe',['-version'],{timeout:15000}),run('ffmpeg',['-version'],{timeout:15000})]).then(([version,gpu])=>Object.assign(health,{ready:true,engine:version.split('\n')[0],gpu:gpu.split('\n').find(l=>/NVIDIA|AMD|Intel/.test(l))?.replace(/\s+/g,' ').trim() || 'Vulkan'})).catch(e=>Object.assign(health,{ready:false,engine:e.message}));
else health.engine = 'Nie znaleziono Spirula. Sprawdź toolchain.';

const json = (res, data, status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const publicProject = p => ({...p, sourcePath:undefined, logPath:undefined});
function asset(res, req, path, download=false) {
    if (!existsSync(path) || !statSync(path).isFile()) {res.writeHead(404);return res.end('Nie znaleziono pliku.');}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.sog':'application/octet-stream','.ply':'application/octet-stream','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.mov':'video/quicktime','.txt':'text/plain; charset=utf-8','.log':'text/plain; charset=utf-8'};
    const size=statSync(path).size;
    const headers={'Content-Type':mime[extname(path)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    if(download) headers['Content-Disposition']=`attachment; filename="${basename(path).replace(/[^a-zA-Z0-9._-]/g,'_')}"`;
    let start=0,end=size-1,status=200;
    if(req.headers.range){const m=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!m){res.writeHead(416);return res.end();}start=+m[1];end=m[2]?Math.min(+m[2],size-1):size-1;if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;}
    headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);
    if(req.method==='HEAD'||size===0)return res.end();
    const stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);
}
function safePath(base, path){const p=resolve(base,path);if(!p.startsWith(resolve(base)+sep))throw new Error('Niedozwolona ścieżka.');return p;}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>10000)throw new Error('Zbyt duże żądanie.');}return JSON.parse(text||'{}');}
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
    if(active)throw new Error('Inny projekt jest przetwarzany. Poczekaj lub anuluj go.');
    if(!health.ready)throw new Error('Silnik nie jest gotowy.');
    if(!project.metadata||!existsSync(project.sourcePath||''))throw new Error('Wgraj film ponownie.');
    const preset=presets[options.preset];if(!preset)throw new Error('Nieprawidłowy preset.');
    const mode=options.mode==='auto'?project.metadata.suggestedMode:options.mode;
    if(!['fisheye','equirect','perspective'].includes(mode))throw new Error('Wybierz typ nagrania.');
    if(mode==='fisheye'&&project.metadata.streams!==2)throw new Error('Ten tryb wymaga dwóch strumieni w jednym INSV. Dla plików rozdzielonych wyeksportuj panoramę 360° 2:1 w Insta360 Studio i wybierz „Panorama 360°”.');
    if(mode==='equirect'&&Math.abs(project.metadata.width/project.metadata.height-2)>.05)throw new Error('Panorama 360° powinna mieć proporcje 2:1. Sprawdź eksport i wybrany typ materiału.');
    const job={id:project.id,cancelled:false,child:null};active=job;
    project.attempt++;project.preset=options.preset;project.mode=mode;project.state='processing';project.startedAt=new Date().toISOString();project.finishedAt=null;project.error=null;project.progress=null;project.stage=0;project.lastLine='Przygotowanie materiału';project.output=null;
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
            await command(engine,['sam','video','--info',project.sourcePath]);
            stage(1);
            const skip=Math.max(1,Math.ceil(project.metadata.fps/2),Math.ceil(project.metadata.frames/preset.frames));
            const scale=Math.min(1,preset.size/project.metadata.width);
            const images=join(dataset,'images');
            await command(engine,['sam','extract',project.sourcePath,'-o',images,'--skip',String(skip),'--max-frames',String(preset.frames),'--scale',String(scale),'--sync','--adaptive']);
            stage(2);
            const groups=readdirSync(images,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
            const cameras=(groups.length?groups:['']).map(prefix=>({prefix,model:mode==='fisheye'?'thin-prism-fisheye':mode==='equirect'?'equirectangular':'opencv'}));
            const manifest={image_dir:images, camera_mode:groups.length?'folder':'single',cameras,captures:cameras.map(c=>({prefix:c.prefix,telemetry:project.sourcePath,fps:project.metadata.fps})),sequences:[{members:groups.length?groups:['.']}]};
            if(mode==='fisheye'){if(groups.length!==2)throw new Error('Nie uzyskano obu soczewek. Sprawdź log ekstrakcji.');manifest.rigs=[{name:'Insta360',kind:'dual-fisheye',members:groups}];}
            writeFileSync(join(dataset,'manifest.json'),JSON.stringify(manifest,null,2));
            stage(3);
            await command(engine,['sfm','auto',images,'-o',recon,'--manifest',join(dataset,'manifest.json'),'--data-type','video','--quality',preset.quality]);
            const sparse=join(recon,'sparse','0');
            const points=join(sparse,'points3D.bin');
            if(!existsSync(points)||statSync(points).size<=8)throw new Error('Nie udało się odtworzyć geometrii. Nagraj spokojny spacer ze zmianą pozycji i większą liczbą szczegółów.');
            const registered=join(sparse,'images.bin');
            if(existsSync(registered)){const count=Number(readFileSync(registered).readBigUInt64LE(0));project.registeredCameras=count;if(count<3)throw new Error('Za mało odtworzonych pozycji kamery. Potrzeba ruchu z paralaksą i wyraźnych detali.');}
            stage(4);
            await command(engine,['train',mode==='fisheye'?'360-camera':'3dgs','--data',dataset,'--data-format','colmap','--colmap-recon-dir',sparse,'--output-dir-prefix',splat,'--output-dir-name','run','--num-iterations',String(preset.iterations),'--cap-max',String(preset.cap),'--disable-viewer','1','--keep-viewer-alive','0']);
            const runs=join(splat,'run');const checkpoints=readdirSync(runs).filter(n=>/^step-\d+\.ckpt$/.test(n)).sort();
            if(!checkpoints.length)throw new Error('Silnik nie zapisał checkpointu.');
            const ply=join(runs,checkpoints.at(-1),'splat.ply');if(!existsSync(ply)||statSync(ply).size<100)throw new Error('Brak poprawnego PLY.');
            stage(5);
            await command(process.execPath,[join(root,'vendor/splat-transform/bin/cli.mjs'),ply,join(web,'scene.sog')]);
            if(!existsSync(join(web,'scene.sog'))||statSync(join(web,'scene.sog')).size<100)throw new Error('Eksport SOG jest pusty.');
            stage(6);const settings=defaultSettings('object');settings.cameras=[];settings.background.color=[0.035,0.059,0.094];writeFileSync(join(web,'settings.json'),JSON.stringify(settings));
            project.output={web:attempt,ply: `${attempt}/run/${checkpoints.at(-1)}/splat.ply`,bytes:statSync(join(web,'scene.sog')).size};
            project.stage=7;project.state='ready';project.progress=null;project.lastLine='Scena gotowa do obejrzenia.';
        } catch(error){project.state=job.cancelled?'cancelled':'failed';project.error=job.cancelled?'Zadanie anulowane. Materiał źródłowy jest zachowany.':error.message;project.progress=null;}
        finally {project.finishedAt=new Date().toISOString();store.save(project);active=null;}
    })();
    return project;
}

const server=http.createServer(async(req,res)=>{
    try {
        if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);return res.end();}
        const url=new URL(req.url,`http://127.0.0.1:${port}`), path=url.pathname;
        if(req.method!=='GET'&&req.method!=='HEAD'){
            if(req.headers['x-studio-token']!==token)return json(res,{error:'Odśwież aplikację przed wykonaniem tej operacji.'},403);
            if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return json(res,{error:'Niedozwolone źródło żądania.'},403);
        }
        if(path==='/api/health')return json(res,{...health,token,busy:active?.id||null,presets});
        if(path==='/api/shutdown'&&req.method==='POST'){json(res,{ok:true});setTimeout(shutdown,100);return;}
        if(path==='/api/projects'&&req.method==='GET')return json(res,store.list().map(publicProject));
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
        const match=path.match(/^\/api\/projects\/([a-f0-9-]+)(?:\/(\w+))?$/);
        if(match){const [,id,action]=match;if(!validId(id)||!existsSync(join(store.path(id),'project.json')))return json(res,{error:'Nie znaleziono projektu.'},404);const project=store.get(id);
            if(!action&&req.method==='GET')return json(res,publicProject(project));
            if(action==='start'&&req.method==='POST')return json(res,publicProject(await processProject(project,await body(req))),202);
            if(action==='cancel'&&req.method==='POST'){if(active?.id!==id)return json(res,{error:'Projekt nie jest przetwarzany.'},409);active.cancelled=true;project.state='cancelling';store.save(project);stopChild(active.child);return json(res,{ok:true});}
            if(action==='archive'&&req.method==='POST'){if(active?.id===id)return json(res,{error:'Najpierw zakończ zadanie.'},409);project.archived=!project.archived;store.save(project);return json(res,publicProject(project));}
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
        if(path.startsWith('/viewer/'))return asset(res,req,safePath(join(root,'vendor/supersplat-viewer/public'),decodeURIComponent(path.slice(8))));
        if(path.startsWith('/api/'))return json(res,{error:'Nieznana operacja.'},404);
        return asset(res,req,safePath(join(root,'apps/desktop'),path==='/'?'index.html':decodeURIComponent(path.slice(1))));
    }catch(error){if(!res.headersSent)json(res,{error:error.message},400);else res.destroy();}
});
server.requestTimeout=0;
server.listen(port,'127.0.0.1',()=>console.log(`AI Evolution 360 Studio: http://127.0.0.1:${port}`));
function shutdown(){if(active){active.cancelled=true;stopChild(active.child);}server.close();const timer=setInterval(()=>{if(!active){clearInterval(timer);process.exit(0);}},100);setTimeout(()=>process.exit(0),5000).unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
