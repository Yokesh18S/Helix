import React from 'react';

interface PasswordStrengthProps {
  password?: string;
}

export default function PasswordStrength({ password = '' }: PasswordStrengthProps) {
  if (!password) return null;

  const getStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (pass.length < 6) return { label: 'Too Short', color: 'bg-red-500', width: 'w-1/5', textColor: 'text-red-500' };
    if (score <= 2) return { label: 'Weak', color: 'bg-orange-500', width: 'w-2/5', textColor: 'text-orange-500' };
    if (score <= 4) return { label: 'Medium', color: 'bg-amber-500', width: 'w-3/5', textColor: 'text-amber-500' };
    return { label: 'Strong', color: 'bg-emerald-500', width: 'w-full', textColor: 'text-emerald-500' };
  };

  const strength = getStrength(password);

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-slate-500">Password Strength:</span>
        <span className={strength.textColor}>{strength.label}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${strength.color} ${strength.width} transition-all duration-500 rounded-full`} />
      </div>
    </div>
  );
}
