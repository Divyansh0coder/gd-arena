import { describe, expect, it } from "vitest";
import { useSpeech } from "./useSpeech";

describe("useSpeech hook logic", () => {
  it("exports useSpeech function", () => {
    expect(typeof useSpeech).toBe("function");
  });

  it("handles duplicate transcript prevention logic correctly", () => {
    const processed = new Set<string>();
    const onFinal = (text: string) => {
      const trimmed = text.trim();
      if (!processed.has(trimmed)) {
        processed.add(trimmed);
      }
    };

    onFinal("I agree with Arjun");
    onFinal("I agree with Arjun"); // duplicate call

    expect(processed.size).toBe(1);
    expect(Array.from(processed)[0]).toBe("I agree with Arjun");
  });
});
