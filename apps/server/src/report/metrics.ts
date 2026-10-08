import type { Metrics, TranscriptSegment } from "@gd-arena/contracts";

export interface MetricCalculationOptions {
  sessionDurationMs?: number;
  candidateInterruptionCount?: number;
}

/**
 * Calculates deterministic session metrics strictly from transcript segments and session events.
 * LLMs must NEVER be trusted to calculate these values.
 */
export function calculateMetrics(
  segments: TranscriptSegment[],
  options: MetricCalculationOptions = {}
): Metrics {
  // Sort segments chronologically
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  
  const studentSegments = sorted.filter((s) => s.speaker === "student");
  const aiSegments = sorted.filter((s) => s.speaker !== "student");

  // Determine overall session duration in MS
  let sessionDurationMs = options.sessionDurationMs ?? 0;
  if (sessionDurationMs <= 0) {
    if (sorted.length > 0 && sorted[sorted.length - 1]) {
      const last = sorted[sorted.length - 1]!;
      sessionDurationMs = Math.max(1000, last.endMs);
    } else {
      sessionDurationMs = 1000;
    }
  }
  const durationSec = Math.max(1, Math.round(sessionDurationMs / 1000));

  // Candidate speaking time in MS
  let studentSpeakingMs = 0;
  let candidateWords = 0;

  for (const s of studentSegments) {
    const textWords = s.text.trim().split(/\s+/).filter(Boolean).length;
    candidateWords += textWords;

    let segmentDuration = Math.max(0, s.endMs - s.startMs);
    if (segmentDuration === 0 && textWords > 0) {
      segmentDuration = textWords * 300; // ~200 wpm estimate fallback
    }
    studentSpeakingMs += segmentDuration;
  }

  // Total speaking time of all participants
  let totalSpeakingMs = 0;
  for (const s of sorted) {
    const textWords = s.text.trim().split(/\s+/).filter(Boolean).length;
    let segDuration = Math.max(0, s.endMs - s.startMs);
    if (segDuration === 0 && textWords > 0) {
      segDuration = textWords * 300;
    }
    totalSpeakingMs += segDuration;
  }

  // Candidate speaking ratio
  const speakingShare = totalSpeakingMs > 0
    ? Math.min(1, Math.max(0, studentSpeakingMs / totalSpeakingMs))
    : 0;
  const speakingRatioPercent = Math.round(speakingShare * 100);

  // Turn counts
  const turns = studentSegments.length;
  const aiTurnCount = aiSegments.length;

  // First contribution timestamp
  const firstSpeakMs = studentSegments.length > 0 && studentSegments[0] ? studentSegments[0].startMs : null;

  // Interruptions
  const explicitInterruptions = studentSegments.filter((s) => s.interrupted).length;
  const interruptionsMade = options.candidateInterruptionCount ?? explicitInterruptions;

  // Candidate responses & response gaps
  let responseCount = 0;
  const responseGaps: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (current && current.speaker === "student") {
      // Check if previous segment was an AI participant
      const prev = sorted[i - 1];
      if (i > 0 && prev && prev.speaker !== "student") {
        responseCount++;
        const gap = Math.max(0, current.startMs - prev.endMs);
        responseGaps.push(gap);
      }
    }
  }

  const avgResponseGapMs = responseGaps.length > 0
    ? Math.round(responseGaps.reduce((a, b) => a + b, 0) / responseGaps.length)
    : 0;

  // Longest candidate silence
  let longestSilenceMs = 0;
  if (turns === 0 || !studentSegments[0]) {
    longestSilenceMs = sessionDurationMs;
  } else {
    const silenceGaps: number[] = [];
    
    // Silence before first candidate turn
    silenceGaps.push(studentSegments[0].startMs);

    // Silence between candidate turns
    for (let i = 0; i < studentSegments.length - 1; i++) {
      const segCurrent = studentSegments[i];
      const segNext = studentSegments[i + 1];
      if (segCurrent && segNext) {
        const gap = segNext.startMs - segCurrent.endMs;
        silenceGaps.push(Math.max(0, gap));
      }
    }

    // Silence after last candidate turn
    const lastStudent = studentSegments[studentSegments.length - 1];
    if (lastStudent) {
      silenceGaps.push(Math.max(0, sessionDurationMs - lastStudent.endMs));
    }

    longestSilenceMs = Math.max(...silenceGaps, 0);
  }

  // Participation in closing round
  // Closing phase defined as the last 20% of session duration (or last 30s)
  const closingThresholdMs = Math.max(0, sessionDurationMs - Math.max(30000, sessionDurationMs * 0.2));
  const participatedInClosing = studentSegments.some((s) => s.startMs >= closingThresholdMs);

  return {
    durationSec,
    studentSpeakingMs,
    speakingShare,
    speakingRatioPercent,
    words: candidateWords,
    turns,
    aiTurnCount,
    firstSpeakMs,
    interruptionsMade,
    responseCount,
    longestSilenceMs,
    avgResponseGapMs,
    participatedInClosing,
  };
}
