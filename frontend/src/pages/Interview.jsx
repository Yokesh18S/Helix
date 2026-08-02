import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { interviewAPI, applicationsAPI, requirementsAPI, authAPI } from '../services/api';
import { parseSpokenPhone, isValid10DigitPhone } from '../utils/phoneParser';
import { Mic, MicOff, RotateCcw, X, Sparkles, ArrowRight, Keyboard, Volume2, VolumeX, CheckCircle2, HelpCircle, AlertCircle, Circle } from 'lucide-react';
import toast from 'react-hot-toast';

// Helper: generate or retrieve guest token from localStorage
function getOrCreateGuestToken() {
  let token = localStorage.getItem('helix_guest_token');
  if (!token) {
    token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('helix_guest_token', token);
  }
  return token;
}

export default function Interview() {
  const { user, loginWithOtp, voiceEnabled, setVoiceEnabled } = useAuth();
  const navigate = useNavigate();
  const [applicationId, setApplicationId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [currentQuestionText, setCurrentQuestionText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [answers, setAnswers] = useState({});
  const [extractions, setExtractions] = useState([]);
  const [totalCaptured, setTotalCaptured] = useState(0);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textAnswer, setTextAnswer] = useState('');
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [followUp, setFollowUp] = useState(null);
  const [readyToAnswer, setReadyToAnswer] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [processingStep, setProcessingStep] = useState(''); // 'transcribing', 'analyzing', 'done'
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [started, setStarted] = useState(true); // starts automatically
  const [isGuestMode] = useState(!user); // true when not authenticated
  const guestTokenRef = useRef(getOrCreateGuestToken());
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const recognitionRef = useRef(null);
  const voicesRef = useRef([]);
  const activeUtteranceRef = useRef(null);

  const [interviewPhase, setInterviewPhase] = useState('collect_name');
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [simulatedOtp, setSimulatedOtp] = useState('');
  const [coverage, setCoverage] = useState({ overall_percent: 0, collected_fields: [], missing_fields: [] });
  const [currentLanguageCode, setCurrentLanguageCode] = useState('en-US');

  const startRecordingRef = useRef(null);
  const stopRecordingRef = useRef(null);
  const silenceTimeoutRef = useRef(null);
  const resetSilenceTimeoutRef = useRef(null);
  const liveTranscriptRef = useRef('');

  const resetSilenceTimeout = useCallback((timeoutMs = 1800) => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    silenceTimeoutRef.current = setTimeout(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        stopRecordingRef.current?.();
      }
    }, timeoutMs);
  }, []);

  useEffect(() => {
    resetSilenceTimeoutRef.current = resetSilenceTimeout;
  }, [resetSilenceTimeout]);

  // Load voices - this is crucial for TTS to work
  useEffect(() => {
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        voicesRef.current = voices;
        setVoicesLoaded(true);
        console.log(`Loaded ${voices.length} voices`);
      }
    };

    // Try immediately
    loadVoices();

    // Also listen for the event (Chrome loads voices async)
    synth.onvoiceschanged = loadVoices;

    // Fallback: poll for voices
    const interval = setInterval(() => {
      if (voicesRef.current.length === 0) {
        loadVoices();
      } else {
        clearInterval(interval);
      }
    }, 200);

    return () => {
      clearInterval(interval);
      synth.onvoiceschanged = null;
    };
  }, []);

  // Setup Web Speech Recognition for live transcript
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        setLiveTranscript(final + interim);
        liveTranscriptRef.current = final + interim;
        resetSilenceTimeoutRef.current?.(1800);
      };

      recognition.onerror = (e) => {
        console.log('Speech recognition error:', e.error);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Dynamically update speech recognition language
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = currentLanguageCode;
      console.log(`Speech recognition language updated to: ${currentLanguageCode}`);
    }
  }, [currentLanguageCode]);

  // Track answers count in a ref for cleanup (avoids stale closure issues)
  const answersCountRef = useRef(0);
  const appIdRef = useRef(null);

  useEffect(() => {
    answersCountRef.current = Object.keys(answers).length;
  }, [answers]);

  useEffect(() => {
    appIdRef.current = applicationId;
  }, [applicationId]);

  // Cleanup: delete empty draft ONLY on unmount (not on re-renders)
  useEffect(() => {
    return () => {
      if (appIdRef.current && answersCountRef.current < 2) {
        applicationsAPI.delete(appIdRef.current).catch(() => {});
      }
    };
  }, []); // empty deps = only on unmount

  // Get preferred voice
  const getPreferredVoice = useCallback((langCode = 'en-US') => {
    const voices = voicesRef.current.length > 0 ? voicesRef.current : synthRef.current.getVoices();
    const primaryLang = langCode.split('-')[0].toLowerCase();
    
    // 1. Try to find a voice that exactly matches the language code
    let match = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase());
    if (match) return match;
    
    // 2. Try to find a voice that matches the primary language (e.g. 'hi' or 'ta')
    match = voices.find(v => v.lang.toLowerCase().startsWith(primaryLang));
    if (match) return match;
    
    // 3. Fallback to English female voices
    match = voices.find(v =>
      v.name.includes('Samantha') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira') ||
      v.name.includes('Tessa')
    );
    if (match) return match;
    
    // 4. Fallback to any English voice
    match = voices.find(v => v.lang.startsWith('en'));
    if (match) return match;
    
    return voices[0];
  }, []);

  const speakText = useCallback((text, onEnd, langCode) => {
    if (!voiceEnabled) {
      if (onEnd) onEnd();
      return;
    }
    const synth = synthRef.current;
    
    // Clear callbacks on previous utterance to prevent them from firing when cancelled
    if (activeUtteranceRef.current) {
      activeUtteranceRef.current.onstart = null;
      activeUtteranceRef.current.onend = null;
      activeUtteranceRef.current.onerror = null;
    }
    
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    activeUtteranceRef.current = utterance;
    
    // Set target language on the utterance
    const targetLang = langCode || currentLanguageCode;
    utterance.lang = targetLang;
    
    utterance.rate = 0.96;  // calm, pleasant, sweet cadence
    utterance.pitch = 1.12; // warm, cheerful melody tone
    const voice = getPreferredVoice(targetLang);
    if (voice) utterance.voice = voice;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      if (activeUtteranceRef.current === utterance) {
        setIsSpeaking(false);
        activeUtteranceRef.current = null;
        if (onEnd) onEnd();
        setTimeout(() => {
          startRecordingRef.current?.();
        }, 300);
      }
    };
    utterance.onerror = (event) => {
      if (event.error === 'interrupted') {
        return;
      }
      if (activeUtteranceRef.current === utterance) {
        setIsSpeaking(false);
        activeUtteranceRef.current = null;
        if (onEnd) onEnd();
        setTimeout(() => {
          startRecordingRef.current?.();
        }, 300);
      }
    };
    synth.speak(utterance);
  }, [voiceEnabled, getPreferredVoice, currentLanguageCode]);

  const replayQuestion = () => {
    speakText(currentQuestionText, () => setReadyToAnswer(true), currentLanguageCode);
  };

  const toggleVoice = () => {
    if (voiceEnabled) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
    setVoiceEnabled(!voiceEnabled);
    setReadyToAnswer(true);
  };


  // Start the interview session (creates app on backend and unlocks TTS)
  const handleStart = async () => {
    setLiveTranscript('');
    liveTranscriptRef.current = '';

    try {
      let res;
      if (user) {
        res = await applicationsAPI.create({ project_name: null });
      } else {
        res = await applicationsAPI.createGuest(guestTokenRef.current);
        localStorage.setItem('helix_pending_guest_token', guestTokenRef.current);
      }
      setApplicationId(res.data.id);
    } catch (err) {
      toast.error('Failed to start interview. Please try again.');
      return;
    }

    const synth = synthRef.current;
    const unlock = new SpeechSynthesisUtterance('');
    unlock.volume = 0;
    synth.speak(unlock);

    // Welcome greeting and Name request
    speakText("Welcome to Helix! Let's get started. Could you please tell me your name?", () => setReadyToAnswer(true));
  };

  // Automatically start the interview on page mount
  useEffect(() => {
    handleStart();
  }, []);


  const startRecording = async () => {
    try {
      synthRef.current.cancel();
      setIsSpeaking(false);
      setLiveTranscript('');
      liveTranscriptRef.current = '';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch(e) {}
        }
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);

      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch(e) {}
      }

      resetSilenceTimeout(6000);
    } catch (err) {
      toast.error('Microphone access denied. Please allow microphone access or use text input.');
      setShowTextInput(true);
    }
  };

  const stopRecording = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const fetchFirstQuestion = async () => {
    setIsProcessing(true);
    setProcessingStep('analyzing');
    try {
      let res;
      if (isGuestMode) {
        res = await interviewAPI.firstQuestionGuest(applicationId, guestTokenRef.current);
      } else {
        res = await interviewAPI.firstQuestion(applicationId);
      }
      setCurrentQuestionText(res.data.question);
      setCurrentQuestion(res.data.question_number);
      if (res.data.coverage) {
        setCoverage(res.data.coverage);
      }
      // Speak the first question
      const lang = res.data.language_code || 'en-US';
      if (res.data.language_code) {
        setCurrentLanguageCode(res.data.language_code);
      }
      speakText(res.data.question, () => setReadyToAnswer(true), lang);
    } catch (err) {
      console.error(err);
      toast.error("Failed to start requirements gathering.");
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  useEffect(() => {
    if (interviewPhase === 'business_questions' && applicationId) {
      fetchFirstQuestion();
    }
  }, [interviewPhase, applicationId]);

  const processAudio = async (audioBlob) => {
    // If name, phone or OTP collection, process speech transcription locally (instantaneous and voice-first)
    if (interviewPhase === 'collect_name') {
      const name = liveTranscriptRef.current.trim();
      if (!name) {
        toast.error("Could not hear you. Please try again.");
        speakText("I couldn't hear you. Please tell me your name.", () => setReadyToAnswer(true));
        return;
      }
      setUserName(name);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
      setTextAnswer('');
      
      setInterviewPhase('collect_phone');
      speakText(`Thank you, ${name}! And what is your phone number?`, () => setReadyToAnswer(true));
      return;
    }

    if (interviewPhase === 'collect_phone') {
      const phoneRaw = liveTranscriptRef.current.trim();
      let cleanedPhone = parseSpokenPhone(phoneRaw);
      // Strip country code if longer than 10 digits
      if (cleanedPhone.length > 10) {
        cleanedPhone = cleanedPhone.slice(-10);
      }

      if (!isValid10DigitPhone(cleanedPhone)) {
        toast.error('Please enter a valid 10-digit phone number');
        speakText("I couldn't get a valid 10-digit phone number. Please say your phone number again.", () => setReadyToAnswer(true));
        return;
      }
      
      setUserPhone(cleanedPhone);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
      setTextAnswer('');
      
      setIsProcessing(true);
      setProcessingStep('analyzing');
      try {
        const res = await authAPI.initiateOtp({ phone: cleanedPhone, name: userName });
        if (res.data.simulated_otp) {
          setSimulatedOtp(res.data.simulated_otp);
          toast.success(`[Helix SMS Simulation] OTP for ${cleanedPhone} is: ${res.data.simulated_otp}`, {
            duration: 10000
          });
        }
        setInterviewPhase('business_questions');
      } catch (err) {
        toast.error('Failed to register or lookup profile. Please try again.');
      } finally {
        setIsProcessing(false);
        setProcessingStep('');
      }
      return;
    }

    if (interviewPhase === 'otp_verification') {
      const otp = liveTranscriptRef.current.trim().replace(/\D/g, '');
      if (otp.length !== 6) {
        toast.error('Please enter a valid 6-digit OTP code.');
        speakText("I couldn't get a valid 6-digit OTP. Please say your OTP code again.", () => setReadyToAnswer(true));
        return;
      }
      handleOtpSubmit(otp);
      return;
    }

    // Regular business questions
    if (!liveTranscriptRef.current.trim()) {
      toast.error("Could not hear you. Please try again.");
      replayQuestion();
      return;
    }

    setIsProcessing(true);
    setProcessingStep('transcribing');
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = reader.result.split(',')[1];
        setProcessingStep('analyzing');

        let res;
        if (user) {
          res = await interviewAPI.processVoice({
            audio_base64: base64Audio,
            application_id: applicationId,
          });
        } else {
          res = await interviewAPI.processVoiceGuest({
            audio_base64: base64Audio,
            application_id: applicationId,
            guest_token: guestTokenRef.current,
          });
        }

        setProcessingStep('done');
        setTimeout(() => {
          setProcessingStep('');
          handleResponse(res.data);
        }, 500);
      };
    } catch (err) {
      toast.error('Failed to process audio. Try using text input.');
      setShowTextInput(true);
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  const submitTextAnswer = async () => {
    if (!textAnswer.trim()) return;

    if (interviewPhase === 'collect_name') {
      const name = textAnswer.trim();
      setUserName(name);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
      setTextAnswer('');
      
      setInterviewPhase('collect_phone');
      speakText(`Thank you, ${name}! And what is your phone number?`, () => setReadyToAnswer(true));
      return;
    }

    if (interviewPhase === 'collect_phone') {
      const phoneRaw = textAnswer.trim();
      let cleanedPhone = parseSpokenPhone(phoneRaw);
      // Strip country code if longer than 10 digits
      if (cleanedPhone.length > 10) {
        cleanedPhone = cleanedPhone.slice(-10);
      }

      if (!isValid10DigitPhone(cleanedPhone)) {
        toast.error('Please enter a valid 10-digit phone number');
        speakText('That phone number seems a bit short or long. Please say or type a 10-digit phone number.', () => setReadyToAnswer(true));
        return;
      }
      
      setUserPhone(cleanedPhone);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
      setTextAnswer('');
      
      setIsProcessing(true);
      setProcessingStep('analyzing');
      try {
        const res = await authAPI.initiateOtp({ phone: cleanedPhone, name: userName });
        if (res.data.simulated_otp) {
          setSimulatedOtp(res.data.simulated_otp);
          toast.success(`[Helix SMS Simulation] OTP for ${cleanedPhone} is: ${res.data.simulated_otp}`, {
            duration: 10000
          });
        }
        setInterviewPhase('business_questions');
      } catch (err) {
        toast.error('Failed to register or lookup profile. Please try again.');
      } finally {
        setIsProcessing(false);
        setProcessingStep('');
      }
      return;
    }

    if (interviewPhase === 'otp_verification') {
      const otp = textAnswer.trim().replace(/\D/g, '');
      handleOtpSubmit(otp);
      return;
    }

    setIsProcessing(true);
    setProcessingStep('analyzing');
    try {
      let res;
      if (user) {
        res = await interviewAPI.processText(applicationId, {
          answer_text: textAnswer.trim()
        });
      } else {
        res = await interviewAPI.processTextGuest(applicationId, guestTokenRef.current, {
          answer_text: textAnswer.trim()
        });
      }
      setProcessingStep('done');
      setTimeout(() => {
        setProcessingStep('');
        handleResponse(res.data);
      }, 500);
      setTextAnswer('');
    } catch (err) {
      toast.error('Failed to process answer');
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  const handleGenerateOtp = async (phoneToUse = userPhone) => {
    let cleanedPhone = parseSpokenPhone(phoneToUse.trim());
    if (cleanedPhone.length > 10) cleanedPhone = cleanedPhone.slice(-10);
    if (!isValid10DigitPhone(cleanedPhone)) {
      toast.error('Please enter a valid 10-digit phone number');
      return;
    }
    setIsProcessing(true);
    try {
      const res = await authAPI.initiateOtp({ phone: cleanedPhone, name: userName });
      if (res.data.simulated_otp) {
        setSimulatedOtp(res.data.simulated_otp);
        toast.success(`[Helix SMS Simulation] OTP for ${cleanedPhone} is: ${res.data.simulated_otp}`, {
          duration: 10000
        });
      } else {
        toast.success(`OTP sent to ${cleanedPhone}`);
      }
    } catch (err) {
      toast.error('Failed to send OTP. Please check phone number and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOtpSubmit = async (otpCode) => {
    const code = (otpCode || otpCodeInput).trim().replace(/\D/g, '');
    if (!code || code.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP code.');
      speakText('The OTP code should be six digits. Please check and try again.', () => setReadyToAnswer(true));
      return;
    }
    
    setIsProcessing(true);
    setProcessingStep('analyzing');
    try {
      // 1. Verify OTP and authenticate user
      const authRes = await authAPI.verifyOtp({ phone: userPhone, otp_code: code });
      const { access_token, user: userData } = authRes.data;
      
      // 2. Save user session locally
      loginWithOtp(access_token, userData);
      
      // 3. Claim the guest application session
      try {
        await interviewAPI.claimGuestSession(guestTokenRef.current);
      } catch (e) {
        console.warn('Guest session claim error:', e);
      }
      
      // 4. Generate requirements
      setProcessingStep('done');
      try {
        await requirementsAPI.generate({ application_id: applicationId });
      } catch (e) {
        console.warn('Generate requirements error:', e);
      }
      
      // 5. Fetch user applications to detect existing vs new user
      let userApps = [];
      try {
        const appsRes = await applicationsAPI.getAll();
        userApps = appsRes.data || [];
      } catch (e) {
        console.warn('Failed to fetch applications:', e);
      }
      
      // Clear pending guest tokens
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      
      answersCountRef.current = 99; // bypass exit deletion
      
      // Existing user (has previous projects before/in addition to this one)
      if (userApps.length > 1) {
        toast.success(`Welcome back, ${userData.full_name || 'User'}! Showing your previous projects.`);
        speakText(`Welcome back! Redirecting you to your projects dashboard.`);
        setTimeout(() => {
          navigate('/dashboard');
        }, 1500);
      } else {
        // New user (only this 1 project)
        toast.success(`Welcome! Your project requirements are ready.`);
        speakText(`Welcome! Redirecting you to your project requirements page.`);
        setTimeout(() => {
          navigate(`/requirements/${applicationId}`);
        }, 1500);
      }
    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.detail || 'Invalid OTP code. Please try again.';
      toast.error(errMsg);
      speakText('That OTP code was incorrect. Please try again.', () => setReadyToAnswer(true));
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  const handleResponse = (data) => {
    setAnswers(prev => ({ ...prev, [currentQuestion]: data.transcribed_text }));
    setLiveTranscript('');
    liveTranscriptRef.current = '';

    if (data.ai_extraction) {
      setExtractions(prev => [...prev, { q: currentQuestion, ...data.ai_extraction }]);
      setTotalCaptured(prev => prev + (data.ai_extraction.requirements?.length || 1));
      answersCountRef.current = (answersCountRef.current || 0) + 1;
    }

    if (data.coverage) {
      setCoverage(data.coverage);
    }

    const lang = data.language_code || 'en-US';
    if (data.language_code) {
      setCurrentLanguageCode(data.language_code);
    }

    // Show acknowledgement in the follow-up display area
    const ack = data.acknowledgement || '';
    if (ack) {
      setFollowUp(ack);
    }

    if (data.contradiction) {
      toast.error(data.contradiction, { duration: 6000 });
      // Speak contradiction, then move on
      speakText(data.contradiction, () => {
        if (data.interview_complete) {
          setInterviewComplete(true);
          if (user) {
            speakText('Excellent! The interview is complete. Generating your requirements document now...', () => {
              handleGenerateRequirements();
            }, lang);
          } else {
            setInterviewPhase('otp_verification');
            speakText('Excellent! The interview is complete. To register or sign in and view your requirements, please enter the 6-digit OTP code sent to your phone number.', () => setReadyToAnswer(true), lang);
          }
        } else if (data.next_question) {
          setCurrentQuestionText(data.next_question);
          setCurrentQuestion(prev => prev + 1);
          speakText(data.next_question, () => setReadyToAnswer(true), lang);
        }
      }, lang);
      setIsProcessing(false);
      return;
    }

    if (data.interview_complete) {
      setInterviewComplete(true);
      if (user) {
        speakText('Excellent! The interview is complete. Generating your requirements document now...', () => {
          handleGenerateRequirements();
        }, lang);
      } else {
        setInterviewPhase('otp_verification');
        // Immediately initiate OTP for pre-filled user phone number
        if (userPhone && isValid10DigitPhone(userPhone)) {
          authAPI.initiateOtp({ phone: userPhone, name: userName }).then(res => {
            if (res.data.simulated_otp) {
              setSimulatedOtp(res.data.simulated_otp);
              toast.success(`[Helix SMS Simulation] OTP for ${userPhone} is: ${res.data.simulated_otp}`, {
                duration: 10000
              });
            }
          }).catch(() => {});
        }
        speakText('Excellent! The interview is complete. Please verify your OTP to sign in and access your project.', () => setReadyToAnswer(true), lang);
      }
    } else if (data.next_question) {
      setCurrentQuestionText(data.next_question);
      setCurrentQuestion(prev => prev + 1);
      // Speak next_question ONCE directly (it already contains acknowledgement + question from backend)
      speakText(data.next_question, () => setReadyToAnswer(true), lang);
    }
    setIsProcessing(false);
  };

  const handleGenerateRequirements = async () => {
    if (!user) {
      localStorage.setItem('helix_pending_guest_token', guestTokenRef.current);
      localStorage.setItem('helix_pending_app_id', String(applicationId));
      speakText("Please sign in to save and view your requirements.");
      setTimeout(() => navigate('/login?claim=true'), 2000);
      return;
    }

    setIsProcessing(true);
    try {
      await requirementsAPI.generate({ application_id: applicationId });
      toast.success('Requirements generated!');
      // Set answersCountRef high so cleanup doesn't delete
      answersCountRef.current = 99;
      navigate(`/requirements/${applicationId}`);
    } catch (err) {
      console.error('Generate requirements error:', err.response?.data || err.message);
      const errorMsg = err.response?.data?.detail || 'Failed to generate requirements. Please try again.';
      toast.error(errorMsg);
      setIsProcessing(false);
    }
  };

  const progressPercent = interviewPhase === 'collect_name' || interviewPhase === 'collect_phone'
    ? 0
    : interviewPhase === 'otp_verification'
    ? 100
    : coverage.overall_percent;

  // ============ MAIN INTERVIEW UI ============
  return (
    <div className="min-h-screen bg-[#F6F7FE] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white border border-gray-100 rounded-full px-4 py-1 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-blue-500 animate-pulse' : isRecording ? 'bg-red-500 animate-pulse' : 'bg-green-50'}`}></div>
            <span className="text-xs font-medium">
              {isSpeaking ? 'Helix is speaking...' : isRecording ? 'Listening to you...' : isProcessing ? 'Processing...' : 'Helix is ready'}
            </span>
          </div>
          <button
            onClick={toggleVoice}
            className={`p-1.5 rounded-full border ${voiceEnabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
            title={voiceEnabled ? 'Speaker ON - click to mute' : 'Speaker OFF - click to unmute'}
          >
            {voiceEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-gray-400" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-4">
          {interviewPhase === 'collect_name' || interviewPhase === 'collect_phone' ? (
            <span className="font-semibold text-sm text-helix-gray-600">Profile Setup</span>
          ) : interviewPhase === 'otp_verification' ? (
            <span className="font-semibold text-sm text-[#8B5CF6]">OTP Verification</span>
          ) : (
            <>
              <span className="font-semibold text-sm text-helix-gray-500">Project Understanding</span>
              <span className="font-bold text-base text-blue-600">{coverage.overall_percent}%</span>
            </>
          )}
          <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        <button
          onClick={() => {
            synthRef.current.cancel();
            navigate('/dashboard');
          }}
          className="flex items-center gap-1 text-base font-medium text-helix-navy hover:text-red-500"
        >
          Exit <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex h-[calc(100vh-67px-52px)]">
        {/* Left Panel - Interview */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 pb-12 px-6 md:px-10 border-r border-[#D4DCE8] overflow-y-auto">
          {(!interviewComplete || (!user && interviewPhase === 'otp_verification')) ? (
            <>
              {/* Question / Step Heading */}
              {interviewPhase === 'collect_name' && (
                <div className="w-full max-w-xl text-center mb-6">
                  <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-3 uppercase">
                    PROFILE SETUP
                  </p>
                  <h2 className="text-2xl md:text-3xl font-semibold text-helix-navy leading-snug">
                    Welcome to Helix! Let's get started. Could you please tell me your name?
                  </h2>
                </div>
              )}

              {interviewPhase === 'collect_phone' && (
                <div className="w-full max-w-xl text-center mb-6">
                  <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-3 uppercase">
                    PROFILE SETUP
                  </p>
                  <h2 className="text-2xl md:text-3xl font-semibold text-helix-navy leading-snug">
                    Thank you, {userName}! And what is your phone number?
                  </h2>
                </div>
              )}

              {interviewPhase === 'business_questions' && (
                <div className="w-full max-w-2xl text-center mb-6">
                  <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-3 uppercase">
                    QUESTION {currentQuestion}
                  </p>
                  <h2 className="text-xl md:text-2xl font-medium text-helix-navy leading-relaxed px-2">
                    {currentQuestionText || "Preparing next question..."}
                  </h2>
                </div>
              )}

              {interviewPhase === 'otp_verification' && (
                <>
                  <p className="text-xs font-semibold text-[#8B5CF6] tracking-[0.18em] mb-4 uppercase">
                    OTP VERIFICATION & SIGN IN
                  </p>
                  <h2 className="text-3xl font-semibold text-helix-navy text-center max-w-lg mb-2">
                    Sign In to Access Your Project
                  </h2>
                  <p className="text-sm text-helix-gray-500 text-center max-w-md mb-4">
                    Your phone number from the interview has been placed below. Generate and enter your OTP to sign in.
                  </p>
                </>
              )}

              {/* Replay */}
              {interviewPhase === 'business_questions' && (
                <button
                  onClick={replayQuestion}
                  disabled={isSpeaking}
                  className="flex items-center gap-1.5 text-sm font-medium text-helix-gray-500 mb-8 hover:text-helix-blue disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Replay question
                </button>
              )}

              {/* ======= PROCESSING INDICATOR ======= */}
              {isProcessing && (
                <div className="w-full max-w-md mb-6">
                  <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                    {/* Progress steps */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`flex items-center gap-2 ${processingStep === 'transcribing' ? 'text-blue-600' : processingStep === 'analyzing' || processingStep === 'done' ? 'text-green-600' : 'text-gray-400'}`}>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${processingStep === 'transcribing' ? 'border-blue-500 bg-blue-50' : processingStep === 'analyzing' || processingStep === 'done' ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}>
                          {(processingStep === 'analyzing' || processingStep === 'done') ? (
                            <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          ) : (
                            <span className="text-[8px] font-bold">1</span>
                          )}
                        </div>
                        <span className="text-xs font-medium">Transcribing</span>
                      </div>
                      <div className="flex-1 h-0.5 bg-gray-200 rounded">
                        <div className={`h-full rounded transition-all duration-500 ${processingStep === 'analyzing' || processingStep === 'done' ? 'w-full bg-green-400' : processingStep === 'transcribing' ? 'w-1/2 bg-blue-400 animate-pulse' : 'w-0'}`}></div>
                      </div>
                      <div className={`flex items-center gap-2 ${processingStep === 'analyzing' ? 'text-blue-600' : processingStep === 'done' ? 'text-green-600' : 'text-gray-400'}`}>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${processingStep === 'analyzing' ? 'border-blue-500 bg-blue-50' : processingStep === 'done' ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}>
                          {processingStep === 'done' ? (
                            <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          ) : (
                            <span className="text-[8px] font-bold">2</span>
                          )}
                        </div>
                        <span className="text-xs font-medium">Analyzing</span>
                      </div>
                    </div>
                    {/* Animated progress bar */}
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-1000 ${
                        processingStep === 'transcribing' ? 'w-1/3 bg-gradient-to-r from-blue-400 to-blue-600 animate-pulse' :
                        processingStep === 'analyzing' ? 'w-2/3 bg-gradient-to-r from-blue-400 to-purple-500 animate-pulse' :
                        processingStep === 'done' ? 'w-full bg-gradient-to-r from-green-400 to-green-600' : 'w-0'
                      }`}></div>
                    </div>
                    <p className="text-xs text-helix-gray-500 mt-2 text-center">
                      {processingStep === 'transcribing' && '🎤 Converting your speech to text...'}
                      {processingStep === 'analyzing' && '🧠 AI is processing...'}
                      {processingStep === 'done' && '✅ Done!'}
                    </p>
                  </div>
                </div>
              )}

              {/* ======= LIVE TRANSCRIPT DISPLAY ======= */}
              {(isRecording || liveTranscript) && !isProcessing && (
                <div className="w-full max-w-md mb-6">
                  <div className="bg-white rounded-2xl border border-purple-100 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="text-xs font-medium text-helix-gray-600">Live transcript</span>
                    </div>
                    <p className="text-sm text-helix-gray-700 min-h-[40px]">
                      {liveTranscript || <span className="text-gray-400 italic">Start speaking...</span>}
                      {isRecording && <span className="inline-block w-0.5 h-4 bg-purple-500 ml-0.5 animate-pulse"></span>}
                    </p>
                  </div>
                </div>
              )}

              {/* ======= MIC / TEXT INPUT / OTP INTERFACE ======= */}
              {interviewPhase === 'otp_verification' ? (
                <div className="flex flex-col items-center mt-2 w-full max-w-md text-center bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
                  {/* Phone number field with Generate OTP button */}
                  <div className="w-full max-w-sm mb-5 text-left">
                    <label className="block text-xs font-semibold text-helix-navy mb-1.5">
                      Phone Number
                    </label>
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

                  {/* OTP Code field */}
                  <div className="w-full max-w-sm mb-5 text-left">
                    <label className="block text-xs font-semibold text-helix-navy mb-1.5">
                      Enter 6-Digit Verification Code
                    </label>
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
                        className={`mx-auto w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all ${
                          isRecording
                            ? 'bg-red-500 scale-105 shadow-md shadow-red-100'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                        title="Say OTP"
                      >
                        {isRecording ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5" />}
                      </button>
                      <p className="text-[11px] text-helix-gray-500 mt-1">You can also speak the OTP</p>
                    </div>
                  </div>
                </div>
              ) : (
                !isProcessing && (
                  <>
                    {!showTextInput ? (
                      <div className="flex flex-col items-center">
                        <div className="relative">
                          {isRecording && (
                            <>
                              <div className="absolute inset-[-24px] bg-purple-100/40 rounded-full voice-pulse"></div>
                              <div className="absolute inset-[-12px] bg-[#EFEAFE] rounded-full voice-pulse" style={{ animationDelay: '0.3s' }}></div>
                            </>
                          )}
                          <button
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={isSpeaking || !applicationId}
                            className={`relative z-10 w-[70px] h-[70px] rounded-full flex items-center justify-center transition-all ${
                              isRecording
                                ? 'bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] scale-110 shadow-lg shadow-purple-200 recording-glow'
                                : isSpeaking
                                ? 'bg-gray-300 cursor-not-allowed'
                                : 'bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] hover:scale-105 shadow-md shadow-purple-100'
                            }`}
                          >
                            {isRecording ? (
                              <MicOff className="w-7 h-7 text-white" />
                            ) : (
                              <Mic className="w-7 h-7 text-white" />
                            )}
                          </button>
                        </div>

                        <p className="text-sm font-medium text-helix-gray-500 mt-5">
                          {isSpeaking
                            ? '🔊 Wait for Helix to finish...'
                            : isRecording
                            ? '🔴 Recording — tap to stop'
                            : readyToAnswer
                            ? '🎤 Tap the mic to answer'
                            : '⏳ Preparing question...'}
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
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              submitTextAnswer();
                            }
                          }}
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
                )
              )}

              {/* Previous answer (only during business questions phase) */}
              {interviewPhase === 'business_questions' && answers[currentQuestion - 1] && !isProcessing && (
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
              <p className="text-sm text-helix-gray-600 mb-4">
                {totalCaptured} requirements captured from your responses.
              </p>
              {!user && (
                <div className="mb-6 bg-blue-50 border border-blue-100 rounded-xl p-4 text-left max-w-sm mx-auto">
                  <p className="text-sm font-semibold text-blue-800 mb-1">🔒 Sign in to save your work</p>
                  <p className="text-xs text-blue-600">
                    Your interview data is ready. Sign in or create an account to save your requirements document and access it anytime.
                  </p>
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

        {/* Right Panel - Requirement Coverage */}
        <div className="w-[400px] bg-white p-6 overflow-y-auto border-l border-gray-100 flex flex-col">
          <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.11em] mb-4 uppercase">
            Requirement Coverage
          </p>

          {/* Radial/Visual understanding card */}
          <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border border-blue-100/50 rounded-2xl p-4 mb-6">
            <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-white border border-blue-200 shadow-sm flex-shrink-0">
              <span className="text-base font-bold text-blue-600">{coverage.overall_percent}%</span>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-helix-gray-500 uppercase tracking-wider">Project Understanding</h4>
              <p className="text-sm font-bold text-helix-navy mt-0.5">
                {coverage.overall_percent >= 90 ? "Thoroughly Understood" : coverage.overall_percent >= 60 ? "Deep Understanding" : coverage.overall_percent >= 30 ? "Gathering Scope" : "Analyzing Idea"}
              </p>
            </div>
          </div>

          {/* Checklist of what's collected vs missing */}
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

          {/* Live Extractions List */}
          <div className="flex-1">
            <h4 className="text-xs font-bold text-helix-navy uppercase tracking-[0.11em] mb-3">
              Live Extractions ({totalCaptured})
            </h4>

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
                      <span className="text-[10px] bg-blue-50 text-helix-blue px-2 py-0.5 rounded font-medium">
                        {ext.category || 'general'}
                      </span>
                    </div>
                    {ext.key_points?.map((point, i) => (
                      <p key={i} className="text-xs text-helix-gray-700 mb-1">• {point}</p>
                    ))}
                    {ext.requirements?.map((req, i) => (
                      <p key={i} className="text-xs text-helix-blue mt-1 font-medium">→ {req}</p>
                    ))}
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
                <ArrowRight className="w-4 h-4" />
                Generate requirement form
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
