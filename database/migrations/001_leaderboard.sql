-- Applied transactionally by database/manage.mjs in the dedicated dallasai_club database.
-- The runtime role is created by the runner with a generated password, never stored here.
CREATE SCHEMA leaderboard;
REVOKE ALL ON SCHEMA leaderboard FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA leaderboard REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE leaderboard.schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE leaderboard.players (
    player_id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    is_blocked boolean NOT NULL DEFAULT false
);

CREATE TABLE leaderboard.daily_scores (
    player_id uuid NOT NULL REFERENCES leaderboard.players (player_id),
    game text NOT NULL CHECK (game IN ('explore', 'ride', 'snake')),
    score_date date NOT NULL,
    nickname text NOT NULL CHECK (
        nickname = btrim(nickname)
        AND nickname ~ '^[[:alnum:] _.-]{2,20}$'
    ),
    score integer NOT NULL CHECK (score BETWEEN 1 AND 1000000),
    saved_at timestamptz NOT NULL,
    PRIMARY KEY (player_id, game, score_date),
    CHECK (score_date = (saved_at AT TIME ZONE 'America/Chicago')::date)
);

CREATE INDEX daily_scores_by_day
    ON leaderboard.daily_scores (game, score_date, score DESC, saved_at, player_id);
CREATE INDEX daily_scores_best_per_player
    ON leaderboard.daily_scores (game, player_id, score DESC, saved_at);

-- The Worker must derive p_player_id from a verified server-issued session.
-- This database service credential is not a player login or proof of a valid game run.
CREATE FUNCTION leaderboard.submit_score(
    p_player_id uuid, p_nickname text, p_game text, p_score integer
)
RETURNS TABLE (nickname text, score integer, game text, date date, "savedAt" timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_nickname text := btrim(p_nickname);
    v_now timestamptz := statement_timestamp();
    v_date date := (v_now AT TIME ZONE 'America/Chicago')::date;
    v_blocked boolean;
BEGIN
    IF p_player_id IS NULL OR p_game IS NULL OR p_game NOT IN ('explore', 'ride', 'snake')
       OR p_score IS NULL OR p_score NOT BETWEEN 1 AND 1000000
       OR v_nickname IS NULL OR v_nickname !~ '^[[:alnum:] _.-]{2,20}$' THEN
        RAISE EXCEPTION 'Invalid score submission' USING ERRCODE = '22023';
    END IF;

    INSERT INTO leaderboard.players (player_id) VALUES (p_player_id)
        ON CONFLICT (player_id) DO NOTHING;
    SELECT p.is_blocked INTO v_blocked FROM leaderboard.players p
        WHERE p.player_id = p_player_id FOR UPDATE;
    IF v_blocked THEN
        RAISE EXCEPTION 'Player is blocked' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    INSERT INTO leaderboard.daily_scores AS s (player_id, game, score_date, nickname, score, saved_at)
        VALUES (p_player_id, p_game, v_date, v_nickname, p_score, v_now)
        ON CONFLICT ON CONSTRAINT daily_scores_pkey DO UPDATE SET
            nickname = EXCLUDED.nickname,
            score = greatest(s.score, EXCLUDED.score),
            saved_at = CASE WHEN EXCLUDED.score > s.score THEN EXCLUDED.saved_at ELSE s.saved_at END
        RETURNING s.nickname, s.score, s.game, s.score_date, s.saved_at;
END;
$$;

-- NULL means all time. The API maps its existing date=all query parameter to NULL.
CREATE FUNCTION leaderboard.list_scores(p_game text, p_date date DEFAULT NULL)
RETURNS TABLE (nickname text, score integer, game text, date date, "savedAt" timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_game IS NULL OR p_game NOT IN ('explore', 'ride', 'snake') THEN
        RAISE EXCEPTION 'Invalid game' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT best.nickname, best.score, best.game, best.score_date, best.saved_at
    FROM (
        SELECT DISTINCT ON (s.player_id)
            s.player_id, s.nickname, s.score, s.game, s.score_date, s.saved_at
        FROM leaderboard.daily_scores s
        JOIN leaderboard.players p USING (player_id)
        WHERE s.game = p_game AND NOT p.is_blocked
            AND (p_date IS NULL OR s.score_date = p_date)
        ORDER BY s.player_id, s.score DESC, s.saved_at, s.score_date
    ) best
    ORDER BY best.score DESC, best.saved_at, best.player_id
    LIMIT 10;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA leaderboard FROM PUBLIC, dallasai_leaderboard_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA leaderboard FROM PUBLIC, dallasai_leaderboard_api;
GRANT USAGE ON SCHEMA leaderboard TO dallasai_leaderboard_api;
GRANT EXECUTE ON FUNCTION leaderboard.submit_score(uuid, text, text, integer)
    TO dallasai_leaderboard_api;
GRANT EXECUTE ON FUNCTION leaderboard.list_scores(text, date)
    TO dallasai_leaderboard_api;
GRANT CONNECT ON DATABASE dallasai_club TO dallasai_leaderboard_api;

COMMENT ON SCHEMA leaderboard IS 'Dallas AI Club leaderboard; separate from Neon Auth; API integration deferred.';
COMMENT ON TABLE leaderboard.players IS 'Opaque server-verified player IDs and moderation status; no account credentials.';
COMMENT ON TABLE leaderboard.daily_scores IS 'Best score per player, game and America/Chicago day; no client-supplied timestamps.';
