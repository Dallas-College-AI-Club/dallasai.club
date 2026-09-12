-- The runner encloses these checks in a transaction and rolls back every test row.
DO $$
DECLARE
    v_player uuid := gen_random_uuid();
    v_other uuid := gen_random_uuid();
    v_day date := (statement_timestamp() AT TIME ZONE 'America/Chicago')::date;
    v_saved timestamptz;
    v_result record;
    v_count integer;
BEGIN
    SELECT * INTO v_result FROM leaderboard.submit_score(v_player, '  한글  ', 'snake', 100);
    IF v_result.nickname <> '한글' OR v_result.score <> 100 OR v_result.date <> v_day THEN
        RAISE EXCEPTION 'Initial score, Unicode nickname or Central date check failed';
    END IF;
    v_saved := v_result."savedAt";
    SELECT * INTO v_result FROM leaderboard.submit_score(v_player, 'Renamed', 'snake', 50);
    IF v_result.nickname <> 'Renamed' OR v_result.score <> 100 OR v_result."savedAt" <> v_saved THEN
        RAISE EXCEPTION 'Lower score overwrote the best score or timestamp';
    END IF;
    SELECT * INTO v_result FROM leaderboard.submit_score(v_player, 'Renamed', 'snake', 100);
    IF v_result.score <> 100 OR v_result."savedAt" <> v_saved THEN
        RAISE EXCEPTION 'Duplicate score changed the best-score timestamp';
    END IF;
    PERFORM leaderboard.submit_score(v_player, 'Renamed', 'snake', 200);
    SELECT count(*) INTO v_count FROM leaderboard.daily_scores
        WHERE player_id = v_player AND game = 'snake' AND score_date = v_day AND score = 200;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Daily best-score update or uniqueness failed'; END IF;
    PERFORM leaderboard.submit_score(v_player, 'Renamed', 'explore', 150);
    PERFORM leaderboard.submit_score(v_player, 'Renamed', 'ride', 175);

    BEGIN
        PERFORM leaderboard.submit_score(v_player, 'Bad', 'snake', 0);
        RAISE EXCEPTION 'Zero score accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM leaderboard.submit_score(v_player, 'Bad', 'snake', 1000001);
        RAISE EXCEPTION 'Oversized score accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM leaderboard.submit_score(v_player, 'Bad', 'unknown', 10);
        RAISE EXCEPTION 'Unknown game accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM leaderboard.submit_score(v_player, '<script>', 'snake', 10);
        RAISE EXCEPTION 'Invalid nickname accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM leaderboard.submit_score(NULL, 'Valid', 'snake', 10);
        RAISE EXCEPTION 'Missing identity accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM leaderboard.list_scores('unknown');
        RAISE EXCEPTION 'Invalid ranking filter accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;

    -- Use a dedicated historical day for deterministic checks even after real scores exist.
    INSERT INTO leaderboard.players (player_id) VALUES (v_other);
    INSERT INTO leaderboard.daily_scores (player_id, game, score_date, nickname, score, saved_at) VALUES
        (v_player, 'snake', DATE '1900-01-01', 'Earlier', 1000000, TIMESTAMPTZ '1900-01-01 12:00:00-06'),
        (v_other, 'snake', DATE '1900-01-01', 'Later', 1000000, TIMESTAMPTZ '1900-01-01 13:00:00-06');
    SELECT * INTO v_result FROM leaderboard.list_scores('snake', DATE '1900-01-01') LIMIT 1;
    IF v_result.nickname <> 'Earlier' THEN RAISE EXCEPTION 'Tie ordering failed'; END IF;
    SELECT count(*) INTO v_count FROM leaderboard.list_scores('snake', DATE '1900-01-01');
    IF v_count <> 2 THEN RAISE EXCEPTION 'Daily date filter failed'; END IF;
    SELECT count(*) INTO v_count FROM leaderboard.list_scores('snake') WHERE nickname IN ('Earlier','Renamed');
    IF v_count <> 1 THEN RAISE EXCEPTION 'All-time player deduplication failed'; END IF;

    FOR v_count IN 1..12 LOOP
        v_other := gen_random_uuid();
        INSERT INTO leaderboard.players (player_id) VALUES (v_other);
        INSERT INTO leaderboard.daily_scores (player_id, game, score_date, nickname, score, saved_at)
            VALUES (v_other, 'ride', DATE '1900-01-02', 'TopTen', v_count, TIMESTAMPTZ '1900-01-02 12:00:00-06');
    END LOOP;
    SELECT count(*) INTO v_count FROM leaderboard.list_scores('ride', DATE '1900-01-02');
    IF v_count <> 10 THEN RAISE EXCEPTION 'Top-ten limit failed'; END IF;
    SELECT * INTO v_result FROM leaderboard.list_scores('ride', DATE '1900-01-02') LIMIT 1;
    IF v_result.score <> 12 THEN RAISE EXCEPTION 'Descending score ordering failed'; END IF;

    UPDATE leaderboard.players SET is_blocked = true WHERE player_id = v_player;
    IF EXISTS (SELECT 1 FROM leaderboard.list_scores('snake', DATE '1900-01-01') WHERE nickname = 'Earlier') THEN
        RAISE EXCEPTION 'Blocked player remains visible';
    END IF;
    BEGIN
        PERFORM leaderboard.submit_score(v_player, 'Blocked', 'snake', 500);
        RAISE EXCEPTION 'Blocked player submitted a score';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    IF has_schema_privilege('dallasai_leaderboard_api','leaderboard','CREATE')
       OR has_database_privilege('dallasai_leaderboard_api',current_database(),'CREATE')
       OR has_database_privilege('dallasai_leaderboard_api',current_database(),'TEMP')
       OR has_table_privilege('dallasai_leaderboard_api','leaderboard.daily_scores','SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('dallasai_leaderboard_api','leaderboard.players','SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('dallasai_leaderboard_api','leaderboard.schema_migrations','SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'Runtime role has excessive privileges';
    END IF;
    IF NOT has_function_privilege('dallasai_leaderboard_api','leaderboard.submit_score(uuid,text,text,integer)','EXECUTE')
       OR NOT has_function_privilege('dallasai_leaderboard_api','leaderboard.list_scores(text,date)','EXECUTE') THEN
        RAISE EXCEPTION 'Runtime role cannot call the API functions';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dallasai_leaderboard_api'
        AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolinherit))
       OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
        WHERE r.rolname = 'dallasai_leaderboard_api') THEN
        RAISE EXCEPTION 'Runtime role has elevated role attributes or memberships';
    END IF;
END;
$$;
