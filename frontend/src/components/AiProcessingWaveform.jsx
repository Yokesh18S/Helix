import React, { useState, useEffect } from 'react';

const STATUS_MESSAGES = [
  'Understanding your response...',
  'Analyzing your requirements...',
  'Identifying key details...',
  'Preparing the next question...',
];

export default function AiProcessingWaveform({ procStep }) {
  const [messageIndex, setMessageIndex] = useState(0);

  // Status message rotation loop sequentially every 2.8 seconds
  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 2800);

    return () => clearInterval(messageInterval);
  }, []);

  const currentStatusText =
    procStep === 'done'
      ? 'Analysis complete'
      : STATUS_MESSAGES[messageIndex];

  return (
    <div className="w-full max-w-sm mx-auto mb-6 transition-all duration-300 ease-in-out animate-fadeIn">
      <style>{`
        @keyframes orbit {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes pulse-subtle {
          0%, 100% {
            transform: scale(1);
            opacity: 0.9;
            box-shadow: 0 0 8px rgba(59, 130, 246, 0.3);
          }
          50% {
            transform: scale(1.08);
            opacity: 1;
            box-shadow: 0 0 14px rgba(139, 92, 246, 0.5);
          }
        }

        .animate-orbit {
          animation: orbit 2.2s linear infinite;
        }

        .animate-pulse-subtle {
          animation: pulse-subtle 2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .animate-orbit {
            animation: none;
          }
          .animate-pulse-subtle {
            animation: none;
          }
        }
      `}</style>
      
      <div className="bg-white rounded-2xl border border-[#DCE5EF] p-4 sm:p-5 shadow-sm shadow-[#DCE5EF]/20 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Subtle background gradient to match Helix style */}
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-50/10 via-white to-purple-50/10 pointer-events-none" />

        {/* Center AI/Helix-style Orbiting Indicator */}
        <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center mb-3 sm:mb-4">
          {/* Subtle glow layer behind */}
          <div className="absolute w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-blue-500/10 blur-sm pointer-events-none z-0" />
          
          {/* Central circular gradient indicator */}
          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-600 animate-pulse-subtle z-10 relative" />
          
          {/* Orbiting dot */}
          <div className="absolute inset-0 animate-orbit z-20">
            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-indigo-600 absolute top-0 left-1/2 -translate-x-1/2" />
          </div>
        </div>

        {/* Status Text (center aligned) */}
        <div className="min-h-[1.25rem] sm:min-h-[1.5rem] flex items-center justify-center relative z-10">
          <p className="text-xs sm:text-sm font-medium text-slate-700 tracking-wide text-center">
            {currentStatusText}
          </p>
        </div>

        {/* Optional Secondary small muted text */}
        <div className="mt-1 relative z-10">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold text-slate-400">
            Helix is thinking
          </p>
        </div>
      </div>
    </div>
  );
}
