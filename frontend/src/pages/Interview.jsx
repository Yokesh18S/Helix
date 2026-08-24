/**
 * Interview.jsx — Helix Voice Interview (Controlled Pipeline)
 *
 * FLOW:
 *  Phase 1 — IDENTITY: Collect name + phone via browser speech (or text).
 *             Uses /api/interview/parse-profile (Gemini). Vapi does NOT start yet.
 *  Phase 2 — VAPI: Business interview via Vapi. 6-10 questions.
 *             Every answer is saved + extracted live via saveInterviewAnswer tool.
 *  Phase 3 — OTP: completeInterview fires → frontend calls authAPI.initiateOtp
 *             → OTP modal shown → on success → navigate('/dashboard').
 *
 * Universal speech: prefers webkitSpeechRecognition/SpeechRecognition;
 * gracefully falls back to text-input on unsupported browsers.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { applicationsAPI, interviewAPI, requirementsAPI, authAPI } from '../services/api';
import VapiLib from '@vapi-ai/web';
import toast from 'react-hot-toast';
import {
  Mic, MicOff, PhoneOff, Volume2, VolumeX, RotateCcw,
  Sparkles, ArrowRight, CheckCircle2, Circle, MinusCircle,
  Send, X, Loader2, Mail, ShieldCheck, Tag, User, Phone
} from 'lucide-react';
import AiProcessingWaveform from '../components/AiProcessingWaveform';
import { extractEmailFromSpeech, isValidEmail } from '../utils/emailParser';

// ── Safe Vapi constructor (ESM/CJS interop) ───────────────────────────────────
const Vapi = VapiLib?.default ?? VapiLib;

// ── Credentials from .env — ONLY public key goes here ────────────────────────
const VAPI_PUBLIC_KEY   = import.meta.env.VITE_VAPI_PUBLIC_KEY;
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID;
const API_BASE          = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Guest token ────────────────────────────────────────────────────────────────
function getOrCreateGuestToken() {
  let t = localStorage.getItem('helix_guest_token');
  if (!t) {
    t = (typeof crypto?.randomUUID === 'function')
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('helix_guest_token', t);
  }
  return t;
}

// ── Universal SpeechRecognition (Chrome, Edge, Safari, Firefox polyfill) ──────
const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
    : null;

function createRecognizer() {
  if (!SpeechRecognitionAPI) return null;
  try {
    const r = new SpeechRecognitionAPI();
    r.continuous = false;
    r.interimResults = true;
    r.lang = 'en-US';
    return r;
  } catch (_) {
    return null;
  }
}

// ── Navigation intent detection ───────────────────────────────────────────────
function detectNavIntent(text) {
  const t = (text || '').toLowerCase().trim();
  if (/\b(go\s*(to\s*)?(home|landing)|back\s*to\s*home|take\s*me\s*home)\b/.test(t)) return 'HOME';
  if (/\b(go\s*(to\s*)?dashboard|open\s*dashboard|take\s*me\s*to\s*dashboard|check\s*dashboard)\b/.test(t)) return 'DASHBOARD';
  if (/\b(sign\s*(in|up)|log\s*(in|out)|login|go\s*to\s*(sign\s*in|login))\b/.test(t)) return 'LOGIN';
  if (/\b(go\s*(to\s*)?requirements?|open\s*requirements?|show\s*(my\s*)?requirements?|view\s*requirements?)\b/.test(t)) return 'REQUIREMENTS';
  if (/\b(go\s*(to\s*)?documents?|open\s*documents?|show\s*(my\s*)?documents?)\b/.test(t)) return 'DOCUMENTS';
  if (/\b(exit|leave|go\s*back|cancel\s*interview|stop\s*interview|end\s*interview)\b/.test(t)) return 'EXIT';
  return null;
}

// ── OTP Modal ─────────────────────────────────────────────────────────────────
function OtpModal({ phone, name, simOtp, onSuccess, onClose }) {
  const [otp, setOtp]       = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithOtp }     = useAuth();

  const handleVerify = async () => {
    if (otp.length !== 6) { toast.error('Please enter a 6-digit OTP'); return; }
    setLoading(true);
    try {
      const res = await authAPI.verifyOtp({ phone, otp_code: otp });
      const { access_token, user: userData } = res.data;
      loginWithOtp(access_token, userData);
      toast.success('Signed in successfully!');
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid OTP. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-3xl p-8 bg-white shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Verify your number</h2>
          {phone && <p className="text-sm text-gray-500 mt-1">Code sent to <strong>{phone}</strong></p>}
          {name  && <p className="text-sm text-gray-400">Welcome, {name}!</p>}
        </div>

        {simOtp && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2.5 text-xs text-center">
            <span className="font-semibold block mb-0.5">Dev Mode OTP</span>
            <span className="font-mono font-bold text-base">{simOtp}</span>
          </div>
        )}

        <input
          type="text" inputMode="numeric" maxLength={6}
          value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="w-full text-center text-3xl font-bold tracking-[0.5em] px-4 py-4 rounded-2xl border-2 border-indigo-200 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all"
          onKeyDown={e => e.key === 'Enter' && handleVerify()}
          autoFocus
        />

        <button
          onClick={handleVerify} disabled={loading || otp.length !== 6}
          className="w-full mt-4 py-3.5 rounded-2xl font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: otp.length === 6 ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#d1d5db' }}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Verify & Sign In'}
        </button>
        <button onClick={onClose} className="w-full mt-3 py-2.5 rounded-2xl text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Identity Collection Phase UI ──────────────────────────────────────────────
function IdentityPhase({
  identityPhase, identityPrompt, identityInput, setIdentityInput,
  identityListening, identityError, onSubmitText, capturedName, capturedPhone,
  hasSpeechSupport
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      {/* Avatar */}
      <div className="relative w-28 h-28 mb-6">
        <div className={`absolute inset-0 rounded-full transition-all duration-500 ${
          identityListening ? 'ring-8 ring-green-300/50 ring-offset-4 ring-offset-[#F6F7FE]' : ''
        }`} />
        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-600 flex items-center justify-center shadow-2xl">
          {identityPhase === 'name'
            ? <User className={`w-10 h-10 text-white ${identityListening ? 'animate-pulse' : ''}`} />
            : <Phone className={`w-10 h-10 text-white ${identityListening ? 'animate-pulse' : ''}`} />
          }
        </div>
      </div>

      <p className="text-sm font-bold text-indigo-600 tracking-wider uppercase mb-2">Helix AI</p>

      {/* Helix prompt bubble */}
      <div className="bg-white border border-[#D4DCE8] rounded-2xl shadow-sm px-6 py-4 mb-6 max-w-md w-full" style={{ borderLeft: '3px solid #6366f1' }}>
        <p className="text-base font-medium text-gray-900 leading-relaxed">{identityPrompt}</p>
      </div>

      {/* Captured so far */}
      {(capturedName || capturedPhone) && (
        <div className="flex gap-3 mb-4 flex-wrap justify-center">
          {capturedName  && <span className="bg-green-50 border border-green-200 text-green-700 rounded-full px-3 py-1 text-xs font-medium">✓ {capturedName}</span>}
          {capturedPhone && <span className="bg-blue-50 border border-blue-200 text-blue-700 rounded-full px-3 py-1 text-xs font-medium">✓ {capturedPhone}</span>}
        </div>
      )}

      {/* Listening indicator */}
      {identityListening && (
        <div className="flex items-center gap-2 mb-4 text-green-600 font-medium text-sm">
          <div className="flex items-end gap-[2px] h-5">
            {[3,6,9,5,8].map((h, i) => (
              <div key={i} style={{
                width: 3, height: `${h * 3}px`, backgroundColor: '#10b981', borderRadius: 4,
                animation: `pulse 0.7s ease-in-out ${i * 0.1}s infinite alternate`
              }} />
            ))}
          </div>
          <span>Listening...</span>
        </div>
      )}

      {/* Error */}
      {identityError && (
        <p className="text-red-500 text-sm mb-3">{identityError}</p>
      )}

      {/* Text input fallback (always shown for universal support) */}
      <div className="w-full max-w-md flex gap-2">
        <input
          type={identityPhase === 'phone' ? 'tel' : 'text'}
          value={identityInput}
          onChange={e => setIdentityInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmitText(); }}
          placeholder={
            identityPhase === 'name'  ? 'Type your name...' :
            identityPhase === 'phone' ? 'Type your phone number...' :
            'Processing...'
          }
          className="flex-1 rounded-full border border-gray-200 bg-white px-5 py-3 text-sm text-gray-800 placeholder:text-gray-400 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          maxLength={identityPhase === 'phone' ? 15 : 60}
          autoFocus
        />
        <button
          onClick={onSubmitText}
          disabled={!identityInput.trim()}
          className="w-12 h-12 rounded-full flex items-center justify-center bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors flex-shrink-0"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {hasSpeechSupport && (
        <p className="text-xs text-gray-400 mt-3">
          {identityListening ? 'Speak now — or type above' : 'You can also type your answer above'}
        </p>
      )}
    </div>
  );
}


