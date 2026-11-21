"""Play through rival occupancy, both victory modes and the same debt settled two ways."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from board_fixture import edit_rules

root=Path(__file__).resolve().parent
release=(root.parent/'dist/index.html').read_text()
observed={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    for ending in ('positions','net-worth','sale','surrender','salvage'):
        p=browser.new_page(viewport={'width':1366,'height':768},reduced_motion='reduce')
        debt=ending in ('sale','surrender','salvage')
        p.clock.install();seed=5 if debt else 54
        p.add_init_script(f'crypto.getRandomValues=a=>(a[0]={seed},a);window.clicks=0;addEventListener("click", e=>{{if(e.isTrusted)window.clicks++}},true)')
        html=release
        if debt:
            def adjust(fixture):
                fixture['cash']=200
                if ending=='salvage':
                    fixture['tiles'][6]['group']='Pilotage'
                    for t in fixture['tiles']:
                        if t['kind']=='fee':t['price']=35
            html=edit_rules(html,'compact',adjust)
        p.route('http://harbor.test/',lambda r:r.fulfill(body=html,content_type='text/html'))
        p.goto('http://harbor.test/');p.click('#setupBtn');p.locator('#advanced summary').click()
        p.select_option('#map','compact');p.select_option('#seat-1','human');p.select_option('#seat-2','off')
        if debt:
            p.select_option('#victory','elimination');p.check('#debtLevels' if ending=='salvage' else '#debtDeeds');assert not p.locator('#roundLimit').is_visible()
        if ending=='net-worth':
            n=p.evaluate('clicks');p.click('#roundLimit');p.fill('#roundLimit','1')
        p.click('#start')
        def action(name):p.get_by_role('button',name=name,exact=True).click()
        def roll():action('Roll dice')
        def end():p.clock.run_for(1150)
        def buy():p.locator('#actions .primary').click();end()
        def read(k):
            return p.locator(k).evaluate_all('''ns=>ns.length>0&&ns.every(n=>{const r=n.getBoundingClientRect();
              return r.width>0&&r.top>=0&&r.bottom<=innerHeight+.5&&n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})''')
        if ending=='net-worth':
            observed['configure-win']=p.evaluate('clicks')-n
            roll();buy();roll();buy()
            expect(p.locator('body')).to_have_attribute('data-phase','over')
            expect(p.locator('#turn')).to_contain_text('net worth after 1 round')
            action('Rematch');expect(p.locator('#round')).to_contain_text('/ 1 · NET WORTH')
        elif ending=='positions':
            roll();buy();roll();buy();roll();end();roll();end()
            n=p.evaluate('clicks')
            tile=p.locator('#tile-12')
            expect(tile.locator('.ownerMark b')).to_have_text('S1');expect(tile.locator('.token')).to_have_text('2')
            expect(p.locator('#stageLedger .shipLocation').nth(1)).to_have_text('Silk Arcade')
            expect(p.locator('#stageLedger .portOwner').nth(1)).to_have_text('Deed: Seat 1')
            assert read('#tile-12 .ownerMark') and read('#tile-12 .token svg') and read('#stageLedger .portOwner')
            observed['rival-berth']=p.evaluate('clicks')-n
            expect(p.locator('#tile-0 .token')).to_have_text('1')
            expect(p.locator('#stageLedger .shipLocation').first).to_have_text('Port Office')
            assert read('#stageLedger .shipLocation')
            observed['owner-away']=p.evaluate('clicks')-n
            p.screenshot(path=root/'fleet-stations.png')
            p.set_viewport_size({'width':390,'height':844});assert read('#stageLedger .shipLocation') and read('#stageLedger .portOwner')
            p.get_by_role('button',name='Activity',exact=True).click();n=p.evaluate('clicks')
            p.locator('#stageLedger [data-locate="0"]').click()
            assert read('#tile-0.located') and 'board'==p.locator('body').get_attribute('data-instrument')
            observed['locate-ship']=p.evaluate('clicks')-n
        else:
            roll();buy();roll();end()
            if ending=='salvage':
                p.click('#tile-6');p.click('#plotCommit')
            roll();end();roll();buy();roll()
            expect(p.locator('body')).to_have_attribute('data-phase','debt')
            expect(p.locator('#turn .facts dd').last).to_have_text('$6' if ending=='salvage' else '$40')
            expect(p.locator('#round')).to_contain_text('LAST SHIP STANDING')
            if ending=='salvage':
                n=p.evaluate('clicks');action('Review assets')
                assert p.locator('.plotReadout .facts dd').all_text_contents()==['$16','$0','$10']
                expect(p.locator('.plotReadout')).to_contain_text('$105 → $70')
                p.click('#plotCommit');observed['strip-level']=p.evaluate('clicks')-n
                expect(p.locator('#stageLedger .account b').first).to_have_text('$10')
                expect(p.locator('#tile-6 .ownerMark')).to_have_text('S1 SET')
            elif ending=='sale':
                n=p.evaluate('clicks');action('Review assets')
                expect(p.locator('.plotReadout')).to_contain_text('Copper Yard')
                assert p.locator('.plotReadout .facts dd').all_text_contents()==['$70','$0','$30']
                p.screenshot(path=root/'debt-sale.png')
                p.click('#plotCommit');observed['pay-debt']=p.evaluate('clicks')-n
                expect(p.locator('#stageLedger .account b').first).to_have_text('$30')
                assert not p.locator('#tile-6 .ownerMark').count()
            else:
                action('Declare bankruptcy');p.click('#keepPlaying')
                expect(p.locator('#tile-6 .ownerMark b')).to_have_text('S1')
                n=p.evaluate('clicks');action('Declare bankruptcy');p.click('#surrender')
                observed['choose-bankruptcy']=p.evaluate('clicks')-n;end()
                expect(p.locator('#turn h2')).to_have_text('Seat 2 wins')
                expect(p.locator('#turn')).to_contain_text('Last solvent merchant')
                assert not p.locator('#board [data-ship="0"]').count()
                assert 'S1' not in p.locator('.ownerMark b').all_text_contents()
        p.close()
    browser.close()
(root/'charter-results.json').write_text(json.dumps({'observed':observed},indent=2)+'\n')
