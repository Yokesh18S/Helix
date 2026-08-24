import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Play, Sparkles, X, Volume2, VolumeX } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { useVoiceAgent } from '../context/VoiceAgentContext';

export default function Landing() {
  const navigate = useNavigate();
  const { isSpeakerMuted, setSpeakerMuted } = useVoiceAgent();
  const { speak, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();

  // 'idle' | 'speaking' | 'listening' | 'navigating'
  const [voicePhase, setVoicePhase] = useState('idle');
  const [showTutorial, setShowTutorial] = useState(false);
  const startListeningRef = useRef(null);
  const stopListeningRef  = useRef(null);

  // ── Voice result handler ────────────────────────────────────────────────
  const handleVoiceResult = (result) => {
    if (!result.isFinal) return;
    const t = result.transcript.toLowerCase().trim();
    console.log('[Landing] Heard:', t);

    // Start interview — only on clear explicit intent (not vague words)
    if (
      t.includes('start interview') || t.includes('begin interview') ||
      t.includes('start voice') || t.includes('start the interview') ||
      t.includes("let's start") || t.includes('lets start') ||
      t.includes('start') || t.includes('begin')
    ) {
      setVoicePhase('navigating');
      speak("Starting your Helix AI interview now. Let's go!", () => navigate('/interview'));
      return;
    }

    // Sign in
    if (
      t.includes('sign in') || t.includes('signin') ||
      t.includes('login')   || t.includes('log in') ||
      t.includes('my work') || t.includes('saved') || t.includes('dashboard') ||
      t.includes('account')
    ) {
      setVoicePhase('navigating');
      speak('Taking you to sign in.', () => navigate('/login'));
      return;
    }

    // Unrecognized input: stay on page
    setVoicePhase('speaking');
    speak("Please say 'start' or click 'Start Voice Interview' to begin.", () => {
      setVoicePhase('listening');
      startListeningRef.current?.();
    });
  };

  const { startListening, stopListening, isListening } = useVoiceRecognition({
    onResult: handleVoiceResult
  });

  // Keep refs updated so the effect closure is always fresh
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  useEffect(() => { stopListeningRef.current  = stopListening;  }, [stopListening]);

  // ── Start voice on mount ────────────────────────────────────────────────
  useEffect(() => {
    // Start listening immediately so it is active even if TTS Autoplay is blocked
    startListening();

    const timer = setTimeout(() => {
      setVoicePhase('speaking');
      speak(
        "Hello! Welcome to Helix, your AI requirements assistant. Just click start voice interview, or say 'start' to begin.",
        () => {
          setVoicePhase('listening');
          startListening();
        }
      );
    }, 300);

    return () => {
      clearTimeout(timer);
      stopListening();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keep mic alive while in listening phase ─────────────────────────────
  useEffect(() => {
    if (voicePhase === 'listening' && !isListening && !isSpeaking) {
      const t = setTimeout(() => {
        if (!isListening && !isSpeaking) startListening();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [isListening, isSpeaking, voicePhase, startListening]);

  return (
    <div className="min-h-screen bg-[#EEF1F8] pt-[67px] flex flex-col items-center justify-center relative overflow-hidden">
      
      {/* Speaker Mute Control */}
      <button
        onClick={() => {
          if (!isSpeakerMuted) {
            stopSpeaking();
          }
          setSpeakerMuted(!isSpeakerMuted);
        }}
        className="absolute top-24 right-6 z-50 p-3 bg-white border border-gray-200 rounded-full shadow-sm hover:shadow-md transition-all flex items-center justify-center text-gray-600 hover:text-indigo-600 focus:outline-none"
        aria-label={isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}
        title={isSpeakerMuted ? "Speaker Muted" : "Speaker On"}
      >
        {isSpeakerMuted ? <VolumeX className="w-5 h-5 text-gray-400" /> : <Volume2 className="w-5 h-5" />}
      </button>

      {/* CSS-based Custom Waveform and Mouth Sync Styling */}
      <style>{`
        @keyframes waveform {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1.2); }
        }
        .wave-bar {
          animation: waveform 1.2s ease-in-out infinite;
          transform-origin: bottom;
        }
        .wave-bar:nth-child(2n) { animation-delay: 0.15s; }
        .wave-bar:nth-child(3n) { animation-delay: 0.3s; }
        .wave-bar:nth-child(4n) { animation-delay: 0.45s; }
        .wave-bar:nth-child(5n) { animation-delay: 0.6s; }
      `}</style>

      {/* Main Container */}
      <div className="flex flex-col items-center justify-center max-w-lg text-center px-6 z-10">
        
        {/* Pill Badge */}
        <div className="bg-[#E0E7FF] border border-[#C7D2FE] rounded-full px-4 py-1.5 mb-6 flex items-center gap-2 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-[#4F46E5] animate-pulse" />
          <span className="text-[11px] font-semibold text-[#4F46E5] uppercase tracking-wider">
            Voice assistant Helix
          </span>
        </div>

        {/* Central Helix Avatar with glowing circular border */}
        <div className="relative mb-8">
          {/* Glowing outer aura */}
          <div className="absolute inset-[-12px] rounded-full bg-gradient-to-tr from-blue-400/20 to-purple-500/20 blur-xl animate-pulse"></div>
          
          {/* Outer thick border */}
          <div className="w-52 h-52 rounded-full p-2.5 bg-white shadow-2xl flex items-center justify-center">
            {/* Inner glowing blue border */}
            <div className="w-full h-full rounded-full p-1 bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-600 flex items-center justify-center overflow-hidden relative">
              <img 
                src="/helix_avatar.png" 
                alt="Helix Avatar" 
                className="w-full h-full object-cover rounded-full bg-white scale-[1.02] transition-transform duration-500 hover:scale-105"
                onError={(e) => {
                  // Fallback if image fails to load
                  e.currentTarget.src = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80";
                }}
              />
            </div>
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-4xl md:text-5xl font-extrabold text-[#1E293B] tracking-tight mb-8">
          Hi, I'm <span className="bg-gradient-to-r from-[#4F46E5] via-[#8B5CF6] to-[#EC4899] bg-clip-text text-transparent">Helix</span>
        </h2>

        {/* Dynamic Waveform Visualizer */}
        <div className="flex items-end justify-center gap-[4px] h-10 w-44 mb-8">
          {[...Array(15)].map((_, i) => {
            const minHeight = [12, 18, 24, 30, 20, 26, 32, 16, 28, 22, 18, 24, 30, 14, 8][i];
            const isWaveActive = isListening || isSpeaking;
            return (
              <div
                key={i}
                className="w-[3px] rounded-full bg-[#8B5CF6] wave-bar transition-all"
                style={{
                  height: `${minHeight}px`,
                  animationDuration: isSpeaking ? '0.7s' : isListening ? '0.9s' : '0s',
                  animationPlayState: isWaveActive ? 'running' : 'paused',
                  opacity: isWaveActive ? 0.9 : 0.4
                }}
              />
            );
          })}
        </div>

        {/* Buttons (Replaces "Tap the mic..." portion) */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          {/* Start voice interview (dark button) */}
          <button
            onClick={() => {
              stopSpeaking();
              navigate('/interview');
            }}
            className="flex items-center justify-center gap-2 bg-[#1E293B] hover:bg-[#0f172a] text-white font-semibold text-sm px-8 py-3.5 rounded-full shadow-lg shadow-slate-200 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto"
          >
            <Mic className="w-4 h-4 text-white" />
            Start voice interview
          </button>

          {/* See Tutorial (white button) */}
          <button
            onClick={() => setShowTutorial(true)}
            className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-[#1E293B] font-semibold text-sm px-8 py-3.5 rounded-full border border-slate-200 shadow-md transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto"
          >
            <Play className="w-4 h-4 text-[#1E293B]" />
            See Tutorial
          </button>
        </div>

      </div>

      {/* Tutorial Modal */}
      {showTutorial && (
        <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-white/50 relative transform transition-all duration-300 scale-100">
            {/* Close Button */}
            <button 
              onClick={() => setShowTutorial(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-[#8B5CF6]">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-[#1E293B]">How Helix Works</h3>
            </div>

            <div className="space-y-6 mb-8 text-left">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700 flex-shrink-0">
                  1
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-[#1E293B] mb-1">Voice Interview</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Answer 12 smart questions about your project idea. You can speak naturally or type your answers.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700 flex-shrink-0">
                  2
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-[#1E293B] mb-1">AI Extraction</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Helix parses your responses in real-time, extracting precise technical features and business domains.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700 flex-shrink-0">
                  3
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-[#1E293B] mb-1">Generate & Save</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Once finished, sign in to save the generated document to your account, ready to download.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowTutorial(false);
                stopSpeaking();
                navigate('/interview');
              }}
              className="w-full bg-[#1E293B] hover:bg-[#0f172a] text-white font-semibold py-3.5 rounded-full shadow-lg transition-colors text-sm"
            >
              Got it, let's start!
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
