"""Isolated browser regression for the spatial recovery overlay's production CSS."""
import argparse
from html import escape
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3] if len(Path(__file__).resolve().parents) > 3 else Path.cwd()
CASES = [
    ('data-saver', '瀏覽器已開啟省流量模式，因此立體畫面不會自動載入；仍可直接查看地點資訊與步行導航。需要 3D 時可自行開啟。', '仍要開啟立體畫面'),
    ('offscreen', '尚未確認立體畫面在可見範圍；滑動至空間圖後才載入，以節省手機效能與電力。若沒有自動載入，可手動開啟。地點資訊與步行導航仍可使用。', '手動開啟立體畫面'),
    ('error', '這次無法顯示立體畫面。你仍可選擇地點，查看資訊與導航。', '重試立體畫面'),
    ('paused', '立體畫面已暫停。回到空間圖會自動恢復；若沒有恢復，可手動重新啟動。', '重新啟動立體畫面'),
]


def run(stylesheet, executable_path):
    css = stylesheet.read_text(encoding='utf-8')
    failures = []
    with sync_playwright() as playwright:
        options = {'executable_path': executable_path} if executable_path else {}
        browser = playwright.chromium.launch(**options)
        try:
            for width, height, font in [(320, 568, 32), (320, 480, 32), (390, 844, 16)]:
                page = browser.new_page(viewport={'width': width, 'height': height})
                try:
                    for name, message, action in CASES:
                        label = f'{width}x{height}/{font}px/{name}'
                        page.set_content(f'''<html lang="zh-Hant" style="font-size:{font}px">
                            <style>body {{margin:8px;font-family:sans-serif}}
                            button {{font:inherit;padding:8px;min-height:44px}}{css}</style>
                            <div class="scene"><div class="sceneMessage" role="status">
                            <p>{escape(message)}</p><button type="button">{escape(action)}</button></div>
                            <span class="sceneCaption">地點位置示意</span></div></html>''')
                        result = page.evaluate('''() => {
                            const overlay = document.querySelector('.sceneMessage');
                            const text = overlay.querySelector('p');
                            const button = overlay.querySelector('button');
                            const bounds = overlay.getBoundingClientRect();
                            const startsInView = text.getBoundingClientRect().top >= bounds.top - 1;
                            const noHorizontalOverflow = overlay.scrollWidth <= overlay.clientWidth + 1;
                            overlay.scrollTop = overlay.scrollHeight;
                            const action = button.getBoundingClientRect();
                            const actionInView = action.top >= bounds.top - 1 && action.bottom <= bounds.bottom + 1;
                            const hit = document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2);
                            return {startsInView, noHorizontalOverflow, actionInView,
                                targetSize: action.height >= 44, hit: hit === button,
                                captionHidden: getComputedStyle(document.querySelector('.sceneCaption')).display === 'none'};
                        }''')
                        if not all(result.values()):
                            failures.append((label, result))
                            print('FAIL', label, result)
                            continue
                        button = page.get_by_role('button', name=action)
                        button.evaluate("element => element.addEventListener('click', () => element.dataset.clicked = 'yes')")
                        button.click(timeout=2000)
                        assert button.get_attribute('data-clicked') == 'yes', label
                        page.locator('.sceneMessage').evaluate('element => element.remove()')
                        assert page.locator('.sceneCaption').is_visible(), label
                        print('PASS', label)
                finally:
                    page.close()
        finally:
            browser.close()
    assert not failures, f'{len(failures)} of 12 recovery layouts failed: {failures}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stylesheet', type=Path, default=ROOT / 'apps/web/src/app/map/CampusSpatialExplorer.module.css')
    parser.add_argument('--executable-path', default=None)
    args = parser.parse_args()
    run(args.stylesheet, args.executable_path)
