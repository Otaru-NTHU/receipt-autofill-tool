"""Build a single-file version (for claude.ai artifacts): inline CSS/JS, pdf.js worker as a blob,
CJK cmaps packed into lib/cmaps.json. Usage: python3 tools/build-single.py OUT_DIR"""
import re, os, sys, json, base64, shutil
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1]; os.makedirs(os.path.join(out, 'lib'), exist_ok=True); os.makedirs(os.path.join(out, 'fonts'), exist_ok=True)
rd = lambda p: open(os.path.join(R, p), encoding='utf8').read()
html, css = rd('index.html'), rd('css/app.css')
head = re.search(r'<title>.*?</title>', html).group(0) + '\n<meta name="claude:viewport-fit-sides" content="cover">\n'
head += ''.join(re.findall(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts[^>]+>\n?', html))
head += '<style>\n' + css + '\n</style>\n'
body = html[html.index('<body>') + 6:html.index('</body>')]
esc = lambda c: c.replace('</script', '<\\/script')
body = re.sub(r'<script src="([^"]+)"></script>', lambda m: '<script>/* %s */\n%s\n</script>' % (m.group(1), esc(rd(m.group(1)))), body)
boot = ('<script type="text/plain" id="pdfWorkerSrc">' + esc(rd('lib/pdf.worker.min.js')) + '</script>\n'
        '<script>window.RAF_CMAP_JSON="lib/cmaps.json";try{window.RAF_WORKER_SRC=URL.createObjectURL(new Blob([document.getElementById("pdfWorkerSrc").textContent],{type:"text/javascript"}));}catch(e){}</script>\n')
body = body.replace('<script>/* lib/jszip.min.js */', boot + '<script>/* lib/jszip.min.js */', 1)
page = (head + body).replace('�', '\\ufffd')
open(os.path.join(out, 'index.html'), 'w', encoding='utf8').write(page)
cm = os.path.join(R, 'lib/cmaps')
json.dump({f[:-6]: base64.b64encode(open(os.path.join(cm, f), 'rb').read()).decode() for f in os.listdir(cm)}, open(os.path.join(out, 'lib/cmaps.json'), 'w'))
shutil.copy(os.path.join(R, 'fonts/NotoSansTC-Big5.ttf'), os.path.join(out, 'fonts/'))
print('ok', len(page))
