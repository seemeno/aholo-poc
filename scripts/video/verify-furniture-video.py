from pathlib import Path
import json
import re
import subprocess
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/video/furniture-tryout-20261109-v1/film-vertical-v1'
VIDEO = OUT / 'furniture-try-before-buy-30s-vertical.mp4'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
metadata = subprocess.run([FFMPEG, '-hide_banner', '-i', str(VIDEO)], capture_output=True, text=True, encoding='utf-8', errors='replace', creationflags=subprocess.CREATE_NO_WINDOW).stderr
decoded = subprocess.run([FFMPEG, '-v', 'error', '-i', str(VIDEO), '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-', '-progress', 'pipe:1'], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
if decoded.returncode:
    raise RuntimeError(decoded.stderr)
frames = [int(x) for x in re.findall(r'^frame=(\d+)$', decoded.stdout, re.MULTILINE)]
checks = {
    'duration30Seconds': 'Duration: 00:00:30.00' in metadata,
    'vertical1080x1920': '1080x1920' in metadata,
    'frameRate30': '30 fps' in metadata,
    'h264Video': 'Video: h264' in metadata,
    'aacStereoAudio': 'Audio: aac' in metadata and '48000 Hz, stereo' in metadata,
    'frames900': bool(frames) and frames[-1] == 900,
    'fullDecodeSucceeded': decoded.returncode == 0,
}
if not all(checks.values()):
    raise RuntimeError(json.dumps(checks) + '\n' + metadata)
report = {
    'video': VIDEO.name,
    'bytes': VIDEO.stat().st_size,
    'durationSeconds': 30,
    'width': 1080,
    'height': 1920,
    'fps': 30,
    'frames': frames[-1],
    'checks': checks,
    'production': {
        'characterStyle': 'Warm stylized 3D half-body avatars, transparent source PNGs',
        'characterImages': 'Generated with the built-in image_gen.imagegen tool',
        'speech': 'Local Chinese Kangkang and Yaoyao voices; 13 timed dialogue lines',
        'music': 'Original quietly mixed synthesized plucked-key accompaniment',
        'upload': 'Actual app photo-upload section captures, isolated local server',
        'placement': 'Illustrative animation of a chair cutout, labeled in the video',
        'finalRoom': 'AI-generated illustrative furnishing references, labeled in the video',
        'cloudGenerationSubmitted': False,
    },
}
(OUT / 'validation-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
# Inspect frames extracted from the encoded video, including every story section.
subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(VIDEO), '-vf', "select='eq(n,30)+eq(n,340)+eq(n,430)+eq(n,560)+eq(n,740)+eq(n,860)',scale=360:640,tile=3x2", '-frames:v', '1', '-update', '1', str(OUT / 'encoded-contact-sheet.jpg')], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
print(json.dumps(report, ensure_ascii=False, indent=2))
