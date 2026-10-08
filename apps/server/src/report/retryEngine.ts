import type { Dimension, MissedOpportunity, RetryAttempt, TranscriptSegment } from "@gd-arena/contracts";
import { RetryAttempt as RetryAttemptContract } from "@gd-arena/contracts";
import { randomUUID } from "node:crypto";

export interface EvaluateRetryParams {
  sessionId: string;
  opportunity: MissedOpportunity;
  originalSegment?: TranscriptSegment;
  retryResponse: string;
  apiKey?: string;
}

/**
 * Evaluates a candidate retry response against the SAME rubric dimension as the original moment.
 * Crucially, NEVER modifies the original GD session transcript.
 */
export async function evaluateRetryAttempt(params: EvaluateRetryParams): Promise<RetryAttempt> {
  const { sessionId, opportunity, originalSegment, retryResponse, apiKey } = params;

  const trimmedRetry = (retryResponse || "").trim();
  if (!trimmedRetry) {
    throw new Error("Retry response cannot be empty");
  }

  const originalText = opportunity.candidateQuote || originalSegment?.text || "Yes, I agree.";
  const dimension = opportunity.dimension;

  // Attempt LLM qualitative scoring on same dimension
  let originalScore = 40;
  let retryScore = 80;
  let improvements: string[] = [];

  const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

  if (effectiveApiKey) {
    try {
      const llmResult = await scoreRetryWithLlm(
        opportunity.whatHappened,
        opportunity.contextQuote || "",
        originalText,
        trimmedRetry,
        dimension,
        effectiveApiKey
      );
      if (llmResult) {
        originalScore = llmResult.originalScore;
        retryScore = llmResult.retryScore;
        improvements = llmResult.improvements;
      }
    } catch (err) {
      console.warn("[RetryEngine] LLM scoring failed, using deterministic evaluation:", err);
    }
  }

  // Fallback / deterministic heuristic evaluation if LLM not used or missing fields
  if (improvements.length === 0) {
    const heuristicRes = evaluateHeuristicScores(originalText, trimmedRetry, dimension);
    if (!effectiveApiKey) {
      originalScore = heuristicRes.originalScore;
      retryScore = heuristicRes.retryScore;
    }
    improvements = heuristicRes.improvements;
  }

  const scoreDiff = retryScore - originalScore;

  const retryAttempt: RetryAttempt = {
    id: randomUUID(),
    sessionId,
    opportunityId: opportunity.id,
    originalSegmentId: opportunity.segmentId,
    originalResponse: originalText,
    originalScore,
    retryResponse: trimmedRetry,
    retryTimestamp: Date.now(),
    retryScore,
    scoreDiff,
    improvements,
    dimension,
  };

  return RetryAttemptContract.parse(retryAttempt);
}

function evaluateHeuristicScores(
  originalText: string,
  retryText: string,
  dimension: Dimension
): { originalScore: number; retryScore: number; improvements: string[] } {
  const origWords = originalText.split(/\s+/).filter(Boolean).length;
  const retryWords = retryText.split(/\s+/).filter(Boolean).length;

  const originalScore = Math.min(60, Math.max(20, origWords * 5));

  let retryScore = 50;
  if (retryWords >= 20) retryScore = 85;
  else if (retryWords >= 12) retryScore = 75;
  else if (retryWords >= 6) retryScore = 65;

  const reasoningKeywords = ["because", "for instance", "however", "furthermore", "additionally", "in contrast", "therefore", "such as"];
  const hasReasoning = reasoningKeywords.some((kw) => retryText.toLowerCase().includes(kw));
  if (hasReasoning) retryScore = Math.min(100, retryScore + 10);

  const improvements: string[] = [];
  if (retryWords > origWords) {
    improvements.push("Elaborated with deeper reasoning and supporting arguments");
  }
  if (hasReasoning) {
    improvements.push("Used logical connectives to structure the point");
  }
  if (dimension === "building_on_others") {
    improvements.push("Built directly on the previous speaker's perspective");
  } else if (dimension === "idea_quality") {
    improvements.push("Introduced a clear second dimension to the topic");
  } else {
    improvements.push("Delivered a more proactive, structured response");
  }

  return { originalScore, retryScore, improvements };
}

async function scoreRetryWithLlm(
  opportunitySummary: string,
  contextQuote: string,
  originalResponse: string,
  retryResponse: string,
  dimension: Dimension,
  apiKey: string
): Promise<{ originalScore: number; retryScore: number; improvements: string[] } | null> {
  const prompt = `
You are an expert GD evaluator. Evaluate a candidate's retry attempt on the SAME RUBRIC DIMENSION ("${dimension}").

CONTEXT:
${contextQuote}

MISSED OPPORTUNITY:
"${opportunitySummary}"

ORIGINAL CANDIDATE RESPONSE:
"${originalResponse}"

NEW RETRY RESPONSE:
"${retryResponse}"

TASK:
1. Score the ORIGINAL response on dimension "${dimension}" (scale 0-100).
2. Score the RETRY response on the EXACT SAME dimension "${dimension}" (scale 0-100).
3. Provide 2-3 concise bullet points explaining what improved.

Return ONLY a single valid JSON object:
{
  "originalScore": 40,
  "retryScore": 85,
  "improvements": [
    "Added concrete reasoning",
    "Built directly on the previous speaker",
    "Introduced a second perspective"
  ]
}
`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 400,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  try {
    const parsed = JSON.parse(rawText);
    return {
      originalScore: Math.max(0, Math.min(100, Number(parsed.originalScore) || 40)),
      retryScore: Math.max(0, Math.min(100, Number(parsed.retryScore) || 80)),
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String) : [],
    };
  } catch {
    return null;
  }
}
