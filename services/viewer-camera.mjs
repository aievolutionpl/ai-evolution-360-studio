import { readFileSync } from 'node:fs';

// COLMAP images.bin stores world-to-camera quaternion + translation.
// SplatTransform imports PLY with Rz(180), then applies Rx(-90).
// Viewer decodes SOG in that convention. Combined: (x,y,z)->(-x,z,y).
export function recordedCameras(path, transform) {
    const b=readFileSync(path); let offset=0;
    const u64=()=>{const n=Number(b.readBigUInt64LE(offset));offset+=8;return n;};
    const f64=()=>{const n=b.readDoubleLE(offset);offset+=8;return n;};
    const count=u64(), result=[];
    if(!Number.isSafeInteger(count)||count>1000000)throw new Error('Invalid COLMAP camera count');
    const t=transform?.train_from_world;
    const map=v=>{const m=t?.rotation?.matrix_3x3||[[1,0,0],[0,1,0],[0,0,1]];const a=m.map((row,i)=>row.reduce((s,x,j)=>s+x*v[j],0)*(t?.scale??1)+(t?.translation?.[i]??0));return [-a[0],a[2],a[1]];};
    for(let i=0;i<count;i++){
        offset+=4;const [w,x,y,z]=[f64(),f64(),f64(),f64()];const tr=[f64(),f64(),f64()];offset+=4;
        const end=b.indexOf(0,offset);if(end<0)throw new Error('Invalid COLMAP image name');const name=b.toString('utf8',offset,end);offset=end+1;
        const n=u64();offset+=n*24;if(offset>b.length)throw new Error('Truncated COLMAP images');
        const R=[[1-2*y*y-2*z*z,2*x*y-2*w*z,2*x*z+2*w*y],[2*x*y+2*w*z,1-2*x*x-2*z*z,2*y*z-2*w*x],[2*x*z-2*w*y,2*y*z+2*w*x,1-2*x*x-2*y*y]];
        const center=[0,1,2].map(j=>-R.reduce((s,row,k)=>s+row[j]*tr[k],0));
        const target=center.map((v,j)=>v+R[2][j]);
        const position=map(center),lookAt=map(target);
        // A raw fisheye optical axis may point down; start level with the room.
        if(name.startsWith('cam')){const dx=lookAt[0]-position[0],dz=lookAt[2]-position[2],length=Math.hypot(dx,dz);if(length>.01){lookAt[0]=position[0]+dx/length;lookAt[1]=position[1];lookAt[2]=position[2]+dz/length;}}
        if(![...position,...lookAt].every(Number.isFinite))throw new Error('Non-finite camera pose');
        result.push({name,initial:{position,target:lookAt,fov:75}});
    }
    return result.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
}

export function cameraSettings(settings, imagesPath, transformPath) {
    const cameras=recordedCameras(imagesPath,JSON.parse(readFileSync(transformPath,'utf8')));
    if(!cameras.length)throw new Error('No recorded camera positions');
    // Avoid the first/last capture, where the operator is often starting/stopping.
    const lens=cameras.filter(c=>c.name.startsWith('cam0/'));
    const sequence=lens.length?lens:cameras;
    const index=0;
    const start=structuredClone(sequence[index]);
    const ahead=sequence[Math.min(sequence.length-1,index+Math.max(1,Math.floor(sequence.length*.09)))];
    if(lens.length){const p=start.initial.position,q=ahead.initial.position;if(Math.hypot(q[0]-p[0],q[2]-p[2])>.05)start.initial.target=[q[0],p[1],q[2]];}
    settings.cameras=[{initial:start.initial}];
    settings.annotations=[];
    const stride=Math.max(1,Math.floor(sequence.length/12));
    for(let i=0;i<sequence.length;i+=stride){
        const pose=structuredClone(sequence[i].initial);
        const next=sequence[Math.min(sequence.length-1,i+stride)].initial.position;
        if(lens.length&&Math.hypot(next[0]-pose.position[0],next[2]-pose.position[2])>.05)pose.target=[next[0],pose.position[1],next[2]];
        settings.annotations.push({position:pose.position,title:`Punkt ${settings.annotations.length/2+1}`,text:'Pozycja z nagrania',camera:{initial:pose}});
        const reverse=structuredClone(pose);reverse.target=pose.position.map((v,j)=>2*v-pose.target[j]);
        settings.annotations.push({position:pose.position,title:'Widok wstecz',text:'Pozycja z nagrania',camera:{initial:reverse}});
    }
    settings.cameras=[settings.annotations[Math.min(2,settings.annotations.length-1)].camera];
    settings.startMode='default';
    return settings;
}
