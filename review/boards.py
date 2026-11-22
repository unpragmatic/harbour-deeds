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
window.guildHandoff=()=>{
  session?.abort();initialize(Array(4).fill('human'),'richup',0,4);
  let paid=false;
  for(let i=0;i<180;i++){
    const b=state,m=botMove(b,rules);state=command(m);
    if(paid||m.action==='roll'&&state.card_receipt?.draws.some(d=>rules.named_cards[d.card].title==='Guild subscription')&&state.players[1].cash===b.players[1].cash+150){
      render();liveFeedback(m,b,state);
      if(paid){
        session=new AbortController();controllers.human(state,session.signal);return;
      }
      paid=true;
    }
  }
  throw Error('Seed did not reach the four-seat subscription');
};
window.rentLanding=(waiver=false)=>{
  session?.abort();initialize(['bot','bot','bot'],'richup',0,1,undefined,currentEdition,{...charterOf(catalog.boards.richup.rules),jailRent:!waiver});
  for(let i=0;i<150;i++){
    const before=state,m=botMove(state,rules);state=command(m);
    if(m.action==='roll'&&state.rent_receipt&&(waiver?state.rent_receipt.waived:state.card_receipt?.draws.some(d=>rules.named_cards[d.card].title==='Company inspection'))){
      render();liveFeedback(m,before,state);
      return [before.players[m.actor].cash,state.players[m.actor].cash];
    }
  }
  throw Error('Seed did not exercise the requested rent landing');
};
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
    # Sample actual painted motion from the paying roll through the incoming player's turn.
    # A fresh animation object, class, or nonzero requested duration isn't evidence of movement.
    watch_instruments="""() => {
      const samples={dice:0,ticket:0,flag:0},ended={},began={};
      window.watchInstruments=new Promise(resolve=>document.addEventListener('click',()=>{
        const start=performance.now();
        function measure(now){
          for(const [key,selector] of Object.entries({dice:'#wellFaces svg',ticket:'.cashWell',flag:'.turnWell'})){
            const el=document.querySelector(selector);
            if(el?.getClientRects().length&&getComputedStyle(el).transform!=='none'){
              began[key]??=now-start;ended[key]=now-start;samples[key]++;
            }
          }
          if(now-start<3200)requestAnimationFrame(measure);else resolve({samples,ended,began});
        }requestAnimationFrame(measure);
      },{once:true,capture:true}));
    }"""
    p.emulate_media(reduced_motion='no-preference')
    p.evaluate(watch_instruments)
    roll.click()
    handoff_clicks=p.evaluate('clicks')
    expect(p.locator('#stageDetail')).to_contain_text('Rent to Seat 1 · roll 7 × 10 = $70')
    expect(p.locator('#stageLedger .account').nth(1).locator('em')).to_have_text('−$70')
    expect(p.locator('#wellTurn')).to_have_text('Seat 1')  # Automatic handoff, no new roll.
    motion=p.evaluate('watchInstruments')
    assert min(motion['samples'].values())>=2,motion
    assert motion['began']['dice']<motion['began']['ticket']<motion['began']['flag'],motion
    assert all(motion['ended'][k]-motion['began'][k]<600 for k in motion['samples']),motion
    assert not p.locator('#boardGlance').evaluate('g=>g.getAnimations({subtree:true}).length')
    seen['tactile-handoff']=p.evaluate('clicks')-handoff_clicks
    p.emulate_media(reduced_motion='reduce')
    def check_placement():
        # Test every line, including any pinned card, against the actual hit target.
        assert p.locator('#boardGlance').evaluate('''g=>{
          const bounds=g.parentElement.getBoundingClientRect();
          const [turn,roll,cash]=Array.from(g.children,n=>n.getBoundingClientRect());
          const lines=(n,b)=>{
            const range=document.createRange();range.selectNodeContents(n);
            const rects=[...range.getClientRects()];
            return rects.length&&rects.every(r=>r.width&&r.left>=b.left&&r.right<=b.right+.5&&r.top>=b.top&&r.bottom<=b.bottom+.5&&
              [r.left+1,r.right-1].every(x=>[r.top+1,r.bottom-1].every(y=>n.contains(document.elementFromPoint(x,y)))));
          };
          return [...g.querySelectorAll('#wellFaces svg')].every(el=>{
              const r=el.getBoundingClientRect();return r.width>=15&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
            })&&turn.right<=roll.left+.5&&Math.max(turn.bottom,roll.bottom)<=cash.top+.5&&
            [...g.querySelectorAll('span,strong,small')].filter(n=>n.textContent).every(n=>lines(n,bounds))&&
            [...document.querySelectorAll('#dispatchAddress,#dispatchTitle,#dispatchOrder,#dispatchResult,#dispatchAccount')].every(n=>lines(n,n.closest('#dispatchCard').getBoundingClientRect()));
        }''')
    def glance(key):
        before=p.evaluate('clicks')
        expect(p.locator('#wellRoll')).to_have_text('7')
        assert p.locator('#wellFaces svg').evaluate_all('els=>els.map(el=>el.querySelectorAll("circle").length)')==[6,1]
        expect(p.locator('#wellRoller')).to_have_text('Seat 2')
        expect(p.locator('#wellCash')).to_have_text('$70')
        expect(p.locator('#wellRoute')).to_have_text('Seat 2 → Seat 1')
        check_placement()
        p.screenshot(path=root/f'review/{key}.png')
        seen[key]=p.evaluate('clicks')-before
        assert seen[key]==0
    glance('center-handoff')
    p.set_viewport_size({'width':390,'height':844})
    p.click('#prefsBtn');p.select_option('#phoneBoard','circuit');p.click('#close')
    glance('center-handoff-phone')
    for width,height in [(1200,720),(390,844),(320,667)]:
        p.set_viewport_size({'width':width,'height':height})
        before,after=p.evaluate('rentLanding()')
        assert before-after==60
        result=p.locator('#dispatchResult')
        expect(result).to_be_visible()
        expect(result).to_be_in_viewport()
        expect(result).to_contain_text('Rent to Seat 3 · roll 6 × 10 = $60')
        expect(p.locator('#dispatchAccount')).to_have_text(f'Cash ${before:,} → ${after:,}')
        check_placement()
        p.click('[data-view=activity]')
        expect(p.locator('#lastLetter')).to_be_visible()
        expect(p.locator('#lastLetter')).to_contain_text('roll 6 × 10 = $60')
    p.set_viewport_size({'width':1366,'height':768})
    p.emulate_media(reduced_motion='no-preference')
    expect(p.locator('html')).to_have_attribute('data-motion','standard')
    expect(p.locator('#board:not(.route)')).to_be_visible()
    (before,after),dice_cues,cash_cues=p.evaluate('''()=>[rentLanding(true),
        document.querySelector('#wellFaces').getAnimations({subtree:true}).length,
        document.querySelector('.cashWell').getAnimations({subtree:true}).length]''')
    assert before==after and dice_cues>0 and cash_cues==0
    expect(p.locator('#wellCash')).to_have_text('No rent')
    expect(p.locator('#wellCashNote')).to_have_text('Seat 3 is in jail')
    assert 'Rent paused' in p.locator('#tile-13').get_attribute('aria-label')
    p.click('#tile-13');expect(p.locator('#inspector')).to_contain_text('resumes on release')
    p.click('#prefsBtn');p.uncheck('#showAccents');p.click('#close')
    p.evaluate('rentLanding()')
    expect(p.locator('#wellCash')).to_have_text('$60')
    assert not p.locator('#boardGlance').evaluate('el=>el.getAnimations({subtree:true}).length')
    p.click('#prefsBtn');p.check('#showAccents');p.click('#close')
    p.emulate_media(reduced_motion='reduce')
    # On a short phone the incoming player's actions take height away from the board.
    p.set_viewport_size({'width':320,'height':667})
    p.evaluate('() => {crypto.getRandomValues=a=>(a[0]=1,a)}')
    p.click('#setupBtn');p.locator('#advanced summary').click();p.select_option('#map','compact')
    for i in range(4):p.select_option(f'#seat-{i}','human')
    p.click('#start')
    roll.click();p.get_by_role('button',name='Buy · $140',exact=True).click()
    roll.click();roll.click();p.get_by_role('button',name='Buy · $200',exact=True).click()
    p.evaluate(watch_instruments)
    roll.click();before=p.evaluate('clicks')
    expect(p.locator('#wellTurn')).to_have_text('Seat 1')
    expect(roll).to_be_enabled()
    expect(p.locator('#wellRoller')).to_have_text('Seat 4')
    expect(p.locator('#wellCash')).to_have_text('$35')
    expect(p.locator('#wellRoute')).to_have_text('Seat 4 → Seat 1')
    check_placement()
    seen['center-four-seat-handoff']=p.evaluate('clicks')-before
    assert not any(p.evaluate('watchInstruments')['samples'].values())
    seen['tactile-quiet-phone']=p.evaluate('clicks')-before
    p.evaluate('guildHandoff()')
    expect(roll).to_be_enabled()
    expect(p.locator('#wellTurn')).to_have_text('Seat 3')
    expect(p.locator('#dispatchTitle')).to_have_text('Guild subscription')
    for line in ['Seat 1 −$50','Seat 2 +$150','Seat 3 −$50','Seat 4 −$50']:
        expect(p.locator('#wellCash')).to_contain_text(line)
    check_placement()
    p.set_viewport_size({'width':390,'height':844})
    p.goto('http://table.test/?board=richup')
    p.click('#setupBtn');p.locator('#advanced summary').click()
    expect(p.locator('#jailRent')).to_be_checked();p.uncheck('#jailRent')
    expect(p.locator('#forceAuction')).not_to_be_checked()
    p.check('#forceAuction');p.fill('#openingCash','0');p.click('#start')
    expect(p.locator('#modal')).to_be_visible()
    p.fill('#openingCash','725');p.click('#start')
    assert p.locator('#stageLedger .account b').all_text_contents()==['$725']*3
    before=p.evaluate('snapshot()')
    p.click('#prefsBtn');p.select_option('#phoneBoard','circuit');p.click('#close')
    expect(p.locator('#board.mobileLoop')).to_be_visible()
    expect(p.locator('#tile-0 .station')).to_be_visible()  # Occupied starting corner.
    boxes=[p.locator(f'#tile-{i}').bounding_box() for i in (0,10,20,30)]
    assert boxes[0]['x']==boxes[3]['x']<boxes[1]['x']==boxes[2]['x']
    assert boxes[0]['y']==boxes[1]['y']<boxes[2]['y']==boxes[3]['y']
    p.click('#tile-2');expect(p.locator('#modal h2')).to_have_text('Treasure');p.click('#close')
    assert p.evaluate('snapshot()')==before
    p.click('#draftTrade');expect(p.locator('#board.mobileLoop')).to_have_count(0)
    p.click('#tradeCancel');expect(p.locator('#board.mobileLoop')).to_be_visible()
    p.reload();expect(p.locator('#board.mobileLoop')).to_be_visible()
    p.set_viewport_size({'width':1000,'height':800});expect(p.locator('#board.mobileLoop')).to_have_count(0)
    assert not errors,errors
    (root/'review/boards-results.json').write_text(json.dumps({'observed':seen,'ownerContrast':[round(s['ratio'],2) for s in samples]},indent=2)+'\n')
    browser.close()
