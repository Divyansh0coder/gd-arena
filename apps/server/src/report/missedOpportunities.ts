import type { Dimension, MissedOpportunity, TranscriptSegment } from "@gd-arena/contracts";
import { validateEvidenceItem } from "./validator";

export interface DetectOpportunitiesOptions {
  apiKey?: string;
  maxOpportunities?: number;
}

/**
 * Detects up to 3 meaningful missed opportunities from session transcript segments.
 * Combines deterministic segment scanning with LLM qualitative reasoning.
 */
export async function generateMissedOpportunities(
  sessionId: string,
  topic: string,
  segments: TranscriptSegment[],
  options: DetectOpportunitiesOptions = {}
): Promise<MissedOpportunity[]> {
  const maxOpps = options.maxOpportunities ?? 3;
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const studentSegments = sorted.filter((s) => s.speaker === "student");

  if (studentSegments.length === 0) {
    return [];
  }

  // Identify potential candidate moments using deterministic heuristics
  const candidateMoments: Array<{
    candidateSeg: TranscriptSegment;
    contextSegs: TranscriptSegment[];
    reasonKey: "short_agreement" | "weak_question_response" | "interruption_short" | "short_turn";
  }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (!current || current.speaker !== "student") continue;

    const wordCount = current.text.trim().split(/\s+/).filter(Boolean).length;
    const isShortAgreement = wordCount <= 8 || /^(yes|yeah|i agree|true|correct|right|ok|sure|that is true)\.?$/i.test(current.text.trim());
    
    // Find preceding 1-2 AI segments for context
    const precedingAi: TranscriptSegment[] = [];
    for (let j = i - 1; j >= 0 && precedingAi.length < 2; j--) {
      if (sorted[j] && sorted[j]!.speaker !== "student") {
        precedingAi.unshift(sorted[j]!);
      }
    }

    const prevAi = precedingAi[precedingAi.length - 1];
    const isQuestionResponse = prevAi && prevAi.text.includes("?") && wordCount < 12;
    const isInterruptionShort = current.interrupted && wordCount < 8;

    if (isShortAgreement) {
      candidateMoments.push({ candidateSeg: current, contextSegs: precedingAi, reasonKey: "short_agreement" });
    } else if (isQuestionResponse) {
      candidateMoments.push({ candidateSeg: current, contextSegs: precedingAi, reasonKey: "weak_question_response" });
    } else if (isInterruptionShort) {
      candidateMoments.push({ candidateSeg: current, contextSegs: precedingAi, reasonKey: "interruption_short" });
    } else if (wordCount < 10 && candidateMoments.length < maxOpps) {
      candidateMoments.push({ candidateSeg: current, contextSegs: precedingAi, reasonKey: "short_turn" });
    }
  }

  // Fallback: If no specific heuristics triggered, pick the candidate turns with shortest word count
  if (candidateMoments.length === 0 && studentSegments.length > 0) {
    const sortedByWords = [...studentSegments].sort(
      (a, b) => a.text.trim().split(/\s+/).length - b.text.trim().split(/\s+/).length
    );
    for (const seg of sortedByWords.slice(0, maxOpps)) {
      const precedingAi = sorted.filter((s) => s.speaker !== "student" && s.endMs <= seg.startMs).slice(-2);
      candidateMoments.push({ candidateSeg: seg, contextSegs: precedingAi, reasonKey: "short_turn" });
    }
  }

  // Deduplicate and limit to maxOpps
  const selectedMoments = candidateMoments.slice(0, maxOpps);
  const missedOpportunities: MissedOpportunity[] = [];
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

  for (let idx = 0; idx < selectedMoments.length; idx++) {
    const moment = selectedMoments[idx]!;
    let opp: MissedOpportunity | null = null;

    if (apiKey) {
      try {
        opp = await generateLlmOpportunity(sessionId, topic, moment, idx + 1, apiKey);
      } catch (err) {
        console.warn("[MissedOpportunities] LLM generation failed, using fallback:", err);
      }
    }

    if (!opp) {
      opp = generateFallbackOpportunity(sessionId, topic, moment, idx + 1);
    }

    // Evidence validation check
    const validation = validateMissedOpportunity(opp, sorted);
    if (validation.valid) {
      missedOpportunities.push(opp);
    } else {
      console.warn(`[MissedOpportunities] Opportunity ${opp.id} failed validation: ${validation.reason}`);
      
      // Step 5 of requirements: Attempt 1 correction with LLM if invalid
      if (apiKey) {
        try {
          const corrected = await attemptLlmOpportunityCorrection(sessionId, topic, moment, opp, validation.reason || "", apiKey);
          if (corrected && validateMissedOpportunity(corrected, sorted).valid) {
            missedOpportunities.push(corrected);
            continue;
          }
        } catch {
          // Drop if correction fails
        }
      }
      
      // Fallback deterministic option if LLM opportunity failed validation
      const fbOpp = generateFallbackOpportunity(sessionId, topic, moment, idx + 1);
      if (validateMissedOpportunity(fbOpp, sorted).valid) {
        missedOpportunities.push(fbOpp);
      }
    }
  }

  return missedOpportunities.slice(0, maxOpps);
}

