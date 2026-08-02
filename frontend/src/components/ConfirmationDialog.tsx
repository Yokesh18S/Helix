import React from 'react';
import { Check, RotateCcw, Edit2, Keyboard } from 'lucide-react';

interface ConfirmationDialogProps {
  onConfirm: (yes: boolean) => void;
  onEdit: () => void;
  onSwitchToKeyboard: () => void;
  ariaLabel?: string;
  yesLabel?: string;
  noLabel?: string;
}

export default function ConfirmationDialog({
  onConfirm,
  onEdit,
  onSwitchToKeyboard,
  ariaLabel = 'Confirmation actions',
  yesLabel = 'Yes',
  noLabel = 'Try Again'
}: ConfirmationDialogProps) {
  return (
    <div 
      className="flex flex-wrap items-center justify-center gap-2.5 mt-4 p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/20 rounded-2xl"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => onConfirm(true)}
        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-full text-xs font-semibold hover:bg-indigo-700 hover:shadow-md transition-all duration-200"
      >
        <Check className="w-3.5 h-3.5" />
        {yesLabel}
      </button>

      <button
        type="button"
        onClick={() => onConfirm(false)}
        className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-full text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {noLabel}
      </button>

      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-full text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
      >
        <Edit2 className="w-3.5 h-3.5" />
        Edit
      </button>

      <button
        type="button"
        onClick={onSwitchToKeyboard}
        className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200"
      >
        <Keyboard className="w-3.5 h-3.5" />
        Keyboard
      </button>
    </div>
  );
}
