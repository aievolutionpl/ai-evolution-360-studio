import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, basename, sep } from 'node:path';
export const json = (res, data, status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export function asset(res, req, path, download=false) {
    if (!existsSync(path) || !statSync(path).isFile()) {res.writeHead(404);return res.end('Nie znaleziono pliku.');}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.sog':'application/octet-stream','.ply':'application/octet-stream','.jpeg':'image/jpeg','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.mov':'video/quicktime','.txt':'text/plain; charset=utf-8','.log':'text/plain; charset=utf-8'};
    const size=statSync(path).size;
    const headers={'Content-Type':mime[extname(path)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    if(download) headers['Content-Disposition']=`attachment; filename="${basename(path).replace(/[^a-zA-Z0-9._-]/g,'_')}"`;
    let start=0,end=size-1,status=200;
    if(req.headers.range){const m=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!m){res.writeHead(416);return res.end();}start=+m[1];end=m[2]?Math.min(+m[2],size-1):size-1;if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;}
    headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);
    if(req.method==='HEAD'||size===0)return res.end();
    const stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);
}
export function safePath(base, path){const p=resolve(base,path);if(!p.startsWith(resolve(base)+sep))throw new Error('Niedozwolona ścieżka.');return p;}
export async function body(req, limit = 10000) {
    const chunks = []; let size = 0;
    for await (const chunk of req.iterator ? req.iterator({ destroyOnReturn: false }) : req) {
        size += chunk.length;
        if (size > limit) { req.resume?.(); const error = new Error('Zbyt duże żądanie.'); error.status = 413; throw error; }
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw new Error('Nieprawidłowy JSON żądania.'); }
}
