"""Real browser smoke test for CI. Requires pip install playwright==1.57.0.
Runs against an isolated temporary workspace, never the creator's saved data.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get('BROWSER_ARTIFACTS', '/tmp/signalloop-browser'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='signalloop-browser-') as directory:
    env = {**os.environ, 'DATA_DIR': directory, 'PORT': '3179', 'HOST': '127.0.0.1', 'ACCESS_TOKEN': ''}
    subprocess.run(['node', 'scripts/demo-media.mjs'], cwd=ROOT, env=env, check=True)
    log = (ARTIFACTS / 'server.log').open('w')
    server = subprocess.Popen(['node', 'server/index.mjs'], cwd=ROOT, env=env, stdout=log, stderr=log)
    base = 'http://127.0.0.1:3179'
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen(base + '/api/health', timeout=1) as response:
                    assert json.load(response)['ok']
                break
            except (OSError, ValueError):
                time.sleep(.1)
        else:
            raise RuntimeError('Server did not become healthy')
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': 1440, 'height': 1050})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(base, wait_until='networkidle')
            expect(page).to_have_title('SignalLoop · Content that learns')
            editor = page.locator('#copy-editor')
            expect(editor).to_be_visible()
            editor.fill(editor.input_value().replace('#CreatorWorkflow', '').strip())
            page.locator('[data-action="save-edit"]').click()
            expect(page.locator('#toast')).to_contain_text('Edit saved')
            page.locator('[data-action="page"][data-value="memory"]').click()
            page.locator('.rule').filter(has_text='Leave hashtags out').get_by_role('button', name='Approve rule').click()
            expect(page.locator('.rule').filter(has_text='Leave hashtags out').get_by_role('button', name='Disable rule')).to_be_visible()
            page.locator('[data-action="page"][data-value="lab"]').click()
            expect(page.locator('.proof-comparison')).to_be_visible()
            options = page.locator('#lab-clip-select option').evaluate_all('(nodes) => nodes.map(n => n.value)')
            page.locator('#lab-clip-select').select_option(options[1])
            expect(page.locator('.proof-comparison article').first.locator('p')).to_contain_text('#CreatorWorkflow')
            expect(page.locator('.proof-comparison .learned p')).not_to_contain_text('#CreatorWorkflow')
            page.screenshot(path=str(ARTIFACTS / 'memory-proof.png'), full_page=True)

            page.locator('[data-action="lab-tab"][data-value="campaign"]').click()
            page.locator('[data-action="lab-build"]').click()
            expect(page.locator('#campaign-form select[name="mode"] option')).to_have_count(2)
            page.locator('#campaign-form button[type="submit"]').click()
            expect(page.locator('.campaign-item')).to_have_count(3)
            page.locator('[data-action="lab-approve"]').first.click()
            expect(page.locator('[data-action="lab-schedule"]')).to_be_enabled()
            page.locator('[data-action="lab-schedule"]').click()
            page.locator('#campaign-schedule-form button[type="submit"]').click()
            expect(page.locator('.campaign-review').first).to_contain_text('Planned')
            page.screenshot(path=str(ARTIFACTS / 'campaign.png'), full_page=True)

            page.locator('[data-action="lab-tab"][data-value="guard"]').click()
            page.locator('[data-action="lab-inspect"]').click()
            page.locator('#meaning-form textarea').fill('We got 99999 new subscribers. Guaranteed.')
            page.locator('#meaning-form button[type="submit"]').click()
            expect(page.locator('.guard-flag.blocked')).to_have_count(2)
            page.screenshot(path=str(ARTIFACTS / 'source-guard.png'), full_page=True)

            page.locator('[data-action="page"][data-value="performance"]').click()
            page.locator('[data-action="demo-feedback"]').click()
            expect(page.locator('#toast')).to_contain_text('Illustrative results loaded')
            expect(page.locator('.rank-table .positive').first).to_be_visible()

            page.locator('[data-action="page"][data-value="studio"]').click()
            page.locator('[data-action="export"]').click()
            page.locator('#export-form button[type="submit"]').click()
            download = page.locator('.job a').first
            expect(download).to_be_visible(timeout=90000)
            with urllib.request.urlopen(base + download.get_attribute('href')) as response:
                assert b'ftyp' in response.read(40), 'Export did not contain an MP4 header'

            page.locator('[data-action="page"][data-value="lab"]').click()
            page.locator('[data-action="lab-tab"][data-value="proof"]').click()
            page.set_viewport_size({'width':390, 'height':844})
            expect(page.locator('.proof-comparison .learned')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Mobile content overflowed'
            page.screenshot(path=str(ARTIFACTS / 'mobile.png'), full_page=True)
            assert not errors, f'Browser errors: {errors}'
            print('PASS: source load -> edit -> approved memory -> held-out comparison -> campaign -> review -> calendar -> source guard -> feedback -> actual MP4 -> mobile')
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        log.close()
