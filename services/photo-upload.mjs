import {createWriteStream,existsSync,mkdirSync,renameSync,statSync,copyFileSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {run} from './spirula-runner/index.mjs';
export const PHOTO_LIMIT=100*1024**2;
export function validatePhotoInfo(info){
 const v=info.streams?.find(s=>s.codec_type==='video');
 if(!v||!Number.isInteger(v.width)||!Number.isInteger(v.height)||v.width<512||v.height<256||v.width*v.height>100000000)throw new Error('Zdjęcie musi mieć od 512 × 256 do 100 megapikseli.');
 if(Math.abs(v.width/v.height-2)>.01)throw new Error('Wymagana pełna panorama 360° 2:1. Wyeksportuj zszyte JPG/PNG z Insta360 Studio; INSP i dwa koła fisheye nie są panoramą.');
 if(!['mjpeg','png'].includes(v.codec_name))throw new Error('Wymagany nieruchomy JPG lub PNG.');
 if(v.nb_frames&&Number(v.nb_frames)>1)throw new Error('Dodaj nieruchome zdjęcie, nie animację.');
 return {width:v.width,height:v.height};
}
export async function receivePhoto(req,project,store,name){
 if(project.kind!=='photos'||project.state!=='uploading'||project.photos.length>=project.expectedPhotos)throw new Error('Ta sesja dodawania zdjęć jest zamknięta.');
 const extension=extname(name).toLowerCase();if(!['.jpg','.jpeg','.png'].includes(extension))throw new Error('Dodaj JPG lub PNG 360° wyeksportowane z Insta360 Studio.');
 const size=Number(req.headers['content-length']);if(!Number.isSafeInteger(size)||size<1||size>PHOTO_LIMIT)throw new Error('Limit jednego zdjęcia wynosi 100 MB.');
 if(project.photos.reduce((s,p)=>s+p.bytes,0)+size>5*1024**3)throw new Error('Limit zestawu wynosi 5 GB.');
 const id=String(project.photos.length).padStart(4,'0'),folder=join(store.path(project.id),'source','photos');mkdirSync(folder,{recursive:true});
 const original=join(folder,id+extension);let received=0;
 await pipeline(req,new Transform({transform(chunk,encoding,cb){received+=chunk.length;cb(received>size?new Error('Przekroczono rozmiar zdjęcia.'):null,chunk);}}),createWriteStream(original+'.part',{flags:'w'}));
 if(received!==size)throw new Error('Niepełne przesłanie zdjęcia.');
 const info=validatePhotoInfo(JSON.parse(await run('ffprobe',['-v','error','-show_streams','-of','json',original+'.part'],{timeout:30000})));
 renameSync(original+'.part',original);const preview=join(folder,id+'-preview.jpg');
 await run('ffmpeg',['-v','error','-i',original,'-frames:v','1','-vf',`scale=${Math.min(4096,info.width)}:-2`,'-q:v','2','-y',preview],{timeout:60000});
 if(!existsSync(preview)||statSync(preview).size<100)throw new Error('Nie udało się odczytać zdjęcia.');
 if(store.get(project.id).state!=='uploading')throw new Error('Dodawanie zdjęć zostało anulowane.');
 project.photos.push({name:basename(name).slice(0,140),file:id+extension,preview:id+'-preview.jpg',bytes:size,...info});
 if(project.photos.length===1)copyFileSync(preview,join(store.path(project.id),'source','poster.jpg'));store.save(project);return project;
}
