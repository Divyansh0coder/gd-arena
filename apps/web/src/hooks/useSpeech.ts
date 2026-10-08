import { useCallback, useEffect, useRef, useState } from "react";

export type MicState = "idle" | "requesting" | "listening" | "processing" | "denied" | "unsupported";

export type UseSpeechOptions = {
  onFinalTranscript?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onSpeechDetected?: (text: string) => void;
  shouldSuppress?: (text: string, isFinal: boolean) => boolean;
};

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useSpeech(options: UseSpeechOptions = {}) {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldListenRef = useRef<boolean>(false);
  const lastDispatchedIndexRef = useRef<number>(0);
  const latestInterimRef = useRef<string>("");
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFinalTranscriptRef = useRef(options.onFinalTranscript);
  const onInterimTranscriptRef = useRef(options.onInterimTranscript);
  const onSpeechDetectedRef = useRef(options.onSpeechDetected);
  const shouldSuppressRef = useRef(options.shouldSuppress);

  useEffect(() => {
    onFinalTranscriptRef.current = options.onFinalTranscript;
    onInterimTranscriptRef.current = options.onInterimTranscript;
    onSpeechDetectedRef.current = options.onSpeechDetected;
    shouldSuppressRef.current = options.shouldSuppress;
  }, [options.onFinalTranscript, options.onInterimTranscript, options.onSpeechDetected, options.shouldSuppress]);

  useEffect(() => {
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const supported = Boolean(SpeechConstructor);
    setIsSupported(supported);
    if (!supported) {
      setMicState("unsupported");
    }
  }, []);

  const dispatchFinalTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    console.log("[Speech] dispatching final transcript:", trimmed);

    if (onFinalTranscriptRef.current) {
      onFinalTranscriptRef.current(trimmed);
    }
  }, []);

  const stopListening = useCallback(() => {
    console.log("[Speech] stop requested");
    shouldListenRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (latestInterimRef.current.trim()) {
      dispatchFinalTranscript(latestInterimRef.current.trim());
      latestInterimRef.current = "";
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore error if already stopped
      }
    }
    setMicState("idle");
    setInterimTranscript("");
    lastDispatchedIndexRef.current = 0;
  }, [dispatchFinalTranscript]);

  const createAndStartRecognition = useCallback(() => {
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechConstructor || !shouldListenRef.current) return;

    if (recognitionRef.current) {
      const oldInst = recognitionRef.current;
      oldInst.onstart = null;
      oldInst.onresult = null;
      oldInst.onerror = null;
      oldInst.onend = null;
      try {
        oldInst.abort();
      } catch (e) {
        // ignore abort
      }
      recognitionRef.current = null;
    }

    const recognition = new SpeechConstructor();
    recognitionRef.current = recognition;
    lastDispatchedIndexRef.current = 0; // Crucial fix: Reset index offset for new recognition instance

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => {
      console.log("[Speech] microphone/listening started");
      console.log("[Speech] recognition started");
      setMicState("listening");
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let currentInterim = "";

      for (let i = lastDispatchedIndexRef.current; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || !result[0]) continue;

        const textPart = result[0].transcript;
        console.log("[Speech] result received:", textPart);

        if (result.isFinal) {
          const finalUtterance = textPart.trim();
          lastDispatchedIndexRef.current = i + 1;
          latestInterimRef.current = "";
          if (finalUtterance) {
            if (shouldSuppressRef.current && shouldSuppressRef.current(finalUtterance, true)) {
              console.debug("[Speech] final transcript suppressed by echo mitigation rule:", finalUtterance);
              continue;
            }
            console.log("[Speech] final result:", finalUtterance);
            console.log(`[Speech] actual candidate speech detected: "${finalUtterance}"`);
            if (onSpeechDetectedRef.current) {
              onSpeechDetectedRef.current(finalUtterance);
            }
            dispatchFinalTranscript(finalUtterance);
          }
        } else {
          currentInterim += textPart + " ";
        }
      }

      const trimmedInterim = currentInterim.trim();
      latestInterimRef.current = trimmedInterim;
      setInterimTranscript(trimmedInterim);
      if (trimmedInterim) {
        if (shouldSuppressRef.current && shouldSuppressRef.current(trimmedInterim, false)) {
          console.debug("[Speech] interim transcript suppressed by echo mitigation rule:", trimmedInterim);
        } else {
          console.log("[Speech] interim result:", trimmedInterim);
          console.log(`[Speech] actual candidate speech detected: "${trimmedInterim}"`);
          if (onSpeechDetectedRef.current) {
            onSpeechDetectedRef.current(trimmedInterim);
          }
          if (onInterimTranscriptRef.current) {
            onInterimTranscriptRef.current(trimmedInterim);
          }
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("[Speech] recognition error:", event.error);
      console.log(`[Speech] recognition error: ${event.error}`);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setMicState("denied");
        setError("Microphone permission denied");
      } else if (event.error === "audio-capture") {
        console.warn("[Speech] transient audio-capture error, will auto-retry in onend");
        setError("Microphone audio capture busy, retrying...");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(`Speech error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      console.log("[Speech] recognition ended");
      console.log("[Speech] recognition end event. shouldListen =", shouldListenRef.current);
      if (latestInterimRef.current.trim()) {
        dispatchFinalTranscript(latestInterimRef.current.trim());
        latestInterimRef.current = "";
      }

      if (shouldListenRef.current) {
        console.log("[Speech] auto-restarting recognition instance...");
        restartTimerRef.current = setTimeout(() => {
          if (shouldListenRef.current) {
            createAndStartRecognition();
          }
        }, 200);
      } else {
        setMicState((prev) => (prev === "denied" || prev === "unsupported" ? prev : "idle"));
        setInterimTranscript("");
        lastDispatchedIndexRef.current = 0;
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn("[Speech] failed to launch recognition, retrying in 300ms...", err);
      if (shouldListenRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (shouldListenRef.current) {
            createAndStartRecognition();
          }
        }, 300);
      }
    }
  }, [dispatchFinalTranscript]);

  const startListening = useCallback(() => {
    console.log("[Speech] start requested");
    setError(null);
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechConstructor) {
      setIsSupported(false);
      setMicState("unsupported");
      setError("Web Speech API is not supported in this browser. Please use Chrome, Edge, or Brave, or use the Text Fallback input below.");
      return;
    }

    shouldListenRef.current = true;
    lastDispatchedIndexRef.current = 0;
    latestInterimRef.current = "";
    setInterimTranscript("");
    setMicState("listening");

    createAndStartRecognition();
  }, [createAndStartRecognition]);

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
    };
  }, []);

  return {
    isSupported,
    micState,
    interimTranscript,
    error,
    startListening,
    stopListening,
  };
}
