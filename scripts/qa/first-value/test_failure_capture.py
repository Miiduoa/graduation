import unittest
from unittest.mock import AsyncMock

from playwright.async_api import Error as PlaywrightError

from check import capture, capture_failure


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
        self.assertEqual(report['screenshotFailure'], "RuntimeError('viewport unavailable')")
        self.assertEqual(report['diagnosticErrors'], [
            {'artifact': 'failure-viewport', 'error': "RuntimeError('viewport unavailable')"},
        ])
        calls = page.screenshot.await_args_list
        self.assertFalse(calls[0].kwargs['full_page'])
        self.assertTrue(calls[1].kwargs['full_page'])
        self.assertEqual([call.kwargs['timeout'] for call in calls], [5000, 5000])
        self.assertEqual([call.kwargs['animations'] for call in calls], ['disabled', 'disabled'])

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
        self.assertEqual(report['screenshotFailure'], "RuntimeError('viewport')")

    async def test_successful_diagnostics_do_not_change_failure(self):
        page = AsyncMock()
        report = {'passed': False}
        original = AssertionError('wrong destination')

        await capture_failure(page, {'name': 'desktop'}, report, original)

        self.assertEqual(report['failure'], repr(original))
        self.assertFalse(report['passed'])
        self.assertNotIn('diagnosticErrors', report)
        self.assertNotIn('screenshotFailure', report)


class EvidenceCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_only_protocol_error_with_same_required_artifact(self):
        page = AsyncMock()
        page.evaluate.return_value = 'smooth'
        page.screenshot.side_effect = [
            PlaywrightError('Page.captureScreenshot: Unable to capture screenshot'),
            None,
        ]
        await capture(page, 'setup.png')
        self.assertEqual(page.screenshot.await_count, 2)
        self.assertEqual(page.screenshot.await_args_list[0], page.screenshot.await_args_list[1])
        self.assertTrue(page.screenshot.await_args.kwargs['full_page'])
        self.assertEqual(page.screenshot.await_args.kwargs['animations'], 'disabled')
        self.assertEqual(page.evaluate.await_count, 4)
        self.assertEqual(page.evaluate.await_args.args[1], 'smooth')

    async def test_second_failure_still_fails_the_journey(self):
        page = AsyncMock()
        page.evaluate.return_value = 'smooth'
        page.screenshot.side_effect = PlaywrightError('Page.captureScreenshot: Unable to capture screenshot')
        with self.assertRaises(PlaywrightError):
            await capture(page, 'setup.png')
        self.assertEqual(page.screenshot.await_count, 2)
        self.assertEqual(page.evaluate.await_args.args[1], 'smooth')

    async def test_unrelated_failure_is_not_retried(self):
        page = AsyncMock()
        page.evaluate.return_value = ''
        page.screenshot.side_effect = PlaywrightError('Page closed')
        with self.assertRaisesRegex(PlaywrightError, 'Page closed'):
            await capture(page, 'setup.png')
        self.assertEqual(page.screenshot.await_count, 1)
        self.assertEqual(page.evaluate.await_args.args[1], '')


if __name__ == '__main__':
    unittest.main()
