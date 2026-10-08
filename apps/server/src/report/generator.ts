import type {
  Dimension,
  FeedbackItem,
  Metrics,
  Report,
  SkillScore,
  TranscriptSegment,
} from "@gd-arena/contracts";
import { Dimension as DimensionEnum, Report as ReportContract } from "@gd-arena/contracts";
import { calculateMetrics } from "./metrics";
import { validateEvidenceItem } from "./validator";
import { buildCorrectionPrompt, buildReportPrompt } from "../ai/reportPrompt";
import { DefaultLLMAdapter, LLMAdapter } from "../ai/llm";
import { generateMissedOpportunities } from "./missedOpportunities";

export interface GenerateReportOptions {
  sessionDurationMs?: number;
  candidateInterruptionCount?: number;
  llmAdapter?: LLMAdapter;
}

const ALL_DIMENSIONS: Dimension[] = [
  "starting_strong",
  "idea_quality",
  "building_on_others",
  "listening",
  "interruptions",
  "speaking_balance",
  "closing_strong",
  "overall_performance",
];

const DIMENSION_LABELS: Record<Dimension, string> = {
  starting_strong: "Starting Strong",
  idea_quality: "Idea Quality",
  building_on_others: "Building on Others",
  listening: "Listening / Responsiveness",
  interruptions: "Interruptions",
  speaking_balance: "Speaking Balance",
  closing_strong: "Closing Strong",
  overall_performance: "Overall GD Performance",
  content: "Content Quality",
  communication: "Communication Skills",
  initiation: "Initiation",
  relevance: "Relevance",
  counterarguments: "Counterarguments",
  time_management: "Time Management",
  conclusion: "Conclusion",
};

/**
 * Main Report Generator combining Deterministic Metrics, LLM Qualitative Evaluation,
 * and Evidence Validation with 1-attempt regeneration/drop pipeline.
 */
export async function generateReport(
  sessionId: string,
  topic: string,
  segments: TranscriptSegment[],
  options: GenerateReportOptions = {}
): Promise<Report> {
  // 1. CODE calculates deterministic metrics strictly from timestamps/events
  const metrics = calculateMetrics(segments, {
    sessionDurationMs: options.sessionDurationMs,
    candidateInterruptionCount: options.candidateInterruptionCount,
  });

  const studentSegments = segments.filter((s) => s.speaker === "student");

  // Handle empty participation
  if (studentSegments.length === 0) {
    return generateEmptyReport(sessionId, topic, metrics);
  }

  // 2. Attempt LLM qualitative analysis
  let llmScores: Map<Dimension, { score: number; basis: "ai" | "measured" | "mixed" }> = new Map();
  let rawItems: FeedbackItem[] = [];

  const llmAdapter = options.llmAdapter ?? new DefaultLLMAdapter();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

  if (apiKey) {
    try {
      const promptText = buildReportPrompt({ topic, metrics, segments });
      const llmResult = await callLlmForReport(promptText, apiKey);
      
      if (llmResult) {
        for (const s of llmResult.scores) {
          if (ALL_DIMENSIONS.includes(s.dimension) && typeof s.score === "number") {
            llmScores.set(s.dimension, { score: Math.round(Math.max(0, Math.min(100, s.score))), basis: "ai" });
          }
        }
        rawItems = llmResult.items || [];
      }
    } catch (err) {
      console.warn("[ReportGenerator] LLM evaluation failed, falling back to deterministic analysis:", err);
    }
  }

  // 3. Fallback deterministic scores & items if LLM unavailable or missing scores
  const fallbackScoresAndItems = generateFallbackAnalysis(topic, metrics, studentSegments);
  
  // Fill missing scores
  for (const dim of ALL_DIMENSIONS) {
    if (!llmScores.has(dim)) {
      const fb = fallbackScoresAndItems.scores.find((s) => s.dimension === dim);
      llmScores.set(dim, {
        score: Math.round(fb?.score ?? 70),
        basis: "measured",
      });
    }
  }

  if (rawItems.length === 0) {
    rawItems = fallbackScoresAndItems.items;
  }

  // 4. Evidence Validation & 1-attempt Regeneration / Drop pipeline
  const validFeedbackItems: FeedbackItem[] = [];
  let droppedItems = 0;

  for (const item of rawItems) {
    const valRes = validateEvidenceItem(item, segments, metrics, sessionId);
    if (valRes.valid) {
      validFeedbackItems.push(item);
      continue;
    }

    console.warn(`[ReportGenerator] Feedback item failed validation: ${valRes.reason}`);

    // Step 2 of pipeline: Ask LLM for a corrected evidence item ONCE
    let correctedItem: FeedbackItem | null = null;
    if (apiKey) {
      try {
        const corrPrompt = buildCorrectionPrompt({ topic, metrics, segments }, { item, reason: valRes.reason || "Validation failed" });
        correctedItem = await callLlmForCorrection(corrPrompt, apiKey);
      } catch (err) {
        console.warn("[ReportGenerator] Correction LLM call failed:", err);
      }
    }

    if (correctedItem) {
      const retryValRes = validateEvidenceItem(correctedItem, segments, metrics, sessionId);
      if (retryValRes.valid) {
        validFeedbackItems.push(correctedItem);
        continue;
      }
    }

    // Step 4 of pipeline: If still fails validation, drop that feedback item
    droppedItems++;
  }

  // Final score assembly for the 8 dimensions
  const finalScores: SkillScore[] = ALL_DIMENSIONS.map((dim) => {
    const entry = llmScores.get(dim) ?? { score: 70, basis: "measured" };
    return {
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      score: Math.round(Math.max(0, Math.min(100, entry.score))),
      basis: entry.basis,
    };
  });

  // Generate max 3 missed opportunities
  const missedOpportunities = await generateMissedOpportunities(sessionId, topic, segments, { apiKey });

  const report: Report = {
    sessionId,
    topic,
    metrics,
    scores: finalScores,
    items: validFeedbackItems,
    missedOpportunities,
    droppedItems,
  };

  return ReportContract.parse(report);
}

