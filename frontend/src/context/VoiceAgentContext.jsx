/**
 * VoiceAgentContext.jsx
 *
 * Central authority for:
 *  1. Voice mode ownership (INTERVIEW vs ASSISTANT)
 *  2. Page action registry — pages register their callable actions so the
 *     assistant can invoke them without prop drilling.
 *
 * pageActionsRef pattern:
 *  - Pages write to pageActionsRef.current on every render (no dep array).
 *  - HelixAssistant reads pageActionsRef.current when executing actions.
 *  - Using a ref (not state) ensures zero re-renders from page action updates.
 */
import { createContext, useContext, useState, useRef, useCallback } from "react";

const VoiceAgentContext = createContext(null);

export function VoiceAgentProvider({ children }) {
  const [mode, setMode] = useState("ASSISTANT");
  const [isSpeakerMuted, setSpeakerMuted] = useState(false);
  const modeRef = useRef("ASSISTANT");

  // pages write their callable actions here on every render
  const pageActionsRef = useRef({});

  const applyMode = useCallback((m) => {
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    modeRef.current = m;
    setMode(m);
    console.log("[VoiceAgent] mode ->", m);
  }, []);

  const activateInterviewAgent  = useCallback(() => applyMode("INTERVIEW"),  [applyMode]);
  const deactivateInterviewAgent = useCallback(() => applyMode("ASSISTANT"), [applyMode]);
  const releaseVoice             = useCallback(() => applyMode("ASSISTANT"), [applyMode]);

  return (
    <VoiceAgentContext.Provider value={{
      mode, modeRef,
      applyMode,
      activateInterviewAgent, deactivateInterviewAgent, releaseVoice,
      pageActionsRef,
      isSpeakerMuted,
      setSpeakerMuted
    }}>
      {children}
    </VoiceAgentContext.Provider>
  );
}

export function useVoiceAgent() {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) {
    return {
      mode: "ASSISTANT",
      modeRef: { current: "ASSISTANT" },
      activateInterviewAgent: () => {},
      deactivateInterviewAgent: () => {},
      releaseVoice: () => {},
      pageActionsRef: { current: {} },
      isSpeakerMuted: false,
      setSpeakerMuted: () => {},
    };
  }
  return ctx;
}
