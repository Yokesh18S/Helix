/**
 * Landing.jsx — Helix Home Screen Powered by Vapi Voice
 *
 * Flow:
 *  - When user visits Home screen, Vapi connects and greets the user with live voice.
 *  - Listens for user saying "Start" or clicking "Start voice interview".
 *  - Navigates seamlessly into /interview for the full structured consultation.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Play, Sparkles, X, Volume2, VolumeX } from 'lucide-react';
import VapiLib from '@vapi-ai/web';

const Vapi = VapiLib?.default ?? VapiLib;

// ── Vapi Credentials ─────────────────────────────────────────────────────────
const VAPI_PUBLIC_KEY   = import.meta.env.VITE_VAPI_PUBLIC_KEY || 'a2c52ad5-6121-4de8-b339-3876c597e16e';
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID || 'a2c52ad5-6121-4de8-b339-3876c597e16e';

export default function Landing() {
  const navigate = useNavigate();

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  const vapiRef = useRef(null);
  const mounted = useRef(true);

  const isNavigatingRef = useRef(false);

  const startInterview = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    if (vapiRef.current) {
      try {
        vapiRef.current.stop();
      } catch (_) {}
      vapiRef.current = null;
    }
    navigate('/interview');
  };



  // ── Initialize Vapi on Home Page for Live Greeting ──────────────────────────
  useEffect(() => {
    mounted.current = true;

    async function initLandingVoice() {
      try {
        if (vapiRef.current) {
          try { vapiRef.current.stop(); } catch (_) {}
          vapiRef.current = null;
        }

        const vapi = new Vapi(VAPI_PUBLIC_KEY);
        vapiRef.current = vapi;

        vapi.on('call-start', () => {
          if (!mounted.current) return;
          console.log('[Landing Vapi] Voice greeting active');
          setIsListening(true);
          setIsSpeaking(false);
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

          // Transcript from user
          if (msg.type === 'transcript' && msg.role === 'user') {
            const txt = (msg.transcript || '').toLowerCase().trim();
            setLiveTranscript(txt);

            if (msg.transcriptType === 'final' && txt) {
              console.log('[Landing Vapi] Heard user:', txt);

              // Detect "start" or "begin" to enter interview
              if (
                txt.includes('start') ||
                txt.includes('begin') ||
                txt.includes('interview') ||
                txt.includes("let's go") ||
                txt.includes('lets go') ||
                txt.includes('yes') ||
                txt.includes('sure') ||
                txt.includes('okay') ||
                txt.includes('ready')
              ) {
                startInterview();
              } else if (
                txt.includes('login') ||
                txt.includes('sign in') ||
                txt.includes('signin') ||
                txt.includes('account') ||
                txt.includes('dashboard')
              ) {
                if (vapiRef.current) {
                  try { vapiRef.current.stop(); } catch (_) {}
                }
                navigate('/login');
              }
            }
          }
        });

        vapi.on('error', (err) => {
          console.warn('[Landing Vapi] notice:', err);
        });

        // Start Vapi greeting for Home Screen
        await vapi.start(VAPI_ASSISTANT_ID, {
          firstMessage: "Hi! I am Helix, your AI voice business consultant. Whenever you are ready, just say start or click start to begin your project interview."
        });


      } catch (err) {
        console.warn('[Landing Vapi] init notice:', err);
      }
    }

    initLandingVoice();

    return () => {
      mounted.current = false;
      if (vapiRef.current) {
        try { vapiRef.current.stop(); } catch (_) {}
        vapiRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    if (!vapiRef.current) return;
    const nextMuted = !isMuted;
    try {
      vapiRef.current.setMuted(nextMuted);
      setIsMuted(nextMuted);
    } catch (_) {}
  };

  const isWaveActive = isSpeaking || isListening;

  return (
    <div className="min-h-screen bg-[#EEF1F8] pt-[67px] flex flex-col items-center justify-center relative overflow-hidden">

      {/* Speaker Mute Control */}
      <button
        onClick={toggleMute}
        className="absolute top-24 right-6 z-50 p-3 bg-white border border-gray-200 rounded-full shadow-sm hover:shadow-md transition-all flex items-center justify-center text-gray-600 hover:text-indigo-600 focus:outline-none"
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        title={isMuted ? "Muted" : "Listening"}
      >
        {isMuted ? <VolumeX className="w-5 h-5 text-gray-400" /> : <Volume2 className="w-5 h-5" />}
      </button>

      {/* CSS-based Custom Waveform Styling */}
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
            Vapi Voice Assistant Helix
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

        {/* Live Heard Bubble if user speaks on home */}
        {liveTranscript && (
          <div className="mb-6 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-full text-xs font-semibold text-indigo-700 animate-in fade-in">
            Heard: &quot;{liveTranscript}&quot;
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          {/* Start voice interview (dark button) */}
          <button
            onClick={startInterview}
            className="flex items-center justify-center gap-2 bg-[#1E293B] hover:bg-[#0f172a] text-white font-semibold text-sm px-8 py-3.5 rounded-full shadow-lg shadow-slate-200 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto cursor-pointer"
          >
            <Mic className="w-4 h-4 text-white" />
            <span>Start voice interview</span>
          </button>

          {/* See Tutorial (white button) */}
          <button
            onClick={() => setShowTutorial(true)}
            className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-[#1E293B] font-semibold text-sm px-8 py-3.5 rounded-full border border-slate-200 shadow-md transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto"
          >
            <Play className="w-4 h-4 text-[#1E293B]" />
            <span>See Tutorial</span>
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
                  <h4 className="font-semibold text-sm text-[#1E293B] mb-1">Vapi Voice Consultation</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Say &quot;start&quot; to begin. Helix asks for your Name, Mobile Number, and guides you through your business idea.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700 flex-shrink-0">
                  2
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-[#1E293B] mb-1">Live Database Storage</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Every answer is recorded and saved in real-time, with an on-screen feed for you to verify.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700 flex-shrink-0">
                  3
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-[#1E293B] mb-1">Instant Specification & Sign In</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Once finished, sign in or enter OTP to claim and download your complete technical document.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowTutorial(false);
                startInterview();
              }}
              className="w-full py-3 bg-[#1E293B] hover:bg-[#0f172a] text-white rounded-2xl font-semibold text-sm transition-all"
            >
              Start Voice Consultation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
