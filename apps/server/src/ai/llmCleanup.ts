/**
 * Cleans and trims an LLM response turn (FIX 3):
 * - Trims to at most 2 sentences and 60 words.
 * - Removes list markers (numbers, bullets).
 * - Removes surrounding quotes.
 * - Removes stage directions in parentheses (...) or asterisks *...*.
 */
export function cleanLlmReply(text: string): string {
  if (!text || !text.trim()) return "";

  let cleaned = text.trim();

  // 1. Remove stage directions in (...) or *...*
  cleaned = cleaned.replace(/\([^\)]*\)/g, " ").replace(/\*[^\*]*\*/g, " ");

  // 2. Remove list markers (e.g., "1. ", "- ", "* ", "• ", "a) ")
  cleaned = cleaned.replace(/(?:^|\n|\s+)(?:\d+[\.\)]|[-*•])\s+/g, " ");

  // 3. Remove surrounding quotes
  cleaned = cleaned.replace(/^["'“`]+|["'”`]+$/g, "").trim();

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  // 4. Limit to at most 2 sentences
  const sentenceMatches = cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
  if (sentenceMatches && sentenceMatches.length > 2) {
    cleaned = sentenceMatches.slice(0, 2).join("").trim();
  }

  // 5. Limit to at most 60 words
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 60) {
    cleaned = words.slice(0, 60).join(" ").trim();
    if (!/[.!?]$/.test(cleaned)) {
      cleaned += ".";
    }
  }

  return cleaned;
}
