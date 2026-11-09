"""Render the approved 30-second furniture film from reusable image/audio layers.

Source PNGs remain unchanged. This script performs video compositing, typography,
animation, original background-music synthesis and H.264/AAC encoding.
"""
from pathlib import Path
import argparse
import json
import math
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets/video/furniture-tryout-20261109-v1'
WORK = ROOT / 'tmp/furniture-video-v1'
OUT = ASSETS / 'film-v1'
OUT.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)
W, H, FPS, DURATION, SR = 1920, 1080, 30, 30, 48000
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
LINES = json.loads((ASSETS / 'dialogue-30s.json').read_text(encoding='utf-8'))
FONT = 'C:/Windows/Fonts/msyh.ttc'
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONTS = {}
INK = (43, 51, 44)
SAGE = (85, 111, 88)
ORANGE = (204, 118, 67)


def font(size, bold=False):
    key = (size, bold)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(FONT_BOLD if bold else FONT, size)
    return FONTS[key]


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def load(name):
    return Image.open(ASSETS / name).convert('RGBA')


def fit(image, width, height, crop=False):
    if crop:
        return ImageOps.fit(image, (int(width), int(height)), Image.Resampling.LANCZOS)
    ratio = min(width / image.width, height / image.height)
    return image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.Resampling.LANCZOS)


def cropped_subject(name):
    image = load(name)
    return image.crop(image.getchannel('A').point(lambda x: 255 if x > 20 else 0).getbbox())


ROOM_BEFORE = fit(load('02-room-before.png'), W, H, True)
ROOM_WHITE = fit(load('05-room-white.png'), W, H, True)
ROOM_RATTAN = fit(load('06-room-rattan.png'), W, H, True)
CHAIR_WHITE = cropped_subject('03-chair-white.png')
CHAIR_RATTAN = cropped_subject('04-chair-rattan.png')
ACTORS = {
    'A': fit(cropped_subject('character-a-v2.png'), 270, 345),
    'B': fit(cropped_subject('character-b.png'), 250, 345),
}
BLURRED = ROOM_BEFORE.filter(ImageFilter.GaussianBlur(26))
UPLOADER = {}
for key in ('room', 'chair'):
    capture_path = WORK / 'capture' / f'upload-{key}-section.png'
    if capture_path.exists():
        UPLOADER[key] = Image.open(capture_path).convert('RGBA')


def text(layer, xy, value, size, fill=INK, bold=False, anchor=None):
    ImageDraw.Draw(layer).text(xy, value, font=font(size, bold), fill=fill, anchor=anchor)


def rounded(layer, box, fill, radius=24, outline=None, width=1):
    ImageDraw.Draw(layer).rounded_rectangle(tuple(round(v) for v in box), radius, fill=fill, outline=outline, width=width)


def paste(base, image, xy, opacity=1.0):
    if opacity < .999:
        image = image.copy()
        image.putalpha(image.getchannel('A').point(lambda a: round(a * max(0, opacity))))
    base.alpha_composite(image, (round(xy[0]), round(xy[1])))


