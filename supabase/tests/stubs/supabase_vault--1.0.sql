CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '') RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(name, secret) VALUES (new_name, new_secret) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret) WHERE id = secret_id $$;
