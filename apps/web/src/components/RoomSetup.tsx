import { useCallback, useEffect, useState } from "react";
import { SessionConfig, Topic } from "@gd-arena/contracts";
import { z } from "zod";
import { getApiUrl } from "../utils/config";

type TopicsState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; topics: Topic[] };

type CreatedSession = {
  id: string;
  status: string;
  config: SessionConfig;
};

type RoomSetupProps = {
  onSessionCreated?: (session: { id: string; config: SessionConfig }) => void;
};

export function RoomSetup({ onSessionCreated }: RoomSetupProps) {
  const [topicsState, setTopicsState] = useState<TopicsState>({ state: "loading" });
  
  // Form State
  const [topicMode, setTopicMode] = useState<"preset" | "custom">("preset");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [customTopic, setCustomTopic] = useState<string>("");
  const [panelSize, setPanelSize] = useState<number>(3);
  const [durationMinutes, setDurationMinutes] = useState<number>(8); // 8 minutes = 480 seconds
  const [patienceMs, setPatienceMs] = useState<number>(1200);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdSession, setCreatedSession] = useState<CreatedSession | null>(null);

  const fetchTopics = useCallback(async () => {
    setTopicsState({ state: "loading" });
    try {
      const res = await fetch(getApiUrl("/api/topics"));
      if (!res.ok) throw new Error(`Server answered ${res.status}`);
      const data = await res.json();
      const topics = z.array(Topic).parse(data);
      setTopicsState({ state: "ready", topics });
      if (topics.length > 0 && topics[0]) {
        setSelectedPresetId(topics[0].id);
      }
    } catch (e) {
      setTopicsState({ state: "error", message: e instanceof Error ? e.message : "Unknown error" });
    }
  }, []);

  useEffect(() => {
    void fetchTopics();
  }, [fetchTopics]);

  const getEffectiveTopic = (): string => {
    if (topicMode === "custom") {
      return customTopic.trim();
    }
    if (topicsState.state === "ready") {
      const found = topicsState.topics.find((t) => t.id === selectedPresetId);
      return found ? found.title : "";
    }
    return "";
  };

  const effectiveTopic = getEffectiveTopic();
  const durationSec = durationMinutes * 60;

  const handleStartGD = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const payload = {
      topic: effectiveTopic,
      panelSize,
      durationSec,
      patienceMs,
    };

    const parseResult = SessionConfig.safeParse(payload);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      setSubmitError(`Invalid setup: ${issues}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(getApiUrl("/api/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseResult.data),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error ?? `Server error ${res.status}`);
      }

      const sessionData: CreatedSession = await res.json();
      setCreatedSession(sessionData);
      if (onSessionCreated) {
        onSessionCreated(sessionData);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="room-setup-container">
      <header className="setup-header">
        <h2>Configure Discussion Room</h2>
        <p className="setup-subtitle">
          Customize your Group Discussion topic, AI panel size, duration, and turn patience.
        </p>
        <div style={{ background: "rgba(99, 102, 241, 0.1)", border: "1px solid var(--accent)", borderRadius: "8px", padding: "0.6rem 1rem", marginTop: "0.75rem", fontSize: "0.85rem" }}>
          🎧 <strong>Recommended Setup:</strong> Connect headphones before starting to ensure clear candidate microphone capture without AI speaker echo.
        </div>
      </header>

      {createdSession ? (
        <div className="session-created-card" role="status">
          <div className="created-badge">✓ Room Created</div>
          <h3>Session Ready: {createdSession.id}</h3>
          <dl className="session-details">
            <div>
              <dt>Topic</dt>
              <dd>{createdSession.config.topic}</dd>
            </div>
            <div>
              <dt>AI Participants</dt>
              <dd>{createdSession.config.panelSize} AI Personas (+ Moderator)</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{Math.round(createdSession.config.durationSec / 60)} Minutes ({createdSession.config.durationSec}s)</dd>
            </div>
            <div>
              <dt>AI Turn Patience</dt>
              <dd>{createdSession.config.patienceMs} ms</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="status-tag">{createdSession.status}</dd>
            </div>
          </dl>
          <button
            className="btn-secondary"
            onClick={() => {
              setCreatedSession(null);
            }}
          >
            Configure Another Session
          </button>
        </div>
      ) : (
        <form onSubmit={handleStartGD} className="setup-form">
          {/* TOPIC SELECTION */}
          <section className="form-section">
            <legend className="section-title">1. Discussion Topic</legend>
            <div className="topic-mode-toggle" role="radiogroup" aria-label="Topic Selection Mode">
              <button
                type="button"
                className={topicMode === "preset" ? "toggle-btn active" : "toggle-btn"}
                onClick={() => setTopicMode("preset")}
              >
                Choose Preset Topic
              </button>
              <button
                type="button"
                className={topicMode === "custom" ? "toggle-btn active" : "toggle-btn"}
                onClick={() => setTopicMode("custom")}
              >
                Enter Custom Topic
              </button>
            </div>

            {topicMode === "preset" ? (
              <div className="preset-topics-block">
                {topicsState.state === "loading" && <p role="status">Loading topics…</p>}
                {topicsState.state === "error" && (
                  <div role="alert" className="error-banner">
                    <p>Topics could not be loaded: {topicsState.message}</p>
                    <button type="button" onClick={() => void fetchTopics()}>
                      Try again
                    </button>
                  </div>
                )}
                {topicsState.state === "ready" && (
                  <div className="topics-grid" role="radiogroup" aria-label="Preset Topics">
                    {topicsState.topics.map((t) => (
                      <label
                        key={t.id}
                        className={selectedPresetId === t.id ? "topic-card selected" : "topic-card"}
                      >
                        <input
                          type="radio"
                          name="preset-topic"
                          value={t.id}
                          checked={selectedPresetId === t.id}
                          onChange={() => setSelectedPresetId(t.id)}
                        />
                        <div className="topic-info">
                          <span className="topic-title">{t.title}</span>
                          <span className="topic-category">{t.category}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="custom-topic-block">
                <label htmlFor="custom-topic-input" className="field-label">
                  Custom Topic Prompt (5–200 characters)
                </label>
                <textarea
                  id="custom-topic-input"
                  rows={3}
                  className="custom-topic-textarea"
                  placeholder="e.g. Should universal basic income be implemented in developing nations?"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  minLength={5}
                  maxLength={200}
                />
                <span className="char-counter">
                  {customTopic.trim().length} / 200 characters
                </span>
              </div>
            )}
          </section>

          {/* AI PARTICIPANTS */}
          <section className="form-section">
            <label className="section-title">2. AI Participants (3–5)</label>
            <p className="field-hint">
              Select how many AI discussion partners join the room (plus the AI Moderator).
            </p>
            <div className="panel-size-selector" role="radiogroup" aria-label="AI Participants">
              {[3, 4, 5].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={panelSize === size ? "pill-btn selected" : "pill-btn"}
                  onClick={() => setPanelSize(size)}
                >
                  {size} AI Personas
                </button>
              ))}
            </div>
          </section>

          {/* DURATION */}
          <section className="form-section">
            <div className="section-header">
              <label htmlFor="duration-range" className="section-title">
                3. Discussion Duration: <strong>{durationMinutes} minutes</strong>
              </label>
              <span className="range-badge">{durationSec} seconds</span>
            </div>
            <input
              id="duration-range"
              type="range"
              min={3}
              max={10}
              step={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="styled-slider"
            />
            <div className="slider-ticks">
              <span>3 min</span>
              <span>5 min</span>
              <span>8 min</span>
              <span>10 min</span>
            </div>
          </section>

          {/* AI PATIENCE */}
          <section className="form-section">
            <div className="section-header">
              <label htmlFor="patience-range" className="section-title">
                4. AI Patience Timeout: <strong>{patienceMs} ms</strong>
              </label>
              <span className="range-badge">{(patienceMs / 1000).toFixed(1)}s pause threshold</span>
            </div>
            <p className="field-hint">
              How long the AI waits during silence before someone else jumps in.
            </p>
            <input
              id="patience-range"
              type="range"
              min={600}
              max={2500}
              step={100}
              value={patienceMs}
              onChange={(e) => setPatienceMs(Number(e.target.value))}
              className="styled-slider"
            />
            <div className="slider-ticks">
              <span>600 ms (Fast)</span>
              <span>1200 ms (Balanced)</span>
              <span>2500 ms (Patient)</span>
            </div>
          </section>

          {submitError && (
            <div className="error-banner" role="alert">
              {submitError}
            </div>
          )}

          {/* SUBMIT BUTTON */}
          <div className="form-actions">
            <button
              type="submit"
              disabled={isSubmitting || !effectiveTopic || effectiveTopic.length < 5}
              className="btn-primary start-btn"
            >
              {isSubmitting ? "Starting Session…" : "Start GD"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
