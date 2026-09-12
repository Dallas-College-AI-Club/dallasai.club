-- Apply once in the dedicated dallasai_club database with its administrative account.
-- Raw IP addresses and player tokens are never stored in this table.
CREATE TABLE leaderboard.request_limits (
    key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
    scope text NOT NULL CHECK (scope IN ('read', 'session', 'write', 'player')),
    bucket_start timestamptz NOT NULL,
    hits integer NOT NULL CHECK (hits > 0),
    PRIMARY KEY (key_hash, scope)
);
CREATE INDEX request_limits_expiry ON leaderboard.request_limits (bucket_start);
REVOKE ALL ON leaderboard.request_limits FROM PUBLIC, dallasai_leaderboard_api;

CREATE FUNCTION leaderboard.consume_request(p_key text, p_scope text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_start timestamptz;
    v_limit integer;
    v_hits integer;
BEGIN
    IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR p_scope IS NULL
       OR p_scope NOT IN ('read', 'session', 'write', 'player') THEN
        RAISE EXCEPTION 'Invalid request bucket' USING ERRCODE = '22023';
    END IF;
    v_start := date_trunc(CASE WHEN p_scope = 'session' THEN 'hour' ELSE 'minute' END, statement_timestamp());
    v_limit := CASE p_scope WHEN 'read' THEN 300 WHEN 'session' THEN 120 WHEN 'write' THEN 120 ELSE 10 END;
    DELETE FROM leaderboard.request_limits WHERE bucket_start < statement_timestamp() - interval '1 day';
    INSERT INTO leaderboard.request_limits AS r (key_hash, scope, bucket_start, hits)
        VALUES (p_key, p_scope, v_start, 1)
    ON CONFLICT (key_hash, scope) DO UPDATE SET
        bucket_start = v_start,
        hits = CASE WHEN r.bucket_start = v_start THEN r.hits + 1 ELSE 1 END
    WHERE r.bucket_start <> v_start OR r.hits < v_limit
    RETURNING hits INTO v_hits;
    RETURN v_hits IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION leaderboard.consume_request(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leaderboard.consume_request(text, text) TO dallasai_leaderboard_api;
COMMENT ON SCHEMA leaderboard IS 'Dallas AI Club leaderboard; separate from Neon Auth; Vercel API access.';
