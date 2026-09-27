"""Synthetic textured room video for integration QA. Never label it as real capture."""
import math
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
out = root / 'workspace/qa-fixtures'
out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(726)
textures=[]
for base in [(133,151,172),(125,145,163),(147,157,167),(112,88,67),(190,186,171),(70,132,146),(162,107,65)]:
    im=Image.new('RGB',(1024,1024),base);draw=ImageDraw.Draw(im)
    for i in range(1400):
        x,y=rng.integers(0,1024,2);w,h=rng.integers(5,48,2);c=tuple(int(v) for v in rng.integers(30,235,3))
        draw.rectangle((int(x),int(y),int(x+w),int(y+h)),fill=c)
    textures.append(np.array(im))

width,height=640,400
yy,xx=np.mgrid[:height,:width]
cx=(xx+.5-width/2)/520;cy=-(yy+.5-height/2)/520
planes=[(2,-2,0,(-3,3),(0,3)),(0,-3,1,(-2,5),(0,3)),(0,3,2,(-2,5),(0,3)),(1,0,3,(-3,3),(-2,5)),(1,3,4,(-3,3),(-2,5)),(2,0,5,(-.8,.7),(0,1.2)),(1,1.2,6,(-.8,.7),(-.6,0)),(0,.7,6,(-.6,0),(0,1.2))]
proc=subprocess.Popen(['ffmpeg','-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{width}x{height}','-framerate','10','-i','-','-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-y',str(out/'synthetic-room.mp4')],stdin=subprocess.PIPE)
for i in range(48):
    a=i/47
    eye=np.array([-1.3+2.6*a,1.5+.12*math.sin(a*math.pi),3.5-.4*math.sin(a*math.pi)])
    forward=np.array([0,1.15,-1])-eye;forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,forward)
    rays=forward[None,None,:]+cx[:,:,None]*right+cy[:,:,None]*up
    depth=np.full((height,width),np.inf);image=np.zeros((height,width,3),dtype=np.uint8)
    for axis,pos,tex,bound1,bound2 in planes:
        axes=([0,1] if axis==2 else [2,1] if axis==0 else [0,2])
        with np.errstate(divide='ignore',invalid='ignore'):
            t=(pos-eye[axis])/rays[:,:,axis]
        hit=eye+rays*t[:,:,None];u,v=hit[:,:,axes[0]],hit[:,:,axes[1]]
        mask=(t>0)&(t<depth)&(u>=bound1[0])&(u<=bound1[1])&(v>=bound2[0])&(v<=bound2[1])
        ix=np.clip(((u-bound1[0])/(bound1[1]-bound1[0])*1023).astype(int),0,1023);iy=np.clip(((v-bound2[0])/(bound2[1]-bound2[0])*1023).astype(int),0,1023)
        image[mask]=textures[tex][iy[mask],ix[mask]];depth[mask]=t[mask]
    proc.stdin.write(image.tobytes())
proc.stdin.close()
if proc.wait()!=0:raise RuntimeError('FFmpeg failed')
print(out/'synthetic-room.mp4')
