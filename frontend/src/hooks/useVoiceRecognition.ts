import { useCallback, useEffect, useRef, useState } from 'react';

export interface VoiceResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

interface UseVoiceRecognitionProps {
  onResult?: (result: VoiceResult) => void;
  onSpeechStart?: () => void;
  onError?: (error: string) => void;
  lang?: string;
}

export function useVoiceRecognition({
  onResult,
  onSpeechStart,
  onError,
  lang = 'en-US'
}: UseVoiceRecognitionProps = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  // ─── KEY FIX: Store callbacks in refs ──────────────────────────────────────
  // Callbacks from parent hooks are re-created every render. If we listed them
  // as deps of initRecognition/useEffect, they would trigger recognition.abort()
  // + recognition.start() on EVERY render, breaking the voice pipeline.
  // Storing them in refs means event handlers always call the latest version
  // without the recognition instance being touched by React rerenders.
  const onResultRef = useRef<typeof onResult>(undefined);
  const onSpeechStartRef = useRef<typeof onSpeechStart>(undefined);
  const onErrorRef = useRef<typeof onError>(undefined);

  // Update callback refs every render — safe because this only mutates a ref,
  // it does not trigger any side effects on recognition.
  onResultRef.current = onResult;
  onSpeechStartRef.current = onSpeechStart;
  onErrorRef.current = onError;

  const isSupported =
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);

  // ─── Create recognition instance — ONCE on mount (or lang change) ──────────
  // initRecognition only depends on lang and isSupported (both stable primitives).
  // Callbacks are NOT dependencies because they are read via refs at call-time.
  const initRecognition = useCallback(() => {
    if (!isSupported) {
      console.warn('[VoiceRec] SpeechRecognition not supported.');
      return;
    }

    console.log('[VoiceRec] Creating recognition instance.');
    const SR = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      console.log('[VoiceRec] onstart — listening.');
      isListeningRef.current = true;
      setIsListening(true);
      setError(null);
    };

    recognition.onaudiostart = () => {
      console.log('[VoiceRec] onaudiostart — audio capture active.');
    };

    recognition.onspeechstart = () => {
      console.log('[VoiceRec] onspeechstart — speech detected!');
      onSpeechStartRef.current?.();
    };

    recognition.onspeechend = () => {
      console.log('[VoiceRec] onspeechend.');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      let totalConfidence = 0;
      let finalCount = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text;
          let conf = result[0].confidence;
          // Many browsers return 0 confidence for non-dictation content — treat as 0.95
          if (!conf || conf < 0.1) conf = 0.95;
          totalConfidence += conf;
          finalCount++;
        } else {
          interim += text;
        }
      }

      const fullTranscript = final + interim;
      const avgConfidence = finalCount > 0 ? totalConfidence / finalCount : 0.90;

      console.log(`[VoiceRec] onresult — "${fullTranscript}" (isFinal=${final.length > 0}, conf=${avgConfidence.toFixed(2)})`);

      setTranscript(fullTranscript);
      setConfidence(avgConfidence);

      onResultRef.current?.({
        transcript: fullTranscript,
        confidence: avgConfidence,
        isFinal: final.length > 0
      });
    };

    recognition.onerror = (event: any) => {
      const err = event.error;
      console.error('[VoiceRec] onerror —', err);

      if (err === 'aborted') {
        // Intentional abort — just update state, do not propagate.
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }

      if (err === 'no-speech') {
        // Non-fatal timeout — let the keep-alive useEffect in the parent restart it.
        console.warn('[VoiceRec] no-speech timeout (keep-alive will restart).');
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }

      let errorMsg = `Speech recognition error: ${err}`;
      if (err === 'not-allowed' || err === 'permission-denied') {
        errorMsg = 'Microphone permission denied. Please allow access in browser settings.';
      } else if (err === 'network') {
        errorMsg = 'Network error during speech recognition.';
      } else if (err === 'service-not-allowed') {
        errorMsg = 'Speech recognition service not allowed.';
      }

      setError(errorMsg);
      isListeningRef.current = false;
      setIsListening(false);
      onErrorRef.current?.(errorMsg);
    };

    recognition.onend = () => {
      console.log('[VoiceRec] onend — session ended.');
      isListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    console.log('[VoiceRec] Recognition instance ready.');
  }, [lang, isSupported]);

  // Initialize once on mount (or when lang changes).
  // Cleanup only runs on unmount or lang change.
  useEffect(() => {
    initRecognition();
    return () => {
      console.log('[VoiceRec] Cleanup — aborting on unmount.');
      recognitionRef.current?.abort();
    };
  }, [initRecognition]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      console.warn('[VoiceRec] startListening: recognition not initialised.');
      return;
    }
    if (isListeningRef.current) {
      console.log('[VoiceRec] startListening: already listening, skip.');
      return;
    }
    try {
      console.log('[VoiceRec] startListening: calling start().');
      setTranscript('');
      setConfidence(0);
      setError(null);
      recognitionRef.current.start();
    } catch (err) {
      console.warn('[VoiceRec] start() threw (probably already running):', err);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      console.log('[VoiceRec] stopListening: calling stop().');
      recognitionRef.current.stop();
    } catch (err) {
      console.warn('[VoiceRec] stop() threw:', err);
    }
  }, []);

  const abortListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      console.log('[VoiceRec] abortListening: calling abort().');
      recognitionRef.current.abort();
      isListeningRef.current = false;
      setIsListening(false);
    } catch (err) {
      console.warn('[VoiceRec] abort() threw:', err);
    }
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    confidence,
    error,
    startListening,
    stopListening,
    abortListening
  };
}
