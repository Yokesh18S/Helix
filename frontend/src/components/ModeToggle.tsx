import React from 'react';
import { Mic, Keyboard } from 'lucide-react';

interface ModeToggleProps {
  mode: 'voice' | 'keyboard';
  onChange: (mode: 'voice' | 'keyboard') => void;
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="flex justify-center mb-6">
      <div 
        className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200/50 shadow-inner"
        role="radiogroup"
        aria-label="Input mode selection"
      >
        <button
          type="button"
          onClick={() => onChange('voice')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-300 ${
            mode === 'voice'
              ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md ring-1 ring-black/5'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
          role="radio"
          aria-checked={mode === 'voice'}
        >
          <Mic className={`w-3.5 h-3.5 transition-transform duration-300 ${mode === 'voice' ? 'scale-110 text-indigo-500' : ''}`} />
          🎤 Voice Mode
        </button>

        <button
          type="button"
          onClick={() => onChange('keyboard')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-300 ${
            mode === 'keyboard'
              ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md ring-1 ring-black/5'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
          role="radio"
          aria-checked={mode === 'keyboard'}
        >
          <Keyboard className={`w-3.5 h-3.5 transition-transform duration-300 ${mode === 'keyboard' ? 'scale-110 text-indigo-500' : ''}`} />
          ⌨ Keyboard Mode
        </button>
      </div>
    </div>
  );
}
