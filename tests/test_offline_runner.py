import unittest, subprocess, sys, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class OfflineRuntime(unittest.TestCase):
    def test_dependencies_load_with_network_disabled(self):
        r=subprocess.run([sys.executable,str(ROOT/'offline_runner.py'),str(ROOT/'runtime_check.py')],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertTrue(json.loads(r.stdout)['numpy']['available'])
    def test_socket_creation_is_denied_after_runner_installs_policy(self):
        code="import sys,runpy,socket;sys.argv=['offline_runner.py','runtime_check.py'];runpy.run_path('offline_runner.py');socket.socket()"
        r=subprocess.run([sys.executable,'-c',code],cwd=ROOT,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('LOCAL_PROCESSING_NETWORK_AND_SUBPROCESS_DENIED',r.stderr)
if __name__=='__main__':unittest.main()
