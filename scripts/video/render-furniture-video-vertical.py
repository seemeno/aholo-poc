"""9:16 mobile composition of the approved 30-second film."""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageOps, ImageFilter

module_path = Path(__file__).with_name('render-furniture-video.py')
spec = importlib.util.spec_from_file_location('film_base', module_path)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

W, H, FPS, DURATION = 1080, 1920, 30, 30
ASSETS, WORK = b.ASSETS, b.WORK
OUT = ASSETS / 'film-vertical-v1'
OUT.mkdir(parents=True, exist_ok=True)
b.OUT = OUT
font, text, fit, paste, rounded, ease = b.font, b.text, b.fit, b.paste, b.rounded, b.ease
INK, SAGE, ORANGE = b.INK, b.SAGE, b.ORANGE


def subject(name):
    image = b.load(name)
    return image.crop(image.getchannel('A').point(lambda a: 255 if a > 20 else 0).getbbox())


ACTORS = {
    'A': fit(subject('character-a-half-3d.png'), 235, 252),
    'B': fit(subject('character-b-half-3d.png'), 220, 252),
}
WHITE_CARD = b.product_card(b.CHAIR_WHITE, '白色布艺沙发椅', 446, 400)
RATTAN_CARD = b.product_card(b.CHAIR_RATTAN, '藤编椅＋软垫', 446, 400)
ROOMS = {'before': b.ROOM_BEFORE, 'white': b.ROOM_WHITE, 'rattan': b.ROOM_RATTAN}
BACKGROUND = Image.new('RGBA', (W, H))
gradient = Image.new('RGBA', (1, H))
gradient.putdata([(round(249 - y / H * 6), round(247 - y / H * 7), round(240 - y / H * 9), 255) for y in range(H)])
BACKGROUND = gradient.resize((W, H))


def fresh():
    return BACKGROUND.copy()


def brand(base):
    layer = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(layer)
    cx, cy = 77, 83
    d.line([(cx, cy - 13), (cx + 13, cy), (cx, cy + 13), (cx - 13, cy), (cx, cy - 13)], fill=SAGE, width=3)
    text(layer, (105, 60), '空间工坊', 31, SAGE, True)
    base.alpha_composite(layer)


def pill(base, label, xy, active=False, size=27):
    layer = Image.new('RGBA', (W, H))
    width = round(ImageDraw.Draw(layer).textlength(label, font=font(size, True))) + 46
    x, y = xy
    rounded(layer, (x, y, x + width, y + 53), (*SAGE, 245) if active else (230, 235, 223, 245), 26)
    text(layer, (x + 23, y + 8), label, size, (255, 255, 249) if active else SAGE, True)
    base.alpha_composite(layer)


def section(base, number, heading, subheading=None):
    brand(base)
    pill(base, number, (65, 144), True, 25)
    text(base, (65, 230), heading, 60, INK, True)
    if subheading:
        text(base, (69, 320), subheading, 30, (102, 110, 97))


def rounded_image(base, source, box, focused=False):
    x, y, width, height = box
    if focused:
        image = ImageOps.fit(source, (round(width), round(height)), Image.Resampling.LANCZOS, centering=(.20, .5))
    else:
        image = fit(source, width, height, True)
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1), 28, fill=255)
    image.putalpha(mask)
    paste(base, image, (x, y))


def wrap(value, max_width, size):
    draw = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    if draw.textlength(value, font=font(size, True)) <= max_width:
        return [value]
    for punctuation in ['，', '。', '？', '！']:
        split = value.find(punctuation)
        if 0 < split < len(value) - 1:
            first, second = value[:split + 1], value[split + 1:]
            if all(draw.textlength(part, font=font(size, True)) <= max_width for part in [first, second]):
                return [first, second]
    lines, current = [], ''
    for char in value:
        if current and draw.textlength(current + char, font=font(size, True)) > max_width:
            lines.append(current)
            current = char
        else:
            current += char
    if current:
        lines.append(current)
    return lines


