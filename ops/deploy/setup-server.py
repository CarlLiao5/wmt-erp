from pathlib import Path
import subprocess,shutil,pwd,os
root=Path('/opt/wmterp')
try: pwd.getpwnam('wmterp')
except KeyError: subprocess.run(['useradd','--system','--home','/opt/wmterp','--shell','/usr/sbin/nologin','wmterp'],check=True)
current=root/'current'
if not current.exists():current.symlink_to(root/'releases/20261121')
subprocess.run(['chown','-R','wmterp:wmterp','/opt/wmterp/releases','/opt/wmterp/python'],check=True)
subprocess.run(['chown','root:wmterp','/etc/wmterp/runtime.env'],check=True)
os.chmod('/etc/wmterp',0o750);os.chmod('/etc/wmterp/runtime.env',0o640)
for service,script,limit,heap in [('api','server.mjs','infinity','320'),('worker','worker.mjs','infinity','384')]:
 Path('/etc/systemd/system/wmterp-'+service+'.service').write_text('''[Unit]
Description=Walmart ERP '''+service+'''
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=wmterp
Group=wmterp
WorkingDirectory=/opt/wmterp/current
EnvironmentFile=/etc/wmterp/runtime.env
Environment=MALLOC_ARENA_MAX=2
Environment=NODE_OPTIONS=--max-old-space-size='''+heap+'''
ExecStart=/opt/wmterp/runtime/node-v22.15.0-linux-x64/bin/node /opt/wmterp/current/'''+script+'''
Restart=on-failure
RestartSec=10
TimeoutStopSec=300
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/wmterp
UMask=0027
MemoryHigh='''+limit+'''
MemoryMax='''+('700M' if service=='api' else '650M')+'''
CPUQuota='''+('75%' if service=='api' else '100%')+'''
TasksMax=128

[Install]
WantedBy=multi-user.target
''')
# New locations only: existing WBKC block is retained verbatim.
Path('/etc/nginx/snippets/wmterp.conf').write_text('''location = /ERP { return 308 /ERP/; }
location /ERP/ {
    alias /opt/wmterp/current/web/;
    index index.html;
    add_header Cache-Control "no-cache";
}
location /assets/ {
    alias /opt/wmterp/current/web/assets/;
    expires 7d;
}
location /api/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    client_max_body_size 32m;
}
''')
site=Path('/etc/nginx/sites-available/wbkc')
original=site.read_text()
backup=root/'nginx-wbkc.before-erp.conf'
if not backup.exists():backup.write_text(original)
include='    include /etc/nginx/snippets/wmterp.conf;\n'
if include not in original:site.write_text(original.replace('server {\n','server {\n'+include,1))
subprocess.run(['nginx','-t'],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True)
print('Isolated services and additive nginx routes prepared')
