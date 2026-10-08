import React, { useState } from "react";
import type { MissedOpportunity, RetryAttempt, TranscriptSegment } from "@gd-arena/contracts";
import { useSpeech } from "../hooks/useSpeech";
import { getApiUrl } from "../utils/config";

interface RetryModalProps {
  sessionId: string;
  opportunity: MissedOpportunity;
  transcript: TranscriptSegment[];
  onClose: () => void;
  onRetryComplete?: (attempt: RetryAttempt) => void;
}

export const RetryModal: React.FC<RetryModalProps> = ({
  sessionId,
  opportunity,
  transcript,
  onClose,
  onRetryComplete,
}) => {
  const [retryInputText, setRetryInputText] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<RetryAttempt | null>(null);

  const {
    isSupported: isMicSupported,
    micState,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeech({
    onFinalTranscript: (finalText) => {
      setRetryInputText(finalText);
    },
  });

  // Extract preceding context turns (up to 3 turns)
  const contextSegments = transcript.filter((s) => opportunity.contextSegmentIds.includes(s.id));
  const precedingTurns = contextSegments.length > 0
    ? contextSegments
    : transcript.filter((s) => s.startMs < opportunity.tMs).slice(-2);

  const handleSubmittingRetry = async (textToSubmit: string) => {
    const trimmed = textToSubmit.trim();
    if (!trimmed) {
      setErrorMsg("Please provide a response before submitting.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(getApiUrl(`/api/sessions/${sessionId}/retry`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          retryResponse: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      const attempt: RetryAttempt = await res.json();
      setRetryResult(attempt);
      if (onRetryComplete) {
        onRetryComplete(attempt);
      }
    } catch (err) {
      console.error("[RetryModal] Retry evaluation error:", err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to evaluate retry");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="retry-modal-overlay" style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: "1rem"
    }}>
      <div className="retry-modal-container" style={{
        background: "var(--card-bg)",
        border: "1px solid var(--line)",
        borderRadius: "20px",
        maxWidth: "600px",
        width: "100%",
        maxHeight: "90vh",
        overflowY: "auto",
        padding: "1.75rem",
        boxShadow: "0 20px 50px rgba(0,0,0,0.3)"
      }}>
        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", borderBottom: "1px solid var(--line)", paddingBottom: "0.85rem" }}>
          <div>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              RETRY WEAK MOMENT [{formatTime(opportunity.tMs)}]
            </span>
            <h3 style={{ margin: "0.2rem 0 0", fontSize: "1.3rem", fontWeight: 700 }}>
              {opportunity.dimension.replace("_", " ").toUpperCase()}
            </h3>
          </div>

          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", fontSize: "1.4rem", cursor: "pointer", opacity: 0.7 }}
          >
            ✕
          </button>
        </div>

        {/* COMPARISON VIEW (WHEN RETRY IS COMPLETED) */}
        {retryResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div style={{
              background: "var(--success-soft)",
              border: "1px solid var(--success)",
              borderRadius: "14px",
              padding: "1rem",
              textAlign: "center"
            }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--success)", textTransform: "uppercase" }}>
                RETRY COMPLETED!
              </span>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--success)", margin: "0.2rem 0" }}>
                {retryResult.scoreDiff >= 0 ? `+${retryResult.scoreDiff}` : retryResult.scoreDiff} Points
              </div>
              <span style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                Score improved from {Math.round(retryResult.originalScore / 10)}/10 to {Math.round(retryResult.retryScore / 10)}/10
              </span>
            </div>

            {/* ORIGINAL VS RETRY SIDE BY SIDE / CARDS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
              <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, opacity: 0.7 }}>ORIGINAL</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--danger)" }}>
                    {Math.round(retryResult.originalScore / 10)}/10
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "0.9rem", fontStyle: "italic", opacity: 0.9 }}>
                  "{retryResult.originalResponse}"
                </p>
              </div>

              <div style={{ background: "var(--paper)", border: "1px solid var(--accent)", borderRadius: "12px", padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent)" }}>RETRY</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--success)" }}>
                    {Math.round(retryResult.retryScore / 10)}/10
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 500 }}>
                  "{retryResult.retryResponse}"
                </p>
              </div>
            </div>

            {/* WHAT IMPROVED BULLETS */}
            {retryResult.improvements.length > 0 && (
              <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, opacity: 0.7, textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                  WHAT IMPROVED
                </span>
                <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
                  {retryResult.improvements.map((imp, idx) => (
                    <li key={idx} style={{ color: "var(--success)" }}>
                      <span style={{ color: "var(--ink)" }}>{imp}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  setRetryResult(null);
                  setRetryInputText("");
                }}
              >
                Try Again
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={onClose}
              >
                Back to Report
              </button>
            </div>
          </div>
        ) : (
          /* INPUT & CONTEXT REPLAY VIEW */
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* 1. CONTEXT REPLAY */}
            <div>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.7, textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                DISCUSSION CONTEXT (PREVIOUS TURNS)
              </span>

              <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {precedingTurns.map((s) => (
                  <div key={s.id} style={{ fontSize: "0.88rem" }}>
                    <span style={{ fontWeight: 700, color: s.speaker === "student" ? "var(--accent)" : "inherit" }}>
                      {s.speaker === "student" ? "You" : s.speaker.toUpperCase()}:
                    </span>{" "}
                    "{s.text}"
                  </div>
                ))}
              </div>
            </div>

            {/* 2. WHAT HAPPENED & SUGGESTION */}
            <div style={{ background: "var(--paper)", borderLeft: "3px solid var(--accent)", padding: "0.85rem 1rem", borderRadius: "0 10px 10px 0" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block" }}>
                WHAT COULD BE IMPROVED
              </span>
              <p style={{ margin: "0.2rem 0 0.5rem", fontSize: "0.9rem" }}>
                {opportunity.whatHappened}
              </p>

              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block" }}>
                SUGGESTED STRONGER RESPONSE (AI SUGGESTION)
              </span>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.88rem", fontStyle: "italic", opacity: 0.9 }}>
                "{opportunity.suggestedResponse}"
              </p>
            </div>

            {/* 3. CANDIDATE RETRY INPUT */}
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
                Now respond again with your updated response:
              </label>

              {/* VOICE CONTROLS */}
              <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.85rem" }}>
                {micState === "listening" ? (
                  <button
                    type="button"
                    className="btn-mic listening"
                    style={{ flex: 1, padding: "0.65rem 1rem" }}
                    onClick={stopListening}
                  >
                    🔴 Listening... (Click to stop)
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-mic idle"
                    style={{ flex: 1, padding: "0.65rem 1rem" }}
                    onClick={startListening}
                    disabled={!isMicSupported || micState === "denied"}
                  >
                    🎤 Speak Response
                  </button>
                )}
              </div>

              {interimTranscript && (
                <div style={{ fontSize: "0.82rem", fontStyle: "italic", color: "var(--accent)", marginBottom: "0.5rem" }}>
                  Live speaking: "{interimTranscript}"
                </div>
              )}

              {/* TEXT FALLBACK INPUT */}
              <textarea
                value={retryInputText}
                onChange={(e) => setRetryInputText(e.target.value)}
                placeholder="Type your improved candidate response..."
                style={{
                  width: "100%",
                  minHeight: "80px",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                  fontSize: "0.92rem",
                  resize: "vertical"
                }}
              />
            </div>

            {errorMsg && (
              <div style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
                {errorMsg}
              </div>
            )}

            {/* ACTION BUTTONS */}
            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={() => handleSubmittingRetry(retryInputText)}
                disabled={isSubmitting || !retryInputText.trim()}
              >
                {isSubmitting ? "Evaluating Retry..." : "Submit Retry & Evaluate"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