def conversation(base, t):
    current = b.active_line(t)
    layer = Image.new('RGBA', (W, H))
    rounded(layer, (28, 1444, 1030, 1744), (244, 241, 231, 225), 30)
    base.alpha_composite(layer)
    for speaker, x in [('A', 35), ('B', 814)]:
        actor = ACTORS[speaker]
        active = current and current['speaker'] == speaker
        bob = -5 * abs(math.sin((t - current['start']) * 5.5)) if active else 0
        paste(base, actor, (x, 1710 - actor.height + bob), 1.0 if active else .91)
    if current:
        layer = Image.new('RGBA', (W, H))
        box = (273, 1490, 800, 1676)
        rounded(layer, box, (255, 255, 251, 252), 28)
        color = ORANGE if current['speaker'] == 'A' else SAGE
        draw = ImageDraw.Draw(layer)
        if current['speaker'] == 'A':
            draw.polygon([(274, 1561), (251, 1574), (274, 1590)], fill=(255, 255, 251, 252))
        else:
            draw.polygon([(799, 1561), (821, 1574), (799, 1590)], fill=(255, 255, 251, 252))
        lines = wrap(current['text'], 459, 37)
        y = 1583 - len(lines) * 27
        for line in lines:
            text(layer, (537, y + 21), line, 37, color, True, 'mm')
            y += 54
        base.alpha_composite(layer)


def footer(base, stage):
    labels = ['建场景', '生成物品', '试摆', '看效果']
    layer = Image.new('RGBA', (W, H))
    for i, label in enumerate(labels):
        x = 72 + i * 243
        rounded(layer, (x, 1790, x + 208, 1795), (*SAGE, 220) if i <= stage else (209, 214, 201, 160), 2)
        text(layer, (x + 104, 1827), label, 23, SAGE if i <= stage else (135, 142, 129), False, 'mm')
    base.alpha_composite(layer)


def opening(t):
    base = fresh()
    brand(base)
    text(base, (65, 145), '衣服都可以试穿，', 57, INK, True)
    text(base, (65, 230), '家具为什么不能试摆', 66, SAGE, True)
    for i, card in enumerate((WHITE_CARD, RATTAN_CARD)):
        p = ease((t - i * .12) / .6)
        paste(base, card, (65 + i * 478, 360 + 26 * (1 - p)), p)
    rounded_image(base, ROOMS['before'], (40, 805, 1000, 563))
    pill(base, '原有客厅 · 在窗边添把椅子', (65, 1300), False, 26)
    conversation(base, t)
    footer(base, -1)
    return base


def uploading(t):
    base = fresh()
    section(base, '01 / 02', '创建场景 · 生成家具', '一张房间照片，再加一张椅子图片')
    local = t - 10
    key = 'room' if local < 3 else 'chair'
    image = b.UPLOADER[key]
    image = ImageOps.expand(image, border=28, fill=(247, 248, 241, 255))
    image = fit(image, 950, 840)
    x, y = (W - image.width) // 2, 425 + (840 - image.height) // 2
    rounded_image(base, image, (x, y, image.width, image.height))
    pill(base, '实际上传页面', (65, 1278), False, 25)
    # Use drawn checks, so all glyphs remain readable with the installed CJK font.
    layer = Image.new('RGBA', (W, H))
    for i, label in enumerate(['房间照片', '椅子图片']):
        x = 450 + i * 245
        checked = local > (.6 if i == 0 else 3.6)
        d = ImageDraw.Draw(layer)
        d.ellipse((x, 1291, x + 24, 1315), outline=SAGE, width=2)
        if checked:
            d.line([(x + 5, 1302), (x + 11, 1308), (x + 20, 1298)], fill=SAGE, width=3)
        text(layer, (x + 36, 1285), label, 28, SAGE, True)
    base.alpha_composite(layer)
    conversation(base, t)
    footer(base, 1)
    return base


def placing(t):
    base = fresh()
    section(base, '03', '摆放物体', '挪一挪，找到合适的位置')
    local = t - 16
    room = b.ROOM_BEFORE.copy()
    p = ease((local - .35) / 2.1)
    x, y = 620 - 360 * p, 400 - 10 * p
    chair = b.PLACED_CHAIR
    shadow = Image.new('RGBA', room.size)
    ImageDraw.Draw(shadow).ellipse((x + 35, y + chair.height - 36, x + chair.width - 20, y + chair.height + 2), fill=(55, 42, 23, 48))
    room.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    paste(room, chair, (x, y))
    if local < 3.5:
        b.cursor(room, x + chair.width * .74, y + chair.height * .65, .3 < local < 2.7)
    rounded_image(base, room, (40, 412, 1000, 960), True)
    pill(base, '试摆动画示意', (65, 1298), False, 24)
    conversation(base, t)
    footer(base, 2)
    return base


