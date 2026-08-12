/**
 * Interview.jsx — Helix Voice Interview
 *
 * Uses raw Web Speech API directly (no hooks wrapper) so there are zero
 * abstraction-layer timing issues.  The lifecycle is:
 *
 *   speak(text, onDone)
 *     → SpeechSynthesisUtterance fires onend
 *     → onDone() → openMic()
 *       → recognition.start()
 *         → onresult fires → update liveTranscript
 *         → isFinal → 1.8 s silence timer → submitAnswer()
 *           → stopMic() → API call → speak(nextQuestion, ...) → loop
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { interviewAPI, applicationsAPI, requirementsAPI, authAPI } from '../services/api';
import { parseSpokenPhone, isValid10DigitPhone } from '../utils/phoneParser';
import {
  Mic, MicOff, RotateCcw, X, Sparkles, ArrowRight,
  Volume2, VolumeX, CheckCircle2, Circle, MinusCircle, Send
} from 'lucide-react';
import toast from 'react-hot-toast';
import AiProcessingWaveform from '../components/AiProcessingWaveform';

// ─── Guest token ────────────────────────────────────────────────────────────
function getOrCreateGuestToken() {
  let t = localStorage.getItem('helix_guest_token');
  if (!t) {
    t = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('helix_guest_token', t);
  }
  return t;
}

const PHASES = {
  NAME: 'name',
  PHONE: 'phone',
  QUESTIONS: 'questions',
  OTP: 'otp',
};

// ─── Raw TTS helper (bypasses useSpeechSynthesis hook) ──────────────────────
function rawSpeak(text, onDone, opts = {}) {
  if (!window.speechSynthesis) { onDone?.(); return; }
  window.speechSynthesis.cancel();

  let spokenText = text.replace(/\b(\d{10})\b/g, (match) =>
    match.split('').join(' ')
  );
  spokenText = spokenText
    .replace(/\b0\b/g, 'zero')
    .replace(/[*_#`~]/g, '')
    .replace(/\//g, ' or ')
    .replace(/\s+/g, ' ')
    .trim();

  const utter = new SpeechSynthesisUtterance(spokenText);
  const langCode = opts.langCode || 'en-US';
  utter.lang   = langCode;
  utter.rate   = opts.rate   ?? 0.93; // Sweet, unhurried human pace
  utter.pitch  = opts.pitch  ?? 1.16; // Warm, cheerful female tone
  utter.volume = opts.volume ?? 1.0;

  // Select sweet, natural female voice
  const voices = window.speechSynthesis.getVoices();
  const langPrefix = langCode.split('-')[0].toLowerCase();
  const pick =
    voices.find(v => v.lang.toLowerCase().startsWith(langPrefix) && /natural|neural|online|female|jenny|aria|sonia|swara|neerja|samantha|victoria|karen|moira/i.test(v.name)) ||
    voices.find(v => v.lang.toLowerCase().startsWith(langPrefix) && !/male|david|mark|george|stefan|ravi/i.test(v.name)) ||
    voices.find(v => /jenny.*natural|aria.*natural|sonia.*natural/i.test(v.name)) ||
    voices.find(v => /google uk english female|google us english/i.test(v.name)) ||
    voices.find(v => /samantha|victoria|karen|moira|zira/i.test(v.name)) ||
    voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase()) ||
    voices[0];
  if (pick) utter.voice = pick;

  // GC prevention
  const w = window;
  w.__helixUtterances = w.__helixUtterances || new Set();
  w.__helixUtterances.add(utter);
  const cleanup = () => { w.__helixUtterances.delete(utter); };

  utter.onend   = () => { cleanup(); onDone?.(); };
  utter.onerror = (e) => {
    cleanup();
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    console.warn('[TTS] error:', e.error);
    onDone?.();
  };

  // Some browsers need a tiny delay after cancel() before speak()
  setTimeout(() => window.speechSynthesis.speak(utter), 80);
}

export default function Interview() {
  const { user, loginWithOtp, voiceEnabled, setVoiceEnabled } = useAuth();
  const navigate = useNavigate();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [phase,            setPhase]            = useState(PHASES.NAME);
  const [appId,            setAppId]            = useState(null);
  const [currentQ,         setCurrentQ]         = useState(1);
  const [currentQText,     setCurrentQText]     = useState('');
  const [processing,       setProcessing]       = useState(false);
  const [procStep,         setProcStep]         = useState('');
  const [answers,          setAnswers]          = useState({});
  const [extractions,      setExtractions]      = useState([]);
  const [totalCaptured,    setTotalCaptured]    = useState(0);
  const [coverage,         setCoverage]         = useState({ overall_percent: 0, collected_fields: [], missing_fields: [], checklist: [], domain: null, domain_label: null });
  const [interviewDone,    setInterviewDone]    = useState(false);
  const [userName,         setUserName]         = useState('');
  const [userPhone,        setUserPhone]        = useState('');
  const [otpCode,          setOtpCode]          = useState('');
  const [simOtp,           setSimOtp]           = useState('');
  const [micMuted,         setMicMuted]         = useState(false);
  const [listening,        setListening]        = useState(false);
  const [agentSpeaking,    setAgentSpeaking]    = useState(false);
  const [liveText,         setLiveText]         = useState('');
  const [typedText,        setTypedText]        = useState('');
  const [langCode,         setLangCode]         = useState('en-US');
  const [lockedLang,       setLockedLang]       = useState('English');

  // ── Stable refs (never stale in callbacks) ───────────────────────────────
  const mounted        = useRef(true);
  const guestToken     = useRef(getOrCreateGuestToken());
  const appIdRef       = useRef(null);
  const phaseRef       = useRef(PHASES.NAME);
  const userNameRef    = useRef('');
  const userPhoneRef   = useRef('');
  const liveTextRef    = useRef('');
  const micMutedRef    = useRef(false);
  const agentSpkRef    = useRef(false);
  const processingRef  = useRef(false);
  const ansCountRef    = useRef(0);
  const currentQRef    = useRef(1);
  const langRef        = useRef('en-US');
  const silTimer          = useRef(null);
  const keepAliveTimer    = useRef(null);
  const recRef            = useRef(null);   // raw SpeechRecognition instance
  const recRunning        = useRef(false);  // true while recognition is started
  const voiceEnabledRef   = useRef(voiceEnabled);
  const hasStarted        = useRef(false);
  const doSubmitAnswerRef = useRef(null);   // always-fresh ref to doSubmitAnswer

  // keep refs in sync with state
  useEffect(() => { phaseRef.current        = phase; },        [phase]);
  useEffect(() => { userNameRef.current     = userName; },     [userName]);
  useEffect(() => { userPhoneRef.current    = userPhone; },    [userPhone]);
  useEffect(() => { appIdRef.current        = appId; },        [appId]);
  useEffect(() => { micMutedRef.current     = micMuted; },     [micMuted]);
  useEffect(() => { agentSpkRef.current     = agentSpeaking; },[agentSpeaking]);
  useEffect(() => { processingRef.current   = processing; },   [processing]);
  useEffect(() => { langRef.current         = langCode; },     [langCode]);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);
  useEffect(() => { currentQRef.current     = currentQ; },     [currentQ]);

  // ── SpeechRecognition setup (once on mount) ───────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('[REC] SpeechRecognition not supported'); return; }

    const rec = new SR();
    // continuous=true: recognition keeps running; no premature onend race condition
    rec.continuous     = true;
    rec.interimResults = true;
    rec.lang           = 'en-US';
    recRef.current     = rec;

    rec.onstart = () => {
      recRunning.current = true;
      if (mounted.current) setListening(true);
      console.log('[REC] started');
    };

    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const full = (final + interim).trim();
      liveTextRef.current = full;
      if (mounted.current) {
        setLiveText(full);
        setTypedText(full);
      }

      // on final result → start silence countdown
      // KEY FIX: capture `capturedText` NOW (not from ref later)
      // because openMic() clears liveTextRef before the timer fires
      if (final.trim()) {
        const capturedText = final.trim(); // captured immediately, won't be cleared
        if (silTimer.current) clearTimeout(silTimer.current);
        silTimer.current = setTimeout(() => {
          if (!mounted.current || agentSpkRef.current || processingRef.current) return;
          if (capturedText) doSubmitAnswerRef.current?.(capturedText);
        }, 1800);
      }
    };

    rec.onerror = (e) => {
      console.warn('[REC] error:', e.error);
      recRunning.current = false;
      if (mounted.current) setListening(false);
      // restart after no-speech / network errors
      if (e.error !== 'aborted') scheduleRestart(500);
    };

    rec.onend = () => {
      console.log('[REC] ended (continuous stopped)');
      recRunning.current = false;
      if (mounted.current) setListening(false);
      // Only restart if we're supposed to be listening
      if (!micMutedRef.current && !agentSpkRef.current && !processingRef.current && mounted.current) {
        scheduleRestart(400);
      }
    };

    return () => {
      mounted.current = false;
      try { rec.abort(); } catch (_) {}
      if (silTimer.current) clearTimeout(silTimer.current);
      if (keepAliveTimer.current) clearTimeout(keepAliveTimer.current);
      window.speechSynthesis?.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep recognition lang in sync
  useEffect(() => {
    if (recRef.current) recRef.current.lang = langCode;
  }, [langCode]);

  function scheduleRestart(delayMs = 300) {
    if (keepAliveTimer.current) clearTimeout(keepAliveTimer.current);
    keepAliveTimer.current = setTimeout(() => {
      openMic();
    }, delayMs);
  }

  function openMic() {
    if (!mounted.current) return;
    if (micMutedRef.current) return;
    if (agentSpkRef.current) return;
    if (processingRef.current) return;
    if (!recRef.current) return;
    if (recRunning.current) return; // already running

    liveTextRef.current = '';
    if (mounted.current) { setLiveText(''); setTypedText(''); }
    try {
      recRef.current.lang = langRef.current;
      recRef.current.start();
      console.log('[REC] start() called');
    } catch (e) {
      console.warn('[REC] start() threw:', e.message);
      recRunning.current = false;
    }
  }

  function closeMic() {
    if (silTimer.current) { clearTimeout(silTimer.current); silTimer.current = null; }
    if (keepAliveTimer.current) { clearTimeout(keepAliveTimer.current); keepAliveTimer.current = null; }
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch (_) {}
    recRunning.current = false;
  }

  // ── Agent speak wrapper ───────────────────────────────────────────────────
  const agentSpeak = useCallback((text, onDone) => {
    if (!mounted.current) return;
    closeMic();
    setAgentSpeaking(true);
    agentSpkRef.current = true;
    console.log('[TTS] speaking:', text.slice(0, 60));

    if (!voiceEnabledRef.current) {
      // voice muted — skip TTS, go directly to mic
      setAgentSpeaking(false);
      agentSpkRef.current = false;
      onDone?.();
      return;
    }

    rawSpeak(text, () => {
      if (!mounted.current) return;
      setAgentSpeaking(false);
      agentSpkRef.current = false;
      onDone?.();
    }, { langCode: langRef.current });
  }, []);

  // ── Submit answer ─────────────────────────────────────────────────────────
  const doSubmitAnswer = useCallback(async (text) => {
    closeMic();
    liveTextRef.current = '';
    if (mounted.current) { setLiveText(''); setTypedText(''); }

    const p = phaseRef.current;
    console.log('[Interview] submitAnswer phase=', p, 'text=', text);

    // ── NAME phase ──────────────────────────────────────────────────────────
    if (p === PHASES.NAME) {
      if (!text) {
        agentSpeak("I couldn't hear you. Could you please tell me your name?", openMic);
        return;
      }
      setUserName(text); userNameRef.current = text;
      setPhase(PHASES.PHONE); phaseRef.current = PHASES.PHONE;
      agentSpeak(`Thank you, ${text}! And what is your phone number?`, openMic);
      return;
    }

    // ── PHONE phase ─────────────────────────────────────────────────────────
    if (p === PHASES.PHONE) {
      let phone = parseSpokenPhone(text);
      if (phone.length > 10) phone = phone.slice(-10);
      if (!isValid10DigitPhone(phone)) {
        agentSpeak("I couldn't get a valid phone number. Please say your 10-digit number.", openMic);
        return;
      }
      setUserPhone(phone); userPhoneRef.current = phone;
      setProcessing(true); processingRef.current = true;
      setProcStep('analyzing');
      try {
        const res = await authAPI.initiateOtp({ phone, name: userNameRef.current });
        if (!mounted.current) return;
        if (res.data.simulated_otp) {
          setSimOtp(res.data.simulated_otp);
          toast.success(`[Helix SMS] OTP: ${res.data.simulated_otp}`, { duration: 10000 });
        }
        setPhase(PHASES.QUESTIONS); phaseRef.current = PHASES.QUESTIONS;
      } catch (err) {
        toast.error('Failed to register. Please try again.');
        agentSpeak("Let's try again. What is your phone number?", openMic);
      } finally {
        if (mounted.current) { setProcessing(false); processingRef.current = false; setProcStep(''); }
      }
      return;
    }

    // ── OTP phase ───────────────────────────────────────────────────────────
    if (p === PHASES.OTP) {
      const otp = text.replace(/\D/g, '');
      if (otp.length !== 6) {
        agentSpeak('OTP must be 6 digits. Please say your OTP code.', openMic);
        return;
      }
      handleOtpSubmit(otp);
      return;
    }

    // ── QUESTIONS phase ─────────────────────────────────────────────────────
    if (!text) {
      agentSpeak("I didn't catch that. Could you repeat your answer?", openMic);
      return;
    }
    setProcessing(true); processingRef.current = true;
    setProcStep('analyzing');
    try {
      let res;
      if (user) {
        res = await interviewAPI.processText(appIdRef.current, { answer_text: text });
      } else {
        res = await interviewAPI.processTextGuest(appIdRef.current, guestToken.current, { answer_text: text });
      }
      if (!mounted.current) return;
      setProcStep('done');
      setTimeout(() => {
        if (!mounted.current) return;
        setProcStep('');
        setProcessing(false); processingRef.current = false;
        handleResponse(res.data);
      }, 400);
    } catch (err) {
      console.error('[Interview] processText error:', err);
      toast.error('Failed to process answer.');
      if (mounted.current) { setProcessing(false); processingRef.current = false; setProcStep(''); }
      agentSpeak("I had trouble processing that. Please try again.", openMic);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, agentSpeak]);

  // Keep the ref always pointing to the latest doSubmitAnswer.
  // The onresult closure (set up once at mount) calls this ref so it never goes stale.
  doSubmitAnswerRef.current = doSubmitAnswer;

  // ── Handle backend response ───────────────────────────────────────────────
  const handleResponse = useCallback((data) => {
    if (!mounted.current) return;
    setAnswers(prev => ({ ...prev, [currentQRef.current]: data.transcribed_text || '' }));
    ansCountRef.current += 1;
    if (data.ai_extraction) {
      setExtractions(prev => [...prev, { q: currentQRef.current, ...data.ai_extraction }]);
      setTotalCaptured(prev => prev + (data.ai_extraction.requirements?.length || 1));
    }
    if (data.coverage) setCoverage(data.coverage);
    const lang = data.language_code || 'en-US';
    if (data.language_code) { setLangCode(lang); langRef.current = lang; }
    if (data.language_context?.locked_language) { setLockedLang(data.language_context.locked_language); }

    if (data.contradiction) toast.error(data.contradiction, { duration: 6000 });

    if (data.interview_complete) {
      setInterviewDone(true);
      if (user) {
        agentSpeak('Excellent! The interview is complete. Generating your requirements now...', () => {
          handleGenerateRequirements();
        });
      } else {
        setPhase(PHASES.OTP); phaseRef.current = PHASES.OTP;
        if (userPhoneRef.current && isValid10DigitPhone(userPhoneRef.current)) {
          authAPI.initiateOtp({ phone: userPhoneRef.current, name: userNameRef.current })
            .then(r => { if (r.data.simulated_otp) { setSimOtp(r.data.simulated_otp); toast.success(`[Helix SMS] OTP: ${r.data.simulated_otp}`, { duration: 10000 }); } })
            .catch(() => {});
        }
        agentSpeak('Excellent! The interview is complete. Please verify your OTP to sign in.', openMic);
      }
    } else if (data.next_question) {
      setCurrentQText(data.next_question);
      setCurrentQ(prev => prev + 1);
      agentSpeak(data.next_question, openMic);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, agentSpeak]);

  // ── Fetch first business question ─────────────────────────────────────────
  const fetchFirstQuestion = useCallback(async () => {
    if (!mounted.current) return;
    setProcessing(true); processingRef.current = true;
    setProcStep('analyzing');
    try {
      const isGuest = !user;
      let res;
      if (isGuest) {
        res = await interviewAPI.firstQuestionGuest(appIdRef.current, guestToken.current);
      } else {
        res = await interviewAPI.firstQuestion(appIdRef.current);
      }
      if (!mounted.current) return;

      let questionText = res.data.question;
      if (res.data.question_number === 1 || res.data.question_number === undefined) {
        const collectedName = userName || (user && user.full_name) || '';
        const firstName = collectedName.trim().split(/\s+/)[0];
        const formattedName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : '';
        if (formattedName) {
          questionText = `Hey ${formattedName}! Tell me about the business idea you're thinking about.`;
        } else {
          questionText = "Hey! Tell me about the business idea you're thinking about.";
        }
      }

      setCurrentQText(questionText);
      setCurrentQ(res.data.question_number || 1);
      if (res.data.coverage) setCoverage(res.data.coverage);
      const lang = res.data.language_code || 'en-US';
      if (res.data.language_code) { setLangCode(lang); langRef.current = lang; }
      agentSpeak(questionText, openMic);
    } catch (err) {
      console.error('[Interview] fetchFirstQuestion error:', err);
      toast.error('Failed to load first question.');
    } finally {
      if (mounted.current) { setProcessing(false); processingRef.current = false; setProcStep(''); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userName, agentSpeak]);

  useEffect(() => {
    if (phase === PHASES.QUESTIONS && appId) fetchFirstQuestion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, appId]);

  // ── Generate requirements ─────────────────────────────────────────────────
  const handleGenerateRequirements = useCallback(async () => {
    if (!user) {
      localStorage.setItem('helix_pending_guest_token', guestToken.current);
      localStorage.setItem('helix_pending_app_id', String(appIdRef.current));
      agentSpeak('Please sign in to save and view your requirements.');
      setTimeout(() => navigate('/login?claim=true'), 2000);
      return;
    }
    setProcessing(true);
    try {
      await requirementsAPI.generate({ application_id: appIdRef.current });
      toast.success('Requirements generated!');
      ansCountRef.current = 99;
      navigate(`/requirements/${appIdRef.current}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to generate requirements.');
      if (mounted.current) setProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate, agentSpeak]);

  // ── OTP helpers ───────────────────────────────────────────────────────────
  const handleGenerateOtp = useCallback(async (phoneVal) => {
    let phone = parseSpokenPhone((phoneVal || userPhone).trim());
    if (phone.length > 10) phone = phone.slice(-10);
    if (!isValid10DigitPhone(phone)) { toast.error('Please enter a valid 10-digit phone number'); return; }
    setProcessing(true);
    try {
      const res = await authAPI.initiateOtp({ phone, name: userNameRef.current });
      if (!mounted.current) return;
      if (res.data.simulated_otp) { setSimOtp(res.data.simulated_otp); toast.success(`[Helix SMS] OTP: ${res.data.simulated_otp}`, { duration: 10000 }); }
      else toast.success(`OTP sent to ${phone}`);
    } catch (err) { toast.error('Failed to send OTP.'); }
    finally { if (mounted.current) setProcessing(false); }
  }, [userPhone]);

  const handleOtpSubmit = useCallback(async (otpCodeVal) => {
    const code = (otpCodeVal || otpCode).toString().replace(/\D/g, '');
    if (!code || code.length !== 6) { toast.error('Please enter a valid 6-digit OTP.'); agentSpeak('OTP must be 6 digits.', openMic); return; }
    setProcessing(true); processingRef.current = true; setProcStep('analyzing');
    try {
      const authRes = await authAPI.verifyOtp({ phone: userPhoneRef.current, otp_code: code });
      if (!mounted.current) return;
      const { access_token, user: userData } = authRes.data;
      loginWithOtp(access_token, userData);
      try {
        await interviewAPI.claimGuestSession(guestToken.current, appIdRef.current);
      } catch (err) {
        console.warn('[Interview] claimGuestSession warning:', err);
      }
      setProcStep('done');
      try {
        await requirementsAPI.generate({ application_id: appIdRef.current, guest_token: guestToken.current });
      } catch (err) {
        console.warn('[Interview] generate requirements warning:', err);
      }
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      ansCountRef.current = 99;
      agentSpeak('Welcome! Redirecting to your requirements page.');
      setTimeout(() => navigate(`/requirements/${appIdRef.current}`), 1200);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Invalid OTP. Please try again.';
      toast.error(msg);
      agentSpeak('That OTP was incorrect. Please try again.', openMic);
    } finally {
      if (mounted.current) { setProcessing(false); processingRef.current = false; setProcStep(''); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpCode, loginWithOtp, navigate, agentSpeak]);

  // ── Auto-start interview on mount ─────────────────────────────────────────
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function startInterview() {
      try {
        const res = await applicationsAPI.createGuest(guestToken.current);
        localStorage.setItem('helix_pending_guest_token', guestToken.current);
        if (!mounted.current) return;
        setAppId(res.data.id);
        appIdRef.current = res.data.id;
        localStorage.setItem('helix_pending_app_id', String(res.data.id));
        agentSpeak(
          "Welcome to Helix! Let's get started. Could you please tell me your name?",
          openMic
        );
      } catch (err) {
        console.error('[Interview] start error:', err);
        toast.error(err?.response?.data?.detail || 'Failed to start interview.');
      }
    }

    startInterview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closeMic();
      window.speechSynthesis?.cancel();
      if (appIdRef.current && ansCountRef.current < 2) {
        applicationsAPI.delete(appIdRef.current).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replayQuestion = () => {
    closeMic();
    const text =
      phase === PHASES.NAME ? "Welcome to Helix! Could you please tell me your name?"
      : phase === PHASES.PHONE ? `Thank you, ${userName}! What is your phone number?`
      : currentQText;
    agentSpeak(text, openMic);
  };

  const toggleMic = () => {
    if (micMuted) {
      setMicMuted(false); micMutedRef.current = false;
      if (!agentSpkRef.current && !processingRef.current) openMic();
    } else {
      setMicMuted(true); micMutedRef.current = true;
      closeMic();
    }
  };

  const toggleVoice = () => {
    if (voiceEnabled) window.speechSynthesis?.cancel();
    setVoiceEnabled(!voiceEnabled);
  };

  const submitTyped = async () => {
    const t = typedText.trim();
    if (!t || processing) return;
    setTypedText('');
    liveTextRef.current = t;
    await doSubmitAnswer(t);
  };

  const progressPercent =
    phase === PHASES.NAME || phase === PHASES.PHONE ? 0
    : phase === PHASES.OTP ? 100
    : coverage.overall_percent;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F6F7FE] pt-[67px]">

      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white border border-gray-100 rounded-full px-4 py-1 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${agentSpeaking ? 'bg-blue-500 animate-pulse' : listening ? 'bg-red-500 animate-pulse' : processing ? 'bg-yellow-500 animate-pulse' : 'bg-green-400'}`} />
            <span className="text-xs font-medium">
              {agentSpeaking ? 'Helix is speaking...' : listening ? 'Listening to you...' : processing ? 'Processing...' : 'Helix is ready'}
            </span>
          </div>
          {phase === PHASES.QUESTIONS && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1 flex items-center gap-1.5 text-xs text-indigo-700 font-medium">
              <span>🌐 Language:</span>
              <span className="font-semibold">{lockedLang} (Locked)</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {phase === PHASES.NAME || phase === PHASES.PHONE
            ? <span className="font-semibold text-sm text-gray-600">Profile Setup</span>
            : phase === PHASES.OTP
            ? <span className="font-semibold text-sm text-purple-600">OTP Verification</span>
            : <><span className="font-semibold text-sm text-gray-500">Project Understanding</span><span className="font-bold text-base text-blue-600">{coverage.overall_percent}%</span></>
          }
          <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button onClick={() => { window.speechSynthesis?.cancel(); navigate('/dashboard'); }}
          className="flex items-center gap-1 text-base font-medium text-gray-800 hover:text-red-500">
          Exit <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex h-[calc(100vh-67px-52px)]">

        {/* ─── Left Panel ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 pb-12 px-6 md:px-10 border-r border-[#D4DCE8] overflow-y-auto">

          {(!interviewDone || phase === PHASES.OTP) ? (<>

            {/* Question heading */}
            {phase === PHASES.NAME && (
              <div className="w-full max-w-xl text-center mb-6">
                <p className="text-xs font-semibold text-gray-500 tracking-[0.18em] mb-3 uppercase">PROFILE SETUP</p>
                <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 leading-snug">
                  Welcome to Helix! Let's get started. Could you please tell me your name?
                </h2>
              </div>
            )}
            {phase === PHASES.PHONE && (
              <div className="w-full max-w-xl text-center mb-6">
                <p className="text-xs font-semibold text-gray-500 tracking-[0.18em] mb-3 uppercase">PROFILE SETUP</p>
                <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 leading-snug">
                  Thank you, {userName}! And what is your phone number?
                </h2>
              </div>
            )}
            {phase === PHASES.QUESTIONS && (
              <div className="w-full max-w-2xl text-center mb-6">
                <p className="text-xs font-semibold text-gray-500 tracking-[0.18em] mb-3 uppercase">QUESTION {currentQ}</p>
                <h2 className="text-xl md:text-2xl font-medium text-gray-900 leading-relaxed px-2">
                  {currentQText || 'Preparing next question...'}
                </h2>
              </div>
            )}
            {phase === PHASES.OTP && (
              <>
                <p className="text-xs font-semibold text-purple-600 tracking-[0.18em] mb-4 uppercase">OTP VERIFICATION & SIGN IN</p>
                <h2 className="text-3xl font-semibold text-gray-900 text-center max-w-lg mb-2">Sign In to Access Your Project</h2>
                <p className="text-sm text-gray-500 text-center max-w-md mb-4">Generate and enter your OTP to sign in.</p>
              </>
            )}

            {/* Replay */}
            {phase !== PHASES.OTP && (
              <button onClick={replayQuestion} disabled={agentSpeaking}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-500 mb-8 hover:text-blue-600 disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5" /> Replay question
              </button>
            )}

            {/* Processing */}
            {processing && (
              <AiProcessingWaveform procStep={procStep} />
            )}

            {/* Live transcript */}
            {(listening || liveText) && !processing && (
              <div className="w-full max-w-md mb-6">
                <div className="bg-white rounded-2xl border border-purple-100 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-xs font-medium text-gray-600">Live transcript</span>
                  </div>
                  <p className="text-sm text-gray-700 min-h-[40px]">
                    {liveText || <span className="text-gray-400 italic">Listening... speak now</span>}
                    {listening && <span className="inline-block w-0.5 h-4 bg-purple-500 ml-0.5 animate-pulse" />}
                  </p>
                </div>
              </div>
            )}

            {/* OTP or Control Bar */}
            {phase === PHASES.OTP ? (
              <div className="flex flex-col items-center mt-2 w-full max-w-md bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
                <div className="w-full max-w-sm mb-5 text-left">
                  <label className="block text-xs font-semibold text-gray-800 mb-1.5">Phone Number</label>
                  <div className="flex items-center gap-2">
                    <input type="text" value={userPhone} onChange={e => setUserPhone(e.target.value)}
                      placeholder="10-digit phone"
                      className="flex-1 px-4 py-2.5 border border-gray-200 focus:border-purple-500 outline-none rounded-xl text-sm font-medium" />
                    <button type="button" onClick={() => handleGenerateOtp(userPhone)} disabled={processing}
                      className="px-4 py-2.5 bg-purple-600 text-white font-medium text-xs rounded-xl hover:bg-purple-700 disabled:opacity-50">
                      Generate OTP
                    </button>
                  </div>
                </div>
                {simOtp && (
                  <div className="mb-5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2.5 text-xs text-left w-full max-w-sm">
                    <span className="font-semibold block mb-0.5">💡 SMS Simulation Mode</span>
                    OTP: <span className="font-mono font-bold text-sm bg-white border border-amber-300 px-1.5 py-0.5 rounded">{simOtp}</span>
                  </div>
                )}
                <div className="w-full max-w-sm mb-5 text-left">
                  <label className="block text-xs font-semibold text-gray-800 mb-1.5">Enter 6-Digit OTP</label>
                  <input type="text" maxLength={6} placeholder="123456" value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full text-center font-bold text-2xl tracking-[0.25em] px-4 py-3 border-2 border-purple-200 focus:border-purple-500 outline-none rounded-xl text-gray-900" />
                </div>
                <button onClick={() => handleOtpSubmit(otpCode)} disabled={processing || !otpCode}
                  className="w-full max-w-sm py-3.5 bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] text-white font-semibold rounded-full shadow-lg disabled:opacity-50 text-sm">
                  {processing ? 'Verifying...' : 'Verify OTP & Sign In'}
                </button>
              </div>

            ) : (phase !== PHASES.OTP && !interviewDone) && (
              /* ─── Control Bar ─── */
              <div className="w-full max-w-xl mx-auto mt-6 px-4">
                <div className="flex items-center gap-3 w-full">

                  {/* Mic button (Mute mic to type) */}
                  <button type="button" onClick={toggleMic}
                    className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all shadow-sm
                      ${!micMuted && listening
                        ? 'bg-[#FF4528] text-white shadow-lg shadow-red-200 ring-4 ring-red-100 animate-pulse'
                        : !micMuted
                        ? 'bg-[#FF4528] text-white hover:bg-[#E03A1F]'
                        : 'bg-gray-100 border border-gray-200 text-gray-500 hover:bg-gray-200'}`}
                    title={micMuted ? 'Unmute mic (Voice mode)' : 'Mute mic (Type mode)'}>
                    {micMuted ? <MicOff className="w-5 h-5 text-gray-600" /> : <Mic className="w-5 h-5 text-white" />}
                  </button>

                  {/* Speaker button (Mute agent voice) */}
                  <button type="button" onClick={toggleVoice}
                    className={`w-12 h-12 rounded-full border flex items-center justify-center flex-shrink-0 transition-all shadow-sm
                      ${voiceEnabled
                        ? 'border-indigo-200 bg-indigo-50/80 text-indigo-600 hover:bg-indigo-100'
                        : 'border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                    title={voiceEnabled ? 'Mute agent voice' : 'Unmute agent voice'}>
                    {voiceEnabled ? <Volume2 className="w-5 h-5 text-indigo-600" /> : <VolumeX className="w-5 h-5 text-gray-400" />}
                  </button>

                  {/* Input field */}
                  <div className="flex-1">
                    <input type="text" value={typedText}
                      onChange={e => setTypedText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } }}
                      placeholder={
                        agentSpeaking
                          ? 'Helix is speaking...'
                          : listening && !micMuted
                          ? 'Speak now...'
                          : micMuted
                          ? 'Type your answer...'
                          : 'Speak now or type...'
                      }
                      disabled={processing}
                      className="w-full rounded-full border border-gray-200 bg-white px-6 py-3.5 text-sm text-gray-800 placeholder:text-gray-400 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" />
                  </div>

                  {/* Send button */}
                  <button type="button" onClick={submitTyped} disabled={!typedText.trim() || processing}
                    className={`w-12 h-12 rounded-full border flex items-center justify-center flex-shrink-0 transition-all shadow-sm
                      ${typedText.trim() && !processing
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md hover:bg-indigo-700'
                        : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'}`}>
                    <Send className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-[11px] text-gray-400 text-center mt-2.5">
                  {micMuted
                    ? '⌨️ Mic muted (Type mode) — type your answer and press Send or Enter'
                    : '🎤 Voice mode active — speak your answer or click mic to type'}
                </p>
              </div>
            )}

            {/* Previous answer */}
            {phase === PHASES.QUESTIONS && answers[currentQ - 1] && !processing && (
              <div className="bg-green-50 rounded-xl p-3 mt-6 max-w-md border border-green-100">
                <p className="text-xs text-green-700 font-medium mb-1">✓ Previous answer recorded:</p>
                <p className="text-sm text-gray-700 line-clamp-2">{answers[currentQ - 1]}</p>
              </div>
            )}

          </>) : (
            /* ─── Interview Complete ─── */
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Interview Complete!</h2>
              <p className="text-sm text-gray-600 mb-4">{totalCaptured} requirements captured.</p>
              <button onClick={handleGenerateRequirements} disabled={processing}
                className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-[32px] hover:bg-[#0f172a] disabled:opacity-50">
                {processing ? 'Please wait...' : user ? 'Generate requirement form' : 'Sign in to save & generate'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* ─── Right Panel ───────────────────────────────────────────────── */}
        <div className="w-[400px] bg-white p-6 overflow-y-auto border-l border-gray-100 flex flex-col">
          <p className="text-xs font-semibold text-gray-500 tracking-[0.11em] mb-4 uppercase">Requirement Coverage</p>
          <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border border-blue-100/50 rounded-2xl p-4 mb-6">
            <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-white border border-blue-200 shadow-sm flex-shrink-0">
              <span className="text-base font-bold text-blue-600">{coverage.overall_percent}%</span>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Project Understanding</h4>
              <p className="text-sm font-bold text-gray-900 mt-0.5">
                {coverage.overall_percent >= 90 ? 'Thoroughly Understood' : coverage.overall_percent >= 60 ? 'Deep Understanding' : coverage.overall_percent >= 30 ? 'Gathering Scope' : 'Analyzing Idea'}
              </p>
            </div>
          </div>

          {/* ── Requirement Checklist (three-state, domain-aware) ── */}
          {(coverage.checklist?.length > 0 || coverage.collected_fields?.length > 0 || coverage.missing_fields?.length > 0) && (
            <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/30 mb-6">
              <h4 className="text-xs font-bold text-gray-900 mb-3">Requirement Checklist</h4>

              {coverage.checklist?.length > 0 ? (
                /* ── New three-state checklist from backend ── */
                (() => {
                  const universalItems = coverage.checklist.filter(item => item.section !== 'domain');
                  const domainItems    = coverage.checklist.filter(item => item.section === 'domain');

                  const renderItem = (item) => {
                    if (item.status === 'complete') {
                      return (
                        <div
                          key={item.field}
                          className="flex items-center gap-1.5 text-xs text-green-700"
                          title={item.evidence || item.label}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          <span className="truncate font-medium">{item.label}</span>
                        </div>
                      );
                    }
                    if (item.status === 'partial') {
                      return (
                        <div
                          key={item.field}
                          className="flex items-center gap-1.5 text-xs text-amber-600"
                          title={`Partially understood: ${item.label}`}
                        >
                          <MinusCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </div>
                      );
                    }
                    /* missing */
                    return (
                      <div key={item.field} className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Circle className="w-3.5 h-3.5 text-gray-250 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </div>
                    );
                  };

                  return (
                    <>
                      {/* Universal requirements */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {universalItems.map(renderItem)}
                      </div>

                      {/* Domain-specific requirements section */}
                      {domainItems.length > 0 && (
                        <>
                          <div className="flex items-center gap-2 mt-4 mb-2">
                            <div className="flex-1 h-px bg-gradient-to-r from-indigo-100 to-transparent" />
                            <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider whitespace-nowrap px-1">
                              {coverage.domain_label
                                ? `${coverage.domain_label} Requirements`
                                : 'Domain Requirements'}
                            </span>
                            <div className="flex-1 h-px bg-gradient-to-l from-indigo-100 to-transparent" />
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            {domainItems.map(renderItem)}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()
              ) : (
                /* ── Legacy fallback (binary) ── */
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

              {/* ── Legend ── */}
              {coverage.checklist?.length > 0 && (
                <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-gray-100">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span>Captured</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <MinusCircle className="w-3 h-3 text-amber-400" />
                    <span>Partial</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Circle className="w-3 h-3 text-gray-300" />
                    <span>Missing</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex-1">
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-[0.11em] mb-3">Live Extractions ({totalCaptured})</h4>
            {extractions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 border border-dashed border-gray-200 rounded-2xl p-4 text-center">
                <Sparkles className="w-4 h-4 text-gray-300 mb-2" />
                <p className="text-[11px] text-gray-500 max-w-[200px]">Requirements will appear here in real-time.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {extractions.map((ext, i) => (
                  <div key={i} className="border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-500">Q{ext.q}</span>
                      <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">{ext.category || 'general'}</span>
                    </div>
                    {ext.key_points?.map((p, j) => <p key={j} className="text-xs text-gray-700 mb-1">• {p}</p>)}
                    {ext.requirements?.map((r, j) => <p key={j} className="text-xs text-blue-600 mt-1 font-medium">→ {r}</p>)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {interviewDone && (
            <div className="mt-6 pt-4 border-t border-gray-100">
              <button onClick={handleGenerateRequirements} disabled={processing}
                className="w-full flex items-center justify-center gap-2 bg-[#1E293B] text-white font-medium text-sm py-3.5 rounded-full disabled:opacity-50">
                <ArrowRight className="w-4 h-4" /> Generate requirement form
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
