-- GD Arena P0 schema (PRD §14). PostgreSQL. P1/P2 tables are in schema.p1.sql.
-- Evidence chain (R6): feedback_items -> transcript_segments (NOT NULL) -> start_ms/end_ms.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE session_status AS ENUM ('lobby','opening','discussion','closing','ended');
CREATE TYPE segment_source AS ENUM ('stt','llm','typed');
CREATE TYPE score_basis    AS ENUM ('measured','ai','mixed');
CREATE TYPE severity       AS ENUM ('good','warn','bad');

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   text NOT NULL UNIQUE,          -- anonymous device token for the MVP
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
  category    text NOT NULL,
  is_custom   boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX topics_category_idx ON topics(category);

CREATE TABLE ai_personas (
  key             text PRIMARY KEY,           -- moderator | arjun | meera | kabir
  name            text NOT NULL,
  trait           text NOT NULL,
  prompt_version  text NOT NULL
);

CREATE TABLE gd_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_text   text NOT NULL,
  panel_size   int  NOT NULL CHECK (panel_size BETWEEN 3 AND 5),
  patience_ms  int  NOT NULL DEFAULT 1200 CHECK (patience_ms BETWEEN 600 AND 2500),
  duration_s   int  NOT NULL CHECK (duration_s BETWEEN 180 AND 600),
  status       session_status NOT NULL DEFAULT 'lobby',
  started_at   timestamptz,
  ended_at     timestamptz
);
CREATE INDEX gd_sessions_user_idx ON gd_sessions(user_id, started_at DESC);

CREATE TABLE session_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  persona_key   text REFERENCES ai_personas(key),   -- null for the human
  display_name  text NOT NULL,
  voice_id      text,
  is_human      boolean NOT NULL DEFAULT false,
  is_moderator  boolean NOT NULL DEFAULT false,
  UNIQUE (session_id, persona_key)
);

CREATE TABLE transcript_segments (
  id              bigserial PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  participant_id  uuid NOT NULL REFERENCES session_participants(id),
  seq             int  NOT NULL,
  start_ms        int  NOT NULL CHECK (start_ms >= 0),
  end_ms          int  NOT NULL CHECK (end_ms >= start_ms),
  text            text NOT NULL CHECK (char_length(text) > 0),
  interrupted     boolean NOT NULL DEFAULT false,
  source          segment_source NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE INDEX transcript_segments_time_idx ON transcript_segments(session_id, start_ms);

CREATE TABLE session_events (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  type        text NOT NULL,                  -- e.g. user_interrupted_ai, silence, ai_interrupted_user
  t_ms        int  NOT NULL CHECK (t_ms >= 0),
  segment_id  bigint REFERENCES transcript_segments(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX session_events_time_idx ON session_events(session_id, t_ms);
CREATE INDEX session_events_type_idx ON session_events(type);

CREATE TABLE performance_metrics (
  session_id          uuid PRIMARY KEY REFERENCES gd_sessions(id) ON DELETE CASCADE,
  speaking_share      numeric(5,4) NOT NULL CHECK (speaking_share BETWEEN 0 AND 1),
  words               int NOT NULL,
  turns               int NOT NULL,
  interruptions_made  int NOT NULL,
  first_speak_ms      int,
  longest_silence_ms  int NOT NULL
);

CREATE TABLE skill_scores (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  dimension   text NOT NULL,
  score       int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  basis       score_basis NOT NULL,
  UNIQUE (session_id, dimension)
);

-- Only validated items are ever inserted (PRD §13 validator). segment_id is NOT NULL on purpose.
CREATE TABLE feedback_items (
  id          bigserial PRIMARY KEY,
  session_id  uuid   NOT NULL REFERENCES gd_sessions(id) ON DELETE CASCADE,
  dimension   text   NOT NULL,
  severity    severity NOT NULL,
  text        text   NOT NULL,
  quote       text   NOT NULL CHECK (char_length(quote) > 0),
  segment_id  bigint NOT NULL REFERENCES transcript_segments(id),
  event_id    bigint REFERENCES session_events(id) ON DELETE SET NULL,
  t_ms        int    NOT NULL CHECK (t_ms >= 0)
);
CREATE INDEX feedback_items_session_idx ON feedback_items(session_id, t_ms);
