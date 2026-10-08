/**
 * Echo Mitigation Utilities (Item G Follow-up)
 *
 * Rules:
 * 1. During AI speech, a recognised result is allowed when it has at least 2 words AND
 *    its word overlap with the AI text is below 60%.
 * 2. 1-word candidate results are suppressed during AI speech.
 * 3. 400 ms post-TTS cooldown after speech synthesis ends.
 * 4. Compares against the FULL text of CURRENT and PREVIOUS AI utterances.
 * 5. Word matching is tolerant of recognition errors (prefix matching for length >= 4).
 * 6. Barge-in requires an interim result with at least 2 words.
 */

export interface WordOverlapResult {
  candidateWordCount: number;
  overlapCount: number;
  overlapPercent: number;
}

/**
 * Checks if two words match directly or via prefix matching for speech recognition error tolerance.
 * Two words match when:
 * 1. They are equal after lowercasing and stripping punctuation.
 * 2. One is a prefix of the other with length >= 4.
 */
export function isWordMatch(candidateWord: string, aiWord: string): boolean {
  const w1 = candidateWord.toLowerCase().replace(/[^\w]/g, "");
  const w2 = aiWord.toLowerCase().replace(/[^\w]/g, "");

  if (!w1 || !w2) return false;
  if (w1 === w2) return true;

  const maxLen = Math.max(w1.length, w2.length);
  const minLen = Math.min(w1.length, w2.length);
  const lenDiff = Math.abs(w1.length - w2.length);

  // If one is a prefix of the other with max length >= 4 and length difference <= 2
  if (maxLen >= 4 && lenDiff <= 2 && (w1.startsWith(w2) || w2.startsWith(w1))) {
    return true;
  }

  // Common prefix match for small recognition garbles (e.g., "intelligent" vs "intelligence")
  if (minLen >= 4 && lenDiff <= 2) {
    let common = 0;
    while (common < minLen && w1[common] === w2[common]) {
      common++;
    }
    if (common >= 4) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates word overlap metrics between candidate recognized text and full AI text (current + previous utterances).
 */
export function calculateWordOverlap(candidateText: string, fullAiText: string): WordOverlapResult {
  const candidateWords = candidateText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (candidateWords.length === 0) {
    return { candidateWordCount: 0, overlapCount: 0, overlapPercent: 0 };
  }

  const aiWordsArr = fullAiText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let overlapCount = 0;
  for (const cWord of candidateWords) {
    const isMatched = aiWordsArr.some((aWord) => isWordMatch(cWord, aWord));
    if (isMatched) {
      overlapCount++;
    }
  }

  const overlapPercent = (overlapCount / candidateWords.length) * 100;
  return {
    candidateWordCount: candidateWords.length,
    overlapCount,
    overlapPercent,
  };
}

/**
 * Determines whether candidate speech should be suppressed as AI echo while an AI is speaking.
 *
 * Rules:
 * - A recognised result is allowed when it has at least 2 words AND its word overlap with the AI text is below 60%.
 * - 1-word candidate results are suppressed.
 */
export function shouldSuppressAiEcho(candidateText: string, fullAiText: string): boolean {
  const { candidateWordCount, overlapPercent } = calculateWordOverlap(candidateText, fullAiText);

  // Allowed if candidateWordCount >= 2 AND overlapPercent < 60%
  if (candidateWordCount < 2 || overlapPercent >= 60) {
    return true; // Suppress
  }
  return false; // Allow
}

/**
 * Checks if candidate interim speech is valid for barge-in (requires at least 2 words).
 */
export function isBargeInValid(interimText: string): boolean {
  const words = interimText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.length >= 2;
}
