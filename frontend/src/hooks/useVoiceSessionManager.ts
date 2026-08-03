/**
 * useVoiceSessionManager — Centralized Voice Lifecycle State Machine
 *
 * This is the SINGLE source of truth for all voice I/O in the Interview flow.
 *
 * Conversation States:
 *   IDLE              — Nothing active. Awaiting session start.
 *   AI_SPEAKING       — TTS is active. Recognition is NOT allowed.
 *   USER_LISTENING    — Recognition is active. TTS is idle.
 *   PROCESSING        — Backend call in flight. Both TTS and STT are idle.
 *   WAITING_FOR_RESPONSE — Backend responded; awaiting next AI turn (brief).
 *   COMPLETE          — Interview is finished.
 *
 * Rules enforced by this manager:
 *   1. recognition.start() is NEVER called while state === AI_SPEAKING or PROCESSING.
 *   2. TTS is cancelled before recognition starts.
 *   3. Recognition only restarts via onend/onerror events (event-driven, not polling).
 *      Exponential backoff is applied on repeated failures.
 *   4. All lifecycle events are logged with timestamps for production debugging.
 *   5. Cleanup runs on unmount: aborts recognition, cancels TTS, clears all timers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// --- Types --------------------------------------------------------------------

export type ConversationState =
  | 'IDLE'
  | 'AI_SPEAKING'
  | 'USER_LISTENING'
  | 'PROCESSING'
  | 'WAITING_FOR_RESPONSE'
  | 'COMPLETE';

export type VsmAction =
  | 'START_SESSION'
  | 'START_SPEAKING'
  | 'STOP_SPEAKING'
  | 'START_LISTENING'
  | 'STOP_LISTENING'
  | 'START_PROCESSING'
  | 'STOP_PROCESSING'
  | 'COMPLETE_INTERVIEW';

export interface VoiceResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

interface UseVoiceSessionManagerProps {
  onResult: (result: VoiceResult) => void;
  onError?: (error: string) => void;
  lang?: string;
  voiceEnabled?: boolean;
}

// --- Helpers ------------------------------------------------------------------

function vsmLog(event: string, detail?: string) {
  const ts = new Date().toISOString();
  console.log(`[VSM ${ts}] ${event}${detail ? ` — ${detail}` : ''}`);
}

function getBackoffDelay(attempt: number): number {
  return Math.min(300 * Math.pow(2, attempt - 1), 5000);
}

// --- Hook ---------------------------------------------------------------------

export function useVoiceSessionManager({
  onResult,
  onError,
  lang = 'en-US',
  voiceEnabled = true,
}: UseVoiceSessionManagerProps) {
  const [conversationState, setConversationState] = useState<ConversationState>('IDLE');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);

  const conversationStateRef = useRef<ConversationState>('IDLE');
  const isListeningRef = useRef(false);
  const isStartingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const isMountedRef = useRef(true);
  const restartAttemptsRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const safeSetState = useCallback((state: ConversationState) => {
    if (!isMountedRef.current) return;
    conversationStateRef.current = state;
    setConversationState(state);
    vsmLog('STATE', state);
  }, []);

  // --- SpeechSynthesis init -------------------------------------------------
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
      const loadVoices = () => {
        const all = synthRef.current!.getVoices();
        if (all.length > 0) voicesRef.current = all;
      };
      loadVoices();
      synthRef.current.onvoiceschanged = loadVoices;
    }
  }, []);

  // --- Internal helpers -----------------------------------------------------

  const _startRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) { vsmLog('REC', '_startRecognition: no instance'); return; }
    if (isListeningRef.current || isStartingRef.current) {
      vsmLog('REC', '_startRecognition: already active or starting — skip');
      return;
    }
    if (isSpeakingRef.current) {
      vsmLog('REC', '_startRecognition: TTS active — deferred');
      return;
    }
    vsmLog('REC', 'calling recognition.start()');
    isStartingRef.current = true;
    setLiveTranscript('');
    try {
      rec.start();
    } catch (e) {
      isStartingRef.current = false;
      vsmLog('REC', `start() threw: ${e}`);
    }
  }, []);

  const _stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    try { vsmLog('REC', 'calling recognition.stop()'); rec.stop(); } catch (e) { vsmLog('REC', `stop() threw: ${e}`); }
  }, []);

  const _abortRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    isStartingRef.current = false;
    isListeningRef.current = false;
    if (isMountedRef.current) setIsListening(false);
    try { vsmLog('REC', 'calling recognition.abort()'); rec.abort(); } catch (e) { vsmLog('REC', `abort() threw: ${e}`); }
  }, []);

  const _scheduleRestart = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (!isMountedRef.current) return;
    restartAttemptsRef.current += 1;
    const delay = getBackoffDelay(restartAttemptsRef.current);
    vsmLog('REC', `scheduling restart attempt ${restartAttemptsRef.current} in ${delay}ms`);
    restartTimerRef.current = setTimeout(() => {
      if (
        isMountedRef.current &&
        conversationStateRef.current === 'USER_LISTENING' &&
        !isSpeakingRef.current
      ) {
        _startRecognition();
      }
    }, delay);
  }, [_startRecognition]);

  const _cancelTTS = useCallback(() => {
    if (synthRef.current) {
      vsmLog('TTS', 'cancelling synthesis');
      if (activeUtteranceRef.current) {
        activeUtteranceRef.current.onstart = null;
        activeUtteranceRef.current.onend = null;
        activeUtteranceRef.current.onerror = null;
      }
      synthRef.current.cancel();
      activeUtteranceRef.current = null;
    }
    isSpeakingRef.current = false;
    if (isMountedRef.current) setIsSpeaking(false);
  }, []);

  const _cleanup = useCallback(() => {
    _cancelTTS();
    _abortRecognition();
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  }, [_cancelTTS, _abortRecognition]);

  // --- SpeechRecognition init -----------------------------------------------
  useEffect(() => {
    const SR =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SR) { vsmLog('INIT', 'SpeechRecognition not supported'); return; }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      if (!isMountedRef.current) return;
      vsmLog('REC', 'onstart');
      isStartingRef.current = false;
      isListeningRef.current = true;
      restartAttemptsRef.current = 0;
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      if (!isMountedRef.current) return;
      let interim = '';
      let final = '';
      let totalConf = 0;
      let finalCount = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          final += text;
          let conf = r[0].confidence;
          if (!conf || conf < 0.1) conf = 0.95;
          totalConf += conf;
          finalCount++;
        } else {
          interim += text;
        }
      }
      const fullTranscript = final + interim;
      const avgConf = finalCount > 0 ? totalConf / finalCount : 0.9;
      setLiveTranscript(fullTranscript);
      onResultRef.current?.({ transcript: fullTranscript, confidence: avgConf, isFinal: final.length > 0 });

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (final.length > 0 && conversationStateRef.current === 'USER_LISTENING') {
        silenceTimerRef.current = setTimeout(() => {
          if (isMountedRef.current && conversationStateRef.current === 'USER_LISTENING' && isListeningRef.current) {
            vsmLog('REC', 'silence timeout after final — stopping');
            _stopRecognition();
          }
        }, 2500);
      }
    };

    recognition.onerror = (event: any) => {
      if (!isMountedRef.current) return;
      const err = event.error as string;
      vsmLog('REC', `onerror — ${err}`);
      isStartingRef.current = false;
      isListeningRef.current = false;
      setIsListening(false);

      if (err === 'aborted') return;
      if (err === 'no-speech') { _scheduleRestart(); return; }
      if (err === 'not-allowed' || err === 'permission-denied') {
        const msg = 'Microphone permission denied. Please allow access in browser settings.';
        onErrorRef.current?.(msg);
        safeSetState('IDLE');
        return;
      }
      _scheduleRestart();
    };

    recognition.onend = () => {
      if (!isMountedRef.current) return;
      vsmLog('REC', 'onend');
      isStartingRef.current = false;
      isListeningRef.current = false;
      setIsListening(false);
      if (isMountedRef.current && conversationStateRef.current === 'USER_LISTENING' && !isSpeakingRef.current) {
        _scheduleRestart();
      }
    };

    recognitionRef.current = recognition;
    vsmLog('INIT', 'SpeechRecognition ready');

    return () => {
      isMountedRef.current = false;
      vsmLog('CLEANUP', 'unmounting');
      _cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Sync lang changes after init
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = lang;
      vsmLog('REC', `lang updated to ${lang}`);
    }
  }, [lang]);

  // --- Public: dispatch -----------------------------------------------------
  const dispatch = useCallback((action: VsmAction) => {
    vsmLog('DISPATCH', action);
    switch (action) {
      case 'START_SESSION':
        if (!sessionStartedRef.current) {
          sessionStartedRef.current = true;
          if (isMountedRef.current) setSessionStarted(true);
          vsmLog('SESSION', 'unlocked via user gesture');
        }
        break;
      case 'START_SPEAKING':
        _abortRecognition();
        safeSetState('AI_SPEAKING');
        isSpeakingRef.current = true;
        if (isMountedRef.current) setIsSpeaking(true);
        break;
      case 'STOP_SPEAKING':
        isSpeakingRef.current = false;
        if (isMountedRef.current) setIsSpeaking(false);
        break;
      case 'START_LISTENING':
        if (conversationStateRef.current === 'AI_SPEAKING' || conversationStateRef.current === 'PROCESSING') {
          vsmLog('DISPATCH', `START_LISTENING ignored in state ${conversationStateRef.current}`);
          return;
        }
        safeSetState('USER_LISTENING');
        restartAttemptsRef.current = 0;
        _startRecognition();
        break;
      case 'STOP_LISTENING':
        _stopRecognition();
        if (conversationStateRef.current === 'USER_LISTENING') safeSetState('WAITING_FOR_RESPONSE');
        break;
      case 'START_PROCESSING':
        _abortRecognition();
        safeSetState('PROCESSING');
        break;
      case 'STOP_PROCESSING':
        if (conversationStateRef.current === 'PROCESSING') safeSetState('WAITING_FOR_RESPONSE');
        break;
      case 'COMPLETE_INTERVIEW':
        _cleanup();
        safeSetState('COMPLETE');
        break;
    }
  }, [safeSetState, _abortRecognition, _startRecognition, _stopRecognition, _cleanup]);

  // --- Public: speak --------------------------------------------------------
  const speak = useCallback((text: string, onEnd?: () => void, langCode?: string) => {
    if (!voiceEnabled) { onEnd?.(); return; }
    if (!synthRef.current) { onEnd?.(); return; }

    dispatch('START_SPEAKING');
    _cancelTTS();

    setTimeout(() => {
      if (!isMountedRef.current || !synthRef.current) { onEnd?.(); return; }

      let processed = text.replace(/\b(\d{10})\b/g, (m) => m.split('').join(' '));
      processed = processed.replace(/\b0\b/g, 'zero');

      const utterance = new SpeechSynthesisUtterance(processed);
      if (langCode) utterance.lang = langCode;
      activeUtteranceRef.current = utterance;

      const w = window as any;
      w._helixUtterances = w._helixUtterances || new Set();
      w._helixUtterances.add(utterance);

      const allVoices = voicesRef.current.length > 0 ? voicesRef.current : synthRef.current!.getVoices();
      const voice =
        allVoices.find((v) => v.name.toLowerCase().includes('samantha')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('victoria')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('karen')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('google uk english female')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('google us english')) ||
        allVoices.find((v) => v.lang === 'en-US') ||
        allVoices[0];

      if (voice) { utterance.voice = voice; vsmLog('TTS', `voice: "${voice.name}"`); }
      utterance.rate = 0.96;
      utterance.pitch = 1.12;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        if (!isMountedRef.current) return;
        vsmLog('TTS', 'onstart');
        isSpeakingRef.current = true;
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        w._helixUtterances?.delete(utterance);
        if (!isMountedRef.current) return;
        if (activeUtteranceRef.current !== utterance) return;
        vsmLog('TTS', 'onend — finished');
        activeUtteranceRef.current = null;
        dispatch('STOP_SPEAKING');
        onEnd?.();
      };

      utterance.onerror = (e) => {
        w._helixUtterances?.delete(utterance);
        if (!isMountedRef.current) return;
        if (e.error === 'interrupted' || e.error === 'canceled') {
          vsmLog('TTS', `onerror (${e.error}) — intentional cancel`);
          return;
        }
        vsmLog('TTS', `onerror: ${e.error}`);
        activeUtteranceRef.current = null;
        dispatch('STOP_SPEAKING');
        onEnd?.();
      };

      vsmLog('TTS', `speak: "${text.substring(0, 60)}..."`);
      synthRef.current!.speak(utterance);
    }, 80);
  }, [voiceEnabled, dispatch, _cancelTTS]);

  // --- Public: stopSpeaking / abortListening --------------------------------
  const stopSpeaking = useCallback(() => { vsmLog('TTS', 'stopSpeaking'); _cancelTTS(); }, [_cancelTTS]);
  const abortListening = useCallback(() => { vsmLog('REC', 'abortListening'); _abortRecognition(); }, [_abortRecognition]);

  return {
    conversationState,
    sessionStarted,
    isListening,
    isSpeaking,
    liveTranscript,
    dispatch,
    speak,
    stopSpeaking,
    abortListening,
  };
}
