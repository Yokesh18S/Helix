/**
 * useGlobalHandsFreeVoice
 *
 * Listens for voice commands on any page. Uses a single recognition instance
 * from useVoiceRecognition. Recognition is restarted purely event-driven
 * (via the isListening dependency in useEffect) — no polling intervals.
 *
 * Rules:
 *  - Only starts when active=true AND isSpeaking=false.
 *  - Restarts are triggered by isListening transitioning to false (onend/onerror),
 *    NOT by a polling setInterval.
 *  - isMountedRef prevents any state updates or start() calls after unmount.
 */
import { useEffect, useCallback, useRef } from 'react';
import { useVoiceRecognition } from './useVoiceRecognition';

export function useGlobalHandsFreeVoice(
  commands: Record<string, () => void>,
  active: boolean = true,
  isSpeaking: boolean = false,
) {
  const isMountedRef = useRef(true);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const handleResult = useCallback((result: any) => {
    if (!result.isFinal) return;
    if (!isMountedRef.current) return;
    const text = result.transcript.toLowerCase().trim();
    console.log('[HandsFree] Heard:', text);
    for (const [phrase, action] of Object.entries(commandsRef.current)) {
      if (text.includes(phrase.toLowerCase())) {
        console.log(`[HandsFree] Command matched: "${phrase}"`);
        action();
        return;
      }
    }
  }, []);

  const { startListening, stopListening, isListening } = useVoiceRecognition({
    onResult: handleResult,
  });

  const startListeningRef = useRef(startListening);
  const stopListeningRef = useRef(stopListening);
  startListeningRef.current = startListening;
  stopListeningRef.current = stopListening;

  // Event-driven restart: when active=true and isListening transitions to false
  // (caused by onend/onerror inside useVoiceRecognition), restart recognition.
  // This replaces the old polling setInterval.
  useEffect(() => {
    if (!isMountedRef.current) return;

    if (!active || isSpeaking) {
      stopListeningRef.current();
      return;
    }

    // Recognition is not currently running — start it.
    if (!isListening) {
      console.log('[HandsFree] Starting/restarting recognition (event-driven).');
      startListeningRef.current();
    }

    return () => {
      // When deactivated, stop cleanly.
      if (!active) {
        stopListeningRef.current();
      }
    };
  }, [active, isListening, isSpeaking]);

  // Full stop on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      stopListeningRef.current();
    };
  }, []);

  return { isListening };
}
