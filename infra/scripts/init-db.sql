-- Schemas separados para la app y para n8n
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS n8n;

-- Usuario de la app
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'CHANGEME';
  END IF;
END
$$;

-- Usuario de n8n
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'n8n_user') THEN
    CREATE ROLE n8n_user WITH LOGIN PASSWORD 'CHANGEME';
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON SCHEMA app TO app_user;
GRANT ALL PRIVILEGES ON SCHEMA n8n TO n8n_user;
