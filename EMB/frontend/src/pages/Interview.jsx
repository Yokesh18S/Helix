import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { interviewAPI, applicationsAPI, requirementsAPI } from '../services/api';
import { Mic, MicOff, RotateCcw, X, Sparkles, ArrowRight, Keyboard, Volume2, VolumeX } from 'lucide-react';
import toast from 'react-hot-toast';

const QUESTIONS = [
  "What does your business do?",
  "What problem are you trying to solve with this project?",
  "Who are the primary users of this application?",
  "What are the key features you envision?",
  "Do you have any existing systems this needs to integrate with?",
  "What platforms should this work on — web, mobile, or both?",
  "What's your expected timeline for this project?",
  "Do you have a budget range in mind?",
  "Are there any specific technology preferences or constraints?",
  "How many users do you expect to use this system?",
  "What security or compliance requirements do you have?",
  "Is there anything else important we should know about your project?"
];

export default function Interview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [applicationId, setApplicationId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(1);
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
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [readyToAnswer, setReadyToAnswer] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [processingStep, setProcessingStep] = useState(''); // 'transcribing', 'analyzing', 'done'
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [started, setStarted] = useState(false); // user must click to start (needed for TTS)
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const recognitionRef = useRef(null);
  const voicesRef = useRef([]);

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
      };

      recognition.onerror = (e) => {
        console.log('Speech recognition error:', e.error);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // DON'T create application on mount - wait for user to click Start
  useEffect(() => {
    if (!user) {
      toast.error('Please sign in to start an interview');
      navigate('/login');
    }
  }, [user, navigate]);

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
      if (appIdRef.current && answersCountRef.current < 4) {
        applicationsAPI.delete(appIdRef.current).catch(() => {});
      }
    };
  }, []); // empty deps = only on unmount

  // Speak question when it changes (only after user starts)
  useEffect(() => {
    if (applicationId && started && voiceEnabled && !interviewComplete) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => speakQuestion(currentQuestion), 300);
      return () => clearTimeout(timer);
    } else if (applicationId && started && !voiceEnabled) {
      setReadyToAnswer(true);
    }
  }, [currentQuestion, applicationId, interviewComplete, started]);

  // Get preferred voice
  const getPreferredVoice = useCallback(() => {
    const voices = voicesRef.current.length > 0 ? voicesRef.current : synthRef.current.getVoices();
    return voices.find(v =>
      v.name.includes('Samantha') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira') ||
      v.name.includes('Tessa')
    ) || voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
      || voices.find(v => v.lang.startsWith('en'))
      || voices[0];
  }, []);

  // Speak question through speakers
  const speakQuestion = useCallback((questionNum) => {
    const synth = synthRef.current;
    synth.cancel();

    const questionText = QUESTIONS[questionNum - 1];
    let textToSpeak = questionText;

    if (questionNum === 1) {
      textToSpeak = `Hi! I'm Helix, your AI business consultant. Let's get started. ${questionText}`;
    } else if (questionNum === 12) {
      textToSpeak = `Great, this is our last question. ${questionText}`;
    } else {
      const transitions = [
        "Got it. ",
        "Thanks for that. ",
        "Understood. ",
        "Perfect. ",
        "Great. ",
        "Alright. ",
      ];
      const transition = transitions[Math.floor(Math.random() * transitions.length)];
      textToSpeak = transition + questionText;
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voice = getPreferredVoice();
    if (voice) {
      utterance.voice = voice;
      console.log(`Speaking with voice: ${voice.name}`);
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setReadyToAnswer(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setReadyToAnswer(true);
    };

    utterance.onerror = (e) => {
      console.error('TTS Error:', e);
      setIsSpeaking(false);
      setReadyToAnswer(true);
    };

    // Force Chrome to work by using a timeout
    setTimeout(() => {
      synth.speak(utterance);
    }, 50);
  }, [getPreferredVoice]);

  const speakFollowUp = useCallback((text) => {
    if (!voiceEnabled) return;
    const synth = synthRef.current;
    const utterance = new SpeechSynthesisUtterance(`Quick follow-up: ${text}`);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voice = getPreferredVoice();
    if (voice) utterance.voice = voice;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    synth.speak(utterance);
  }, [voiceEnabled, getPreferredVoice]);

  const speakText = useCallback((text) => {
    if (!voiceEnabled) return;
    const synth = synthRef.current;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    const voice = getPreferredVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    synth.speak(utterance);
  }, [voiceEnabled, getPreferredVoice]);

  const replayQuestion = () => {
    speakQuestion(currentQuestion);
  };

  const toggleVoice = () => {
    if (voiceEnabled) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
    setVoiceEnabled(!voiceEnabled);
    setReadyToAnswer(true);
  };

  // Start the interview (needed for user gesture to enable TTS)
  const handleStart = async () => {
    // Create the application only now (on explicit user action)
    try {
      const res = await applicationsAPI.create({ project_name: null });
      setApplicationId(res.data.id);
    } catch (err) {
      toast.error('Failed to start interview. Please try again.');
      return;
    }

    setStarted(true);
    // Trigger a silent utterance to "unlock" speech synthesis
    const synth = synthRef.current;
    const unlock = new SpeechSynthesisUtterance('');
    unlock.volume = 0;
    synth.speak(unlock);
  };

  const startRecording = async () => {
    try {
      synthRef.current.cancel();
      setIsSpeaking(false);
      setLiveTranscript('');

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
        // Stop live recognition
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch(e) {}
        }
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Start live speech recognition for visual feedback
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch(e) {
          console.log('Recognition already started or not available');
        }
      }
    } catch (err) {
      toast.error('Microphone access denied. Please allow microphone access or use text input.');
      setShowTextInput(true);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const processAudio = async (audioBlob) => {
    setIsProcessing(true);
    setProcessingStep('transcribing');
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = reader.result.split(',')[1];

        setProcessingStep('analyzing');

        const res = await interviewAPI.processVoice({
          audio_base64: base64Audio,
          application_id: applicationId,
          question_number: currentQuestion,
        });

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
    setIsProcessing(true);
    setProcessingStep('analyzing');
    try {
      const res = await interviewAPI.processText(applicationId, {
        question_number: currentQuestion,
        answer_text: textAnswer.trim()
      });
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

  const handleResponse = (data) => {
    setAnswers(prev => ({ ...prev, [currentQuestion]: data.transcribed_text }));
    setLiveTranscript('');

    if (data.ai_extraction) {
      setExtractions(prev => [...prev, { q: currentQuestion, ...data.ai_extraction }]);
      setTotalCaptured(prev => prev + (data.ai_extraction.requirements?.length || 1));
    }

    if (data.follow_up) {
      setFollowUp(data.follow_up);
      setTimeout(() => speakFollowUp(data.follow_up), 500);
    } else {
      setFollowUp(null);
    }

    if (currentQuestion >= 12) {
      setInterviewComplete(true);
      speakText("Excellent! Interview complete. I've captured all your requirements. Click Generate to create your document.");
    } else {
      setCurrentQuestion(prev => prev + 1);
    }
    setIsProcessing(false);
  };

  const handleGenerateRequirements = async () => {
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

  const progressPercent = ((currentQuestion - 1) / 12) * 100;

  // ============ PRE-START SCREEN ============
  if (!started) {
    return (
      <div className="min-h-screen bg-[#F6F7FE] pt-[67px] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-gradient-to-br from-[#945AF6] to-[#CE4EC2] rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-200">
            <Mic className="w-9 h-9 text-white" />
          </div>
          <h2 className="text-2xl font-semibold text-helix-navy mb-3">Ready to start your interview?</h2>
          <p className="text-sm text-helix-gray-600 mb-2">
            Helix will ask you 12 questions about your project.
          </p>
          <p className="text-sm text-helix-gray-600 mb-8">
            Questions will be <strong>spoken aloud</strong> through your speaker, and you can answer by voice or text.
          </p>
          <button
            onClick={handleStart}
            className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-base px-10 py-4 rounded-[32px] hover:bg-[#0f172a] transition-all hover:scale-105"
          >
            <Volume2 className="w-5 h-5" />
            Start Interview
          </button>
          <p className="text-xs text-helix-gray-500 mt-4">
            🔊 Make sure your speaker volume is up
          </p>
        </div>
      </div>
    );
  }

  // ============ MAIN INTERVIEW UI ============
  return (
    <div className="min-h-screen bg-[#F6F7FE] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white border border-gray-100 rounded-full px-4 py-1 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-blue-500 animate-pulse' : isRecording ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}></div>
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
          <span className="font-semibold text-base">Q{currentQuestion}</span>
          <span className="text-sm text-helix-gray-500">of 12</span>
          <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#6466FA] rounded-full transition-all duration-500"
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
        <div className="flex-1 flex flex-col items-center justify-center p-8 border-r border-[#D4DCE8] overflow-y-auto">
          {!interviewComplete ? (
            <>
              <p className="text-xs font-semibold text-helix-gray-500 tracking-[0.18em] mb-4">
                QUESTION {currentQuestion} OF 12
              </p>

              <h2 className="text-3xl font-semibold text-helix-navy text-center max-w-lg mb-4">
                {QUESTIONS[currentQuestion - 1]}
              </h2>

              {/* Speaking indicator - audio waveform */}
              {isSpeaking && (
                <div className="flex items-center gap-2 mb-4 px-5 py-2.5 bg-blue-50 rounded-full border border-blue-100">
                  <div className="flex items-end gap-[3px] h-5">
                    <div className="w-[3px] bg-blue-400 rounded-full animate-bounce" style={{ height: '8px', animationDelay: '0ms', animationDuration: '0.6s' }}></div>
                    <div className="w-[3px] bg-blue-500 rounded-full animate-bounce" style={{ height: '14px', animationDelay: '150ms', animationDuration: '0.6s' }}></div>
                    <div className="w-[3px] bg-blue-600 rounded-full animate-bounce" style={{ height: '10px', animationDelay: '300ms', animationDuration: '0.6s' }}></div>
                    <div className="w-[3px] bg-blue-500 rounded-full animate-bounce" style={{ height: '18px', animationDelay: '100ms', animationDuration: '0.6s' }}></div>
                    <div className="w-[3px] bg-blue-400 rounded-full animate-bounce" style={{ height: '6px', animationDelay: '250ms', animationDuration: '0.6s' }}></div>
                    <div className="w-[3px] bg-blue-500 rounded-full animate-bounce" style={{ height: '12px', animationDelay: '200ms', animationDuration: '0.6s' }}></div>
                  </div>
                  <span className="text-xs text-blue-600 font-medium ml-1">🔊 Speaking...</span>
                </div>
              )}

              {/* Follow-up */}
              {followUp && (
                <p className="text-sm text-helix-blue italic mb-4 text-center max-w-md bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                  💬 Follow-up: {followUp}
                </p>
              )}

              {/* Replay */}
              <button
                onClick={replayQuestion}
                disabled={isSpeaking}
                className="flex items-center gap-1.5 text-sm font-medium text-helix-gray-500 mb-8 hover:text-helix-blue disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Replay question
              </button>

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
                      {processingStep === 'analyzing' && '🧠 AI is extracting requirements...'}
                      {processingStep === 'done' && '✅ Done! Moving to next question...'}
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

              {/* ======= MIC / TEXT INPUT ======= */}
              {!isProcessing && (
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
                          disabled={isSpeaking}
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
                          disabled={!textAnswer.trim()}
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
              {answers[currentQuestion - 1] && !isProcessing && (
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
              <p className="text-sm text-helix-gray-600 mb-8">
                {totalCaptured} requirements captured from your responses.
              </p>
              <button
                onClick={handleGenerateRequirements}
                disabled={isProcessing}
                className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-[32px] hover:bg-[#0f172a] disabled:opacity-50"
              >
                {isProcessing ? 'Generating...' : 'Generate requirement form'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right Panel - Live Extraction */}
        <div className="w-[400px] bg-white p-6 overflow-y-auto">
          <p className="text-xs font-medium text-helix-gray-500 tracking-[0.11em] mb-2">
            LIVE EXTRACTION
          </p>
          <h3 className="text-lg font-semibold text-black mb-1">
            {totalCaptured} requirements captured
          </h3>

          {extractions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-gray-300" />
              </div>
              <p className="text-xs text-helix-gray-500 max-w-[200px]">
                Requirements will appear here as you answer Helix's questions.
              </p>
            </div>
          ) : (
            <div className="space-y-4 mt-6">
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
                    <p key={i} className="text-xs text-helix-blue mt-1">→ {req}</p>
                  ))}
                </div>
              ))}
            </div>
          )}

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

