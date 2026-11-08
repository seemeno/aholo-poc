import sys, unittest, tempfile, json, os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from local_geometry import fit

REAL_PLY=Path(os.environ['AHOLO_REAL_PLY']) if os.environ.get('AHOLO_REAL_PLY') else None

class GeometricFit(unittest.TestCase):
    @unittest.skipUnless(REAL_PLY and REAL_PLY.exists(),'Optional AHOLO_REAL_PLY regression sample not configured')
    def test_real_gaussians_serialize_low_support_walls(self):
        fixture=REAL_PLY
        with tempfile.TemporaryDirectory(prefix='aholo-real-fit-') as folder:
            fit(fixture,folder,'real-regression')
            structure=json.loads((Path(folder)/'structure.json').read_text())
            self.assertTrue(structure['walls'])
            self.assertTrue(all(type(w['enabled']) is bool for w in structure['walls']))
            self.assertTrue(any(not w['enabled'] for w in structure['walls']))

    def test_tilted_floor_and_walls_without_network_or_llm(self):
        rng=np.random.default_rng(42)
        floor=np.column_stack([rng.uniform(-3,3,9000),rng.uniform(-3,3,9000),rng.normal(0,.008,9000)])
        walls=[]
        for axis,value in [(0,-3),(0,3),(1,-3),(1,3)]:
            p=np.column_stack([rng.uniform(-3,3,5000),rng.uniform(-3,3,5000),rng.uniform(.1,2.8,5000)]);p[:,axis]=value+rng.normal(0,.008,5000);walls.append(p)
        xyz=np.vstack([floor,*walls]);a=np.radians(5);rotation=np.array([[1,0,0],[0,np.cos(a),-np.sin(a)],[0,np.sin(a),np.cos(a)]])
        xyz=xyz@rotation.T+np.array([.4,-.2,1.2]);data=np.empty(len(xyz),dtype=[('x','<f4'),('y','<f4'),('z','<f4'),('red','u1'),('green','u1'),('blue','u1')])
        for i,k in enumerate('xyz'):data[k]=xyz[:,i]
        for k in ('red','green','blue'):data[k]=150
        header=f'ply\nformat binary_little_endian 1.0\nelement vertex {len(data)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'
        with tempfile.TemporaryDirectory(prefix='aholo-geometry-test-') as folder:
            file=Path(folder)/'room.ply';file.write_bytes(header.encode()+data.tobytes());out=Path(folder)/'output';result=fit(file,out,'local-synthetic')
            self.assertEqual(result['floor'],1);self.assertGreaterEqual(result['walls'],2);self.assertLess(result['rmse'],.04)
            s=json.loads((out/'structure.json').read_text());self.assertEqual(s['quality']['method'],'LOCAL_GEOMETRY_NO_LLM');self.assertEqual(s['openings'],[])
            preview=json.loads((out/'point_preview.json').read_text());source=np.array(preview['sourceXyz']);t=np.array(s['sourceToAligned']);expected=source@t[:3,:3].T+t[:3,3];self.assertLess(np.max(np.abs(expected-np.array(preview['xyz']))),.00002)

if __name__=='__main__':unittest.main()
