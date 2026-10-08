import { describe, expect, it } from "vitest";
import { calculateWordOverlap, isBargeInValid, isWordMatch, shouldSuppressAiEcho } from "./echoMitigation";

describe("Echo Mitigation Helper (Item G Follow-up)", () => {
  const currentAiUtterance = "Battery storage technology can resolve grid fluctuations effectively";
  const previousAiUtterance = "Renewable energy adoption requires resilient energy grids";
  const fullAiText = `${currentAiUtterance} ${previousAiUtterance}`;

  it("suppresses 1-word candidate result during AI speech", () => {
    const candidateText = "hello";
    expect(shouldSuppressAiEcho(candidateText, fullAiText)).toBe(true);
  });

  it("allows 2-word unrelated candidate phrase (< 60% overlap, >= 2 words)", () => {
    const candidateText = "good point";
    const res = calculateWordOverlap(candidateText, fullAiText);
    expect(res.candidateWordCount).toBe(2);
    expect(res.overlapPercent).toBe(0);
    expect(shouldSuppressAiEcho(candidateText, fullAiText)).toBe(false);
  });

  it("suppresses identical text (100% overlap)", () => {
    const candidateText = "Battery storage technology can resolve grid fluctuations effectively";
    const res = calculateWordOverlap(candidateText, fullAiText);
    expect(res.overlapPercent).toBe(100);
    expect(shouldSuppressAiEcho(candidateText, fullAiText)).toBe(true);
  });

  it("checks overlap against FULL text of both CURRENT and PREVIOUS AI utterances", () => {
    // Words from previous AI utterance: "Renewable energy adoption requires"
    const candidateTextFromPrev = "Renewable energy adoption requires";
    const res = calculateWordOverlap(candidateTextFromPrev, fullAiText);
    expect(res.overlapPercent).toBe(100);
    expect(shouldSuppressAiEcho(candidateTextFromPrev, fullAiText)).toBe(true);
  });

  it("suppresses garbled echo with recognition errors via prefix/fuzzy matching", () => {
    const aiText = "artificial intelligence will create jobs";
    const garbledCandidateText = "artificial intelligent will created job";

    // Check individual word matching logic
    expect(isWordMatch("intelligent", "intelligence")).toBe(true);
    expect(isWordMatch("created", "create")).toBe(true);
    expect(isWordMatch("job", "jobs")).toBe(true);

    const res = calculateWordOverlap(garbledCandidateText, aiText);
    expect(res.overlapPercent).toBe(100);
    expect(shouldSuppressAiEcho(garbledCandidateText, aiText)).toBe(true);
  });

  it("allows unrelated 3-word phrase", () => {
    const candidateText = "I disagree completely";
    expect(shouldSuppressAiEcho(candidateText, fullAiText)).toBe(false);
  });

  it("validates barge-in interim word count (>= 2 words required)", () => {
    expect(isBargeInValid("uh")).toBe(false);
    expect(isBargeInValid("the")).toBe(false);
    expect(isBargeInValid("I agree")).toBe(true);
    expect(isBargeInValid("Wait a moment")).toBe(true);
  });
});
