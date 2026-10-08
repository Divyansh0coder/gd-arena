import type { FeedbackItem, Metrics, TranscriptSegment } from "@gd-arena/contracts";

export interface EvidenceValidationResult {
  valid: boolean;
  reason?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const NUM_PATTERN = `(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;

export function parseNumberWordOrDigit(val: string): number | null {
  if (!val) return null;
  const cleaned = val.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned);
  }
  const num = NUMBER_WORDS[cleaned];
  if (num !== undefined) {
    return num;
  }
  return null;
}

/**
 * Normalizes text for lenient/fuzzy substring matching (lowercasing, removing punctuation, collapsing spaces).
 */
export function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validates any numeric claims in a feedback item's text against calculated session metrics.
 *
 * Interruption Definition:
 * - "interruptions" matches `metrics.interruptionsMade` in `calculateMetrics()`, which strictly
 *   measures **Candidate Interruptions** (the count of times the candidate cut in on / interrupted an active AI speaker).
 *
 * Rules:
 * - Interruptions, turns, and words: exact match with measured count (supports digits and number words 'zero' to 'twenty').
 * - Speaking share / percentage: match within ±5% tolerance.
 * - Silence duration: match within ±2s tolerance.
 * - Non-metric numbers (e.g., segment numbers, general argument counts) are unaffected.
 */
export function validateNumericClaims(
  text: string,
  metrics: Metrics
): EvidenceValidationResult {
  if (!text || !text.trim()) return { valid: true };

  // 1. Interruption claims (e.g., "2 interruptions", "interrupted three times", "interrupted 1 time")
  const interruptionMatch =
    text.match(new RegExp(`(${NUM_PATTERN})\\s*(?:interruption|interruptions|time(?:s)? interrupted)`, "i")) ||
    text.match(new RegExp(`interrupted\\s*(${NUM_PATTERN})(?:\\s*time(?:s)?)?`, "i"));
  if (interruptionMatch && interruptionMatch[1]) {
    const claimedCount = parseNumberWordOrDigit(interruptionMatch[1]);
    const measuredCount = metrics.interruptionsMade;
    if (claimedCount !== null && claimedCount !== measuredCount) {
      return {
        valid: false,
        reason: `Numeric claim mismatch: text claims ${claimedCount} interruptions, but measured count is ${measuredCount}`,
      };
    }
  }

  // 2. Turn claims (e.g., "3 turns", "took four candidate turns")
  const turnMatch = text.match(new RegExp(`(${NUM_PATTERN})\\s*(?:candidate\\s*)?turns?\\b`, "i"));
  if (turnMatch && turnMatch[1]) {
    const claimedTurns = parseNumberWordOrDigit(turnMatch[1]);
    const measuredTurns = metrics.turns;
    if (claimedTurns !== null && claimedTurns !== measuredTurns) {
      return {
        valid: false,
        reason: `Numeric claim mismatch: text claims ${claimedTurns} turns, but measured count is ${measuredTurns}`,
      };
    }
  }

  // 3. Word claims (e.g., "45 words", "spoke ten words")
  const wordMatch = text.match(new RegExp(`(${NUM_PATTERN})\\s*words?\\b`, "i"));
  if (wordMatch && wordMatch[1]) {
    const claimedWords = parseNumberWordOrDigit(wordMatch[1]);
    const measuredWords = metrics.words;
    if (claimedWords !== null && claimedWords !== measuredWords) {
      return {
        valid: false,
        reason: `Numeric claim mismatch: text claims ${claimedWords} words, but measured count is ${measuredWords}`,
      };
    }
  }

  // 4. Speaking share / percentage claims (e.g., "25%", "25 percent", "about 25% of the time")
  const percentMatch = text.match(new RegExp(`(${NUM_PATTERN}|\\d+(?:\\.\\d+)?)\\s*(?:%|percent)`, "i"));
  if (percentMatch && percentMatch[1]) {
    const claimedPct = parseNumberWordOrDigit(percentMatch[1]);
    if (claimedPct !== null) {
      const measuredPct = metrics.speakingRatioPercent ?? Math.round(metrics.speakingShare * 100);
      const tolerance = 5; // ±5% tolerance
      if (Math.abs(claimedPct - measuredPct) > tolerance) {
        return {
          valid: false,
          reason: `Numeric claim mismatch: text claims ${claimedPct}% speaking percentage, but measured value is ${measuredPct}%`,
        };
      }
    }
  }

  // 5. Silence duration claims (e.g., "15 seconds of silence", "silence of ten seconds", "10s of silence")
  const silenceMatch =
    text.match(new RegExp(`(${NUM_PATTERN})\\s*(?:second|seconds|sec|s)\\s*(?:of\\s*)?silence`, "i")) ||
    text.match(new RegExp(`silence\\s*(?:of|for)?\\s*(${NUM_PATTERN})\\s*(?:second|seconds|sec|s)`, "i"));
  if (silenceMatch) {
    const rawVal = silenceMatch[1] || silenceMatch[2];
    if (rawVal) {
      const claimedSilenceSec = parseNumberWordOrDigit(rawVal);
      if (claimedSilenceSec !== null) {
        const measuredSilenceSec = Math.round(metrics.longestSilenceMs / 1000);
        const tolerance = 2; // ±2 seconds tolerance
        if (Math.abs(claimedSilenceSec - measuredSilenceSec) > tolerance) {
          return {
            valid: false,
            reason: `Numeric claim mismatch: text claims ${claimedSilenceSec}s of silence, but measured silence is ${measuredSilenceSec}s`,
          };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Validates an evidence feedback item against the actual session transcript segments and metrics.
 */
export function validateEvidenceItem(
  item: FeedbackItem,
  segments: TranscriptSegment[],
  metricsOrSessionId?: Metrics | string,
  expectedSessionId?: string
): EvidenceValidationResult {
  let metrics: Metrics | undefined;
  if (typeof metricsOrSessionId === "object" && metricsOrSessionId !== null) {
    metrics = metricsOrSessionId;
  }

  // 1. Check quote emptiness
  if (!item.quote || !item.quote.trim()) {
    return { valid: false, reason: "Quote is empty or whitespace" };
  }

  // 2. Speaker check (must refer to candidate)
  const speakerStr = (item.speaker || "student").trim().toLowerCase();
  if (speakerStr !== "student" && speakerStr !== "you" && speakerStr !== "candidate") {
    return { valid: false, reason: `Feedback refers to non-candidate speaker '${item.speaker}'` };
  }

  // 3. Transcript segment existence check
  const targetSegment = segments.find((s) => s.id === item.segmentId);
  if (!targetSegment) {
    return { valid: false, reason: `Referenced transcript segment ID ${item.segmentId} does not exist` };
  }

  // 4. Target segment speaker check (must be student)
  if (targetSegment.speaker !== "student") {
    return { valid: false, reason: `Referenced segment ID ${item.segmentId} belongs to '${targetSegment.speaker}', not student` };
  }

  // 5. Timestamp boundary check
  if (item.tMs < targetSegment.startMs || item.tMs > targetSegment.endMs + 2000) {
    return {
      valid: false,
      reason: `Timestamp ${item.tMs}ms is outside referenced segment time window [${targetSegment.startMs}ms, ${targetSegment.endMs + 2000}ms]`,
    };
  }

  // 6. Quote presence check
  const normSegmentText = normalizeQuote(targetSegment.text);
  const normQuote = normalizeQuote(item.quote);

  if (!normSegmentText.includes(normQuote)) {
    return {
      valid: false,
      reason: `Quote "${item.quote}" was not found in candidate segment text: "${targetSegment.text}"`,
    };
  }

  // 7. Numeric-claim validation (if metrics is provided)
  if (metrics) {
    const combinedText = `${item.text || ""} ${item.whatHappened || ""}`.trim();
    const numResult = validateNumericClaims(combinedText, metrics);
    if (!numResult.valid) {
      return numResult;
    }
  }

  return { valid: true };
}

export function validateFeedbackItems(
  items: FeedbackItem[],
  segments: TranscriptSegment[],
  metricsOrSessionId?: Metrics | string,
  expectedSessionId?: string
): { validItems: FeedbackItem[]; invalidItems: { item: FeedbackItem; reason: string }[] } {
  const validItems: FeedbackItem[] = [];
  const invalidItems: { item: FeedbackItem; reason: string }[] = [];

  for (const item of items) {
    const res = validateEvidenceItem(item, segments, metricsOrSessionId, expectedSessionId);
    if (res.valid) {
      validItems.push(item);
    } else {
      invalidItems.push({ item, reason: res.reason || "Validation failed" });
    }
  }

  return { validItems, invalidItems };
}
