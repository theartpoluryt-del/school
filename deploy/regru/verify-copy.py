#!/usr/bin/env python3
"""Compare all COPY rows in original SQL dumps and a restored data-only dump.

Only row counts and SHA256 digests are written to the report; never row contents.
Run before allowing application writes on the restored database.
"""
import hashlib
import json
from pathlib import Path
import sys


def copies(paths):
    result = {}
    for path in paths:
        with Path(path).open('rb') as stream:
            for line in stream:
                if not (line.startswith(b'COPY ') and line.rstrip().endswith(b' FROM stdin;')):
                    continue
                header = line.rstrip().decode('utf-8')
                if header in result:
                    raise RuntimeError('Duplicate COPY section: ' + header)
                rows = []
                for row in stream:
                    if row == b'\\.\n':
                        break
                    rows.append(row)
                else:
                    raise RuntimeError('Unterminated COPY section: ' + header)
                digest = hashlib.sha256()
                for row in sorted(rows):
                    digest.update(row)
                result[header] = {'rows': len(rows), 'sha256': digest.hexdigest()}
    return result


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: verify-copy.py school.sql accounts.sql restored-data.sql report.json')
    expected = copies(sys.argv[1:3])
    actual = copies(sys.argv[3:4])
    failures = [name for name in sorted(expected.keys() | actual.keys()) if expected.get(name) != actual.get(name)]
    report = {'ok': not failures, 'tables': len(expected), 'rows': sum(x['rows'] for x in expected.values()),
              'failures': failures, 'expected': expected, 'actual': actual}
    Path(sys.argv[4]).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('ok', 'tables', 'rows', 'failures')}, ensure_ascii=False))
    raise SystemExit(1 if failures else 0)
