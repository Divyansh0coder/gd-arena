-- NOT part of the P0 build. Apply only after P0 is stable (PRD §5).
CREATE TABLE missed_opportunities (            -- P1
  id                  bigserial PRIMARY KEY,
  session_id          uuid   NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  trigger_segment_id  bigint NOT NULL REFERENCES transcript_segments(id),
  t_ms                int    NOT NULL,
  silence_ms          int    NOT NULL,
  suggestions         jsonb  NOT NULL            -- labelled "AI-generated coaching suggestion" in the UI
);

CREATE TABLE retry_attempts (                  -- P1 (retry_sessions merged in, PRD §14)
  id                   bigserial PRIMARY KEY,
  opportunity_id       bigint NOT NULL REFERENCES missed_opportunities(id) ON DELETE CASCADE,
  original_segment_id  bigint REFERENCES transcript_segments(id),
  attempt_text         text NOT NULL,
  original_score       int,
  score                int,
  explanation          text
);

CREATE TABLE progress_snapshots (              -- P2
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  dimension   text NOT NULL,
  score       int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX progress_user_dim_idx ON progress_snapshots(user_id, dimension, created_at);
