import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { adminAPI, applicationsAPI } from '../services/api';
import { Users, FileText, Clock, CheckCircle, BarChart3, Trash2, Eye } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.is_admin) {
      toast.error('Admin access required');
      navigate('/dashboard');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    try {
      const [statsRes, appsRes] = await Promise.all([
        adminAPI.getStats(),
        applicationsAPI.getAll()
      ]);
      setStats(statsRes.data);
      setApplications(appsRes.data);
    } catch (err) {
      toast.error('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (appId, projectName) => {
    if (!window.confirm(`Delete "${projectName || 'Untitled Project'}"?\n\nThis will permanently remove the application and all its interview data. This cannot be undone.`)) {
      return;
    }
    try {
      await applicationsAPI.delete(appId);
      setApplications(prev => prev.filter(a => a.id !== appId));
      toast.success('Application deleted');
      // Refresh stats
      const statsRes = await adminAPI.getStats();
      setStats(statsRes.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px] flex items-center justify-center">
        <div className="animate-pulse text-helix-gray-600">Loading admin panel...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px]">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-semibold text-helix-navy mb-2">Admin Dashboard</h1>
        <p className="text-sm text-helix-gray-600 mb-8">Overview of all applications and users</p>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-10">
            <StatCard icon={<FileText />} value={stats.total_applications} label="Total Applications" color="blue" />
            <StatCard icon={<CheckCircle />} value={stats.submitted} label="Submitted" color="green" />
            <StatCard icon={<Clock />} value={stats.in_progress} label="In Progress" color="orange" />
            <StatCard icon={<Users />} value={stats.total_users} label="Total Users" color="purple" />
          </div>
        )}

        {/* Applications Table */}
        <div className="bg-white rounded-2xl border border-[#DCE5EF] overflow-hidden">
          <div className="p-5 border-b border-[#DCE5EF]">
            <h2 className="font-semibold text-base text-helix-navy">All Applications</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left text-xs font-semibold text-helix-gray-600 px-5 py-3">Reference</th>
                  <th className="text-left text-xs font-semibold text-helix-gray-600 px-5 py-3">Project</th>
                  <th className="text-left text-xs font-semibold text-helix-gray-600 px-5 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-helix-gray-600 px-5 py-3">Requirements</th>
                  <th className="text-left text-xs font-semibold text-helix-gray-600 px-5 py-3">Created</th>
                  <th className="text-left text-xs font-semibold text-helix-gray-600 px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-medium text-helix-navy">{app.reference_number}</td>
                    <td className="px-5 py-3 text-sm text-helix-gray-700">{app.project_name || 'Untitled'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        app.status === 'submitted' ? 'bg-green-50 text-green-600' :
                        app.status === 'in_progress' ? 'bg-blue-50 text-blue-600' :
                        'bg-gray-50 text-gray-600'
                      }`}>
                        {app.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-helix-gray-700">{app.total_requirements_captured}</td>
                    <td className="px-5 py-3 text-sm text-helix-gray-600">{new Date(app.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <Link
                          to={`/requirements/${app.id}`}
                          className="p-2 hover:bg-blue-50 rounded-lg transition-colors group"
                          title="View requirements"
                        >
                          <Eye className="w-4 h-4 text-blue-400 group-hover:text-blue-600" />
                        </Link>
                        <button
                          onClick={() => handleDelete(app.id, app.project_name)}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors group"
                          title="Delete application"
                        >
                          <Trash2 className="w-4 h-4 text-red-400 group-hover:text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, value, label, color }) {
  const colors = {
    blue: 'from-blue-50 to-blue-100 text-blue-600',
    green: 'from-green-50 to-green-100 text-green-600',
    orange: 'from-orange-50 to-orange-100 text-orange-600',
    purple: 'from-purple-50 to-purple-100 text-purple-600',
  };

  return (
    <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors[color]} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-helix-navy">{value}</p>
      <p className="text-xs text-helix-gray-600">{label}</p>
    </div>
  );
}

