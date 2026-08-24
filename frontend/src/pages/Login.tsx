import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mic } from 'lucide-react';
import toast from 'react-hot-toast';
import { authAPI } from '../services/api';
import { parseSpokenPhone, isValid10DigitPhone } from '../utils/phoneParser';
import AiControlBar from '../components/AiControlBar';
import { useAuthenticationVoice, AuthField } from '../hooks/useAuthenticationVoice';

export default function Login() {
  const [mode, setMode] = useState<'voice' | 'keyboard'>('voice');
  const [loading, setLoading] = useState(false);
  const [simulatedOtp, setSimulatedOtp] = useState('');
  const [generatingOtp, setGeneratingOtp] = useState(false);

  const { loginWithOtp, claimGuestSession } = useAuth();
  const navigate  = useNavigate();
  const phoneRef  = useRef<HTMLInputElement>(null);
  const otpRef    = useRef<HTMLInputElement>(null);

  const handleVoiceCompleted = async (voiceData: any) => {
    setLoading(true);
    try {
      const phone = voiceData.phone;
      const otpCode = voiceData.password || voiceData.otp;
      
      const authRes = await authAPI.verifyOtp({ phone, otp_code: otpCode });
      const { access_token, user: userData } = authRes.data;
      
      loginWithOtp(access_token, userData);
      toast.success(`Welcome back, ${userData.full_name || 'User'}!`);
    } catch (err: any) {
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceSuccess = async () => {
    const pending = sessionStorage.getItem("pendingNavigation");
    const claimedAppId = await claimGuestSession();
    if (pending) {
      sessionStorage.removeItem("pendingNavigation");
      navigate(pending);
    } else if (claimedAppId) {
      toast.success('Interview saved to your account!');
      navigate(`/requirements/${claimedAppId}`);
    } else {
      navigate('/dashboard');
    }
  };

  const handleSwitchToKeyboard = () => setMode('keyboard');
  const handleNavigateToRegister = () => { toast('Taking you to sign up…'); navigate('/register'); };
  const handleNavigateToHome = () => { toast('Taking you to home page…'); navigate('/'); };

  const voiceAuth = useAuthenticationVoice({
    flow: 'signin',
    isActive: mode === 'voice',
    onCompleted: handleVoiceCompleted,
    onSuccess: handleVoiceSuccess,
    onSwitchToKeyboard: handleSwitchToKeyboard,
    onNavigateToRegister: handleNavigateToRegister,
    onNavigateToHome: handleNavigateToHome
  });

  useEffect(() => {
    if (mode === 'keyboard' && phoneRef.current && !voiceAuth.formState.phone.value) {
      phoneRef.current.focus();
    }
  }, [mode, voiceAuth.formState.phone.value]);

  const getFieldValue = (field: AuthField) => {
    return voiceAuth.formState[field].value;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    voiceAuth.updateField(e.target.name as AuthField, e.target.value, 'keyboard');
  };

  const handleSendText = (text: string) => {
    voiceAuth.updateField(voiceAuth.currentStep, text, 'keyboard');
  };

  const handleGenerateOtp = async () => {
    const phoneVal = voiceAuth.formState.phone.value.trim();
    let cleaned = parseSpokenPhone(phoneVal);
    if (cleaned.length > 10) cleaned = cleaned.slice(-10);
    if (!isValid10DigitPhone(cleaned)) {
      toast.error('Please enter a valid 10-digit phone number');
      return;
    }
    voiceAuth.updateField('phone', cleaned, 'keyboard');
    setGeneratingOtp(true);
    try {
      const res = await authAPI.initiateOtp({ phone: cleaned });
      if (res.data.simulated_otp) {
        setSimulatedOtp(res.data.simulated_otp);
        toast.success(`[Helix SMS Simulation] OTP for ${cleaned} is: ${res.data.simulated_otp}`, {
          duration: 10000
        });
      } else {
        toast.success(`OTP sent to ${cleaned}`);
      }
      setTimeout(() => otpRef.current?.focus(), 150);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to send OTP. Please check phone number and try again.');
    } finally {
      setGeneratingOtp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = voiceAuth.formState.phone.value.trim();
    const otpCode = voiceAuth.formState.password.value.trim();

    if (!otpCode || otpCode.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP code.');
      return;
    }

    setLoading(true);
    try {
      const authRes = await authAPI.verifyOtp({ phone, otp_code: otpCode });
      const { access_token, user: userData } = authRes.data;

      loginWithOtp(access_token, userData);
      toast.success(`Welcome back, ${userData.full_name || 'User'}!`);

      const pending = sessionStorage.getItem("pendingNavigation");
      const claimedAppId = await claimGuestSession();
      if (pending) {
        sessionStorage.removeItem("pendingNavigation");
        navigate(pending);
      } else if (claimedAppId) {
        toast.success('Interview saved to your account!');
        navigate(`/requirements/${claimedAppId}`);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || 'OTP verification failed.';
      if (status === 404)      toast.error('No account found with that phone number.');
      else if (status === 400) toast.error('Invalid or expired OTP code. Please try again.');
      else                     toast.error(detail);
    } finally {
      setLoading(false);
    }
  };

  /* ─── macOS-style input class ──────────────────────────────────────────── */
  const inputCls =
    'w-full px-4 py-3 rounded-xl text-sm font-medium text-[#1d1d1f] ' +
    'bg-[#fbfbfd] border border-[#d1d1d6] ' +
    'placeholder-[#aeaeb2] ' +
    'focus:outline-none focus:ring-2 focus:ring-[#6366f1]/40 focus:border-[#6366f1] ' +
    'transition-all duration-200 shadow-sm';

  return (
    /* Page — very light macOS-style background */
    <div className="min-h-screen flex items-center justify-center px-4 pt-[80px] pb-12"
         style={{ background: 'linear-gradient(135deg, #dce8f8 0%, #ede9f6 50%, #f0f4ff 100%)' }}>

      {/* Card — frosted glass exactly like macOS panels */}
      <div className="w-full max-w-md rounded-[28px] p-8 animate-fade-in"
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

        <h2 className="text-[22px] font-bold text-center text-[#1d1d1f] mb-1 tracking-tight">Welcome back</h2>
        <p className="text-[13px] text-[#86868b] text-center mb-7 font-medium">Sign in to your Helix account via OTP</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone with Generate OTP Button */}
          <div>
            <label htmlFor="phone" className="block text-[11px] font-semibold text-[#6e6e73] mb-1.5 uppercase tracking-widest">
              Phone Number
            </label>
            <div className="flex items-center gap-2">
              <input id="phone" ref={phoneRef} type="tel" name="phone"
                value={getFieldValue('phone')} onChange={handleChange}
                className={inputCls + ' flex-1'}
                placeholder="10-digit phone number"
                pattern="[0-9]{10}"
                minLength={10}
                maxLength={10}
                title="Enter a 10-digit phone number"
                required />
              <button
                type="button"
                onClick={handleGenerateOtp}
                disabled={generatingOtp}
                className="px-3.5 py-3 rounded-xl text-xs font-semibold text-white tracking-wide shadow-sm transition-all bg-[#6366f1] hover:bg-[#4f46e5] active:scale-[0.98] disabled:opacity-50 flex-shrink-0"
              >
                {generatingOtp ? 'Sending…' : 'Generate OTP'}
              </button>
            </div>
          </div>

          {/* SMS Simulation Callout */}
          {simulatedOtp && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs shadow-sm">
              <span className="font-semibold block mb-0.5">💡 SMS Simulation Mode</span>
              Your OTP code is <span className="font-mono font-bold text-sm bg-white border border-amber-300 px-1.5 py-0.5 rounded text-amber-900">{simulatedOtp}</span>
            </div>
          )}

          {/* OTP Code Box */}
          <div>
            <label htmlFor="password" className="block text-[11px] font-semibold text-[#6e6e73] mb-1.5 uppercase tracking-widest">
              Enter 6-Digit OTP Code
            </label>
            <div className="relative">
              <input id="password" ref={otpRef} type="text" name="password"
                value={getFieldValue('password')} onChange={handleChange}
                className={inputCls + ' tracking-[0.25em] text-center font-bold text-lg'} 
                placeholder="123456" 
                maxLength={6} 
                required />
            </div>
          </div>

          {mode === 'keyboard' && (
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white tracking-wide shadow-md transition-all duration-200 disabled:opacity-50 hover:brightness-105 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
              {loading ? 'Verifying OTP…' : 'Verify OTP & Sign in'}
            </button>
          )}

          {mode === 'voice' && (
            <div className="text-center text-[12px] font-semibold text-[#6366f1] py-2.5 rounded-xl"
                 style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
              🎤 Voice active — speak phone & OTP code or type below
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


      </div>
    </div>
  );
}
