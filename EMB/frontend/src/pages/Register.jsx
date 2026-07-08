import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mic } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Register() {
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    company: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(formData);
      toast.success('Account created! Welcome to Helix.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E8F3FC] to-[#F6F6FF] pt-[67px] flex items-center justify-center py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-inter font-bold text-xl text-helix-navy">Helix</h1>
        </div>

        <h2 className="text-2xl font-semibold text-center text-helix-navy mb-2">Create account</h2>
        <p className="text-sm text-helix-gray-600 text-center mb-8">Start your voice-first requirements journey</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Full Name</label>
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="John Doe"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="you@company.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Company (optional)</label>
            <input
              type="text"
              name="company"
              value={formData.company}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="Your company name"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Phone (optional)</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="+1 (555) 000-0000"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-helix-gray-700 mb-1.5">Password</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue focus:ring-1 focus:ring-helix-blue"
              placeholder="Min 6 characters"
              minLength={6}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1E293B] text-white font-medium text-sm py-3.5 rounded-full hover:bg-[#0f172a] transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-helix-gray-600 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-helix-blue font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

