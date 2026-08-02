import { useState, useEffect, useRef, useCallback } from 'react';
import { useSpeechSynthesis } from './useSpeechSynthesis';
import { useVoiceRecognition, VoiceResult } from './useVoiceRecognition';
import { parseSpokenEmail, isValidEmail } from '../utils/emailParser';
import { parseSpokenPhone, isValid10DigitPhone, phoneToSpokenDigits } from '../utils/phoneParser';
import { parseSpokenPassword } from '../utils/passwordParser';
import { matchVoiceCommand } from '../utils/voiceCommands';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';

export type FlowType = 'signin' | 'signup';

export type FsmState =
  | 'IDLE'
  | 'GREETING'
  | 'PROMPTING'
  | 'LISTENING'
  | 'PROCESSING'
  | 'CONFIRMING'
  | 'AUTHENTICATING'
  | 'SUCCESS'
  | 'ERROR';

export type AuthField =
  | 'full_name'
  | 'email'
  | 'confirm_email'
  | 'company'
  | 'phone'
  | 'password'
  | 'confirm_password';

export interface FieldState {
  value: string;
  lastUpdatedBy: 'voice' | 'keyboard' | 'manual' | 'AI' | '';
  timestamp: number;
}

export type AuthenticationFormState = Record<AuthField, FieldState>;

// ─── SENTINEL: used in pendingValue to signal special CONFIRMING sub-modes ───
const SENTINEL_NAVIGATE_TO_REGISTER = '__NAVIGATE_TO_REGISTER__';
const SENTINEL_RETRY_PASSWORD       = '__RETRY_PASSWORD__';
const SENTINEL_KEEP_OR_REPLACE      = '__KEEP_OR_REPLACE__';

const SIGNIN_STEPS: AuthField[] = ['phone', 'password'];
const SIGNUP_STEPS: AuthField[] = [
  'full_name',
  'phone',
  'password',
  'confirm_password'
];

// Words that must NEVER be parsed as form values — they are conversation controls.
const YES_WORDS = ['yes', 'yeah', 'yep', 'yup', 'correct', "that's right", "that's correct",
  'right', 'sure', 'ok', 'okay', 'confirm', 'confirmed', 'affirmative', 'exactly', 'sounds good',
  'go ahead', 'absolutely', 'of course', 'definitely'];
const NO_WORDS  = ['no', 'nope', 'wrong', 'incorrect', "that's wrong", 'try again', 'negative',
  'not right', 'redo', 'again', 'retry'];

const KEEP_WORDS = [...YES_WORDS, 'keep', 'keep it', 'use edited', 'edited', 'original', 'existing'];
const REPLACE_WORDS = [...NO_WORDS, 'replace', 'replace it', 'overwrite', 'new one', 'new', 'speak'];

interface UseAuthenticationVoiceProps {
  flow: FlowType;
  isActive: boolean;
  onCompleted: (data: any) => Promise<void>;
  onSwitchToKeyboard: () => void;
  onNavigateToRegister?: () => void;
  onNavigateToLogin?: () => void;
  onNavigateToHome?: () => void;
  onSuccess?: () => void; // called AFTER welcome speech finishes so navigation doesn't cut off TTS
}

const createEmptyFormState = (): AuthenticationFormState => ({
  full_name:        { value: '', lastUpdatedBy: '', timestamp: 0 },
  email:            { value: '', lastUpdatedBy: '', timestamp: 0 },
  confirm_email:    { value: '', lastUpdatedBy: '', timestamp: 0 },
  company:          { value: '', lastUpdatedBy: '', timestamp: 0 },
  phone:            { value: '', lastUpdatedBy: '', timestamp: 0 },
  password:         { value: '', lastUpdatedBy: '', timestamp: 0 },
  confirm_password: { value: '', lastUpdatedBy: '', timestamp: 0 }
});

const getFlatFormData = (state: AuthenticationFormState): Record<string, string> => {
  const flat: Record<string, string> = {} as any;
  for (const [key, field] of Object.entries(state)) {
    flat[key] = (field as FieldState).value;
  }
  return flat;
};

const getStepLabel = (step: string) => {
  switch (step) {
    case 'full_name':        return 'Full Name';
    case 'email':            return 'Email Address';
    case 'confirm_email':    return 'Confirm Email';
    case 'company':          return 'Company Name';
    case 'phone':            return 'Phone Number';
    case 'password':         return 'Password';
    case 'confirm_password': return 'Password Confirmation';
    default:                 return step;
  }
};

