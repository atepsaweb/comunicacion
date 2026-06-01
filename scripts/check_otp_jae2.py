import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('147.79.111.236', username='root', password='Atepsaweb583.', timeout=30)

def run(cmd, timeout=30):
    print(f'\n$ {cmd[:200]}')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    if out: print(out[:5000])
    if err: print('[ERR]', err[:1500])
    print(f'[exit {rc}]')
    return rc, out

# Buscar tablas
run('docker exec atepsa-rep-postgres psql -U app_user -d atepsa -c "\\dt *.*" 2>&1 | grep -iE "otp|users"')

PHONE = '+5491132874996'

# Buscar con schema app
sql = f"""SELECT o.id, o.created_at, o.expires_at, o.consumed_at, o.attempts,
       (o.expires_at > NOW()) AS not_expired,
       (o.consumed_at IS NULL) AS unused
FROM app.otp_codes o
WHERE o.phone_e164='{PHONE}'
ORDER BY o.created_at DESC
LIMIT 10;"""
run(f'docker exec atepsa-rep-postgres psql -U app_user -d atepsa -c "{sql}"')

c.close()
