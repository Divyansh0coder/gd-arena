import { describe, expect, it } from "vitest";
import { cleanLlmReply } from "./llmCleanup";

describe("LLM Reply Cleanup (FIX 3)", () => {
  it("cuts a 5-sentence reply to at most 2 sentences", () => {
    const raw = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here.";
    const cleaned = cleanLlmReply(raw);
    expect(cleaned).toBe("First sentence here. Second sentence here.");
  });

  it("flattens a bulleted reply by removing list markers", () => {
    const raw = "- Point one.\n- Point two.\n- Point three.";
    const cleaned = cleanLlmReply(raw);
    expect(cleaned).toBe("Point one. Point two.");
    expect(cleaned).not.toContain("-");
  });

  it("unwraps a reply wrapped in quotes", () => {
    const raw = '"I agree with Arjun on this topic."';
    const cleaned = cleanLlmReply(raw);
    expect(cleaned).toBe("I agree with Arjun on this topic.");
  });

  it("removes stage directions in parentheses and asterisks", () => {
    const raw = "(nods approvingly) *smiles warmly* I agree with Arjun on this point.";
    const cleaned = cleanLlmReply(raw);
    expect(cleaned).toBe("I agree with Arjun on this point.");
  });

  it("trims reply exceeding 60 words", () => {
    const longText = Array(70).fill("word").join(" ") + ". Second sentence.";
    const cleaned = cleanLlmReply(longText);
    const wordCount = cleaned.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(60);
  });

  it("returns empty string for empty or whitespace input", () => {
    expect(cleanLlmReply("")).toBe("");
    expect(cleanLlmReply("   ")).toBe("");
    expect(cleanLlmReply("(stage direction only)")).toBe("");
  });
});
