"""Validate the current run's full-suite JUnit evidence before publishing a PR result."""

from pathlib import Path
import xml.etree.ElementTree as ET


def verify_reports(flows, results):
    names = sorted(path.stem for path in flows.glob('*.yaml'))
    if not names:
        raise ValueError('No Maestro flows found')
    for name in names:
        root = ET.parse(results / f'{name}-results.xml').getroot()
        if root.tag not in {'testsuite', 'testsuites'} or not list(root.iter('testcase')):
            raise ValueError(f'Missing JUnit test cases for {name}')
        for element in root.iter():
            if element.tag in {'failure', 'error', 'skipped'}:
                raise ValueError(f'Unsuccessful JUnit result for {name}')
            if element.tag in {'testsuite', 'testsuites'}:
                if any(int(element.get(key, '0')) != 0 for key in ('failures', 'errors', 'skipped', 'disabled')):
                    raise ValueError(f'Unsuccessful JUnit totals for {name}')
    return len(names)


if __name__ == '__main__':
    total = verify_reports(Path('.maestro/flows'), Path('.maestro/results'))
    print(f'Verified successful JUnit evidence for all {total} Maestro flows')
