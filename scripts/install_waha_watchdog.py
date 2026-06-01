"""
Instala el watchdog de WAHA en el VPS:
  1. git pull
  2. Da permisos de ejecución al script
  3. Lo prueba (dry run, no falla si todo está bien)
  4. Instala entry de cron (*/2 * * * *)
  5. Instala logrotate
"""
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
    if out: print(out[:3000])
    if err: print('[ERR]', err[:1500])
    print(f'[exit {rc}]')
    return rc, out

# 1. Pull último código (que ya contiene el script)
run('cd /opt/atepsa-reportes/repo && git pull origin main 2>&1', timeout=60)

# 2. Permisos
run('chmod +x /opt/atepsa-reportes/repo/infra/scripts/waha-watchdog.sh')

# 3. Crear log y dar perms
run('touch /var/log/atepsa-waha-watchdog.log && chmod 644 /var/log/atepsa-waha-watchdog.log')

# 4. Prueba manual
print('\n--- DRY RUN (sesión debería estar WORKING, no debería loguear nada) ---')
run('/opt/atepsa-reportes/repo/infra/scripts/waha-watchdog.sh')

# 5. Instalar cron (idempotente: borra entry previa con el mismo path y la vuelve a poner)
CRON_LINE = '*/2 * * * * /opt/atepsa-reportes/repo/infra/scripts/waha-watchdog.sh >> /var/log/atepsa-waha-watchdog.log 2>&1'
run(f'(crontab -l 2>/dev/null | grep -v waha-watchdog.sh; echo "{CRON_LINE}") | crontab -')
run('crontab -l | grep waha-watchdog')

# 6. Logrotate
run('cp /opt/atepsa-reportes/repo/infra/scripts/waha-watchdog.logrotate /etc/logrotate.d/atepsa-waha-watchdog')
run('logrotate -d /etc/logrotate.d/atepsa-waha-watchdog 2>&1 | tail -10')

# 7. Verificar cron daemon
run('systemctl is-active crond || systemctl is-active cron')

c.close()
print('\nDONE — watchdog instalado, corre cada 2 minutos.')
