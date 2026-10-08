import { describe, expect, it } from "vitest";
import type { FeedbackItem, TranscriptSegment } from "@gd-arena/contracts";
import { validateEvidenceItem, validateFeedbackItems } from "./validator";

describe("Evidence Validator", () => {
  const segments: TranscriptSegment[] = [
    { id: 1, seq: 1, speaker: "moderator", startMs: 0, endMs: 5000, text: "Welcome to today's topic.", interrupted: false, source: "llm" },
    { id: 2, seq: 2, speaker: "student", startMs: 6000, endMs: 12000, text: "I believe AI will create more jobs than it displaces.", interrupted: false, source: "stt" },
    { id: 3, seq: 3, speaker: "arjun", startMs: 13000, endMs: 18000, text: "What evidence supports that view?", interrupted: false, source: "llm" },
    { id: 4, seq: 4, speaker: "student", startMs: 19000, endMs: 25000, text: "Historically, technological revolutions generate new industries.", interrupted: false, source: "stt" },
  ];

  it("accepts valid evidence item", () => {
    const item: FeedbackItem = {
      dimension: "starting_strong",
      severity: "good",
      text: "Your opening was clear and directly addressed the topic.",
      segmentId: 2,
      speaker: "student",
      tMs: 6000,
      quote: "AI will create more jobs",
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(true);
  });

  it("rejects non-existent segment ID", () => {
    const item: FeedbackItem = {
      dimension: "idea_quality",
      severity: "good",
      text: "Good reasoning.",
      segmentId: 99, // missing
      speaker: "student",
      tMs: 6000,
      quote: "AI will create more jobs",
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("does not exist");
  });

  it("rejects non-candidate segment speaker", () => {
    const item: FeedbackItem = {
      dimension: "listening",
      severity: "warn",
      text: "Reacting to Arjun.",
      segmentId: 3, // arjun's segment
      speaker: "student",
      tMs: 13000,
      quote: "What evidence supports that view",
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("belongs to 'arjun'");
  });

  it("rejects non-candidate item speaker attribute", () => {
    const item: FeedbackItem = {
      dimension: "building_on_others",
      severity: "good",
      text: "Arjun's point was good.",
      segmentId: 2,
      speaker: "arjun", // wrong speaker attribute
      tMs: 6000,
      quote: "AI will create more jobs",
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("non-candidate speaker");
  });

  it("rejects invalid timestamp outside segment window", () => {
    const item: FeedbackItem = {
      dimension: "starting_strong",
      severity: "good",
      text: "Good start.",
      segmentId: 2,
      speaker: "student",
      tMs: 99999, // out of range
      quote: "AI will create more jobs",
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("outside referenced segment time window");
  });

  it("rejects invalid or fabricated quote not in segment", () => {
    const item: FeedbackItem = {
      dimension: "starting_strong",
      severity: "good",
      text: "Good start.",
      segmentId: 2,
      speaker: "student",
      tMs: 6000,
      quote: "We should ban all artificial intelligence completely", // fake quote
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("was not found in candidate segment text");
  });

  it("rejects empty quote", () => {
    const item: FeedbackItem = {
      dimension: "starting_strong",
      severity: "good",
      text: "Good start.",
      segmentId: 2,
      speaker: "student",
      tMs: 6000,
      quote: "   ",
    };

    const res = validateEvidenceItem(item, segments);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("Quote is empty");
  });

  it("filters batch feedback items correctly", () => {
    const items: FeedbackItem[] = [
      { dimension: "starting_strong", severity: "good", text: "Good", segmentId: 2, speaker: "student", tMs: 6000, quote: "create more jobs" },
      { dimension: "idea_quality", severity: "bad", text: "Bad quote", segmentId: 2, speaker: "student", tMs: 6000, quote: "fabricated quote" },
    ];

    const { validItems, invalidItems } = validateFeedbackItems(items, segments);
    expect(validItems.length).toBe(1);
    expect(invalidItems.length).toBe(1);
  });

  describe("Numeric Claim Validation", () => {
    const mockMetrics = {
      durationSec: 30,
      studentSpeakingMs: 12000,
      speakingShare: 0.4,
      speakingRatioPercent: 40,
      words: 19,
      turns: 2,
      aiTurnCount: 2,
      firstSpeakMs: 6000,
      interruptionsMade: 0,
      responseCount: 1,
      longestSilenceMs: 7000,
      avgResponseGapMs: 1000,
      participatedInClosing: true,
    };

    it("accepts item with no numeric claims unaffected", () => {
      const item: FeedbackItem = {
        dimension: "starting_strong",
        severity: "good",
        text: "Your opening directly introduced a relevant argument.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(true);
    });

    it("accepts correct turn count claim", () => {
      const item: FeedbackItem = {
        dimension: "speaking_balance",
        severity: "good",
        text: "You took 2 candidate turns in the session.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(true);
    });

    it("rejects wrong turn count claim", () => {
      const item: FeedbackItem = {
        dimension: "speaking_balance",
        severity: "warn",
        text: "You took 5 turns in this session.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Numeric claim mismatch");
      expect(res.reason).toContain("claims 5 turns");
    });

    it("rejects wrong interruption count claim", () => {
      const item: FeedbackItem = {
        dimension: "interruptions",
        severity: "bad",
        text: "You made 3 interruptions during the debate.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Numeric claim mismatch");
      expect(res.reason).toContain("claims 3 interruptions");
    });

    it("accepts correct interruption count claim", () => {
      const item: FeedbackItem = {
        dimension: "interruptions",
        severity: "good",
        text: "You made 0 interruptions, respecting others.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(true);
    });

    it("accepts speaking percentage within tolerance", () => {
      const item: FeedbackItem = {
        dimension: "speaking_balance",
        severity: "good",
        text: "You maintained a 42% speaking share.", // measured 40%, within ±5% tolerance
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(true);
    });

    it("rejects speaking percentage outside tolerance", () => {
      const item: FeedbackItem = {
        dimension: "speaking_balance",
        severity: "good",
        text: "You had an 80% speaking share.", // measured 40%, outside ±5% tolerance
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Numeric claim mismatch");
      expect(res.reason).toContain("claims 80%");
    });

    it("rejects 'interrupted three times' when metrics=2", () => {
      const metricsWithTwo = { ...mockMetrics, interruptionsMade: 2 };
      const item: FeedbackItem = {
        dimension: "interruptions",
        severity: "bad",
        text: "You interrupted three times during the discussion.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, metricsWithTwo);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Numeric claim mismatch");
      expect(res.reason).toContain("claims 3 interruptions");
    });

    it("accepts '2 interruptions' when metrics=2", () => {
      const metricsWithTwo = { ...mockMetrics, interruptionsMade: 2 };
      const item: FeedbackItem = {
        dimension: "interruptions",
        severity: "good",
        text: "You made 2 interruptions during the discussion.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, metricsWithTwo);
      expect(res.valid).toBe(true);
    });

    it("accepts 'about 25% of the time' when metrics speakingRatioPercent=22%", () => {
      const metricsWith22Pct = { ...mockMetrics, speakingRatioPercent: 22 };
      const item: FeedbackItem = {
        dimension: "speaking_balance",
        severity: "good",
        text: "You spoke about 25% of the time.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, metricsWith22Pct);
      expect(res.valid).toBe(true);
    });

    it("leaves a sentence with a segment number unaffected", () => {
      const item: FeedbackItem = {
        dimension: "starting_strong",
        severity: "good",
        text: "Your opening in segment 2 was clear and articulate.",
        segmentId: 2,
        speaker: "student",
        tMs: 6000,
        quote: "create more jobs",
      };

      const res = validateEvidenceItem(item, segments, mockMetrics);
      expect(res.valid).toBe(true);
    });
  });
});
