"""Build single-file versions of the tool.

  python3 tools/build-single.py artifact OUT_DIR   # for claude.ai: page + fonts/ + lib/cmaps.json + templates/nthu.json
  python3 tools/build-single.py offline OUT_FILE   # one self-contained HTML that works by double-click (file://)
"""
import re, os, sys, json, base64, shutil

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(R, p), encoding='utf8').read()
rb = lambda p: open(os.path.join(R, p), 'rb').read()
esc = lambda c: c.replace('</script', '<\\/script')


def cmaps_json():
    cm = os.path.join(R, 'lib/cmaps')
    return json.dumps({f[:-6]: base64.b64encode(open(os.path.join(cm, f), 'rb').read()).decode()
                       for f in sorted(os.listdir(cm)) if f.endswith('.bcmap')})


def page(extra_boot):
    html, css = rd('index.html'), rd('css/app.css')
    head = re.search(r'<title>.*?</title>', html).group(0) + '\n<meta name="claude:viewport-fit-sides" content="cover">\n'
    head += ''.join(re.findall(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts[^>]+>\n?', html))
    head += '<style>\n' + css + '\n</style>\n'
    body = html[html.index('<body>') + 6:html.index('</body>')]
    body = re.sub(r'<script src="([^"]+)"></script>', lambda m: '<script>/* %s */\n%s\n</script>' % (m.group(1), esc(rd(m.group(1)))), body)
    boot = ('<script type="text/plain" id="pdfWorkerSrc">' + esc(rd('lib/pdf.worker.min.js')) + '</script>\n'
            '<script>' + extra_boot + 'try{window.RAF_WORKER_SRC=URL.createObjectURL(new Blob([document.getElementById("pdfWorkerSrc").textContent],{type:"text/javascript"}));}catch(e){}</script>\n')
    body = body.replace('<script>/* lib/jszip.min.js */', boot + '<script>/* lib/jszip.min.js */', 1)
    return head, body


mode, out = sys.argv[1], sys.argv[2]
if mode == 'artifact':
    os.makedirs(os.path.join(out, 'lib'), exist_ok=True); os.makedirs(os.path.join(out, 'fonts'), exist_ok=True); os.makedirs(os.path.join(out, 'templates'), exist_ok=True)
    head, body = page('window.RAF_CMAP_JSON="lib/cmaps.json";')
    open(os.path.join(out, 'index.html'), 'w', encoding='utf8').write((head + body).replace('�', '\\ufffd'))
    open(os.path.join(out, 'lib/cmaps.json'), 'w').write(cmaps_json())
    shutil.copy(os.path.join(R, 'fonts/NotoSansTC-Big5.ttf'), os.path.join(out, 'fonts/'))
    shutil.copy(os.path.join(R, 'templates/nthu.json'), os.path.join(out, 'templates/'))
elif mode == 'offline':
    font = 'data:font/ttf;base64,' + base64.b64encode(rb('fonts/NotoSansTC-Big5.ttf')).decode()
    cm = 'data:application/json;base64,' + base64.b64encode(cmaps_json().encode()).decode()
    tp = 'data:application/json;base64,' + base64.b64encode(rb('templates/nthu.json')).decode()
    boot = 'window.RAF_FONT_URL=%s;window.RAF_CMAP_JSON=%s;window.RAF_TEMPLATES_URL=%s;window.RAF_OFFLINE=true;' % (json.dumps(font), json.dumps(cm), json.dumps(tp))
    head, body = page(boot)
    doc = ('<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head + '</head>\n<body>\n' + body + '\n</body>\n</html>\n')
    open(out, 'w', encoding='utf8').write(doc.replace('�', '\\ufffd'))
else:
    sys.exit(__doc__)
print('ok', mode, out)
