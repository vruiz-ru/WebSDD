import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { UserProfile } from '../lib/api';
import { api } from '../lib/api';

interface AuthContextType {
  user: UserProfile | null;
  setUser: (user: UserProfile | null) => void;
  updateCredits: (credits: number) => void;
  isAuthenticated: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const USER_STORAGE_KEY = 'timp_ceramica_user_profile';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<UserProfile | null>(() => {
    try {
      const saved = sessionStorage.getItem(USER_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserProfile) : null;
    } catch {
      return null;
    }
  });

  const setUser = (newUser: UserProfile | null) => {
    setUserState(newUser);
    try {
      if (newUser) sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
      else sessionStorage.removeItem(USER_STORAGE_KEY);
    } catch { /* ignore */ }
  };

  const updateCredits = (newCredits: number) => {
    setUserState((prev) => {
      if (!prev) return null;
      const updated: UserProfile = { ...prev, credits: newCredits };
      try { sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  };

  const logout = () => setUser(null);

  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener('auth:expired', handleExpired);
    if (user) {
      api.GET('/api/v1/bookings/me').then(({ error }) => {
        if (error) handleExpired();
      });
    }
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, updateCredits, isAuthenticated: user !== null, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  return context;
};
