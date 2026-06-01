import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('147.79.111.236', username='root', password='Atepsaweb583.', timeout=30)

def run(cmd, timeout=60):
    print(f'\n$ {cmd[:200]}')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    if out: print(out[:5000])
    if err: print('[ERR]', err[:1500])
    print(f'[exit {rc}]')
    return rc, out

# 1. Estado de containers
run('docker ps --format "table {{.Names}}\t{{.Status}}"')

# 2. Estado de sesion WAHA
run('docker exec atepsa-rep-web sh -c "wget -qO- --header=\\"X-Api-Key: $WPPCONNECT_SECRET_KEY\\" http://wppconnect:3000/api/sessions" 2>&1 | head -100')

# 3. Logs recientes del web (filtra otp y whatsapp)
run('docker logs atepsa-rep-web --tail 200 2>&1 | grep -iE "otp|whatsapp|waha|sendText" | tail -40')

# 4. Logs WAHA recientes
run('docker logs atepsa-rep-wppconnect --tail 60 2>&1 | tail -60')

c.close()
print('\nDONE')
