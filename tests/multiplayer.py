"""Exercise a freshly built game on a private signaling server and real WebRTC."""
import contextlib
import os
import json
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, root/'build.py'], check=True)
review = (root/'review').resolve()
screens = os.environ.get('REVIEW_SCREEN_DIR')
if screens:
    directory = Path(screens).resolve()
    if not directory.is_relative_to(review):
        raise ValueError('REVIEW_SCREEN_DIR must be inside the test review directory')
    directory.mkdir(parents=True, exist_ok=True)

def capture(locator, name):
    if screens:
        target = directory / name
        if target.is_symlink():
            raise ValueError('Refusing to overwrite a symlink')
        locator.screenshot(path=target)

with contextlib.ExitStack() as stack:
    http = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=root/'dist'))
    threading.Thread(target=http.serve_forever, daemon=True).start()
    stack.callback(http.server_close)
    stack.callback(http.shutdown)
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = reserve.getsockname()[1]
    sig = subprocess.Popen([root/'node_modules/.bin/peerjs', '--host', '127.0.0.1', '--port', str(port)])
    stack.callback(sig.wait)
    stack.callback(sig.terminate)
    for attempt in range(50):
        try:
            socket.create_connection(('127.0.0.1', port), 0.1).close()
            break
        except OSError:
            time.sleep(.1)
    pw = stack.enter_context(sync_playwright())
    browser = pw.firefox.launch(firefox_user_prefs={'media.peerconnection.ice.loopback': True,
        'media.peerconnection.ice.obfuscate_host_addresses': False})
    stack.callback(browser.close)
    pages = [browser.new_page() for _ in range(3)]
    host, guest, other = pages
    visitor = browser.new_page()
    errors = []
    for p in [*pages, visitor]:
        p.on('pageerror', lambda e: errors.append(str(e)))
        # Substitute only discovery and ICE configuration; keep the real WebRTC data channel.
        client = (root/'dist/peerjs.min.js').read_text() + f"""
        ;window.Peer = class extends window.Peer {{
          constructor(id) {{super(id || undefined,{{host:'127.0.0.1',port:{port},secure:false,config:{{iceServers:{json.dumps(json.loads(os.environ.get('TEST_ICE_SERVERS','[]')))}}}}})}}
        }};"""
        p.route('**/peerjs.min.js', lambda route: route.fulfill(body=client, content_type='application/javascript'))
        p.add_init_script('const rng=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]=1,a):rng(a)')
        p.goto(f'http://127.0.0.1:{http.server_port}/')
        p.click('#setupBtn')
        assert p.locator('#clock').input_value() == '5'
    # Local and host forms reset all board-owned settings, but not the human clock.
    host.locator('#advanced summary').click()
    host.select_option('#policy','free');host.select_option('#clock','15')
    host.select_option('#map','richup')
    assert host.locator('#policy').input_value()=='even' and host.locator('#clock').input_value()=='15'
    assert host.locator('#victory').input_value()=='elimination' and host.locator('#roundLimit').input_value()=='30'
    assert host.locator('#debtDeeds').is_checked() and host.locator('#debtLevels').is_checked()
    host.click('#start');expect(host.locator('#boardName')).to_have_text('RichUp Classic')
    host.click('#setupBtn');host.click('#host')
    code = host.locator('#tableCode').inner_text()
    assert len(code) == 6
    for i, p in enumerate([guest, other], start=1):
        p.click('#join')
        p.fill('#code', code.lower())
        p.locator('#joinForm button').click()
        expect(p.locator('#roomInfo')).to_contain_text(f'Device {i}', timeout=18000)
    capture(guest.locator('#modal'), 'guest-wait.png')
    host.select_option('#map', 'outer')
    assert host.locator('#victory').input_value()=='net_worth' and host.locator('#roundLimit').input_value()=='18'
    assert not host.locator('#debtDeeds').is_checked() and not host.locator('#debtLevels').is_checked()
    host.select_option('#clock','5')
    host.fill('#openingCash','876')
    host.select_option('#victory','elimination');host.check('#debtDeeds');host.check('#debtLevels')
    host.select_option('#owner0', '1')
    host.select_option('#owner1', '1')
    host.select_option('#owner2', '2')
    host.select_option('#owner3', '-1')
    capture(host.locator('#modal'), 'host-lobby.png')
    host.click('#launch')
    for p in pages:
        expect(p.locator('.tile')).to_have_count(28)
        expect(p.locator('#round')).to_contain_text('LAST SHIP STANDING')
        assert p.locator('#stageLedger .account b').all_text_contents()==['$876']*4
    expect(host.get_by_role('button', name='Roll dice')).to_have_count(0)
    expect(guest.get_by_role('button', name='Roll dice')).to_be_visible()
    for n in range(16):
        acting = next(p for p in pages if p.locator('#actions').get_by_role('button', name='Roll dice').count())
        acting.get_by_role('button', name='Roll dice').click()
        expect(acting.locator('body')).not_to_have_attribute('data-phase','roll')
        if acting.locator('body').get_attribute('data-phase') == 'offer':
            break
        time.sleep(1.2)
    acting.get_by_role('button', name='Start auction').click()
    acting.get_by_role('button', name='Bid $10', exact=True).click()
    expect(guest.locator('#controlType')).to_contain_text('Seat 2')
    other.reload()
    expect(other.locator('#resumeTable')).to_have_text(f'Rejoin table {code}')
    expect(host.locator('#actions')).to_contain_text('Waiting for Device 2 to rejoin')
    expect(guest.locator('#actions')).to_contain_text('Table paused')
    expect(guest.get_by_role('button', name='Withdraw')).to_have_count(0)
    before = host.locator('#log').inner_text()
    left = host.locator('.bidClock progress').get_attribute('value')
    time.sleep(5.2)
    assert host.locator('.bidClock progress').get_attribute('value') == left
    assert host.locator('#log').inner_text() == before
    # A fresh browser with the code cannot claim the absent device's seat.
    visitor.click('#join')
    visitor.fill('#code', code)
    visitor.locator('#joinForm button').click()
    expect(visitor.locator('#reason')).to_contain_text('unavailable')
    # Rejoin a running host mid-auction. Then take the host offline as well.
    other.click('#resumeTable')
    expect(guest.get_by_role('button', name='Withdraw')).to_be_visible()
    expect(other.locator('#stage[data-live]')).to_have_count(0)
    expect(other.locator('#stageTag')).to_have_text('At auction')
    host.reload()
    expect(host.locator('#resumeTable')).to_have_text(f'Rehost table {code}')
    capture(host.locator('#modal'), 'recovery.png')
    for p in (guest, other):
        expect(p.locator('#reason')).to_contain_text('disconnected', timeout=15000)
    host.click('#resumeTable')
    expect(host.locator('#actions')).to_contain_text('Table paused')
    assert host.locator('#log').inner_text() == before
    for p in (other, guest):  # Reverse arrival order must not change seat ownership.
        p.click('#savedTable')
        p.click('#resumeTable')
        expect(p.locator('.tile')).to_have_count(28)
    expect(guest.get_by_role('button', name='Withdraw')).to_be_visible()
    expect(other.get_by_role('button', name='Withdraw')).to_have_count(0)
    expect(host.locator('#stage[data-live]')).to_have_count(0)
    expect(guest.locator('#round')).to_contain_text('LAST SHIP STANDING')
    # Guest modal does not pause the host clock; bidding authority transfers to device 2.
    guest.click('#rulesBtn')
    expect(other.get_by_role('button', name='Bid $20', exact=True)).to_be_visible(timeout=8000)
    other.get_by_role('button', name='Withdraw').click()
    guest.click('#close')
    expect(guest.get_by_role('button', name='Roll dice')).to_be_visible(timeout=15000)
    for p in pages[1:]:
        assert p.locator('#register').inner_text() == host.locator('#register').inner_text()
        assert p.locator('#log').inner_text() == host.locator('#log').inner_text()
    other.click('#setupBtn')
    other.once('dialog', lambda dialog: dialog.accept())
    other.click('#leave')
    expect(host.locator('#reason')).to_contain_text('deliberately left')
    for p in pages:
        expect(p.locator('#reason')).to_be_visible()
        p.reload()
        p.click('#setupBtn')
        expect(p.locator('#savedTable')).to_have_count(0)
    # One guest operates two seats. Both tile-bearing commands must survive the host intent filter.
    host.evaluate("""()=>{const old=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>
      a instanceof Uint32Array&&a.length===1?(a[0]=54,a):old(a)}""")
    host.click('#host');code=host.locator('#tableCode').inner_text()
    guest.click('#join');guest.fill('#code',code);guest.locator('#joinForm button').click()
    expect(guest.locator('#roomInfo')).to_contain_text('Device 1')
    host.select_option('#map','grand');host.select_option('#owner0','1');host.select_option('#owner1','1')
    host.click('#launch')
    for _ in range(2):
        guest.get_by_role('button',name='Roll dice',exact=True).click()
        expect(guest.locator('body')).to_have_attribute('data-phase','offer')
        guest.locator('#actions .primary').click()
        expect(guest.locator('body')).not_to_have_attribute('data-phase','offer')
    guest.get_by_role('button',name='Roll dice',exact=True).click()
    guest.get_by_role('button',name='Review refit').click()
    assert not guest.locator('#modal').is_visible() and not host.locator('#propertyDesk').is_visible()
    guest.click('#plotCommit')
    expect(host.locator('#log')).to_contain_text('next rent')
    guest.get_by_role('button',name='Manage deeds').click();guest.click('#plotCommit')
    expect(host.locator('#stage[data-live=sell]')).to_have_count(1)
    expect(guest.locator('#stage[data-live=sell]')).to_have_count(1)
    assert host.locator('#stageLedger').inner_text()==guest.locator('#stageLedger').inner_text()
    host.click('#setupBtn');host.once('dialog',lambda dialog:dialog.accept());host.click('#leave')
    expect(guest.locator('#reason')).to_contain_text('ended')
    # Guest buys the first deed. A host draft is private and is discarded on a
    # room pause. Only the guest can answer the eventual host proposal.
    host.click('#retry');host.click('#host');code=host.locator('#tableCode').inner_text()
    guest.click('#retry');guest.click('#join');guest.fill('#code',code);guest.locator('#joinForm button').click()
    expect(guest.locator('#roomInfo')).to_contain_text('Device 1')
    host.select_option('#owner0','1');host.select_option('#owner1','0');host.click('#launch')
    guest.get_by_role('button',name='Roll dice',exact=True).click()
    expect(guest.locator('body')).to_have_attribute('data-phase','offer')
    guest.locator('#actions .primary').click()
    host.click('#draftTrade');expect(guest.locator('#tradeDesk')).to_be_hidden()
    guest.reload();expect(host.locator('#actions')).to_contain_text('Table paused')
    expect(host.locator('[data-trade-tile]')).to_have_count(0)
    guest.click('#resumeTable');host.click('#draftTrade')
    before=host.locator('#stageLedger .account b').all_text_contents()
    host.click('#tradeSend')
    for p in (host,guest):
        expect(p.locator('body')).to_have_attribute('data-trade','response')
        expect(p.locator('#tile-12')).to_have_attribute('data-trade-tile','out')
        assert p.locator('#stageLedger .account b').all_text_contents()==before
    expect(host.locator('#actions')).to_contain_text('Waiting for Device 1')
    expect(host.get_by_role('button',name='Accept trade')).to_have_count(0)
    expect(host.locator('#tradeDesk h3').first).to_have_text('Seat 1 gives')
    expect(guest.locator('#tradeDesk h3').first).to_have_text('You give')
    after=guest.locator('#tradeBalances b').all_text_contents()
    guest.get_by_role('button',name='Accept trade').click()
    for p in (host,guest):
        expect(p.locator('#log')).to_contain_text('accepted')
        expect(p.locator('#tradeDesk')).to_be_hidden()
        assert p.locator('#stageLedger .account b').all_text_contents()==after
        expect(p.locator('#tile-12')).to_have_attribute('aria-label',re.compile('Owned by Seat 2'))
    host.click('#setupBtn');host.once('dialog',lambda dialog:dialog.accept());host.click('#leave')
    expect(guest.locator('#reason')).to_contain_text('ended')
    # The host can start the standalone board without hand-entering its charter.
    host.click('#retry');host.click('#host');code=host.locator('#tableCode').inner_text()
    host.select_option('#policy','district');host.select_option('#map','richup')
    expect(host.locator('#forceAuction')).not_to_be_checked()
    host.check('#forceAuction');host.fill('#openingCash','910');host.uncheck('#jailRent')
    guest.click('#retry');guest.click('#join');guest.fill('#code',code);guest.locator('#joinForm button').click()
    expect(guest.locator('#roomInfo')).to_contain_text('Device 1')
    # Enrollment redraws the lobby. Both board defaults and subsequent overrides survive.
    expect(host.locator('#policy')).to_have_value('even')
    host.select_option('#owner1','1');host.click('#launch')
    for p in (host,guest):
        expect(p.locator('#boardName')).to_have_text('RichUp Classic')
        expect(p.locator('#round')).to_contain_text('LAST SHIP STANDING')
        expect(p.locator('.tile')).to_have_count(40)
    config=host.evaluate("JSON.parse(localStorage.getItem('harbor-deeds.table.v2')).config")
    assert config['map']=='richup' and config['policy']=='even'
    assert config['charter']=={'victory':'elimination','rounds':30,'deeds':True,'improvements':True,'cash':910,'forceAuction':True,'jailRent':False}
    guest.click('#rulesBtn');expect(guest.locator('#content')).to_contain_text('rent-free until the owner is released');guest.click('#close')
    host.get_by_role('button',name='Roll dice').click()
    host.get_by_role('button',name='Start auction').click()
    for p in (host,guest):expect(p.locator('body')).to_have_attribute('data-phase','auction')
    host.click('#setupBtn');host.once('dialog',lambda dialog:dialog.accept());host.click('#leave')
    expect(guest.locator('#reason')).to_contain_text('ended')
    # A current map ID is invalid in any edition whose snapshot did not include it.
    for edition in (None,'dockworks-1','charter-1','airports-1'):
        invalid={**config}
        if edition:invalid['edition']=edition
        else:del invalid['edition']
        if edition in (None,'dockworks-1'):del invalid['charter']
        host.evaluate("""([code,config])=>localStorage.setItem('harbor-deeds.table.v2',JSON.stringify({
          role:'host',code,config,keys:{1:'e'.repeat(64)},remaining:0,journal:[]}))""",[code,invalid])
        host.reload();host.click('#resumeTable')
        expect(host.locator('#reason')).to_contain_text('Invalid host settings')
    # A host journal created before rules editions existed must use its original map and prices.
    host.evaluate("""code=>localStorage.setItem('harbor-deeds.table.v2',JSON.stringify({
      role:'host',code,config:{owners:[0,1],seconds:5,map:'grand',seed:1,policy:'even'},
      keys:{1:'e'.repeat(64)},remaining:5000,journal:[{action:'roll',actor:0},{action:'buy',actor:0},{action:'end',actor:0}]
    }))""",code)
    host.reload();host.click('#resumeTable')
    expect(host.locator('#actions')).to_contain_text('Waiting for Device 1 to rejoin')
    expect(host.locator('#tile-20')).to_contain_text('Beacon Post')
    expect(host.locator('#stageLedger .account b').first).to_have_text('$710')
    host.click('#tile-6')
    expect(host.locator('#inspector tbody tr').nth(2).locator('td').first).to_have_text('$10')
    assert not errors, errors
