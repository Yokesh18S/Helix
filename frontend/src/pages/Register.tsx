import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mic, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import AiControlBar from '../components/AiControlBar';
import PasswordStrength from '../components/PasswordStrength';
import { useAuthenticationVoice, AuthField } from '../hooks/useAuthenticationVoice';

export default function Register() {
  const [mode, setMode]                 = useState<'voice' | 'keyboard'>('voice');
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  const { register, claimGuestSession } = useAuth();
  const navigate     = useNavigate();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleVoiceCompleted = async (voiceData: any) => {
    setLoading(true);
    try {
      await register({
        full_name: voiceData.full_name,
        email:     `${voiceData.phone}@helix.com`, // dummy email since it is removed from UI
        phone:     voiceData.phone,
        password:  voiceData.password
      });
      toast.success('Account created! Welcome to Helix.');
      // ⚠️  Do NOT navigate here — voice hook speaks welcome, THEN calls onSuccess
    } catch (err: any) {
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // After voice flow completes successfully
  const handleVoiceSuccess = async () => {
    const claimedAppId = await claimGuestSession();
    if (claimedAppId) {
      toast.success('Interview saved to your account!');
      navigate(`/requirements/${claimedAppId}`);
    } else {
      navigate('/dashboard');
    }
  };

  const handleSwitchToKeyboard = () => setMode('keyboard');
  const handleNavigateToLogin = () => { toast('Taking you to sign in…'); navigate('/login'); };
  const handleNavigateToHome = () => { toast('Taking you to home page…'); navigate('/'); };

  const voiceAuth = useAuthenticationVoice({
    flow: 'signup',
    isActive: mode === 'voice',
    onCompleted: handleVoiceCompleted,
    onSuccess: handleVoiceSuccess,
    onSwitchToKeyboard: handleSwitchToKeyboard,
    onNavigateToLogin: handleNavigateToLogin,
    onNavigateToHome: handleNavigateToHome
  });

  useEffect(() => {
    if (mode === 'keyboard' && nameInputRef.current && !voiceAuth.formState.full_name.value) {
      nameInputRef.current.focus();
    }
  }, [mode, voiceAuth.formState.full_name.value]);

  const getFieldValue = (field: AuthField) => {
    if (mode === 'voice') {
      return voiceAuth.formState[field].value || (voiceAuth.currentStep === field ? voiceAuth.liveParsedValue : '');
    }
    return voiceAuth.formState[field].value;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    voiceAuth.updateField(e.target.name as AuthField, e.target.value, 'keyboard');
  };

  const handleSendText = (text: string) => {
    voiceAuth.updateField(voiceAuth.currentStep, text, 'keyboard');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwdVal          = voiceAuth.formState.password.value;
    const confirmPwdVal   = voiceAuth.formState.confirm_password.value;
    const phoneVal        = voiceAuth.formState.phone.value;

    if (!phoneVal || phoneVal.length !== 10) {
      toast.error('Phone number must be exactly 10 digits.');
      return;
    }
    if (pwdVal !== confirmPwdVal) {
      toast.error('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await register({
        full_name: voiceAuth.formState.full_name.value,
        email:     `${phoneVal}@helix.com`, // dummy email
        phone:     phoneVal,
        password:  pwdVal
      });
      toast.success('Account created! Welcome to Helix.');
      // Claim any pending guest session
      const claimedAppId = await claimGuestSession();
      if (claimedAppId) {
        toast.success('Interview saved to your account!');
        navigate(`/requirements/${claimedAppId}`);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || 'Registration failed.';
      if (status === 409 || (status === 400 && detail.toLowerCase().includes('already registered'))) {
        toast.error("Phone number is already registered. Redirecting to sign in...");
        setTimeout(() => {
          navigate('/login');
        }, 1500);
      } else {
        toast.error(detail);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ─── macOS-style base input class ─────────────────────────────────────── */
  const inputBase =
    'w-full px-4 py-2.5 rounded-xl text-sm font-medium text-[#1d1d1f] ' +
    'bg-white border border-[#d1d1d6] ' +
    'placeholder-[#aeaeb2] ' +
    'focus:outline-none focus:ring-2 focus:ring-[#6366f1]/40 focus:border-[#6366f1] ' +
    'transition-all duration-200 shadow-sm';

  const confirmPwdBorder =
    voiceAuth.formState.confirm_password.value && voiceAuth.formState.confirm_password.value !== voiceAuth.formState.password.value
      ? ' !border-rose-400 focus:!border-rose-400 focus:!ring-rose-300/40'
      : voiceAuth.formState.confirm_password.value && voiceAuth.formState.confirm_password.value === voiceAuth.formState.password.value
      ? ' !border-emerald-400 focus:!border-emerald-400 focus:!ring-emerald-300/40'
      : '';

  const Label = ({ children }: { children: React.ReactNode }) => (
    <label className="block text-[11px] font-semibold text-[#6e6e73] mb-1.5 uppercase tracking-widest">
      {children}
    </label>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-[80px] pb-12"
         style={{ background: 'linear-gradient(135deg, #dce8f8 0%, #ede9f6 50%, #f0f4ff 100%)' }}>

      <div className="w-full max-w-lg rounded-[28px] p-8 animate-fade-in"
           style={{
             background: 'rgba(255,255,255,0.72)',
             backdropFilter: 'blur(32px) saturate(180%)',
             WebkitBackdropFilter: 'blur(32px) saturate(180%)',
             border: '1px solid rgba(255,255,255,0.9)',
             boxShadow: '0 8px 40px rgba(100,116,246,0.12), 0 1.5px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
           }}>

        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
               style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
            <Mic className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-[17px] text-[#1d1d1f] tracking-tight">Helix</span>
        </div>

        <h2 className="text-[22px] font-bold text-center text-[#1d1d1f] mb-1 tracking-tight">Create account</h2>
        <p className="text-[13px] text-[#86868b] text-center mb-7 font-medium">Start your voice-first requirements journey</p>

        <form onSubmit={handleSubmit} className="space-y-3.5">

          {/* Full Name */}
          <div>
            <Label>Full Name</Label>
            <input id="full_name" type="text" name="full_name" ref={nameInputRef}
              value={getFieldValue('full_name')} onChange={handleChange}
              className={inputBase} placeholder="John Doe" required />
          </div>

          {/* Phone */}
          <div>
            <Label>Phone Number</Label>
            <input id="phone" type="tel" name="phone"
              value={getFieldValue('phone')} onChange={handleChange}
              className={inputBase}
              placeholder="9332567854"
              pattern="[0-9]{10}"
              minLength={10}
              maxLength={10}
              title="Enter a 10-digit phone number"
              required />
          </div>

          {/* Password */}
          <div>
            <Label>Password</Label>
            <div className="relative">
              <input id="password" type={showPassword ? 'text' : 'password'} name="password"
                value={getFieldValue('password')} onChange={handleChange}
                className={inputBase + ' pr-11'} placeholder="••••••••" required />
              <button type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)}
                className="absolute inset-y-0 right-3.5 flex items-center text-[#aeaeb2] hover:text-[#6366f1] transition-colors"
                aria-label={showPassword ? 'Hide' : 'Show'}>
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <PasswordStrength password={voiceAuth.formState.password.value} />
          </div>

          {/* Confirm Password */}
          <div>
            <Label>Confirm Password</Label>
            <div className="relative">
              <input id="confirm_password" type={showConfirmPwd ? 'text' : 'password'} name="confirm_password"
                value={getFieldValue('confirm_password')} onChange={handleChange}
                className={inputBase + ' pr-11' + confirmPwdBorder} placeholder="••••••••" required />
              <button type="button" tabIndex={-1} onClick={() => setShowConfirmPwd(v => !v)}
                className="absolute inset-y-0 right-3.5 flex items-center text-[#aeaeb2] hover:text-[#6366f1] transition-colors"
                aria-label={showConfirmPwd ? 'Hide' : 'Show'}>
                {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {voiceAuth.formState.confirm_password.value && voiceAuth.formState.confirm_password.value !== voiceAuth.formState.password.value && (
              <p className="text-[11px] text-rose-500 mt-1 font-medium">Passwords do not match</p>
            )}
          </div>

          {mode === 'keyboard' && (
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white tracking-wide shadow-md transition-all duration-200 disabled:opacity-50 hover:brightness-105 active:scale-[0.98] mt-1"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          )}

          {mode === 'voice' && (
            <div className="text-center text-[12px] font-semibold text-[#6366f1] py-2.5 rounded-xl"
                 style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
              🎤 Voice active — speak or type below
            </div>
          )}
        </form>

        <AiControlBar
          state={voiceAuth.fsmState}
          isListening={voiceAuth.isListening}
          isSpeaking={voiceAuth.isSpeaking}
          liveTranscript={voiceAuth.liveTranscript}
          aiResponse={voiceAuth.aiResponse}
          pttEnabled={voiceAuth.pttEnabled}
          setPttEnabled={voiceAuth.setPttEnabled}
          onConfirm={voiceAuth.onConfirm}
          startListening={voiceAuth.startListening}
          stopListening={voiceAuth.stopListening}
          currentStep={voiceAuth.currentStep}
          pendingValue={voiceAuth.pendingValue}
          mode={mode}
          setMode={setMode}
          onSendText={handleSendText}
        />

        <p className="text-center text-[13px] text-[#86868b] mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-[#6366f1] font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
