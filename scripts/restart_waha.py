import paramiko
import sys
import time

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

# Leer la API key desde el .env
run('grep WPPCONNECT_SECRET_KEY /opt/atepsa-reportes/repo/infra/.env')

# Listar sesiones (estado actual)
run('source /opt/atepsa-reportes/repo/infra/.env && docker exec atepsa-rep-wppconnect sh -c "wget -qO- --header=\\"X-Api-Key: $WPPCONNECT_SECRET_KEY\\" http://localhost:3000/api/sessions"')

# Intentar arrancar la sesion default
print('\n--- START SESSION default ---')
run('source /opt/atepsa-reportes/repo/infra/.env && docker exec atepsa-rep-wppconnect sh -c "wget -qO- --post-data=\\"{}\\" --header=\\"Content-Type: application/json\\" --header=\\"X-Api-Key: $WPPCONNECT_SECRET_KEY\\" http://localhost:3000/api/sessions/default/start"')

time.sleep(5)

# Verificar estado luego de start
run('source /opt/atepsa-reportes/repo/infra/.env && docker exec atepsa-rep-wppconnect sh -c "wget -qO- --header=\\"X-Api-Key: $WPPCONNECT_SECRET_KEY\\" http://localhost:3000/api/sessions"')

c.close()
print('\nDONE')
