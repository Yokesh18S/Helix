import React from 'react';

interface MicVisualizerProps {
  state: 'IDLE' | 'GREETING' | 'PROMPTING' | 'LISTENING' | 'PROCESSING' | 'CONFIRMING' | 'AUTHENTICATING' | 'SUCCESS' | 'ERROR';
  isListening: boolean;
  isSpeaking: boolean;
}

export default function MicVisualizer({ state, isListening, isSpeaking }: MicVisualizerProps) {
  // Determine color scheme based on state
  let primaryColor = 'from-indigo-500 to-purple-600';
  let pulseGlow = 'rgba(99, 102, 241, 0.4)';

  if (state === 'ERROR') {
    primaryColor = 'from-rose-500 to-red-600';
    pulseGlow = 'rgba(239, 68, 68, 0.4)';
  } else if (state === 'SUCCESS') {
    primaryColor = 'from-emerald-500 to-teal-600';
    pulseGlow = 'rgba(16, 185, 129, 0.4)';
  } else if (isListening) {
    primaryColor = 'from-indigo-500 via-purple-500 to-pink-500';
    pulseGlow = 'rgba(139, 92, 246, 0.5)';
  } else if (isSpeaking) {
    primaryColor = 'from-blue-400 via-indigo-500 to-purple-500';
    pulseGlow = 'rgba(59, 130, 246, 0.4)';
  } else if (state === 'PROCESSING' || state === 'AUTHENTICATING') {
    primaryColor = 'from-purple-500 via-violet-600 to-indigo-600';
    pulseGlow = 'rgba(109, 40, 217, 0.4)';
  }

  const isBouncing = isListening || isSpeaking || state === 'PROCESSING' || state === 'AUTHENTICATING';

  return (
    <div className="flex flex-col items-center justify-center my-6">
      {/* Outer Mic Button Circle */}
      <div 
        className={`relative w-24 h-24 rounded-full flex items-center justify-center bg-gradient-to-br ${primaryColor} text-white shadow-xl transition-all duration-500`}
        style={{
          boxShadow: isBouncing 
            ? `0 0 35px ${pulseGlow}, inset 0 2px 4px rgba(255, 255, 255, 0.2)`
            : '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
        }}
      >
        {/* Glow Pulses */}
        {isListening && (
          <>
            <div className="absolute inset-0 rounded-full bg-indigo-500/30 animate-ping" />
            <div className="absolute -inset-2 rounded-full border border-indigo-400/20 voice-pulse" />
          </>
        )}

        {/* Dynamic Wave Icon */}
        <div className="flex items-center gap-1.5 justify-center h-10 w-16">
          {isBouncing ? (
            // Waveform simulation
            [...Array(5)].map((_, i) => {
              const delay = [0, 0.15, 0.3, 0.15, 0][i];
              const height = isListening ? 'h-8' : isSpeaking ? 'h-6' : 'h-4';
              return (
                <div
                  key={i}
                  className={`w-1 rounded-full bg-white transition-all duration-300 ${
                    state === 'PROCESSING' || state === 'AUTHENTICATING'
                      ? 'animate-pulse' 
                      : 'speaking-wave'
                  }`}
                  style={{
                    animationDelay: `${delay}s`,
                    height: isListening ? '24px' : '16px',
                    opacity: 0.8 + i * 0.05
                  }}
                />
              );
            })
          ) : (
            // Simple mic icon representation using divs
            <div className="flex flex-col items-center">
              <div className="w-4 h-6 border-2 border-white rounded-full relative flex items-center justify-center">
                <div className="w-1.5 h-3 bg-white rounded-full" />
              </div>
              <div className="w-6 h-2 border-b-2 border-x-2 border-white rounded-b-full -mt-1" />
              <div className="w-0.5 h-1.5 bg-white" />
            </div>
          )}
        </div>
      </div>

      {/* State label */}
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 mt-4 animate-pulse">
        {state === 'GREETING' && 'Greeting'}
        {state === 'PROMPTING' && 'Speaking'}
        {state === 'LISTENING' && 'Listening'}
        {state === 'PROCESSING' && 'Thinking'}
        {state === 'CONFIRMING' && 'Confirming'}
        {state === 'AUTHENTICATING' && 'Authenticating'}
        {state === 'SUCCESS' && 'Success'}
        {state === 'ERROR' && 'Error'}
        {state === 'IDLE' && 'Idle'}
      </span>
    </div>
  );
}
