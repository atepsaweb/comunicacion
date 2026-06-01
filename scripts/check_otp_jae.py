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

PHONE = '+5491132874996'

# 1. Usuario activo
sql_user = f"SELECT id, full_name, phone_e164, is_active, role FROM users WHERE phone_e164='{PHONE}';"
run(f'docker exec atepsa-rep-postgres psql -U app_user -d atepsa -c "{sql_user}"')

# 2. Últimos OTP para ese número (todos, no solo válidos)
sql_otps = f"""SELECT id, created_at, expires_at, consumed_at, attempts,
       (expires_at > NOW()) AS not_expired,
       (consumed_at IS NULL) AS unused
FROM otp_codes
WHERE phone_e164='{PHONE}'
ORDER BY created_at DESC
LIMIT 5;"""
run(f'docker exec atepsa-rep-postgres psql -U app_user -d atepsa -c "{sql_otps}"')

# 3. Hora actual del servidor (timezone)
run('docker exec atepsa-rep-postgres psql -U app_user -d atepsa -c "SELECT NOW(), current_setting(\'TIMEZONE\');"')

# 4. Logs recientes del web para ese número
run(f'docker logs atepsa-rep-web --tail 500 2>&1 | grep -E "5491132874996" | tail -30')

# 5. Logs recientes generales del web (auth)
run('docker logs atepsa-rep-web --tail 200 2>&1 | grep -iE "otp|auth|sign" | tail -30')

c.close()
print('\nDONE')
