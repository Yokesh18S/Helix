/**
 * useVoiceSessionManager - Production Voice Lifecycle State Machine v3
 *
 * =========================================================================
 * SEQUENCING ARCHITECTURE (key to understanding this file)
 * =========================================================================
 *
 * The speak() callback (onEnd) is stored in ttsCompletionRef and called
 * from INSIDE the STOP_SPEAKING reducer case — AFTER stateRef has been
 * committed to WAITING_FOR_USER. This is the only guarantee that
 * START_LISTENING (dispatched inside onEnd) will always see the correct
 * state. Calling onEnd synchronously in utterance.onend before the
 * microtask flushes STOP_SPEAKING is the bug this design eliminates.
 *
 * Event Queue Invariants:
 *   1. Every queued item has a unique sequence ID and enqueue timestamp.
 *   2. Dequeue and execution timestamps are logged for every item.
 *   3. Queue contents are logged after every enqueue and dequeue.
 *   4. START_LISTENING dispatched during AI_SPEAKING is parked and
 *      automatically replayed after STOP_SPEAKING completes.
 *   5. STOP_SPEAKING failure (invalid transition) cancels any parked
 *      START_LISTENING and logs the reason.
 *
 * Voice States:
 *   IDLE              - Nothing active. Awaiting session start.
 *   AI_SPEAKING       - TTS active. Recognition NOT allowed.
 *   WAITING_FOR_USER  - TTS finished. Gate before mic opens.
 *   USER_LISTENING    - Recognition active. TTS idle.
 *   PROCESSING        - Backend call in flight.
 *   WAITING_FOR_RESPONSE - Backend responded; awaiting next AI turn.
 *   COMPLETE          - Interview finished (terminal).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceState =
  | 'IDLE'
  | 'AI_SPEAKING'
  | 'WAITING_FOR_USER'
  | 'USER_LISTENING'
  | 'PROCESSING'
  | 'WAITING_FOR_RESPONSE'
  | 'COMPLETE';

/** @deprecated Use VoiceState. Kept for backward-compat with existing consumers. */
export type ConversationState = VoiceState;

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

export interface RecoveryOptions {
  retryVoice: () => void;
  switchToKeyboard: () => void;
  restartInterview: () => void;
}

export interface BrowserCapability {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  mediaDevices: boolean;
}

/** A queued event with full tracing metadata. */
interface QueuedEvent {
  /** Monotonically increasing sequence number (module-level). */
  id: number;
  action: VsmAction;
  /** performance.now() at enqueue time. */
  enqueuedAt: number;
}

