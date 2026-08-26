/**
 * Interview.jsx — Helix Vapi-Powered AI Business Consultant
 *
 * Guaranteed Real-Time Flow:
 *  - 1-Click Instant Vapi Wakeup (Microphone pre-unlocked).
 *  - Live Dynamic Question Tracking: Never stuck on greeting question; updates on every assistant turn.
 *  - Live Recorded Responses: Accurate Q&A pairing saved directly into SQLite.
 *  - Immediate Post-Interview Action: Pops up Sign In / Sign Up / OTP modal instantly upon completion.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { applicationsAPI, authAPI } from '../services/api';
import VapiLib from '@vapi-ai/web';
import toast from 'react-hot-toast';
import axios from 'axios';
import {
  Mic, MicOff, PhoneOff, Sparkles, ArrowRight, CheckCircle2, Circle,
  Send, X, Loader2, User, Phone, ShieldCheck,
  LogIn, UserPlus, FileText, RefreshCw, MessageSquare, Check, Play
} from 'lucide-react';
import AiProcessingWaveform from '../components/AiProcessingWaveform';

// ── Safe Vapi constructor ─────────────────────────────────────────────────────
const Vapi = VapiLib?.default ?? VapiLib;

// ── Previous credentials:
// const PREV_VAPI_PUBLIC_KEY   = 'c6b80ecd-d0ed-46df-b2f3-85561cda30fc';
// const PREV_VAPI_ASSISTANT_ID = '428e68f5-cbd8-41a3-bf1a-29b9f90673c1';

// ── Active credentials from .env:
const VAPI_PUBLIC_KEY   = import.meta.env.VITE_VAPI_PUBLIC_KEY || 'a2c52ad5-6121-4de8-b339-3876c597e16e';
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID || 'a2c52ad5-6121-4de8-b339-3876c597e16e';
const API_BASE          = '/api';

// ── Guest token helper ────────────────────────────────────────────────────────
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

// ── Post-Interview Sign-In / Sign-Up / Claim Modal ────────────────────────────
function PostInterviewModal({
  appId,
  phone,
  name,
  simOtp,
  onGuestContinue,
  onOtpSuccess,
}) {
  const [authTab, setAuthTab] = useState('register'); // 'register' | 'login' | 'otp'
  const [formData, setFormData] = useState({
    full_name: name || '',
    phone: phone || '',
    email: '',
    password: '',
  });
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [currentSimOtp, setCurrentSimOtp] = useState(simOtp);
  const { loginWithOtp, setUser } = useAuth();
  const navigate = useNavigate();

  // Update prefilled name/phone if parent updates
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      full_name: prev.full_name || name || '',
      phone: prev.phone || phone || '',
    }));
  }, [name, phone]);

  // 1. Create Account
  const handleRegister = async (e) => {
    if (e) e.preventDefault();
    if (!formData.full_name.trim()) {
      toast.error('Please enter your full name');
      return;
    }
    if (!formData.phone.trim() && !formData.email.trim()) {
      toast.error('Please enter your phone number or email');
      return;
    }
    if (!formData.password || formData.password.length < 4) {
      toast.error('Please enter a password (min 4 characters)');
      return;
    }

    setLoading(true);
    try {
      const regRes = await authAPI.register({
        full_name: formData.full_name.trim(),
        email: formData.email.trim() || `${formData.phone.replace(/\D/g, '') || 'user'}@helix.local`,
        phone: formData.phone.trim() || undefined,
        password: formData.password,
      });

      const { access_token, user: userData } = regRes.data;
      localStorage.setItem('helix_token', access_token);
      localStorage.setItem('helix_user', JSON.stringify(userData));
      if (setUser) setUser(userData);

      toast.success(`Account created! Welcome, ${userData.full_name}!`);

      // Claim guest application
      try {
        await authAPI.claimGuestSession({
          application_id: appId,
          guest_token: getOrCreateGuestToken(),
        });
      } catch (_) {}

      onOtpSuccess();
      navigate(`/requirements/${appId}`);
    } catch (err) {
      console.error('Register error:', err);
      toast.error(err.response?.data?.detail || 'Failed to create account. Please try signing in.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Sign In
  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!formData.phone.trim() && !formData.email.trim()) {
      toast.error('Please enter your phone or email');
      return;
    }
    if (!formData.password) {
      toast.error('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const logRes = await authAPI.login({
        phone: formData.phone.trim() || formData.email.trim(),
        password: formData.password,
      });

      const { access_token, user: userData } = logRes.data;
      localStorage.setItem('helix_token', access_token);
      localStorage.setItem('helix_user', JSON.stringify(userData));
      if (setUser) setUser(userData);

      toast.success(`Signed in! Welcome back, ${userData.full_name || 'User'}!`);

      // Claim guest application
      try {
        await authAPI.claimGuestSession({
          application_id: appId,
          guest_token: getOrCreateGuestToken(),
        });
      } catch (_) {}

      onOtpSuccess();
      navigate(`/requirements/${appId}`);
    } catch (err) {
      console.error('Login error:', err);
      toast.error(err.response?.data?.detail || 'Invalid credentials. Please check your phone/password.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Verify OTP
  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      toast.error('Please enter a 6-digit OTP');
      return;
    }
    setLoading(true);
    try {
      const res = await authAPI.verifyOtp({ phone: formData.phone || phone, otp_code: otp });
      const { access_token, user: userData } = res.data;
      loginWithOtp(access_token, userData);
      toast.success('Signed in successfully! Your project is saved.');
      try {
        await authAPI.claimGuestSession({
          application_id: appId,
          guest_token: getOrCreateGuestToken(),
        });
      } catch (_) {}
      onOtpSuccess();
      navigate(`/requirements/${appId}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    const p = formData.phone || phone;
    if (!p) return;
    setResending(true);
    try {
      const res = await authAPI.initiateOtp({ phone: p, name: formData.full_name || name });
      if (res.data?.simulated_otp) {
        setCurrentSimOtp(res.data.simulated_otp);
        toast.success(`New OTP: ${res.data.simulated_otp}`, { duration: 10000 });
      } else {
        toast.success('OTP sent to your phone!');
      }
    } catch (err) {
      toast.error('Failed to send OTP.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div
        className="w-full max-w-lg bg-white rounded-3xl p-7 shadow-2xl border border-gray-100 flex flex-col relative overflow-hidden max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: '0 25px 60px -15px rgba(99, 102, 241, 0.25)' }}
      >
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-100 rounded-full blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-100 rounded-full blur-3xl opacity-60 pointer-events-none" />

        {/* Modal Header */}
        <div className="text-center mb-5 relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center mx-auto mb-2.5 shadow-lg shadow-indigo-200">
            <Sparkles className="w-7 h-7 text-white animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            Requirements Captured!
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Create an account or sign in to save and download your complete specifications report.
          </p>
        </div>

        {/* Auth Tab Selector */}
        <div className="flex bg-slate-100 p-1 rounded-2xl mb-5 border border-slate-200/80">
          <button
            type="button"
            onClick={() => setAuthTab('register')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              authTab === 'register'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Account</span>
          </button>

          <button
            type="button"
            onClick={() => setAuthTab('login')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              authTab === 'login'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>

          {phone && (
            <button
              type="button"
              onClick={() => setAuthTab('otp')}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                authTab === 'otp'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Instant OTP</span>
            </button>
          )}
        </div>

        {/* 1. Create Account Tab */}
        {authTab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Your Name"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Mobile Number
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="10-digit mobile number"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Choose a password"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-indigo-200 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              <span>Create Account & Save Project</span>
            </button>
          </form>
        )}

        {/* 2. Sign In Tab */}
        {authTab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Mobile Number or Email
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Registered phone or email"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Enter your password"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-indigo-200 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              <span>Sign In & Save Project</span>
            </button>
          </form>
        )}

        {/* 3. Instant Phone OTP Tab */}
        {authTab === 'otp' && phone && (
          <div className="flex flex-col items-center">
            <p className="text-xs text-gray-500 mb-3 text-center">
              Enter the 6-digit verification code sent to <strong className="text-gray-800">{phone}</strong>
            </p>

            {currentSimOtp && (
              <div className="mb-4 w-full bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-2.5 text-xs text-center flex items-center justify-between">
                <div>
                  <span className="font-semibold block text-[11px] uppercase tracking-wider text-amber-700">Verification Code</span>
                  <span className="font-mono font-bold text-lg">{currentSimOtp}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOtp(currentSimOtp)}
                  className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Auto-fill
                </button>
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full text-center text-3xl font-mono font-bold tracking-[0.4em] px-4 py-3.5 rounded-2xl border-2 border-indigo-200 focus:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all bg-gray-50/50"
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
              autoFocus
            />

            <button
              onClick={handleVerifyOtp}
              disabled={loading || otp.length !== 6}
              className="w-full mt-4 py-3.5 rounded-2xl font-semibold text-white transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
              style={{
                background: otp.length === 6 ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' : '#9ca3af',
              }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify & Save Project'}
            </button>

            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resending}
              className="mt-3 text-xs text-indigo-600 hover:underline font-medium"
            >
              {resending ? 'Sending...' : 'Resend Code'}
            </button>
          </div>
        )}

        {/* Continue as Guest */}
        <div className="mt-5 pt-4 border-t border-gray-100 text-center">
          <button
            type="button"
            onClick={onGuestContinue}
            className="w-full py-2.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all flex items-center justify-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-gray-500" />
            <span>Continue as Guest (View & Download Specifications)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Interview Component ──────────────────────────────────────────────────
export default function Interview() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Step tracking: 'name' | 'phone' | 'questions'
  const [currentStep, setCurrentStep] = useState('name');

  // ── Voice States
  const [callStatus, setCallStatus] = useState('connecting'); // 'connecting' | 'active' | 'complete' | 'ended' | 'error'
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Spoken transcripts
  const [currentSpeech, setCurrentSpeech] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [currentQText, setCurrentQText] = useState('Hello! Welcome to Helix. What is your name?');
  const [typedText, setTypedText] = useState('');

  // Recorded Q&A items for user verification
  const [qaHistory, setQaHistory] = useState([]);
  const [questionsAnswered, setQuestionsAnswered] = useState(0);

  // Identity state
  const [capturedName, setCapturedName] = useState('');
  const [capturedPhone, setCapturedPhone] = useState('');

  // Coverage & Extractions
  const [coverage, setCoverage] = useState({
    overall_percent: 0,
    collected_fields: [],
    missing_fields: [],
    checklist: [],
    domain_label: null
  });
  const [extractions, setExtractions] = useState([]);
  const [totalCaptured, setTotalCaptured] = useState(0);

  // App & Modals
  const [appId, setAppId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [procStep, setProcStep] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showPostModal, setShowPostModal] = useState(false);
  const [simOtp, setSimOtp] = useState('');

  // ── Refs for Synchronous Live State (Guarantees Fresh Closures)
  const vapiRef = useRef(null);
  const appIdRef = useRef(null);
  const mounted = useRef(true);
  const callTimer = useRef(null);
  const guestToken = useRef(getOrCreateGuestToken());
  const capturedNameRef = useRef('');
  const capturedPhoneRef = useRef('');
  const currentStepRef = useRef('name');
  const currentQTextRef = useRef('Hello! Welcome to Helix. What is your name?');
  const currentSpeechRef = useRef('');
  const isCompletingRef = useRef(false);

  useEffect(() => { appIdRef.current = appId; }, [appId]);
  useEffect(() => { capturedNameRef.current = capturedName; }, [capturedName]);
  useEffect(() => { capturedPhoneRef.current = capturedPhone; }, [capturedPhone]);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { currentQTextRef.current = currentQText; }, [currentQText]);
  useEffect(() => { currentSpeechRef.current = currentSpeech; }, [currentSpeech]);

  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // ── 1. Create Guest Application in DB on Mount & Auto-Start Vapi
  useEffect(() => {
    mounted.current = true;

    async function initApp() {
      try {
        const appRes = await applicationsAPI.createGuest(guestToken.current);
        if (!mounted.current) return;
        const aid = appRes.data.id;
        setAppId(aid);
        appIdRef.current = aid;
        localStorage.setItem('helix_pending_app_id', String(aid));
        localStorage.setItem('helix_pending_guest_token', guestToken.current);
        console.log('[Helix] Initialized Application ID in SQLite:', aid);

        if (user) {
          if (user.full_name) {
            setCapturedName(user.full_name);
            capturedNameRef.current = user.full_name;
          }
          if (user.phone) {
            setCapturedPhone(user.phone);
            capturedPhoneRef.current = user.phone;
            setCurrentStep('questions');
          } else if (user.full_name) {
            setCurrentStep('phone');
          }
        }

        // Auto-start Vapi immediately on mount
        startVapi(aid);
      } catch (err) {
        console.error('[Helix] Init error:', err);
        if (mounted.current) {
          setCallStatus('error');
          setErrorMsg('Failed to initialize session.');
        }
      }
    }

    initApp();

    return () => {
      mounted.current = false;
      if (vapiRef.current) {
        try { vapiRef.current.stop(); } catch (_) {}
      }
      if (callTimer.current) clearInterval(callTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Complete Interview & Finalize Requirements in SQLite
  const handleCompleteInterview = useCallback(async () => {
    if (isCompletingRef.current) return;
    isCompletingRef.current = true;

    const aid = appIdRef.current;
    if (!aid) return;

    setCallStatus('complete');
    setProcessing(true);
    setProcStep('Generating your business requirements specification...');

    try {
      await axios.post(`${API_BASE}/vapi/complete-interview`, {
        application_id: aid,
      });
      toast.success('Requirements captured & saved to database!');

      const phone = capturedPhoneRef.current;
      const name = capturedNameRef.current;

      if (!user && phone) {
        try {
          const otpRes = await authAPI.initiateOtp({ phone, name });
          if (otpRes.data?.simulated_otp) {
            setSimOtp(otpRes.data.simulated_otp);
          }
        } catch (_) {}
      }

      if (user) {
        try {
          await authAPI.claimGuestSession({
            application_id: aid,
            guest_token: guestToken.current,
          });
        } catch (_) {}
        navigate(`/requirements/${aid}`);
      } else {
        // Immediately show the sign up / sign in modal
        setShowPostModal(true);
      }
    } catch (err) {
      console.error('[Helix] Error completing interview:', err);
      setShowPostModal(true);
    } finally {
      setProcessing(false);
      setProcStep('');
    }
  }, [user, navigate]);

  // ── 3. Parse and Persist Every Answer to SQLite DB & Verification List
  const handleUserSpokenAnswer = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    const aid = appIdRef.current;
    let name = capturedNameRef.current;
    let phone = capturedPhoneRef.current;

    // Read the live synchronous question text from ref
    const currentQ = currentSpeechRef.current.trim() || currentQTextRef.current.trim() || 'Business Requirements Consultation';

    // Step 1: Capture Name (only if not a business description)
    if (!name && currentStepRef.current === 'name') {
      const lower = text.toLowerCase().trim();
      const isBusinessSentence = lower.startsWith('i want') || lower.startsWith('we want') || lower.startsWith('i am building') || lower.startsWith('we are building') || lower.startsWith('this is a') || lower.includes('restaurant') || lower.includes('app') || lower.includes('software');
      
      if (!isBusinessSentence) {
        const nameMatch = text.match(/(?:my name is|i am|i'm|this is|call me|name's)\s+([a-zA-Z\s]{2,25})/i);
        if (nameMatch && nameMatch[1]) {
          const parsed = nameMatch[1].trim();
          name = parsed;
          setCapturedName(parsed);
          capturedNameRef.current = parsed;
          setCurrentStep('phone');
          toast.success(`Name recorded: ${parsed}`, { icon: '✓' });
        } else if (text.trim().split(/\s+/).length <= 3 && !text.includes('?')) {
          const parsed = text.replace(/[^a-zA-Z\s]/g, '').trim();
          if (parsed.length >= 2 && parsed.length <= 25) {
            name = parsed;
            setCapturedName(parsed);
            capturedNameRef.current = parsed;
            setCurrentStep('phone');
            toast.success(`Name recorded: ${parsed}`, { icon: '✓' });
          }
        }
      } else {
        setCurrentStep('questions');
      }
    }

    // Step 2: Capture Phone
    if (!phone) {
      const phoneDigits = text.replace(/\D/g, '');
      if (phoneDigits.length >= 10) {
        const normalized = phoneDigits.slice(-10);
        phone = normalized;
        setCapturedPhone(normalized);
        capturedPhoneRef.current = normalized;
        setCurrentStep('questions');
        toast.success(`Mobile number recorded: ${normalized}`, { icon: '✓' });
      }
    }

    // Add to recorded responses history for user verification
    setQaHistory((prev) => [
      ...prev,
      {
        question: currentQ,
        answer: text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        verified: true,
      },
    ]);

    // Sync profile to DB
    if (aid && (name || phone)) {
      try {
        await axios.post(`${API_BASE}/vapi/sync-profile`, {
          application_id: aid,
          name: name,
          phone: phone,
        });
      } catch (_) {}
    }

    // Save Q&A pair to DB
    if (aid) {
      try {
        const saveRes = await axios.post(`${API_BASE}/vapi/save-answer`, {
          application_id: aid,
          question: currentQ,
          answer: text,
          language: 'en-US',
        });
        const d = saveRes.data;
        if (d?.coverage) setCoverage(d.coverage);
        if (typeof d?.questions_answered === 'number') {
          setQuestionsAnswered(d.questions_answered);
        }
        if (d?.extraction || d?.ai_extraction) {
          const ext = d.extraction || d.ai_extraction;
          setExtractions((prev) => [...prev, ext]);
          setTotalCaptured((prev) => prev + (ext.requirements?.length || ext.key_points?.length || 1));
        }
      } catch (ex) {
        console.warn('[Helix] Error saving answer to DB:', ex);
      }
    }
  }, []);

  // ── 4. Start Vapi Voice Assistant (1-Click Instant Mic Pre-Unlock)
  const startVapi = async (targetAid) => {
    let aid = targetAid || appIdRef.current;
    if (!aid) {
      try {
        const appRes = await applicationsAPI.createGuest(guestToken.current);
        aid = appRes.data.id;
        setAppId(aid);
        appIdRef.current = aid;
      } catch (_) {}
    }

    setCallStatus('connecting');
    setErrorMsg('');
    isCompletingRef.current = false;

    try {
      // Pre-unlock mic in 1 click
      try {
        if (navigator?.mediaDevices?.getUserMedia) {
          const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          testStream.getTracks().forEach(t => t.stop());
        }
      } catch (micErr) {
        console.warn('[Vapi] Mic access check:', micErr);
      }

      // Destroy any previous instance
      if (vapiRef.current) {
        try { vapiRef.current.stop(); } catch (_) {}
        vapiRef.current = null;
      }

      console.log('[Vapi] Starting instant Vapi connection with Key:', VAPI_PUBLIC_KEY.slice(0, 8) + '...');
      const vapi = new Vapi(VAPI_PUBLIC_KEY);
      vapiRef.current = vapi;

      vapi.on('call-start', () => {
        if (!mounted.current) return;
        console.log('[Vapi] Call connected successfully!');
        setCallStatus('active');
        setIsListening(true);
        setIsSpeaking(false);
        let secs = 0;
        if (callTimer.current) clearInterval(callTimer.current);
        callTimer.current = setInterval(() => {
          if (mounted.current) setCallDuration(++secs);
        }, 1000);

        // Auto-send start signal so assistant immediately asks for Name without requiring user to say start twice
        setTimeout(() => {
          try {
            vapi.send({
              type: 'add-message',
              message: {
                role: 'user',
                content: 'Start the interview'
              }
            });
          } catch (_) {}
        }, 300);
      });

      vapi.on('call-end', () => {
        if (!mounted.current) return;
        console.log('[Vapi] Call ended');
        if (callTimer.current) clearInterval(callTimer.current);
        setIsListening(false);
        setIsSpeaking(false);
        handleCompleteInterview();
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
        if (currentSpeechRef.current) {
          currentQTextRef.current = currentSpeechRef.current;
          setCurrentQText(currentSpeechRef.current);
        }
      });

      vapi.on('message', (msg) => {
        if (!mounted.current) return;

        // 1. Assistant Speech Updates
        if (msg.type === 'speech-update' && msg.text) {
          const txt = msg.text.trim();
          // If assistant says "say start", automatically trigger next question
          if (txt.toLowerCase().includes('say "start"') || txt.toLowerCase().includes("say 'start'") || txt.toLowerCase().includes('just say start')) {
            try {
              vapi.send({ type: 'add-message', message: { role: 'user', content: 'Start' } });
            } catch (_) {}
          } else {
            currentSpeechRef.current = txt;
            currentQTextRef.current = txt;
            setCurrentSpeech(txt);
            setCurrentQText(txt);
            checkIfInterviewDone(txt);
          }
        }

        // 2. Conversation Updates
        if (msg.type === 'conversation-update') {
          const msgs = msg.conversation || msg.messages || [];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && msgs[i].content) {
              const txt = msgs[i].content.trim();
              if (!txt.toLowerCase().includes('just say start') && !txt.toLowerCase().includes("say 'start'")) {
                currentSpeechRef.current = txt;
                currentQTextRef.current = txt;
                setCurrentSpeech(txt);
                setCurrentQText(txt);
                checkIfInterviewDone(txt);
                break;
              }
            }
          }
        }

        // 3. Transcript Updates
        if (msg.type === 'transcript') {
          if (msg.role === 'user') {
            const txt = msg.transcript || '';
            if (msg.transcriptType === 'final') {
              setLiveTranscript('');
              if (txt.trim()) {
                handleUserSpokenAnswer(txt.trim());
              }
            } else {
              setLiveTranscript(txt);
            }
          } else if (msg.role === 'assistant') {
            const txt = (msg.transcript || '').trim();
            if (txt) {
              if (txt.toLowerCase().includes('say "start"') || txt.toLowerCase().includes("say 'start'") || txt.toLowerCase().includes('just say start')) {
                try {
                  vapi.send({ type: 'add-message', message: { role: 'user', content: 'Start' } });
                } catch (_) {}
              } else {
                currentSpeechRef.current = txt;
                currentQTextRef.current = txt;
                setCurrentSpeech(txt);
                setCurrentQText(txt);
                checkIfInterviewDone(txt);
              }
            }
          }
        }

        // 4. Tool calls
        if (msg.type === 'tool-calls-result' || msg.type === 'function-call-result') {
          const items = msg.toolCallList || msg.toolCalls || [];
          for (const item of items) {
            try {
              const result = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;
              if (!result) continue;

              if (result.coverage) setCoverage(result.coverage);
              if (typeof result.questions_answered === 'number') {
                setQuestionsAnswered(result.questions_answered);
              }
              if (result.extraction || result.ai_extraction) {
                const ext = result.extraction || result.ai_extraction;
                setExtractions((prev) => [...prev, ext]);
                setTotalCaptured((prev) => prev + (ext.requirements?.length || ext.key_points?.length || 1));
              }
              if (result.redirect_to || (result.success && msg.type.includes('complete'))) {
                handleCompleteInterview();
              }
            } catch (_) {}
          }
        }
      });

      vapi.on('error', (err) => {
        if (!mounted.current) return;
        console.error('[Vapi] error event:', err);
        const rawMsg = err?.error?.message ?? err?.message ?? err;
        const safeMsg = typeof rawMsg === 'string' ? rawMsg : 'Voice connection error';
        if (callStatus !== 'active') {
          setErrorMsg(safeMsg);
          setCallStatus('error');
        }
      });

      // Start call with direct firstMessage override asking for name
      await vapi.start(VAPI_ASSISTANT_ID, {
        firstMessage: "Hello! Welcome to Helix. Before we dive into your project, could you please tell me your name?"
      });

    } catch (err) {
      console.error('[Vapi] start error:', err);
      if (mounted.current) {
        setCallStatus('error');
        setErrorMsg('Microphone access needed. Click Start Voice to allow.');
      }
    }
  };

  // Helper to detect completion speech
  const checkIfInterviewDone = (text) => {
    if (!text) return;
    const lower = text.toLowerCase();
    if (
      lower.includes('requirements have been captured') ||
      lower.includes('please sign in') ||
      lower.includes('sign in to view your full requirements') ||
      lower.includes('congratulations! your requirements') ||
      lower.includes('all your requirements are captured')
    ) {
      setTimeout(() => {
        handleCompleteInterview();
      }, 1500);
    }
  };

  // Typed text fallback
  const submitTyped = async () => {
    const t = typedText.trim();
    if (!t || processing) return;
    setTypedText('');
    setProcessing(true);
    setProcStep('Recording...');

    try {
      await handleUserSpokenAnswer(t);
      toast.success('Response recorded!');
    } catch (_) {
      toast.error('Failed to record response.');
    } finally {
      setProcessing(false);
      setProcStep('');
    }
  };

  const toggleMute = () => {
    if (!vapiRef.current) return;
    const nextMuted = !isMuted;
    try {
      vapiRef.current.setMuted(nextMuted);
      setIsMuted(nextMuted);
    } catch (_) {}
  };

  const stopCall = () => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch (_) {}
    }
    handleCompleteInterview();
  };

  const progressPercent = coverage.overall_percent || Math.min(questionsAnswered * 12, 100);

  const statusConfig = {
    ready:        { dot: 'bg-indigo-400', label: 'Helix Voice AI Ready' },
    connecting:   { dot: 'bg-amber-400 animate-pulse', label: 'Connecting to Vapi Consultant...' },
    active:       { dot: isSpeaking ? 'bg-indigo-600 animate-pulse' : 'bg-emerald-500 animate-pulse', label: isSpeaking ? 'Helix is speaking...' : 'Listening to you...' },
    complete:     { dot: 'bg-emerald-500', label: 'Interview complete! ✓' },
    ended:        { dot: 'bg-gray-400', label: 'Call ended' },
    error:        { dot: 'bg-rose-500', label: 'Ready to connect' },
  };
  const cfg = statusConfig[callStatus] || statusConfig.ready;

  return (
    <div className="min-h-screen bg-[#F8FAFC] pt-[67px] flex flex-col">

      {/* Top Header Bar */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-6 py-3.5 flex items-center justify-between shadow-xs sticky top-[67px] z-20">
        <div className="flex items-center gap-3">
          <div className="bg-slate-50 border border-slate-200/80 rounded-full px-3.5 py-1 flex items-center gap-2 shadow-2xs">
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            <span className="text-xs font-semibold text-slate-700">{cfg.label}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 bg-indigo-50/80 border border-indigo-100 rounded-full px-3 py-1 text-xs text-indigo-700 font-semibold">
            <span>Step:</span>
            <span className="capitalize font-bold text-indigo-900">
              {currentStep === 'name' ? '1. Name Verification' : currentStep === 'phone' ? '2. Mobile Number' : '3. Questionnaire'}
            </span>
          </div>

          {callStatus === 'active' && (
            <div className="bg-slate-100 border border-slate-200 rounded-full px-3 py-1 text-xs font-mono text-slate-600">
              {formatDuration(callDuration)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Understanding</span>
            <span className="text-sm font-bold text-indigo-600">{progressPercent}%</span>
            <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {callStatus === 'active' ? (
            <button
              onClick={stopCall}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3.5 py-1.5 rounded-full transition-colors flex items-center gap-1"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Finish Interview</span>
            </button>
          ) : (
            <button
              onClick={startVapi}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3.5 py-1.5 rounded-full transition-colors flex items-center gap-1 shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Voice</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Two-Column Body */}
      <main className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-67px-57px)] overflow-hidden">

        {/* Left Column: Interactive Voice Avatar, Live Speech & Text Input */}
        <section className="flex-1 flex flex-col items-center justify-between p-6 md:p-8 overflow-y-auto border-r border-slate-200">

          <div className="w-full max-w-2xl flex flex-col items-center my-auto">

            {/* AI Avatar Pulse & Waveform */}
            <div className="relative w-28 h-28 mb-5">
              <div
                className={`absolute inset-0 rounded-full transition-all duration-500 ${
                  isSpeaking
                    ? 'ring-8 ring-indigo-400/40 ring-offset-4 ring-offset-[#F8FAFC]'
                    : isListening
                    ? 'ring-8 ring-emerald-400/40 ring-offset-4 ring-offset-[#F8FAFC]'
                    : ''
                }`}
              />
              <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-200">
                <Sparkles className={`w-10 h-10 text-white ${isSpeaking ? 'animate-bounce' : ''}`} />
              </div>
            </div>

            {/* Audio Wave Bars */}
            <div className="flex items-end gap-1 h-7 mb-5">
              {[4, 7, 10, 6, 9, 5, 8, 12, 7, 4, 9, 6, 11, 5, 8].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 3.5,
                    height: isSpeaking || isListening ? `${h * 2.2}px` : '4px',
                    backgroundColor: isSpeaking ? '#4f46e5' : isListening ? '#10b981' : '#cbd5e1',
                    borderRadius: 4,
                    transition: `height ${0.1 + i * 0.02}s ease-in-out`,
                    animation: isSpeaking || isListening ? `pulse 0.7s ease-in-out ${i * 0.05}s infinite alternate` : 'none',
                  }}
                />
              ))}
            </div>

            {/* Speech Bubble: Live Helix Question */}
            <div className="w-full bg-white border border-slate-200 rounded-3xl p-6 shadow-sm mb-4 relative overflow-hidden" style={{ borderLeft: '4px solid #4f46e5' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest">
                  Helix Consultant
                </span>
                {isSpeaking && (
                  <span className="text-[10px] text-indigo-600 ml-auto font-semibold animate-pulse">
                    Speaking...
                  </span>
                )}
              </div>
              <p className="text-base md:text-lg font-semibold text-slate-900 leading-relaxed">
                {currentSpeech || currentQText || 'Hello! Welcome to Helix. Could you please tell me your name?'}
                {isSpeaking && <span className="inline-block w-1 h-4 bg-indigo-500 ml-1.5 animate-pulse" />}
              </p>
            </div>

            {/* User Live Transcription Bubble */}
            {liveTranscript && (
              <div className="w-full bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 mb-4 shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">
                    You are saying...
                  </span>
                </div>
                <p className="text-base text-slate-800 font-medium">
                  {liveTranscript}
                </p>
              </div>
            )}

            {/* Processing Waveform */}
            {processing && <AiProcessingWaveform procStep={procStep} />}
          </div>

          {/* Bottom Control & Text Input Bar (Always Rendered & Interactive) */}
          <div className="w-full max-w-2xl mt-auto pt-2">
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-full p-2 shadow-lg shadow-slate-100">
              <button
                type="button"
                onClick={toggleMute}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                  isMuted
                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <input
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitTyped(); }}
                placeholder={
                  isSpeaking
                    ? 'Helix is speaking...'
                    : currentStep === 'name'
                    ? 'Type your name (or speak)...'
                    : currentStep === 'phone'
                    ? 'Type your 10-digit mobile number...'
                    : 'Speak your answer, or type here...'
                }
                disabled={processing}
                className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none"
              />

              <button
                type="button"
                onClick={submitTyped}
                disabled={!typedText.trim() || processing}
                className="w-9 h-9 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-600 disabled:opacity-40 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={stopCall}
                className="w-9 h-9 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors flex-shrink-0"
                title="Finish and generate requirements"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>

            <p className="text-center text-xs text-slate-400 mt-2">
              {isMuted ? 'Microphone muted' : 'Vapi AI Voice Active — speak naturally anytime or type your answer'}
            </p>
          </div>
        </section>

        {/* Right Column: Recorded Responses & Verification Panel */}
        <aside className="w-full lg:w-[420px] bg-white p-6 overflow-y-auto flex flex-col gap-5 border-t lg:border-t-0 lg:border-l border-slate-200">

          {/* Captured User Profile Verification Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <span>Verified Profile Details</span>
            </h4>
            <div className="space-y-2">
              <div className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${capturedName ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-white border-slate-200 text-slate-500'}`}>
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium">Name:</span>
                  <span className="font-bold">{capturedName || 'Listening for name...'}</span>
                </div>
                {capturedName && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </div>

              <div className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${capturedPhone ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-white border-slate-200 text-slate-500'}`}>
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium">Mobile:</span>
                  <span className="font-bold">{capturedPhone || 'Listening for mobile #...'}</span>
                </div>
                {capturedPhone && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </div>
            </div>
          </div>

          {/* Live Recorded Responses History (User Verification) */}
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-indigo-600" />
                <span>Recorded Responses ({qaHistory.length})</span>
              </h4>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                Saved in DB
              </span>
            </div>

            {qaHistory.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400 my-auto">
                <Sparkles className="w-5 h-5 mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-medium text-slate-600">Your recorded responses will appear here</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Every response is stored in real-time for your verification.</p>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-[380px] pr-1">
                {qaHistory.map((item, idx) => (
                  <div key={idx} className="border border-slate-200/90 rounded-2xl p-3.5 bg-white shadow-2xs">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1.5">
                      <span className="text-indigo-600 font-bold">Response #{idx + 1}</span>
                      <span className="text-slate-400">{item.timestamp}</span>
                    </div>
                    <p className="text-xs text-slate-600 font-medium mb-1.5 line-clamp-2">
                      <strong className="text-slate-700">Q:</strong> {item.question}
                    </p>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-2 text-xs text-slate-900 font-semibold flex items-start gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>{item.answer}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Complete button */}
          {callStatus === 'complete' && (
            <button
              onClick={() => {
                if (user && appId) navigate(`/requirements/${appId}`);
                else setShowPostModal(true);
              }}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold text-sm transition-all shadow-md flex items-center justify-center gap-2 mt-auto"
            >
              <FileText className="w-4 h-4" />
              <span>View Generated Requirements</span>
            </button>
          )}
        </aside>
      </main>

      {/* Post-Interview Modal (Verify OTP / Sign In / Sign Up / Guest) */}
      {showPostModal && (
        <PostInterviewModal
          appId={appId}
          phone={capturedPhone}
          name={capturedName}
          simOtp={simOtp}
          onGuestContinue={() => {
            setShowPostModal(false);
            if (appId) navigate(`/requirements/${appId}`);
          }}
          onOtpSuccess={() => {
            setShowPostModal(false);
            if (appId) navigate(`/requirements/${appId}`);
            else navigate('/dashboard');
          }}
          onNavigateLogin={() => {
            setShowPostModal(false);
            navigate(`/login?claim_app=${appId}`);
          }}
          onNavigateRegister={() => {
            setShowPostModal(false);
            navigate(`/register?claim_app=${appId}`);
          }}
        />
      )}
    </div>
  );
}
