"""Run after npm ci, python3 build.py and playwright install firefox."""
import contextlib
import os
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import subprocess
import threading
import time
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
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
    for p in pages:
        p.on('pageerror', lambda e: print('Page error:', e))
        # Substitute only discovery and ICE configuration; keep the real WebRTC data channel.
        client = (root/'dist/peerjs.min.js').read_text() + f"""
        ;window.Peer = class extends window.Peer {{
          constructor(id) {{super(id || undefined,{{debug:3,host:'127.0.0.1',port:{port},secure:false,config:{{iceServers:{json.dumps(json.loads(os.environ.get('TEST_ICE_SERVERS','[]')))}}}}})}}
        }};"""
        p.route('**/peerjs.min.js', lambda route: route.fulfill(body=client, content_type='application/javascript'))
        p.add_init_script('const rng=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]=1,a):rng(a)')
        p.goto(f'http://127.0.0.1:{http.server_port}/')
        p.click('#setupBtn')
        assert p.locator('#clock').input_value() == '5'
    host.click('#host')
    code = host.locator('#tableCode').inner_text()
    assert len(code) == 6
    for i, p in enumerate([guest, other], start=1):
        p.click('#join')
        p.fill('#code', code.lower())
        p.locator('#joinForm button').click()
        try:
            expect(p.locator('#roomInfo')).to_contain_text(f'Device {i}', timeout=18000)
        except AssertionError:
            for tab in [host,p]:
                print([msg.text for msg in tab.console_messages()])
            raise
    host.select_option('#map', 'outer')
    host.select_option('#owner0', '1')
    host.select_option('#owner1', '1')
    host.select_option('#owner2', '2')
    host.select_option('#owner3', '-1')
    host.click('#launch')
    for p in pages:
        expect(p.locator('.tile')).to_have_count(28)
    expect(host.get_by_role('button', name='Roll dice')).to_have_count(0)
    for n in range(16):
        acting = next(p for p in pages if p.locator('#actions').get_by_role('button', name='Roll dice').count())
        acting.get_by_role('button', name='Roll dice').click()
        if acting.locator('body').get_attribute('data-phase') == 'offer':
            break
        time.sleep(1.2)
    acting.get_by_role('button', name='Start auction').click()
    acting.get_by_role('button', name='Bid $10', exact=True).click()
    expect(guest.locator('#controlType')).to_contain_text('Seat 2')
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
    expect(host.locator('#reason')).to_contain_text('disconnected')
