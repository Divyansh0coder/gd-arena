import type { Dimension, FeedbackItem, Metrics, SkillScore, TranscriptSegment } from "@gd-arena/contracts";

export interface LLMReportPromptParams {
  topic: string;
  metrics: Metrics;
  segments: TranscriptSegment[];
}

export interface LLMReportAnalysisResult {
  scores: Array<{ dimension: Dimension; score: number }>;
  items: FeedbackItem[];
}

export function buildReportPrompt(params: LLMReportPromptParams): string {
  const { topic, metrics, segments } = params;

  const candidateSegments = segments.filter((s) => s.speaker === "student");
  
  const formattedTranscript = segments
    .map((s) => `[ID:${s.id} | ${Math.floor(s.startMs / 1000)}s | Speaker:${s.speaker}] "${s.text}"`)
    .join("\n");

  const formattedCandidateSegments = candidateSegments
    .map((s) => `Segment ID ${s.id} (${Math.floor(s.startMs / 1000)}s): "${s.text}"`)
    .join("\n");

  return `
You are an expert Group Discussion evaluator for top campus placements.
Analyze the following Group Discussion session and evaluate the candidate ("student").

==================================================
SESSION TOPIC:
"${topic}"

==================================================
DETERMINISTIC METRICS (COMPUTED BY SYSTEM):
- Total Duration: ${metrics.durationSec}s
- Candidate Speaking Share: ${metrics.speakingRatioPercent}% (${metrics.studentSpeakingMs} ms)
- Candidate Word Count: ${metrics.words}
- Candidate Turns: ${metrics.turns}
- AI Turns: ${metrics.aiTurnCount ?? 0}
- First Contribution Timestamp: ${metrics.firstSpeakMs !== null ? `${Math.floor(metrics.firstSpeakMs / 1000)}s` : "Never spoke"}
- Interruptions Made: ${metrics.interruptionsMade}
- Longest Candidate Silence: ${Math.floor(metrics.longestSilenceMs / 1000)}s
- Participated in Closing: ${metrics.participatedInClosing ? "Yes" : "No"}

==================================================
CANDIDATE SEGMENTS ONLY:
${formattedCandidateSegments || "(Candidate did not speak during this session)"}

==================================================
FULL SESSION TRANSCRIPT:
${formattedTranscript || "(Empty transcript)"}

==================================================
INSTRUCTIONS & EVALUATION REQUIREMENTS:

Evaluate the candidate on EXACTLY these eight dimensions:
1. starting_strong (Starting Strong)
2. idea_quality (Idea Quality)
3. building_on_others (Building on Others)
4. listening (Listening / Responsiveness)
5. interruptions (Interruptions)
6. speaking_balance (Speaking Balance)
7. closing_strong (Closing Strong)
8. overall_performance (Overall GD Performance)

Rules for Evidence & Feedback Items:
- EVERY feedback item MUST reference an ACTUAL segment ID from the Candidate Segments above.
- The 'quote' field MUST be an EXACT verbatim substring from that candidate segment text. DO NOT FABRICATE OR PARAPHRASE QUOTES.
- Do NOT provide vague feedback like "You should speak more confidently."
- Provide specific feedback referencing real transcript moments, e.g.: "Your opening in segment 2 clearly stated your position, but you did not respond to Arjun's argument about job displacement."
- Set 'speaker' to "student" for all candidate feedback items.

Return ONLY a single valid JSON object with the following exact structure:
{
  "scores": [
    { "dimension": "starting_strong", "score": 80 },
    { "dimension": "idea_quality", "score": 75 },
    { "dimension": "building_on_others", "score": 60 },
    { "dimension": "listening", "score": 70 },
    { "dimension": "interruptions", "score": 90 },
    { "dimension": "speaking_balance", "score": 65 },
    { "dimension": "closing_strong", "score": 50 },
    { "dimension": "overall_performance", "score": 70 }
  ],
  "items": [
    {
      "dimension": "starting_strong",
      "severity": "good",
      "text": "Clear initiation on the main topic.",
      "whatHappened": "You introduced your view early in segment 2.",
      "whyItMatters": "Starting early shows confidence and sets the tone.",
      "howToImprove": "Follow up with a concrete example next time.",
      "segmentId": 2,
      "tMs": 6000,
      "speaker": "student",
      "quote": "exact candidate quote here"
    }
  ]
}
`.trim();
}

/**
 * Prompt specifically for re-generating a failed/rejected evidence feedback item once.
 */
export function buildCorrectionPrompt(
  params: LLMReportPromptParams,
  invalidFeedback: { item: FeedbackItem; reason: string }
): string {
  const candidateSegments = params.segments.filter((s) => s.speaker === "student");
  const candidateTextList = candidateSegments
    .map((s) => `Segment ID ${s.id} (startMs: ${s.startMs}): "${s.text}"`)
    .join("\n");

  return `
The following feedback item failed validation against the actual session transcript:
Feedback Item: ${JSON.stringify(invalidFeedback.item)}
Failure Reason: "${invalidFeedback.reason}"

Candidate Segments Available:
${candidateTextList}

Task: Provide a corrected feedback item JSON object that references an existing Candidate Segment ID and contains an EXACT quote substring from that segment's text.
Return ONLY the corrected JSON object.
`.trim();
}
