from pathlib import Path
from tempfile import TemporaryDirectory
import runpy
import unittest

verify = runpy.run_path(str(Path(__file__).with_name('maestro-reports.py')))['verify_reports']


class MaestroEvidenceTests(unittest.TestCase):
    def test_every_current_flow_requires_passing_test_cases(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            flows, results = root / 'flows', root / 'results'
            flows.mkdir()
            results.mkdir()
            with self.assertRaises(ValueError):
                verify(flows, results)
            (flows / '01.yaml').touch()
            (flows / '02.yaml').touch()
            passing = '<testsuites><testsuite tests="1"><testcase name="flow"/></testsuite></testsuites>'
            (results / '01-results.xml').write_text(passing)
            second = results / '02-results.xml'
            with self.assertRaises(FileNotFoundError):
                verify(flows, results)
            for bad in ['<testsuite/>', '<testsuite><testcase><skipped/></testcase></testsuite>',
                        '<testsuite failures="1"><testcase/></testsuite>', '<testsuite><testcase><error/></testcase></testsuite>']:
                second.write_text(bad)
                with self.assertRaises(ValueError):
                    verify(flows, results)
            second.write_text(passing)
            self.assertEqual(verify(flows, results), 2)


if __name__ == '__main__':
    unittest.main()
