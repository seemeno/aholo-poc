"""Local OpenCV heuristics. Coverage/overlap still require human capture checklist."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'.local-python'))
import cv2
import numpy as np

def metrics(frame):
    small=cv2.resize(frame,(320,round(frame.shape[0]*320/frame.shape[1])))
    gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
    return {'sharpness':float(cv2.Laplacian(gray,cv2.CV_64F).var()),'meanBrightness':float(gray.mean()),'darkFraction':float((gray<12).mean()),'brightFraction':float((gray>245).mean())}

def check(file):
    suffix=Path(file).suffix.lower()
    if suffix in ('.mp4','.mov'):
        capture=cv2.VideoCapture(str(file));fps=capture.get(cv2.CAP_PROP_FPS);count=capture.get(cv2.CAP_PROP_FRAME_COUNT);width=int(capture.get(cv2.CAP_PROP_FRAME_WIDTH));height=int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if not capture.isOpened() or fps<=0 or count<=0:raise ValueError('视频无法解码，请使用标准 MP4/MOV')
        samples=[];hashes=[]
        for pos in np.linspace(0,max(0,count-2),20):
            capture.set(cv2.CAP_PROP_POS_FRAMES,int(pos));ok,frame=capture.read()
            if ok:
                samples.append(metrics(frame));gray=cv2.cvtColor(cv2.resize(frame,(16,16)),cv2.COLOR_BGR2GRAY);hashes.append(gray>gray.mean())
        capture.release()
        if not samples:raise ValueError('视频未解码出有效画面')
        duration=count/fps;warnings=[]
        if min(width,height)<720:warnings.append('分辨率较低：本 demo 建议短边至少 720 像素，优先使用 1080p 原片。')
        if duration<15:warnings.append('视频较短，可能没有覆盖足够视角；建议拍摄连续、缓慢移动的视频。')
        if np.median([m['sharpness'] for m in samples])<35:warnings.append('抽样清晰度较低，可能存在模糊或低纹理。')
        if np.mean([m['darkFraction'] for m in samples])>.35:warnings.append('抽样画面暗部较多，请补光后拍摄。')
        changes=[float((a!=b).mean()) for a,b in zip(hashes,hashes[1:])]
        if changes and np.median(changes)<.025:warnings.append('抽样画面变化较小，可能主要在原地拍摄；重建需要移动产生视差。')
        return {'kind':'video','width':width,'height':height,'fps':fps,'frameCount':int(count),'durationSeconds':duration,'sampleCount':len(samples),'medianSharpness':float(np.median([m['sharpness'] for m in samples])),'warnings':warnings,'coverageValidation':'NOT_MEASURED: scene coverage, overlap, parallax and moving objects require user checklist','thresholdBasis':'demo heuristics, not AHOLO hard API limits'}
    image=cv2.imdecode(np.fromfile(file,dtype=np.uint8),cv2.IMREAD_COLOR)
    if image is None:raise ValueError('图片无法解码，请使用 JPG/PNG/WebP')
    m=metrics(image);warnings=[]
    if min(image.shape[:2])<512:warnings.append('图片分辨率较低，本 demo 建议短边至少 512 像素。')
    if m['sharpness']<35:warnings.append('图片模糊或低纹理。')
    return {'kind':'image','width':image.shape[1],'height':image.shape[0],**m,'warnings':warnings,'thresholdBasis':'demo heuristics, not AHOLO hard API limits'}
if __name__=='__main__':print(json.dumps(check(sys.argv[1]),ensure_ascii=False))