def rendered(t):
    base = fresh()
    section(base, '04', '渲染真实效果')
    local = t - 21
    amount = ease((local - 2.25) / .6)
    pill(base, '白色布艺沙发椅', (65, 331), amount < .5, 28)
    pill(base, '藤编椅＋软垫', (582, 331), amount >= .5, 28)
    image = Image.blend(ROOMS['white'], ROOMS['rattan'], amount)
    rounded_image(base, image, (40, 435, 1000, 938), True)
    pill(base, 'AI 搭配效果示意', (65, 1300), False, 24)
    conversation(base, t)
    footer(base, 3)
    return base


def ending(t):
    base = fresh()
    brand(base)
    text(base, (65, 155), '买之前，', 64, INK, True)
    text(base, (65, 252), '先放家里看看。', 76, SAGE, True)
    rounded_image(base, ROOMS['rattan'], (40, 433, 1000, 905), True)
    pill(base, '试试你的第一个房间 →', (65, 1345), True, 28)
    text(base, (742, 1357), 'AI 效果示意', 24, (115, 122, 109))
    conversation(base, t)
    footer(base, 3)
    return base


SCENES = [(0, opening), (10, uploading), (16, placing), (21, rendered), (26, ending)]


def frame(t):
    index = max(i for i, (start, _) in enumerate(SCENES) if t >= start)
    result = SCENES[index][1](t)
    start = SCENES[index][0]
    if index and t - start < .23:
        previous = SCENES[index - 1][1](start - .001)
        result = Image.blend(previous, result, ease((t - start) / .23))
    if t < .25:
        result = Image.blend(BACKGROUND, result, ease(t / .25))
    return result.convert('RGB')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview-only', action='store_true')
    args = parser.parse_args()
    preview_times = [.9, 5.9, 11.4, 14.4, 18.6, 22.3, 24.6, 28.4]
    sheet = Image.new('RGB', (1080, 4 * 1000), '#f6f4ec')
    for i, t in enumerate(preview_times):
        picture = frame(t)
        picture.save(WORK / f'vertical-frame-{i:02d}.jpg', quality=95)
        sheet.paste(picture.resize((540, 960), Image.Resampling.LANCZOS), (i % 2 * 540, i // 2 * 1000))
        text(sheet, (i % 2 * 540 + 20, i // 2 * 1000 + 966), f'{t:04.1f}s', 23, INK, True)
    sheet.save(OUT / 'contact-sheet.jpg', quality=94)
    frame(.9).save(OUT / 'poster.jpg', quality=96)
    if args.preview_only:
        print(OUT / 'contact-sheet.jpg')
        return
    audio = b.make_audio()
    (OUT / 'subtitles.srt').write_text('\n\n'.join(f'{i + 1}\n{b.timestamp(line["start"])} --> {b.timestamp(line["end"])}\n{line["text"]}' for i, line in enumerate(b.LINES)) + '\n', encoding='utf-8-sig')
    output = OUT / 'furniture-try-before-buy-30s-vertical.mp4'
    log = (WORK / 'encode-vertical.log').open('w', encoding='utf-8')
    command = [b.FFMPEG, '-hide_banner', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{W}x{H}', '-framerate', str(FPS), '-i', 'pipe:0', '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', str(DURATION), '-movflags', '+faststart', '-metadata', 'title=衣服都可以试穿，家具为什么不能试摆', '-metadata', 'comment=9:16 vertical concept film. Actual upload UI; placement and AI furnishing results are illustrative.', str(output)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for i in range(FPS * DURATION):
            encoder.stdin.write(frame(i / FPS).tobytes())
            if i % (FPS * 3) == 0:
                print(f'Rendered vertical {i // FPS:02d}/{DURATION}s', flush=True)
        encoder.stdin.close()
        if encoder.wait():
            raise RuntimeError('Video encoding failed; inspect encode-vertical.log')
    except BaseException:
        encoder.kill()
        raise
    finally:
        log.close()
    print(output, flush=True)


if __name__ == '__main__':
    main()
