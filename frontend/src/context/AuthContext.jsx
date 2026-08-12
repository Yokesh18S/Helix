import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, interviewAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('helix_token');
    const savedUser = localStorage.getItem('helix_user');

    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  /**
   * After login/register, check if there's a pending guest session
   * and transfer it to the authenticated user's account.
   * Returns the claimed application_id or null.
   */
  const claimGuestSession = async (specificAppId = null) => {
    const guestToken = localStorage.getItem('helix_pending_guest_token') || localStorage.getItem('helix_guest_token');
    const pendingAppId = localStorage.getItem('helix_pending_app_id');
    const appIdToClaim = specificAppId || (pendingAppId ? parseInt(pendingAppId, 10) : null);
    if (!guestToken && !appIdToClaim) return null;

    try {
      const res = await interviewAPI.claimGuestSession(guestToken, appIdToClaim);
      const claimedAppId = res.data.application_id || appIdToClaim;
      // Clean up guest tokens
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      return claimedAppId;
    } catch (err) {
      console.warn('Guest session claim warning:', err.response?.data);
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      return appIdToClaim;
    }
  };

  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const login = async (phone, password) => {
    const response = await authAPI.login({ phone, password });
    const { access_token, user: userData } = response.data;
    localStorage.setItem('helix_token', access_token);
    localStorage.setItem('helix_user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const register = async (data) => {
    const response = await authAPI.register(data);
    const { access_token, user: userData } = response.data;
    localStorage.setItem('helix_token', access_token);
    localStorage.setItem('helix_user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const logout = () => {
    localStorage.removeItem('helix_token');
    localStorage.removeItem('helix_user');
    setUser(null);
  };

  const loginWithOtp = (accessToken, userData) => {
    localStorage.setItem('helix_token', accessToken);
    localStorage.setItem('helix_user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, claimGuestSession, loginWithOtp, voiceEnabled, setVoiceEnabled }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
