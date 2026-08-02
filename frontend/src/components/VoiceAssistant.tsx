import React from 'react';
import MicVisualizer from './MicVisualizer';
import ConfirmationDialog from './ConfirmationDialog';
import { Volume2, VolumeX, HelpCircle, CornerDownLeft } from 'lucide-react';

interface VoiceAssistantProps {
  state: 'IDLE' | 'GREETING' | 'PROMPTING' | 'LISTENING' | 'PROCESSING' | 'CONFIRMING' | 'AUTHENTICATING' | 'SUCCESS' | 'ERROR';
  isListening: boolean;
  isSpeaking: boolean;
  liveTranscript: string;
  aiResponse: string;
  confidence: number;
  pttEnabled: boolean;
  setPttEnabled: (enabled: boolean) => void;
  onConfirm: (yes: boolean) => void;
  onEdit: () => void;
  onSwitchToKeyboard: () => void;
  startListening: () => void;
  stopListening: () => void;
  currentStep: string;
  pendingValue?: string;
}

export default function VoiceAssistant({
  state,
  isListening,
  isSpeaking,
  liveTranscript,
  aiResponse,
  confidence,
  pttEnabled,
  setPttEnabled,
  onConfirm,
  onEdit,
  onSwitchToKeyboard,
  startListening,
  stopListening,
  currentStep,
  pendingValue = ''
}: VoiceAssistantProps) {
  // Determine clean labels for steps
  const getStepLabel = (step: string) => {
    switch (step) {
      case 'full_name':        return 'Full Name';
      case 'email':            return 'Email Address';
      case 'confirm_email':   return 'Confirm Email';
      case 'company':          return 'Company Name';
      case 'phone':            return 'Phone Number';
      case 'password':         return 'Password';
      case 'confirm_password': return 'Password Confirmation';
      default: return step;
    }
  };

  const isPasswordStep  = currentStep === 'password' || currentStep === 'confirm_password';
  const isConfirming    = state === 'CONFIRMING';

  return (
    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden transition-all duration-300">
      
      {/* Background Gradient Orbs for Visual Richness */}
      <div className="absolute -top-16 -right-16 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header Info */}
      <div className="flex items-center justify-between mb-4 border-b border-slate-200/40 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tracking-wide uppercase">
            Insighta Assistant
          </span>
        </div>
        
        {/* PTT Toggle */}
        <button
          type="button"
          onClick={() => setPttEnabled(!pttEnabled)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all duration-300 ${
            pttEnabled
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200/50'
              : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 border border-indigo-100/50'
          }`}
          aria-label={pttEnabled ? 'Disable Push to Talk' : 'Enable Push to Talk'}
        >
          {pttEnabled ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          {pttEnabled ? 'Push to Talk' : 'Auto Listen'}
        </button>
      </div>

      {/* Speech Visualizer */}
      <MicVisualizer state={state} isListening={isListening} isSpeaking={isSpeaking} />

      {/* AI Prompter Voice captions */}
      <div className="bg-white dark:bg-slate-950 rounded-2xl p-4 min-h-[90px] border border-slate-200/30 dark:border-slate-800/40 shadow-sm flex flex-col justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            AI Assistant
          </span>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 mt-1 leading-relaxed">
            {aiResponse || 'Initializing voice session...'}
          </p>
        </div>
      </div>

      {/* User Transcript Caption Box */}
      <div className={`rounded-2xl p-4 min-h-[80px] mt-4 border flex flex-col justify-between transition-all duration-300 ${
        isConfirming
          ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/40 dark:border-amber-800/30'
          : 'bg-slate-100/70 dark:bg-slate-950/40 border-slate-200/20 dark:border-slate-800/20'
      }`}>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {isConfirming ? 'Awaiting Confirmation' : `Your Input (${getStepLabel(currentStep)})`}
            </span>
            {isListening && confidence > 0 && !isConfirming && (
              <span className="text-[10px] font-semibold text-indigo-500">
                Confidence: {Math.round(confidence * 100)}%
              </span>
            )}
          </div>

          {isConfirming ? (
            // When waiting for yes/no — show a clear prompt, NOT the raw transcript
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
              {pendingValue === '__KEEP_OR_REPLACE__' ? (
                isListening
                  ? '🎤 Listening… say "keep" to keep or "replace" to overwrite'
                  : '⏳ Say "keep" to keep or "replace" to overwrite'
              ) : (
                isListening
                  ? '🎤 Listening… say "yes" to confirm or "no" to retry'
                  : '⏳ Say "yes" to confirm or "no" to try again'
              )}
            </p>
          ) : (
            <p className="text-sm font-semibold text-indigo-950 dark:text-indigo-200 mt-1 leading-relaxed italic">
              {isListening && !liveTranscript && (
                <span className="text-slate-400 not-italic font-normal">Listening…</span>
              )}
              {!isListening && !liveTranscript && (
                <span className="text-slate-400 not-italic font-normal">Waiting…</span>
              )}
              {liveTranscript && (isPasswordStep ? '••••••••' : liveTranscript)}
            </p>
          )}
        </div>

        {/* Confirmation buttons (shown in CONFIRMING state) */}
        {isConfirming && (
          <ConfirmationDialog
            onConfirm={onConfirm}
            onEdit={onEdit}
            onSwitchToKeyboard={onSwitchToKeyboard}
            yesLabel={pendingValue === '__KEEP_OR_REPLACE__' ? 'Keep Edited' : 'Yes'}
            noLabel={pendingValue === '__KEEP_OR_REPLACE__' ? 'Replace with Voice' : 'Try Again'}
          />
        )}
      </div>

      {/* Push to talk activation button */}
      {pttEnabled && (
        <div className="flex justify-center mt-5">
          <button
            type="button"
            onMouseDown={startListening}
            onMouseUp={stopListening}
            onTouchStart={startListening}
            onTouchEnd={stopListening}
            className={`w-full max-w-xs py-3 rounded-full text-xs font-bold uppercase tracking-widest text-white shadow-md hover:shadow-lg transition-all duration-300 ${
              isListening
                ? 'bg-red-500 ring-4 ring-red-500/20'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {isListening ? 'Release to Send' : 'Hold to Speak'}
          </button>
        </div>
      )}

      {/* Global Voice Commands Cheat Sheet */}
      <div className="mt-5 border-t border-slate-200/40 pt-4">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
              <HelpCircle className="w-3.5 h-3.5" />
              Global Voice Commands
            </span>
            <span className="transition-transform duration-300 group-open:rotate-180 text-xs">
              ▼
            </span>
          </summary>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100/40 dark:bg-slate-900/40 rounded-xl p-3 border border-slate-200/10">
            <div>🎤 "repeat"</div>
            <div>🎤 "next"</div>
            <div>🎤 "back"</div>
            <div>🎤 "clear"</div>
            <div>🎤 "skip" (optional fields)</div>
            <div>🎤 "cancel" (reset)</div>
            <div>🎤 "change email"</div>
            <div>🎤 "change phone"</div>
            <div>🎤 "stop listening"</div>
            <div>🎤 "use keyboard"</div>
          </div>
        </details>
      </div>

    </div>
  );
}
