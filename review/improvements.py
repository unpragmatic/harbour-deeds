"""Reach a full set using real turns, inspect, decline, purchase, and check the receipt."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    for mode in ('even', 'district', 'free'):
        p = browser.new_page(viewport={'width': 390, 'height': 844})
        p.clock.install()
        p.add_init_script('crypto.getRandomValues=a=>(a[0]=1,a)')
        p.goto((root.parent/'dist/index.html').as_uri())
        p.click('#setupBtn')
        p.locator('#advanced summary').click()
        p.select_option('#policy', mode)
        p.select_option('#map','compact')
        p.select_option('#clock', '0')
        p.select_option('#seat-1', 'human')
        p.select_option('#seat-2', 'off')
        p.click('#start')
        for _ in range(250):
            phase=p.locator('body').get_attribute('data-phase')
            actions=p.locator('#actions')
            if phase=='roll':
                if actions.get_by_role('button',name='Improve',exact=True).count(): break
                actions.get_by_text('Roll dice').click()
            elif phase=='end': p.clock.run_for(1000)
            elif phase=='offer': actions.get_by_text('Start auction').click()
            elif phase=='auction':
                actor=p.locator('#controlType').inner_text()
                actions.get_by_text('Bid $10' if 'Seat 1' in actor else 'Withdraw',exact=True).click()
            else: raise AssertionError(phase)
        improve=p.get_by_role('button',name='Improve',exact=True)
        improve.click()
        p.click('#hold')
        balances=p.locator('#stageLedger').text_content()
        improve.click()
        for width in (320,390,1280):
            p.set_viewport_size({'width':width,'height':844})
            assert p.evaluate("modal.scrollWidth<=modal.clientWidth && document.documentElement.scrollWidth<=innerWidth")
            if width==390 and mode!='free':
                p.locator('#modal').screenshot(path=root/f'build-{mode}.png')
        first=p.locator('.buildChoice:enabled').first
        assert p.locator('#projectCurve tbody tr').count()==5
        if mode!='district':
            p.select_option('#project',index=1)
            first=p.locator('.buildChoice:visible:enabled').first
        deed=first.locator('strong').inner_text().split(' · ')[0]
        first.click()
        assert p.locator('body').get_attribute('data-phase')=='roll'
        assert p.locator('#stageLedger').text_content()!=balances
        assert 'improved' in p.locator('#log').text_content()
        if mode=='even':
            p.set_viewport_size({'width':390,'height':844})
            p.locator('.tile').filter(has=p.get_by_text(deed,exact=True)).click()
            assert 'Level 1/' in p.locator('#content').inner_text()
            assert 'lower-level' in p.locator('#content').inner_text()
            p.locator('#modal').screenshot(path=root/'built-deed.png')
            p.click('#close')
            p.get_by_role('button',name='Players',exact=True).click()
            assert '1 built · locked' in p.locator('#register').inner_text()
        p.close()
    browser.close()
