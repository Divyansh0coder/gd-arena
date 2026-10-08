import { useCallback, useEffect, useRef, useState } from "react";
import { PersonaKey } from "@gd-arena/contracts";

export type UseSpeechSynthesisOptions = {
  defaultMuted?: boolean;
};

export const PERSONA_VOICE_CONFIGS: Record<
  PersonaKey,
  { pitch: number; rate: number; preferredKeywords: string[] }
> = {
  moderator: {
    pitch: 1.0,
    rate: 1.0,
    preferredKeywords: ["google", "natural", "daniel", "alex", "samantha", "system", "en-us"],
  },
  arjun: {
    pitch: 0.9,
    rate: 1.05,
    preferredKeywords: ["male", "george", "david", "arjun", "rishi", "google us english", "oliver"],
  },
  meera: {
    pitch: 1.15,
    rate: 0.95,
    preferredKeywords: ["female", "victoria", "karen", "zira", "moira", "google uk english female", "fiona"],
  },
  kabir: {
    pitch: 1.05,
    rate: 1.1,
    preferredKeywords: ["male", "fred", "arthur", "google australia", "daniel"],
  },
};

export function selectVoiceForPersona(
  voices: SpeechSynthesisVoice[],
  persona: PersonaKey
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const candidatePool = englishVoices.length > 0 ? englishVoices : voices;

  const config = PERSONA_VOICE_CONFIGS[persona];
  if (config && config.preferredKeywords) {
    for (const kw of config.preferredKeywords) {
      const match = candidatePool.find((v) => v.name.toLowerCase().includes(kw));
      if (match) return match;
    }
  }

  const personaIndices: Record<PersonaKey, number> = {
    moderator: 0,
    arjun: 1,
    meera: 2,
    kabir: 3,
  };

  const idx = (personaIndices[persona] ?? 0) % candidatePool.length;
  return candidatePool[idx] ?? candidatePool[0] ?? null;
}

export function useSpeechSynthesis(options: UseSpeechSynthesisOptions = {}) {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speakingPersona, setSpeakingPersona] = useState<PersonaKey | null>(null);
  const [currentSegmentId, setCurrentSegmentId] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(options.defaultMuted ?? false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const spokenSegmentsRef = useRef<Set<number>>(new Set());
  const isMutedRef = useRef<boolean>(isMuted);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const loadVoices = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const available = window.speechSynthesis.getVoices();
      if (available && available.length > 0) {
        console.log(`[TTS] voices loaded: ${available.length} voices available`);
        setVoices(available);
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "speechSynthesis" in window;
    setIsSupported(supported);

    if (!supported) {
      return;
    }

    loadVoices();

    if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
      window.speechSynthesis.onvoiceschanged = () => {
        loadVoices();
      };
    }

    return () => {
      if (supported) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [loadVoices]);

  const stop = useCallback(() => {
    console.log("[TTS] Stop requested, canceling active speech synthesis");
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // Ignore
      }
    }
    activeUtteranceRef.current = null;
    setIsSpeaking(false);
    setSpeakingPersona(null);
    setCurrentSegmentId(null);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      console.log(`[TTS] Voice output toggled: isMuted = ${next}`);
      if (next) {
        stop();
      }
      return next;
    });
  }, [stop]);

  const speak = useCallback(
    (segmentId: number, text: string, persona: PersonaKey | "student") => {
      console.log(`[TTS] AI turn received: segment ${segmentId}, speaker ${persona}`);

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        console.warn("[TTS] Speech synthesis unavailable in browser");
        return;
      }

      // Requirement: Student speech must NOT be spoken back by TTS
      if (persona === "student") {
        return;
      }

      if (isMutedRef.current) {
        console.log(`[TTS] Voice output muted, skipping segment ${segmentId}`);
        return;
      }

      if (spokenSegmentsRef.current.has(segmentId)) {
        console.log(`[TTS] Segment ${segmentId} already spoken, skipping duplicate`);
        return;
      }

      const trimmedText = text.trim();
      if (!trimmedText) {
        console.warn(`[TTS] Skipping empty text for segment ${segmentId}`);
        return;
      }

      spokenSegmentsRef.current.add(segmentId);

      try {
        // Ensure browser SpeechSynthesis engine is not stuck in a paused state
        if (window.speechSynthesis.paused) {
          console.log("[TTS] Resuming paused speechSynthesis engine");
          window.speechSynthesis.resume();
        }

        // Cancel previous AI speech before starting new utterance
        window.speechSynthesis.cancel();

        // Load voices if list is currently empty
        let availableVoices = voices;
        if (!availableVoices || availableVoices.length === 0) {
          availableVoices = window.speechSynthesis.getVoices();
        }

        console.log(`[TTS] Speaking: "${trimmedText.substring(0, 60)}..."`);
        console.log(`[TTS] speaking state: isSpeaking=${window.speechSynthesis.speaking}, paused=${window.speechSynthesis.paused}`);
        console.log(`[TTS] voices available: ${availableVoices.length}`);

        const utterance = new SpeechSynthesisUtterance(trimmedText);
        activeUtteranceRef.current = utterance; // Retain reference to prevent garbage collection

        let selectedVoice = selectVoiceForPersona(availableVoices, persona);
        if (!selectedVoice && availableVoices.length > 0) {
          selectedVoice = availableVoices.find((v) => v.lang.toLowerCase().startsWith("en")) || availableVoices[0] || null;
        }

        const config = PERSONA_VOICE_CONFIGS[persona] ?? { pitch: 1.0, rate: 1.0 };

        if (selectedVoice) {
          utterance.voice = selectedVoice;
          console.log(`[TTS] Selected voice for ${persona}: ${selectedVoice.name} (${selectedVoice.lang})`);
        } else {
          console.log(`[TTS] No specific voice matched for ${persona}, using browser default system voice`);
        }

        utterance.pitch = config.pitch;
        utterance.rate = config.rate;
        utterance.volume = 1.0;

        utterance.onstart = () => {
          console.log(`[TTS] Utterance started: segment ${segmentId}, speaker ${persona}`);
          setIsSpeaking(true);
          setSpeakingPersona(persona);
          setCurrentSegmentId(segmentId);
        };

        utterance.onend = () => {
          console.log(`[TTS] Utterance finished: segment ${segmentId}`);
          activeUtteranceRef.current = null;
          setIsSpeaking(false);
          setSpeakingPersona(null);
          setCurrentSegmentId(null);
        };

        utterance.onerror = (evt) => {
          console.error(`[TTS] Utterance error: segment ${segmentId}, error=`, evt.error);
          activeUtteranceRef.current = null;
          setIsSpeaking(false);
          setSpeakingPersona(null);
          setCurrentSegmentId(null);
          if (evt.error !== "interrupted" && evt.error !== "canceled") {
            setError(`Speech synthesis error: ${evt.error}`);
          }
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.error(`[TTS] Exception launching speech synthesis for segment ${segmentId}:`, err);
        activeUtteranceRef.current = null;
        setIsSpeaking(false);
        setSpeakingPersona(null);
        setCurrentSegmentId(null);
      }
    },
    [voices]
  );

  return {
    isSupported,
    isSpeaking,
    speakingPersona,
    currentSegmentId,
    isMuted,
    error,
    speak,
    stop,
    toggleMute,
    setIsMuted,
    voices,
  };
}
