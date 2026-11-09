"""Generate a short native Chinese dialogue with the installed local H3 model."""
from pathlib import Path
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from PIL import Image
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = Path('C:/Users/90302/MiniMax-H3')
ASSETS = ROOT / 'assets/video/furniture-tryout-20261109-v1'
OUT = ASSETS / 'h3-dialogue-test-v1'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:8196'
STATUS = OUT / 'status.json'


def request(route, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(BASE + route, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode('utf-8', errors='replace')) from error


def save(value):
    STATUS.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(value, ensure_ascii=False), flush=True)


def keyframe():
    # A video-compositing keyframe, preserving the two approved source cutouts.
    result = Image.new('RGBA', (864, 480), (246, 242, 232, 255))
    for name, left, maximum_width in [('character-a-half-3d.png', 38, 382), ('character-b-half-3d.png', 490, 300)]:
        actor = Image.open(ASSETS / name).convert('RGBA')
        actor = actor.crop(actor.getchannel('A').point(lambda x: 255 if x > 20 else 0).getbbox())
        scale = min(maximum_width / actor.width, 430 / actor.height)
        actor = actor.resize((round(actor.width * scale), round(actor.height * scale)), Image.Resampling.LANCZOS)
        result.alpha_composite(actor, (left, 467 - actor.height))
    path = OUT / 'keyframe.png'
    result.convert('RGB').save(path)
    return path


def upload(path):
    boundary = 'h3-' + uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="aholo-dialogue-keyframe-20261109.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
        + path.read_bytes()
        + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\nfalse\r\n--{boundary}--\r\n'.encode()
    )
    req = urllib.request.Request(BASE + '/upload/image', data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main():
    if STATUS.exists():
        previous = json.loads(STATUS.read_text(encoding='utf-8'))
        if previous.get('promptId'):
            raise RuntimeError('This test has already been submitted; inspect status/history before retrying.')
    queue = request('/queue')
    if queue.get('queue_running') or queue.get('queue_pending'):
        raise RuntimeError('The existing H3 queue is busy; no test was submitted.')
    image = upload(keyframe())
    graph = json.loads((MODEL_ROOT / 'animation-api.json').read_text(encoding='utf-8'))
    prompt = '''A single continuous locked-off medium two-shot of the two warm softly sculpted adult characters in the first frame, against the same plain warm cream studio background. Keep their exact faces, orange and sage-green sweaters, body proportions and composition. The man on the left holds his smartphone and gestures very slightly toward the woman. The woman on the right looks at him thoughtfully, then smiles slightly. Gentle breathing and natural restrained eye movements. Waist-up framing, no camera movement, no new objects, no written text, no subtitles, no music.

Native synchronized Mandarin Chinese dialogue, two distinct natural adult voices, intimate conversational delivery rather than announcer reading. First the man on the LEFT says exactly, in a casual warm male voice: "我想买把这样的椅子，放窗边。" Then the woman on the RIGHT replies exactly, in a gentle curious female voice with a questioning ending: "单看挺好看，放咱家搭吗？" Only the currently speaking person's mouth moves in sync; the listener's mouth stays closed. Two clear turns, no overlap, no extra words, no translation. Quiet indoor room tone, clear dry speech, natural tiny pauses and breaths. Fit both short lines comfortably within the five-second shot.'''
    graph['5']['inputs'].update(prompt=prompt, width=864, height=480, length=124, first_frame=['16', 0])
    graph['16'] = {'class_type': 'LoadImage', 'inputs': {'image': image['name']}}
    graph['8']['inputs']['noise_seed'] = 2026110901
    graph['15']['inputs']['filename_prefix'] = 'aholo-dialogue-20261109/h3-native-dialogue-test'
    (OUT / 'prompt.txt').write_text(prompt, encoding='utf-8')
    (OUT / 'workflow-api.json').write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding='utf-8')
    result = request('/prompt', {'prompt': graph, 'client_id': 'aholo-local-h3-dialogue-test'})
    prompt_id = result['prompt_id']
    started = time.monotonic()
    save({'stage': 'generating', 'promptId': prompt_id, 'cloudApiUsed': False})
    while time.monotonic() - started < 1200:
        history = request('/history/' + prompt_id)
        if prompt_id not in history:
            time.sleep(5)
            continue
        job = history[prompt_id]
        (OUT / 'history.json').write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
        if job['status']['status_str'] != 'success':
            save({'stage': 'failed', 'promptId': prompt_id, 'status': job['status']})
            raise RuntimeError('Local H3 test failed; inspect history.json')
        video = job['outputs']['15']['images'][0]
        query = urllib.parse.urlencode({k: video[k] for k in ['filename', 'subfolder', 'type']})
        with urllib.request.urlopen(BASE + '/view?' + query, timeout=60) as response:
            (OUT / 'h3-native-dialogue.mp4').write_bytes(response.read())
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(OUT / 'h3-native-dialogue.mp4'), '-vn', '-acodec', 'pcm_s16le', str(OUT / 'h3-native-dialogue.wav')], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(OUT / 'h3-native-dialogue.mp4'), '-vf', 'fps=1,scale=432:240,tile=3x2', '-frames:v', '1', '-update', '1', str(OUT / 'contact-sheet.jpg')], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        save({'stage': 'completed', 'promptId': prompt_id, 'elapsedSeconds': round(time.monotonic() - started, 1), 'cloudApiUsed': False, 'video': str(OUT / 'h3-native-dialogue.mp4'), 'audio': str(OUT / 'h3-native-dialogue.wav')})
        return
    save({'stage': 'still-running', 'promptId': prompt_id, 'elapsedSeconds': round(time.monotonic() - started, 1)})
    raise TimeoutError('Test exceeded the wait deadline; retain its prompt ID and inspect before resubmitting.')


if __name__ == '__main__':
    main()
