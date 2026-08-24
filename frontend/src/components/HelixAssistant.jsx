/**
 * HelixAssistant.jsx — Helix Personal Assistant Agent
 *
 * Active ONLY when VoiceAgentContext mode === "ASSISTANT".
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Mic } from "lucide-react";
import { useVoiceAgent } from "../context/VoiceAgentContext";
import { useAuth } from "../context/AuthContext";
import { applicationsAPI } from "../services/api";
import { extractEmailFromSpeech, isValidEmail } from "../utils/emailParser";

const SILENT_PATH_PREFIXES = ["/interview", "/login", "/register"];

function getPageType(pathname) {
  if (pathname === "/" || pathname === "") return "HOME";
  if (pathname.startsWith("/dashboard")) return "DASHBOARD";
  if (pathname.startsWith("/interview")) return "INTERVIEW";
  if (pathname.startsWith("/requirements/")) return "REQUIREMENTS";
  if (pathname.startsWith("/documents/")) return "DOCUMENTS";
  if (pathname.startsWith("/review/")) return "REVIEW";
  if (pathname.startsWith("/submitted/")) return "SUBMITTED";
  if (pathname.startsWith("/login")) return "LOGIN";
  if (pathname.startsWith("/register")) return "REGISTER";
  return "OTHER";
}

function extractIdFromPath(pathname) {
  const m = pathname.match(/\/(?:requirements|documents|review|submitted)\/(\d+)/);
  return m ? m[1] : null;
}

function isSilentPath(pathname) {
  return SILENT_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

// ── Intent Detection ────────────────────────────────────────────────────────
function detectAssistantIntent(text) {
  const t = text.trim().toLowerCase().replace(/[?.!,]+$/, "");
  const len = t.split(/\s+/).length;

  if (/^(hey|hi|hello|yo)\s*(helix|there)?$/.test(t) || t === "helix") return "GREETING";
  if (/\b(sign in|sign-in|signin|log in|login|go to (sign in|login)|open (sign in|login))\b/.test(t)) return "NAVIGATE_LOGIN";
  
  if (/^(home|dashboard|go home|back|go back)$/.test(t) || (/\b(go (home|back to home|to dashboard)|(take me|navigate) (home|to dashboard)|open dashboard|check dashboard)\b/.test(t) && len <= 7)) return "NAVIGATE_DASHBOARD";
  if (/^(i (want|need|would like|'d like) to|we (want|need|plan))/.test(t)) return null;
  if (/\b(start (interview|my interview|a new interview|new project|new)|new interview|begin interview|start over)\b/.test(t)) return "START_INTERVIEW";

  // CHECK_REQUIREMENTS intent
  if (/\b(check (all )?(the )?requirements?|tick (all )?(the )?requirements?|mark everything (in|on) (the )?checklist|check (the )?requirements? box|complete (the )?checklist)\b/.test(t)) {
    return "CHECK_REQUIREMENTS";
  }

  if (/\b(requirements?|show (my )?requirements?|open requirements?|take me to requirements?|view requirements?|my requirements?)\b/.test(t)) {
    return "NAVIGATE_REQUIREMENTS";
  }

  if (/\b(documents?|docs?|show (my )?documents?|open documents?|check (my )?documents?|view documents?|my documents?)\b/.test(t)) return "NAVIGATE_DOCUMENTS";
  if (/\b(review|go to review|open review|check review)\b/.test(t) && len <= 5) return "NAVIGATE_REVIEW";
  if (/\b(report|open (my )?report|show (my )?report|view report|submitted|submission)\b/.test(t)) return "NAVIGATE_REPORT";

  if (!/^(my |i |we )/.test(t) && /\bsummar(ize|ise|y)\b/.test(t) && len <= 9) return "SUMMARY";
  if (/what (have|did) (we|you) (covered?|discussed?|collected|captured)/.test(t)) return "SUMMARY";
  if (/what (is|are) my (requirements?|project|business idea|idea|concept)/.test(t)) return "SUMMARY";
  if (/what do you know about (my|the|our) (project|business|idea)/.test(t)) return "SUMMARY";
  if (/give me a (summary|recap|overview|brief)/.test(t)) return "SUMMARY";
  if (/brief(ly)? (tell me|summarize|recap)/.test(t)) return "SUMMARY";
  if (/tell me (about|what) (we|you) (have )?discussed/.test(t)) return "SUMMARY";

  if (/what.s (ready|complete|done|finished|generated|available)/.test(t)) return "STATUS";
  if (/is (my )?(document|requirements?|report|pdf) (ready|done|available|complete|generated)/.test(t)) return "STATUS";
  if (/\bwhat.s (the )?status\b/.test(t)) return "STATUS";
  if (/what.s (been )?(completed?|done|ready)/.test(t)) return "STATUS";

  if (/\b(update|change|set|add|use|enter|give) (my )?(email|email address|e-mail|mail)\b/.test(t)) return "EMAIL_CAPTURE";
  if (len <= 7 && /\b(repeat|say (that|it) again|what did you say|say again)\b/.test(t)) return "REPEAT";

  // CHANGE_DOCUMENT_LANGUAGE
  if (/\b(change|make) (the )?(document|requirements?|report|it) (language )?(to|in)?\s+([a-zA-Z]+)\b/.test(t)) {
    return "CHANGE_DOCUMENT_LANGUAGE";
  }
  if (/\b(use|i want (this|the) (document|requirements?|it) in)\s+([a-zA-Z]+)\b/.test(t)) {
    return "CHANGE_DOCUMENT_LANGUAGE";
  }
  if (/\bchange (the )?(document|it) language\b/.test(t)) {
    return "CHANGE_DOCUMENT_LANGUAGE"; // No specific language mentioned
  }

  return null;
}

// ── Raw TTS ───────────────────────────────────────────────────────────────
function assistantRawSpeak(text, onDone) {
  if (!window.speechSynthesis) {
    onDone?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = 1.0;
  const applyVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const best =
      voices.find((v) => /google.*uk.*english.*female/i.test(v.name)) ||
      voices.find((v) => /google.*english.*female/i.test(v.name)) ||
      voices.find((v) => /google/i.test(v.name) && /en-/i.test(v.lang)) ||
      voices.find((v) => /en-/i.test(v.lang) && !v.localService) ||
      voices.find((v) => /en-/i.test(v.lang)) ||
      null;
    if (best) utter.voice = best;
  };
  applyVoice();
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.addEventListener("voiceschanged", applyVoice, { once: true });
  }

  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      onDone?.();
    }
  };
  utter.onend = finish;
  utter.onerror = (e) => {
    if (e.error === "interrupted" || e.error === "canceled") return;
    finish();
  };
  window.speechSynthesis.speak(utter);
}

export default function HelixAssistant() {
  const { mode, pageActionsRef, isSpeakerMuted } = useVoiceAgent();
  const { user, updateUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [aListening, setAListening] = useState(false);
  const [aSpeaking, setASpeaking] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const mounted = useRef(true);
  const aSpkRef = useRef(false);
  const recRef = useRef(null);
  const recRunning = useRef(false);
  const silTimer = useRef(null);
  const keepAlive = useRef(null);
  const modeRef = useRef(mode);
  const pathRef = useRef(location.pathname);
  const navigateRef = useRef(navigate);
  const userRef = useRef(user);
  const lastSpokenRef = useRef("");
  
  // Multi-turn state: { type: "EMAIL_CAPTURE" | "LANGUAGE_SELECT", ... }
  const interactionState = useRef(null);
  const handleTranscriptRef = useRef(null);
  const isMutedRef = useRef(isSpeakerMuted);

  // Sync mute ref
  useEffect(() => {
    isMutedRef.current = isSpeakerMuted;
    if (isSpeakerMuted && aSpkRef.current) {
      window.speechSynthesis?.cancel();
      setASpeaking(false);
      aSpkRef.current = false;
      setStatusText("");
    }
  }, [isSpeakerMuted]);

  // Conversation memory (ring buffer of last 8)
  const convHistory = useRef([]);
  const pushHistory = (role, text) => {
    convHistory.current.push({ role, text });
    if (convHistory.current.length > 8) convHistory.current.shift();
  };

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pathRef.current = location.pathname; }, [location.pathname]);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => { userRef.current = user; }, [user]);

  function stopMic() {
    if (silTimer.current) { clearTimeout(silTimer.current); silTimer.current = null; }
    if (keepAlive.current) { clearTimeout(keepAlive.current); keepAlive.current = null; }
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch (_) {}
    recRunning.current = false;
  }

  function startMic() {
    if (!mounted.current || modeRef.current !== "ASSISTANT" || isSilentPath(pathRef.current) || aSpkRef.current) return;
    if (recRunning.current) return;
    setLiveText("");
    try { recRef.current.start(); } catch (e) { recRunning.current = false; }
  }

  function scheduleRestart(delay = 400) {
    if (keepAlive.current) clearTimeout(keepAlive.current);
    keepAlive.current = setTimeout(() => {
      if (mounted.current && modeRef.current === "ASSISTANT" && !aSpkRef.current) startMic();
    }, delay);
  }

  const speak = useCallback((text, onDone) => {
    if (!mounted.current) return;
    
    if (isMutedRef.current) {
      setTimeout(() => onDone?.(), 10);
      return;
    }

    stopMic();
    setASpeaking(true);
    setIsProcessing(false);
    aSpkRef.current = true;
    lastSpokenRef.current = text;
    pushHistory("assistant", text);
    setStatusText(text.length > 70 ? text.slice(0, 70) + "..." : text);

    assistantRawSpeak(text, () => {
      if (!mounted.current) return;
      setASpeaking(false);
      aSpkRef.current = false;
      setStatusText("");
      onDone?.();
    });
  }, []);

  const executeAction = useCallback(async (actionName, params = {}, confirmationMsg, errMsg) => {
    setIsProcessing(true);
    setAListening(false);
    try {
      const actions = pageActionsRef.current || {};
      if (actions[actionName]) {
        await actions[actionName](params);
        speak(confirmationMsg, startMic);
      } else {
        speak(errMsg || "I can't do that on this page.", startMic);
      }
    } catch (err) {
      speak("Sorry, I encountered an error performing that action.", startMic);
    }
  }, [speak, pageActionsRef]);

  const handleTranscript = useCallback((text) => {
    if (!mounted.current || modeRef.current !== "ASSISTANT" || isSilentPath(pathRef.current)) return;

    pushHistory("user", text);
    const page = getPageType(pathRef.current);
    const pageId = extractIdFromPath(pathRef.current);
    const firstName = (userRef.current?.full_name || "").trim().split(/\s+/)[0] || null;

    // ── Multi-turn Intercepts ───────────────────────────────────────────────
    if (interactionState.current) {
      const st = interactionState.current;

      if (st.type === "EMAIL_CAPTURE" && st.state === "PROMPTED") {
        const email = extractEmailFromSpeech(text);
        if (email && isValidEmail(email)) {
          interactionState.current = { type: "EMAIL_CAPTURE", state: "CONFIRMING", candidate: email };
          speak(`I heard ${email}. Is that correct? Say yes to confirm or no to try again.`, startMic);
        } else {
          speak(`I couldn't parse that as an email. Try saying something like "yokesh at gmail dot com".`, startMic);
        }
        return;
      }

      if (st.type === "EMAIL_CAPTURE" && st.state === "CONFIRMING") {
        const t = text.toLowerCase();
        if (/\b(yes|yeah|correct|right|yep|confirmed?|that.s (right|it|correct)|absolutely|sure)\b/.test(t)) {
          const email = st.candidate;
          interactionState.current = null;
          // Action verification + confirm
          updateUser({ email });
          speak(`Got it. I've updated your email address to ${email}.`, startMic);
        } else if (/\b(no|nope|wrong|incorrect|that.s wrong|not right|actually)\b/.test(t)) {
          interactionState.current = { type: "EMAIL_CAPTURE", state: "PROMPTED" };
          speak(`Let's try again. What email address would you like to use?`, startMic);
        } else {
          speak(`Just say yes to confirm ${st.candidate}, or no to try again.`, startMic);
        }
        return;
      }

      if (st.type === "LANGUAGE_SELECT") {
        interactionState.current = null;
        executeAction("changeLanguage", { language: text.trim() }, `I've changed the document language to ${text.trim()}.`);
        return;
      }
    }

    // ── Intent Handling ─────────────────────────────────────────────────────
    const intent = detectAssistantIntent(text);

    switch (intent) {
      case "GREETING":
        speak(firstName ? `Hey ${firstName}! I'm here. What would you like to do?` : `Hey! I'm Helix. What would you like to do?`, startMic);
        break;

      case "NAVIGATE_LOGIN":
        speak("Taking you to sign in.", () => navigateRef.current("/login"));
        break;

      case "NAVIGATE_DASHBOARD":
        if (userRef.current) {
          speak("Sure, navigating to your dashboard.", () => navigateRef.current("/dashboard"));
        } else {
          sessionStorage.setItem("pendingNavigation", "/dashboard");
          speak("You're not signed in yet. I'll take you to sign in first.", () => navigateRef.current("/login"));
        }
        break;

      case "START_INTERVIEW":
        speak("Starting a new interview now.", () => navigateRef.current("/interview"));
        break;

      case "NAVIGATE_REQUIREMENTS":
        if (pageId) {
          speak("Sure, navigating to your requirements.", () => navigateRef.current(`/requirements/${pageId}`));
        } else {
          speak("Which project would you like to open? I'd need a specific project to navigate there.", startMic);
        }
        break;

      case "NAVIGATE_DOCUMENTS":
        if (pageId) {
          speak("Sure, opening your documents.", () => navigateRef.current(`/documents/${pageId}`));
        } else {
          speak("Which project's documents would you like to open? I'd need a specific project.", startMic);
        }
        break;

      case "NAVIGATE_REVIEW":
        if (pageId) {
          speak("Sure, taking you to the review page.", () => navigateRef.current(`/review/${pageId}`));
        } else {
          speak("Which project's review would you like to open?", startMic);
        }
        break;

      case "NAVIGATE_REPORT":
        if (pageId) {
          speak("Sure, opening your report.", () => navigateRef.current(`/submitted/${pageId}`));
        } else {
          speak("Which project's report would you like to view?", startMic);
        }
        break;

      case "SUMMARY":
        if (pageId) {
          (async () => {
            setIsProcessing(true);
            try {
              const res = await applicationsAPI.getOne(pageId);
              const app = res.data;
              const idea = app.business_description || app.industry || "your business concept";
              speak(`Here's a quick summary. Your project is about ${idea}. Current status is ${app.status || "in progress"}.`, startMic);
            } catch (_) {
              speak("I had trouble fetching the project details.", startMic);
            }
          })();
        } else {
          speak("Navigate to a specific project first to get a summary.", startMic);
        }
        break;

      case "STATUS":
        if (pageId) {
          (async () => {
            setIsProcessing(true);
            try {
              const res = await applicationsAPI.getOne(pageId);
              const app = res.data;
              let msg = `Your project status is ${app.status || "in progress"}.`;
              if (app.requirements_data) msg += " Requirements have been captured.";
              speak(msg, startMic);
            } catch (_) {
              speak("I couldn't fetch the status right now.", startMic);
            }
          })();
        } else {
          speak("Navigate to a specific project to check its status.", startMic);
        }
        break;

      case "EMAIL_CAPTURE":
        interactionState.current = { type: "EMAIL_CAPTURE", state: "PROMPTED" };
        speak("Sure. What email address would you like to use?", startMic);
        break;

      case "CHANGE_DOCUMENT_LANGUAGE": {
        const m1 = text.match(/\b(?:change|make)\s+(?:the\s+)?(?:document|requirements?|report|it)\s+(?:language\s+)?(?:to|in)?\s+([a-zA-Z]+)\b/i);
        const m2 = text.match(/\b(?:use|i want (?:this|the) (?:document|requirements?|it) in)\s+([a-zA-Z]+)\b/i);
        let lang = (m1 && m1[1]) || (m2 && m2[1]);
        
        // Also check if text just says "change to Tamil"
        if (!lang) {
            const fallback = text.match(/\b(?:change|make) (?:it )?(?:to|in) ([a-zA-Z]+)\b/i);
            if (fallback) lang = fallback[1];
        }

        if (lang) {
          executeAction("changeLanguage", { language: lang }, `I've changed the document language to ${lang}.`, "I can't change the document language on this page.");
        } else {
          interactionState.current = { type: "LANGUAGE_SELECT" };
          speak("Sure. Which language would you like?", startMic);
        }
        break;
      }

      case "CHECK_REQUIREMENTS":
        executeAction("checkRequirements", {}, "Done. I've checked the completed requirements.", "I can't check requirements on this page.");
        break;

      case "REPEAT":
        speak(lastSpokenRef.current || "I don't have anything recent to repeat.", startMic);
        break;

      default:
        // Contextual pronoun resolution fallback
        if (/\b(it|that|this)\b/i.test(text)) {
           // If on requirements page and user says "change it to Tamil", we can infer context.
           if (page === "REQUIREMENTS" && /\b(change|make|translate) (it|that|this) (to|in) ([a-zA-Z]+)\b/i.test(text)) {
              const m = text.match(/\b(change|make|translate) (it|that|this) (to|in) ([a-zA-Z]+)\b/i);
              const lang = m[4];
              executeAction("changeLanguage", { language: lang }, `I've changed the document language to ${lang}.`, "I can't change the document language on this page.");
              return;
           }
        }
        setLiveText("");
        scheduleRestart(200);
        break;
    }
  }, [speak, executeAction, updateUser]);

  handleTranscriptRef.current = handleTranscript;

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recRef.current = rec;

    rec.onstart = () => {
      recRunning.current = true;
      if (mounted.current) setAListening(true);
    };

    rec.onresult = (e) => {
      // ── BARGE-IN LOGIC ──────────────────────────────────────────────────────
      // If the user speaks while Agent 2 is talking, immediately cancel TTS.
      if (aSpkRef.current) {
        window.speechSynthesis?.cancel();
        setASpeaking(false);
        aSpkRef.current = false;
        setStatusText("");
      }

      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const full = (final + interim).trim();
      if (mounted.current) setLiveText(full);

      if (final.trim()) {
        const captured = final.trim();
        if (silTimer.current) clearTimeout(silTimer.current);
        silTimer.current = setTimeout(() => {
          if (!mounted.current || modeRef.current !== "ASSISTANT" || aSpkRef.current) return;
          setLiveText("");
          handleTranscriptRef.current?.(captured);
        }, 1200); // Shorter pause for snappier response
      }
    };

    rec.onerror = (e) => {
      recRunning.current = false;
      if (mounted.current) setAListening(false);
      if (e.error === "not-allowed") return;
      if (e.error !== "aborted") scheduleRestart(1000);
    };

    rec.onend = () => {
      recRunning.current = false;
      if (mounted.current) setAListening(false);
      if (mounted.current && modeRef.current === "ASSISTANT" && !aSpkRef.current && !isSilentPath(pathRef.current)) {
        scheduleRestart(400);
      }
    };

    return () => {
      mounted.current = false;
      try { rec.abort(); } catch (_) {}
      if (silTimer.current) clearTimeout(silTimer.current);
      if (keepAlive.current) clearTimeout(keepAlive.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (mode !== "ASSISTANT" || isSilentPath(location.pathname)) {
      window.speechSynthesis?.cancel();
      stopMic();
      if (mounted.current) {
        setASpeaking(false);
        aSpkRef.current = false;
        interactionState.current = null;
        setLiveText("");
      }
      return;
    }
    scheduleRestart(500);
  }, [mode, location.pathname]);

  if (isSilentPath(location.pathname) || mode !== "ASSISTANT") return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 select-none pointer-events-none">
      {aSpeaking && statusText && (
        <div className="pointer-events-none bg-white/95 backdrop-blur-sm border border-indigo-100 rounded-2xl px-4 py-3 shadow-lg max-w-[280px]">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3 h-3 text-indigo-500 flex-shrink-0" />
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Helix</span>
          </div>
          <p className="text-xs text-gray-700 leading-relaxed">{statusText}</p>
        </div>
      )}

      {aListening && liveText && !aSpeaking && (
        <div className="pointer-events-none bg-white/90 backdrop-blur-sm border border-purple-100 rounded-2xl px-4 py-2 shadow-md max-w-[260px]">
          <p className="text-xs text-gray-400 italic leading-relaxed">{liveText}</p>
        </div>
      )}

      <button
        className={[
          "w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 cursor-pointer pointer-events-auto",
          isProcessing ? "bg-indigo-400 shadow-indigo-200" :
          aSpeaking ? "bg-indigo-600 shadow-indigo-200 scale-110" :
          aListening ? "bg-purple-600 shadow-purple-200" :
          "bg-white border-2 border-indigo-200 hover:border-indigo-400 hover:shadow-indigo-100",
        ].join(" ")}
        onClick={() => {
          if (aSpeaking) window.speechSynthesis?.cancel();
          else if (aListening) stopMic();
          else scheduleRestart(100);
        }}
      >
        {isProcessing ? <Sparkles className="w-5 h-5 text-white animate-spin" /> :
         aSpeaking ? <Sparkles className="w-5 h-5 text-white animate-pulse" /> :
         aListening ? <Mic className="w-5 h-5 text-white animate-pulse" /> :
         <Sparkles className="w-5 h-5 text-indigo-400" />}
      </button>
    </div>
  );
}
