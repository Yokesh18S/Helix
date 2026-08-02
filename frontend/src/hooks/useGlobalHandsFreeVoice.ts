import { useEffect, useCallback } from 'react';
import { useVoiceRecognition } from './useVoiceRecognition';

export function useGlobalHandsFreeVoice(commands: Record<string, () => void>, active: boolean = true) {
  const handleResult = useCallback((result: any) => {
    if (!result.isFinal) return;
    const text = result.transcript.toLowerCase().trim();
    console.log('[HandsFree] Heard:', text);
    
    for (const [phrase, action] of Object.entries(commands)) {
      if (text.includes(phrase.toLowerCase())) {
        console.log(`[HandsFree] Matching command "${phrase}" triggered!`);
        action();
        return;
      }
    }
  }, [commands]);

  const { startListening, stopListening, isListening } = useVoiceRecognition({
    onResult: handleResult
  });

  useEffect(() => {
    if (!active) {
      stopListening();
      return;
    }

    startListening();
    const interval = setInterval(() => {
      if (!isListening && active) {
        try { startListening(); } catch (e) {}
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      stopListening();
    };
  }, [active, isListening, startListening, stopListening]);

  return { isListening };
}
