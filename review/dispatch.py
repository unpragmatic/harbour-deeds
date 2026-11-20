"""After build.py: measure an actual, unattended dispatch read. Add --online for real WebRTC."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time

from playwright.sync_api import expect, sync_playwright

review = Path(__file__).resolve().parent
root = review.parent
url = 'http://127.0.0.1/dispatch-audit/'
fields = ['dispatchTitle', 'dispatchAddress', 'dispatchOrder', 'dispatchResult', 'dispatchAccount']


# Inspect actual line boxes, not just DOM presence: a pinned card under another
# panel, offscreen, or clipped by the phone scroller isn't a zero-click read.
watch = """({title,ids}) => {
  function visible(el){
    if(!el)return false;
    const range=document.createRange();range.selectNodeContents(el);
    const rects=[...range.getClientRects()];
    return rects.length>0&&rects.every(r=>r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+.5&&
      r.top>=0&&r.bottom<=innerHeight+.5&&[r.left+1,r.right-1].every(x=>
        [r.top+1,r.bottom-1].every(y=>el.contains(document.elementFromPoint(x,y)))));
  }
  document.addEventListener('click',()=>{
    const clicked=performance.now(),start={...window.inputTotals},base=window.dispatchCalls;
    const wave=new Float32Array(window.auditMeter?.fftSize??0);
    let first=null,next=null,frames=0,misses=0,peak=0,animated=false;
    window.reading=new Promise((resolve,reject)=>{
      function frame(){
        const now=performance.now(),els=ids.map(id=>document.getElementById(id));
        if(els[0]?.textContent===title&&els.every(visible)){
          first??=now;frames++;
          animated||=document.getElementById('dispatchCard').getAnimations({subtree:true}).length>0;
          if(document.body.dataset.phase==='roll'&&document.querySelector('#actions [data-key=R]:enabled'))
            next??=now;
        }else if(first!==null)misses++;
        if(window.auditMeter&&now-clicked<400){
          auditMeter.getFloatTimeDomainData(wave);for(const n of wave)peak=Math.max(peak,Math.abs(n));
        }
        if(first!==null&&now-first>=6000){
          resolve({firstVisibleMs:Math.round(first-clicked),nextRollReadyMs:next===null?null:Math.round(next-clicked),
            continuouslyObservedMs:Math.round(now-first),frames,misses,animated,peak:+peak.toFixed(4),
            cardCues:dispatchCalls-base,input:Object.fromEntries(Object.keys(start).map(k=>[k,inputTotals[k]-start[k]])),
            text:els.map(el=>el?.textContent)});return;
        }
        if(now-clicked>10000){reject(Error('Dispatch not readable: '+els.map(e=>e?.innerText)));return}
        requestAnimationFrame(frame);
      }requestAnimationFrame(frame);
    });
  },{once:true,capture:true});
}"""

# Only the served audit copy is instrumented. No test hooks in the game bundle.
def audit_game():
    game = (root/'dist/index.html').read_text()
    probes = {
        'function foley(kind,delayMs=0){': "if(kind==='dispatch')window.dispatchCalls++;",
        'bus.connect(audio.destination);': 'window.auditMeter=audio.createAnalyser();bus.connect(auditMeter);',
        'engine=(await WebAssembly.instantiate(bytes)).instance.exports;': '''
          window.readJournalCard=({seed,steps,short})=>{
            session?.abort();initialize(['human','human'],'grand',0,seed);
            if(short){
              rules={...rules,cash:short==='debt'?160:20,liquidation:{...rules.liquidation,deeds:short==='debt'}};
              state=command({action:'start',seed,seats:2,rules});
            }
            const journal={seq:0};let before,move;
            for(let i=0;i<steps;i++){before=state;move=botMove(state,rules);replay(journal,move)}
            render();
            if(move.action!=='roll'||state.last_card==null||$('dispatchCard'))throw Error('Replay presented a card or fixture drifted');
            return {phase:state.phase,...dispatchReceipt(move.actor,before,state)};
          };''',
    }
    for anchor, code in probes.items():
        assert game.count(anchor) == 1, 'Rebuild first / review audit probe: '+anchor
        game = game.replace(anchor, anchor+code)
    return game


def prepare(page, game, seed, *, muted=False, pace='fast'):
    page.route(url, lambda route: route.fulfill(content_type='text/html', body=game))
    page.add_init_script(f"""
      const rng=crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]={seed},a):rng(a);
      localStorage.setItem('harbor-sound', '{'off' if muted else 'on'}');
      localStorage.setItem('harbor-presentation-v1',JSON.stringify({{pace:'{pace}',accents:true}}));
      window.dispatchCalls=0;window.inputTotals={{}};
      for(const type of ['click','pointerdown','keydown','wheel','touchstart']){{
        inputTotals[type]=0;document.addEventListener(type,e=>{{if(e.isTrusted)inputTotals[type]++}},true)
      }}""")
    page.goto(url)
    expect(page.locator('#actions [data-key=R]')).to_be_enabled()


def read_at_table(browser, game, out, phone):
    p = browser.new_page(viewport={'width': 390 if phone else 1366, 'height': 844 if phone else 768},
                         reduced_motion='reduce' if phone else 'no-preference')
    errors = []
    p.on('pageerror', lambda e: errors.append(str(e)))
    prepare(p, game, 14 if phone else 108, muted=phone)
    expect(p.locator('html')).to_have_attribute('data-motion', 'reduced' if phone else 'fast')
    p.click('#setupBtn'); p.click('#passPlay')
    roll = p.locator('#actions [data-key=R]')
    if not phone:
        # Eight actual human turns, with ordinary automatic ends. Seat 1's
        # next roll crosses Port Office and draws a charge at Bottle Post.
        for buy in [True, True, True, True, True, False, False, True]:
            roll.click()
            if buy:
                p.get_by_role('button', name='Buy · $', exact=False).click()
    title = 'Mutual aid charter' if phone else 'Fogbound cargo'
    p.evaluate(watch, {'title': title, 'ids': fields})
    roll.click()
    result = p.evaluate('window.reading')
    assert result['frames'] and not result['misses'] and result['nextRollReadyMs'] is not None, result
    assert not any(result['input'].values()) and result['cardCues'] == 1, result
    assert result['animated'] != phone and (result['peak'] > .002) != phone, result
    assert result['text'] == [title, 'To Seat 1 · Bottle Post',
                              'Carry $65 against your next rent. Keep any higher cover.' if phone else 'Pay $55 at the port office.',
                              '$65 cover in force' if phone else 'Paid $55',
                              'Cash $850 → $850' if phone else 'Port salary +$240 · Cash $240 → $425'], result
    p.screenshot(path=out/('dispatch-phone.png' if phone else 'dispatch-desktop.png'))
    # Not just a delayed End: the same piece of paper survives a different
    # accepted roll; neither reading it nor dismissing it sends a game command.
    roll.click()
    expect(p.locator('#stageTag')).to_contain_text('Seat 2')
    expect(p.locator('#dispatchTitle')).to_have_text(title)
    before = p.evaluate('inputTotals.click')
    p.click('#dismissDispatch')
    expect(p.locator('#dispatchCard')).to_have_count(0)
    dismiss = p.evaluate('inputTotals.click') - before
    assert dismiss == 1 and not errors, (dismiss, errors)
    p.close()
    return result, dismiss


def accounting(browser, game):
    p = browser.new_page()
    prepare(p, game, 1)
    receipts = {}
    for key, seed, steps, short, order, result in [
        ('owned-deeds', 104, 6, '', '$12 per owned deed × 1', 'Received $12'),
        ('permanent-levels', 84, 65, '', '$15 per permanent level × 4', 'Paid $60'),
        ('exclude-refit', 120, 26, '', 'Temporary refits do not count', 'Received $0'),
        ('no-levels', 140, 1, '', '× 0', 'Paid $0'),
        ('keep-higher-cover', 3, 26, '', '$65', '$100 cover retained'),
        ('insufficient-cash', 2, 1, 'default', 'Pay $55', 'Paid $20 of $55 · Bankrupt'),
        ('partial-payment', 100, 26, 'debt', 'Pay $55', 'Paid $46 of $55 · $9 due at draw'),
    ]:
        r = p.evaluate('opts=>readJournalCard(opts)', dict(seed=seed, steps=steps, short=short))
        assert order in r['order'] and result == r['result'], (key, r)
        receipts[key] = r
    assert p.evaluate('dispatchCalls') == 0, 'Historical journal played a dispatch cue'
    p.close()
    return receipts


def online(pw, game):
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = reserve.getsockname()[1]
    with subprocess.Popen([root/'node_modules/.bin/peerjs', '--host', '127.0.0.1', '--port', str(port)],
                          stdout=subprocess.DEVNULL) as sig:
        try:
            for _ in range(60):
                try:
                    socket.create_connection(('127.0.0.1', port), .1).close()
                    break
                except OSError:
                    time.sleep(.1)
            browser = pw.firefox.launch(firefox_user_prefs={'media.peerconnection.ice.loopback': True,
                'media.peerconnection.ice.obfuscate_host_addresses': False})
            try:
                host, guest = (browser.new_page() for _ in range(2))
                client = (root/'dist/peerjs.min.js').read_text() + f""";
                  window.Peer=class extends window.Peer{{constructor(id){{
                    super(id||undefined,{{host:'127.0.0.1',port:{port},secure:false,config:{{iceServers:[]}}}})}}}};"""
                for p in (host, guest):
                    p.route('**/peerjs.min.js', lambda r: r.fulfill(body=client, content_type='application/javascript'))
                    prepare(p, game, 14, pace='standard')
                    p.click('#setupBtn')
                host.click('#host')
                guest.click('#join'); guest.fill('#code', host.locator('#tableCode').inner_text())
                guest.click('#joinForm button')
                expect(guest.locator('#roomInfo')).to_contain_text('Device 1', timeout=18000)
                host.select_option('#owner1','1')
                host.click('#launch')
                guest.wait_for_selector('dialog[open]', state='hidden')
                guest.evaluate("""() => {window.takeTime=new Promise(resolve=>{
                  let at;function frame(){
                    if(document.querySelector('#dispatchTitle')?.textContent==='Mutual aid charter')at??=performance.now();
                    if(at&&document.querySelector('#actions [data-key=R]:enabled'))resolve(Math.round(performance.now()-at));
                    else requestAnimationFrame(frame)
                  }frame()
                })}""")
                host.locator('#actions [data-key=R]').click()
                for p in (host, guest):
                    expect(p.locator('#dispatchTitle')).to_have_text('Mutual aid charter')
                expect(guest.locator('#actions [data-key=R]')).to_be_enabled()
                handoff = guest.evaluate('takeTime')
                assert 0 < handoff < 2400, handoff
                guest.click('#dismissDispatch')
                guest.locator('#actions [data-key=R]').click()
                expect(host.locator('body')).to_have_attribute('data-phase','offer')
                expect(host.locator('#dispatchTitle')).to_have_text('Mutual aid charter')
                assert [p.evaluate('dispatchCalls') for p in (host,guest)] == [1,1]
                guest.reload(); guest.click('#resumeTable')
                expect(guest.get_by_role('button',name='Start auction')).to_be_enabled(timeout=18000)
                expect(guest.locator('#dispatchCard')).to_have_count(0)
                assert guest.evaluate('dispatchCalls') == 0
                return {'guestHandoffMs': handoff, 'privateDismissal': True, 'liveCuesPerDevice': 1, 'rejoinCues': 0}
            finally:
                browser.close()
        finally:
            sig.terminate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--online', action='store_true', help='also test live commit and rejoin on a private signaling server')
    parser.add_argument('--out', type=Path, default=review)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    game = audit_game()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'))
        try:
            desktop, dismiss = read_at_table(browser, game, args.out, False)
            phone, _ = read_at_table(browser, game, args.out, True)
            data = {'observed': {'read-dispatch': desktop['input']['click'], 'read-dispatch-phone': phone['input']['click'],
                                 'dismiss-dispatch': dismiss}, 'desktop': desktop, 'phone': phone,
                    'accounting': accounting(browser, game)}
        finally:
            browser.close()
        if args.online:
            data['online'] = online(pw, game)
    (args.out/'dispatch-results.json').write_text(json.dumps(data, indent=2, ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in data.items() if k != 'accounting'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
