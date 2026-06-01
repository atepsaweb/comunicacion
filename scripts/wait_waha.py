import paramiko
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('147.79.111.236', username='root', password='Atepsaweb583.', timeout=30)

def run(cmd, timeout=30):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    return rc, out

cmd_status = 'source /opt/atepsa-reportes/repo/infra/.env && docker exec atepsa-rep-wppconnect sh -c "wget -qO- --header=\\"X-Api-Key: $WPPCONNECT_SECRET_KEY\\" http://localhost:3000/api/sessions"'

for i in range(20):
    rc, out = run(cmd_status)
    print(f'[{i*5:3d}s] {out.strip()[:300]}')
    if '"status":"WORKING"' in out or '"status":"SCAN_QR_CODE"' in out or '"status":"FAILED"' in out:
        break
    time.sleep(5)

# Logs recientes de WAHA para entender qué hace
print('\n--- LOGS WAHA ---')
rc, out = run('docker logs atepsa-rep-wppconnect --tail 40 2>&1')
print(out[-3500:])

c.close()
