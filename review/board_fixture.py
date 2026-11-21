import json


def edit_rules(html, board, edit):
    head, rest = html.split('<script id="boardCatalog" type="application/json">')
    payload, tail = rest.split('</script>', 1)
    catalog = json.loads(payload)
    edit(catalog['boards'][board]['rules'])
    payload = json.dumps(catalog).replace('<', '\\u003c')
    return f'{head}<script id="boardCatalog" type="application/json">{payload}</script>{tail}'