export function validateMissedOpportunity(
  opp: MissedOpportunity,
  segments: TranscriptSegment[]
): { valid: boolean; reason?: string } {
  // 1. Session ID check
  if (!opp.sessionId) {
    return { valid: false, reason: "Missing session ID" };
  }

  // 2. Candidate quote check
  if (!opp.candidateQuote || !opp.candidateQuote.trim()) {
    return { valid: false, reason: "Candidate quote is empty" };
  }

  // 3. Segment existence & speaker match
  const targetSeg = segments.find((s) => s.id === opp.segmentId);
  if (!targetSeg) {
    return { valid: false, reason: `Candidate segment ID ${opp.segmentId} does not exist` };
  }
  if (targetSeg.speaker !== "student") {
    return { valid: false, reason: `Segment ID ${opp.segmentId} speaker is '${targetSeg.speaker}', not student` };
  }

  // 4. Quote substring match
  const normSegText = targetSeg.text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const normQuote = opp.candidateQuote.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  if (!normSegText.includes(normQuote)) {
    return { valid: false, reason: `Candidate quote "${opp.candidateQuote}" not contained in segment text: "${targetSeg.text}"` };
  }

  // 5. Context segment existence
  for (const cId of opp.contextSegmentIds) {
    if (!segments.some((s) => s.id === cId)) {
      return { valid: false, reason: `Context segment ID ${cId} does not exist` };
    }
  }

  return { valid: true };
}

function generateFallbackOpportunity(
  sessionId: string,
  topic: string,
  moment: { candidateSeg: TranscriptSegment; contextSegs: TranscriptSegment[]; reasonKey: string },
  index: number
): MissedOpportunity {
  const { candidateSeg, contextSegs, reasonKey } = moment;
  const prevAiText = contextSegs.map((s) => `${s.speaker.toUpperCase()}: "${s.text}"`).join("\n");
  const candidateQuote = candidateSeg.text.trim();

  let dimension: Dimension = "building_on_others";
  let whatHappened = "You agreed with the point but did not develop the argument further.";
  let whyItMatters = "Building on another speaker's point demonstrates active listening and adds unique depth to the discussion.";
  let suggestedResponse = `[AI Suggestion] I agree with that point, and to add a concrete dimension regarding "${topic}", we should also evaluate how implementation timelines affect outcomes.`;

  if (reasonKey === "weak_question_response") {
    dimension = "listening";
    whatHappened = "You gave a concise response when a direct question called for a structured argument.";
    whyItMatters = "Direct questions from participants or moderator are key moments to demonstrate structured critical thinking.";
    suggestedResponse = `[AI Suggestion] That is an important question regarding "${topic}". Looking at the primary factors, we need to balance efficiency gains against operational costs.`;
  } else if (reasonKey === "interruption_short") {
    dimension = "interruptions";
    whatHappened = "You interrupted the active AI speaker but did not follow up with a strong counter-argument.";
    whyItMatters = "Interrupting consumes speaking space; when you interrupt, deliver a compelling point to justify taking the turn.";
    suggestedResponse = `[AI Suggestion] Excuse me, but I'd like to challenge that assumption: in "${topic}", external variables can significantly alter that outcome.`;
  }

  return {
    id: `opp-${index}-${candidateSeg.id}`,
    sessionId,
    segmentId: candidateSeg.id,
    contextSegmentIds: contextSegs.map((s) => s.id),
    tMs: candidateSeg.startMs,
    dimension,
    whatHappened,
    whyItMatters,
    candidateQuote,
    contextQuote: prevAiText || undefined,
    suggestedResponse,
    howToImprove: "Support your claims with a clear example or logical follow-up.",
  };
}