def shadow(base, box, radius=24, opacity=28, blur=18):
    layer = Image.new('RGBA', (W, H))
    rounded(layer, box, (30, 37, 30, opacity), radius)
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def product_card(chair, label, width=310, height=350):
    image = Image.new('RGBA', (width, height))
    rounded(image, (0, 0, width - 1, height - 1), (255, 255, 252, 250), 28, (229, 229, 218, 255), 1)
    subject = fit(chair, width - 42, height - 86)
    image.alpha_composite(subject, ((width - subject.width) // 2, 20 + (height - 90 - subject.height) // 2))
    text(image, (width / 2, height - 39), label, 25, INK, True, 'mm')
    return image


WHITE_CARD = product_card(CHAIR_WHITE, '白色布艺沙发椅')
RATTAN_CARD = product_card(CHAIR_RATTAN, '藤编椅＋软垫')
PLACED_CHAIR = fit(CHAIR_WHITE, 435, 435)


def room_pan(room, t, scale_amount=.016):
    scale = 1 + scale_amount * ease(t)
    sw, sh = round(W * scale), round(H * scale)
    enlarged = room.resize((sw, sh), Image.Resampling.BICUBIC)
    left = (sw - W) // 2
    top = (sh - H) // 2
    return enlarged.crop((left, top, left + W, top + H))


def top_wash(base, alpha=195):
    gradient = Image.new('RGBA', (1, 310))
    gradient.putdata([(249, 247, 240, round(alpha * (1 - i / 310) ** 1.6)) for i in range(310)])
    base.alpha_composite(gradient.resize((W, 310)))


def brand(base, dark=False):
    layer = Image.new('RGBA', (W, H))
    color = INK if dark else (66, 78, 65)
    d = ImageDraw.Draw(layer)
    cx, cy = 1682, 67
    d.line([(cx, cy - 12), (cx + 12, cy), (cx, cy + 12), (cx - 12, cy), (cx, cy - 12)], fill=color, width=3)
    text(layer, (1710, 48), '空间工坊', 27, color, True)
    base.alpha_composite(layer)


def step_header(base, number, heading, secondary=None):
    layer = Image.new('RGBA', (W, H))
    rounded(layer, (70, 47, 122, 99), (*SAGE, 245), 26)
    text(layer, (96, 72), str(number), 25, (255, 255, 250), True, 'mm')
    text(layer, (141, 48), heading, 34, INK, True)
    if secondary:
        text(layer, (143, 97), secondary, 23, (96, 104, 94))
    base.alpha_composite(layer)


def small_tag(base, label, x=1480, y=142):
    layer = Image.new('RGBA', (W, H))
    length = ImageDraw.Draw(layer).textlength(label, font=font(22))
    rounded(layer, (x, y, x + length + 34, y + 42), (255, 255, 250, 220), 21)
    text(layer, (x + 17, y + 7), label, 22, (88, 95, 86))
    base.alpha_composite(layer)


def cursor(base, x, y, pressed=False):
    layer = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(layer)
    if pressed:
        d.ellipse((x - 25, y - 25, x + 25, y + 25), fill=(*SAGE, 30), outline=(*SAGE, 120), width=2)
    points = [(x, y), (x + 4, y + 34), (x + 12, y + 25), (x + 21, y + 42), (x + 29, y + 38), (x + 20, y + 21), (x + 33, y + 20)]
    d.polygon(points, fill=(255, 255, 255, 255), outline=INK, width=2)
    base.alpha_composite(layer)


def active_line(t):
    return next((line for line in LINES if line['start'] <= t < line['end']), None)


def actors_and_caption(base, t, scale=1.0):
    current = active_line(t)
    for speaker, x in [('A', 65), ('B', 1633)]:
        actor = ACTORS[speaker]
        active = current and current['speaker'] == speaker
        dy = -6 * abs(math.sin((t - current['start']) * 6)) if active else 0
        entrance = ease(t / .45)
        if scale != 1:
            actor = fit(actor, actor.width * scale, actor.height * scale)
            x += 30 if speaker == 'A' else 25
        paste(base, actor, (x, 1030 - actor.height + dy + 40 * (1 - entrance)), entrance * (1 if active else .94))
    if current:
        layer = Image.new('RGBA', (W, H))
        phrase = current['text']
        fs = 39
        tw = ImageDraw.Draw(layer).textlength(phrase, font=font(fs, True))
        bw = max(620, tw + 110)
        left = (W - bw) / 2
        rounded(layer, (left, 936, left + bw, 1023), (255, 255, 251, 245), 26)
        color = ORANGE if current['speaker'] == 'A' else SAGE
        ImageDraw.Draw(layer).ellipse((left + 26, 973, left + 39, 986), fill=color)
        text(layer, (left + 60, 954), phrase, fs, INK, True)
        base.alpha_composite(layer)


def opening(t):
    base = room_pan(ROOM_BEFORE, t / 10, .012)
    top_wash(base, 155)
    for i, card in enumerate((WHITE_CARD, RATTAN_CARD)):
        p = ease((t - i * .16) / .65)
        x, y = 90 + i * 335, 164 + 32 * (1 - p)
        shadow(base, (x + 4, y + 10, x + card.width + 4, y + card.height + 10), opacity=round(24 * p))
        paste(base, card, (x, y), p)
    layer = Image.new('RGBA', (W, H))
    text(layer, (898, 176), '衣服都可以试穿，', 55, INK, True)
    text(layer, (898, 255), '家具为什么不能试摆', 58, SAGE, True)
    rounded(layer, (902, 351, 1082, 356), (*SAGE, 160), 2)
    base.alpha_composite(layer)
    brand(base)
    actors_and_caption(base, t)
    return base


def uploading(t):
    local = t - 10
    base = Image.blend(BLURRED, Image.new('RGBA', (W, H), (247, 246, 239, 255)), .78)
    step_header(base, '1–2', '创建场景 · 生成家具／装饰', '一张房间照片，再加一张物品照片')
    brand(base)
    key = 'room' if local < 3 else 'chair'
    if key in UPLOADER:
        capture = ImageOps.expand(UPLOADER[key], border=20, fill=(247, 248, 241, 255))
        capture = fit(capture, 1270, 700)
        mask = Image.new('L', capture.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, capture.width - 1, capture.height - 1), 22, fill=255)
        capture.putalpha(mask)
        x, y = (W - capture.width) // 2, 173 + (700 - capture.height) // 2
        shadow(base, (x + 3, y + 15, x + capture.width + 3, y + capture.height + 15), opacity=27)
        paste(base, capture, (x, y))
        small_tag(base, '真实上传页面', x=1340, y=108)
    else:
        # A source-material explanation, never presented as a captured app UI.
        room_card = fit(ROOM_BEFORE, 870, 490)
        rounded(base, (300, 235, 1210, 800), (255, 255, 252, 255), 28)
        paste(base, room_card, (320, 258))
        text(base, (740, 755), '房间照片', 29, INK, True, 'mm')
        paste(base, WHITE_CARD, (1280, 310))
        small_tag(base, '流程示意', x=1480, y=115)
    # This progress indicator explains the two uploaded inputs, not generation time.
    layer = Image.new('RGBA', (W, H))
    for i, label in enumerate(['房间照片', '椅子图片']):
        checked = local > (.8 if i == 0 else 3.8)
        x = 710 + i * 300
        rounded(layer, (x, 858, x + 242, 904), (236, 240, 228, 245), 23)
        draw = ImageDraw.Draw(layer)
        draw.ellipse((x + 17, 872, x + 36, 891), outline=SAGE, width=2)
        if checked:
            draw.line([(x + 21, 881), (x + 26, 886), (x + 33, 877)], fill=SAGE, width=3)
        text(layer, (x + 47, 865), label, 24, SAGE, True)
    base.alpha_composite(layer)
    actors_and_caption(base, t, .9)
    return base


def placing(t):
    local = t - 16
    base = ROOM_BEFORE.copy()
    p = ease((local - .35) / 2.1)
    x, y = 620 - 360 * p, 400 - 10 * p
    chair = PLACED_CHAIR
    sh = Image.new('RGBA', (W, H))
    ImageDraw.Draw(sh).ellipse((x + 35, y + chair.height - 36, x + chair.width - 20, y + chair.height + 2), fill=(55, 42, 23, 48))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
    paste(base, chair, (x, y))
    # A restrained selection indicator communicates the motion illustration.
    selection = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(selection)
    pad, segment = 17, 28
    l, r, top, bottom = x - pad, x + chair.width + pad, y - pad, y + chair.height + pad
    for cx, cy, dx, dy in [(l, top, 1, 1), (r, top, -1, 1), (l, bottom, 1, -1), (r, bottom, -1, -1)]:
        d.line([(cx, cy + dy * segment), (cx, cy), (cx + dx * segment, cy)], fill=(*SAGE, 185), width=3)
    paste(base, selection, (0, 0), 1 - ease((local - 3.9) / .5))
    if local < 3.5:
        cursor(base, x + chair.width * .74, y + chair.height * .65, .3 < local < 2.7)
    top_wash(base, 180)
    step_header(base, 3, '摆放物体', '挪一挪，找到合适的位置')
    small_tag(base, '试摆动画示意', x=1470, y=112)
    brand(base)
    actors_and_caption(base, t)
    return base


def rendered(t):
    local = t - 21
    blend = ease((local - 2.25) / .6)
    base = room_pan(Image.blend(ROOM_WHITE, ROOM_RATTAN, blend), local / 5, .014)
    top_wash(base, 175)
    step_header(base, 4, '渲染真实效果', '同一个房间，看看两种搭配')
    brand(base)
    label = '白色布艺沙发椅' if blend < .5 else '藤编椅＋软垫'
    small_tag(base, label, x=1445, y=138)
    small_tag(base, 'AI 搭配效果示意', x=1415, y=194)
    actors_and_caption(base, t, .82)
    return base


def ending(t):
    base = room_pan(ROOM_RATTAN, (t - 26) / 4, .014)
    layer = Image.new('RGBA', (W, H))
    rounded(layer, (75, 105, 1170, 345), (255, 255, 249, 235), 30)
    text(layer, (117, 143), '买之前，先放家里看看。', 62, INK, True)
    text(layer, (122, 254), '空间工坊  ·  试试你的第一个房间 →', 29, SAGE, True)
    base.alpha_composite(layer)
    brand(base)
    small_tag(base, 'AI 搭配效果示意', x=1460, y=140)
    actors_and_caption(base, t, .9)
    return base


SCENES = [(0, opening), (10, uploading), (16, placing), (21, rendered), (26, ending)]


def frame(t):
    index = max(i for i, (start, _) in enumerate(SCENES) if t >= start)
    result = SCENES[index][1](t)
    if index > 0 and t - SCENES[index][0] < .25:
        previous = SCENES[index - 1][1](SCENES[index][0] - .001)
        result = Image.blend(previous, result, ease((t - SCENES[index][0]) / .25))
    if t < .3:
        result = Image.blend(Image.new('RGBA', (W, H), (247, 245, 239, 255)), result, ease(t / .3))
    return result.convert('RGB')


def write_wav(path, samples):
    samples = np.asarray(np.clip(samples, -.999, .999) * 32767, dtype='<i2')
    with wave.open(str(path), 'wb') as output:
        output.setparams((1 if samples.ndim == 1 else samples.shape[1], 2, SR, len(samples), 'NONE', 'not compressed'))
        output.writeframes(samples.tobytes())


def make_audio():
    length = SR * DURATION
    voice_mix = np.zeros(length, dtype=np.float64)
    alignment = []
    for line in LINES:
        source = WORK / 'speech' / f'{line["id"]:02d}-{line["speaker"]}.wav'
        with wave.open(str(source), 'rb') as sound:
            sr, channels = sound.getframerate(), sound.getnchannels()
            samples = np.frombuffer(sound.readframes(sound.getnframes()), dtype='<i2').astype(np.float64) / 32768
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
        audible = np.where(np.abs(samples) > .006)[0]
        if len(audible):
            samples = samples[max(0, audible[0] - int(sr * .025)):min(len(samples), audible[-1] + int(sr * .055))]
        source_duration = len(samples) / sr
        slot = line['end'] - line['start']
        speed = max(1., source_duration / max(.1, slot - .035))
        raw_input = np.asarray(np.clip(samples, -.999, .999) * 32767, dtype='<i2').tobytes()
        converted = subprocess.run([FFMPEG, '-v', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', 'pipe:0', '-af', f'atempo={speed:.7f}', '-f', 'f32le', '-ar', str(SR), '-ac', '1', 'pipe:1'], input=raw_input, stdout=subprocess.PIPE, check=True, creationflags=subprocess.CREATE_NO_WINDOW).stdout
        clip = np.frombuffer(converted, dtype='<f4').astype(np.float64)
        clip = clip[:int(slot * SR)]
        peak = np.max(np.abs(clip)) if len(clip) else 1
        clip *= min(1.7, .77 / max(.01, peak))
        fade = min(int(.009 * SR), len(clip) // 3)
        clip[:fade] *= np.linspace(0, 1, fade)
        clip[-fade:] *= np.linspace(1, 0, fade)
        start = round(line['start'] * SR)
        voice_mix[start:start + len(clip)] += clip
        alignment.append({**line, 'voice': 'Kangkang' if line['speaker'] == 'A' else 'Yaoyao', 'spokenSeconds': round(len(clip) / SR, 3), 'speedAdjustment': round(speed, 3)})
    # Quiet original plucked-key accompaniment. No downloaded/licensed music.
    music = np.zeros(length, dtype=np.float64)
    chords = [(48, 52, 55, 59), (45, 48, 52, 55), (41, 45, 48, 52), (43, 47, 50, 55)]
    for beat in np.arange(0, DURATION, .75):
        chord = chords[int(beat // 6) % len(chords)]
        note = chord[int(round(beat / .75)) % 4] + 12
        freq = 440 * 2 ** ((note - 69) / 12)
        n = min(round(2.6 * SR), length - round(beat * SR))
        tt = np.arange(n) / SR
        envelope = (1 - np.exp(-tt * 70)) * np.exp(-tt * 2.1)
        tone = (np.sin(2 * np.pi * freq * tt) + .26 * np.sin(2 * np.pi * 2 * freq * tt) + .07 * np.sin(2 * np.pi * 3 * freq * tt)) * envelope * .026
        start = round(beat * SR)
        music[start:start + n] += tone
    for when in [10, 13, 16, 21, 23.5, 26]:
        n = int(.11 * SR)
        tt = np.arange(n) / SR
        tick = np.sin(2 * np.pi * (1100 * tt + 1700 * tt * tt)) * np.exp(-tt * 55) * .035
        start = round(when * SR)
        music[start:start + n] += tick
    edge = int(.7 * SR)
    music[:edge] *= np.linspace(0, 1, edge)
    music[-edge:] *= np.linspace(1, 0, edge)
    stereo = np.column_stack((voice_mix + music, voice_mix + np.roll(music, int(.012 * SR)) * .9))
    stereo *= min(1, .95 / max(.01, np.max(np.abs(stereo))))
    write_wav(WORK / 'mix.wav', stereo)
    write_wav(OUT / 'dialogue-only.wav', voice_mix)
    (OUT / 'audio-alignment.json').write_text(json.dumps(alignment, ensure_ascii=False, indent=2), encoding='utf-8')
    return WORK / 'mix.wav'


def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    return f'{milliseconds // 3600000:02d}:{milliseconds // 60000 % 60:02d}:{milliseconds // 1000 % 60:02d},{milliseconds % 1000:03d}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview-only', action='store_true')
    args = parser.parse_args()
    preview_times = [.9, 5.9, 11.4, 14.4, 18.6, 22.3, 24.6, 28.4]
    previews = []
    for i, t in enumerate(preview_times):
        picture = frame(t)
        picture.save(WORK / f'frame-{i:02d}.jpg', quality=94)
        thumbnail = fit(picture, 640, 360, True)
        previews.append(thumbnail)
    sheet = Image.new('RGB', (1280, 4 * 400), '#f6f4ec')
    for i, preview in enumerate(previews):
        x, y = i % 2 * 640, i // 2 * 400
        sheet.paste(preview, (x, y))
        text(sheet, (x + 15, y + 370), f'{preview_times[i]:04.1f}s', 22, INK, True)
    sheet.save(OUT / 'contact-sheet.jpg', quality=93)
    frame(.9).save(OUT / 'poster.jpg', quality=95)
    if args.preview_only:
        print(OUT / 'contact-sheet.jpg')
        return
    mix = make_audio()
    srt = '\n\n'.join(f'{i + 1}\n{timestamp(line["start"])} --> {timestamp(line["end"])}\n{line["text"]}' for i, line in enumerate(LINES)) + '\n'
    (OUT / 'subtitles.srt').write_text(srt, encoding='utf-8-sig')
    output = OUT / 'furniture-try-before-buy-30s.mp4'
    log = (WORK / 'encode.log').open('w', encoding='utf-8')
    command = [FFMPEG, '-hide_banner', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{W}x{H}', '-framerate', str(FPS), '-i', 'pipe:0', '-i', str(mix), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-t', str(DURATION), '-movflags', '+faststart', '-metadata', 'title=衣服都可以试穿，家具为什么不能试摆', '-metadata', 'comment=素材动画演示；上传页面为实际界面，试摆动画及AI搭配效果为示意。', str(output)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for i in range(FPS * DURATION):
            encoder.stdin.write(frame(i / FPS).tobytes())
            if i % (FPS * 3) == 0:
                print(f'Rendered {i // FPS:02d}/{DURATION}s', flush=True)
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError('Video encoder failed; inspect tmp/furniture-video-v1/encode.log')
    except Exception:
        encoder.kill()
        raise
    finally:
        log.close()
    print(output, flush=True)


if __name__ == '__main__':
    main()
