/**
 * Splash.jsx — Helix Introduction / Entry Screen
 *
 * The user lands here first. A large animated Helix avatar is shown with
 * introduction text. Clicking the avatar:
 *   1. Triggers "Welcome to Helix" voice greeting (satisfies autoplay policy)
 *   2. After the greeting ends, navigates to the Landing / Home page
 *
 * No TTS fires automatically on load — everything is gated by the click.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const FEATURES = [
  { icon: '🎙️', label: 'Voice-first interview' },
  { icon: '🤖', label: 'AI requirements extraction' },
  { icon: '📄', label: 'Instant specification docs' },
];

export default function Splash() {
  const navigate = useNavigate();
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null);
  const voicesRef = useRef([]);
  const [clicked, setClicked] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [pulseActive, setPulseActive] = useState(false);

  // Load TTS voices
  useEffect(() => {
    if (!synthRef.current) return;
    const load = () => {
      const v = synthRef.current.getVoices();
      if (v.length > 0) voicesRef.current = v;
    };
    load();
    synthRef.current.onvoiceschanged = load;
    return () => { if (synthRef.current) synthRef.current.onvoiceschanged = null; };
  }, []);

  const handleAvatarClick = useCallback(() => {
    if (clicked) return;
    setClicked(true);
    setPulseActive(true);

    if (!synthRef.current) {
      setTimeout(() => navigate('/home'), 800);
      return;
    }

    // Cancel any pending speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(
      'Welcome to Helix! Your AI-powered requirements assistant. Let\'s build something great together.'
    );

    // Voice selection
    const voices = voicesRef.current.length > 0 ? voicesRef.current : synthRef.current.getVoices();
    const voice =
      voices.find(v => v.name.toLowerCase().includes('samantha')) ||
      voices.find(v => v.name.toLowerCase().includes('victoria')) ||
      voices.find(v => v.name.toLowerCase().includes('karen')) ||
      voices.find(v => v.name.toLowerCase().includes('google uk english female')) ||
      voices.find(v => v.lang === 'en-US') ||
      voices[0];
    if (voice) utterance.voice = voice;
    utterance.rate = 0.92;
    utterance.pitch = 1.1;
    utterance.volume = 1;

    utterance.onend = () => {
      setNavigating(true);
      setTimeout(() => navigate('/home'), 400);
    };
    utterance.onerror = () => {
      setNavigating(true);
      setTimeout(() => navigate('/home'), 400);
    };

    synthRef.current.speak(utterance);
  }, [clicked, navigate]);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at 50% 0%, #1a0533 0%, #0d0020 60%, #000010 100%)',
      }}
    >
      {/* Animated star-field background */}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }
        @keyframes orbit {
          from { transform: rotate(0deg) translateX(140px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(140px) rotate(-360deg); }
        }
        @keyframes orbit2 {
          from { transform: rotate(120deg) translateX(180px) rotate(-120deg); }
          to   { transform: rotate(480deg) translateX(180px) rotate(-480deg); }
        }
        @keyframes orbit3 {
          from { transform: rotate(240deg) translateX(220px) rotate(-240deg); }
          to   { transform: rotate(600deg) translateX(220px) rotate(-600deg); }
        }
        @keyframes avatar-glow {
          0%, 100% { box-shadow: 0 0 60px 20px rgba(139,92,246,0.35), 0 0 120px 40px rgba(99,102,241,0.2); }
          50% { box-shadow: 0 0 80px 30px rgba(168,85,247,0.55), 0 0 160px 60px rgba(139,92,246,0.3); }
        }
        @keyframes avatar-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
        @keyframes ring-expand {
          0% { transform: scale(0.9); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes float-up {
          0% { opacity: 0; transform: translateY(24px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        .star { animation: twinkle var(--dur, 3s) ease-in-out infinite; animation-delay: var(--delay, 0s); }
        .orb1 { animation: orbit 8s linear infinite; }
        .orb2 { animation: orbit2 12s linear infinite; }
        .orb3 { animation: orbit3 16s linear infinite; }
        .avatar-glow { animation: avatar-glow 3s ease-in-out infinite; }
        .avatar-float { animation: avatar-pulse 4s ease-in-out infinite; }
        .ring-anim { animation: ring-expand 2s ease-out infinite; }
        .ring-anim-2 { animation: ring-expand 2s ease-out infinite; animation-delay: 0.7s; }
        .ring-anim-3 { animation: ring-expand 2s ease-out infinite; animation-delay: 1.4s; }
        .float-in { animation: float-up 0.8s ease forwards; }
        .shimmer-text {
          background: linear-gradient(90deg, #c4b5fd, #a78bfa, #818cf8, #a78bfa, #c4b5fd);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        .dot-1 { animation: dot-bounce 1.4s ease-in-out infinite; }
        .dot-2 { animation: dot-bounce 1.4s ease-in-out infinite; animation-delay: 0.2s; }
        .dot-3 { animation: dot-bounce 1.4s ease-in-out infinite; animation-delay: 0.4s; }
      `}</style>

      {/* Stars */}
      {[...Array(60)].map((_, i) => (
        <div
          key={i}
          className="star absolute rounded-full bg-white"
          style={{
            width: Math.random() * 2.5 + 0.5 + 'px',
            height: Math.random() * 2.5 + 0.5 + 'px',
            left: Math.random() * 100 + '%',
            top: Math.random() * 100 + '%',
            '--dur': (2 + Math.random() * 4) + 's',
            '--delay': (Math.random() * 4) + 's',
          }}
        />
      ))}

      {/* Orbiting particles */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <div className="orb1 w-3 h-3 rounded-full bg-violet-400/70" />
        <div className="orb2 w-2 h-2 rounded-full bg-indigo-400/60" />
        <div className="orb3 w-2.5 h-2.5 rounded-full bg-purple-300/50" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-lg">

        {/* Badge */}
        <div
          className="float-in mb-8 px-4 py-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 backdrop-blur-sm"
          style={{ animationDelay: '0.1s' }}
        >
          <span className="text-[11px] font-semibold text-violet-300 uppercase tracking-[0.15em]">
            ✦ AI Voice Requirements Assistant
          </span>
        </div>

        {/* Avatar */}
        <div
          className="relative mb-10 cursor-pointer select-none"
          onClick={handleAvatarClick}
          title="Click to enter Helix"
        >
          {/* Expanding rings (shown on click) */}
          {clicked && (
            <>
              <div className="ring-anim absolute inset-0 rounded-full border-2 border-violet-400/60" />
              <div className="ring-anim-2 absolute inset-0 rounded-full border-2 border-purple-400/40" />
              <div className="ring-anim-3 absolute inset-0 rounded-full border-2 border-indigo-400/30" />
            </>
          )}

          {/* Permanent subtle rings */}
          <div className="absolute inset-[-20px] rounded-full border border-violet-500/20" />
          <div className="absolute inset-[-40px] rounded-full border border-violet-500/10" />

          {/* Avatar wrapper */}
          <div
            className="avatar-glow avatar-float relative w-48 h-48 md:w-56 md:h-56 rounded-full overflow-hidden"
            style={{ transition: 'transform 0.2s' }}
          >
            {/* Gradient ring border */}
            <div className="absolute inset-0 rounded-full p-[3px] bg-gradient-to-tr from-violet-500 via-purple-400 to-indigo-500">
              <div className="w-full h-full rounded-full overflow-hidden bg-[#0d0020]">
                <img
                  src="/helix_avatar.png"
                  alt="Helix AI Avatar"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement.classList.add('helix-fallback');
                  }}
                />
                {/* Fallback SVG avatar when no image */}
                <div className="helix-fallback-content w-full h-full items-center justify-center hidden bg-gradient-to-br from-violet-900 via-purple-800 to-indigo-900">
                  <svg viewBox="0 0 100 100" className="w-24 h-24 text-violet-200">
                    <circle cx="50" cy="35" r="18" fill="currentColor" opacity="0.9"/>
                    <ellipse cx="50" cy="78" rx="28" ry="18" fill="currentColor" opacity="0.7"/>
                    <circle cx="43" cy="33" r="4" fill="#1a0533"/>
                    <circle cx="57" cy="33" r="4" fill="#1a0533"/>
                    <path d="M43 42 Q50 46 57 42" stroke="#1a0533" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Overlay shimmer on hover */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/0 via-white/0 to-violet-500/10 pointer-events-none" />
          </div>

          {/* Click hint */}
          {!clicked && (
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span className="text-[11px] text-violet-400/70 font-medium tracking-wide animate-pulse">
                tap to begin
              </span>
            </div>
          )}
        </div>

        {/* Heading */}
        <h1
          className="float-in text-5xl md:text-6xl font-black tracking-tight mb-3"
          style={{ animationDelay: '0.2s' }}
        >
          <span className="shimmer-text">Helix</span>
        </h1>

        <p
          className="float-in text-lg md:text-xl text-slate-300 font-light mb-2 tracking-wide"
          style={{ animationDelay: '0.35s' }}
        >
          Your AI Voice Consultant
        </p>

        <p
          className="float-in text-sm text-slate-500 max-w-xs leading-relaxed mb-10"
          style={{ animationDelay: '0.5s' }}
        >
          Speak your idea. Helix listens, understands, and turns your vision into a
          professional software requirements document — instantly.
        </p>

        {/* Feature pills */}
        <div
          className="float-in flex flex-wrap items-center justify-center gap-3 mb-12"
          style={{ animationDelay: '0.65s' }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-slate-300"
            >
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        {!clicked ? (
          <button
            onClick={handleAvatarClick}
            className="float-in relative group px-10 py-4 rounded-full font-semibold text-base text-white overflow-hidden transition-transform hover:scale-105 active:scale-95 shadow-2xl shadow-violet-900/60"
            style={{
              animationDelay: '0.8s',
              background: 'linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #8b5cf6 100%)',
            }}
          >
            <span className="relative z-10 flex items-center gap-2">
              <span className="text-lg">✦</span>
              Enter Helix
            </span>
            {/* Shine effect */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 translate-x-[-100%] group-hover:translate-x-[200%] duration-700" />
          </button>
        ) : navigating ? (
          <div className="flex items-center gap-3 text-violet-300">
            <span className="text-sm font-medium">Entering Helix</span>
            <div className="flex gap-1">
              <div className="dot-1 w-1.5 h-1.5 rounded-full bg-violet-400" />
              <div className="dot-2 w-1.5 h-1.5 rounded-full bg-violet-400" />
              <div className="dot-3 w-1.5 h-1.5 rounded-full bg-violet-400" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-violet-300">
            <div className="w-5 h-5 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin" />
            <span className="text-sm font-medium">Helix is greeting you...</span>
          </div>
        )}
      </div>

      {/* Bottom subtle text */}
      <p className="absolute bottom-6 text-xs text-slate-700">
        Powered by Gemini AI · Voice Interview Technology
      </p>
    </div>
  );
}
