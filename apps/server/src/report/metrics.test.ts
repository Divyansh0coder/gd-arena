import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@gd-arena/contracts";
import { calculateMetrics } from "./metrics";

describe("Session Metrics Calculator", () => {
  it("calculates accurate metrics for normal session", () => {
    const segments: TranscriptSegment[] = [
      { id: 1, seq: 1, speaker: "moderator", startMs: 0, endMs: 5000, text: "Welcome to the group discussion on AI.", interrupted: false, source: "llm" },
      { id: 2, seq: 2, speaker: "student", startMs: 6000, endMs: 12000, text: "I believe AI will transform industries by automating repetitive tasks.", interrupted: false, source: "stt" },
      { id: 3, seq: 3, speaker: "arjun", startMs: 13000, endMs: 18000, text: "I agree, but what about job displacement in traditional sectors?", interrupted: false, source: "llm" },
      { id: 4, seq: 4, speaker: "student", startMs: 19000, endMs: 25000, text: "That is a valid point, Arjun. Upskilling will be crucial.", interrupted: true, source: "stt" },
      { id: 5, seq: 5, speaker: "moderator", startMs: 28000, endMs: 30000, text: "Let us summarize our final thoughts.", interrupted: false, source: "llm" },
      { id: 6, seq: 6, speaker: "student", startMs: 29000, endMs: 30000, text: "To conclude, AI is a net positive if managed responsibly.", interrupted: false, source: "stt" },
    ];

    const metrics = calculateMetrics(segments, { sessionDurationMs: 30000, candidateInterruptionCount: 1 });

    expect(metrics.durationSec).toBe(30);
    expect(metrics.turns).toBe(3);
    expect(metrics.aiTurnCount).toBe(3);
    expect(metrics.words).toBe(30); // 10 + 10 + 10 words
    expect(metrics.firstSpeakMs).toBe(6000);
    expect(metrics.interruptionsMade).toBe(1);
    expect(metrics.responseCount).toBe(3);
    expect(metrics.participatedInClosing).toBe(true);

    // Speaking share & ratio
    expect(metrics.studentSpeakingMs).toBe(13000); // (12-6) + (25-19) + (30-29) = 6000 + 6000 + 1000 = 13000
    expect(metrics.speakingShare).toBeGreaterThan(0);
    expect(metrics.speakingRatioPercent).toBeGreaterThan(0);
  });

  it("handles empty candidate participation gracefully", () => {
    const segments: TranscriptSegment[] = [
      { id: 1, seq: 1, speaker: "moderator", startMs: 0, endMs: 5000, text: "Welcome to the session.", interrupted: false, source: "llm" },
      { id: 2, seq: 2, speaker: "arjun", startMs: 6000, endMs: 10000, text: "Let us discuss the impact.", interrupted: false, source: "llm" },
    ];

    const metrics = calculateMetrics(segments, { sessionDurationMs: 20000 });

    expect(metrics.turns).toBe(0);
    expect(metrics.aiTurnCount).toBe(2);
    expect(metrics.words).toBe(0);
    expect(metrics.firstSpeakMs).toBeNull();
    expect(metrics.studentSpeakingMs).toBe(0);
    expect(metrics.speakingShare).toBe(0);
    expect(metrics.speakingRatioPercent).toBe(0);
    expect(metrics.interruptionsMade).toBe(0);
    expect(metrics.longestSilenceMs).toBe(20000);
    expect(metrics.participatedInClosing).toBe(false);
  });
});
