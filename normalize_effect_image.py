"""Decode provider output offline; preserve its complete composition with letterboxing."""
import argparse, json, os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'.local-python'))
os.environ['OPENCV_IO_MAX_IMAGE_PIXELS']='16777216'
import cv2
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--width',type=int,required=True);p.add_argument('--height',type=int,required=True);a=p.parse_args()
if not all(256<=v<=1024 and v%16==0 for v in [a.width,a.height]):raise ValueError('Invalid output frame')
raw=np.fromfile(a.input,dtype=np.uint8);image=cv2.imdecode(raw,cv2.IMREAD_COLOR)
if image is None or max(image.shape[:2])>8192:raise ValueError('Invalid provider image')
h,w=image.shape[:2];scale=min(a.width/w,a.height/h);nw,nh=max(1,round(w*scale)),max(1,round(h*scale))
resized=cv2.resize(image,(nw,nh),interpolation=cv2.INTER_AREA if scale<1 else cv2.INTER_LINEAR)
canvas=np.full((a.height,a.width,3),245,dtype=np.uint8);left,top=(a.width-nw)//2,(a.height-nh)//2;canvas[top:top+nh,left:left+nw]=resized
ok,data=cv2.imencode('.png',canvas)
if not ok:raise ValueError('Cannot save result')
data.tofile(a.output);print(json.dumps({'width':a.width,'height':a.height,'letterboxed':nw!=a.width or nh!=a.height}))
