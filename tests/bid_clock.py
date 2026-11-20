from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.clock.install()
    page.add_init_script('crypto.getRandomValues = a => { a[0]=1; return a };')
    page.goto((Path(__file__).resolve().parents[1] / 'dist/index.html').as_uri())
    button = lambda name: page.get_by_role('button', name=name, exact=True)
    button('New table').click()
    page.locator('#advanced summary').click()
    page.select_option('#map', 'outer')
    page.select_option('#clock', '15')
    page.select_option('#seat-1', 'human')
    page.select_option('#seat-2', 'off')
    button('Start game').click()
    assert page.locator('.tile').count() == 28
    for _ in range(10):
        button('Roll dice').click()
        if page.locator('body').get_attribute('data-phase') == 'offer':
            break
        page.clock.run_for(1000)
    button('Start auction').click()
    button('Bid $10').click()
    bidder = page.locator('#controlType').inner_text()
    page.clock.run_for(5000)
    remaining=lambda: page.locator('.bidClock progress').evaluate('(p)=>p.value')
    assert 9750<=remaining()<=10100
    button('Rulebook').click()
    page.clock.run_for(18000)
    assert 9750<=remaining()<=10100
    assert page.locator('#controlType').inner_text() == bidder
    button('Close dialog').click()
    page.clock.run_for(8000)
    assert page.locator('#controlType').inner_text() == bidder
    page.clock.run_for(2500)
    assert page.locator('body').get_attribute('data-phase') == 'end'
    assert 'won deed' in page.locator('#log').inner_text()
    browser.close()
