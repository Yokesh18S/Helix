import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Send, Check, RotateCcw, Eye, EyeOff } from 'lucide-react';

interface AiControlBarProps {
  state: 'IDLE' | 'GREETING' | 'PROMPTING' | 'LISTENING' | 'PROCESSING' | 'CONFIRMING' | 'AUTHENTICATING' | 'SUCCESS' | 'ERROR';
  isListening: boolean;
  isSpeaking: boolean;
  liveTranscript: string;
  aiResponse: string;
  pttEnabled: boolean;
  setPttEnabled: (enabled: boolean) => void;
  onConfirm: (yes: boolean) => void;
  startListening: () => void;
  stopListening: () => void;
  currentStep: string;
  pendingValue: string;
  mode: 'voice' | 'keyboard';
  setMode: (mode: 'voice' | 'keyboard') => void;
  onSendText?: (text: string) => void;
}

export default function AiControlBar({
  state,
  isListening,
  isSpeaking,
  liveTranscript,
  aiResponse,
  pttEnabled,
  setPttEnabled,
  onConfirm,
  startListening,
  stopListening,
  currentStep,
  pendingValue,
  mode,
  setMode,
  onSendText
}: AiControlBarProps) {
  const [inputText, setInputText] = useState('');
  const [showVoicePassword, setShowVoicePassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPasswordStep = currentStep === 'password' || currentStep === 'confirm_password';

  const getDisplayInputText = () => {
    if (mode === 'voice' && isPasswordStep && !showVoicePassword) {
      return '•'.repeat(inputText.length);
    }
    return inputText;
  };

  useEffect(() => {
    if (mode === 'voice') setInputText(liveTranscript);
  }, [liveTranscript, mode]);

  const handleMicClick = () => setMode(mode === 'voice' ? 'keyboard' : 'voice');

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || mode !== 'keyboard' || !onSendText) return;
    onSendText(inputText.trim());
    setInputText('');
  };

  const isConfirming = state === 'CONFIRMING';

  /* ── Shared macOS button base ──────────────────────────────────────────── */
  const circleBtn = 'w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200 flex-shrink-0';

  return (
    <div className="mt-5 pt-5 space-y-3"
         style={{ borderTop: '1px solid rgba(209,209,214,0.6)' }}>

      {/* ── Helix Bot response bubble ───────────────────────────────────── */}
      {aiResponse && (
        <div className="rounded-2xl px-4 py-3 text-[13px] font-medium text-[#1d1d1f] animate-fade-in"
             style={{
               background: 'rgba(255,255,255,0.85)',
               border: '1px solid rgba(209,209,214,0.7)',
               boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
             }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-[#6366f1] animate-pulse' : 'bg-[#aeaeb2]'}`} />
            <span className="text-[10px] font-bold text-[#6366f1] uppercase tracking-widest">Helix AI</span>
          </div>
          <p className="leading-relaxed">{aiResponse}</p>
        </div>
      )}

      {/* ── Confirmation action buttons ─────────────────────────────────── */}
      {isConfirming && (
        <div className="flex gap-2 justify-center py-1 animate-fade-in">
          <button type="button" onClick={() => onConfirm(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold text-white shadow-sm transition-all duration-200 hover:brightness-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            <Check className="w-3.5 h-3.5" />
            {pendingValue === '__KEEP_OR_REPLACE__' ? 'Keep Edited' : 'Yes, correct'}
          </button>
          <button type="button" onClick={() => onConfirm(false)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold text-[#3c3c43] transition-all duration-200 hover:bg-[#f2f2f7] active:scale-95"
            style={{ background: 'rgba(242,242,247,0.9)', border: '1px solid rgba(209,209,214,0.8)' }}>
            <RotateCcw className="w-3.5 h-3.5" />
            {pendingValue === '__KEEP_OR_REPLACE__' ? 'Replace with Voice' : 'Try again'}
          </button>
        </div>
      )}

      {/* ── Control bar row ─────────────────────────────────────────────── */}
      <form onSubmit={handleSend} className="flex items-center gap-2">

        {/* Mic / Keyboard toggle */}
        <button type="button" onClick={handleMicClick}
          className={circleBtn}
          style={mode === 'voice'
            ? { background: 'linear-gradient(135deg,#ef4444,#f97316)', border: 'none', boxShadow: '0 2px 12px rgba(239,68,68,0.35)', color: '#fff' }
            : { background: 'rgba(242,242,247,0.9)', border: '1px solid rgba(209,209,214,0.8)', color: '#6e6e73' }}
          title={mode === 'voice' ? 'Switch to Keyboard' : 'Switch to Voice'}>
          {mode === 'voice'
            ? <Mic className="w-4.5 h-4.5 animate-pulse" style={{ width: 18, height: 18 }} />
            : <MicOff style={{ width: 18, height: 18 }} />}
        </button>

        {/* Speaker / auto-listen toggle */}
        <button type="button" onClick={() => setPttEnabled(!pttEnabled)}
          className={circleBtn}
          style={pttEnabled
            ? { background: 'linear-gradient(135deg,#f59e0b,#f97316)', border: 'none', boxShadow: '0 2px 8px rgba(245,158,11,0.3)', color: '#fff' }
            : { background: 'rgba(242,242,247,0.9)', border: '1px solid rgba(209,209,214,0.8)', color: '#6e6e73' }}
          title={pttEnabled ? 'Auto-listen muted' : 'Auto-listen active'}>
          {pttEnabled
            ? <VolumeX style={{ width: 17, height: 17 }} />
            : <Volume2 style={{ width: 17, height: 17, color: '#6366f1' }} />}
        </button>

        {/* Transcript / type input */}
        <div className="flex-1 relative">
          <input ref={inputRef} type="text"
            value={getDisplayInputText()}
            onChange={e => setInputText(e.target.value)}
            disabled={mode === 'voice'}
            placeholder={
              mode === 'voice'
                ? isListening ? 'Listening… speak now' : 'Speak now…'
                : 'Type your message…'
            }
            className="w-full pl-3.5 py-2.5 text-[13px] font-medium text-[#1d1d1f] placeholder-[#aeaeb2] rounded-full focus:outline-none transition-all duration-200 disabled:cursor-default"
            style={{
              background: 'rgba(255,255,255,0.88)',
              border: '1px solid rgba(209,209,214,0.8)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              paddingRight: isPasswordStep && mode === 'voice' ? '2.5rem' : '1rem',
            }}
          />
          {/* Eye toggle – password fields only in voice mode */}
          {isPasswordStep && mode === 'voice' && (
            <button type="button" tabIndex={-1}
              onClick={() => setShowVoicePassword(!showVoicePassword)}
              className="absolute inset-y-0 right-3 flex items-center transition-colors"
              style={{ color: '#aeaeb2' }}
              title={showVoicePassword ? 'Hide' : 'Show'}>
              {showVoicePassword
                ? <EyeOff style={{ width: 14, height: 14 }} />
                : <Eye style={{ width: 14, height: 14 }} />}
            </button>
          )}
        </div>

        {/* Send button */}
        <button type="submit"
          disabled={!inputText.trim() || mode === 'voice'}
          className={circleBtn + ' transition-all active:scale-95'}
          style={!inputText.trim() || mode === 'voice'
            ? { background: 'rgba(242,242,247,0.9)', border: '1px solid rgba(209,209,214,0.6)', color: '#aeaeb2', cursor: 'default' }
            : { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', boxShadow: '0 2px 10px rgba(99,102,241,0.35)' }}
          title="Send">
          <Send style={{ width: 16, height: 16, transform: 'rotate(45deg) translateX(-1px) translateY(1px)' }} />
        </button>
      </form>
    </div>
  );
}
