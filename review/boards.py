"""Verify the shipped rules in the inspector, not just the designer JSON."""
import json
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

root=Path(__file__).resolve().parents[1]
html=(root/'dist/index.html').read_text()
anchor='engine=(await WebAssembly.instantiate(bytes)).instance.exports;'
assert html.count(anchor)==1
html=html.replace(anchor,anchor+'''
window.snapshot=()=>JSON.stringify(state);
window.networkPreview=(offer)=>{
  session?.abort();initialize(['human','human'],'grand',0,451);
  const step=(action,actor)=>state=command({action,actor});
  for(const a of [0,1]){step('roll',a);step('buy',a);step('end',a)}
  step('roll',0);
  if(!offer){step('buy',0);step('end',0);step('roll',1);step('buy',1);step('end',1)}
  render();session=new AbortController();controllers.human(state,session.signal);
};
window.ownerSamples=()=>{
  const plots=rules.tiles.flatMap((t,i)=>t.kind==='deed'?[i]:[]).slice(0,4);
  plots.forEach((v,i)=>state.owners[v]=i);render();
  return plots.map(v=>{
    const tile=$(`tile-${v}`),header=tile.querySelector('.deedHead'),mark=tile.querySelector('.ownerMark b');
    const light=c=>{const [r,g,b]=c.match(/\\d+/g).map(Number).map(n=>n/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
    return {text:mark.textContent,ratio:(light(getComputedStyle(mark).color)+.05)/(light(getComputedStyle(header).backgroundColor)+.05),width:header.offsetWidth/tile.clientWidth};
  });
};''')
seen={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    p=browser.new_page(viewport={'width':1366,'height':768},reduced_motion='reduce')
    errors=[]
    p.on('pageerror',lambda e: errors.append(str(e)))
    p.add_init_script('window.clicks=0;addEventListener("click",e=>{if(e.isTrusted)clicks++},true)')
    p.route('http://table.test/',lambda r:r.fulfill(body=html,content_type='text/html'))
    p.goto('http://table.test/')
    def pick(key,i):
        state=p.evaluate('snapshot()');before=p.evaluate('clicks')
        p.locator(f'#tile-{i}').click()
        assert p.evaluate('snapshot()')==state
        seen[key]=p.evaluate('clicks')-before
        assert seen[key]==1
    p.wait_for_function('typeof window.snapshot==="function"')
    pick('read-network',7)
    expect(p.locator('#inspector caption')).to_contain_text('Network fares')
    assert p.locator('#inspector tbody td').all_text_contents()==['$25','$55','$100']
    p.click('#setupBtn');p.locator('#advanced summary').click()
    p.select_option('#map','richup')
    expect(p.locator('#victory')).to_have_value('elimination')
    p.click('#start')
    expect(p.locator('#mapTitle')).to_contain_text('RichUp Classic')
    expect(p.locator('#tile-0 strong')).to_have_text('Start')
    corners=[p.locator(f'#tile-{i}').bounding_box() for i in [0,10,20,30]]
    assert corners[0]['x']==corners[3]['x']<corners[1]['x']==corners[2]['x']
    assert corners[0]['y']==corners[1]['y']<corners[2]['y']==corners[3]['y']
    pick('inspect-treasure',2)
    deck=p.locator('#inspector .deckGuide')
    expect(deck.locator('dt')).to_have_count(17)
    expect(deck).to_contain_text('Guild subscription');expect(deck).not_to_contain_text('Airport connection')
    pick('read-utility',12)
    assert p.locator('#inspector tbody td').all_text_contents()==['4× dice','10× dice']
    p.click('#tile-39')
    assert p.locator('#inspector tbody tr').last.locator('td').all_text_contents()==['$200','$2,000','+$300']
    p.set_viewport_size({'width':390,'height':844})
    pick('inspect-surprise-phone',8)
    deck=p.locator('#modal .deckGuide')
    expect(deck.locator('dt')).to_have_count(17)
    expect(deck).to_contain_text('Airport connection');expect(deck).not_to_contain_text('Guild subscription')
    p.keyboard.press('Escape')
    samples=p.evaluate('ownerSamples()')
    assert [s['text'] for s in samples]==['S1','S2','S3','S4']
    assert all(s['ratio']>=4.5 and s['width']>=.85 for s in samples),samples
    p.route('http://table.test/?board=richup',lambda r:r.fulfill(body=html,content_type='text/html'))
    p.goto('http://table.test/?board=richup')
    expect(p.locator('#boardName')).to_have_text('RichUp Classic')
    p.set_viewport_size({'width':1366,'height':768})
    p.evaluate('networkPreview(true)')
    before=p.evaluate('clicks')
    expect(p.locator('#turn .stakes')).to_contain_text('$55 per rival landing at each, up from $25')
    seen['second-airport']=p.evaluate('clicks')-before
    p.evaluate('networkPreview(false)')
    pick('sell-airport',18)
    expect(p.locator('#propertyDesk')).to_contain_text('$55 → $25')
    by_name=p.locator('.plotScope tr').filter(has_text='Sea Gate')
    expect(by_name).to_contain_text('$25')
    p.click('#plotCancel')
    p.click('#draftTrade')
    if p.locator('#tile-18').get_attribute('data-trade-tile')!='out':p.click('#tile-18')
    before=p.evaluate('clicks')
    expect(p.locator('#tradeImpact')).to_contain_text('Fare: $55 → $25')
    expect(p.locator('#tradeImpact')).to_contain_text('Fare: $0 → $25')
    seen['trade-airport']=p.evaluate('clicks')-before
    # Seed 46 gives the first seat three doubles, then three failed prison rolls.
    p.add_init_script('crypto.getRandomValues=a=>(a[0]=46,a)')
    p.goto('http://table.test/?board=richup')
    p.click('#setupBtn');p.click('#passPlay')
    roll=p.get_by_role('button',name='Roll dice')
    for streak in (1,2):
        roll.click()
        expect(p.locator('#actions')).to_contain_text('Seat 1 rolls again')
        expect(p.locator('#turn h2')).to_contain_text('Roll again')
        if streak==2:expect(p.locator('#turn')).to_contain_text('Another double sends you to prison')
    roll.click()
    expect(p.locator('#stageDetail')).to_contain_text('3 consecutive doubles')
    expect(p.locator('#actions')).to_contain_text('Next turn')
    roll.click()  # Seat 2 draws a prison card.
    roll.click()
    expect(p.locator('#stageDetail')).to_contain_text('remains in prison')
    roll.click()
    expect(p.locator('#stageDetail')).to_contain_text('Released on doubles')
    p.get_by_role('button',name='Pass',exact=True).click()
    expect(p.locator('#actions')).to_contain_text('Next turn')
    roll.click();roll.click();roll.click()
    expect(p.locator('#stageDetail')).to_contain_text('served their time and can move next turn')
    # Buy both companies before Seat 2 lands at Power Company on a different roll.
    p.evaluate('() => {crypto.getRandomValues=a=>(a[0]=1769,a)}')
    p.click('#setupBtn');p.click('#passPlay')
    buy=p.get_by_role('button',name='Buy · $150',exact=True)
    decline=p.get_by_role('button',name='Pass',exact=True)
    roll.click();buy.click()
    expect(p.locator('#stageDetail')).to_have_text('Seat 1 paid $150 · Rent 4× dice')
    for _ in range(2):
        roll.click();decline.click()
    roll.click();buy.click()
    expect(p.locator('#stageDetail')).to_contain_text('Rent 10× dice')
    roll.click()
    expect(p.locator('#stageDetail')).to_contain_text('Rent to Seat 1 · roll 7 × 10 = $70')
    expect(p.locator('#stageLedger .account').nth(1).locator('em')).to_have_text('−$70')
    assert not errors,errors
    (root/'review/boards-results.json').write_text(json.dumps({'observed':seen,'ownerContrast':[round(s['ratio'],2) for s in samples]},indent=2)+'\n')
    browser.close()