function generateEmptyReport(sessionId: string, topic: string, metrics: Metrics): Report {
  const scores: SkillScore[] = ALL_DIMENSIONS.map((dim) => ({
    dimension: dim,
    label: DIMENSION_LABELS[dim],
    score: dim === "interruptions" ? 100 : 0,
    basis: "measured",
  }));

  return {
    sessionId,
    topic,
    metrics,
    scores,
    items: [],
    missedOpportunities: [],
    droppedItems: 0,
  };
}

function generateFallbackAnalysis(
  topic: string,
  metrics: Metrics,
  studentSegments: TranscriptSegment[]
): { scores: SkillScore[]; items: FeedbackItem[] } {
  const firstSeg = studentSegments[0];
  const lastSeg = studentSegments[studentSegments.length - 1];

  // 1. Starting Strong
  const startingScore = metrics.firstSpeakMs !== null && metrics.firstSpeakMs <= 30000 ? 85 : 50;
  
  // 2. Idea Quality
  const avgWordsPerTurn = metrics.turns > 0 ? metrics.words / metrics.turns : 0;
  const ideaScore = avgWordsPerTurn >= 12 ? 80 : 60;

  // 3. Building on Others
  const buildingScore = (metrics.responseCount ?? 0) >= 2 ? 80 : 55;

  // 4. Listening
  const listeningScore = (metrics.avgResponseGapMs ?? 0) <= 3000 ? 85 : 65;

  // 5. Interruptions
  const interruptionScore = Math.max(0, 100 - metrics.interruptionsMade * 20);

  // 6. Speaking Balance
  const ratio = metrics.speakingRatioPercent ?? 0;
  let balanceScore = 70;
  if (ratio >= 15 && ratio <= 35) balanceScore = 90;
  else if (ratio < 15) balanceScore = 40 + ratio * 2;
  else balanceScore = Math.max(30, 100 - (ratio - 35) * 2);

  // 7. Closing Strong
  const closingScore = metrics.participatedInClosing ? 85 : 45;

  // 8. Overall Performance
  const overallScore = Math.round(
    (startingScore + ideaScore + buildingScore + listeningScore + interruptionScore + balanceScore + closingScore) / 7
  );

  const scores: SkillScore[] = [
    { dimension: "starting_strong", label: DIMENSION_LABELS.starting_strong, score: startingScore, basis: "measured" },
    { dimension: "idea_quality", label: DIMENSION_LABELS.idea_quality, score: ideaScore, basis: "measured" },
    { dimension: "building_on_others", label: DIMENSION_LABELS.building_on_others, score: buildingScore, basis: "measured" },
    { dimension: "listening", label: DIMENSION_LABELS.listening, score: listeningScore, basis: "measured" },
    { dimension: "interruptions", label: DIMENSION_LABELS.interruptions, score: interruptionScore, basis: "measured" },
    { dimension: "speaking_balance", label: DIMENSION_LABELS.speaking_balance, score: balanceScore, basis: "measured" },
    { dimension: "closing_strong", label: DIMENSION_LABELS.closing_strong, score: closingScore, basis: "measured" },
    { dimension: "overall_performance", label: DIMENSION_LABELS.overall_performance, score: overallScore, basis: "measured" },
  ];

  const items: FeedbackItem[] = [];

  if (firstSeg) {
    items.push({
      dimension: "starting_strong",
      severity: startingScore >= 70 ? "good" : "warn",
      text: startingScore >= 70 ? "Clear initiation on the discussion topic." : "Delayed initial contribution.",
      whatHappened: `You made your first turn at timestamp ${Math.floor(firstSeg.startMs / 1000)}s.`,
      whyItMatters: "Opening early sets a proactive tone and demonstrates initiative.",
      howToImprove: "Try to jump into the discussion within the first 30 seconds.",
      segmentId: firstSeg.id,
      tMs: firstSeg.startMs,
      speaker: "student",
      quote: extractValidQuote(firstSeg.text),
    });
  }

  if (lastSeg && metrics.participatedInClosing) {
    items.push({
      dimension: "closing_strong",
      severity: "good",
      text: "Participated effectively in the closing phase.",
      whatHappened: `You contributed your concluding point near the end of the discussion.`,
      whyItMatters: "Summarizing or providing a final point reinforces your overall contribution.",
      howToImprove: "Structure closing arguments with a brief summary of key takeaways.",
      segmentId: lastSeg.id,
      tMs: lastSeg.startMs,
      speaker: "student",
      quote: extractValidQuote(lastSeg.text),
    });
  }

  return { scores, items };
}

function extractValidQuote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 60) return trimmed;
  // Extract first 5-8 words for a clean quote
  const words = trimmed.split(/\s+/);
  return words.slice(0, Math.min(8, words.length)).join(" ");
}

async function callLlmForReport(
  prompt: string,
  apiKey: string
): Promise<{ scores: Array<{ dimension: Dimension; score: number }>; items: FeedbackItem[] } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 1500,
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

async function callLlmForCorrection(prompt: string, apiKey: string): Promise<FeedbackItem | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 500,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}