export function useAuthenticationVoice({
  flow,
  isActive,
  onCompleted,
  onSwitchToKeyboard,
  onNavigateToRegister,
  onNavigateToLogin,
  onNavigateToHome,
  onSuccess
}: UseAuthenticationVoiceProps) {
  const steps = flow === 'signin' ? SIGNIN_STEPS : SIGNUP_STEPS;

  // ─── State ────────────────────────────────────────────────────────────────
  const [fsmState, setFsmState] = useState<FsmState>('IDLE');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = steps[currentStepIndex];

  // Single source of truth form state
  const [formState, setFormState] = useState<AuthenticationFormState>(() => createEmptyFormState());

  const [pendingValue, setPendingValue]   = useState<string>('');
  const [retryCount, setRetryCount]       = useState(0);
  const [pttEnabled, setPttEnabled]       = useState(false);
  const [aiResponse, setAiResponse]       = useState('');
  const [recConfidence, setRecConfidence] = useState(0);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  // User Overwrite/Correction tracking state
  const [isOverwritingConfirmation, setIsOverwritingConfirmation] = useState(false);
  const pendingReplaceValueRef = useRef<string>('');

  // ─── Refs that always hold the latest values ──────────────────────────────
  const fsmStateRef                 = useRef<FsmState>('IDLE');
  const currentStepIndexRef         = useRef(0);
  const currentStepRef              = useRef<AuthField>(steps[0]);
  const formStateRef                = useRef<AuthenticationFormState>(formState);
  const retryCountRef               = useRef(0);
  const pttEnabledRef               = useRef(false);
  const pendingValueRef             = useRef('');
  const isActiveRef                 = useRef(isActive);
  const hasTriggeredRef             = useRef(false);
  const onNavigateToRegisterRef     = useRef(onNavigateToRegister);
  const onNavigateToLoginRef        = useRef(onNavigateToLogin);
  const onNavigateToHomeRef         = useRef(onNavigateToHome);
  const onSuccessRef                = useRef(onSuccess);
  const isOverwritingConfirmationRef = useRef(false);

  // Sync refs with state/props
  useEffect(() => { fsmStateRef.current = fsmState; }, [fsmState]);
  useEffect(() => {
    currentStepIndexRef.current = currentStepIndex;
    currentStepRef.current = steps[currentStepIndex];
  }, [currentStepIndex, steps]);
  useEffect(() => { formStateRef.current = formState; }, [formState]);
  useEffect(() => { retryCountRef.current = retryCount; }, [retryCount]);
  useEffect(() => { pttEnabledRef.current = pttEnabled; }, [pttEnabled]);
  useEffect(() => { pendingValueRef.current = pendingValue; }, [pendingValue]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { onNavigateToRegisterRef.current = onNavigateToRegister; }, [onNavigateToRegister]);
  useEffect(() => { onNavigateToLoginRef.current = onNavigateToLogin; }, [onNavigateToLogin]);
  useEffect(() => { onNavigateToHomeRef.current = onNavigateToHome; }, [onNavigateToHome]);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { isOverwritingConfirmationRef.current = isOverwritingConfirmation; }, [isOverwritingConfirmation]);

  const { speak: originalSpeak, stop: stopSynthesis, isSpeaking } = useSpeechSynthesis();

  // Refs for recognition control (functions stable across renders)
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef  = useRef<() => void>(() => {});
  const abortListeningRef = useRef<() => void>(() => {});

  const speak = useCallback((text: string, onEnd?: () => void) => {
    console.log('[VoiceAuth] speak wrapper — aborting listening first to prevent self-interruption.');
    abortListeningRef.current();
    originalSpeak(text, onEnd);
  }, [originalSpeak]);

  // Refs for voice result / error callbacks (avoids recreating the recognition engine)
  const handleVoiceResultRef = useRef<((r: VoiceResult) => void) | null>(null);
  const handleVoiceErrorRef  = useRef<((e: string) => void) | null>(null);

  const { isSupported, isListening, transcript, startListening, stopListening, abortListening } =
    useVoiceRecognition({
      onResult: (r)   => handleVoiceResultRef.current?.(r),
      onSpeechStart: () => {
        if (isSpeaking) {
          console.log('[VoiceAuth] User interrupted AI — stopping synthesis.');
          stopSynthesis();
        }
      },
      onError: (e) => handleVoiceErrorRef.current?.(e)
    });

  useEffect(() => {
    startListeningRef.current = startListening;
    stopListeningRef.current  = stopListening;
    abortListeningRef.current = abortListening;
  }, [startListening, stopListening, abortListening]);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const saveProgress = useCallback((data: Record<string, string>, stepIdx: number) => {
    localStorage.setItem(`insighta_voice_progress_${flow}`, JSON.stringify({ data, stepIdx }));
  }, [flow]);

  // Expose a field update function for both modes to write to the same state
  const updateField = useCallback((field: AuthField, value: string, source: FieldState['lastUpdatedBy']) => {
    setFormState(prev => {
      const updated = {
        ...prev,
        [field]: {
          value,
          lastUpdatedBy: source,
          timestamp: Date.now()
        }
      };
      formStateRef.current = updated;
      return updated;
    });
  }, []);

  // Expose reset form function
  const resetForm = useCallback(() => {
    console.log('[VoiceAuth] resetForm - clearing state completely');
    localStorage.removeItem(`insighta_voice_progress_${flow}`);
    
    const emptyState = createEmptyFormState();
    setFormState(emptyState);
    formStateRef.current = emptyState;

    setFsmState('IDLE');
    setCurrentStepIndex(0);
    setPendingValue('');
    setRetryCount(0);
    setAiResponse('');
    setRecConfidence(0);
    setRecognitionError(null);
    setIsOverwritingConfirmation(false);
    pendingReplaceValueRef.current = '';

    hasTriggeredRef.current = false;
  }, [flow]);

  // Clear everything internally on initial mount to start fresh on every new session
  useEffect(() => {
    resetForm();
  }, [resetForm]);

  const startConfirmationListening = useCallback(() => {
    if (!pttEnabledRef.current) {
      console.log('[VoiceAuth] Starting confirmation listening (state stays CONFIRMING).');
      startListeningRef.current();
    }
  }, []);

  // ─── Prompt text generator ────────────────────────────────────────────────
  const getPromptForStep = useCallback((step: AuthField, isRetry: boolean, isResumed: boolean): string => {
    if (isResumed && !isRetry) {
      return `Welcome back. Let's continue. Please say your ${getStepLabel(step)}.`;
    }

    if (flow === 'signin') {
      if (step === 'phone')    return isRetry ? "Please say your 10-digit phone number again." : "Let's sign you in. Please say your 10-digit phone number.";
      if (step === 'password') return isRetry ? "Please say your 6-digit OTP code again." : "I have sent an OTP code to your phone. Please say your 6-digit OTP code.";
    } else {
      switch (step) {
        case 'full_name':      return isRetry ? "Let's try your full name again." : "Let's create your account. Please say your full name.";
        case 'email':          return isRetry ? "Let's try the email address again." : "Please say your email address.";
        case 'confirm_email':  return isRetry ? "The emails didn't match. Please say your email address again to confirm." : "Please repeat your email address to confirm it.";
        case 'company':        return isRetry ? "Let's try the company name again, or say skip." : "Please say your company name, or say skip to leave it blank.";
        case 'phone':          return isRetry ? "Please say your 10-digit phone number again." : "Please say your 10-digit phone number.";
        case 'password':       return isRetry ? "Let's try the password again." : "Please say your password. You can switch to keyboard mode if you prefer.";
        case 'confirm_password': return isRetry ? "Please say the password again to confirm." : "Please confirm your password by saying it again.";
      }
    }
    return '';
  }, [flow]);

  // ─── Main prompt trigger ──────────────────────────────────────────────────
  const triggerPrompt = useCallback((stepIdx: number, isRetry = false, isResumed = false) => {
    if (!isActiveRef.current) return;
    const step = steps[stepIdx];
    const text = getPromptForStep(step, isRetry, isResumed);
    console.log(`[VoiceAuth] triggerPrompt step="${step}" retry=${isRetry}`);

    setAiResponse(text);
    setFsmState('PROMPTING');
    speak(text, () => {
      if (isActiveRef.current && !pttEnabledRef.current) {
        console.log('[VoiceAuth] Prompt done → starting LISTENING.');
        setFsmState('LISTENING');
        startListeningRef.current();
      } else {
        setFsmState('IDLE');
      }
    });
  }, [steps, getPromptForStep, speak]);

  // Trigger prompt when activated (only after initialized)
  useEffect(() => {
    if (isActive && fsmStateRef.current === 'IDLE' && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      triggerPrompt(currentStepIndex, false, false);
    }
  }, [isActive, triggerPrompt, currentStepIndex]);

  // ─── submitAuthFlow ───────────────────────────────────────────────────────
  const submitAuthFlow = useCallback(async (overrideData?: Record<string, string>) => {
    const finalData = overrideData || getFlatFormData(formStateRef.current);
    console.log('[VoiceAuth] submitAuthFlow with fields:', Object.keys(finalData));
    setFsmState('AUTHENTICATING');
    setAiResponse("Signing you in, please wait.");
    speak("Signing you in, please wait.");

    try {
      await onCompleted(finalData);
      localStorage.removeItem(`insighta_voice_progress_${flow}`);
      setFsmState('SUCCESS');
      const welcomeMsg = flow === 'signin'
        ? 'You are signed in. Welcome to your dashboard.'
        : 'Account created. Welcome to Helix!';
      setAiResponse(welcomeMsg);
      // Speak the welcome message first, THEN navigate — prevents TTS cut-off
      speak(welcomeMsg, () => {
        onSuccessRef.current?.();
      });
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || '';

      console.log(`[VoiceAuth] Auth error: status=${status} detail="${detail}"`);

      // ── Case 1: Phone/account not found ──────────────────────────────────
      if (flow === 'signin' && status === 404) {
        const rawPhone = finalData['phone'] || '';
        const phoneDisplay = rawPhone ? phoneToSpokenDigits(rawPhone) : 'that number';
        const msg = `I couldn't find an account with ${phoneDisplay}. Would you like to create a new account instead?`;
        setAiResponse(msg);
        setFsmState('CONFIRMING');
        setPendingValue(SENTINEL_NAVIGATE_TO_REGISTER);
        speak(msg, startConfirmationListening);
        return;
      }

      // ── Case 2: Wrong password ────────────────────────────────────────────
      if (flow === 'signin' && status === 401) {
        const msg = "The password was incorrect. Would you like to try again?";
        setAiResponse(msg);
        setFsmState('CONFIRMING');
        setPendingValue(SENTINEL_RETRY_PASSWORD);
        speak(msg, startConfirmationListening);
        return;
      }

      // ── Case 3: Phone/account already registered (signup redirect to signin) ──
      if (flow === 'signup' && (status === 409 || (status === 400 && detail.toLowerCase().includes('already registered')))) {
        const msg = "This phone number is already registered. Taking you to the sign in page.";
        setAiResponse(msg);
        setFsmState('AUTHENTICATING'); // visual state
        speak(msg, () => {
          onNavigateToLoginRef.current?.();
        });
        return;
      }

      // ── Case 4: Generic error ─────────────────────────────────────────────
      setFsmState('ERROR');
      const errMsg = detail || 'Authentication failed. Please try again.';
      setAiResponse(errMsg);
      speak(errMsg + " Say repeat to retry, or switch to keyboard.");
    }
  }, [flow, onCompleted, speak, startConfirmationListening]);

  // ─── handleRetry ──────────────────────────────────────────────────────────
  const handleRetry = useCallback((promptMsg: string) => {
    setRetryCount((prev) => {
      const nextCount = prev + 1;
      if (nextCount >= 3) {
        speak("We're having trouble recognizing that. Would you like to switch to keyboard mode?", onSwitchToKeyboard);
        return prev;
      }
      setAiResponse(promptMsg);
      speak(promptMsg, () => {
        if (!pttEnabledRef.current) { setFsmState('LISTENING'); startListeningRef.current(); }
      });
      return nextCount;
    });
  }, [speak, onSwitchToKeyboard]);

  // ─── saveAndGoNext ────────────────────────────────────────────────────────
  const saveAndGoNext = useCallback((val: string) => {
    const step    = currentStepRef.current;
    const stepIdx = currentStepIndexRef.current;
    const safe    = (step === 'password' || step === 'confirm_password') ? '***' : val;
    console.log(`[VoiceAuth] saveAndGoNext "${step}" = "${safe}"`);

    updateField(step, val, 'voice');
    setRetryCount(0);
    setPendingValue('');

    const nextData = { ...getFlatFormData(formStateRef.current), [step]: val };

    if (flow === 'signin' && step === 'phone') {
      authAPI.initiateOtp({ phone: val }).then(res => {
        if (res.data.simulated_otp) {
          toast.success(`[Helix SMS Simulation] OTP for ${val} is: ${res.data.simulated_otp}`, {
            duration: 10000
          });
        }
      }).catch(err => {
        console.warn('Voice OTP initiate error:', err);
      });
    }

    // Confirm email match (signup)
    if (step === 'confirm_email' && val !== nextData['email']) {
      toast.error("Emails do not match!");
      updateField('confirm_email', '', 'voice');
      handleRetry("The email addresses don't match. Please say your email address again to confirm.");
      return;
    }

    // Confirm password match (signup)
    if (step === 'confirm_password' && val !== nextData['password']) {
      toast.error("Passwords do not match!");
      updateField('confirm_password', '', 'voice');
      handleRetry("The passwords don't match. Please say your password again to confirm.");
      return;
    }

    const nextIdx = stepIdx + 1;
    saveProgress(nextData, nextIdx);

    if (nextIdx < steps.length) {
      setCurrentStepIndex(nextIdx);
      triggerPrompt(nextIdx, false, false);
    } else {
      submitAuthFlow(nextData);
    }
  }, [steps.length, saveProgress, triggerPrompt, submitAuthFlow, handleRetry, updateField]);

  // ─── advanceStep ──────────────────────────────────────────────────────────
  const advanceStep = useCallback(() => {
    const nextIdx = currentStepIndexRef.current + 1;
    if (nextIdx < steps.length) { setCurrentStepIndex(nextIdx); triggerPrompt(nextIdx, false, false); }
  }, [steps.length, triggerPrompt]);

  // ─── executeCommand ───────────────────────────────────────────────────────
  const executeCommand = useCallback((cmd: string) => {
    const stepIdx = currentStepIndexRef.current;
    const step    = currentStepRef.current;
    const formD   = getFlatFormData(formStateRef.current);
    console.log(`[VoiceAuth] executeCommand: "${cmd}"`);

    switch (cmd) {
      case 'repeat': triggerPrompt(stepIdx, false, false); break;
      case 'next':
        if (step === 'company') saveAndGoNext('');
        else if (formD[step]) advanceStep();
        else speak("This field is required. Please provide a value, or say keyboard to type.");
        break;
      case 'back':
        if (stepIdx > 0) { const p = stepIdx - 1; setCurrentStepIndex(p); triggerPrompt(p, false, false); }
        else speak("This is the first field.");
        break;
      case 'clear': {
        updateField(step, '', 'voice');
        speak("Field cleared. Please say it again."); triggerPrompt(stepIdx, false, false);
        break;
      }
      case 'change_email': {
        const i = steps.indexOf('email');
        if (i !== -1) { setCurrentStepIndex(i); triggerPrompt(i, false, false); }
        break;
      }
      case 'change_phone': {
        const i = steps.indexOf('phone');
        if (i !== -1) { setCurrentStepIndex(i); triggerPrompt(i, false, false); }
        break;
      }
      case 'skip':
        if (step === 'company') saveAndGoNext('');
        else speak("This field is required and cannot be skipped.");
        break;
      case 'cancel':
        resetForm();
        speak("Session reset."); triggerPrompt(0, false, false);
        break;
      case 'go_to_register':
        if (onNavigateToRegisterRef.current) {
          speak("Taking you to sign up.", () => {
            onNavigateToRegisterRef.current?.();
          });
        } else {
          speak("Sign up is not available.");
        }
        break;
      case 'go_to_login':
        if (onNavigateToLoginRef.current) {
          speak("Taking you to sign in.", () => {
            onNavigateToLoginRef.current?.();
          });
        } else {
          speak("Sign in is not available.");
        }
        break;
      case 'go_to_home':
        if (onNavigateToHomeRef.current) {
          speak("Taking you to the home page.", () => {
            onNavigateToHomeRef.current?.();
          });
        } else {
          speak("Home page is not available.");
        }
        break;
      case 'stop':
        stopListeningRef.current(); setFsmState('IDLE');
        speak("Microphone paused. Press the talk button or say start to continue.");
        break;
      case 'keyboard': onSwitchToKeyboard(); break;
      case 'submit':
        if (stepIdx === steps.length - 1) submitAuthFlow();
        else speak("Please complete the remaining steps first.");
        break;
    }
  }, [steps, flow, onSwitchToKeyboard, triggerPrompt, saveAndGoNext, advanceStep, submitAuthFlow, speak, updateField, resetForm]);

  // ─── handleConfirm (button clicks AND voice yes/no) ───────────────────────
  const handleConfirm = useCallback((yes: boolean) => {
    const pending = pendingValueRef.current;
    console.log(`[VoiceAuth] handleConfirm yes=${yes} pending="${pending.substring(0, 30)}"`);

    // ── User correction (keep vs replace) sentinel ────────────────────────────
    if (pending === SENTINEL_KEEP_OR_REPLACE) {
      setPendingValue('');
      setIsOverwritingConfirmation(false);
      setFsmState('IDLE');

      const step = currentStepRef.current;
      const currentVal = formStateRef.current[step]?.value || '';
      const newVal = pendingReplaceValueRef.current;

      if (yes) {
        // Keep the edited version!
        console.log(`[VoiceAuth] Keep edited version: "${currentVal}"`);
        saveAndGoNext(currentVal);
      } else {
        // Replace with the new spoken value!
        console.log(`[VoiceAuth] Replace with spoken: "${newVal}"`);
        saveAndGoNext(newVal);
      }
      return;
    }

    // ── Navigate-to-register sentinel ────────────────────────────────────────
    if (pending === SENTINEL_NAVIGATE_TO_REGISTER) {
      setPendingValue('');
      setFsmState('IDLE');
      if (yes) {
        speak("Great! Let me take you to the sign-up page.", () => {
          onNavigateToRegisterRef.current?.();
        });
      } else {
        // Go back to the first entry field (phone)
        const firstStep = steps[0];
        const stepIdx = steps.indexOf(firstStep);
        updateField(firstStep, '', 'voice');
        setCurrentStepIndex(stepIdx);
        triggerPrompt(stepIdx, false, false);
      }
      return;
    }

    // ── Retry-password sentinel ───────────────────────────────────────────────
    if (pending === SENTINEL_RETRY_PASSWORD) {
      setPendingValue('');
      setFsmState('IDLE');
      if (yes) {
        const pwdIdx = steps.indexOf('password');
        updateField('password', '', 'voice');
        setCurrentStepIndex(pwdIdx);
        triggerPrompt(pwdIdx, true, false);
      } else {
        onSwitchToKeyboard();
      }
      return;
    }

    // ── Normal field value confirmation ───────────────────────────────────────
    if (yes) {
      saveAndGoNext(pending);
    } else {
      setPendingValue('');
      setRetryCount((prev) => prev + 1);
      triggerPrompt(currentStepIndexRef.current, true, false);
    }
  }, [steps, onSwitchToKeyboard, saveAndGoNext, triggerPrompt, speak, updateField]);

  // ─── processConfirmationResponse ─────────────────────────────────────────
  const processConfirmationResponse = useCallback((transcriptText: string) => {
    const cleaned = transcriptText.trim().toLowerCase();
    console.log(`[VoiceAuth] processConfirmationResponse: "${cleaned}"`);

    // Special Keep/Replace confirmation handling
    if (isOverwritingConfirmationRef.current) {
      const keep = KEEP_WORDS.some(w => cleaned === w || cleaned.startsWith(w + ' ') || cleaned.endsWith(' ' + w));
      const replace = REPLACE_WORDS.some(w => cleaned === w || cleaned.startsWith(w + ' ') || cleaned.endsWith(' ' + w));

      if (keep) {
        handleConfirm(true);
        return;
      }
      if (replace) {
        handleConfirm(false);
        return;
      }

      // Ambiguous — ask again
      const retryMsg = "I didn't catch that. Please say yes to keep the edited version, or no to replace it.";
      setAiResponse(retryMsg);
      speak(retryMsg, startConfirmationListening);
      return;
    }

    if (YES_WORDS.some(w => cleaned === w || cleaned.startsWith(w + ' ') || cleaned.endsWith(' ' + w))) {
      handleConfirm(true);
      return;
    }
    if (NO_WORDS.some(w => cleaned === w || cleaned.startsWith(w + ' ') || cleaned.endsWith(' ' + w))) {
      handleConfirm(false);
      return;
    }

    const retryMsg = "I didn't catch that. Please say yes to confirm, or no to try again.";
    setAiResponse(retryMsg);
    speak(retryMsg, startConfirmationListening);
  }, [handleConfirm, speak, startConfirmationListening]);

  // ─── handleVoiceResult ────────────────────────────────────────────────────
  const handleVoiceResult = useCallback(async (result: VoiceResult) => {
    const state = fsmStateRef.current;

    // ─── CONFIRMING state: only accept yes/no/keep/replace ───
    if (state === 'CONFIRMING') {
      if (!result.isFinal) return; // ignore interim
      console.log(`[VoiceAuth] CONFIRMING state — processing yes/no only: "${result.transcript}"`);
      stopListeningRef.current();
      setFsmState('PROCESSING');
      processConfirmationResponse(result.transcript);
      return;
    }

    if (state !== 'LISTENING') {
      console.log(`[VoiceAuth] Ignoring result — state is "${state}", not LISTENING.`);
      return;
    }
    if (!result.isFinal) {
      return;
    }

    setFsmState('PROCESSING');
    stopListeningRef.current();

    const spokenText = result.transcript.trim();
    const step       = currentStepRef.current;
    const stepIdx    = currentStepIndexRef.current;
    const retry      = retryCountRef.current;

    setRecConfidence(result.confidence);
    console.log(`[VoiceAuth] Processing final: "${spokenText}" step="${step}"`);

    // ─── Local control/navigation commands bypass backend NLP ────────────────
    const localCmd = matchVoiceCommand(spokenText);
    if (localCmd && localCmd !== 'confirm_yes' && localCmd !== 'confirm_no') {
      console.log(`[VoiceAuth] Local command matched: "${localCmd}"`);
      executeCommand(localCmd);
      return;
    }

    // Local check helper for manual edits
    const handleParsedValue = (val: string, shouldConfirm: boolean, aiResp?: string) => {
      // ─── DO NOT OVERWRITE USER CORRECTIONS ───
      const currentField = formStateRef.current[step];
      const isManual = currentField?.lastUpdatedBy === 'keyboard';
      const isDifferent = val && val !== currentField?.value;

      if (isManual && isDifferent) {
        console.log(`[VoiceAuth] Detected manual edit for ${step}. Prompting user to keep or replace.`);
        setPendingValue(SENTINEL_KEEP_OR_REPLACE);
        pendingReplaceValueRef.current = val;
        setIsOverwritingConfirmation(true);

        const question = `I noticed you updated your ${getStepLabel(step)}. Would you like to keep the edited version or replace it with what I just heard?`;
        setAiResponse(question);
        setFsmState('CONFIRMING');
        speak(question, startConfirmationListening);
        return;
      }

      const isPasswordField = step === 'password' || step === 'confirm_password';
      const actuallyConfirm = shouldConfirm && !isPasswordField;

      if (actuallyConfirm) {
        setPendingValue(val);
        setFsmState('CONFIRMING');
        setAiResponse(aiResp || `I heard ${val}. Is that correct?`);
        speak(aiResp || `I heard ${val}. Is that correct?`, startConfirmationListening);
      } else {
        if (isPasswordField) {
          saveAndGoNext(val);
        } else if (aiResp) {
          setAiResponse(aiResp); speak(aiResp, () => saveAndGoNext(val));
        } else {
          saveAndGoNext(val);
        }
      }
    };

    try {
      console.log('[VoiceAuth] Calling backend NLP...');
      const response = await authAPI.processVoiceNlp({
        flow, current_step: step, user_transcript: spokenText, form_data: getFlatFormData(formStateRef.current), retry_count: retry
      });

      const { parsed_value, command: cmd, ai_response, should_confirm } = response.data;
      console.log('[VoiceAuth] NLP response:', { parsed_value, cmd, should_confirm });

      // Global navigation command
      if (cmd && cmd !== 'confirm_yes' && cmd !== 'confirm_no') {
        if (ai_response) { setAiResponse(ai_response); speak(ai_response, () => executeCommand(cmd)); }
        else              { executeCommand(cmd); }
        return;
      }

      if (cmd === 'confirm_yes') { handleConfirm(true);  return; }
      if (cmd === 'confirm_no')  { handleConfirm(false); return; }

      if (parsed_value) {
        handleParsedValue(parsed_value, !!should_confirm, ai_response);
        return;
      }

      handleRetry(ai_response || "I didn't catch that. Please try again.");

    } catch (error) {
      console.warn('[VoiceAuth] Backend NLP failed — using local fallback:', error);

      const matchedCmd = matchVoiceCommand(spokenText);
      if (matchedCmd && matchedCmd !== 'confirm_yes' && matchedCmd !== 'confirm_no') { executeCommand(matchedCmd); return; }
      if (matchedCmd === 'confirm_yes') { handleConfirm(true);  return; }
      if (matchedCmd === 'confirm_no')  { handleConfirm(false); return; }

      let parsedVal = spokenText;
      if (step === 'email' || step === 'confirm_email') {
        parsedVal = parseSpokenEmail(spokenText);
        if (!parsedVal) {
          handleRetry("I need your full email address including the domain. Please say it like this: john at gmail dot com.");
          return;
        }

        if (step === 'confirm_email') {
          const existingEmail = formStateRef.current['email']?.value || '';
          if (parsedVal !== existingEmail) {
            handleRetry(`That doesn't match the email I have on file (${existingEmail}). Please say your email again to confirm.`);
            return;
          }
          handleParsedValue(parsedVal, false);
          return;
        }

        if (!isValidEmail(parsedVal)) {
          handleRetry("That doesn't look like a valid email address. Please try again: john at gmail dot com.");
          return;
        }
      } else if (step === 'phone') {
        parsedVal = parseSpokenPhone(spokenText);
        // ── Validate exactly 10 digits ───────────────────────────────────
        if (parsedVal.length !== 10) {
          handleRetry('Please say your 10-digit phone number again.');
          return;
        }
        // Bot reads back digit by digit so user can verify
        const spokenDigits = parsedVal.split('').join(' ');
        handleParsedValue(parsedVal, true, `I heard ${spokenDigits}. Is that correct?`);
        return;
      } else if (step === 'password' || step === 'confirm_password') {
        parsedVal = parseSpokenPassword(spokenText);
        saveAndGoNext(parsedVal);
        return;
      }

      if (result.confidence >= 0.95) {
        handleParsedValue(parsedVal, false);
      } else if (result.confidence >= 0.80) {
        handleParsedValue(parsedVal, true);
      } else {
        handleRetry("I didn't quite catch that. Could you say it again?");
      }
    }
  }, [flow, executeCommand, handleConfirm, saveAndGoNext, handleRetry, speak,
      processConfirmationResponse, startConfirmationListening]);

  // ─── handleVoiceError ─────────────────────────────────────────────────────
  const handleVoiceError = useCallback((errText: string) => {
    console.error('[VoiceAuth] Recognition error:', errText);
    setRecognitionError(errText);
    setFsmState('ERROR');
    if (retryCountRef.current >= 2) {
      speak("I'm having trouble with the microphone. Switching to keyboard mode.", onSwitchToKeyboard);
      return;
    }
    speak("There was a microphone error. Please say repeat to try again, or switch to keyboard mode.");
  }, [speak, onSwitchToKeyboard]);

  // Sync voice handlers into refs
  useEffect(() => {
    handleVoiceResultRef.current = handleVoiceResult;
    handleVoiceErrorRef.current  = handleVoiceError;
  }, [handleVoiceResult, handleVoiceError]);

  // ─── Stop when deactivated ────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      console.log('[VoiceAuth] Deactivated — stopping all audio.');
      stopSynthesis();
      abortListeningRef.current();
      setFsmState('IDLE');
      hasTriggeredRef.current = false;
    }
  }, [isActive, stopSynthesis]);

  // ─── Keep-alive: restart recognition after silence / no-speech timeout ────
  useEffect(() => {
    const shouldKeepAlive =
      isActive &&
      (fsmState === 'LISTENING' || fsmState === 'CONFIRMING') &&
      !isListening && !isSpeaking && !pttEnabled;

    if (shouldKeepAlive) {
      const timer = setTimeout(() => {
        const stillShouldKeepAlive =
          isActiveRef.current &&
          (fsmStateRef.current === 'LISTENING' || fsmStateRef.current === 'CONFIRMING') &&
          !isSpeaking && !pttEnabledRef.current;

        if (stillShouldKeepAlive) {
          console.log('[VoiceAuth] Keep-alive: restarting recognition.');
          startListeningRef.current();
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isActive, fsmState, isListening, isSpeaking, pttEnabled]);

  // ─── Live transcript → parsed value for real-time form field preview ──────
  const getLiveParsedValue = (): string => {
    if (!transcript) return '';
    if (currentStep === 'email' || currentStep === 'confirm_email') return parseSpokenEmail(transcript);
    if (currentStep === 'phone') return parseSpokenPhone(transcript);
    if (currentStep === 'password' || currentStep === 'confirm_password') return parseSpokenPassword(transcript);
    return transcript;
  };

  return {
    isSupported,
    fsmState,
    currentStep,
    currentStepIndex,
    formState,
    updateField,
    resetForm,
    pendingValue,
    retryCount,
    pttEnabled,
    setPttEnabled,
    aiResponse,
    recConfidence,
    recognitionError,
    liveTranscript: transcript,
    liveParsedValue: getLiveParsedValue(),
    isSpeaking,
    isListening,
    onConfirm:         handleConfirm,
    onRetry:           () => triggerPrompt(currentStepIndex, true, false),
    onKeyboardSwitch:  onSwitchToKeyboard,
    startListening,
    stopListening
  };
}
