/**
 * VapiInterview.jsx — Helix Vapi-First AI Business Interview
 *
 * Architecture:
 *  - Vapi AI agent handles ALL conversation (STT, NLU, TTS, barge-in, questions)
 *  - Helix backend is ONLY the data + action layer (storing sessions, requirements, OTP)
 *  - Agent 2 (HelixAssistant) is disabled while this page is active
 *
 * Flow:
 *  1. Create guest application → get application_id
 *  2. Start Vapi call with assistant_id + metadata.application_id
 *  3. Vapi conducts the full interview naturally
 *  4. Vapi calls backend tools: saveInterviewAnswer, completeInterview, etc.
 *  5. On completeInterview → navigate to /requirements/{id}
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useVoiceAgent } from '../context/VoiceAgentContext';
import { applicationsAPI, authAPI } from '../services/api';
import Vapi from '@vapi-ai/web';
import toast from 'react-hot-toast';
import {
  Mic, MicOff, PhoneOff, Volume2, VolumeX,
  Sparkles, CheckCircle2, Loader2, AlertCircle
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
const VAPI_PUBLIC_KEY = '428e68f5-cbd8-41a3-bf1a-29b9f90673c1';
const VAPI_ASSISTANT_ID = 'ff179db8-6206-4bfa-b8b0-241723e1ddab';

function getOrCreateGuestToken() {
  let t = localStorage.getItem('helix_guest_token');
  if (!t) {
    t = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('helix_guest_token', t);
  }
  return t;
}

// ── Animated waveform bars ─────────────────────────────────────────────────
function VoiceWaveform({ active, color = '#6366f1' }) {
  const bars = [3, 6, 9, 6, 3, 8, 5, 10, 7, 4, 9, 6, 3];
  return (
    <div className="flex items-end gap-[3px] h-10">
      {bars.map((height, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: active ? `${height * 4}px` : '6px',
            backgroundColor: color,
            borderRadius: 4,
            transition: `height ${0.15 + i * 0.03}s ease-in-out`,
            opacity: active ? 0.9 : 0.3,
            animation: active ? `pulse-bar-${i % 3} 0.8s ease-in-out infinite alternate` : 'none',
            animationDelay: `${i * 0.06}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── OTP Modal ─────────────────────────────────────────────────────────────────
function OtpModal({ phone, name, onSuccess, onClose }) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithOtp } = useAuth();

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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-sm mx-4 rounded-3xl p-8"
        style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(32px)',
          boxShadow: '0 32px 64px rgba(99,102,241,0.2)',
        }}
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Verify your number</h2>
          <p className="text-sm text-gray-500 mt-1">
            Enter the 6-digit code sent to <strong>{phone}</strong>
          </p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="w-full text-center text-3xl font-bold tracking-[0.5em] px-4 py-4 rounded-2xl border-2 border-indigo-200 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all"
          onKeyDown={e => e.key === 'Enter' && handleVerify()}
          autoFocus
        />

        <button
          onClick={handleVerify}
          disabled={loading || otp.length !== 6}
          className="w-full mt-4 py-3.5 rounded-2xl font-semibold text-white transition-all"
          style={{
            background: otp.length === 6 ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#d1d5db',
            cursor: otp.length === 6 ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Verify OTP'}
        </button>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2.5 rounded-2xl text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main VapiInterview Page ───────────────────────────────────────────────────
export default function VapiInterview() {
  const { user, loginWithOtp, claimGuestSession } = useAuth();
  const navigate = useNavigate();
  const { activateInterviewAgent, deactivateInterviewAgent } = useVoiceAgent();

  // ── State ─────────────────────────────────────────────────────────────────
  const [status, setStatus]             = useState('initializing'); // initializing | connecting | active | complete | error | ended
  const [isSpeaking, setIsSpeaking]     = useState(false);  // Vapi is speaking
  const [isListening, setIsListening]   = useState(false);  // User can speak
  const [isMuted, setIsMuted]           = useState(false);
  const [transcript, setTranscript]     = useState([]);     // [{role, text}]
  const [currentSpeech, setCurrentSpeech] = useState('');
  const [appId, setAppId]               = useState(null);
  const [showOtp, setShowOtp]           = useState(false);
  const [otpPhone, setOtpPhone]         = useState('');
  const [otpName, setOtpName]           = useState('');
  const [errorMsg, setErrorMsg]         = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [questionsAnswered, setQuestionsAnswered] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const vapiRef       = useRef(null);
  const appIdRef      = useRef(null);
  const guestToken    = useRef(getOrCreateGuestToken());
  const mounted       = useRef(true);
  const hasStarted    = useRef(false);
  const callTimer     = useRef(null);
  const transcriptRef = useRef([]);

  // ── Keep refs in sync ─────────────────────────────────────────────────────
  useEffect(() => { appIdRef.current = appId; }, [appId]);

  // ── Claim interview agent (disables Agent 2) ──────────────────────────────
  useEffect(() => {
    activateInterviewAgent();
    return () => {
      deactivateInterviewAgent();
      stopVapi();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (callTimer.current) clearInterval(callTimer.current);
    };
  }, []);

  // ── Stop Vapi ─────────────────────────────────────────────────────────────
  const stopVapi = useCallback(() => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch (_) {}
    }
    if (callTimer.current) clearInterval(callTimer.current);
  }, []);

  // ── Add transcript entry ──────────────────────────────────────────────────
  const addTranscript = useCallback((role, text) => {
    if (!text?.trim()) return;
    const entry = { role, text: text.trim(), id: Date.now() + Math.random() };
    transcriptRef.current = [...transcriptRef.current.slice(-30), entry];
    if (mounted.current) setTranscript([...transcriptRef.current]);
    if (role === 'user') setQuestionsAnswered(q => q + 1);
  }, []);

  // ── Initialize Vapi call ──────────────────────────────────────────────────
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function initInterview() {
      try {
        setStatus('initializing');

        // 1. Create a guest application to get application_id
        const appRes = await applicationsAPI.createGuest(guestToken.current);
        if (!mounted.current) return;

        const application_id = appRes.data.id;
        setAppId(application_id);
        appIdRef.current = application_id;
        localStorage.setItem('helix_pending_app_id', String(application_id));
        localStorage.setItem('helix_pending_guest_token', guestToken.current);

        // 2. Initialize Vapi client
        const vapi = new Vapi(VAPI_PUBLIC_KEY);
        vapiRef.current = vapi;

        // ── Vapi Event Listeners ───────────────────────────────────────────

        vapi.on('call-start', () => {
          if (!mounted.current) return;
          console.log('[Vapi] call-start');
          setStatus('active');
          setIsListening(true);
          // Start call timer
          let secs = 0;
          callTimer.current = setInterval(() => {
            if (mounted.current) setCallDuration(++secs);
          }, 1000);
        });

        vapi.on('call-end', () => {
          if (!mounted.current) return;
          console.log('[Vapi] call-end');
          setIsListening(false);
          setIsSpeaking(false);
          if (callTimer.current) clearInterval(callTimer.current);

          // ── Fallback: guarantee requirements are generated even if Vapi
          // ended the call without calling completeInterview.
          setStatus(prev => {
            if (prev === 'complete') return 'complete';
            const aid = appIdRef.current;
            if (aid) {
              console.log('[Vapi] call-end fallback — calling /api/vapi/complete-interview');
              const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';
              fetch(`${apiBase}/api/vapi/complete-interview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ application_id: aid }),
              })
                .then(r => r.json())
                .then(data => {
                  console.log('[Vapi] fallback complete-interview:', data);
                  if (data?.success && mounted.current) {
                    setStatus('complete');
                    const redir = data.redirect_to || `/requirements/${aid}`;
                    setTimeout(() => {
                      if (mounted.current) navigate(redir);
                    }, 2500);
                  }
                })
                .catch(err => console.warn('[Vapi] fallback error:', err));
            }
            return 'ended';
          });
        });

        vapi.on('speech-start', () => {
          if (!mounted.current) return;
          setIsSpeaking(true);
          setIsListening(false);
        });

        vapi.on('speech-end', () => {
          if (!mounted.current) return;
          setIsSpeaking(false);
          setIsListening(true);
        });

        vapi.on('message', (msg) => {
          if (!mounted.current) return;
          console.log('[Vapi] message:', msg.type, msg);

          // Transcript updates
          if (msg.type === 'transcript') {
            if (msg.transcriptType === 'final') {
              addTranscript(msg.role, msg.transcript);
              if (msg.role === 'assistant') setCurrentSpeech('');
            } else if (msg.role === 'assistant') {
              setCurrentSpeech(msg.transcript || '');
            }
          }

          // Tool calls handled server-side by Vapi → backend
          // Listen for completeInterview result to navigate,
          // and saveInterviewAnswer result to update question counter.
          if (msg.type === 'tool-calls-result' || msg.type === 'function-call-result') {
            const results = msg.toolCallList || msg.toolCalls || [];
            for (const r of results) {
              try {
                const result = typeof r.result === 'string' ? JSON.parse(r.result) : r.result;
                if (!result) continue;

                // ── questions_answered / should_complete from saveInterviewAnswer ──
                if (typeof result.questions_answered === 'number') {
                  setQuestionsAnswered(result.questions_answered);
                }
                if (result.should_complete) {
                  console.log('[Vapi] should_complete=true — Vapi will call completeInterview');
                }

                // ── completeInterview → navigate ──
                if (result?.redirect_to && result?.success) {
                  const redirectPath = result.redirect_to;
                  setStatus('complete');
                  setTimeout(() => {
                    if (mounted.current) navigate(redirectPath);
                  }, 2500);
                }

                // ── OTP needed ──
                if ((r.function?.name === 'initiateOtp' || r.name === 'initiateOtp') && result?.success) {
                  let fnArgs = r.function?.arguments || r.arguments || {};
                  if (typeof fnArgs === 'string') {
                    try { fnArgs = JSON.parse(fnArgs); } catch (_) { fnArgs = {}; }
                  }
                  const phone = fnArgs.phone || result.phone || '';
                  const name = fnArgs.name || result.name || '';
                  if (phone) {
                    setOtpPhone(phone);
                    setOtpName(name);
                    setShowOtp(true);
                    if (result.simulated_otp) {
                      toast.success(`[Helix SMS Simulation] OTP for ${phone} is: ${result.simulated_otp}`, { duration: 10000 });
                    }
                  }
                }
              } catch (_) {}
            }
          }

          // Metadata updates from Vapi
          if (msg.type === 'metadata') {
            if (msg.interview_complete) {
              setStatus('complete');
              const id = appIdRef.current;
              setTimeout(() => {
                if (mounted.current && id) navigate(`/requirements/${id}`);
              }, 2500);
            }
          }
        });

        vapi.on('error', (err) => {
          if (!mounted.current) return;
          console.error('[Vapi] error:', err);
          const msg = err?.error?.message || err?.message || 'Voice connection error';
          setErrorMsg(msg);
          setStatus('error');
          setIsListening(false);
          setIsSpeaking(false);
        });

        // 3. Start the Vapi call with context
        setStatus('connecting');
        await vapi.start(VAPI_ASSISTANT_ID, {
          metadata: {
            application_id: String(application_id),
            user_id: user ? String(user.id) : null,
            user_name: user?.full_name || '',
            is_authenticated: !!user,
            interview_mode: 'business_interview',
          },
          variableValues: {
            application_id: String(application_id),
            user_name: user?.full_name || '',
          }
        });

      } catch (err) {
        console.error('[VapiInterview] init error:', err);
        if (!mounted.current) return;
        const msg = err?.message || 'Failed to start interview';
        setErrorMsg(msg);
        setStatus('error');
        toast.error('Failed to start interview. Please try again.');
      }
    }

    initInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mute/Unmute ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;
    const newMuted = !isMuted;
    vapiRef.current.setMuted(newMuted);
    setIsMuted(newMuted);
  }, [isMuted]);

  // ── End call ─────────────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    stopVapi();
    setStatus('ended');
  }, [stopVapi]);

  // ── OTP success ──────────────────────────────────────────────────────────
  const handleOtpSuccess = useCallback(async () => {
    setShowOtp(false);
    const id = appIdRef.current;
    if (id) {
      try {
        await claimGuestSession(id);
        toast.success('Interview saved to your account!');
      } catch (err) {
        console.warn('Failed to claim guest session:', err);
      }
    }
    navigate('/dashboard');
  }, [claimGuestSession, navigate]);


  // ── Format duration ───────────────────────────────────────────────────────
  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Status colors/labels ──────────────────────────────────────────────────
  const statusConfig = {
    initializing: { label: 'Starting up...', color: '#8b5cf6', pulse: true },
    connecting:   { label: 'Connecting to Helix...', color: '#6366f1', pulse: true },
    active:       { label: isSpeaking ? 'Helix is speaking' : 'Listening...', color: '#10b981', pulse: isSpeaking },
    complete:     { label: 'Interview complete! ✓', color: '#10b981', pulse: false },
    ended:        { label: 'Call ended', color: '#6b7280', pulse: false },
    error:        { label: 'Connection error', color: '#ef4444', pulse: false },
  };

  const cfg = statusConfig[status] || statusConfig.initializing;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      }}
    >
      {/* CSS animations */}
      <style>{`
        @keyframes pulse-bar-0 { to { height: 120%; } }
        @keyframes pulse-bar-1 { to { height: 140%; } }
        @keyframes pulse-bar-2 { to { height: 160%; } }
        @keyframes glow-ring {
          0%, 100% { box-shadow: 0 0 20px 5px rgba(99,102,241,0.3); }
          50% { box-shadow: 0 0 40px 15px rgba(139,92,246,0.5); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .msg-appear { animation: fade-in-up 0.3s ease-out forwards; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">HELIX</div>
            <div className="text-purple-300 text-xs">AI Business Interview</div>
          </div>
        </div>

        {/* Question counter — synced from backend */}
        <div className="flex items-center gap-4">
          {status === 'active' && questionsAnswered < 10 && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1"
              style={{ background: questionsAnswered >= 8 ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.1)', border: `1px solid ${questionsAnswered >= 8 ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.15)'}` }}
            >
              <span className="text-xs font-mono" style={{ color: questionsAnswered >= 8 ? '#34d399' : 'rgba(255,255,255,0.7)' }}>
                Q {Math.min(questionsAnswered + 1, 10)}/10
              </span>
              {questionsAnswered >= 8 && <span className="text-[10px] text-emerald-400">✓ Wrapping</span>}
            </div>
          )}
          {status === 'active' && (
            <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1">
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="text-white text-xs font-mono">{formatDuration(callDuration)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 max-w-2xl mx-auto w-full">

        {/* ── Helix Avatar ──────────────────────────────────────────────── */}
        <div className="relative mb-10" style={{ animation: status === 'active' ? 'float 3s ease-in-out infinite' : 'none' }}>
          {/* Outer glow ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle, ${cfg.color}30 0%, transparent 70%)`,
              transform: 'scale(1.8)',
              animation: cfg.pulse ? 'glow-ring 2s ease-in-out infinite' : 'none',
            }}
          />

          {/* Avatar circle */}
          <div
            className="relative w-32 h-32 rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
              border: `3px solid ${cfg.color}60`,
              boxShadow: `0 0 40px ${cfg.color}40`,
            }}
          >
            {/* Inner glow */}
            <div
              className="absolute inset-3 rounded-full"
              style={{
                background: `radial-gradient(circle at 40% 40%, ${cfg.color}30, transparent)`,
              }}
            />

            {/* Icon */}
            <div
              className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${cfg.color}20, ${cfg.color}10)` }}
            >
              {status === 'error' ? (
                <AlertCircle className="w-8 h-8" style={{ color: cfg.color }} />
              ) : status === 'complete' ? (
                <CheckCircle2 className="w-8 h-8" style={{ color: cfg.color }} />
              ) : (status === 'initializing' || status === 'connecting') ? (
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: cfg.color }} />
              ) : (
                <Sparkles className="w-8 h-8" style={{ color: cfg.color }} />
              )}
            </div>
          </div>

          {/* Waveform below avatar */}
          {status === 'active' && (
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2">
              <VoiceWaveform active={isSpeaking || isListening} color={cfg.color} />
            </div>
          )}
        </div>

        {/* ── Status label ─────────────────────────────────────────────── */}
        <div className="mt-4 text-center mb-6">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium"
            style={{
              background: `${cfg.color}20`,
              color: cfg.color,
              border: `1px solid ${cfg.color}30`,
            }}
          >
            {cfg.pulse && <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: cfg.color }} />}
            {cfg.label}
          </div>

          {status === 'error' && errorMsg && (
            <p className="text-red-400 text-xs mt-2 max-w-xs">{errorMsg}</p>
          )}
        </div>

        {/* ── Live transcript ───────────────────────────────────────────── */}
        {(status === 'active' || transcript.length > 0) && (
          <div
            className="w-full max-h-72 overflow-y-auto space-y-3 mb-6 px-2 scroll-smooth"
            style={{ scrollBehavior: 'smooth' }}
            ref={el => { if (el) el.scrollTop = el.scrollHeight; }}
          >
            {/* In-progress speech */}
            {currentSpeech && (
              <div className="flex items-start gap-3 msg-appear">
                <div
                  className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >H</div>
                <div
                  className="flex-1 px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-white/80 italic"
                  style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}
                >
                  {currentSpeech}
                  <span className="inline-block w-1 h-4 bg-indigo-400 ml-1 animate-pulse align-text-bottom" />
                </div>
              </div>
            )}

            {/* Message history */}
            {[...transcript].reverse().slice(0, 12).reverse().map((msg) => (
              <div key={msg.id} className={`flex items-start gap-3 msg-appear ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div
                  className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                  style={{
                    background: msg.role === 'assistant'
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : 'linear-gradient(135deg, #10b981, #059669)',
                  }}
                >
                  {msg.role === 'assistant' ? 'H' : 'U'}
                </div>
                <div
                  className="flex-1 px-4 py-3 rounded-2xl text-sm"
                  style={{
                    background: msg.role === 'assistant'
                      ? 'rgba(99,102,241,0.12)'
                      : 'rgba(16,185,129,0.12)',
                    border: `1px solid ${msg.role === 'assistant' ? 'rgba(99,102,241,0.2)' : 'rgba(16,185,129,0.2)'}`,
                    borderTopLeftRadius: msg.role === 'assistant' ? 4 : undefined,
                    borderTopRightRadius: msg.role === 'user' ? 4 : undefined,
                    color: msg.role === 'assistant' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.85)',
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Completion message ────────────────────────────────────────── */}
        {status === 'complete' && (
          <div
            className="w-full p-6 rounded-2xl text-center mb-6"
            style={{
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.3)',
            }}
          >
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-white font-bold text-lg mb-1">Interview Complete!</h3>
            <p className="text-emerald-300 text-sm">Your requirements are being generated...</p>
            <div className="mt-4">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400 mx-auto" />
            </div>
          </div>
        )}

        {/* ── Ended state ───────────────────────────────────────────────── */}
        {status === 'ended' && (
          <div className="text-center mb-6">
            <p className="text-white/60 text-sm mb-4">Call ended. Your progress has been saved.</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 rounded-2xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                Restart Interview
              </button>
              {appId && (
                <button
                  onClick={() => navigate(`/requirements/${appId}`)}
                  className="px-6 py-3 rounded-2xl text-sm font-semibold text-white/70 border border-white/20 hover:bg-white/10 transition-all"
                >
                  View Requirements
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Error state ───────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="text-center mb-6">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-2xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* ── Control Bar ───────────────────────────────────────────────────── */}
      {(status === 'active' || status === 'connecting') && (
        <div className="flex items-center justify-center gap-6 pb-10">
          {/* Mute microphone */}
          <button
            onClick={toggleMute}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            style={{
              background: isMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)',
              border: `2px solid ${isMuted ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.2)'}`,
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted
              ? <MicOff className="w-6 h-6 text-red-400" />
              : <Mic className="w-6 h-6 text-white" />
            }
          </button>

          {/* End call — center, larger */}
          <button
            onClick={handleEndCall}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              boxShadow: '0 8px 24px rgba(239,68,68,0.4)',
            }}
            title="End Interview"
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>

          {/* Volume indicator */}
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '2px solid rgba(255,255,255,0.2)',
            }}
          >
            {isSpeaking
              ? <Volume2 className="w-6 h-6 text-indigo-300 animate-pulse" />
              : <VolumeX className="w-6 h-6 text-white/40" />
            }
          </div>
        </div>
      )}

      {/* ── Hint text ─────────────────────────────────────────────────────── */}
      {status === 'active' && (
        <div className="text-center pb-6">
          <p className="text-white/30 text-xs">
            {isListening ? '🎙️ Speak naturally — Helix is listening' : '💬 Helix is responding...'}
          </p>
        </div>
      )}

      {/* ── OTP Modal ─────────────────────────────────────────────────────── */}
      {showOtp && (
        <OtpModal
          phone={otpPhone}
          name={otpName}
          onSuccess={handleOtpSuccess}
          onClose={() => setShowOtp(false)}
        />
      )}
    </div>
  );
}
