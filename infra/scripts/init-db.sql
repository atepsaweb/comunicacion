-- Schemas separados para la app y para n8n dentro de la misma base de datos.
-- El usuario principal (POSTGRES_USER) tiene acceso total.
-- Este script se ejecuta una sola vez al crear el container.

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS n8n;
