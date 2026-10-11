"""Run the accepted independent oracle without changing its frozen inputs."""
from pathlib import Path
import os
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
oracle = root / 'audit/fixed-assets-long/oracle'
sys.path.insert(0, str(oracle))
from run import gate  # noqa: E402

parent = Path(os.environ.get('ASSET_LONG_ORACLE_REPORT_DIR', root / 'work/fixed-assets-long-oracle'))
parent.mkdir(parents=True, exist_ok=True)
output = Path(tempfile.mkdtemp(prefix='attempt-', dir=parent))
report = gate(oracle.parent / 'frozen', output)
print(f"Independent oracle: {len(report['cases'])} cases, {report.get('diagnosticComparisonCount', 0)} diagnostic comparisons, passed={report['allPassed']}; {output}")
if not report['allPassed']:
    raise SystemExit(1)
