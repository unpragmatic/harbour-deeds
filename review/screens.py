from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageOps, ImageDraw

root=Path(__file__).resolve().parent
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    p=browser.new_page(viewport={'width':1280,'height':900})
    errors=[]
    p.on('pageerror',lambda e: errors.append(str(e)))
    p.add_init_script('crypto.getRandomValues = a => { a[0]=1;return a };')
    p.goto((root.parent/'dist/index.html').as_uri())
    def button(name):return p.get_by_role('button',name=name,exact=True)
    def shot(name,selector=None):
        (p.locator(selector) if selector else p).screenshot(path=root/(name+'.png'))
    button('＋ New table').click()
    p.locator('#seat-1').select_option('human')
    p.locator('#seat-2').select_option('off')
    button('Start game').click()
    shot('table')
    for _ in range(12):
        button('Roll dice').click()
        if p.locator('body').get_attribute('data-phase')=='offer':break
    shot('offer','.desk')
    button('Start auction').click()
    shot('auction','.desk')
    p.locator('#amount').fill('70')
    button('Place bid').click()
    shot('bid','.desk')
    button('Withdraw').click()
    shot('settled','.desk')
    button('Draft trade').click()
    for key in ['give','take']:
        sel=p.locator('#'+key+'Deed')
        if sel.locator('option').count()>1:
            sel.select_option(index=1)
            p.locator('#'+('take' if key=='give' else 'give')+'Cash').fill('120')
            break
    shot('draft','dialog')
    button('Send proposal').click()
    shot('trade','.desk')
    button('Accept trade').click()
    assert p.locator('body').get_attribute('data-phase')=='roll'
    assert 'accepted' in p.locator('#log').inner_text().lower()
    p.set_viewport_size({'width':390,'height':844})
    shot('phone')
    assert p.evaluate('document.documentElement.scrollWidth <= innerWidth')
    for _ in range(12):
        button('Roll dice').click()
        if p.locator('body').get_attribute('data-phase')=='offer':break
    button('Start auction').click()
    shot('phone-auction')
    assert button('Withdraw').bounding_box()['y'] < 800
    p.set_viewport_size({'width':320,'height':680})
    assert p.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Finish a real browser match faster by advancing its clocks.
    p.clock.install()
    for _ in range(300):
        phase=p.locator('body').get_attribute('data-phase')
        if phase=='over':break
        if phase=='end':p.clock.run_for(1100);continue
        if phase=='offer':p.locator('#actions button:enabled').first.click()
        else:button({'auction':'Withdraw','roll':'Roll dice'}[phase]).click()
    assert p.locator('body').get_attribute('data-phase')=='over'
    shot('final','.desk')
    assert not errors,errors
    browser.close()

canvas=Image.new('RGB',(1050,930),'#ecede4')
draw=ImageDraw.Draw(canvas)
for i,(name,caption) in enumerate([('offer','01  Deed offer'),('auction','02  Opening auction'),('bid','03  Bidder handoff'),('settled','04  Settlement'),('draft','05  Draft a trade'),('trade','06  Recipient reviews'),('final','07  Final accounts'),('phone-auction','08  Mobile auction')]):
    x=(i%4)*260+8;y=(i//4)*460+10
    draw.text((x,y),caption,fill='#193e36')
    im=Image.open(root/(name+'.png')).convert('RGB');im.thumbnail((250,427))
    canvas.paste(im,(x,y+20))
canvas.save(root/'state-review.png')