interface UseVoiceSessionManagerProps {
  onResult: (result: VoiceResult) => void;
  onError?: (error: string) => void;
  onRecoveryRequired?: (options: RecoveryOptions) => void;
  lang?: string;
  voiceEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Module-level sequence counter (shared across all hook instances)
// ---------------------------------------------------------------------------
let _vsmSeq = 0;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESTART_ATTEMPTS = 3;
const BASE_BACKOFF_MS      = 300;
const MAX_BACKOFF_MS       = 5000;
const SILENCE_TIMEOUT_MS   = 2500;
const TTS_STARTUP_DELAY_MS = 80;

/**
 * Legal transition table.
 * Key = current state. Value = allowed target states.
 */
const LEGAL_TRANSITIONS: Record<VoiceState, readonly VoiceState[]> = {
  IDLE:                 ['AI_SPEAKING'],
  AI_SPEAKING:          ['WAITING_FOR_USER', 'IDLE'],
  WAITING_FOR_USER:     ['USER_LISTENING', 'AI_SPEAKING', 'IDLE'],
  USER_LISTENING:       ['WAITING_FOR_RESPONSE', 'PROCESSING', 'IDLE'],
  PROCESSING:           ['WAITING_FOR_RESPONSE', 'AI_SPEAKING', 'IDLE'],
  WAITING_FOR_RESPONSE: ['AI_SPEAKING', 'USER_LISTENING', 'IDLE'],
  COMPLETE:             [],
};

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function vsmLog(action: string, prev: string, next: string, detail?: string): void {
  console.log(
    '[VSM] ' + new Date().toISOString() +
    ' | action=' + action +
    ' | ' + prev + ' -> ' + next +
    (detail ? ' | ' + detail : ''),
  );
}

function vsmWarn(msg: string): void {
  console.warn('[VSM WARN] ' + new Date().toISOString() + ' | ' + msg);
}

function vsmQueueLog(queue: QueuedEvent[], context: string): void {
  if (queue.length === 0) {
    console.log('[VSM QUEUE] ' + context + ' | (empty)');
    return;
  }
  const items = queue.map((e, i) => (i + 1) + '. ' + e.action + '#' + e.id).join(', ');
  console.log('[VSM QUEUE] ' + context + ' | [' + items + ']');
}

function isLegalTransition(from: VoiceState, to: VoiceState): boolean {
  return (LEGAL_TRANSITIONS[from] as readonly string[]).includes(to);
}

function getBackoffDelay(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

function checkBrowserCapabilities(): BrowserCapability {
  if (typeof window === 'undefined') {
    return { speechRecognition: false, speechSynthesis: false, mediaDevices: false };
  }
  return {
    speechRecognition:
      !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition,
    speechSynthesis: !!window.speechSynthesis,
    mediaDevices:    !!(navigator.mediaDevices?.getUserMedia),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceSessionManager({
  onResult,
  onError,
  onRecoveryRequired,
  lang = 'en-US',
  voiceEnabled = true,
}: UseVoiceSessionManagerProps) {

  // -- UI-facing state -------------------------------------------------------
  const [voiceState,      setVoiceState]     = useState<VoiceState>('IDLE');
  const [isListening,     setIsListening]    = useState(false);
  const [isSpeaking,      setIsSpeaking]     = useState(false);
  const [liveTranscript,  setLiveTranscript] = useState('');
  const [sessionStarted,  setSessionStarted] = useState(false);
  const [browserCapabilities]               = useState<BrowserCapability>(checkBrowserCapabilities);

  // -- Synchronous refs (authoritative, used inside all callbacks) -----------
  const stateRef           = useRef<VoiceState>('IDLE');
  const isListeningRef     = useRef(false);
  const isStartingRef      = useRef(false);
  const isSpeakingRef      = useRef(false);
  const sessionStartedRef  = useRef(false);
  const isMountedRef       = useRef(true);
  const restartAttemptsRef = useRef(0);

  // -- Timers ----------------------------------------------------------------
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Event queue -----------------------------------------------------------
  // QueuedEvent items are created at dispatch time with a unique seq ID and
  // enqueue timestamp. The queue is drained one item per microtask tick.
  const eventQueueRef  = useRef<QueuedEvent[]>([]);
  const isFlushingRef  = useRef(false);

  // -- TTS completion callback -----------------------------------------------
  // ARCHITECTURAL KEY: speak(text, onEnd) stores onEnd here instead of calling
  // it inside utterance.onend. The STOP_SPEAKING reducer case calls it AFTER
  // committing stateRef = WAITING_FOR_USER. This guarantees START_LISTENING
  // dispatched inside onEnd always sees the correct state.
  const ttsCompletionRef = useRef<(() => void) | null>(null);

  // -- Parked START_LISTENING ------------------------------------------------
  // When START_LISTENING arrives while state === AI_SPEAKING, instead of
  // rejecting it, we park it here. STOP_SPEAKING replays it after state commit.
  const parkedStartListeningRef = useRef<QueuedEvent | null>(null);

  // -- Stable callback refs --------------------------------------------------
  const onResultRef        = useRef(onResult);
  const onErrorRef         = useRef(onError);
  const onRecoveryReqRef   = useRef(onRecoveryRequired);
  onResultRef.current       = onResult;
  onErrorRef.current        = onError;
  onRecoveryReqRef.current  = onRecoveryRequired;

  // -- Browser APIs ----------------------------------------------------------
  const recognitionRef      = useRef<any>(null);
  const synthRef            = useRef<SpeechSynthesis | null>(null);
  const activeUtteranceRef  = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef           = useRef<SpeechSynthesisVoice[]>([]);

  // -- Forward ref for reducer -----------------------------------------------
  const _processEventRef = useRef<(item: QueuedEvent) => void>(() => {});

  // =========================================================================
  // Core: validated atomic state setter
  // =========================================================================

  const _applyState = useCallback((
    action: string,
    next: VoiceState,
    detail?: string,
  ): boolean => {
    const prev = stateRef.current;
    if (prev === next) return true;

    if (!isLegalTransition(prev, next)) {
      vsmWarn(
        'INVALID TRANSITION | action=' + action +
        ' | ' + prev + ' -> ' + next +
        ' | allowed from ' + prev + ': [' + LEGAL_TRANSITIONS[prev].join(', ') + ']',
      );
      return false;
    }

    stateRef.current = next;
    if (isMountedRef.current) setVoiceState(next);
    vsmLog(action, prev, next, detail);
    return true;
  }, []);

  // =========================================================================
  // Internal: Recognition helpers
  // =========================================================================

  const _startRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) { vsmWarn('_startRecognition: no instance'); return; }
    if (isListeningRef.current || isStartingRef.current) {
      vsmWarn('_startRecognition: already active or starting - skip');
      return;
    }
    if (isSpeakingRef.current) {
      vsmWarn('_startRecognition: isSpeakingRef=true - deferred (should not happen here)');
      return;
    }
    if (stateRef.current !== 'USER_LISTENING') {
      vsmWarn('_startRecognition: state=' + stateRef.current + ' expected USER_LISTENING - abort');
      return;
    }
    vsmLog('REC_START', stateRef.current, stateRef.current, 'calling recognition.start()');
    isStartingRef.current = true;
    setLiveTranscript('');
    try { rec.start(); }
    catch (e: any) {
      isStartingRef.current = false;
      if (e?.name === 'InvalidStateError' || String(e).includes('already started')) {
        vsmLog('REC_START', stateRef.current, stateRef.current, 'recognition already started (handled)');
        isListeningRef.current = true;
        if (isMountedRef.current) setIsListening(true);
      } else {
        vsmWarn('recognition.start() threw: ' + e);
      }
    }
  }, []);

  const _stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    try {
      vsmLog('REC_STOP', stateRef.current, stateRef.current, 'calling recognition.stop()');
      rec.stop();
    }
    catch (e) { vsmWarn('recognition.stop() threw: ' + e); }
  }, []);

  const _abortRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    isStartingRef.current  = false;
    isListeningRef.current = false;
    if (isMountedRef.current) setIsListening(false);
    try {
      vsmLog('REC_ABORT', stateRef.current, stateRef.current, 'calling recognition.abort()');
      rec.abort();
    }
    catch (e) { vsmWarn('recognition.abort() threw: ' + e); }
  }, []);

  const _scheduleRestart = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (!isMountedRef.current) return;

    restartAttemptsRef.current += 1;

    if (restartAttemptsRef.current > MAX_RESTART_ATTEMPTS) {
      vsmWarn('MAX_RESTART_ATTEMPTS (' + MAX_RESTART_ATTEMPTS + ') exceeded - offering recovery');
      _applyState('RECOGNITION_EXHAUSTED', 'IDLE', 'all retries failed');
      const opts: RecoveryOptions = {
        retryVoice: () => {
          restartAttemptsRef.current = 0;
          _applyState('RETRY_VOICE', 'WAITING_FOR_USER');
          const item: QueuedEvent = { id: ++_vsmSeq, action: 'START_LISTENING', enqueuedAt: performance.now() };
          eventQueueRef.current.push(item);
          vsmQueueLog(eventQueueRef.current, 'after retryVoice enqueue');
          if (!isFlushingRef.current) {
            isFlushingRef.current = true;
            Promise.resolve().then(() => {
              while (eventQueueRef.current.length > 0) {
                _processEventRef.current(eventQueueRef.current.shift()!);
              }
              isFlushingRef.current = false;
            });
          }
        },
        switchToKeyboard: () => {
          onErrorRef.current?.('Voice recognition unavailable. Please use keyboard input.');
        },
        restartInterview: () => { window.location.reload(); },
      };
      onRecoveryReqRef.current?.(opts);
      return;
    }

    const delay = getBackoffDelay(restartAttemptsRef.current);
    vsmLog(
      'REC_SCHEDULE_RESTART', stateRef.current, stateRef.current,
      'attempt=' + restartAttemptsRef.current + '/' + MAX_RESTART_ATTEMPTS + ' delay=' + delay + 'ms',
    );
    restartTimerRef.current = setTimeout(() => {
      if (
        isMountedRef.current &&
        stateRef.current === 'USER_LISTENING' &&
        !isSpeakingRef.current
      ) {
        _startRecognition();
      }
    }, delay);
  }, [_applyState, _startRecognition]);

  // =========================================================================
  // Internal: TTS helpers
  // =========================================================================

  const _cancelTTS = useCallback(() => {
    if (synthRef.current) {
      vsmLog('TTS_CANCEL', stateRef.current, stateRef.current, 'cancelling synthesis');
      if (activeUtteranceRef.current) {
        activeUtteranceRef.current.onstart = null;
        activeUtteranceRef.current.onend   = null;
        activeUtteranceRef.current.onerror = null;
      }
      synthRef.current.cancel();
      activeUtteranceRef.current = null;
    }
    ttsCompletionRef.current = null;
    isSpeakingRef.current = false;
    if (isMountedRef.current) setIsSpeaking(false);
  }, []);

  // =========================================================================
  // Internal: Full session cleanup
  // =========================================================================

  const _cleanup = useCallback(() => {
    vsmLog('CLEANUP', stateRef.current, stateRef.current, 'full session teardown');
    _cancelTTS();
    _abortRecognition();
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    eventQueueRef.current     = [];
    isFlushingRef.current     = false;
    parkedStartListeningRef.current = null;
    ttsCompletionRef.current  = null;
  }, [_cancelTTS, _abortRecognition]);

  // =========================================================================
  // Reducer: process one QueuedEvent
  // =========================================================================

  const _processEvent = useCallback((item: QueuedEvent) => {
    const { id, action, enqueuedAt } = item;
    const execAt  = performance.now();
    const current = stateRef.current;

    vsmLog(
      'EXEC_' + action,
      current,
      current,
      'seq=#' + id +
      ' | wait=' + (execAt - enqueuedAt).toFixed(2) + 'ms' +
      ' | queue_after_shift=' + eventQueueRef.current.length,
    );

    switch (action) {

      // ── START_SESSION ─────────────────────────────────────────────────────
      case 'START_SESSION':
        if (sessionStartedRef.current) {
          vsmWarn('#' + id + ' START_SESSION: already started - ignore');
          return;
        }
        sessionStartedRef.current = true;
        if (isMountedRef.current) setSessionStarted(true);
        vsmLog('START_SESSION', current, current, 'user gesture unlocked');
        return;

      // ── START_SPEAKING ────────────────────────────────────────────────────
      case 'START_SPEAKING': {
        const ok = _applyState('START_SPEAKING', 'AI_SPEAKING', 'seq=#' + id);
        if (!ok) return;
        _abortRecognition();
        isSpeakingRef.current = true;
        if (isMountedRef.current) setIsSpeaking(true);
        return;
      }

      // ── STOP_SPEAKING ─────────────────────────────────────────────────────
      //
      // This is the critical sequencing fix.
      //
      // Step 1: Clear speaking refs synchronously.
      // Step 2: Commit stateRef = WAITING_FOR_USER via _applyState.
      // Step 3: If there is a parked START_LISTENING, replay it NOW (state is safe).
      // Step 4: Call ttsCompletionRef (the speak() onEnd callback) NOW.
      //         Any START_LISTENING dispatched inside that callback will see
      //         WAITING_FOR_USER in stateRef and will pass the guard.
      //
      case 'STOP_SPEAKING': {
        isSpeakingRef.current = false;
        if (isMountedRef.current) setIsSpeaking(false);

        const ok = _applyState('STOP_SPEAKING', 'WAITING_FOR_USER', 'seq=#' + id);
        if (!ok) {
          // We were interrupted before reaching AI_SPEAKING (e.g. cancelled).
          // Drop any parked START_LISTENING - it is no longer meaningful.
          if (parkedStartListeningRef.current) {
            vsmWarn('#' + id + ' STOP_SPEAKING: state transition failed - discarding parked START_LISTENING#' + parkedStartListeningRef.current.id);
            parkedStartListeningRef.current = null;
          }
          ttsCompletionRef.current = null;
          _applyState('STOP_SPEAKING_FALLBACK', 'IDLE', 'unexpected prior state - fallback');
          return;
        }

        // State is now WAITING_FOR_USER in stateRef (synchronous).
        // Replay any parked START_LISTENING first (direct call, not re-enqueue).
        const parked = parkedStartListeningRef.current;
        parkedStartListeningRef.current = null;
        if (parked) {
          vsmLog(
            'REPLAY_PARKED',
            stateRef.current,
            stateRef.current,
            'replaying START_LISTENING#' + parked.id + ' parked during AI_SPEAKING',
          );
          _processEventRef.current(parked);
          return; // ttsCompletion will be called inside START_LISTENING via onEnd
        }

        // No parked event - call TTS completion callback.
        // This is where speak(text, onEnd) consumers will dispatch START_LISTENING.
        const cb = ttsCompletionRef.current;
        ttsCompletionRef.current = null;
        if (cb) {
          vsmLog('STOP_SPEAKING_CB', stateRef.current, stateRef.current, 'invoking TTS completion callback');
          cb();
        }
        return;
      }

      // ── START_LISTENING ───────────────────────────────────────────────────
      //
      // If the state is AI_SPEAKING, park the event instead of rejecting it.
      // STOP_SPEAKING will replay it once state is committed to WAITING_FOR_USER.
      //
      case 'START_LISTENING': {
        if (current === 'AI_SPEAKING') {
          vsmWarn(
            '#' + id + ' START_LISTENING: state=AI_SPEAKING - parking until STOP_SPEAKING commits. ' +
            'Prior parked: ' + (parkedStartListeningRef.current ? '#' + parkedStartListeningRef.current.id : 'none'),
          );
          parkedStartListeningRef.current = item; // replace any prior park
          return;
        }

        const allowed: VoiceState[] = ['WAITING_FOR_USER', 'WAITING_FOR_RESPONSE', 'IDLE'];
        if (!allowed.includes(current)) {
          vsmWarn(
            '#' + id + ' START_LISTENING REJECTED: state=' + current +
            '. Expected one of [' + allowed.join(', ') + ']. ' +
            'This is a logic error - ensure STOP_SPEAKING precedes START_LISTENING.',
          );
          return;
        }

        const ok = _applyState('START_LISTENING', 'USER_LISTENING', 'seq=#' + id);
        if (!ok) return;
        restartAttemptsRef.current = 0;
        _startRecognition();

        // After START_LISTENING is processed, call the TTS completion callback if
        // it was deferred here (can happen when STOP_SPEAKING replays a parked event).
        const cb = ttsCompletionRef.current;
        ttsCompletionRef.current = null;
        if (cb) {
          vsmLog('START_LISTENING_CB', stateRef.current, stateRef.current, 'invoking deferred TTS callback');
          cb();
        }
        return;
      }

      case 'STOP_LISTENING':
        _stopRecognition();
        if (current === 'USER_LISTENING') {
          _applyState('STOP_LISTENING', 'WAITING_FOR_RESPONSE', 'seq=#' + id);
        }
        return;

      case 'START_PROCESSING':
        _abortRecognition();
        _applyState('START_PROCESSING', 'PROCESSING', 'seq=#' + id);
        return;

      case 'STOP_PROCESSING':
        if (current === 'PROCESSING') {
          _applyState('STOP_PROCESSING', 'WAITING_FOR_RESPONSE', 'seq=#' + id);
        } else {
          vsmWarn('#' + id + ' STOP_PROCESSING ignored: state=' + current + ', expected PROCESSING');
        }
        return;

      case 'COMPLETE_INTERVIEW':
        _cleanup();
        stateRef.current = 'COMPLETE';
        if (isMountedRef.current) setVoiceState('COMPLETE');
        vsmLog('COMPLETE_INTERVIEW', current, 'COMPLETE', 'seq=#' + id);
        return;

      default:
        vsmWarn('#' + id + ' Unknown action: ' + action);
    }
  }, [_applyState, _abortRecognition, _startRecognition, _stopRecognition, _cancelTTS, _cleanup]);

  // Keep _processEventRef current (avoids stale closure in _scheduleRestart)
  useEffect(() => { _processEventRef.current = _processEvent; }, [_processEvent]);

  // =========================================================================
  // Queue flush engine
  // =========================================================================

  const _enqueueAndFlush = useCallback((action: VsmAction): QueuedEvent => {
    const item: QueuedEvent = { id: ++_vsmSeq, action, enqueuedAt: performance.now() };
    eventQueueRef.current.push(item);
    vsmQueueLog(eventQueueRef.current, 'after enqueue ' + action + '#' + item.id);

    if (isFlushingRef.current) {
      // Already draining - the item will be picked up in the running loop.
      vsmLog('DISPATCH', stateRef.current, stateRef.current, action + '#' + item.id + ' queued (flush in progress)');
      return item;
    }

    isFlushingRef.current = true;
    vsmLog('DISPATCH', stateRef.current, stateRef.current, action + '#' + item.id + ' queued, scheduling flush');

    // Promise.resolve() yields to the current synchronous frame.
    // This guarantees that if dispatch('STOP_SPEAKING') and dispatch('START_LISTENING')
    // are called synchronously one after another, BOTH are in the queue before
    // ANY item is processed.
    Promise.resolve().then(() => {
      vsmQueueLog(eventQueueRef.current, 'flush start');
      while (eventQueueRef.current.length > 0) {
        const next = eventQueueRef.current.shift()!;
        vsmQueueLog(eventQueueRef.current, 'after dequeue ' + next.action + '#' + next.id);
        _processEventRef.current(next);
      }
      vsmLog('FLUSH_DONE', stateRef.current, stateRef.current, 'queue empty');
      isFlushingRef.current = false;
    });

    return item;
  }, []);

  // =========================================================================
  // Public: dispatch
  // =========================================================================

  const dispatch = useCallback((action: VsmAction) => {
    _enqueueAndFlush(action);
  }, [_enqueueAndFlush]);

  // =========================================================================
  // SpeechSynthesis init
  // =========================================================================

  useEffect(() => {
    if (!browserCapabilities.speechSynthesis) {
      vsmWarn('SpeechSynthesis not supported - TTS disabled');
      return;
    }
    synthRef.current = window.speechSynthesis;
    const loadVoices = () => {
      const all = synthRef.current!.getVoices();
      if (all.length > 0) voicesRef.current = all;
    };
    loadVoices();
    synthRef.current.onvoiceschanged = loadVoices;
  }, [browserCapabilities.speechSynthesis]);

  // =========================================================================
  // SpeechRecognition init
  // =========================================================================

  useEffect(() => {
    if (!browserCapabilities.speechRecognition) {
      vsmWarn('SpeechRecognition not supported - keyboard fallback required');
      onErrorRef.current?.('Voice recognition is not supported in this browser. Please use keyboard input.');
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = lang;

    recognition.onstart = () => {
      if (!isMountedRef.current) return;
      vsmLog('REC_ONSTART', stateRef.current, stateRef.current, 'mic open');
      isStartingRef.current      = false;
      isListeningRef.current     = true;
      restartAttemptsRef.current = 0;
      if (isMountedRef.current) setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      if (!isMountedRef.current) return;
      let interim    = '';
      let final      = '';
      let totalConf  = 0;
      let finalCount = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r    = event.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          final     += text;
          let conf   = r[0].confidence;
          if (!conf || conf < 0.1) conf = 0.95;
          totalConf += conf;
          finalCount++;
        } else {
          interim += text;
        }
      }
      const fullTranscript = final + interim;
      const avgConf        = finalCount > 0 ? totalConf / finalCount : 0.9;
      setLiveTranscript(fullTranscript);
      onResultRef.current?.({ transcript: fullTranscript, confidence: avgConf, isFinal: final.length > 0 });
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (final.length > 0 && stateRef.current === 'USER_LISTENING') {
        silenceTimerRef.current = setTimeout(() => {
          if (isMountedRef.current && stateRef.current === 'USER_LISTENING' && isListeningRef.current) {
            vsmLog('SILENCE_TIMEOUT', stateRef.current, stateRef.current, 'auto-stop after final');
            _stopRecognition();
          }
        }, SILENCE_TIMEOUT_MS);
      }
    };

    recognition.onerror = (event: any) => {
      if (!isMountedRef.current) return;
      const err = event.error as string;
      vsmLog('REC_ONERROR', stateRef.current, stateRef.current, 'error=' + err);
      isStartingRef.current  = false;
      isListeningRef.current = false;
      if (isMountedRef.current) setIsListening(false);
      if (err === 'aborted') return;
      if (err === 'no-speech') { _scheduleRestart(); return; }
      if (err === 'not-allowed' || err === 'permission-denied') {
        onErrorRef.current?.('Microphone permission denied. Please allow microphone access in your browser settings.');
        _applyState('MIC_PERMISSION_DENIED', 'IDLE');
        return;
      }
      _scheduleRestart();
    };

    recognition.onend = () => {
      if (!isMountedRef.current) return;
      vsmLog('REC_ONEND', stateRef.current, stateRef.current, 'recognition ended');
      isStartingRef.current  = false;
      isListeningRef.current = false;
      if (isMountedRef.current) setIsListening(false);
      if (isMountedRef.current && stateRef.current === 'USER_LISTENING' && !isSpeakingRef.current) {
        _scheduleRestart();
      }
    };

    recognitionRef.current = recognition;
    vsmLog('INIT', 'IDLE', 'IDLE', 'SpeechRecognition ready');

    return () => {
      isMountedRef.current = false;
      _cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = lang;
      vsmLog('LANG_UPDATE', stateRef.current, stateRef.current, 'lang=' + lang);
    }
  }, [lang]);

  // =========================================================================
  // Visibility & unload cleanup
  // =========================================================================

  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        vsmLog('VISIBILITY_HIDDEN', stateRef.current, stateRef.current, 'tab hidden - pausing voice');
        _abortRecognition();
        _cancelTTS();
      }
    };
    const onUnload = () => _cleanup();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [_abortRecognition, _cancelTTS, _cleanup]);

  // =========================================================================
  // Public: speak
  // =========================================================================
  //
  // DESIGN: onEnd is NOT called inside utterance.onend.
  // It is stored in ttsCompletionRef and called from the STOP_SPEAKING
  // reducer case after stateRef has been committed to WAITING_FOR_USER.
  // This makes START_LISTENING dispatch inside onEnd always legal.
  //
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

      const allVoices = voicesRef.current.length > 0
        ? voicesRef.current
        : synthRef.current!.getVoices();
      const voice =
        allVoices.find((v) => v.name.toLowerCase().includes('samantha'))  ||
        allVoices.find((v) => v.name.toLowerCase().includes('victoria'))  ||
        allVoices.find((v) => v.name.toLowerCase().includes('karen'))     ||
        allVoices.find((v) => v.name.toLowerCase().includes('google uk english female')) ||
        allVoices.find((v) => v.name.toLowerCase().includes('google us english'))       ||
        allVoices.find((v) => v.lang === 'en-US')                         ||
        allVoices[0];

      if (voice) {
        utterance.voice = voice;
        vsmLog('TTS_VOICE', stateRef.current, stateRef.current, 'voice=' + voice.name);
      }
      utterance.rate   = 0.96;
      utterance.pitch  = 1.12;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        if (!isMountedRef.current) return;
        vsmLog('TTS_ONSTART', stateRef.current, stateRef.current, 'speech started');
        isSpeakingRef.current = true;
        if (isMountedRef.current) setIsSpeaking(true);
      };

      utterance.onend = () => {
        w._helixUtterances?.delete(utterance);
        if (!isMountedRef.current) return;
        if (activeUtteranceRef.current !== utterance) return; // stale event
        vsmLog('TTS_ONEND', stateRef.current, stateRef.current, 'speech finished - storing callback, dispatching STOP_SPEAKING');
        activeUtteranceRef.current = null;

        // Store onEnd BEFORE dispatching STOP_SPEAKING.
        // STOP_SPEAKING reducer will call it after committing WAITING_FOR_USER.
        // Do NOT call onEnd here - it would see stale state.
        ttsCompletionRef.current = onEnd ?? null;
        dispatch('STOP_SPEAKING');
      };

      utterance.onerror = (e) => {
        w._helixUtterances?.delete(utterance);
        if (!isMountedRef.current) return;
        if (e.error === 'interrupted' || e.error === 'canceled') {
          vsmLog('TTS_ONERROR', stateRef.current, stateRef.current, 'intentional ' + e.error);
          ttsCompletionRef.current = null;
          return;
        }
        vsmLog('TTS_ONERROR', stateRef.current, stateRef.current, 'error=' + e.error);
        activeUtteranceRef.current = null;
        ttsCompletionRef.current = onEnd ?? null;
        dispatch('STOP_SPEAKING');
      };

      vsmLog('TTS_SPEAK', stateRef.current, stateRef.current, '"' + text.substring(0, 60) + '..."');
      if (synthRef.current!.paused) {
        synthRef.current!.resume();
      }
      synthRef.current!.speak(utterance);
    }, TTS_STARTUP_DELAY_MS);
  }, [voiceEnabled, dispatch, _cancelTTS]);

  // =========================================================================
  // Public: convenience helpers
  // =========================================================================

  const stopSpeaking = useCallback(() => {
    vsmLog('STOP_SPEAKING_CMD', stateRef.current, stateRef.current, 'external cancel');
    _cancelTTS(); // clears ttsCompletionRef too
    if (stateRef.current === 'AI_SPEAKING') {
      dispatch('STOP_SPEAKING');
    }
  }, [_cancelTTS, dispatch]);

  const abortListening = useCallback(() => {
    vsmLog('ABORT_LISTENING_CMD', stateRef.current, stateRef.current, 'external abort');
    _abortRecognition();
  }, [_abortRecognition]);

  // =========================================================================
  // Return
  // =========================================================================

  return {
    voiceState,
    /** @deprecated Alias for voiceState - backward compat. */
    conversationState: voiceState,
    sessionStarted,
    isListening,
    isSpeaking,
    liveTranscript,
    browserCapabilities,
    dispatch,
    speak,
    stopSpeaking,
    abortListening,
  };
}
