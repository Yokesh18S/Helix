/**
 * Interview.jsx -- Production-grade voice interview page.
 *
 * Architecture:
 *  - useVoiceSessionManager is the ONLY controller of SpeechRecognition and
 *    SpeechSynthesis. Components dispatch actions; the manager decides when
 *    to start/stop recognition.
 *
 * Conversation States (managed by VSM):
 *  IDLE -> (user clicks Start Talking) -> AI_SPEAKING (greeting)
 *  -> USER_LISTENING -> PROCESSING -> WAITING_FOR_RESPONSE -> AI_SPEAKING ...
 *  -> COMPLETE
 *
 * Key rules enforced here:
 *  1. No TTS or recognition before user clicks "Start Talking" (autoplay fix).
 *  2. dispatch('START_LISTENING') is the only way to activate the mic.
 *  3. Recognition NEVER starts while isSpeaking === true.
 *  4. All cleanup runs on component unmount.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { interviewAPI, applicationsAPI, requirementsAPI, authAPI } from '../services/api';
import { parseSpokenPhone, isValid10DigitPhone } from '../utils/phoneParser';
import {
  Mic, MicOff, RotateCcw, X, Sparkles, ArrowRight, Keyboard,
  Volume2, VolumeX, CheckCircle2, Circle, Play
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useVoiceSessionManager } from '../hooks/useVoiceSessionManager';

// ─── Guest token helper ────────────────────────────────────────────────────────
function getOrCreateGuestToken() {
  let token = localStorage.getItem('helix_guest_token');
  if (!token) {
    token = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('helix_guest_token', token);
  }
  return token;
}

// ─── Interview phase constants ─────────────────────────────────────────────────
const PHASES = {
  COLLECT_NAME: 'collect_name',
  COLLECT_PHONE: 'collect_phone',
  BUSINESS_QUESTIONS: 'business_questions',
  OTP_VERIFICATION: 'otp_verification',
};

export default function Interview() {
  const { user, loginWithOtp, voiceEnabled, setVoiceEnabled } = useAuth();
  const navigate = useNavigate();

  // ─── Session / Interview state ────────────────────────────────────────────
  const [applicationId, setApplicationId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [currentQuestionText, setCurrentQuestionText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [answers, setAnswers] = useState({});
  const [extractions, setExtractions] = useState([]);
  const [totalCaptured, setTotalCaptured] = useState(0);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textAnswer, setTextAnswer] = useState('');
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [coverage, setCoverage] = useState({ overall_percent: 0, collected_fields: [], missing_fields: [] });
  const [currentLanguageCode, setCurrentLanguageCode] = useState('en-US');
  const [interviewPhase, setInterviewPhase] = useState(PHASES.COLLECT_NAME);
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [simulatedOtp, setSimulatedOtp] = useState('');

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const [isGuestMode] = useState(!user);
  const guestTokenRef = useRef(getOrCreateGuestToken());
  const isMountedRef = useRef(true);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const answersCountRef = useRef(0);
  const appIdRef = useRef(null);
  const liveTranscriptRef = useRef('');
  const silenceTimeoutRef = useRef(null);
  const interviewPhaseRef = useRef(PHASES.COLLECT_NAME);
  const userNameRef = useRef('');
  const userPhoneRef = useRef('');
  const applicationIdRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { interviewPhaseRef.current = interviewPhase; }, [interviewPhase]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { userPhoneRef.current = userPhone; }, [userPhone]);
  useEffect(() => { applicationIdRef.current = applicationId; }, [applicationId]);
  useEffect(() => { answersCountRef.current = Object.keys(answers).length; }, [answers]);
  useEffect(() => { appIdRef.current = applicationId; }, [applicationId]);

  // ─── Voice Session Manager ────────────────────────────────────────────────
  const handleVoiceResult = useCallback((result) => {
    if (!isMountedRef.current) return;
    liveTranscriptRef.current = result.transcript;
  }, []);

  const {
    sessionStarted,
    isListening,
    isSpeaking,
    liveTranscript,
    dispatch: vsmDispatch,
    speak,
    stopSpeaking,
    abortListening,
  } = useVoiceSessionManager({
    onResult: handleVoiceResult,
    lang: currentLanguageCode,
    voiceEnabled,
  });

  const isRecording = mediaRecorderRef.current?.state === 'recording';
  // isActive: true when MediaRecorder is recording (not just SpeechRecognition)
  const isActive = isRecording;

  // ─── Unmount cleanup ──────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortListening();
      stopSpeaking();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (_) {}
      }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (appIdRef.current && answersCountRef.current < 2) {
        applicationsAPI.delete(appIdRef.current).catch(() => {});
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Start session (user gesture gate) ────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!isMountedRef.current) return;
    vsmDispatch('START_SESSION');
    try {
      let res;
      if (user) {
        res = await applicationsAPI.create({ project_name: null });
      } else {
        res = await applicationsAPI.createGuest(guestTokenRef.current);
        localStorage.setItem('helix_pending_guest_token', guestTokenRef.current);
      }
      if (!isMountedRef.current) return;
      setApplicationId(res.data.id);
      speak(
        "Welcome to Helix! Let's get started. Could you please tell me your name?",
        () => { if (isMountedRef.current) startRecording(); },
      );
    } catch (err) {
      console.error('[Interview] handleStart error:', err);
      toast.error(err?.response?.data?.detail || 'Failed to start interview. Please try again.');
    }
  }, [user, speak, vsmDispatch]);

  // ─── MediaRecorder: start recording ───────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!isMountedRef.current || isSpeaking) return;
    if (mediaRecorderRef.current?.state === 'recording') return;
    try {
      stopSpeaking();
      liveTranscriptRef.current = '';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isMountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        stream.getTracks().forEach((t) => t.stop());
        if (isMountedRef.current) await processAudio(audioBlob);
      };
      mediaRecorder.start();
      vsmDispatch('START_LISTENING');
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') stopRecording();
      }, 6000);
    } catch (err) {
      console.error('[Interview] Microphone error:', err);
      toast.error('Microphone access denied. Please allow microphone access or use text input.');
      setShowTextInput(true);
    }
  }, [isSpeaking, stopSpeaking, vsmDispatch]);

  // ─── MediaRecorder: stop recording ────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (silenceTimeoutRef.current) { clearTimeout(silenceTimeoutRef.current); silenceTimeoutRef.current = null; }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      vsmDispatch('STOP_LISTENING');
    }
  }, [vsmDispatch]);

  // ─── Fetch first business question ────────────────────────────────────────
  const fetchFirstQuestion = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStep('analyzing');
    try {
      let res;
      if (isGuestMode) {
        res = await interviewAPI.firstQuestionGuest(applicationIdRef.current, guestTokenRef.current);
      } else {
        res = await interviewAPI.firstQuestion(applicationIdRef.current);
      }
      if (!isMountedRef.current) return;
      setCurrentQuestionText(res.data.question);
      setCurrentQuestion(res.data.question_number);
      if (res.data.coverage) setCoverage(res.data.coverage);
      const lang = res.data.language_code || 'en-US';
      if (res.data.language_code) setCurrentLanguageCode(res.data.language_code);
      speak(res.data.question, () => { if (isMountedRef.current) startRecording(); }, lang);
    } catch (err) {
      console.error('[Interview] fetchFirstQuestion error:', err);
      toast.error('Failed to start requirements gathering.');
    } finally {
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); }
    }
  }, [isGuestMode, speak, vsmDispatch]);

  useEffect(() => {
    if (interviewPhase === PHASES.BUSINESS_QUESTIONS && applicationId) fetchFirstQuestion();
  }, [interviewPhase, applicationId, fetchFirstQuestion]);

  // ─── Process audio after MediaRecorder stops ──────────────────────────────
  const processAudio = useCallback(async (audioBlob) => {
    if (!isMountedRef.current) return;
    const phase = interviewPhaseRef.current;

    if (phase === PHASES.COLLECT_NAME) {
      const name = liveTranscriptRef.current.trim();
      if (!name) {
        toast.error('Could not hear you. Please try again.');
        speak("I couldn't hear you. Please tell me your name.", () => { if (isMountedRef.current) startRecording(); });
        return;
      }
      setUserName(name);
      liveTranscriptRef.current = '';
      setInterviewPhase(PHASES.COLLECT_PHONE);
      speak(`Thank you, ${name}! And what is your phone number?`, () => { if (isMountedRef.current) startRecording(); });
      return;
    }

    if (phase === PHASES.COLLECT_PHONE) {
      const phoneRaw = liveTranscriptRef.current.trim();
      let cleanedPhone = parseSpokenPhone(phoneRaw);
      if (cleanedPhone.length > 10) cleanedPhone = cleanedPhone.slice(-10);
      if (!isValid10DigitPhone(cleanedPhone)) {
        toast.error('Please enter a valid 10-digit phone number');
        speak("I couldn't get a valid phone number. Please say it again.", () => { if (isMountedRef.current) startRecording(); });
        return;
      }
      setUserPhone(cleanedPhone);
      liveTranscriptRef.current = '';
      vsmDispatch('START_PROCESSING');
      setIsProcessing(true);
      setProcessingStep('analyzing');
      try {
        const res = await authAPI.initiateOtp({ phone: cleanedPhone, name: userNameRef.current });
        if (!isMountedRef.current) return;
        if (res.data.simulated_otp) {
          setSimulatedOtp(res.data.simulated_otp);
          toast.success(`[Helix SMS] OTP for ${cleanedPhone} is: ${res.data.simulated_otp}`, { duration: 10000 });
        }
        setInterviewPhase(PHASES.BUSINESS_QUESTIONS);
      } catch (err) {
        console.error('[Interview] initiateOtp error:', err);
        toast.error('Failed to register or lookup profile. Please try again.');
      } finally {
        if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); vsmDispatch('STOP_PROCESSING'); }
      }
      return;
    }

    if (phase === PHASES.OTP_VERIFICATION) {
      const otp = liveTranscriptRef.current.trim().replace(/\D/g, '');
      if (otp.length !== 6) {
        toast.error('Please enter a valid 6-digit OTP code.');
        speak('OTP must be six digits. Please say your OTP code.', () => { if (isMountedRef.current) startRecording(); });
        return;
      }
      handleOtpSubmit(otp);
      return;
    }

    if (!liveTranscriptRef.current.trim()) { toast.error('Could not hear you. Please try again.'); replayQuestion(); return; }

    vsmDispatch('START_PROCESSING');
    setIsProcessing(true);
    setProcessingStep('transcribing');
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        if (!isMountedRef.current) return;
        const base64Audio = reader.result.split(',')[1];
        setProcessingStep('analyzing');
        try {
          let res;
          if (user) {
            res = await interviewAPI.processVoice({ audio_base64: base64Audio, application_id: applicationIdRef.current });
          } else {
            res = await interviewAPI.processVoiceGuest({ audio_base64: base64Audio, application_id: applicationIdRef.current, guest_token: guestTokenRef.current });
          }
          if (!isMountedRef.current) return;
          setProcessingStep('done');
          setTimeout(() => { if (isMountedRef.current) { setProcessingStep(''); handleResponse(res.data); } }, 500);
        } catch (err) {
          console.error('[Interview] processVoice error:', err);
          toast.error('Failed to process audio. Try using text input.');
          setShowTextInput(true);
          if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); vsmDispatch('STOP_PROCESSING'); }
        }
      };
    } catch (err) {
      console.error('[Interview] FileReader error:', err);
      toast.error('Failed to process audio.');
      setShowTextInput(true);
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); vsmDispatch('STOP_PROCESSING'); }
    }
  }, [user, speak, vsmDispatch]);

  // ─── Text answer submission ────────────────────────────────────────────────
  const submitTextAnswer = useCallback(async () => {
    if (!textAnswer.trim()) return;

    if (interviewPhase === PHASES.COLLECT_NAME) {
      const name = textAnswer.trim();
      setUserName(name); setTextAnswer('');
      setInterviewPhase(PHASES.COLLECT_PHONE);
      speak(`Thank you, ${name}! And what is your phone number?`, () => { if (isMountedRef.current) startRecording(); });
      return;
    }

    if (interviewPhase === PHASES.COLLECT_PHONE) {
      let cleanedPhone = parseSpokenPhone(textAnswer.trim());
      if (cleanedPhone.length > 10) cleanedPhone = cleanedPhone.slice(-10);
      if (!isValid10DigitPhone(cleanedPhone)) { toast.error('Please enter a valid 10-digit phone number'); return; }
      setUserPhone(cleanedPhone); setTextAnswer('');
      vsmDispatch('START_PROCESSING'); setIsProcessing(true); setProcessingStep('analyzing');
      try {
        const res = await authAPI.initiateOtp({ phone: cleanedPhone, name: userNameRef.current });
        if (!isMountedRef.current) return;
        if (res.data.simulated_otp) { setSimulatedOtp(res.data.simulated_otp); toast.success(`[Helix SMS] OTP: ${res.data.simulated_otp}`, { duration: 10000 }); }
        setInterviewPhase(PHASES.BUSINESS_QUESTIONS);
      } catch (err) {
        console.error('[Interview] initiateOtp text error:', err);
        toast.error('Failed to register. Please try again.');
      } finally {
        if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); vsmDispatch('STOP_PROCESSING'); }
      }
      return;
    }

    if (interviewPhase === PHASES.OTP_VERIFICATION) { handleOtpSubmit(textAnswer.trim().replace(/\D/g, '')); return; }

    vsmDispatch('START_PROCESSING'); setIsProcessing(true); setProcessingStep('analyzing');
    try {
      let res;
      if (user) {
        res = await interviewAPI.processText(applicationId, { answer_text: textAnswer.trim() });
      } else {
        res = await interviewAPI.processTextGuest(applicationId, guestTokenRef.current, { answer_text: textAnswer.trim() });
      }
      if (!isMountedRef.current) return;
      setProcessingStep('done');
      setTimeout(() => { if (isMountedRef.current) { setProcessingStep(''); handleResponse(res.data); } }, 500);
      setTextAnswer('');
    } catch (err) {
      console.error('[Interview] processText error:', err);
      toast.error('Failed to process answer');
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); vsmDispatch('STOP_PROCESSING'); }
    }
  }, [textAnswer, interviewPhase, applicationId, user, speak, vsmDispatch]);

  // ─── OTP helpers ──────────────────────────────────────────────────────────
  const handleGenerateOtp = useCallback(async (phoneToUse) => {
    let cleanedPhone = parseSpokenPhone((phoneToUse || userPhone).trim());
    if (cleanedPhone.length > 10) cleanedPhone = cleanedPhone.slice(-10);
    if (!isValid10DigitPhone(cleanedPhone)) { toast.error('Please enter a valid 10-digit phone number'); return; }
    setIsProcessing(true);
    try {
      const res = await authAPI.initiateOtp({ phone: cleanedPhone, name: userNameRef.current });
      if (!isMountedRef.current) return;
      if (res.data.simulated_otp) {
        setSimulatedOtp(res.data.simulated_otp);
        toast.success(`[Helix SMS] OTP: ${res.data.simulated_otp}`, { duration: 10000 });
      } else {
        toast.success(`OTP sent to ${cleanedPhone}`);
      }
    } catch (err) { console.error('[Interview] generateOtp error:', err); toast.error('Failed to send OTP.'); }
    finally { if (isMountedRef.current) setIsProcessing(false); }
  }, [userPhone]);

  const handleOtpSubmit = useCallback(async (otpCode) => {
    const code = (otpCode || otpCodeInput).toString().trim().replace(/\D/g, '');
    if (!code || code.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP code.');
      speak('The OTP code should be six digits.', () => { if (isMountedRef.current) startRecording(); });
      return;
    }
    vsmDispatch('START_PROCESSING'); setIsProcessing(true); setProcessingStep('analyzing');
    try {
      const authRes = await authAPI.verifyOtp({ phone: userPhoneRef.current, otp_code: code });
      if (!isMountedRef.current) return;
      const { access_token, user: userData } = authRes.data;
      loginWithOtp(access_token, userData);
      try { await interviewAPI.claimGuestSession(guestTokenRef.current); } catch (e) { console.warn('[Interview] claimGuestSession:', e); }
      setProcessingStep('done');
      try { await requirementsAPI.generate({ application_id: applicationIdRef.current }); } catch (e) { console.warn('[Interview] generate requirements:', e); }
      let userApps = [];
      try { const appsRes = await applicationsAPI.getAll(); userApps = appsRes.data || []; } catch (e) { console.warn('[Interview] getAll:', e); }
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      answersCountRef.current = 99;
      if (userApps.length > 1) {
        toast.success(`Welcome back, ${userData.full_name || 'User'}!`);
        speak('Welcome back! Redirecting to your dashboard.');
        setTimeout(() => navigate('/dashboard'), 1500);
      } else {
        toast.success('Welcome! Your project requirements are ready.');
        speak('Welcome! Redirecting to your requirements page.');
        setTimeout(() => navigate(`/requirements/${applicationIdRef.current}`), 1500);
      }
    } catch (err) {
      console.error('[Interview] OTP verification error:', err);
      const errMsg = err.response?.data?.detail || 'Invalid OTP code. Please try again.';
      toast.error(errMsg);
      speak('That OTP code was incorrect. Please try again.', () => { if (isMountedRef.current) startRecording(); });
    } finally {
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStep(''); vsmDispatch('STOP_PROCESSING'); }
    }
  }, [otpCodeInput, loginWithOtp, speak, vsmDispatch, navigate]);

  // ─── Handle backend response ──────────────────────────────────────────────
  const handleResponse = useCallback((data) => {
    if (!isMountedRef.current) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion]: data.transcribed_text }));
    liveTranscriptRef.current = '';
    if (data.ai_extraction) {
      setExtractions((prev) => [...prev, { q: currentQuestion, ...data.ai_extraction }]);
      setTotalCaptured((prev) => prev + (data.ai_extraction.requirements?.length || 1));
      answersCountRef.current = (answersCountRef.current || 0) + 1;
    }
    if (data.coverage) setCoverage(data.coverage);
    const lang = data.language_code || 'en-US';
    if (data.language_code) setCurrentLanguageCode(data.language_code);
    vsmDispatch('STOP_PROCESSING');
    setIsProcessing(false);
    const afterSpeech = () => { if (isMountedRef.current) startRecording(); };
    if (data.contradiction) toast.error(data.contradiction, { duration: 6000 });
    if (data.interview_complete) {
      setInterviewComplete(true);
      vsmDispatch('COMPLETE_INTERVIEW');
      if (user) {
        speak('Excellent! The interview is complete. Generating your requirements document now...', () => { if (isMountedRef.current) handleGenerateRequirements(); }, lang);
      } else {
        setInterviewPhase(PHASES.OTP_VERIFICATION);
        if (userPhoneRef.current && isValid10DigitPhone(userPhoneRef.current)) {
          authAPI.initiateOtp({ phone: userPhoneRef.current, name: userNameRef.current }).then((res) => {
            if (res.data.simulated_otp) { setSimulatedOtp(res.data.simulated_otp); toast.success(`[Helix SMS] OTP: ${res.data.simulated_otp}`, { duration: 10000 }); }
          }).catch(() => {});
        }
        speak('Excellent! The interview is complete. Please verify your OTP to sign in.', afterSpeech, lang);
      }
    } else if (data.next_question) {
      setCurrentQuestionText(data.next_question);
      setCurrentQuestion((prev) => prev + 1);
      speak(data.next_question, afterSpeech, lang);
    }
  }, [currentQuestion, user, speak, vsmDispatch]);

  const replayQuestion = useCallback(() => {
    speak(currentQuestionText, () => { if (isMountedRef.current) startRecording(); }, currentLanguageCode);
  }, [currentQuestionText, currentLanguageCode, speak, vsmDispatch]);

  // ─── Generate requirements ─────────────────────────────────────────────────
  const handleGenerateRequirements = useCallback(async () => {
    if (!user) {
      localStorage.setItem('helix_pending_guest_token', guestTokenRef.current);
      localStorage.setItem('helix_pending_app_id', String(applicationIdRef.current));
      speak('Please sign in to save and view your requirements.');
      setTimeout(() => navigate('/login?claim=true'), 2000);
      return;
    }
    setIsProcessing(true);
    try {
      await requirementsAPI.generate({ application_id: applicationIdRef.current });
      toast.success('Requirements generated!');
      answersCountRef.current = 99;
      navigate(`/requirements/${applicationIdRef.current}`);
    } catch (err) {
      console.error('[Interview] generateRequirements error:', err);
      toast.error(err.response?.data?.detail || 'Failed to generate requirements.');
      if (isMountedRef.current) setIsProcessing(false);
    }
  }, [user, speak, navigate]);

  const toggleVoice = useCallback(() => {
    if (voiceEnabled) stopSpeaking();
    setVoiceEnabled(!voiceEnabled);
  }, [voiceEnabled, stopSpeaking, setVoiceEnabled]);

  const progressPercent =
    interviewPhase === PHASES.COLLECT_NAME || interviewPhase === PHASES.COLLECT_PHONE ? 0
    : interviewPhase === PHASES.OTP_VERIFICATION ? 100
    : coverage.overall_percent;

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F6F7FE] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white border border-gray-100 rounded-full px-4 py-1 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-blue-500 animate-pulse' : isActive ? 'bg-red-500 animate-pulse' : isProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-green-400'}`} />
            <span className="text-xs font-medium">
              {isSpeaking ? 'Helix is speaking...' : isActive ? 'Listening to you...' : isProcessing ? 'Processing...' : sessionStarted ? 'Helix is ready' : 'Click Start Talking to begin'}
            </span>
          </div>
          <button
            onClick={toggleVoice}
            className={`p-1.5 rounded-full border ${voiceEnabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
            title={voiceEnabled ? 'Speaker ON' : 'Speaker OFF'}
          >
            {voiceEnabled ? <Volume2 className="w-3.5 h-3.5 text-green-600" /> : <VolumeX className="w-3.5 h-3.5 text-gray-400" />}
          </button>
        </div>
        <div className="flex items-center gap-4">
          {interviewPhase === PHASES.COLLECT_NAME || interviewPhase === PHASES.COLLECT_PHONE
            ? <span className="font-semibold text-sm text-helix-gray-600">Profile Setup</span>
            : interviewPhase === PHASES.OTP_VERIFICATION
            ? <span className="font-semibold text-sm text-[#8B5CF6]">OTP Verification</span>
            : <><span className="font-semibold text-sm text-helix-gray-500">Project Understanding</span><span className="font-bold text-base text-blue-600">{coverage.overall_percent}%</span></>
          }
          <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button
          onClick={() => { stopSpeaking(); navigate('/dashboard'); }}
          className="flex items-center gap-1 text-base font-medium text-helix-navy hover:text-red-500"
        >
          Exit <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex h-[calc(100vh-67px-52px)]">
        {/* Left Panel */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 pb-12 px-6 md:px-10 border-r border-[#D4DCE8] overflow-y-auto">

          {/* ─── SESSION NOT STARTED: Show Start Button ─── */}
          {!sessionStarted ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-6 max-w-sm">
              <div className="w-20 h-20 bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] rounded-full flex items-center justify-center shadow-xl shadow-purple-200">
                <Play className="w-9 h-9 text-white ml-1" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-helix-navy mb-2">Ready to begin?</h2>
                <p className="text-sm text-helix-gray-600 leading-relaxed">
                  Click the button below to start your AI-powered requirements interview.
                  Helix will guide you through a conversation to understand your project.
                </p>
              </div>
              <button
                onClick={handleStart}
                className="flex items-center gap-2 bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] text-white font-semibold text-base px-8 py-4 rounded-full shadow-lg hover:shadow-purple-300 hover:scale-105 active:scale-95 transition-all"
              >
                <Play className="w-5 h-5" /> Start Talking
              </button>
              <p className="text-xs text-helix-gray-400">Microphone access will be requested when you begin.</p>
            </div>
          ) : (!interviewComplete || (!user && interviewPhase === PHASES.OTP_VERIFICATION)) ? (
            <>
              {/* Question headings */}
              {interviewPhase === PHASES.COLLECT_NAME && (
                <div className="w-full max-w-xl text-center mb-6">
                  <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-3 uppercase">PROFILE SETUP</p>
                  <h2 className="text-2xl md:text-3xl font-semibold text-helix-navy leading-snug">
                    Welcome to Helix! Let's get started. Could you please tell me your name?
                  </h2>
                </div>
              )}
              {interviewPhase === PHASES.COLLECT_PHONE && (
                <div className="w-full max-w-xl text-center mb-6">
                  <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-3 uppercase">PROFILE SETUP</p>
                  <h2 className="text-2xl md:text-3xl font-semibold text-helix-navy leading-snug">
                    Thank you, {userName}! And what is your phone number?
                  </h2>
                </div>
              )}
              {interviewPhase === PHASES.BUSINESS_QUESTIONS && (
                <div className="w-full max-w-2xl text-center mb-6">
                  <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-3 uppercase">QUESTION {currentQuestion}</p>
                  <h2 className="text-xl md:text-2xl font-medium text-helix-navy leading-relaxed px-2">
                    {currentQuestionText || 'Preparing next question...'}
                  </h2>
                </div>
              )}
              {interviewPhase === PHASES.OTP_VERIFICATION && (
                <>
                  <p className="text-xs font-semibold text-[#8B5CF6] tracking-[0.18em] mb-4 uppercase">OTP VERIFICATION & SIGN IN</p>
                  <h2 className="text-3xl font-semibold text-helix-navy text-center max-w-lg mb-2">Sign In to Access Your Project</h2>
                  <p className="text-sm text-helix-gray-500 text-center max-w-md mb-4">
                    Your phone number from the interview has been placed below. Generate and enter your OTP to sign in.
                  </p>
                </>
              )}

              {/* Replay button */}
              {interviewPhase === PHASES.BUSINESS_QUESTIONS && (
                <button
                  onClick={replayQuestion}
                  disabled={isSpeaking}
                  className="flex items-center gap-1.5 text-sm font-medium text-helix-gray-500 mb-8 hover:text-helix-blue disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Replay question
                </button>
              )}

              {/* Processing indicator */}
              {isProcessing && (
                <div className="w-full max-w-md mb-6">
                  <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`flex items-center gap-2 ${processingStep === 'transcribing' ? 'text-blue-600' : processingStep === 'analyzing' || processingStep === 'done' ? 'text-green-600' : 'text-gray-400'}`}>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${processingStep === 'transcribing' ? 'border-blue-500 bg-blue-50' : processingStep === 'analyzing' || processingStep === 'done' ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}>
                          {(processingStep === 'analyzing' || processingStep === 'done')
                            ? <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            : <span className="text-[8px] font-bold">1</span>}
                        </div>
                        <span className="text-xs font-medium">Transcribing</span>
                      </div>
                      <div className="flex-1 h-0.5 bg-gray-200 rounded">
                        <div className={`h-full rounded transition-all duration-500 ${processingStep === 'analyzing' || processingStep === 'done' ? 'w-full bg-green-400' : processingStep === 'transcribing' ? 'w-1/2 bg-blue-400 animate-pulse' : 'w-0'}`} />
                      </div>
                      <div className={`flex items-center gap-2 ${processingStep === 'analyzing' ? 'text-blue-600' : processingStep === 'done' ? 'text-green-600' : 'text-gray-400'}`}>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${processingStep === 'analyzing' ? 'border-blue-500 bg-blue-50' : processingStep === 'done' ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}>
                          {processingStep === 'done'
                            ? <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            : <span className="text-[8px] font-bold">2</span>}
                        </div>
                        <span className="text-xs font-medium">Analyzing</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-1000 ${
                        processingStep === 'transcribing' ? 'w-1/3 bg-gradient-to-r from-blue-400 to-blue-600 animate-pulse'
                        : processingStep === 'analyzing' ? 'w-2/3 bg-gradient-to-r from-blue-400 to-purple-500 animate-pulse'
                        : processingStep === 'done' ? 'w-full bg-gradient-to-r from-green-400 to-green-600' : 'w-0'
                      }`} />
                    </div>
                    <p className="text-xs text-helix-gray-500 mt-2 text-center">
                      {processingStep === 'transcribing' && '🎤 Converting your speech to text...'}
                      {processingStep === 'analyzing' && '🧠 AI is processing...'}
                      {processingStep === 'done' && '✅ Done!'}
                    </p>
                  </div>
                </div>
              )}

              {/* Live transcript */}
              {(isActive || liveTranscript) && !isProcessing && (
                <div className="w-full max-w-md mb-6">
                  <div className="bg-white rounded-2xl border border-purple-100 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-xs font-medium text-helix-gray-600">Live transcript</span>
                    </div>
                    <p className="text-sm text-helix-gray-700 min-h-[40px]">
                      {liveTranscript || <span className="text-gray-400 italic">Start speaking...</span>}
                      {isActive && <span className="inline-block w-0.5 h-4 bg-purple-500 ml-0.5 animate-pulse" />}
                    </p>
                  </div>
                </div>
              )}

              {/* OTP UI or Mic UI */}
              {interviewPhase === PHASES.OTP_VERIFICATION ? (
                <div className="flex flex-col items-center mt-2 w-full max-w-md text-center bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
                  <div className="w-full max-w-sm mb-5 text-left">
                    <label className="block text-xs font-semibold text-helix-navy mb-1.5">Phone Number</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={userPhone}
                        onChange={(e) => setUserPhone(e.target.value)}
                        placeholder="10-digit phone number"
                        className="flex-1 px-4 py-2.5 border border-gray-200 focus:border-purple-500 outline-none rounded-xl text-sm font-medium text-helix-navy bg-slate-50"
                      />
                      <button
                        type="button"
                        onClick={() => handleGenerateOtp(userPhone)}
                        disabled={isProcessing}
                        className="px-4 py-2.5 bg-purple-600 text-white font-medium text-xs rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        Generate OTP
                      </button>
                    </div>
                  </div>
                  {simulatedOtp && (
                    <div className="mb-5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2.5 text-xs text-left w-full max-w-sm shadow-sm">
                      <span className="font-semibold block mb-0.5">💡 SMS Simulation Mode</span>
                      Your OTP code is <span className="font-mono font-bold text-sm bg-white border border-amber-300 px-1.5 py-0.5 rounded">{simulatedOtp}</span>
                    </div>
                  )}
                  <div className="w-full max-w-sm mb-5 text-left">
                    <label className="block text-xs font-semibold text-helix-navy mb-1.5">Enter 6-Digit Verification Code</label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="123456"
                      value={otpCodeInput}
                      onChange={(e) => setOtpCodeInput(e.target.value.replace(/\D/g, ''))}
                      className="w-full text-center font-bold text-2xl tracking-[0.25em] px-4 py-3 border-2 border-purple-200 focus:border-purple-500 outline-none rounded-xl shadow-inner text-helix-navy"
                    />
                  </div>
                  <div className="flex flex-col gap-3 w-full max-w-sm">
                    <button
                      onClick={() => handleOtpSubmit(otpCodeInput)}
                      disabled={isProcessing || !otpCodeInput}
                      className="w-full py-3.5 bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] text-white font-semibold rounded-full shadow-lg hover:shadow-purple-100 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 text-sm"
                    >
                      {isProcessing ? 'Verifying & Signing In...' : 'Verify OTP & Sign In'}
                    </button>
                    <div className="relative mt-2">
                      <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={isSpeaking}
                        className={`mx-auto w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 scale-105 shadow-md shadow-red-100' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        title="Say OTP"
                      >
                        {isRecording ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5" />}
                      </button>
                      <p className="text-[11px] text-helix-gray-500 mt-1">You can also speak the OTP</p>
                    </div>
                  </div>
                </div>
              ) : !isProcessing && (
                <>
                  {!showTextInput ? (
                    <div className="flex flex-col items-center">
                      <div className="relative">
                        {isActive && (
                          <>
                            <div className="absolute inset-[-24px] bg-purple-100/40 rounded-full voice-pulse" />
                            <div className="absolute inset-[-12px] bg-[#EFEAFE] rounded-full voice-pulse" style={{ animationDelay: '0.3s' }} />
                          </>
                        )}
                        <button
                          onClick={isRecording ? stopRecording : startRecording}
                          disabled={isSpeaking || !applicationId}
                          className={`relative z-10 w-[70px] h-[70px] rounded-full flex items-center justify-center transition-all ${
                            isActive ? 'bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] scale-110 shadow-lg shadow-purple-200'
                            : isSpeaking ? 'bg-gray-300 cursor-not-allowed'
                            : 'bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] hover:scale-105 shadow-md shadow-purple-100'
                          }`}
                        >
                          {isActive ? <MicOff className="w-7 h-7 text-white" /> : <Mic className="w-7 h-7 text-white" />}
                        </button>
                      </div>
                      <p className="text-sm font-medium text-helix-gray-500 mt-5">
                        {isSpeaking ? '🔊 Wait for Helix to finish...'
                         : isActive ? '🔴 Recording — tap to stop'
                         : '🎤 Tap the mic to answer'}
                      </p>
                      <button
                        onClick={() => setShowTextInput(true)}
                        className="flex items-center gap-1 text-xs text-helix-gray-500 mt-4 hover:text-helix-blue"
                      >
                        <Keyboard className="w-3 h-3" /> Type instead
                      </button>
                    </div>
                  ) : (
                    <div className="w-full max-w-md">
                      <textarea
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value)}
                        placeholder="Type your answer here..."
                        className="w-full h-32 px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue resize-none"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTextAnswer(); } }}
                      />
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          onClick={submitTextAnswer}
                          disabled={!textAnswer.trim() || !applicationId}
                          className="flex-1 bg-[#1E293B] text-white text-sm font-medium py-3 rounded-full disabled:opacity-50"
                        >
                          Submit Answer
                        </button>
                        <button
                          onClick={() => setShowTextInput(false)}
                          className="flex items-center gap-1 text-xs text-helix-gray-500 hover:text-helix-blue"
                        >
                          <Mic className="w-3 h-3" /> Use mic
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Previous answer */}
              {interviewPhase === PHASES.BUSINESS_QUESTIONS && answers[currentQuestion - 1] && !isProcessing && (
                <div className="bg-green-50 rounded-xl p-3 mt-6 max-w-md border border-green-100">
                  <p className="text-xs text-green-700 font-medium mb-1">✓ Previous answer recorded:</p>
                  <p className="text-sm text-helix-gray-700 line-clamp-2">{answers[currentQuestion - 1]}</p>
                </div>
              )}
            </>
          ) : (
            /* Interview Complete */
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold text-helix-navy mb-2">Interview Complete!</h2>
              <p className="text-sm text-helix-gray-600 mb-4">{totalCaptured} requirements captured from your responses.</p>
              {!user && (
                <div className="mb-6 bg-blue-50 border border-blue-100 rounded-xl p-4 text-left max-w-sm mx-auto">
                  <p className="text-sm font-semibold text-blue-800 mb-1">🔒 Sign in to save your work</p>
                  <p className="text-xs text-blue-600">Your interview data is ready. Sign in or create an account to save your requirements document and access it anytime.</p>
                </div>
              )}
              <button
                onClick={handleGenerateRequirements}
                disabled={isProcessing}
                className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-[32px] hover:bg-[#0f172a] disabled:opacity-50"
              >
                {isProcessing ? 'Please wait...' : user ? 'Generate requirement form' : 'Sign in to save & generate'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="w-[400px] bg-white p-6 overflow-y-auto border-l border-gray-100 flex flex-col">
          <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.11em] mb-4 uppercase">Requirement Coverage</p>
          <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border border-blue-100/50 rounded-2xl p-4 mb-6">
            <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-white border border-blue-200 shadow-sm flex-shrink-0">
              <span className="text-base font-bold text-blue-600">{coverage.overall_percent}%</span>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-helix-gray-500 uppercase tracking-wider">Project Understanding</h4>
              <p className="text-sm font-bold text-helix-navy mt-0.5">
                {coverage.overall_percent >= 90 ? 'Thoroughly Understood' : coverage.overall_percent >= 60 ? 'Deep Understanding' : coverage.overall_percent >= 30 ? 'Gathering Scope' : 'Analyzing Idea'}
              </p>
            </div>
          </div>
          {(coverage.collected_fields.length > 0 || coverage.missing_fields.length > 0) && (
            <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/30 mb-6">
              <h4 className="text-xs font-bold text-helix-navy mb-3">Requirement Checklist</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {coverage.collected_fields.map((field) => (
                  <div key={field} className="flex items-center gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    <span className="truncate font-medium">{coverage.field_labels?.[field] || field}</span>
                  </div>
                ))}
                {coverage.missing_fields.map((field) => (
                  <div key={field} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Circle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    <span className="truncate">{coverage.field_labels?.[field] || field}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1">
            <h4 className="text-xs font-bold text-helix-navy uppercase tracking-[0.11em] mb-3">Live Extractions ({totalCaptured})</h4>
            {extractions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center border border-dashed border-gray-200 rounded-2xl p-4">
                <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center mb-2">
                  <Sparkles className="w-4 h-4 text-gray-300" />
                </div>
                <p className="text-[11px] text-helix-gray-500 max-w-[200px]">
                  Requirements will appear here in real-time as you answer Helix's questions.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {extractions.map((ext, idx) => (
                  <div key={idx} className="border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-helix-gray-500">Q{ext.q}</span>
                      <span className="text-[10px] bg-blue-50 text-helix-blue px-2 py-0.5 rounded font-medium">{ext.category || 'general'}</span>
                    </div>
                    {ext.key_points?.map((point, i) => <p key={i} className="text-xs text-helix-gray-700 mb-1">• {point}</p>)}
                    {ext.requirements?.map((req, i) => <p key={i} className="text-xs text-helix-blue mt-1 font-medium">→ {req}</p>)}
                  </div>
                ))}
              </div>
            )}
          </div>
          {interviewComplete && (
            <div className="mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={handleGenerateRequirements}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 bg-[#1E293B] text-white font-medium text-sm py-3.5 rounded-full disabled:opacity-50"
              >
                <ArrowRight className="w-4 h-4" /> Generate requirement form
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
