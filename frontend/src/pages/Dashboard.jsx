import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { applicationsAPI } from '../services/api';
import { Plus, FileText, Clock, CheckCircle, AlertCircle, Edit3, Eye, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useGlobalHandsFreeVoice } from '../hooks/useGlobalHandsFreeVoice';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const { speak } = useSpeechSynthesis();
  const hasSpokenRef = useRef(false);

  useGlobalHandsFreeVoice({
    'new interview': () => navigate('/interview'),
    'new project': () => navigate('/interview'),
    'create project': () => navigate('/interview'),
    'start': () => navigate('/interview'),
    'logout': () => { logout(); navigate('/login'); },
    'sign out': () => { logout(); navigate('/login'); }
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchApplications();

    if (!hasSpokenRef.current) {
      hasSpokenRef.current = true;
      speak("Welcome to your dashboard.");
    }
  }, [user, navigate]);

  const fetchApplications = async () => {
    try {
      const res = await applicationsAPI.getAll();
      setApplications(res.data);
    } catch (err) {
      toast.error('Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (appId, projectName) => {
    if (!window.confirm(`Are you sure you want to delete "${projectName || 'Untitled Project'}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await applicationsAPI.delete(appId);
      setApplications(prev => prev.filter(a => a.id !== appId));
      toast.success('Application deleted successfully');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete application');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'submitted': return 'text-green-600 bg-green-50';
      case 'in_progress': return 'text-blue-600 bg-blue-50';
      case 'under_review': return 'text-orange-600 bg-orange-50';
      case 'draft': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'submitted': return <CheckCircle className="w-3.5 h-3.5" />;
      case 'in_progress': return <Clock className="w-3.5 h-3.5" />;
      case 'under_review': return <AlertCircle className="w-3.5 h-3.5" />;
      default: return <FileText className="w-3.5 h-3.5" />;
    }
  };

  const getActionLink = (app) => {
    // Always allow viewing requirements (read-only for submitted)
    switch (app.status) {
      case 'draft': return `/interview`;
      case 'in_progress': return `/requirements/${app.id}`;
      case 'submitted': return `/requirements/${app.id}`;
      default: return `/requirements/${app.id}`;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px] flex items-center justify-center">
        <div className="animate-pulse text-helix-gray-600">Loading applications...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px]">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold text-helix-navy">My Applications</h1>
            <p className="text-sm text-helix-gray-600 mt-1">
              View and manage your business requirement submissions
            </p>
          </div>
          <Link
            to="/interview"
            className="flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-6 py-3 rounded-full hover:bg-[#0f172a] transition-all"
          >
            <Plus className="w-4 h-4" /> New Interview
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
            <p className="text-2xl font-bold text-helix-navy">{applications.length}</p>
            <p className="text-xs text-helix-gray-600">Total</p>
          </div>
          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
            <p className="text-2xl font-bold text-blue-600">{applications.filter(a => a.status === 'in_progress').length}</p>
            <p className="text-xs text-helix-gray-600">In Progress</p>
          </div>
          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
            <p className="text-2xl font-bold text-green-600">{applications.filter(a => a.status === 'submitted').length}</p>
            <p className="text-xs text-helix-gray-600">Submitted</p>
          </div>
          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
            <p className="text-2xl font-bold text-orange-600">{applications.filter(a => a.status === 'under_review').length}</p>
            <p className="text-xs text-helix-gray-600">Under Review</p>
          </div>
        </div>

        {/* Applications List */}
        {applications.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-12 text-center">
            <FileText className="w-12 h-12 text-helix-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-helix-navy mb-2">No applications yet</h3>
            <p className="text-sm text-helix-gray-600 mb-6">
              Start a voice interview to create your first requirement document.
            </p>
            <Link
              to="/interview"
              className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-6 py-3 rounded-full hover:bg-[#0f172a]"
            >
              <Plus className="w-4 h-4" /> Start Interview
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map((app) => (
              <div key={app.id} className="bg-white rounded-2xl border border-[#DCE5EF] p-5 flex items-center gap-4 hover:shadow-sm transition-shadow">
                {/* Icon */}
                <div className="w-10 h-10 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-helix-blue" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm text-helix-navy truncate">
                    {app.project_name || 'Untitled Project'}
                  </h3>
                  <p className="text-xs text-helix-gray-600">
                    {app.reference_number} · {new Date(app.created_at).toLocaleDateString()}
                  </p>
                </div>

                {/* Status */}
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(app.status)}`}>
                  {getStatusIcon(app.status)}
                  {app.status.replace('_', ' ')}
                </div>

                {/* Requirements count */}
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-helix-navy">{app.total_requirements_captured}</p>
                  <p className="text-[10px] text-helix-gray-600">requirements</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(app.status !== 'submitted' || user?.is_admin) && (
                    <Link
                      to={`/requirements/${app.id}`}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title={app.status === 'submitted' ? 'View Requirements' : 'Edit Requirements'}
                    >
                      <Edit3 className="w-4 h-4 text-helix-gray-600" />
                    </Link>
                  )}
                  <Link
                    to={`/requirements/${app.id}`}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="View"
                  >
                    <Eye className="w-4 h-4 text-helix-gray-600" />
                  </Link>
                  {user?.is_admin && (
                    <button
                      onClick={() => handleDelete(app.id, app.project_name)}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-red-400 hover:text-red-600" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

