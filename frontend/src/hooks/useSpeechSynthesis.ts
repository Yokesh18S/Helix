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

  const speak = useCallback((text: string, langCodeOrCb?: string | (() => void), onEnd?: () => void) => {
    let langCode = 'en-US';
    let cb = onEnd;

    if (typeof langCodeOrCb === 'function') {
      cb = langCodeOrCb;
    } else if (typeof langCodeOrCb === 'string') {
      langCode = langCodeOrCb;
    }

    if (!voiceEnabled) {
      if (cb) cb();
      return;
    }

    if (speakTimeoutRef.current) {
      clearTimeout(speakTimeoutRef.current);
    }

    if (!synthRef.current) {
      console.warn('[SpeechSynth] speak() called but synthesis not available.');
      if (cb) cb();
      return;
    }

    console.log(`[SpeechSynth] speak(${langCode}): "${text.substring(0, 60)}..."`);

    setIsSpeaking(true);

    onEndCallbackRef.current = null;
    activeUtteranceRef.current = null;
    synthRef.current.cancel();

    speakTimeoutRef.current = setTimeout(() => {
      if (!synthRef.current) {
        setIsSpeaking(false);
        if (cb) cb();
        return;
      }

      let spokenText = text.replace(/\b(\d{10})\b/g, (match) =>
        match.split('').join(' ')
      );
      spokenText = spokenText
        .replace(/\b0\b/g, 'zero')
        .replace(/[*_#`~]/g, '')
        .replace(/\//g, ' or ')
        .replace(/\s+/g, ' ')
        .trim();

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = langCode;
      activeUtteranceRef.current = utterance;
      onEndCallbackRef.current = cb || null;

      if (typeof window !== 'undefined') {
        const w = window as any;
        w._activeUtterances = w._activeUtterances || new Set();
        w._activeUtterances.add(utterance);
      }

      const allVoices = synthRef.current.getVoices();
      const langPrefix = langCode.split('-')[0].toLowerCase();

      // Select sweet, natural female voice
      const selectedVoice =
        allVoices.find((v) => v.lang.toLowerCase().startsWith(langPrefix) && /natural|neural|online|female|jenny|aria|sonia|swara|neerja|samantha|victoria|karen|moira/i.test(v.name)) ||
        allVoices.find((v) => v.lang.toLowerCase().startsWith(langPrefix) && !/male|david|mark|george|stefan|ravi/i.test(v.name)) ||
        allVoices.find((v) => /jenny.*natural|aria.*natural|sonia.*natural/i.test(v.name)) ||
        allVoices.find((v) => /google uk english female|google us english/i.test(v.name)) ||
        allVoices.find((v) => /samantha|victoria|karen|moira|zira/i.test(v.name)) ||
        allVoices.find((v) => v.lang.toLowerCase() === langCode.toLowerCase()) ||
        allVoices[0];

      if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log(`[SpeechSynth] Selected natural female voice: "${selectedVoice.name}" (${selectedVoice.lang})`);
      }

      utterance.rate = 0.93;   // Sweet, natural human pace
      utterance.pitch = 1.16;  // Warm, cheerful female melody tone
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
