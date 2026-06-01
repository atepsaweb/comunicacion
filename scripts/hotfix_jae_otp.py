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
    if out: print(out[:3000])
    if err: print('[ERR]', err[:1500])
    return rc, out

PHONE = '+5491132874996'

# Invalidar todos los OTPs no consumidos para que Jae pueda pedir uno nuevo y entrar
sql = f"""UPDATE app.otp_codes
SET consumed_at = NOW()
WHERE phone_e164='{PHONE}' AND consumed_at IS NULL
RETURNING id, created_at;"""

run(f'docker exec atepsa-rep-postgres psql -U app_user -d atepsa -c "{sql}"')

c.close()
print('\nDONE — Jae ahora puede pedir un nuevo OTP y entrar.')
