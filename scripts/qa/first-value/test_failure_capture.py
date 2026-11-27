import unittest
from unittest.mock import AsyncMock

from check import capture_failure


class FailureCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def test_screenshot_failure_preserves_journey_error_and_attempts_both(self):
        page = AsyncMock()
        page.screenshot.side_effect = [RuntimeError('viewport unavailable'), None]
        report = {'passed': False}
        original = AssertionError('focus ring clipped')

        await capture_failure(page, {'name': '320-light-200'}, report, original)

        self.assertEqual(report['failure'], repr(original))
        self.assertFalse(report['passed'])
        self.assertEqual(page.screenshot.await_count, 2)
        self.assertEqual(report['diagnosticErrors'], [
            {'artifact': 'failure-viewport', 'error': "RuntimeError('viewport unavailable')"},
        ])
        calls = page.screenshot.await_args_list
        self.assertFalse(calls[0].kwargs['full_page'])
        self.assertTrue(calls[1].kwargs['full_page'])
        self.assertEqual([call.kwargs['timeout'] for call in calls], [5000, 5000])

    async def test_both_screenshots_fail_without_hiding_original(self):
        page = AsyncMock()
        page.screenshot.side_effect = [RuntimeError('viewport'), RuntimeError('full')]
        report = {'passed': False}
        original = AssertionError('unexpected external request')

        await capture_failure(page, {'name': 'guest'}, report, original)

        self.assertEqual(report['failure'], repr(original))
        self.assertFalse(report['passed'])
        self.assertEqual([item['artifact'] for item in report['diagnosticErrors']],
                         ['failure-viewport', 'failure'])

    async def test_successful_diagnostics_do_not_change_failure(self):
        page = AsyncMock()
        report = {'passed': False}
        original = AssertionError('wrong destination')

        await capture_failure(page, {'name': 'desktop'}, report, original)

        self.assertEqual(report['failure'], repr(original))
        self.assertFalse(report['passed'])
        self.assertNotIn('diagnosticErrors', report)


if __name__ == '__main__':
    unittest.main()
