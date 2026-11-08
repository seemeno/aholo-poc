import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'.local-python'))
result={}
for name in ('numpy','cv2'):
    try:
        module=__import__(name);result[name]={'available':True,'version':module.__version__}
    except ImportError:result[name]={'available':False}
print(json.dumps(result))
