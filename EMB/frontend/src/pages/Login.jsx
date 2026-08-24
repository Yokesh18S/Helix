import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mic } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E8F3FC] to-[#F6F6FF] pt-[67px] flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-inter font-bold text-xl text-helix-navy">Helix</h1>
        </div>

        <h2 className="text-2xl font-semibold text-center text-helix-navy mb-2">Welcome back</h2>
        <p className="text-sm text-helix-gray-600 text-center mb-8">Sign in to view your applications</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="you@company.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1E293B] text-white font-medium text-sm py-3.5 rounded-full hover:bg-[#0f172a] transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-helix-gray-600 mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-helix-blue font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

