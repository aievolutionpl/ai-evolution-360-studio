import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePhotoInfo} from '../services/photo-upload.mjs';
const info=(changes={})=>({streams:[{codec_type:'video',codec_name:'mjpeg',width:7680,height:3840,...changes}]});
test('accepts stitched JPEG and PNG panoramas',()=>{assert.deepEqual(validatePhotoInfo(info()),{width:7680,height:3840});assert.equal(validatePhotoInfo(info({codec_name:'png'})).width,7680);});
test('rejects non-panoramic, tiny and excessive images',()=>{for(const dimensions of [{width:1920,height:1080},{width:200,height:100},{width:20000,height:10000}])assert.throws(()=>validatePhotoInfo(info(dimensions)));});
test('rejects video disguised as photo and animated input',()=>{assert.throws(()=>validatePhotoInfo(info({codec_name:'h264'})));assert.throws(()=>validatePhotoInfo(info({nb_frames:'2'})));assert.throws(()=>validatePhotoInfo({streams:[]}));});

test('accepts dual-lens INSP dimensions but rejects non-JPEG INSP',()=>{assert.deepEqual(validatePhotoInfo(info({width:11904,height:5952}),'.insp'),{width:11904,height:5952});assert.throws(()=>validatePhotoInfo(info({codec_name:'png'}),'.insp'));assert.throws(()=>validatePhotoInfo(info({width:5952,height:5952}),'.insp'));});
