import { useCallback, useEffect, useRef, useState } from "react";
import { PersonaKey, Report, ServerEvent, SessionConfig, SessionStatus, TranscriptSegment } from "@gd-arena/contracts";
import { useSpeech } from "../hooks/useSpeech";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import { isBargeInValid, shouldSuppressAiEcho } from "../utils/echoMitigation";
import { ReportView } from "./ReportView";
import { getApiUrl, getWsUrl } from "../utils/config";

type LiveArenaProps = {
  sessionId: string;
  config: SessionConfig;
  onStartNewSession: () => void;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "ended";

type TranscriptItem = {
  segmentId: number;
  speaker: PersonaKey | "student";
  text: string;
  tMs: number;
};

const AI_PERSONAS = [
  { key: "moderator" as PersonaKey, name: "AI Moderator", role: "Moderator", avatar: "🎙️", trait: "Guides & Keeps Time" },
  { key: "arjun" as PersonaKey, name: "Arjun", role: "Participant", avatar: "👨‍💻", trait: "Analytical & Data-driven" },
  { key: "meera" as PersonaKey, name: "Meera", role: "Participant", avatar: "👩‍💼", trait: "Empathetic & Constructive" },
  { key: "kabir" as PersonaKey, name: "Kabir", role: "Participant", avatar: "👨‍🔬", trait: "Critical & Questioning" },
];

export function LiveArena({ sessionId, config, onStartNewSession }: LiveArenaProps) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("lobby");
  const [remainingSec, setRemainingSec] = useState<number>(config.durationSec);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeSpeaker, setActiveSpeaker] = useState<PersonaKey | "student" | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [partialTranscript, setPartialTranscript] = useState<{ speaker: PersonaKey | "student"; text: string } | null>(null);
  const [studentInput, setStudentInput] = useState<string>("");
  const [copiedNotice, setCopiedNotice] = useState<boolean>(false);

  const [report, setReport] = useState<Report | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Echo Mitigation state & debug counters
  const suppressedEchoCountRef = useRef<number>(0);
  const lastTtsEndTimeRef = useRef<number>(0);
  const currentAiUtteranceTextRef = useRef<string>("");
  const previousAiUtteranceTextRef = useRef<string>("");
  const prevTtsIsSpeakingRef = useRef<boolean>(false);

  // Debug overlay state (only active when URL contains ?debug=1)
  const isDebugMode = typeof window !== "undefined" && window.location.search.includes("debug=1");
  const [debugSuppressedCount, setDebugSuppressedCount] = useState<number>(0);
  const [debugBargeInCount, setDebugBargeInCount] = useState<number>(0);
  const [lastSuppressedTexts, setLastSuppressedTexts] = useState<string[]>([]);

  const recordSuppressed = useCallback(
    (text: string, reason: string) => {
      suppressedEchoCountRef.current++;
      console.debug(`[EchoMitigation] Suppressed #${suppressedEchoCountRef.current} (reason: ${reason}): "${text}"`);
      if (isDebugMode) {
        setDebugSuppressedCount(suppressedEchoCountRef.current);
        setLastSuppressedTexts((prev) => [text, ...prev].slice(0, 3));
      }
    },
    [isDebugMode]
  );

  const fetchReport = useCallback(async () => {
    if (!sessionId) return;
    setIsGeneratingReport(true);
    setReportError(null);
    try {
      const res = await fetch(getApiUrl(`/api/sessions/${sessionId}/report`));
      if (!res.ok) {
        let msg = `Failed to fetch report (${res.status})`;
        try {
          const errBody = await res.json();
          if (errBody?.error) msg = errBody.error;
        } catch {
          // fallback to default error msg
        }
        throw new Error(msg);
      }
      const data = await res.json();
      const parsedReport = Report.parse(data);
      setReport(parsedReport);
    } catch (err) {
      console.error("[LiveArena] Report fetch error:", err);
      setReportError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setIsGeneratingReport(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionStatus === "ended" && !report && !isGeneratingReport && !reportError) {
      void fetchReport();
    }
  }, [sessionStatus, report, isGeneratingReport, reportError, fetchReport]);

  const wsRef = useRef<WebSocket | null>(null);
  const transcriptFeedRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const sendTranscriptRef = useRef<(text: string) => void>(() => {});
  const sendPartialTranscriptRef = useRef<(text: string) => void>(() => {});
  const isHistoryLoadedRef = useRef<boolean>(false);

  const tts = useSpeechSynthesis();

  const ttsSpeakRef = useRef(tts.speak);
  const ttsStopRef = useRef(tts.stop);

  useEffect(() => {
    ttsSpeakRef.current = tts.speak;
    ttsStopRef.current = tts.stop;
  }, [tts.speak, tts.stop]);

  useEffect(() => {
    const timer = setTimeout(() => {
      isHistoryLoadedRef.current = true;
    }, 300);
    return () => clearTimeout(timer);
  }, [sessionId]);

  const sendStudentPartial = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const elapsedMs = (config.durationSec - remainingSec) * 1000;
    wsRef.current.send(
      JSON.stringify({
        type: "transcript_partial",
        tMs: Math.max(0, elapsedMs),
        data: { text },
      })
    );
  }, [config.durationSec, remainingSec]);

  const ttsIsSpeakingRef = useRef(tts.isSpeaking);
  const ttsSpeakingPersonaRef = useRef(tts.speakingPersona);

  useEffect(() => {
    if (prevTtsIsSpeakingRef.current && !tts.isSpeaking) {
      lastTtsEndTimeRef.current = Date.now();
      currentAiUtteranceTextRef.current = "";
      console.log(`[EchoMitigation] TTS ended at ${lastTtsEndTimeRef.current}. 400ms post-TTS window active.`);
    }
    prevTtsIsSpeakingRef.current = tts.isSpeaking;
    ttsIsSpeakingRef.current = tts.isSpeaking;
    ttsSpeakingPersonaRef.current = tts.speakingPersona;
  }, [tts.isSpeaking, tts.speakingPersona]);

  const shouldSuppressCandidateSpeech = useCallback(
    (text: string, isFinal: boolean): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return true;

      // 1. Post-TTS 400ms cooldown
      const timeSinceTtsEnd = Date.now() - lastTtsEndTimeRef.current;
      if (timeSinceTtsEnd < 400) {
        recordSuppressed(trimmed, `within 400ms post-TTS cooldown (${timeSinceTtsEnd}ms)`);
        return true;
      }

      // 2. Full text of CURRENT and PREVIOUS AI utterances
      const fullAiText = `${currentAiUtteranceTextRef.current} ${previousAiUtteranceTextRef.current}`.trim();

      // AI speaking overlap filter (< 2 words or >= 60% overlap with full AI text)
      if (
        (ttsIsSpeakingRef.current || (activeSpeaker !== null && activeSpeaker !== "student")) &&
        fullAiText
      ) {
        if (shouldSuppressAiEcho(trimmed, fullAiText)) {
          recordSuppressed(trimmed, `AI speaking overlap >= 60% or < 2 words against full AI text "${fullAiText}"`);
          return true;
        }
      }

      // 3. Barge-in interim word count check (requires >= 2 words)
      if (!isFinal && !isBargeInValid(trimmed)) {
        recordSuppressed(trimmed, `interim barge-in noise token < 2 words`);
        return true;
      }

      return false;
    },
    [activeSpeaker, recordSuppressed]
  );

  const handleCandidateSpeechDetected = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (ttsIsSpeakingRef.current) {
      console.log(`[TTS] barge-in triggered by candidate speech: "${trimmed}"`);
      console.log("[TTS] cancel requested");
      if (isDebugMode) {
        setDebugBargeInCount((prev) => prev + 1);
      }
      const interruptedSpeaker = ttsSpeakingPersonaRef.current;
      ttsStopRef.current();

      if (interruptedSpeaker && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const elapsedMs = (config.durationSec - remainingSec) * 1000;
        wsRef.current.send(
          JSON.stringify({
            type: "user_interrupted_ai",
            tMs: Math.max(0, elapsedMs),
            data: { speaker: interruptedSpeaker, playedMs: 500 },
          })
        );
      }
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const elapsedMs = (config.durationSec - remainingSec) * 1000;
      wsRef.current.send(
        JSON.stringify({
          type: "speaker_started",
          tMs: Math.max(0, elapsedMs),
          data: {},
        })
      );
    }
  }, [config.durationSec, remainingSec, isDebugMode]);

  const {
    isSupported: isMicSupported,
    micState,
    interimTranscript,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeech({
    shouldSuppress: shouldSuppressCandidateSpeech,
    onSpeechDetected: (text) => {
      handleCandidateSpeechDetected(text);
    },
    onFinalTranscript: (finalText) => {
      sendTranscriptRef.current(finalText);
      setPartialTranscript(null);
    },
    onInterimTranscript: (interimText) => {
      sendPartialTranscriptRef.current(interimText);
    },
  });

  useEffect(() => {
    if (connStatus === "connected" && (sessionStatus === "opening" || sessionStatus === "discussion")) {
      if (isMicSupported && micState === "idle") {
        console.log("[LiveArena] Auto-starting candidate microphone for discussion session");
        startListening();
      }
    }
  }, [connStatus, sessionStatus, isMicSupported, micState, startListening]);

  const sendStudentTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    console.log("[Voice] final transcript:", trimmed);

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[Voice] WebSocket not open, cannot send transcript");
      return;
    }

    const elapsedMs = (config.durationSec - remainingSec) * 1000;
    const clientEvent = {
      type: "transcript_final",
      tMs: Math.max(0, elapsedMs),
      data: {
        text: trimmed,
        startMs: Math.max(0, elapsedMs - 2000),
        endMs: Math.max(0, elapsedMs),
      },
    };

    console.log("[Voice] sending transcript_final:", clientEvent);
    wsRef.current.send(JSON.stringify(clientEvent));
  }, [config.durationSec, remainingSec]);

  useEffect(() => {
    sendTranscriptRef.current = sendStudentTranscript;
  }, [sendStudentTranscript]);

  useEffect(() => {
    const wsUrl = getWsUrl(sessionId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnStatus("connected");
      setErrorMsg(null);
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        const parsed = ServerEvent.safeParse(raw);
        if (!parsed.success) return;

        const serverEv = parsed.data;

        if (serverEv.type === "session_started") {
          setSessionStatus(serverEv.data.status);
        } else if (serverEv.type === "timer_update") {
          setRemainingSec(serverEv.data.remainingSec);
          setSessionStatus(serverEv.data.status);
        } else if (serverEv.type === "participant_selected") {
          setActiveSpeaker(serverEv.data.speaker);
        } else if (serverEv.type === "ai_started_speaking") {
          setActiveSpeaker(serverEv.data.speaker);
        } else if (serverEv.type === "ai_stopped_speaking") {
          setActiveSpeaker((curr) => (curr === serverEv.data.speaker ? null : curr));
        } else if (serverEv.type === "transcript_partial") {
          if (serverEv.data.speaker !== "student") {
            setPartialTranscript({ speaker: serverEv.data.speaker, text: serverEv.data.text });
          }
        } else if (serverEv.type === "transcript_final") {
          const { segmentId, speaker, text } = serverEv.data;
          setPartialTranscript(null);
          setTranscript((prev) => {
            if (prev.some((item) => item.segmentId === segmentId)) {
              return prev;
            }
            return [...prev, { segmentId, speaker, text, tMs: serverEv.tMs }];
          });

          if (speaker === "student") {
            setActiveSpeaker(null);
          } else {
            currentAiUtteranceTextRef.current = text;
            console.log(`[TTS] WebSocket received AI transcript turn: segment ${segmentId}, speaker ${speaker}`);
            ttsSpeakRef.current(segmentId, text, speaker);
          }
        } else if (serverEv.type === "session_ended") {
          setSessionStatus("ended");
          setConnStatus("ended");
          setActiveSpeaker(null);
          ttsStopRef.current();
          stopListening();
        } else if (serverEv.type === "error") {
          setErrorMsg(serverEv.data.message);
        }
      } catch (err) {
        // Ignore unparseable frames
      }
    };

    ws.onclose = () => {
      setConnStatus((prev) => (prev === "ended" ? "ended" : "disconnected"));
    };

    ws.onerror = () => {
      setConnStatus("disconnected");
      setErrorMsg("WebSocket connection error");
    };

    return () => {
      ws.close();
      ttsStopRef.current();
    };
  }, [sessionId]);

  useEffect(() => {
    const feed = transcriptFeedRef.current;
    if (!feed) return;
    const isNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    if (isNearBottom || transcript.length === 1) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, interimTranscript, partialTranscript]);

  const handleEndGD = async () => {
    stopListening();
    tts.stop();
    try {
      const res = await fetch(getApiUrl(`/api/sessions/${sessionId}/end`), { method: "POST" });
      if (res.ok) {
        setSessionStatus("ended");
        setConnStatus("ended");
      }
    } catch (e) {
      setErrorMsg("Failed to end session");
    }
  };

  const handleSendTextFallback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentInput.trim()) return;

    handleCandidateSpeechDetected(studentInput.trim());
    sendStudentTranscript(studentInput.trim());
    setStudentInput("");
  };

  const handleCopyTranscript = () => {
    if (transcript.length === 0) return;
    const lines = transcript.map((item) => {
      const meta = getSpeakerMeta(item.speaker);
      return `[${formatTimestamp(item.tMs)}] ${meta.name}: ${item.text}`;
    });
    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  const formatTimer = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTimestamp = (tMs: number): string => {
    const totalSecs = Math.floor(tMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const selectedPersonas = AI_PERSONAS.slice(1, config.panelSize + 1);

  const getSpeakerMeta = (speaker: PersonaKey | "student") => {
    if (speaker === "student") {
      return { name: "You (Candidate)", avatar: "🧑‍🎓", badgeClass: "speaker-student" };
    }
    const found = AI_PERSONAS.find((p) => p.key === speaker);
    return {
      name: found ? found.name : speaker,
      avatar: found ? found.avatar : "🤖",
      badgeClass: speaker === "moderator" ? "speaker-moderator" : "speaker-ai",
    };
  };

  const currentSpeaker = (tts.isSpeaking && tts.speakingPersona) ? tts.speakingPersona : activeSpeaker;
  const liveStreamingText = interimTranscript || (partialTranscript?.speaker === "student" ? partialTranscript.text : "");

  const convertedTranscriptSegments: TranscriptSegment[] = transcript.map((item) => ({
    id: item.segmentId,
    seq: item.segmentId,
    speaker: item.speaker,
    startMs: item.tMs,
    endMs: item.tMs + 2000,
    text: item.text,
    interrupted: false,
    source: item.speaker === "student" ? "stt" : "llm",
  }));

  if (sessionStatus === "ended") {
    if (report) {
      return <ReportView report={report} transcript={convertedTranscriptSegments} onNewSession={onStartNewSession} />;
    }

    if (isGeneratingReport) {
      return (
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          padding: "3rem 2rem",
          textAlign: "center",
          margin: "2rem 0"
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📊</div>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.4rem", fontWeight: 700 }}>
            Generating GD Performance Report...
          </h3>
          <p style={{ margin: 0, opacity: 0.75, fontSize: "0.95rem" }}>
            Calculating session metrics and validating transcript evidence.
          </p>
        </div>
      );
    }

    if (reportError) {
      return (
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--danger)",
          borderRadius: "16px",
          padding: "2rem",
          textAlign: "center",
          margin: "2rem 0"
        }}>
          <h3 style={{ margin: "0 0 0.5rem", color: "var(--danger)", fontSize: "1.2rem", fontWeight: 700 }}>
            Unable to Load Report
          </h3>
          <p style={{ margin: "0 0 1rem", opacity: 0.8, fontSize: "0.9rem" }}>{reportError}</p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
            <button className="btn-primary" style={{ width: "auto" }} onClick={fetchReport}>
              Retry Generating Report
            </button>
            <button className="btn-secondary" onClick={onStartNewSession}>
              Start New GD
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="live-arena-container">
      {/* HEADER BAR */}
      <header className="arena-header">
        <div className="header-main">
          <span className="room-label">Live Discussion Arena</span>
          <h2 className="topic-title">{config.topic}</h2>
        </div>

        <div className="status-cluster">
          <div className={`status-pill status-${sessionStatus}`}>
            <span className="pulse-dot"></span>
            <span className="status-text">{sessionStatus.toUpperCase()}</span>
          </div>

          <div className="timer-badge" role="timer" aria-live="polite">
            <span className="timer-icon">⏱️</span>
            <span className="timer-value">{formatTimer(remainingSec)}</span>
          </div>

          <div className={`connection-tag conn-${connStatus === "disconnected" && sessionStatus === "ended" ? "ended" : connStatus}`}>
            {connStatus === "connected" && "🟢 WS Connected"}
            {connStatus === "connecting" && "🟡 Connecting…"}
            {connStatus === "disconnected" && (sessionStatus === "ended" ? "⚪ Session Ended" : "🔴 Disconnected")}
            {connStatus === "ended" && "⚪ Session Ended"}
          </div>

          {/* VOICE OUTPUT CONTROLS */}
          <div className="voice-controls">
            <button
              type="button"
              className={`btn-voice-toggle ${tts.isMuted ? "muted" : "active"}`}
              onClick={tts.toggleMute}
              title={tts.isMuted ? "Unmute AI Voice Output" : "Mute AI Voice Output"}
            >
              {tts.isMuted ? "🔇 Voice OFF" : "🔊 Voice ON"}
            </button>

            <button
              type="button"
              className="btn-stop-voice"
              onClick={tts.stop}
              disabled={!tts.isSpeaking}
              title="Stop current AI voice speech"
            >
              ⏹️ Stop AI Voice
            </button>
          </div>
        </div>
      </header>

      {(errorMsg || speechError || tts.error) && (
        <div className="error-banner" role="alert">
          {errorMsg || speechError || tts.error}
        </div>
      )}

      {/* AI DISCLOSURE NOTICE */}
      <div className="ai-disclosure-banner" style={{ background: "rgba(99, 102, 241, 0.1)", border: "1px solid var(--accent)", borderRadius: "8px", padding: "0.5rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span>🤖</span>
        <span><strong>AI Disclosure:</strong> AI personas speak out loud using speech synthesis. 🎧 <strong>Use headphones</strong> to prevent microphone echo.</span>
      </div>

      {/* PARTICIPANTS STAGE */}
      <section className="arena-stage" aria-label="Discussion Participants">
        {/* MODERATOR CARD */}
        <div className={currentSpeaker === "moderator" ? "persona-card moderator-card speaking-active" : "persona-card moderator-card"}>
          <div className="avatar-circle">{AI_PERSONAS[0]!.avatar}</div>
          <div className="persona-details">
            <span className="persona-name">{AI_PERSONAS[0]!.name}</span>
            <span className="persona-role">{AI_PERSONAS[0]!.role}</span>
            <span className="persona-trait">{AI_PERSONAS[0]!.trait}</span>
          </div>
          <div className="persona-status-badge">
            {currentSpeaker === "moderator" ? "🗣️ Speaking..." : sessionStatus === "opening" ? "Opening" : sessionStatus === "ended" ? "Concluded" : "Monitoring"}
          </div>
        </div>

        {/* AI PARTICIPANTS GRID */}
        <div className="participants-grid">
          {selectedPersonas.map((persona) => {
            const isSpeaking = currentSpeaker === persona.key;
            return (
              <div key={persona.key} className={isSpeaking ? "persona-card ai-card speaking-active" : "persona-card ai-card"}>
                <div className="avatar-circle">{persona.avatar}</div>
                <div className="persona-details">
                  <span className="persona-name">{persona.name}</span>
                  <span className="persona-role">AI {persona.role}</span>
                  <span className="persona-trait">{persona.trait}</span>
                </div>
                <div className="persona-status-badge">
                  {isSpeaking ? "🗣️ Speaking..." : sessionStatus === "ended" ? "Ended" : "Listening"}
                </div>
              </div>
            );
          })}

          {/* HUMAN STUDENT CARD */}
          <div className={currentSpeaker === "student" || micState === "listening" || liveStreamingText ? "persona-card student-card speaking-active" : "persona-card student-card"}>
            <div className="avatar-circle">🧑‍🎓</div>
            <div className="persona-details">
              <span className="persona-name">You (Candidate)</span>
              <span className="persona-role">Human Student</span>
              <span className="persona-trait">Your Voice / Mic</span>
            </div>
            <div className="persona-status-badge active-user">
              {micState === "listening" ? "🔴 Listening..." : micState === "processing" ? "⚙️ Processing..." : "Ready"}
            </div>
          </div>
        </div>
      </section>

      {/* LIVE TRANSCRIPT FEED */}
      <section className="transcript-section">
        <div className="transcript-header-row">
          <h3 className="section-subtitle">Live Discussion Transcript</h3>
          {transcript.length > 0 && (
            <button type="button" className="btn-copy-transcript" onClick={handleCopyTranscript}>
              {copiedNotice ? "✓ Copied!" : "📋 Copy Transcript"}
            </button>
          )}
        </div>

        <div className="transcript-feed" ref={transcriptFeedRef} role="log" aria-live="polite">
          {transcript.length === 0 && !liveStreamingText ? (
            <p className="transcript-empty">Waiting for speakers to initiate discussion…</p>
          ) : (
            <>
              {transcript.map((item) => {
                const meta = getSpeakerMeta(item.speaker);
                return (
                  <div key={item.segmentId} className={`transcript-entry ${meta.badgeClass}`}>
                    <div className="entry-header">
                      <span className="entry-avatar">{meta.avatar}</span>
                      <span className="entry-author">{meta.name}</span>
                      <span className="entry-time">{formatTimestamp(item.tMs)}</span>
                    </div>
                    <p className="entry-text">{item.text}</p>
                  </div>
                );
              })}

              {/* LIVE STREAMING CANDIDATE TRANSCRIPT BUBBLE */}
              {liveStreamingText && (
                <div className="transcript-entry speaker-student interim-entry">
                  <div className="entry-header">
                    <span className="entry-avatar">🧑‍🎓</span>
                    <span className="entry-author">You (Candidate)</span>
                    <span className="live-typing-indicator">🎙️ Live Speaking...</span>
                  </div>
                  <p className="entry-text interim-text">
                    {liveStreamingText}
                    <span className="blinking-cursor">▌</span>
                  </p>
                </div>
              )}
            </>
          )}
          <div ref={transcriptEndRef} />
        </div>
      </section>

      {/* MICROPHONE INPUT CONTROLS & INTERIM PREVIEW */}
      {sessionStatus !== "ended" && (
        <section className="mic-control-section">
          {/* MIC CHECK HEADPHONES NOTICE */}
          <div className="mic-headphones-notice" style={{ background: "var(--card-bg)", border: "1px solid var(--line)", borderRadius: "8px", padding: "0.5rem 0.8rem", marginBottom: "0.75rem", fontSize: "0.85rem", opacity: 0.9 }}>
            🎧 <strong>Mic Check:</strong> Please use headphones for clear audio and echo prevention.
          </div>

          <div className="mic-control-header">
            <span className="section-title-sm">Candidate Voice Input</span>
            <div className={`mic-status-badge state-${micState}`}>
              {micState === "listening" && "🔴 Listening"}
              {micState === "requesting" && "⏳ Permission Required"}
              {micState === "processing" && "⚙️ Processing speech"}
              {micState === "denied" && "🚫 Permission denied"}
              {micState === "unsupported" && "⚠️ Microphone unavailable"}
              {micState === "idle" && "Ready"}
            </div>
          </div>

          <div className="mic-actions">
            {micState === "listening" ? (
              <button type="button" className="btn-mic listening" onClick={stopListening}>
                🔴 Listening... (Click to stop)
              </button>
            ) : (
              <button
                type="button"
                className="btn-mic idle"
                onClick={startListening}
                disabled={connStatus !== "connected" || !isMicSupported || micState === "denied"}
              >
                🎤 Start Speaking
              </button>
            )}
          </div>

          {/* LIVE INTERIM TRANSCRIPT PREVIEW */}
          {interimTranscript && (
            <div className="interim-preview-box">
              <span className="preview-label">💬 Live Preview:</span>
              <span className="preview-text">"{interimTranscript}"</span>
            </div>
          )}

          {/* TEXT FALLBACK INPUT */}
          <div className="text-fallback-block">
            <details className="fallback-details">
              <summary className="fallback-summary">Text fallback (Use if microphone is unavailable or denied)</summary>
              <form onSubmit={handleSendTextFallback} className="fallback-form">
                <input
                  type="text"
                  className="fallback-text-input"
                  placeholder="Type fallback student response..."
                  value={studentInput}
                  onChange={(e) => setStudentInput(e.target.value)}
                  disabled={connStatus !== "connected"}
                />
                <button
                  type="submit"
                  className="btn-secondary fallback-send-btn"
                  disabled={connStatus !== "connected" || !studentInput.trim()}
                >
                  Send Fallback Text
                </button>
              </form>
            </details>
          </div>
        </section>
      )}

      {/* FOOTER ACTIONS */}
      <footer className="arena-footer">
        {sessionStatus !== "ended" ? (
          <button className="btn-danger end-gd-btn" onClick={handleEndGD}>
            End GD
          </button>
        ) : (
          <div className="session-ended-actions">
            <div className="ended-notice">
              🎉 Discussion Completed! Server event logged state: <strong>ENDED</strong>
            </div>
            <button className="btn-primary" onClick={onStartNewSession}>
              Start New GD Session
            </button>
          </div>
        )}
      </footer>

      {/* DEBUG OVERLAY (Only rendered when URL contains ?debug=1) */}
      {isDebugMode && (
        <div
          className="debug-overlay"
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            background: "rgba(15, 23, 42, 0.92)",
            color: "#38bdf8",
            border: "1px solid #0284c7",
            borderRadius: "10px",
            padding: "12px 16px",
            fontSize: "0.8rem",
            fontFamily: "monospace",
            zIndex: 99999,
            maxWidth: "320px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "6px", color: "#f3f4f6" }}>
            🛠️ Echo Debug Overlay (?debug=1)
          </div>
          <div>Suppressed Results: <strong>{debugSuppressedCount}</strong></div>
          <div>Barge-in Triggers: <strong>{debugBargeInCount}</strong></div>
          <div style={{ marginTop: "8px" }}>
            <div style={{ fontWeight: 600, color: "#9ca3af" }}>Last 3 Suppressed Texts:</div>
            {lastSuppressedTexts.length === 0 ? (
              <div style={{ opacity: 0.6, fontStyle: "italic" }}>None</div>
            ) : (
              <ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {lastSuppressedTexts.map((txt, i) => (
                  <li key={i} style={{ wordBreak: "break-word", color: "#f87171" }}>
                    "{txt}"
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
