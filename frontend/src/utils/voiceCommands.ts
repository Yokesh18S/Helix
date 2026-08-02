export type VoiceCommand =
  | 'repeat'
  | 'next'
  | 'back'
  | 'clear'
  | 'change_email'
  | 'change_phone'
  | 'skip'
  | 'cancel'
  | 'stop'
  | 'keyboard'
  | 'submit'
  | 'confirm_yes'
  | 'confirm_no'
  | 'go_to_login'
  | 'go_to_register'
  | 'go_to_home';

/**
 * Checks if the text matches any of our global voice commands.
 */
export function matchVoiceCommand(text: string): VoiceCommand | null {
  const clean = text.toLowerCase().trim();

  // Exact matching or helper prefixes
  if (clean === 'repeat' || clean === 'say again') return 'repeat';
  if (clean === 'next' || clean === 'go next') return 'next';
  
  // Local back command (only when exactly "back" or "go back")
  if (clean === 'back' || clean === 'go back') return 'back';
  
  if (clean === 'clear' || clean === 'erase') return 'clear';
  if (clean.includes('change email')) return 'change_email';
  if (clean.includes('change phone') || clean.includes('change number')) return 'change_phone';
  if (clean === 'skip' || clean === 'omit') return 'skip';
  if (clean === 'cancel' || clean === 'abort' || clean === 'reset') return 'cancel';
  if (clean === 'stop listening' || clean === 'stop mic' || clean === 'stop') return 'stop';
  if (clean.includes('use keyboard') || clean === 'keyboard') return 'keyboard';
  if (clean === 'submit') return 'submit';
  
  // Navigation: Go / Back to Register (Sign Up)
  if (
    clean.includes('go to signup') || 
    clean.includes('go to sign up') || 
    clean.includes('go to register') || 
    clean.includes('back to signup') || 
    clean.includes('back to sign up') || 
    clean.includes('back to register') || 
    clean.includes('go back to signup') || 
    clean.includes('go back to sign up') || 
    clean.includes('go back to register') || 
    clean === 'signup' || 
    clean === 'sign up' || 
    clean === 'register'
  ) {
    return 'go_to_register';
  }
  
  // Navigation: Go / Back to Login (Sign In)
  if (
    clean.includes('go to signin') || 
    clean.includes('go to sign in') || 
    clean.includes('go to login') || 
    clean.includes('go to log in') || 
    clean.includes('back to signin') || 
    clean.includes('back to sign in') || 
    clean.includes('back to login') || 
    clean.includes('back to log in') || 
    clean.includes('go back to signin') || 
    clean.includes('go back to sign in') || 
    clean.includes('go back to login') || 
    clean.includes('go back to log in') || 
    clean === 'signin' || 
    clean === 'sign in' || 
    clean === 'login' || 
    clean === 'log in'
  ) {
    return 'go_to_login';
  }

  // Navigation: Go / Back to Home Page
  if (
    clean.includes('go to home') || 
    clean.includes('go to home page') || 
    clean.includes('back to home') || 
    clean.includes('back to home page') || 
    clean.includes('go back to home') || 
    clean.includes('go back to home page') || 
    clean === 'home' || 
    clean === 'home page' || 
    clean === 'homepage'
  ) {
    return 'go_to_home';
  }

  // Confirmation shortcuts
  if (clean === 'yes' || clean === 'correct' || clean === 'yeah' || clean === 'yup' || clean === 'confirm') {
    return 'confirm_yes';
  }
  if (clean === 'no' || clean === 'incorrect' || clean === 'try again' || clean === 'nope' || clean === 'wrong') {
    return 'confirm_no';
  }

  return null;
}