async function generateLlmOpportunity(
  sessionId: string,
  topic: string,
  moment: { candidateSeg: TranscriptSegment; contextSegs: TranscriptSegment[]; reasonKey: string },
  index: number,
  apiKey: string
): Promise<MissedOpportunity | null> {
  const { candidateSeg, contextSegs } = moment;
  const contextText = contextSegs.map((s) => `${s.speaker.toUpperCase()} (ID:${s.id}): "${s.text}"`).join("\n");

  const prompt = `
You are an expert GD evaluator. Analyze this specific discussion moment:

TOPIC: "${topic}"

PRECEDING CONTEXT:
${contextText || "(No preceding AI speaker)"}

CANDIDATE TURN (Segment ID: ${candidateSeg.id}, Timestamp: ${Math.floor(candidateSeg.startMs / 1000)}s):
"${candidateSeg.text}"

TASK: Identify why this moment was a missed opportunity for the candidate and how they could respond much more effectively.

Requirements:
- dimension must be one of: "building_on_others", "idea_quality", "listening", "interruptions", "starting_strong", "closing_strong", "speaking_balance", "overall_performance"
- candidateQuote MUST BE AN EXACT SUBSTRING of "${candidateSeg.text}". DO NOT PARAPHRASE.
- suggestedResponse must be a realistic, highly effective response the candidate could have said. Label it clearly as an AI suggestion.

Return ONLY a JSON object:
{
  "dimension": "building_on_others",
  "whatHappened": "Description of what candidate said and what was missing",
  "whyItMatters": "Educational reason why developing this point matters in GDs",
  "candidateQuote": "EXACT SUBSTRING FROM CANDIDATE SEGMENT",
  "suggestedResponse": "Example of a much stronger response...",
  "howToImprove": "Actionable takeaway for candidate"
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
        maxOutputTokens: 600,
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  try {
    const parsed = JSON.parse(rawText);
    const sug = parsed.suggestedResponse || `A stronger response on "${topic}" would add logical depth.`;
    const formattedSug = sug.includes("AI Suggestion") ? sug : `[AI Suggestion] ${sug}`;

    return {
      id: `opp-${index}-${candidateSeg.id}`,
      sessionId,
      segmentId: candidateSeg.id,
      contextSegmentIds: contextSegs.map((s) => s.id),
      tMs: candidateSeg.startMs,
      dimension: parsed.dimension || "building_on_others",
      whatHappened: parsed.whatHappened || "You agreed without developing the argument.",
      whyItMatters: parsed.whyItMatters || "Building on other speakers adds value.",
      candidateQuote: parsed.candidateQuote || candidateSeg.text.trim(),
      contextQuote: contextSegs.map((s) => `${s.speaker.toUpperCase()}: "${s.text}"`).join("\n") || undefined,
      suggestedResponse: formattedSug,
      howToImprove: parsed.howToImprove || "Elaborate with reasoning and examples.",
    };
  } catch {
    return null;
  }
}

async function attemptLlmOpportunityCorrection(
  sessionId: string,
  topic: string,
  moment: { candidateSeg: TranscriptSegment; contextSegs: TranscriptSegment[] },
  invalidOpp: MissedOpportunity,
  reason: string,
  apiKey: string
): Promise<MissedOpportunity | null> {
  const prompt = `
The following missed opportunity JSON failed validation:
Invalid JSON: ${JSON.stringify(invalidOpp)}
Failure Reason: "${reason}"

Candidate Segment Text (Exact): "${moment.candidateSeg.text}"

Provide a corrected JSON object where "candidateQuote" is an EXACT verbatim substring of "${moment.candidateSeg.text}".
Return ONLY the corrected JSON object.
`.trim();

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
    const parsed = JSON.parse(rawText);
    return {
      ...invalidOpp,
      candidateQuote: parsed.candidateQuote || moment.candidateSeg.text.trim(),
      whatHappened: parsed.whatHappened || invalidOpp.whatHappened,
      suggestedResponse: parsed.suggestedResponse || invalidOpp.suggestedResponse,
    };
  } catch {
    return null;
  }
}
