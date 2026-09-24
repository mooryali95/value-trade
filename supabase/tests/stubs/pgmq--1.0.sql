CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE FUNCTION pgmq.create(queue_name text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION pgmq.send(queue_name text, msg jsonb) RETURNS SETOF bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION pgmq.read(queue_name text, vt integer, qty integer) RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb) LANGUAGE sql AS $$ SELECT NULL::bigint, NULL::int, NULL::timestamptz, NULL::timestamptz, NULL::jsonb WHERE false $$;
CREATE FUNCTION pgmq.delete(queue_name text, msg_id bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