// ── Main Interview Component ───────────────────────────────────────────────────
export default function Interview() {
  const { user, loginWithOtp } = useAuth();
  const navigate = useNavigate();

  // ── PHASE state ──────────────────────────────────────────────────────────────
  // 'identity' | 'vapi_starting' | 'vapi_active' | 'complete' | 'otp' | 'done'
  const [interviewPhase, setInterviewPhase] = useState('identity');

  // ── Identity collection state ────────────────────────────────────────────────
  const [identityPhase,    setIdentityPhase]    = useState('name'); // 'name'|'phone'|'done'
  const [identityPrompt,   setIdentityPrompt]   = useState("Welcome to Helix! Before we begin your business interview, could you please tell me your full name?");
  const [identityInput,    setIdentityInput]    = useState('');
  const [identityListening, setIdentityListening] = useState(false);
  const [identityError,    setIdentityError]    = useState('');
  const [capturedName,     setCapturedName]     = useState('');
  const [capturedPhone,    setCapturedPhone]    = useState('');
  const [identityProcessing, setIdentityProcessing] = useState(false);

  // ── Vapi / interview state ───────────────────────────────────────────────────
  const [callStatus,      setCallStatus]      = useState('initializing');
  const [isSpeaking,      setIsSpeaking]      = useState(false);
  const [isListening,     setIsListening]     = useState(false);
  const [isMuted,         setIsMuted]         = useState(false);
  const [liveTranscript,  setLiveTranscript]  = useState('');
  const [currentSpeech,   setCurrentSpeech]   = useState('');
  const [typedText,       setTypedText]       = useState('');
  const [processing,      setProcessing]      = useState(false);
  const [procStep,        setProcStep]        = useState('');
  const [errorMsg,        setErrorMsg]        = useState('');
  const [appId,           setAppId]           = useState(null);
  const [callDuration,    setCallDuration]    = useState(0);
  const [collectedEmail,  setCollectedEmail]  = useState('');
  const [detectedDomain,  setDetectedDomain]  = useState('');

  // Coverage / extractions
  const [coverage,      setCoverage]      = useState({ overall_percent: 0, collected_fields: [], missing_fields: [], checklist: [], domain_label: null });
  const [extractions,   setExtractions]   = useState([]);
  const [totalCaptured, setTotalCaptured] = useState(0);
  const [answers,       setAnswers]       = useState({});
  const [currentQ,      setCurrentQ]      = useState(1);
  const [currentQText,  setCurrentQText]  = useState('');
  const [lockedLang,    setLockedLang]    = useState('English');
  const [questionsAnswered, setQuestionsAnswered] = useState(0);

  // OTP modal
  const [showOtp,  setShowOtp]  = useState(false);
  const [otpPhone, setOtpPhone] = useState('');
  const [otpName,  setOtpName]  = useState('');
  const [simOtp,   setSimOtp]   = useState('');

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const vapiRef          = useRef(null);
  const appIdRef         = useRef(null);
  const mounted          = useRef(true);
  const hasVapiStarted   = useRef(false);
  const callTimer        = useRef(null);
  const guestToken       = useRef(getOrCreateGuestToken());
  const ansCountRef      = useRef(0);
  const currentQRef      = useRef(1);
  const capturedNameRef  = useRef('');
  const capturedPhoneRef = useRef('');
  const recognizerRef    = useRef(null);
  const identityPhaseRef = useRef('name');

  // Keep refs in sync with state
  useEffect(() => { appIdRef.current       = appId; },          [appId]);
  useEffect(() => { currentQRef.current    = currentQ; },       [currentQ]);
  useEffect(() => { capturedNameRef.current  = capturedName; },  [capturedName]);
  useEffect(() => { capturedPhoneRef.current = capturedPhone; }, [capturedPhone]);
  useEffect(() => { identityPhaseRef.current = identityPhase; }, [identityPhase]);

  const hasSpeechSupport = !!SpeechRecognitionAPI;

  // ── Format duration ──────────────────────────────────────────────────────────
  const formatDuration = s => {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // ── Create guest application on mount ────────────────────────────────────────
  useEffect(() => {
    async function createApp() {
      try {
        const appRes = await applicationsAPI.createGuest(guestToken.current);
        if (!mounted.current) return;
        const aid = appRes.data.id;
        setAppId(aid);
        appIdRef.current = aid;
        localStorage.setItem('helix_pending_app_id',    String(aid));
        localStorage.setItem('helix_pending_guest_token', guestToken.current);
        console.log('[Identity] Guest application created:', aid);
      } catch (err) {
        console.error('[Identity] Failed to create guest application:', err);
        toast.error('Failed to start session. Please refresh.');
      }
    }
    createApp();
    return () => { mounted.current = false; };
  }, []);

  // ── Start speech recognition for identity phase ───────────────────────────────
  useEffect(() => {
    if (interviewPhase !== 'identity') return;
    if (!hasSpeechSupport) return; // text-only fallback

    startIdentityListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewPhase, identityPhase]);

  function startIdentityListening() {
    if (!hasSpeechSupport) return;

    // Stop any existing recognizer
    if (recognizerRef.current) {
      try { recognizerRef.current.abort(); } catch (_) {}
    }

    const rec = createRecognizer();
    if (!rec) return;
    recognizerRef.current = rec;

    let finalResult = '';

    rec.onstart = () => {
      if (mounted.current) {
        setIdentityListening(true);
        setIdentityError('');
      }
    };

    rec.onresult = (e) => {
      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) {
        finalResult = final.trim();
        setIdentityInput(finalResult);
      } else if (interim) {
        setIdentityInput(interim.trim());
      }
    };

    rec.onerror = (e) => {
      console.warn('[Identity Speech] error:', e.error);
      if (mounted.current) {
        setIdentityListening(false);
        if (e.error === 'not-allowed') {
          setIdentityError('Microphone access denied. Please type your answer below.');
        }
        // other errors: just fall back to text
      }
    };

    rec.onend = () => {
      if (mounted.current) {
        setIdentityListening(false);
        if (finalResult.trim()) {
          handleIdentitySubmit(finalResult.trim());
        }
      }
    };

    try { rec.start(); } catch (_) {}
  }

  // ── Call parse-profile API with user input ────────────────────────────────────
  const handleIdentitySubmit = useCallback(async (inputOverride) => {
    const rawInput = (inputOverride ?? identityInput).trim();
    if (!rawInput || identityProcessing) return;

    const currentPhase = identityPhaseRef.current;
    const currentName  = capturedNameRef.current;
    const currentPhone = capturedPhoneRef.current;
    const aid          = appIdRef.current;

    console.log(`[Identity] Submitting for phase="${currentPhase}" input="${rawInput}"`);
    setIdentityProcessing(true);
    setIdentityError('');
    setIdentityInput('');

    // Stop recognizer during API call
    if (recognizerRef.current) {
      try { recognizerRef.current.abort(); } catch (_) {}
    }
    setIdentityListening(false);

    try {
      const payload = {
        user_transcript: rawInput,
        current_phase:   currentPhase,
        current_name:    currentName,
        current_phone:   currentPhone,
        application_id:  aid,
      };
      const res = await interviewAPI.parseProfile(payload);
      const data = res.data;
      console.log('[Identity] parse-profile response:', data);

      const newName  = data.updated_name  || currentName;
      const newPhone = data.updated_phone || currentPhone;
      const nextPhase = data.next_phase || currentPhase;
      const nextPrompt = data.next_question || '';

      // Update captured identity
      if (newName)  { setCapturedName(newName);   capturedNameRef.current  = newName; }
      if (newPhone) { setCapturedPhone(newPhone);  capturedPhoneRef.current = newPhone; }

      if (nextPhase === 'questions') {
        // Both name and phone confirmed — start Vapi
        console.log('[Identity] COMPLETE. Starting Vapi interview...');
        toast.success(`Welcome, ${newName}! Starting your business interview.`);
        setInterviewPhase('vapi_starting');
        startVapiInterview(newName, newPhone);
      } else {
        // Still need more info
        setIdentityPhase(nextPhase);
        identityPhaseRef.current = nextPhase;
        setIdentityPrompt(nextPrompt || (nextPhase === 'phone'
          ? `Thank you, ${newName}! What is your 10-digit phone number?`
          : 'Could you please tell me your name?'));
        setIdentityProcessing(false);
        // Restart listening
        setTimeout(() => { if (mounted.current) startIdentityListening(); }, 300);
      }
    } catch (err) {
      console.error('[Identity] parse-profile error:', err);
      setIdentityError('Could not process that. Please try again.');
      setIdentityProcessing(false);
      setTimeout(() => { if (mounted.current) startIdentityListening(); }, 500);
    }
  }, [identityInput, identityProcessing]);

  // Text submit handler for identity phase
  const onIdentityTextSubmit = useCallback(() => {
    handleIdentitySubmit(identityInput);
  }, [handleIdentitySubmit, identityInput]);

  // ── Start Vapi interview ──────────────────────────────────────────────────────
  async function startVapiInterview(name, phone) {
    if (hasVapiStarted.current) return;
    hasVapiStarted.current = true;

    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) {
      const missing = !VAPI_PUBLIC_KEY ? 'VITE_VAPI_PUBLIC_KEY' : 'VITE_VAPI_ASSISTANT_ID';
      setErrorMsg(`Configuration error: ${missing} not set.`);
      setCallStatus('error');
      setInterviewPhase('vapi_active');
      return;
    }

    const aid = appIdRef.current;
    setCallStatus('connecting');
    setInterviewPhase('vapi_active');

    try {
      const vapi = new Vapi(VAPI_PUBLIC_KEY);
      vapiRef.current = vapi;

      // ── Vapi event listeners ──────────────────────────────────────────────────
      vapi.on('call-start', () => {
        if (!mounted.current) return;
        console.log('[Vapi] call-start');
        setCallStatus('active');
        setIsListening(true);
        setIsSpeaking(false);
        let secs = 0;
        callTimer.current = setInterval(() => {
          if (mounted.current) setCallDuration(++secs);
        }, 1000);
      });

      vapi.on('call-end', () => {
        if (!mounted.current) return;
        console.log('[Vapi] call-end');
        if (callTimer.current) clearInterval(callTimer.current);
        setIsListening(false);
        setIsSpeaking(false);

        setCallStatus(prev => {
          if (prev === 'complete') return 'complete';
          // Fallback: generate requirements if Vapi didn't call completeInterview
          const aid2 = appIdRef.current;
          if (aid2) {
            console.log('[Vapi] call-end fallback — calling /api/vapi/complete-interview');
            fetch(`${API_BASE}/api/vapi/complete-interview`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ application_id: aid2 }),
            })
              .then(r => r.json())
              .then(d => {
                console.log('[Vapi] fallback complete-interview result:', d);
                if (d?.success && mounted.current) {
                  setCallStatus('complete');
                  setInterviewPhase('complete');
                  triggerOtp();
                }
              })
              .catch(e => console.warn('[Vapi] fallback complete-interview error:', e));
          }
          return 'ended';
        });
      });

      vapi.on('speech-start', () => {
        if (!mounted.current) return;
        setIsSpeaking(true);
        setIsListening(false);
        setCurrentSpeech('');
      });

      vapi.on('speech-end', () => {
        if (!mounted.current) return;
        setIsSpeaking(false);
        setIsListening(true);
        setCurrentSpeech('');
      });

      vapi.on('message', msg => {
        if (!mounted.current) return;
        console.log('[Vapi] message:', msg.type, msg);

        // ── Live transcripts ──────────────────────────────────────────────────
        if (msg.type === 'transcript') {
          if (msg.role === 'user') {
            const txt = msg.transcript || '';
            if (msg.transcriptType === 'final') {
              setLiveTranscript('');
              const parsedEm = extractEmailFromSpeech(txt);
              if (parsedEm) {
                setCollectedEmail(parsedEm);
                toast.success(`Captured email: ${parsedEm}`, { icon: 'email' });
              }
              const nav = detectNavIntent(txt);
              if (nav) { handleNavIntent(nav); return; }
              if (txt.trim()) {
                ansCountRef.current += 1;
                setAnswers(prev => ({ ...prev, [currentQRef.current]: txt }));
              }
            } else {
              setLiveTranscript(txt);
              const nav = detectNavIntent(txt);
              if (nav) handleNavIntent(nav);
            }
          } else if (msg.role === 'assistant') {
            if (msg.transcriptType === 'partial') {
              setCurrentSpeech(msg.transcript || '');
            } else if (msg.transcriptType === 'final') {
              const txt = (msg.transcript || '').trim();
              setCurrentSpeech('');
              if (txt) {
                setCurrentQText(txt);
                currentQRef.current += 1;
                setCurrentQ(q => q + 1);
              }
              const nav = detectNavIntent(txt);
              if (nav) handleNavIntent(nav);
            }
          }
        }

        // ── Tool call results (from Vapi server tools) ────────────────────────
        if (msg.type === 'tool-calls-result' || msg.type === 'function-call-result') {
          const items = msg.toolCallList || msg.toolCalls || [];
          for (const item of items) {
            try {
              const result = typeof item.result === 'string'
                ? JSON.parse(item.result)
                : item.result;
              if (!result) continue;

              // Coverage / extraction update from saveInterviewAnswer
              if (result.coverage) {
                setCoverage(result.coverage);
              }
              if (typeof result.questions_answered === 'number') {
                setQuestionsAnswered(result.questions_answered);
                const newQ = result.questions_answered + 1;
                if (newQ > currentQRef.current) {
                  currentQRef.current = newQ;
                  setCurrentQ(newQ);
                }
              }
              if (result.should_complete) {
                console.log('[Vapi] should_complete=true — Vapi should now call completeInterview');
              }

              // Live extractions
              if (result.extraction || result.ai_extraction || (result.key_points && result.key_points.length > 0)) {
                const ext = result.extraction || result.ai_extraction || { key_points: result.key_points, category: 'requirement' };
                setExtractions(prev => [...prev, { q: currentQRef.current, ...ext }]);
                setTotalCaptured(prev => prev + (ext.requirements?.length || ext.key_points?.length || 1));
              }
              if (result.language_code) setLockedLang(result.locked_language || 'English');

              // Interview complete
              if (result.redirect_to && result.success) {
                console.log('[Vapi] completeInterview success — triggering OTP');
                setCallStatus('complete');
                setInterviewPhase('complete');
                setTimeout(() => {
                  if (!mounted.current) return;
                  triggerOtp();
                }, 1500);
              }

              // OTP explicitly triggered by Vapi tool (legacy path — keep for compatibility)
              if (result.otp_sent || result.simulated_otp) {
                if (result.simulated_otp) {
                  setSimOtp(result.simulated_otp);
                  toast.success(`[Dev] OTP: ${result.simulated_otp}`, { duration: 10000 });
                }
                if (result.phone) {
                  setOtpPhone(result.phone);
                  setOtpName(result.name || capturedNameRef.current);
                  setShowOtp(true);
                }
              }

              // Navigation command from tool
              if (result.navigate_to) handleNavIntent(result.navigate_to);

            } catch (_) {}
          }
        }

        // ── End of call report ────────────────────────────────────────────────
        if (msg.type === 'end-of-call-report') {
          console.log('[Vapi] end-of-call-report:', msg);
        }

        // ── Metadata messages ─────────────────────────────────────────────────
        if (msg.type === 'metadata') {
          if (msg.interview_complete) {
            setCallStatus('complete');
            setInterviewPhase('complete');
            setTimeout(() => { if (mounted.current) triggerOtp(); }, 1500);
          }
          if (msg.coverage)   setCoverage(msg.coverage);
          if (msg.extraction) {
            setExtractions(prev => [...prev, { q: currentQRef.current, ...msg.extraction }]);
            setTotalCaptured(prev => prev + (msg.extraction.requirements?.length || 1));
          }
        }
      });

      vapi.on('error', err => {
        if (!mounted.current) return;
        console.error('[Vapi] error:', err);
        if (callTimer.current) clearInterval(callTimer.current);
        setIsListening(false); setIsSpeaking(false);
        const rawMsg = err?.error?.message ?? err?.message ?? err;
        const safeMsg = typeof rawMsg === 'string'
          ? rawMsg
          : (rawMsg?.message || JSON.stringify(rawMsg) || 'Voice connection error');
        setErrorMsg(safeMsg);
        setCallStatus('error');
      });

      // ── Start the Vapi call ────────────────────────────────────────────────
      console.log('[Vapi] Starting call — assistant:', VAPI_ASSISTANT_ID, 'app:', aid, 'name:', name, 'phone:', phone);

      await vapi.start(VAPI_ASSISTANT_ID, {
        metadata: {
          application_id:   String(aid),
          guest_token:      guestToken.current,
          user_id:          user ? String(user.id) : null,
          user_name:        name || user?.full_name || '',
          user_phone:       phone || user?.phone || '',
          is_authenticated: String(!!user),
          interview_mode:   'business_interview',
          identity_done:    'true',
        },
        variableValues: {
          application_id:   String(aid),
          user_name:        (name || user?.full_name || '').trim().split(/\s+/)[0] || '',
          is_authenticated: String(!!user),
        },
      });

    } catch (err) {
      console.error('[Vapi] init error:', err);
      if (!mounted.current) return;
      if (callTimer.current) clearInterval(callTimer.current);
      const rawErr = err?.message ?? err;
      const safeErr = typeof rawErr === 'string' ? rawErr : (rawErr?.message || JSON.stringify(rawErr) || 'Failed to start interview');
      setErrorMsg(safeErr);
      setCallStatus('error');
      toast.error('Could not connect to Helix. Check your internet and try again.');
    }
  }

  // ── Trigger OTP after interview completes ────────────────────────────────────
  const triggerOtp = useCallback(async () => {
    if (!mounted.current) return;

    const phone = capturedPhoneRef.current || otpPhone;
    const name  = capturedNameRef.current  || otpName;

    if (!phone) {
      // No phone captured — go straight to requirements if authenticated
      if (user) {
        navigate(`/requirements/${appIdRef.current}`);
      } else {
        navigate('/login?claim=true');
      }
      return;
    }

    // Already authenticated
    if (user) {
      // Claim the guest session then navigate
      try {
        await authAPI.claimGuestSession({ application_id: appIdRef.current, guest_token: guestToken.current });
      } catch (_) {}
      navigate(`/requirements/${appIdRef.current}`);
      return;
    }

    console.log('[OTP] Initiating OTP for phone:', phone);
    setOtpPhone(phone);
    setOtpName(name);

    try {
      const res = await authAPI.initiateOtp({ phone, name });
      if (res.data.simulated_otp) {
        setSimOtp(res.data.simulated_otp);
        toast.success(`[Dev] OTP: ${res.data.simulated_otp}`, { duration: 15000 });
      }
      setShowOtp(true);
    } catch (err) {
      console.error('[OTP] initiateOtp error:', err);
      toast.error('Could not send OTP. Please enter manually.');
      setShowOtp(true); // Still show modal
    }
  }, [user, otpPhone, otpName, navigate]);

  // ── OTP success handler ────────────────────────────────────────────────────────
  const handleOtpSuccess = useCallback(async () => {
    setShowOtp(false);
    setInterviewPhase('done');

    const aid = appIdRef.current;
    if (aid) {
      // Claim guest session so the app appears in the authenticated dashboard
      try {
        await authAPI.claimGuestSession({ application_id: aid, guest_token: guestToken.current });
      } catch (_) {}
      navigate(`/requirements/${aid}`);
    } else {
      navigate('/dashboard');
    }
  }, [navigate]);

  // ── Stop Vapi ─────────────────────────────────────────────────────────────────
  const stopVapi = useCallback(() => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch (_) {}
    }
    if (callTimer.current) clearInterval(callTimer.current);
    if (mounted.current) {
      setCallStatus(prev => prev === 'complete' ? 'complete' : 'ended');
      setIsListening(false); setIsSpeaking(false);
    }
  }, []);

  // ── Navigate and clean up ─────────────────────────────────────────────────────
  const safeNavigate = useCallback((path) => {
    stopVapi();
    setTimeout(() => { if (mounted.current) navigate(path); }, 300);
  }, [navigate, stopVapi]);

  // ── Handle navigation intents ─────────────────────────────────────────────────
  const handleNavIntent = useCallback((intent) => {
    switch (intent) {
      case 'HOME':         safeNavigate('/');          break;
      case 'DASHBOARD':    safeNavigate('/dashboard'); break;
      case 'LOGIN':        safeNavigate('/login');     break;
      case 'REQUIREMENTS':
        if (appIdRef.current) safeNavigate(`/requirements/${appIdRef.current}`);
        else toast('No project yet — finish the interview first.', { icon: 'info' });
        break;
      case 'DOCUMENTS':
        if (appIdRef.current) safeNavigate(`/documents/${appIdRef.current}`);
        else toast('No project yet — finish the interview first.', { icon: 'info' });
        break;
      case 'EXIT':
        stopVapi();
        break;
      default: break;
    }
  }, [safeNavigate, stopVapi]);

  // ── Generate requirements (authenticated user path) ──────────────────────────
  const handleGenerateRequirements = useCallback(async () => {
    if (!user) {
      triggerOtp();
      return;
    }
    setProcessing(true); setProcStep('generating');
    try {
      await requirementsAPI.generate({ application_id: appIdRef.current });
      toast.success('Requirements generated!');
      ansCountRef.current = 99;
      navigate(`/requirements/${appIdRef.current}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to generate requirements.');
      if (mounted.current) { setProcessing(false); setProcStep(''); }
    }
  }, [user, navigate, triggerOtp]);

  // ── Typed text fallback (keyboard input during Vapi call) ────────────────────
  const submitTyped = useCallback(async () => {
    const t = typedText.trim();
    if (!t || processing) return;
    setTypedText('');

    const nav = detectNavIntent(t);
    if (nav) { handleNavIntent(nav); return; }

    setProcessing(true); setProcStep('analyzing');
    try {
      let res;
      if (user) {
        res = await interviewAPI.processText(appIdRef.current, { answer_text: t });
      } else {
        res = await interviewAPI.processTextGuest(appIdRef.current, guestToken.current, { answer_text: t });
      }
      if (!mounted.current) return;
      const data = res.data;
      if (data.coverage) setCoverage(data.coverage);
      if (data.ai_extraction) {
        setExtractions(prev => [...prev, { q: currentQRef.current, ...data.ai_extraction }]);
        setTotalCaptured(prev => prev + (data.ai_extraction.requirements?.length || 1));
      }
      setAnswers(prev => ({ ...prev, [currentQRef.current]: data.transcribed_text || t }));
      ansCountRef.current += 1;
      if (data.language_context?.locked_language) setLockedLang(data.language_context.locked_language);
      if (data.interview_complete) {
        setCallStatus('complete');
        setInterviewPhase('complete');
        stopVapi();
        setTimeout(() => { if (mounted.current) triggerOtp(); }, 1500);
      } else if (data.next_question) {
        setCurrentQText(data.next_question);
        currentQRef.current += 1; setCurrentQ(q => q + 1);
      }
    } catch (err) {
      console.error('[Interview] typed submit error:', err);
      toast.error('Failed to process. Please try again.');
    } finally {
      if (mounted.current) { setProcessing(false); setProcStep(''); }
    }
  }, [typedText, processing, user, stopVapi, handleNavIntent, triggerOtp]);

  // ── Mute/Unmute mic ──────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;
    const newMuted = !isMuted;
    try { vapiRef.current.setMuted(newMuted); } catch (_) {}
    setIsMuted(newMuted);
  }, [isMuted]);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recognizerRef.current) { try { recognizerRef.current.abort(); } catch (_) {} }
      if (vapiRef.current) { try { vapiRef.current.stop(); } catch (_) {} }
      if (callTimer.current) clearInterval(callTimer.current);
      // Clean up short sessions
      if (appIdRef.current && ansCountRef.current < 2 && interviewPhase !== 'done') {
        applicationsAPI.delete(appIdRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Status config ──────────────────────────────────────────────────────────────
  const statusConfig = {
    initializing: { dot: 'bg-purple-400 animate-pulse', label: 'Starting up...' },
    connecting:   { dot: 'bg-indigo-400 animate-pulse', label: 'Connecting to Helix...' },
    active:       { dot: isSpeaking ? 'bg-blue-500 animate-pulse' : 'bg-green-400 animate-pulse', label: isSpeaking ? 'Helix is speaking...' : 'Listening to you...' },
    complete:     { dot: 'bg-green-500',                label: 'Interview complete! ✓' },
    ended:        { dot: 'bg-gray-400',                 label: 'Call ended' },
    error:        { dot: 'bg-red-500',                  label: 'Connection error' },
  };
  const cfg = statusConfig[callStatus] || statusConfig.initializing;

  const progressPercent = coverage.overall_percent || 0;
  const isVapiActive    = callStatus === 'active' || callStatus === 'connecting';
  const showIdentity    = interviewPhase === 'identity';

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#F6F7FE] pt-[67px]">

      {/* ─── Top Bar ────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Phase badge */}
          {showIdentity ? (
            <div className="bg-indigo-50 border border-indigo-200 rounded-full px-4 py-1 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              <span className="text-xs font-medium text-indigo-700">Identity Verification</span>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-full px-4 py-1 flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              <span className="text-xs font-medium">{cfg.label}</span>
            </div>
          )}

          {/* Question counter */}
          {callStatus === 'active' && !showIdentity && (
            <div className="bg-amber-50 border border-amber-200 rounded-full px-3 py-1 flex items-center gap-1.5 text-xs text-amber-800 font-bold">
              <span>Q {Math.min(questionsAnswered + 1, 10)} / 10</span>
              {questionsAnswered >= 8 && <span className="text-green-700 ml-1">Wrapping up</span>}
            </div>
          )}

          {/* Language lock pill */}
          {callStatus === 'active' && !showIdentity && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1 flex items-center gap-1.5 text-xs text-indigo-700 font-medium">
              <span>Language: {lockedLang}</span>
            </div>
          )}

          {/* Call timer */}
          {callStatus === 'active' && (
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">
              <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
              <span className="text-xs font-mono text-gray-600">{formatDuration(callDuration)}</span>
            </div>
          )}

          {/* Captured identity pill */}
          {capturedName && !showIdentity && (
            <div className="bg-green-50 border border-green-200 rounded-full px-3 py-1 flex items-center gap-1 text-xs text-green-700 font-medium">
              <User className="w-3 h-3" />
              <span>{capturedName}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {!showIdentity && (
            <>
              <span className="font-semibold text-sm text-gray-500">Project Understanding</span>
              <span className="font-bold text-base text-blue-600">{progressPercent}%</span>
              <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all duration-700" style={{ width: `${progressPercent}%` }} />
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => safeNavigate(user ? '/dashboard' : '/')}
          className="flex items-center gap-1 text-base font-medium text-gray-800 hover:text-red-500"
        >
          Exit <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Main Two-Column Layout ──────────────────────────────────────────── */}
      <div className="flex h-[calc(100vh-67px-52px)]">

        {/* ── Left Panel ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 pb-12 px-6 md:px-10 border-r border-[#D4DCE8] overflow-y-auto">

          {/* ── IDENTITY PHASE ─────────────────────────────────────────────── */}
          {showIdentity ? (
            <IdentityPhase
              identityPhase={identityPhase}
              identityPrompt={identityPrompt}
              identityInput={identityInput}
              setIdentityInput={setIdentityInput}
              identityListening={identityListening}
              identityError={identityError}
              onSubmitText={onIdentityTextSubmit}
              capturedName={capturedName}
              capturedPhone={capturedPhone}
              hasSpeechSupport={hasSpeechSupport}
            />

          ) : interviewPhase === 'vapi_starting' ? (
            /* ── Vapi starting / connecting ──────────────────────────────── */
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-600 flex items-center justify-center shadow-2xl mb-6">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
              <p className="text-sm font-bold text-indigo-600 tracking-wider uppercase mb-2">Helix AI</p>
              <p className="text-gray-500 text-sm">Starting your business interview...</p>
            </div>

          ) : callStatus === 'complete' ? (
            /* ── Interview Complete ───────────────────────────────────────── */
            <div className="text-center mt-12">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Interview Complete!</h2>
              <p className="text-sm text-gray-600 mb-6">{totalCaptured} requirements captured.</p>
              <button
                onClick={handleGenerateRequirements} disabled={processing}
                className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-[32px] hover:bg-[#0f172a] disabled:opacity-50"
              >
                {processing ? 'Please wait...' : user ? 'Generate requirement form' : 'Sign in & Generate'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          ) : callStatus === 'error' ? (
            /* ── Error state ─────────────────────────────────────────────── */
            <div className="text-center mt-12">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <X className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Failed</h2>
              {errorMsg && <p className="text-sm text-red-500 mb-4 max-w-xs">{errorMsg}</p>}
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 rounded-2xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Try Again
              </button>
            </div>

          ) : callStatus === 'ended' ? (
            /* ── Ended state ─────────────────────────────────────────────── */
            <div className="text-center mt-12">
              <p className="text-gray-500 text-sm mb-6">Call ended. Your progress has been saved.</p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button onClick={() => window.location.reload()}
                  className="px-6 py-3 rounded-2xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700">
                  Restart Interview
                </button>
                {appId && (
                  <button onClick={() => navigate(`/requirements/${appId}`)}
                    className="px-6 py-3 rounded-2xl text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50">
                    View Requirements
                  </button>
                )}
                <button onClick={() => navigate(user ? '/dashboard' : '/')}
                  className="px-6 py-3 rounded-2xl text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50">
                  {user ? 'Go to Dashboard' : 'Go Home'}
                </button>
              </div>
            </div>

          ) : (
            /* ── Active / Connecting (Vapi interview) ────────────────────── */
            <>
              {/* Helix avatar + waveform */}
              <div className="flex flex-col items-center mb-8">
                <div className="relative w-28 h-28 mb-6">
                  <div className={`absolute inset-0 rounded-full transition-all duration-500 ${
                    isSpeaking  ? 'ring-8 ring-blue-300/50 ring-offset-4 ring-offset-[#F6F7FE]' :
                    isListening ? 'ring-8 ring-green-300/50 ring-offset-4 ring-offset-[#F6F7FE]' : ''
                  }`} />
                  <div className="w-28 h-28 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-600 flex items-center justify-center shadow-2xl">
                    {callStatus === 'initializing' || callStatus === 'connecting'
                      ? <Loader2 className="w-10 h-10 text-white animate-spin" />
                      : <Sparkles className={`w-10 h-10 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
                    }
                  </div>
                </div>

                <p className="text-sm font-bold text-indigo-600 tracking-wider uppercase mb-1">Helix AI</p>
                <p className="text-xs text-gray-400">
                  {callStatus === 'initializing' ? 'Starting voice session...' :
                   callStatus === 'connecting'   ? 'Connecting...' :
                   isSpeaking  ? 'Speaking — just start talking to interrupt' :
                   isListening ? 'Listening — speak now' : 'Ready'}
                </p>

                {callStatus === 'active' && (
                  <div className="flex items-end gap-[3px] h-8 mt-4">
                    {[3,6,9,5,8,4,7,10,6,3,8,5,9].map((h, i) => (
                      <div key={i} style={{
                        width: 3,
                        height: (isSpeaking || isListening) ? `${h * 3}px` : '4px',
                        backgroundColor: isSpeaking ? '#6366f1' : '#10b981',
                        borderRadius: 4,
                        transition: `height ${0.12 + i * 0.025}s ease-in-out`,
                        opacity: (isSpeaking || isListening) ? 0.85 : 0.25,
                        animation: (isSpeaking || isListening) ? `pulse 0.7s ease-in-out ${i * 0.06}s infinite alternate` : 'none',
                      }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Current Helix question / speech */}
              {(currentQText || currentSpeech) && callStatus === 'active' && (
                <div className="w-full max-w-xl mb-6">
                  <div className="bg-white border border-[#D4DCE8] rounded-2xl shadow-sm overflow-hidden" style={{ borderLeft: '3px solid #6366f1' }}>
                    <div className="flex items-center gap-2 px-5 pt-4 pb-2 border-b border-gray-100">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      <p className="text-[11px] font-bold text-indigo-600 tracking-widest uppercase">Helix says</p>
                      {isSpeaking && <span className="ml-auto text-[10px] text-indigo-400 animate-pulse font-medium">Speaking...</span>}
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-base md:text-lg font-medium text-gray-900 leading-relaxed">
                        {currentSpeech || currentQText}
                        {isSpeaking && <span className="inline-block w-0.5 h-5 bg-indigo-400 ml-1 align-text-bottom animate-pulse" />}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Processing indicator */}
              {processing && <AiProcessingWaveform procStep={procStep} />}

              {/* Live user transcript */}
              {liveTranscript && callStatus === 'active' && (
                <div className="w-full max-w-md mb-6">
                  <div className="bg-white rounded-2xl border border-purple-100 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-xs font-medium text-gray-600">You're saying...</span>
                    </div>
                    <p className="text-sm text-gray-700 min-h-[36px]">
                      {liveTranscript}
                      <span className="inline-block w-0.5 h-4 bg-green-500 ml-0.5 animate-pulse" />
                    </p>
                  </div>
                </div>
              )}

              {/* Control bar */}
              {isVapiActive && (
                <div className="w-full max-w-xl mx-auto">
                  <div className="flex items-center gap-3 w-full">
                    {/* Mute mic */}
                    <button
                      type="button" onClick={toggleMute}
                      className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all shadow-sm ${
                        isMuted
                          ? 'bg-gray-100 border border-gray-200 text-gray-500 hover:bg-gray-200'
                          : isListening
                          ? 'bg-[#FF4528] text-white shadow-lg shadow-red-200 ring-4 ring-red-100 animate-pulse'
                          : 'bg-[#FF4528] text-white hover:bg-[#E03A1F]'
                      }`}
                      title={isMuted ? 'Unmute mic' : 'Mute mic'}
                    >
                      {isMuted ? <MicOff className="w-5 h-5 text-gray-600" /> : <Mic className="w-5 h-5 text-white" />}
                    </button>

                    {/* Text input fallback */}
                    <div className="flex-1">
                      <input
                        type="text" value={typedText}
                        onChange={e => setTypedText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } }}
                        placeholder={
                          isSpeaking    ? 'Helix is speaking...' :
                          isListening   ? 'Speak now, or type here...' :
                          callStatus === 'connecting' ? 'Connecting...' :
                          'Type your answer or a command...'
                        }
                        disabled={processing || callStatus !== 'active'}
                        className="w-full rounded-full border border-gray-200 bg-white px-6 py-3.5 text-sm text-gray-800 placeholder:text-gray-400 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50"
                      />
                    </div>

                    {/* Send button */}
                    <button
                      type="button" onClick={submitTyped}
                      disabled={!typedText.trim() || processing || callStatus !== 'active'}
                      className={`w-12 h-12 rounded-full border flex items-center justify-center flex-shrink-0 transition-all shadow-sm ${
                        typedText.trim() && !processing && callStatus === 'active'
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-md hover:bg-indigo-700'
                          : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      <Send className="w-5 h-5" />
                    </button>

                    {/* End call */}
                    <button
                      type="button" onClick={stopVapi}
                      className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all shadow-sm bg-red-500 text-white hover:bg-red-600"
                      title="End interview"
                    >
                      <PhoneOff className="w-5 h-5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-gray-400 text-center mt-2.5">
                    {isMuted
                      ? 'Mic muted — type your answer below'
                      : isSpeaking
                      ? 'Helix is speaking — start talking to interrupt'
                      : 'Vapi AI is listening — speak naturally or type below'}
                  </p>
                </div>
              )}

              {/* Previous answer */}
              {answers[currentQ - 1] && !processing && callStatus === 'active' && (
                <div className="bg-green-50 rounded-xl p-3 mt-6 max-w-md border border-green-100 w-full">
                  <p className="text-xs text-green-700 font-medium mb-1">Previous answer recorded:</p>
                  <p className="text-sm text-gray-700 line-clamp-2">{answers[currentQ - 1]}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right Panel ───────────────────────────────────────────────── */}
        <div className="w-[400px] bg-white p-6 overflow-y-auto border-l border-gray-100 flex flex-col">

          {showIdentity ? (
            /* ── Identity panel ──────────────────────────────────────────── */
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mb-4">
                <ShieldCheck className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Identity Verification</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                We collect your name and phone number before the interview to ensure your requirements are saved securely to your account.
              </p>
              <div className="mt-6 w-full space-y-3">
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${capturedName ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <User className={`w-4 h-4 ${capturedName ? 'text-green-600' : 'text-gray-400'}`} />
                  <div className="text-left">
                    <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Name</p>
                    <p className={`text-sm font-semibold ${capturedName ? 'text-green-700' : 'text-gray-400'}`}>
                      {capturedName || 'Not yet captured'}
                    </p>
                  </div>
                  {capturedName && <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />}
                </div>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${capturedPhone ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <Phone className={`w-4 h-4 ${capturedPhone ? 'text-green-600' : 'text-gray-400'}`} />
                  <div className="text-left">
                    <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Phone</p>
                    <p className={`text-sm font-semibold ${capturedPhone ? 'text-green-700' : 'text-gray-400'}`}>
                      {capturedPhone || 'Not yet captured'}
                    </p>
                  </div>
                  {capturedPhone && <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />}
                </div>
              </div>
            </div>

          ) : (
            /* ── Coverage panel (during Vapi interview) ────────────────── */
            <>
              <p className="text-xs font-semibold text-gray-500 tracking-[0.11em] mb-4 uppercase">Requirement Coverage</p>

              <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border border-blue-100/50 rounded-2xl p-4 mb-6">
                <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-white border border-blue-200 shadow-sm flex-shrink-0">
                  <span className="text-base font-bold text-blue-600">{progressPercent}%</span>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Project Understanding</h4>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">
                    {progressPercent >= 90 ? 'Thoroughly Understood'
                      : progressPercent >= 60 ? 'Deep Understanding'
                      : progressPercent >= 30 ? 'Gathering Scope'
                      : 'Analyzing Idea'}
                  </p>
                </div>
              </div>

              {/* Checklist */}
              {(coverage.checklist?.length > 0 || coverage.collected_fields?.length > 0) && (
                <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/30 mb-6">
                  <h4 className="text-xs font-bold text-gray-900 mb-3">Requirement Checklist</h4>
                  {coverage.checklist?.length > 0 ? (() => {
                    const universal = coverage.checklist.filter(i => i.section !== 'domain');
                    const domain    = coverage.checklist.filter(i => i.section === 'domain');
                    const renderItem = item => {
                      if (item.status === 'complete') return (
                        <div key={item.field} className="flex items-center gap-1.5 text-xs text-green-700" title={item.evidence || item.label}>
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          <span className="truncate font-medium">{item.label}</span>
                        </div>
                      );
                      if (item.status === 'partial') return (
                        <div key={item.field} className="flex items-center gap-1.5 text-xs text-amber-600">
                          <MinusCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </div>
                      );
                      return (
                        <div key={item.field} className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Circle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </div>
                      );
                    };
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">{universal.map(renderItem)}</div>
                        {domain.length > 0 && (
                          <>
                            <div className="flex items-center gap-2 mt-4 mb-2">
                              <div className="flex-1 h-px bg-gradient-to-r from-indigo-100 to-transparent" />
                              <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider whitespace-nowrap px-1">
                                {coverage.domain_label ? `${coverage.domain_label} Requirements` : 'Domain Requirements'}
                              </span>
                              <div className="flex-1 h-px bg-gradient-to-l from-indigo-100 to-transparent" />
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">{domain.map(renderItem)}</div>
                          </>
                        )}
                        <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-gray-100">
                          <div className="flex items-center gap-1 text-[10px] text-gray-400"><CheckCircle2 className="w-3 h-3 text-green-500" /><span>Captured</span></div>
                          <div className="flex items-center gap-1 text-[10px] text-gray-400"><MinusCircle  className="w-3 h-3 text-amber-400" /><span>Partial</span></div>
                          <div className="flex items-center gap-1 text-[10px] text-gray-400"><Circle       className="w-3 h-3 text-gray-300" /><span>Missing</span></div>
                        </div>
                      </>
                    );
                  })() : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {(coverage.collected_fields || []).map(f => (
                        <div key={f} className="flex items-center gap-1.5 text-xs text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          <span className="truncate font-medium">{coverage.field_labels?.[f] || f}</span>
                        </div>
                      ))}
                      {(coverage.missing_fields || []).map(f => (
                        <div key={f} className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Circle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                          <span className="truncate">{coverage.field_labels?.[f] || f}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Live extractions */}
              <div className="flex-1">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-[0.11em] mb-3">
                  Live Extractions ({totalCaptured})
                </h4>
                {extractions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 border border-dashed border-gray-200 rounded-2xl p-4 text-center">
                    <Sparkles className="w-4 h-4 text-gray-300 mb-2" />
                    <p className="text-[11px] text-gray-500 max-w-[200px]">Requirements will appear here in real-time as you speak.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {extractions.map((ext, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-500">Q{ext.q}</span>
                          <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">{ext.category || 'general'}</span>
                        </div>
                        {ext.key_points?.map((p, j)  => <p key={j} className="text-xs text-gray-700 mb-1">• {p}</p>)}
                        {ext.requirements?.map((r, j) => <p key={j} className="text-xs text-blue-600 mt-1 font-medium">→ {r}</p>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Generate button (after complete) */}
              {callStatus === 'complete' && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <button
                    onClick={handleGenerateRequirements} disabled={processing}
                    className="w-full flex items-center justify-center gap-2 bg-[#1E293B] text-white font-medium text-sm py-3.5 rounded-full disabled:opacity-50"
                  >
                    <ArrowRight className="w-4 h-4" /> Generate requirement form
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── OTP Modal ──────────────────────────────────────────────────────── */}
      {showOtp && (
        <OtpModal
          phone={otpPhone} name={otpName} simOtp={simOtp}
          onSuccess={handleOtpSuccess}
          onClose={() => setShowOtp(false)}
        />
      )}

      {/* ─── CSS for waveform animation ──────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          from { opacity: 0.4; transform: scaleY(0.6); }
          to   { opacity: 0.95; transform: scaleY(1.2); }
        }
      `}</style>
    </div>
  );
}
