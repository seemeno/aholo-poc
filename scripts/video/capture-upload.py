from pathlib import Path
import os
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets/video/furniture-tryout-20261109-v1'
OUTPUT = ROOT / 'tmp/furniture-video-v1/capture'
OUTPUT.mkdir(parents=True, exist_ok=True)

env = dict(os.environ, PORT='8794', AHOLO_EFFECTS_ENABLED='0', AHOLO_DATA_DIR=str(ROOT / 'tmp/furniture-video-v1/capture-data'))
server = subprocess.Popen(['node', 'structure_server.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
try:
  for _ in range(50):
    try:
      urllib.request.urlopen('http://127.0.0.1:8794/healthz', timeout=1).read()
      break
    except Exception:
      time.sleep(.1)
  with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=r'C:\Users\90302\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe',
        headless=True,
        args=['--no-sandbox', '--disable-gpu'],
    )
    page = browser.new_page(viewport={'width': 1440, 'height': 960}, device_scale_factor=1)
    page.set_default_timeout(10000)
    page.goto('http://127.0.0.1:8794/#photo', wait_until='domcontentloaded')
    page.locator('#newProject').wait_for(state='visible')
    page.locator('#media').set_input_files(str(ASSETS / '02-room-before.png'))
    page.wait_for_function("document.querySelector('#roomPreview').complete && document.querySelector('#roomPreview').naturalWidth > 0")
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUTPUT / 'upload-room.png'))
    room_box = page.locator('#drop').bounding_box()
    page.screenshot(path=str(OUTPUT / 'upload-room-section.png'), clip={
        'x': room_box['x'] - 16, 'y': room_box['y'] - 64,
        'width': room_box['width'] + 32, 'height': room_box['height'] + 190,
    })
    page.locator('#roomObjectPhotos input[type=file]').first.set_input_files(str(ASSETS / '03-chair-white.png'))
    page.locator('.object-photo-item').wait_for(state='visible')
    page.locator('#roomObjectPhotos').evaluate('(el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90)')
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUTPUT / 'upload-chair.png'))
    page.locator('#roomObjectPhotos').screenshot(path=str(OUTPUT / 'upload-chair-section.png'))
    # No submit action: these captures stop before any cloud generation is requested.
    print({'room': str(OUTPUT / 'upload-room.png'), 'chair': str(OUTPUT / 'upload-chair.png')})
    browser.close()
finally:
  server.terminate()
  server.wait(timeout=10)
