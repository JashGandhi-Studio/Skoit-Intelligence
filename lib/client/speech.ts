"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

const LANGUAGES = [
  "en-IN",
  "hi-IN",
  "mr-IN",
  "ta-IN",
  "te-IN",
  "bn-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "en-US",
];

/**
 * Thin wrapper over the browser's own speech recognition. Nothing is recorded
 * or uploaded by this console — the engine belongs to the browser and works on
 * Indian languages where the platform provides them.
 */
export function useSpeech(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState("en-IN");
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const results = event.results as ArrayLike<ArrayLike<{ transcript: string }>>;
      const last = results[results.length - 1];
      const transcript = last?.[0]?.transcript;
      if (transcript) {
        callbackRef.current(transcript.trim());
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
  }, []);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }
    recognition.lang = language;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [language]);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const cycleLanguage = useCallback(() => {
    setLanguage((current) => {
      const index = LANGUAGES.indexOf(current);
      return LANGUAGES[(index + 1) % LANGUAGES.length];
    });
  }, []);

  return useMemo(
    () => ({
      listening,
      language,
      supported,
      start,
      stop,
      cycleLanguage,
      languages: LANGUAGES,
    }),
    [listening, language, supported, start, stop, cycleLanguage],
  );
}
