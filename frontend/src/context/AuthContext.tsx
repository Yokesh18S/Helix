import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI, interviewAPI } from '../services/api';

export interface User {
  id?: number | string;
  full_name?: string;
  email?: string;
  phone?: string;
  [key: string]: any;
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (phone: string, password?: string) => Promise<any>;
  register: (data: any) => Promise<any>;
  logout: () => void;
  claimGuestSession: (specificAppId?: number | string | null) => Promise<any>;
  loginWithOtp: (accessToken: string, userData: User) => User;
  voiceEnabled: boolean;
  setVoiceEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const token = localStorage.getItem('helix_token');
    const savedUser = localStorage.getItem('helix_user');

    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse saved user:', e);
      }
    }
    setLoading(false);
  }, []);

  /**
   * After login/register, check if there's a pending guest session
   * and transfer it to the authenticated user's account.
   * Returns the claimed application_id or null.
   */
  const claimGuestSession = async (specificAppId: number | string | null = null) => {
    const guestToken = localStorage.getItem('helix_pending_guest_token') || localStorage.getItem('helix_guest_token');
    const pendingAppId = localStorage.getItem('helix_pending_app_id');
    const appIdToClaim = specificAppId || (pendingAppId ? parseInt(pendingAppId, 10) : null);
    if (!guestToken && !appIdToClaim) return null;

    try {
      const res = await interviewAPI.claimGuestSession(guestToken, appIdToClaim);
      const claimedAppId = res.data?.application_id || appIdToClaim;
      // Clean up guest tokens
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      return claimedAppId;
    } catch (err: any) {
      console.warn('Guest session claim warning:', err?.response?.data);
      localStorage.removeItem('helix_pending_guest_token');
      localStorage.removeItem('helix_guest_token');
      localStorage.removeItem('helix_pending_app_id');
      return appIdToClaim;
    }
  };

  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);

  const login = async (phone: string, password?: string) => {
    const response = await authAPI.login({ phone, password });
    const { access_token, user: userData } = response.data;
    localStorage.setItem('helix_token', access_token);
    localStorage.setItem('helix_user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const register = async (data: any) => {
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

  const loginWithOtp = (accessToken: string, userData: User) => {
    localStorage.setItem('helix_token', accessToken);
    localStorage.setItem('helix_user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const updateUser = (updates: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...updates };
    localStorage.setItem('helix_user', JSON.stringify(updated));
    setUser(updated);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, claimGuestSession, loginWithOtp, voiceEnabled, setVoiceEnabled, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
