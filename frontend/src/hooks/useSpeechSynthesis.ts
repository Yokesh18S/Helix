import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function useSpeechSynthesis() {
  const { voiceEnabled } = useAuth();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndCallbackRef = useRef<(() => void) | null>(null);
  const speakTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  const loadVoices = useCallback(() => {
    if (!synthRef.current) return;
    const allVoices = synthRef.current.getVoices();
    if (allVoices.length > 0) {
      setVoices(allVoices);
    }
  }, []);

  useEffect(() => {
    if (!synthRef.current) return;
    loadVoices();
    synthRef.current.onvoiceschanged = loadVoices;

    return () => {
      if (synthRef.current) {
        synthRef.current.onvoiceschanged = null;
      }
    };
  }, [loadVoices]);

  const stop = useCallback(() => {
    if (speakTimeoutRef.current) {
      clearTimeout(speakTimeoutRef.current);
      speakTimeoutRef.current = null;
    }

    if (!synthRef.current) return;
    console.log('[SpeechSynth] stop() — cancelling synthesis.');
    
    onEndCallbackRef.current = null;
    activeUtteranceRef.current = null;
    
    synthRef.current.cancel();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!voiceEnabled) {
      if (onEnd) onEnd();
      return;
    }

    if (speakTimeoutRef.current) {
      clearTimeout(speakTimeoutRef.current);
    }

    if (!synthRef.current) {
      console.warn('[SpeechSynth] speak() called but synthesis not available.');
      if (onEnd) onEnd();
      return;
    }

    console.log(`[SpeechSynth] speak(): "${text.substring(0, 60)}..."`);

    // Set isSpeaking to true immediately to prevent keep-alive microphone restart race conditions
    setIsSpeaking(true);

    onEndCallbackRef.current = null;
    activeUtteranceRef.current = null;
    synthRef.current.cancel();

    // Small delay to ensure the synthesis engine fully resets after cancel()
    speakTimeoutRef.current = setTimeout(() => {
      if (!synthRef.current) {
        setIsSpeaking(false);
        if (onEnd) onEnd();
        return;
      }

      // ── TTS preprocessing ────────────────────────────────────────────────
      // 1. Space out any 10-digit phone number so each digit is spoken
      //    individually: "9332567854" → "9 3 3 2 5 6 7 8 5 4"
      let spokenText = text.replace(/\b(\d{10})\b/g, (match) =>
        match.split('').join(' ')
      );
      // 2. Pronounce bare "0" as "zero" (prevents "oh" ambiguity)
      spokenText = spokenText.replace(/\b0\b/g, 'zero');
      const utterance = new SpeechSynthesisUtterance(spokenText);
      activeUtteranceRef.current = utterance;
      onEndCallbackRef.current = onEnd || null;

      // GC Prevention - keep reference in window global Set so garbage collection won't cut off speech
      if (typeof window !== 'undefined') {
        const w = window as any;
        w._activeUtterances = w._activeUtterances || new Set();
        w._activeUtterances.add(utterance);
      }

      // Select best melodious female voice
      const allVoices = synthRef.current.getVoices();
      const selectedVoice =
        allVoices.find((v) => v.name.toLowerCase().includes('samantha')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('victoria')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('karen')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('moira')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('google uk english female')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('google us english')) ||
        allVoices.find((v) => v.lang === 'en-US' && v.name.toLowerCase().includes('natural')) ||
        allVoices.find((v) => v.lang === 'en-US') ||
        allVoices[0];

      if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log(`[SpeechSynth] Using voice: "${selectedVoice.name}"`);
      }

      utterance.rate = 0.96;  // calm, pleasant, sweet cadence
      utterance.pitch = 1.12; // warm, cheerful melody tone
      utterance.volume = 1.0;

      utterance.onstart = () => {
        console.log('[SpeechSynth] onstart — speaking.');
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        console.log('[SpeechSynth] onend — finished speaking.');
        if (typeof window !== 'undefined') {
          (window as any)._activeUtterances?.delete(utterance);
        }
        setIsSpeaking(false);
        activeUtteranceRef.current = null;
        
        const cb = onEndCallbackRef.current;
        onEndCallbackRef.current = null;
        if (cb) {
          console.log('[SpeechSynth] Calling onEnd callback.');
          cb();
        }
      };

      utterance.onerror = (e) => {
        if (typeof window !== 'undefined') {
          (window as any)._activeUtterances?.delete(utterance);
        }
        if (e.error === 'interrupted' || e.error === 'canceled') {
          console.log(`[SpeechSynth] onerror (${e.error}) — intentional cancel, skipping onEnd.`);
          setIsSpeaking(false);
          activeUtteranceRef.current = null;
          return;
        }
        console.error('[SpeechSynth] onerror:', e.error);
        setIsSpeaking(false);
        activeUtteranceRef.current = null;
        
        const cb = onEndCallbackRef.current;
        onEndCallbackRef.current = null;
        if (cb) cb();
      };

      synthRef.current.speak(utterance);
    }, 80);
  }, [voiceEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (speakTimeoutRef.current) {
        clearTimeout(speakTimeoutRef.current);
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    voices
  };
}
