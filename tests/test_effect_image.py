import unittest, tempfile, subprocess, sys, json
from pathlib import Path
import numpy as np
import cv2
ROOT=Path(__file__).resolve().parents[1]
class EffectFrame(unittest.TestCase):
    def test_provider_jpeg_keeps_full_image_and_offline_frame(self):
        with tempfile.TemporaryDirectory(prefix='aholo-effect-image-') as folder:
            source=Path(folder)/'source.jpg';output=Path(folder)/'output.png'
            cv2.imwrite(str(source),np.full((512,256,3),(30,80,170),dtype=np.uint8))
            r=subprocess.run([sys.executable,str(ROOT/'offline_runner.py'),str(ROOT/'normalize_effect_image.py'),'--input',str(source),'--output',str(output),'--width','512','--height','256'],capture_output=True,text=True,check=True)
            self.assertTrue(json.loads(r.stdout)['letterboxed'])
            image=cv2.imread(str(output));self.assertEqual(image.shape,(256,512,3))
            self.assertTrue(np.all(image[0,0]==245));self.assertLess(abs(int(image[128,256,0])-30),3)
if __name__=='__main__':unittest.main()
