"""Measure input events, line-of-sight to cash, and contrast on rendered game surfaces."""
from contextlib import contextmanager
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parent
inventory=json.loads((root/'clicks.json').read_text())
cost={k:n for rows in inventory['interactions'].values() for k,_,_,n in rows}
paths={k:sum(cost[a] for a in path.split()) for k,_,_,path,_ in inventory['scenarios']}
observed={}; ratios={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    p=browser.new_page(viewport={'width':1366,'height':768},reduced_motion='reduce')
    p.add_init_script('crypto.getRandomValues=a=>(a[0]=1,a);window.clicks=0;addEventListener("click", e=>{if(e.isTrusted)window.clicks++},true)')
    p.goto((root.parent/'dist/index.html').as_uri())
    button=lambda name:p.get_by_role('button',name=name,exact=True)
    @contextmanager
    def run(key):
        begin=p.evaluate('window.clicks')
        yield
        n=p.evaluate('window.clicks')-begin
        assert n==paths[key],(key,n,paths[key])
        observed[key]=n

    def in_sight(selector):
        return p.locator(selector).evaluate_all("""nodes=>nodes.length>0&&nodes.every(n=>{
          const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5&&
            [r.top+2,r.bottom-2].every(y=>(n.closest('button.tile')||n).contains(document.elementFromPoint(r.left+r.width/2,y)))})""")
    def cash(sheet=False):
        sel=('#sheetLedger' if sheet else '#stageLedger')+' .account b'
        assert p.locator(sel).all_text_contents()==['$850']*4
        assert in_sight(sel)

    def pair(name,text,paper,part='color',threshold=4.5):
        fg=p.locator(text).first.evaluate('(e,p)=>getComputedStyle(e)[p]',part)
        bg=p.locator(paper).first.evaluate('e=>getComputedStyle(e).backgroundColor')
        def light(rgb):
            assert rgb.startswith('rgb('),(name,rgb)
            c=[float(v)/255 for v in rgb[4:-1].split(',')]
            return sum(w*(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4) for w,v in zip([.2126,.7152,.0722],c))
        hi,lo=sorted([light(fg),light(bg)],reverse=True)
        ratio=(hi+.05)/(lo+.05);assert ratio>=threshold,(name,fg,bg,ratio)
        ratios[name]={'fg':fg,'bg':bg,'ratio':round(ratio,2),'minimum':threshold}

    expect(button('Roll dice')).to_be_visible()
    p.click('#setupBtn');p.locator('#advanced summary').click()
    for i in [1,2,3]:p.select_option(f'#seat-{i}','human')
    p.click('#start')
    with run('cash-board'):cash()
    with run('whose-turn'):
        assert in_sight('#controlType') and in_sight('#actions .primary')
        expect(p.locator('#controlType')).to_contain_text('Seat 1')
    pair('Cash on treasury','#stageLedger .account:not(.acting) b','#stageLedger .account:not(.acting)')
    pair('Active cash','#stageLedger .acting b','#stageLedger .acting')
    pair('Seat 1 disc','.seatDisc','.seatDisc')
    for i in range(2,5):pair(f'Seat {i} disc',f'#stageLedger .account:nth-child({i}) .seatDisc',f'#stageLedger .account:nth-child({i}) .seatDisc')
    pair('Primary command','#actions .primary','#actions .primary')
    pair('Dock phase','#phaseLabel','.desk')
    pair('Inspector secondary text','#inspector p','#inspector')
    pair('Deed price','#tile-1 .tileValue','#tile-1')
    p.keyboard.press('Tab');p.focus('#tile-1')
    pair('Keyboard focus on deed','#tile-1','#tile-1','outlineColor',3)
    pair('Selected pane label','.switcher [aria-pressed=true]','.switcher [aria-pressed=true]')
    with run('log'):
        button('Activity').click()
        assert p.locator('#board').is_visible() and p.locator('#log').is_visible()
    with run('cash-log'):cash()
    p.screenshot(path=root/'desktop-log.png')
    button('Players').click()
    with run('cash-fleet'):cash()
    with run('inspect'):
        p.click('#tile-1')
        expect(p.locator('#inspector h2')).to_have_text('Rope Walk')
        expect(p.locator('#playersView')).to_be_hidden()
    with run('open-book'):
        button('Rulebook').click()
        p.locator('#content').evaluate('e=>e.scrollTop=e.scrollHeight')
        with run('cash-sheet'):cash(True)
        p.keyboard.press('r')
        expect(p.locator('body')).to_have_attribute('data-phase','roll')
        p.click('#close')
    with run('mute'):button('Sound effects').click()
    with run('pace-local'):
        button('Display settings').click()
        p.locator('#content input[value=fast]').click()
        expect(p.locator('#content input[value=fast]')).to_be_checked()
        p.locator('dialog').screenshot(path=root/'display-settings.png')
        p.click('#close')
    for w,h in [(1024,650),(390,844),(320,680)]:
        p.set_viewport_size({'width':w,'height':h});cash()
        button('Activity').click();cash()
        button('Rulebook').click();cash(True);p.click('#close')
    p.set_viewport_size({'width':1366,'height':768})
    p.keyboard.press('b');p.keyboard.press('r')
    with run('offered-curve'):
        expect(p.locator('#inspector h2')).to_have_text('Copper Yard')
        assert p.locator('#inspector tbody tr').count()==5
        assert in_sight('#inspector tbody tr td:last-child') and in_sight('#turn .facts dd')
    p.screenshot(path=root/'desktop-offer.png')
    assert in_sight('#tile-0 strong') and in_sight('#tile-39 strong'),p.locator('#boardView,#tile-0 strong,#tile-39 strong').evaluate_all("ns=>ns.map(n=>[n.scrollTop,n.getBoundingClientRect().toJSON()])")
    button('Players').click()
    with run('recover-lot'):
        button('Rent & build costs').click()
        expect(p.locator('#inspector h2')).to_have_text('Copper Yard')
        assert in_sight('#inspector tbody tr td:last-child')
    with run('pass-play'):
        button('New table').click();p.click('#passPlay')
        assert p.locator('#stageLedger .account').count()==2
    with run('roll-buy'):
        button('Roll dice').click();button('Buy · $140').click()
        expect(p.locator('#stageLedger .account b').first).to_have_text('$710')
    with run('portfolio'):
        button('Players').click();button('Copper Yard').click()
        expect(p.locator('#inspector')).to_contain_text('Owned by Seat 1')
    expect(button('Draft trade')).to_be_visible()
    with run('cancel-trade'):
        button('Draft trade').click();p.click('#close');expect(button('Draft trade')).to_be_visible()
    with run('complete-trade'):
        button('Draft trade').click();button('Send proposal').click()
        expect(p.locator('body')).to_have_attribute('data-phase','trade')
        button('Accept trade').click();expect(p.locator('#log')).to_contain_text('accepted')
    button('New table').click();p.click('#passPlay');button('Roll dice').click()
    with run('pass-to-sale'):
        button('Start auction').click()
        with run('next-bid'):
            assert in_sight('.bidClock progress') and in_sight('#actions .primary')
            pair('Bid clock text','.bidClock span','.bidClock')
            pair('Secondary command','#actions button:not(.primary)','#actions button:not(.primary)')
        with run('bid-preset'):button('Bid $10').click()
        with run('settle-now'):
            button('Withdraw').click();expect(p.locator('#stageTitle')).to_have_text('Sold · $10')
    button('New table').click();p.click('#passPlay');button('Roll dice').click();button('Start auction').click()
    with run('bid-exact'):
        button('Custom').click();p.keyboard.type('65');button('Place bid').click()
        expect(p.locator('#stageTitle')).to_have_text('$65')
    p.screenshot(path=root/'desktop-auction.png')
    # A two-player seed: buy two different deeds, then Seat 1 lands on the works.
    p.evaluate('() => {crypto.getRandomValues=a=>(a[0]=54,a)}')
    button('New table').click();p.click('#passPlay')
    for _ in range(2):
        button('Roll dice').click();p.locator('#actions .primary').click()
    button('Roll dice').click()
    expect(p.locator('body')).to_have_attribute('data-phase','works')
    with run('works-project'):
        button('Review refit').click()
        expect(p.locator('#commissionQuote')).to_contain_text('+$43')
        p.locator('#modal').screenshot(path=root/'works-quote.png')
        p.click('#commissionPay')
        expect(p.locator('#log')).to_contain_text('next rent')
    with run('cancel-sale'):
        button('Sell deed').click()
        expect(p.locator('#sellConfirm')).to_be_enabled()
        p.click('#keepDeed')
    with run('liquidate'):
        button('Sell deed').click();p.locator('#modal').screenshot(path=root/'bank-quote.png')
        before=p.locator('#stageLedger .account b').nth(1).text_content()
        payout=int(p.locator('#sellConfirm').text_content().split('$')[1].replace(',',''))
        p.click('#sellConfirm')
        assert int(p.locator('#stageLedger .account b').nth(1).text_content().strip('$').replace(',',''))==int(before.strip('$').replace(',',''))+payout
        expect(button('Roll dice')).to_be_visible()
    browser.close()
(root/'desktop-results.json').write_text(json.dumps({'observed':observed,'contrast':ratios},indent=2)+'\n')
