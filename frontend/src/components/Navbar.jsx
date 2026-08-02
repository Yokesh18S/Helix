import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Compass, LogOut, User, Volume2, VolumeX } from 'lucide-react';

export default function Navbar() {
  const { user, logout, voiceEnabled, setVoiceEnabled } = useAuth();
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  return (
    <nav className="w-full h-[67px] bg-[#EEF1F8] flex items-center justify-between px-8 fixed top-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-md border border-white/40">
          <Compass className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-inter font-bold text-lg leading-tight text-helix-navy tracking-tight">insighta</h1>
          <p className="text-[9px] text-[#94A3B8] font-semibold uppercase tracking-wider">- From Tech Wizard -</p>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex items-center gap-6">
        <Link
          to="/"
          className={`text-base font-medium ${isActive('/') ? 'text-black' : 'text-[#9BAABD]'} hover:text-black transition-colors`}
        >
          Home
        </Link>
        <Link
          to="/interview"
          className={`text-base font-medium ${isActive('/interview') ? 'text-black' : 'text-[#9BAABD]'} hover:text-black transition-colors`}
        >
          Start Interview
        </Link>
        {user?.is_admin && (
          <Link
            to="/admin"
            className={`text-base font-medium ${isActive('/admin') ? 'text-black' : 'text-[#9BAABD]'} hover:text-black transition-colors`}
          >
            Admin
          </Link>
        )}
      </div>

      {/* Auth Section */}
      <div className="flex items-center gap-4">
        {/* Global Speaker Toggle */}
        <button
          onClick={() => {
            if (voiceEnabled) {
              window.speechSynthesis.cancel();
            }
            setVoiceEnabled(!voiceEnabled);
          }}
          className={`p-2 rounded-full border transition-all mr-2 ${
            voiceEnabled
              ? 'border-green-200 bg-green-50 hover:bg-green-100 text-green-600'
              : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-400'
          }`}
          title={voiceEnabled ? 'Mute speaker' : 'Unmute speaker'}
        >
          {voiceEnabled ? (
            <Volume2 className="w-4 h-4" />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
        </button>
        {user ? (
          <>
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-sm font-medium text-helix-gray-700 hover:text-black"
            >
              <User className="w-4 h-4" />
              {user.full_name}
            </Link>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-sm text-helix-gray-500 hover:text-red-500"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <Link
              to="/interview"
              className="bg-[#1E293B] text-white text-xs font-medium px-5 py-2 rounded-[23px] hover:bg-[#0f172a] transition-colors"
            >
              Start voice interview
            </Link>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="text-base font-medium text-black hover:text-helix-blue"
            >
              Sign in
            </Link>
            <Link
              to="/interview"
              className="bg-[#1E293B] text-white text-xs font-medium px-5 py-2 rounded-[23px] hover:bg-[#0f172a] transition-colors"
            >
              Start voice interview
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

