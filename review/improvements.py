"""Verify the board-target-preview criterion against real WASM quotes and transactions."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parent
survey=json.loads((root/'clicks.json').read_text())
cost={k:n for group in survey['interactions'].values() for k,_,_,n in group}
paths={k:sum(cost[a] for a in path.split()) for k,_,_,path,_ in survey['scenarios']}
observed={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    for mode in ('even','district','free','expensive','direct-build','direct-sell'):
        p=browser.new_page(viewport={'width':1366,'height':768},reduced_motion='reduce')
        p.clock.install()
        # Observe accepted responses at the WASM boundary; never inject game state.
        p.add_init_script('''crypto.getRandomValues=a=>(a[0]=1,a);window.clicks=window.commits=0;
          addEventListener("click",e=>{if(e.isTrusted)window.clicks++},true);
          const decode=TextDecoder.prototype.decode;TextDecoder.prototype.decode=function(...args){
            const text=decode.apply(this,args);if(text.startsWith("{")&&text.includes('"builds":')){
              window.snapshot=JSON.parse(text);window.commits++;
            }return text;
          }''')
        html=(root.parent/'dist/index.html').read_text()
        if mode=='expensive':
            base=(root.parent/'web/rules.json').read_text()
            costly=json.loads(base);costly['development']['levels'][0]['cost_pct']=5000
            html=html.replace(f'id="config" type="application/json">{base}',f'id="config" type="application/json">{json.dumps(costly)}')
        p.route('http://harbor.test/',lambda r:r.fulfill(body=html,content_type='text/html'))
        p.goto('http://harbor.test/')
        p.click('#setupBtn');p.locator('#advanced summary').click()
        p.select_option('#policy',mode if mode in ('even','district','free') else 'even')
        p.select_option('#map','compact');p.select_option('#clock','0')
        p.select_option('#seat-1','human');p.select_option('#seat-2','off');p.click('#start')
        for _ in range(250):
            phase=p.locator('body').get_attribute('data-phase')
            if phase=='roll':
                if p.evaluate('snapshot.builds.length'):break
                p.get_by_role('button',name='Roll dice',exact=True).click()
            elif phase=='end':p.clock.run_for(1000)
            elif phase=='offer':p.get_by_role('button',name='Start auction').click()
            elif phase=='auction':
                name='Bid $10' if 'Seat 1' in p.locator('#controlType').inner_text() else 'Withdraw'
                p.get_by_role('button',name=name,exact=True).click()
            else:raise AssertionError(phase)
        s=p.evaluate('snapshot');assert s['builds']
        tiles=p.evaluate('JSON.parse(document.getElementById("config").textContent).tiles')
        project=s['builds'][0];member=(project['tiles'][1] if mode=='district' else s['builds'][1]['tile'])
        cash=s['players'][s['turn']]['cash'];initial=p.evaluate('commits')
        def seen(selector):
            return p.locator(selector).evaluate('''n=>{const r=n.getBoundingClientRect();
              return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight+.5&&
                n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}''')
        def count(key,previous):
            observed[key]=p.evaluate('clicks')-previous
            assert observed[key]==paths[key],(key,observed[key])
        def check_map(kind):
            quotes=s['sells' if kind=='sell' else 'builds']
            expected={k:q for q in quotes for k in q.get('tiles',[q['tile']])}
            actual=p.locator('#board .tile:enabled').evaluate_all("bs=>bs.map(b=>Number(b.id.slice(5)))")
            assert sorted(expected)==actual
            assert seen('#plotCommit')
            assert p.locator('#stageLedger .account b').evaluate_all("ns=>ns.length>0&&ns.every(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})")
            assert not p.locator('dialog').is_visible() and p.locator('#boardView').is_visible()
            for k,q in expected.items():
                b=p.locator(f'#tile-{k}')
                assert ('+'+f"${q['price']}" if kind=='sell' else '−'+f"${q['cost']:,}") in b.locator('.tileValue').inner_text()
                assert b.locator('.tileValue').evaluate("n=>getComputedStyle(n,'::before').content===(n.closest('button').getAttribute('aria-pressed')==='true'?'\"✓\"':'\"◇\"')")
            assert p.locator('#board .tile:disabled .tileValue').evaluate_all("ns=>ns.every(n=>getComputedStyle(n,'::before').content==='none')")
        def before_commit():
            assert p.evaluate('commits')==initial and p.evaluate('snapshot.players')==s['players']
        def read_quote(k,kind,amount):
            expect(p.locator('.plotReadout h2')).to_have_text(tiles[k]['name'])
            after=cash+(amount if kind=='sell' else -amount)
            expect(p.locator('.plotReadout .facts dd').nth(1)).to_have_text(f'${after:,}' if after>=0 else f'${-after:,} short')
            assert p.locator(f'#tile-{k}').get_attribute('aria-pressed')=='true'
        if mode.startswith('direct-'):
            kind=mode[7:]
            q=s['builds'][1] if kind=='build' else next(q for q in s['sells'] if all(q['tile'] not in b['tiles'] for b in s['builds']))
            k=q['tile'];amount=q.get('cost',q.get('price'));begin=p.evaluate('clicks')
            p.click(f'#tile-{k}');read_quote(k,kind,amount);before_commit();p.click('#plotCommit')
            count(kind+'-from-board',begin);new=p.evaluate('snapshot')
            assert new['players'][s['turn']]['cash']==cash+(amount if kind=='sell' else -amount)
            assert (new['owners'][k] is None) if kind=='sell' else (new['levels'][k]==s['levels'][k]+1)
            p.close();continue
        if mode=='expensive':
            p.keyboard.press('i');check_map('build')
            assert p.locator('[data-plot=short]').count()==len(s['builds'])
            p.click(f'#tile-{member}');assert not p.locator('#plotCommit').is_enabled()
            read_quote(member,'build',s['builds'][1]['cost'])
            p.keyboard.press('Escape');before_commit();p.close();continue
        begin=p.evaluate('clicks');p.click('#manageDeeds')
        check_map('build');expect(p.locator('#plotCommit')).to_be_enabled()
        p.click('#plotCancel');count('hold',begin);before_commit()
        # A first click on an eligible board tile also enters the same interaction.
        p.click(f"#tile-{project['tile']}");read_quote(project['tile'],'build',project['cost'])
        p.keyboard.press('Escape');before_commit()
        begin=p.evaluate('clicks');p.click('#manageDeeds')
        switched=p.evaluate('clicks')
        if mode=='free':
            selected=int(p.locator('.tile[aria-pressed=true]').get_attribute('id')[5:])
            p.click('[data-mode=sell]');check_map('sell')
            q=next(q for q in s['sells'] if q['tile']==selected)
            read_quote(selected,'sell',q['price']);count('switch-use',switched);before_commit()
            begin=p.evaluate('clicks')
            q=next(q for q in s['sells'] if q['tile']!=selected and tiles[q['tile']]['group']==tiles[selected]['group'])
            p.click(f"#tile-{q['tile']}");read_quote(q['tile'],'sell',q['price'])
            expect(p.locator('.plotReadout')).to_contain_text('Breaks the set')
            expect(p.locator('.plotReadout .facts dd').nth(2)).to_have_text(f"${s['rents'][q['tile']]}")
            before_commit();p.screenshot(path=root/'board-sale.png');p.click('#plotCommit');count('sale-other',begin)
            sold=p.evaluate('snapshot')
            assert sold['owners'][q['tile']] is None and sold['players'][s['turn']]['cash']==cash+q['price']
        else:
            p.click(f'#tile-{member}');check_map('build')
            q=next(q for q in s['builds'] if member in q['tiles'])
            read_quote(member,'build',q['cost'])
            if mode=='district':
                assert member!=q['tile'] and p.locator('[data-scope=target]').count()==len(q['tiles'])
                count('district-member',switched)
                expect(p.locator('.plotReadout')).to_contain_text(f"All {len(q['tiles'])} deeds improve")
            before_commit();p.screenshot(path=root/f'build-{mode}.png')
            if mode=='even':
                for w,h in [(320,680),(390,844)]:
                    p.set_viewport_size({'width':w,'height':h})
                    p.click(f"#tile-{project['tile']}");p.click(f'#tile-{member}')
                    assert seen(f'#tile-{member}') and seen('#plotCommit') and p.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    assert p.locator('#stageLedger .account b').evaluate_all('ns=>ns.every(n=>n.getBoundingClientRect().top>=0&&n.getBoundingClientRect().bottom<=innerHeight)')
                    if w==390:p.screenshot(path=root/'board-phone.png')
                    p.click('#plotLadder');assert p.locator('#content .curve tbody tr').count()==5;p.click('#close')
                p.set_viewport_size({'width':1366,'height':768})
                p.click('#plotCancel');p.click(f"#tile-{project['tile']}");p.click('#plotCancel')
                begin=p.evaluate('clicks');p.click('#manageDeeds');p.click(f'#tile-{member}');before_commit()
            p.click('#plotCommit')
            if mode=='even':count('build-other',begin)
            updated=p.evaluate('snapshot')
            assert updated['levels']==[lv+(k in q['tiles']) for k,lv in enumerate(s['levels'])]
            assert updated['players'][s['turn']]['cash']==cash-q['cost']
            if mode=='even':
                p.set_viewport_size({'width':390,'height':844});p.click(f'#tile-{member}')
                expect(p.locator('#content')).to_contain_text('lower-level')
                p.locator('#modal').screenshot(path=root/'built-deed.png');p.click('#close')
        expect(p.get_by_role('button',name='Roll dice',exact=True)).to_be_visible()
        p.close()
    browser.close()
(root/'property-results.json').write_text(json.dumps({'observed':observed},indent=2)+'\n')
