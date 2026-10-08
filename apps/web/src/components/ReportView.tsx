import React, { useState } from "react";
import type { FeedbackItem, MissedOpportunity, Report, SkillScore, TranscriptSegment } from "@gd-arena/contracts";
import { RetryModal } from "./RetryModal";

interface ReportViewProps {
  report: Report;
  transcript?: TranscriptSegment[];
  onNewSession?: () => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ report, transcript = [], onNewSession }) => {
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<number | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState<boolean>(false);
  const [activeRetryOpp, setActiveRetryOpp] = useState<MissedOpportunity | null>(null);

  const formatTime = (ms: number | null | undefined): string => {
    if (ms === null || ms === undefined) return "--:--";
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleJumpToTranscript = (segmentId: number) => {
    setHighlightedSegmentId(segmentId);
    setShowFullTranscript(true);
    setTimeout(() => {
      const el = document.getElementById(`transcript-segment-${segmentId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  const overallScoreObj = report.scores.find((s) => s.dimension === "overall_performance");
  const overallScoreVal = overallScoreObj ? Math.round(overallScoreObj.score / 10) : 7;

  return (
    <div className="report-view-container" style={{ padding: "1.5rem 0" }}>
      {/* HEADER BAR */}
      <div className="report-header-card" style={{
        background: "var(--card-bg)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        padding: "1.75rem",
        marginBottom: "1.5rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.08em", color: "var(--accent)", textTransform: "uppercase" }}>
              GD PERFORMANCE REPORT
            </span>
            <h2 style={{ margin: "0.4rem 0 0.2rem", fontSize: "1.6rem", fontWeight: 700 }}>
              {report.topic || "Group Discussion"}
            </h2>
            <p style={{ margin: 0, opacity: 0.7, fontSize: "0.85rem" }}>
              Session ID: {report.sessionId}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
              borderRadius: "14px",
              padding: "0.75rem 1.25rem",
              textAlign: "center"
            }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.85, display: "block" }}>OVERALL SCORE</span>
              <span style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--accent)" }}>
                {overallScoreVal}/10
              </span>
            </div>

            {onNewSession && (
              <button
                onClick={onNewSession}
                className="btn-primary"
                style={{ width: "auto", padding: "0.65rem 1.2rem", fontSize: "0.9rem" }}
              >
                Start New GD
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 1. SESSION METRICS GRID */}
      <div style={{ marginBottom: "2rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem", letterSpacing: "-0.01em" }}>
          SESSION METRICS
        </h3>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "1rem"
        }}>
          <MetricCard
            label="Speaking Share"
            value={`${report.metrics.speakingRatioPercent ?? Math.round((report.metrics.speakingShare || 0) * 100)}%`}
            hint={`${Math.round((report.metrics.studentSpeakingMs || 0) / 1000)}s spoken`}
          />
          <MetricCard
            label="Candidate Turns"
            value={report.metrics.turns.toString()}
            hint={`AI turns: ${report.metrics.aiTurnCount ?? 0}`}
          />
          <MetricCard
            label="Word Count"
            value={report.metrics.words.toString()}
            hint="total words"
          />
          <MetricCard
            label="First Contribution"
            value={formatTime(report.metrics.firstSpeakMs)}
            hint="timestamp"
          />
          <MetricCard
            label="Interruptions"
            value={report.metrics.interruptionsMade.toString()}
            hint="interrupted AI"
          />
          <MetricCard
            label="Longest Silence"
            value={formatTime(report.metrics.longestSilenceMs)}
            hint="quiet gap"
          />
        </div>
      </div>

      {/* 2. EIGHT PERFORMANCE DIMENSIONS */}
      <div style={{ marginBottom: "2rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
          SKILL SCORES (8 DIMENSIONS)
        </h3>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0.9rem"
        }}>
          {report.scores.map((scoreObj) => (
            <SkillScoreBar key={scoreObj.dimension} scoreObj={scoreObj} />
          ))}
        </div>
      </div>

      {/* 3. MISSED OPPORTUNITIES (UP TO 3 CARDS) */}
      {report.missedOpportunities && report.missedOpportunities.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
            MISSED OPPORTUNITIES ({report.missedOpportunities.length})
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {report.missedOpportunities.map((opp, idx) => (
              <div
                key={opp.id}
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--accent)",
                  borderRadius: "14px",
                  padding: "1.25rem",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.03)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", background: "var(--accent-soft)", color: "var(--accent)", padding: "0.25rem 0.65rem", borderRadius: "6px" }}>
                      MISSED OPPORTUNITY #{idx + 1}
                    </span>
                    <span style={{ fontSize: "0.8rem", opacity: 0.75 }}>
                      [{formatTime(opp.tMs)}]
                    </span>
                  </div>

                  <button
                    onClick={() => setActiveRetryOpp(opp)}
                    className="btn-primary"
                    style={{ width: "auto", padding: "0.45rem 1rem", fontSize: "0.85rem" }}
                  >
                    [Try This Moment →]
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.65, textTransform: "uppercase", display: "block" }}>
                      WHAT HAPPENED
                    </span>
                    <p style={{ margin: "0.15rem 0 0", fontSize: "0.92rem", lineHeight: 1.4 }}>
                      {opp.whatHappened}
                    </p>
                  </div>

                  <div>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.65, textTransform: "uppercase", display: "block" }}>
                      WHY IT MATTERS
                    </span>
                    <p style={{ margin: "0.15rem 0 0", fontSize: "0.9rem", opacity: 0.9, lineHeight: 1.4 }}>
                      {opp.whyItMatters}
                    </p>
                  </div>

                  <div style={{ background: "var(--paper)", borderLeft: "3px solid var(--danger)", padding: "0.65rem 0.85rem", borderRadius: "0 8px 8px 0" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", display: "block", marginBottom: "0.15rem" }}>
                      YOUR RESPONSE
                    </span>
                    <p style={{ margin: 0, fontSize: "0.9rem", fontStyle: "italic" }}>
                      "{opp.candidateQuote}"
                    </p>
                  </div>

                  <div style={{ background: "var(--accent-soft)", borderLeft: "3px solid var(--accent)", padding: "0.65rem 0.85rem", borderRadius: "0 8px 8px 0" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: "0.15rem" }}>
                      WHAT YOU COULD HAVE SAID (AI SUGGESTION)
                    </span>
                    <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 500 }}>
                      "{opp.suggestedResponse}"
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RETRY MODAL */}
      {activeRetryOpp && (
        <RetryModal
          sessionId={report.sessionId}
          opportunity={activeRetryOpp}
          transcript={transcript}
          onClose={() => setActiveRetryOpp(null)}
        />
      )}

      {/* 3. EVIDENCE-BASED FEEDBACK */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>
            EVIDENCE-BASED FEEDBACK ({report.items.length})
          </h3>
          <button
            onClick={() => setShowFullTranscript(!showFullTranscript)}
            className="btn-secondary"
            style={{ margin: 0, padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
          >
            {showFullTranscript ? "Hide Full Transcript" : "View Full Transcript"}
          </button>
        </div>

        {report.items.length === 0 ? (
          <div style={{
            background: "var(--card-bg)",
            border: "1px dashed var(--line)",
            borderRadius: "12px",
            padding: "1.5rem",
            textAlign: "center",
            opacity: 0.8
          }}>
            No evidence feedback items found for this session.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
            {report.items.map((item, index) => (
              <EvidenceCard
                key={index}
                item={item}
                onJumpToTranscript={() => handleJumpToTranscript(item.segmentId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 4. FULL TRANSCRIPT DRAWER / DRAWER MODAL */}
      {showFullTranscript && (
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          padding: "1.5rem",
          marginTop: "1.5rem"
        }}>
          <h4 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 700 }}>
            Session Transcript History
          </h4>

          {transcript.length === 0 ? (
            <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>No transcript segments recorded.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "400px", overflowY: "auto", paddingRight: "0.5rem" }}>
              {transcript.map((s) => {
                const isCandidate = s.speaker === "student";
                const isHighlighted = s.id === highlightedSegmentId;

                return (
                  <div
                    key={s.id}
                    id={`transcript-segment-${s.id}`}
                    style={{
                      padding: "0.85rem 1rem",
                      borderRadius: "10px",
                      border: isHighlighted ? "2px solid var(--accent)" : "1px solid var(--line)",
                      background: isHighlighted
                        ? "var(--accent-soft)"
                        : isCandidate
                        ? "var(--paper)"
                        : "var(--card-bg)",
                      transition: "all 0.2s ease"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", opacity: 0.75, marginBottom: "0.3rem" }}>
                      <span style={{ fontWeight: 700, color: isCandidate ? "var(--accent)" : "inherit" }}>
                        {isCandidate ? "You" : s.speaker.toUpperCase()}
                      </span>
                      <span>[{formatTime(s.startMs)}] Segment #{s.id}</span>
                    </div>
                    <div style={{ fontSize: "0.92rem", lineHeight: 1.4 }}>
                      "{s.text}"
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div style={{
    background: "var(--card-bg)",
    border: "1px solid var(--line)",
    borderRadius: "12px",
    padding: "1rem",
    textAlign: "center"
  }}>
    <span style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.7, textTransform: "uppercase", display: "block", marginBottom: "0.3rem" }}>
      {label}
    </span>
    <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--ink)", display: "block" }}>
      {value}
    </span>
    {hint && <span style={{ fontSize: "0.72rem", opacity: 0.6, display: "block", marginTop: "0.2rem" }}>{hint}</span>}
  </div>
);

const SkillScoreBar: React.FC<{ scoreObj: SkillScore }> = ({ scoreObj }) => {
  const scoreOutOfTen = Math.round(scoreObj.score / 10);
  const isHigh = scoreOutOfTen >= 7;
  const isMedium = scoreOutOfTen >= 5 && scoreOutOfTen < 7;

  const barColor = isHigh ? "var(--success)" : isMedium ? "var(--accent)" : "var(--danger)";

  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--line)",
      borderRadius: "12px",
      padding: "1rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.5rem"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>
          {scoreObj.label || scoreObj.dimension}
        </span>
        <span style={{ fontSize: "0.95rem", fontWeight: 800, color: barColor }}>
          {scoreOutOfTen}/10
        </span>
      </div>

      <div style={{ width: "100%", height: "6px", background: "var(--line)", borderRadius: "3px", overflow: "hidden" }}>
        <div
          style={{
            width: `${scoreObj.score}%`,
            height: "100%",
            background: barColor,
            borderRadius: "3px",
            transition: "width 0.4s ease"
          }}
        />
      </div>
    </div>
  );
};

const EvidenceCard: React.FC<{ item: FeedbackItem; onJumpToTranscript: () => void }> = ({ item, onJumpToTranscript }) => {
  const formatTime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const badgeColor = item.severity === "good" ? "var(--success)" : item.severity === "warn" ? "var(--accent)" : "var(--danger)";
  const badgeBg = item.severity === "good" ? "var(--success-soft)" : item.severity === "warn" ? "var(--accent-soft)" : "var(--danger-soft)";

  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--line)",
      borderRadius: "14px",
      padding: "1.25rem",
      boxShadow: "0 2px 10px rgba(0,0,0,0.02)"
    }}>
      {/* BADGE BAR */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
        <span style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          textTransform: "uppercase",
          background: badgeBg,
          color: badgeColor,
          padding: "0.25rem 0.65rem",
          borderRadius: "6px"
        }}>
          {item.dimension.replace("_", " ")}
        </span>

        <button
          onClick={onJumpToTranscript}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--accent)",
            fontWeight: 600,
            fontSize: "0.82rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.3rem"
          }}
        >
          Jump to transcript [{formatTime(item.tMs)}] →
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {/* WHAT HAPPENED */}
        <div>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.65, textTransform: "uppercase", display: "block" }}>
            WHAT HAPPENED
          </span>
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.92rem", lineHeight: 1.4 }}>
            {item.whatHappened || item.text}
          </p>
        </div>

        {/* WHY IT MATTERS */}
        {item.whyItMatters && (
          <div>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.65, textTransform: "uppercase", display: "block" }}>
              WHY IT MATTERS
            </span>
            <p style={{ margin: "0.15rem 0 0", fontSize: "0.9rem", opacity: 0.9, lineHeight: 1.4 }}>
              {item.whyItMatters}
            </p>
          </div>
        )}

        {/* YOUR ACTUAL WORDS */}
        <div style={{
          background: "var(--paper)",
          borderLeft: "3px solid var(--accent)",
          padding: "0.75rem 0.9rem",
          borderRadius: "0 8px 8px 0"
        }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>
            [{formatTime(item.tMs)}] You:
          </span>
          <p style={{ margin: 0, fontSize: "0.92rem", fontStyle: "italic", fontWeight: 500 }}>
            "{item.quote}"
          </p>
        </div>

        {/* HOW TO IMPROVE */}
        {item.howToImprove && (
          <div>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.65, textTransform: "uppercase", display: "block" }}>
              HOW TO IMPROVE
            </span>
            <p style={{ margin: "0.15rem 0 0", fontSize: "0.9rem", color: "var(--accent)", fontWeight: 500, lineHeight: 1.4 }}>
              {item.howToImprove}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
