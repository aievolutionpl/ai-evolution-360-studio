"""Exercise Spirula's native video encoder and decoder on synthetic frames."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
exe = root / 'toolchain/spirula/spirula.exe'
dataset = root / 'workspace/synthetic-smoke'
logdir = root / 'docs/verification'
with (dataset/'video.rgb').open('rb') as raw, (logdir/'encode-smoke.log').open('wb') as log:
    subprocess.run([str(exe), 'encode', '--size', '128x128', '--fps', '4', '--codec', 'h264', '-o', str(dataset/'test.mp4')], stdin=raw, stdout=log, stderr=subprocess.STDOUT, check=True)
for name, args in [
    ('video-info', ['sam','video','--info',str(dataset/'test.mp4')]),
    ('video-extract', ['sam','extract',str(dataset/'test.mp4'),'--skip','2','--max-frames','6','-o',str(dataset/'extracted')]),
]:
    with (logdir/f'{name}.log').open('wb') as log:
        subprocess.run([str(exe), *args], stdout=log, stderr=subprocess.STDOUT, check=True)
print('Synthetic MP4 encode/probe/extract succeeded. Not an Insta360 test.')
