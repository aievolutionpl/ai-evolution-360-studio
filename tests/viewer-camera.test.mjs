import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordedCameras,cameraSettings} from '../services/viewer-camera.mjs';

test('COLMAP position follows export rotation and viewer rotation, not model bounds',()=>{
    const dir=mkdtempSync(join(tmpdir(),'camera-test-'));
    try {
        const b=Buffer.alloc(8+4+32+24+4+8+8);let o=0;
        b.writeBigUInt64LE(1n,o);o+=8;b.writeUInt32LE(1,o);o+=4;
        for(const v of [1,0,0,0,-2,-3,-4]){b.writeDoubleLE(v,o);o+=8;}
        b.writeUInt32LE(1,o);o+=4;b.write('one.jpg',o);o+=8;b.writeBigUInt64LE(0n,o);
        const path=join(dir,'images.bin');writeFileSync(path,b);
        const camera=recordedCameras(path)[0];
        assert.deepEqual(camera.initial.position,[-2,4,3]);
        assert.deepEqual(camera.initial.target,[-2,5,3]);
        const transform=join(dir,'transform.json');writeFileSync(transform,'{}');
        const settings=cameraSettings({cameras:[]},path,transform);
        assert.equal(settings.startMode,'default');assert.equal(settings.cameras.length,1);
        writeFileSync(path,b.subarray(0,20));assert.throws(()=>recordedCameras(path));
    }finally{rmSync(dir,{recursive:true,force:true});}
});
