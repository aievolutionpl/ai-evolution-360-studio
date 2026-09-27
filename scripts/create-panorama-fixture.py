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

width,height=1536,768
yy,xx=np.mgrid[:height,:width]
lon=((xx+.5)/width-.5)*2*np.pi;lat=(.5-(yy+.5)/height)*np.pi
planes=[(2,-2,0,(-3,3),(0,3)),(0,-3,1,(-2,5),(0,3)),(0,3,2,(-2,5),(0,3)),(1,0,3,(-3,3),(-2,5)),(1,3,4,(-3,3),(-2,5)),(2,0,5,(-.8,.7),(0,1.2)),(1,1.2,6,(-.8,.7),(-.6,0)),(0,.7,6,(-.6,0),(0,1.2))]
planes.append((2,5,2,(-3,3),(0,3)))
out=out/'panoramas';out.mkdir(exist_ok=True)
for i in range(12):
    a=i/11
    eye=np.array([-1.2+2.4*a,1.5+.12*math.sin(a*math.pi),2.8-.5*math.sin(a*math.pi)])
    rays=np.stack([np.sin(lon)*np.cos(lat),np.sin(lat),-np.cos(lon)*np.cos(lat)],axis=-1)
    depth=np.full((height,width),np.inf);image=np.zeros((height,width,3),dtype=np.uint8)
    for axis,pos,tex,bound1,bound2 in planes:
        axes=([0,1] if axis==2 else [2,1] if axis==0 else [0,2])
        with np.errstate(divide='ignore',invalid='ignore'):
            t=(pos-eye[axis])/rays[:,:,axis]
        hit=eye+rays*t[:,:,None];u,v=hit[:,:,axes[0]],hit[:,:,axes[1]]
        mask=(t>0)&(t<depth)&(u>=bound1[0])&(u<=bound1[1])&(v>=bound2[0])&(v<=bound2[1])
        ix=np.clip(((u-bound1[0])/(bound1[1]-bound1[0])*1023).astype(int),0,1023);iy=np.clip(((v-bound2[0])/(bound2[1]-bound2[0])*1023).astype(int),0,1023)
        image[mask]=textures[tex][iy[mask],ix[mask]];depth[mask]=t[mask]
    Image.fromarray(image).save(out/f'panorama-{i:02}.jpg',quality=95)
print(out)
