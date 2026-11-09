"""Run only the local demo's media/geometry scripts with Python network/process access denied."""
import sys, runpy
from pathlib import Path
allowed={'local_geometry.py','media_check.py','runtime_check.py','normalize_effect_image.py'}
root=Path(__file__).resolve().parent
sys.path.insert(0,str(root/'.local-python'))
target=Path(sys.argv[1]).resolve()
if target.parent!=root or target.name not in allowed:raise ValueError('Offline runner target not allowed')
def deny_network(event,args):
    if event.startswith('socket.') or event in ('subprocess.Popen','os.system','os.exec','os.posix_spawn'):
        raise PermissionError('LOCAL_PROCESSING_NETWORK_AND_SUBPROCESS_DENIED')
sys.addaudithook(deny_network)
sys.argv=sys.argv[1:]
runpy.run_path(str(target),run_name='__main__')
