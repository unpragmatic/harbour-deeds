"""Play shipped boards through the UI; observe (never replace) Rust's accepted snapshots."""
import json
from contextlib import contextmanager
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parent
observed={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    p=browser.new_page(viewport={'width':1366,'height':768},reduced_motion='reduce')
    errors=[]
    p.on('pageerror',lambda e: errors.append(str(e)))
    p.clock.install()
    p.add_init_script('''window.seed=1;crypto.getRandomValues=a=>(a[0]=seed,a);
      window.clicks=window.commits=0;addEventListener('click',e=>{if(e.isTrusted)window.clicks++},true);
      const decode=TextDecoder.prototype.decode;TextDecoder.prototype.decode=function(...args){
        const text=decode.apply(this,args);if(text.startsWith("{")&&text.includes('"builds":')){
          window.snapshot=JSON.parse(text);window.commits++;
        }return text;
      }''')
    p.goto((root.parent/'dist/index.html').as_uri())
    button=lambda label:p.get_by_role('button',name=label,exact=True)
    state=lambda:p.evaluate('snapshot')
    def setup(n,board='compact',seed=1):
        p.evaluate('value=>window.seed=value',seed)
        p.click('#setupBtn');p.locator('#advanced summary').click()
        p.select_option('#map',board);p.select_option('#clock','0')
        for i in range(1,4):p.select_option(f'#seat-{i}','human' if i<n else 'off')
        p.click('#start');expect(button('Roll dice')).to_be_visible()
    def advance(stop,buyers=None):
        buyers=buyers or {}
        for _ in range(90):
            s=state()
            if stop(s):return s
            if s['phase']=='end':p.clock.run_for(1100)
            elif s['phase']=='roll':button('Roll dice').click()
            elif s['phase']=='offer':
                buy=p.locator('#actions .primary')
                actor=s['turn'];lot=s['players'][actor]['pos']
                if buy.is_enabled() and buyers.get(lot,actor)==actor:buy.click()
                else:button('Start auction').click()
            elif s['phase']=='auction':
                q=s['auction']
                if q['actor']==buyers.get(q['tile']) and s['players'][q['actor']]['cash']>=10:button('Bid $10').click()
                else:button('Withdraw').click()
            elif s['phase']=='guild':p.locator('#actions .primary').click()
            elif s['phase']=='works':button('Pass on refit').click()
            else:raise AssertionError(s['phase'])
        raise AssertionError('Fixture did not reach expected decision')
    def visible(selector):
        assert p.locator(selector).evaluate_all('''ns=>ns.length>0&&ns.every(n=>{
          const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight+.5&&
            r.left>=0&&r.right<=innerWidth+.5&&n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})'''),selector
    @contextmanager
    def count(key,budget):
        start=p.evaluate('clicks')
        yield
        n=p.evaluate('clicks')-start
        assert n==budget,(key,n,budget)
        observed[key]=n
    assets=lambda s:(s['players'],s['owners'],s['bonuses'],s['levels'],s['rents'],s['acquisition'])
    def mark(i,kind):
        expect(p.locator(f'#tile-{i}')).to_have_attribute('data-trade-tile',kind)
    def closed():
        expect(p.locator('#tradeDesk')).to_be_hidden()
        assert not p.locator('[data-trade-tile]').count()

    setup(3)
    initial=p.evaluate('commits')
    button('Draft trade').click()
    expect(p.locator('#tradeError')).to_contain_text('No tradable deeds')
    expect(button('Send proposal')).to_be_disabled()
    p.focus('#giveCash');p.keyboard.press('Escape');closed()
    expect(button('Draft trade')).to_be_focused()
    assert p.evaluate('commits')==initial and not state()['traded']

    # Inner Harbor, three local seats. By round five Seat 3 needs Seat 1's
    # Silk Arcade, although Copper Yard is the first rival deed in board order.
    s=advance(lambda s:s['phase']=='roll' and s['round']==5 and s['turn']==2)
    initial=p.evaluate('commits')
    assert s['owners'][12]==0 and s['owners'][14]==s['owners'][11]==2
    button('Draft trade').click();mark(12,'in')
    expect(p.locator('#tradeImpact')).to_contain_text('Seat 3: 2 → 3/3 · Completes set')
    p.keyboard.press('b');expect(p.locator('#tile-12')).to_be_focused()
    with count('trade-target',1):
        p.click('#tile-1');mark(1,'in')
        expect(p.locator('[data-partner="1"]')).to_have_attribute('aria-pressed','true')
    with count('trade-partner',1):
        p.click('[data-partner="0"]');mark(12,'in')
    with count('trade-give',1):
        p.click('#tile-11');mark(11,'out');mark(12,'in')
    # Arrow keys navigate eligible tiles without editing. Space toggles a leg.
    p.keyboard.press('ArrowRight');expect(p.locator('#tile-12')).to_be_focused();mark(11,'out')
    p.keyboard.press('Space');mark(12,'option')
    p.click('#tile-12');p.click('#tile-7')
    for selector,value,msg in [('#giveCash','10000','has only'),('#giveCash','0.5','whole'),('#takeCash','2','only one side')]:
        p.fill('#giveCash','1');p.fill(selector,value)
        expect(p.locator('#tradeError')).to_contain_text(msg);expect(button('Send proposal')).to_be_disabled()
    p.fill('#takeCash','0');p.fill('#giveCash','30')
    with count('trade-terms',0):
        expect(p.locator('#outAsset')).to_have_text('Iron Works + $30')
        expect(p.locator('#inAsset')).to_have_text('Silk Arcade')
        assert p.locator('#tradeBalances b').all_text_contents()==['$270','$540']
        expect(p.locator('#tradeImpact')).to_contain_text('Foundry')
        expect(p.locator('#tradeImpact')).to_contain_text('Market')
        for selector in ('#outAsset','#inAsset','#tradeBalances b','#tradeImpact','#tradeSend','#tile-7','#tile-12','#stageLedger .account b'):visible(selector)
    assert p.evaluate('commits')==initial
    # Keyboard can leave from a cash field; the explicit Cancel path is one click.
    with count('trade-cancel',1):p.click('#tradeCancel');closed()
    assert state()==s and p.evaluate('commits')==initial
    button('Draft trade').click();mark(7,'out');p.fill('#giveCash','30');p.click('#tradeSend')
    pending=state()
    assert assets(pending)==assets(s)
    assert pending['trade']=={'from':2,'to':0,'give_cash':30,'take_cash':0,'give_deed':7,'take_deed':12}
    with count('trade-response',0):
        mark(12,'out');mark(7,'in')
        expect(p.locator('#outAsset')).to_have_text('Silk Arcade')
        expect(p.locator('#inAsset')).to_have_text('Iron Works + $30')
        assert p.locator('#tradeBalances b').all_text_contents()==['$540','$270']
        assert p.locator('.tile:enabled').count()==0
        for selector in ('#outAsset','#inAsset','#tradeBalances b','#tradeImpact','#actions button','#tile-7','#tile-12'):visible(selector)
    for w,h in [(390,844),(320,680)]:
        p.set_viewport_size({'width':w,'height':h})
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
        for selector in ('#tile-7','#tile-12','#actions button','#stageLedger .account b'):visible(selector)
    p.keyboard.press('Escape');assert state()==pending
    with count('accept-trade',1):button('Accept trade').click()
    closed();s=state()
    assert s['owners'][7]==0 and s['owners'][12]==2
    assert [s['players'][who]['cash'] for who in [0,2]]==[540,270]
    assert s['traded'] and s['turn']==2 and s['phase']=='roll'
    p.set_viewport_size({'width':1366,'height':768})
    # The acquired set is now complete. Preview breaking it, decline, then build
    # in the real district and check that all siblings are excluded on both sides.
    s=advance(lambda s:s['phase']=='roll' and s['turn']==0)
    button('Draft trade').click()
    if p.locator('#tile-12').get_attribute('data-trade-tile')!='in':p.click('#tile-12')
    p.fill('#giveCash','1');p.fill('#takeCash','0')
    expect(p.locator('#tradeImpact')).to_contain_text('Seat 3: 3 → 2/3 · Breaks set')
    p.click('#tradeSend');expect(p.locator('#tradeImpact')).to_contain_text('Breaks set')
    with count('decline-trade',1):button('Decline').click()
    closed();assert assets(state())==assets(s)
    advance(lambda s:s['phase']=='roll' and s['turn']==2)
    p.keyboard.press('i');p.click('#plotCommit')
    for _ in range(2):
        button('Draft trade').click()
        for k in (11,12,14):
            mark(k,'locked');expect(p.locator(f'#tile-{k}')).to_be_disabled()
        p.click('#tradeCancel')
        if state()['turn']==2:advance(lambda s:s['phase']=='roll' and s['turn']==0)

    # Refit fixture shared with the desktop/room walks: Seat 2 buys Seat 1's
    # commissioned Dry Dock. The +$43 disappears on acceptance, not proposal.
    setup(2,'grand',54)
    for _ in range(2):button('Roll dice').click();p.locator('#actions .primary').click();p.clock.run_for(1100)
    button('Roll dice').click();button('Review refit').click();p.click('#plotCommit')
    p.clock.run_for(1100);s=state();assert s['bonuses'][12]==43 and s['turn']==1
    with count('send-offer',2):
        button('Draft trade').click();mark(12,'in')
        expect(p.locator('#tradeRefits')).to_have_text('Dry Dock: accepting cancels the unused $43 refit.')
        p.click('#tradeSend')
    mark(12,'out');expect(p.locator('#tradeRefits')).to_contain_text('unused $43 refit')
    assert assets(state())==assets(s)
    button('Accept trade').click();assert state()['bonuses'][12]==0 and state()['owners'][12]==1
    # Replacing a table aborts the active controller without leaving trade controls behind.
    advance(lambda s:s['phase']=='roll' and not s['traded'])
    button('Draft trade').click();setup(2);closed()
    assert not p.locator('.tile:disabled').count()

    # The firsthand match's opportunity, recreated on the unmodified Grand map:
    # buy at list or let the intended owner win an ordinary uncontested auction.
    setup(3,'grand',1)
    buyers={11:0,12:0,29:0,14:2,26:2,27:2}
    s=advance(lambda s:s['phase']=='roll' and s['turn']==0 and all(s['owners'][k]==o for k,o in buyers.items()),buyers)
    assert s['round']==6
    with count('mutual-set',1):
        button('Draft trade').click();mark(29,'out');mark(14,'in')
        expect(p.locator('#tradeImpact')).to_contain_text('Shipyards')
        expect(p.locator('#tradeImpact')).to_contain_text('Exchange')
        assert p.locator('#tradeImpact b').all_text_contents().count(' · Completes set')==2
        expect(p.locator('#outAsset')).to_have_text('Grain Quay')
        expect(p.locator('#inAsset')).to_have_text('Spar Yard + $40')
        expect(p.locator('[data-partner="2"]')).to_have_attribute('aria-pressed','true')
    p.screenshot(path=root/'draft.png')
    for w,h in [(320,680),(390,844)]:
        p.set_viewport_size({'width':w,'height':h})
        p.click('#tile-29');mark(29,'option');expect(button('Send proposal')).to_be_disabled()
        p.click('#tile-29');mark(29,'out');expect(button('Send proposal')).to_be_enabled()
        for selector in ('#tradeSend','#tradeCancel','#tile-29','#stageLedger .account b'):visible(selector)
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth') and state()==s
    p.set_viewport_size({'width':1366,'height':768})
    with count('trade-cash',1):
        p.click('#takeCash');p.keyboard.press('Control+a');p.keyboard.type('30')
        expect(p.locator('#inAsset')).to_have_text('Spar Yard + $30')
    after=[f"${s['players'][0]['cash']+30:,}",f"${s['players'][2]['cash']-30:,}"]
    assert p.locator('#tradeBalances b').all_text_contents()==after and state()==s
    p.click('#tradeSend');mark(14,'out');mark(29,'in');assert assets(state())==assets(s)
    assert p.locator('#tradeImpact b').all_text_contents().count(' · Completes set')==2
    assert p.locator('#tradeBalances b').all_text_contents()==after[::-1]
    for selector in ('#outAsset','#inAsset','#tradeBalances b','#actions button','#tile-29','#tile-14'):visible(selector)
    p.screenshot(path=root/'trade.png')
    p.set_viewport_size({'width':390,'height':844})
    for selector in ('#actions button','#tile-29','#tile-14','#tradeBalances b'):visible(selector)
    p.screenshot(path=root/'trade-phone.png')
    button('Accept trade').click();f=state()
    assert all(f['owners'][i]==0 for i in (11,12,14)) and all(f['owners'][i]==2 for i in (26,27,29))
    assert [f['players'][i]['cash'] for i in (0,2)]==[s['players'][0]['cash']+30,s['players'][2]['cash']-30]
    assert not errors,errors
    browser.close()
(root/'trade-results.json').write_text(json.dumps({'observed':observed},indent=2)+'\n')
