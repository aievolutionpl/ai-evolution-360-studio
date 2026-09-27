"""Small synthetic sphere with known poses. Tests training, NOT reconstruction."""
import json
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'workspace' / 'synthetic-smoke'
ROOT.mkdir(parents=True, exist_ok=True)
(ROOT / 'images').mkdir(exist_ok=True)

def dot(a, b):
    return sum(x*y for x, y in zip(a, b))

def norm(a):
    d = math.sqrt(dot(a, a))
    return [v/d for v in a]

def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

def color(p):
    return [int(40 + 185*(v+1)/2) for v in p]

def png(path, data, size):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind+payload))
    raw = b''.join(b'\x00'+data[y*size*3:(y+1)*size*3] for y in range(size))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

size = 128
frames = []
video = bytearray()
for i in range(12):
    angle = i*2*math.pi/12
    eye = [3*math.cos(angle), 0.7, 3*math.sin(angle)]
    back = norm(eye)
    right = norm(cross([0,1,0], back))
    up = cross(back, right)
    pixels = bytearray()
    for y in range(size):
        for x in range(size):
            direction = norm([right[j]*(x+0.5-64)/120 - up[j]*(y+0.5-64)/120-back[j] for j in range(3)])
            b = dot(eye, direction)
            disc = b*b-dot(eye,eye)+1
            rgb = [0,0,0]
            if disc > 0:
                distance = -b-math.sqrt(disc)
                rgb = color([eye[j]+distance*direction[j] for j in range(3)])
            pixels.extend(rgb)
    filename = f'images/{i:05d}.png'
    png(ROOT / filename, pixels, size)
    video.extend(pixels)
    frames.append({'file_path': filename, 'transform_matrix': [[right[j],up[j],back[j],eye[j]] for j in range(3)] + [[0,0,0,1]]})
points = []
for i in range(4096):
    y = 1-2*(i+0.5)/4096
    radius = math.sqrt(1-y*y)
    a = i*math.pi*(3-math.sqrt(5))
    p = [radius*math.cos(a),y,radius*math.sin(a)]
    points.append(' '.join(map(str, p+color(p))))
header = 'ply\nformat ascii 1.0\nelement vertex 4096\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'
(ROOT/'sparse_pc.ply').write_text(header+'\n'.join(points), encoding='utf-8')
(ROOT/'transforms.json').write_text(json.dumps({'camera_model':'PINHOLE','w':size,'h':size,'fl_x':120,'fl_y':120,'cx':64,'cy':64,'ply_file_path':'sparse_pc.ply','frames':frames}), encoding='utf-8')
(ROOT/'README.txt').write_text('SYNTHETIC COMPONENT TEST. Known cameras; no Insta360 input and no SfM validation.\n', encoding='utf-8')
(ROOT/'video.rgb').write_bytes(video)
print(ROOT)
