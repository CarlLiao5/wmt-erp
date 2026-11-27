"""在本地终端隐藏输入生产凭证，提交到本地 ERP，不输出密钥。"""
import getpass
import json
import urllib.request
import urllib.error

client_id = getpass.getpass('Production Client ID（隐藏输入）: ').strip()
client_secret = getpass.getpass('Production Client Secret（隐藏输入）: ').strip()
if not client_id or not client_secret:
    raise SystemExit('未输入完整凭证，未保存。')
request = urllib.request.Request(
    'http://localhost:3000/api/stores/prod-001/credentials',
    data=json.dumps({'clientId': client_id, 'clientSecret': client_secret}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        print(f'生产凭证已保存，HTTP {response.status}。店铺：prod-001。')
except urllib.error.HTTPError as error:
    raise SystemExit(f'保存失败，HTTP {error.code}。')
except urllib.error.URLError:
    raise SystemExit('无法连接本地 ERP，请先启动后端。')
