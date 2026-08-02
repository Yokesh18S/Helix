import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { applicationsAPI } from '../services/api';
import { ArrowLeft, Sparkles, Save, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGlobalHandsFreeVoice } from '../hooks/useGlobalHandsFreeVoice';

export default function Requirements() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({});

  useGlobalHandsFreeVoice({
    'save': () => handleSave(),
    'continue': () => handleContinue(),
    'next': () => handleContinue(),
    'proceed': () => handleContinue(),
    'back': () => navigate('/dashboard'),
    'dashboard': () => navigate('/dashboard'),
    'go back': () => navigate('/dashboard')
  });

  useEffect(() => {
    fetchApplication();
  }, [id]);

  const fetchApplication = async () => {
    try {
      const res = await applicationsAPI.getOne(id);
      setApplication(res.data);
      setFormData({
        project_name: res.data.project_name || '',
        project_type: res.data.project_type || '',
        business_domain: res.data.business_domain || '',
        application_type: res.data.application_type || '',
        target_audience: res.data.target_audience || '',
        business_description: res.data.business_description || '',
        problem_statement: res.data.problem_statement || '',
        desired_outcomes: res.data.desired_outcomes || '',
        key_features: res.data.key_features || '',
        integrations: res.data.integrations || '',
        timeline: res.data.timeline || '',
        budget_range: res.data.budget_range || '',
        tech_preferences: res.data.tech_preferences || '',
        scalability_needs: res.data.scalability_needs || '',
        security_requirements: res.data.security_requirements || '',
      });
    } catch (err) {
      toast.error('Failed to load application');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await applicationsAPI.update(id, formData);
      setApplication(res.data);
      toast.success('Requirements saved!');
    } catch (err) {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    await handleSave();
    navigate(`/documents/${id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px] flex items-center justify-center">
        <div className="animate-pulse text-helix-gray-600">Loading requirements...</div>
      </div>
    );
  }

  const aiFields = ['project_name', 'project_type', 'business_domain', 'application_type', 'target_audience'];
  const isSubmitted = application?.status === 'submitted';

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 text-sm font-medium text-helix-gray-700 hover:text-black"
        >
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
        <div className="flex items-center gap-3">
          {isSubmitted && (
            <span className="text-xs font-medium text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
              ✓ Submitted
            </span>
          )}
          {!isSubmitted && (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 text-sm font-medium text-helix-gray-700 hover:text-black px-4 py-2 border border-gray-200 rounded-full"
              >
                <Save className="w-3 h-3" /> {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleContinue}
                className="bg-[#1E293B] text-white text-xs font-medium px-5 py-2 rounded-full hover:bg-[#0f172a]"
              >
                Continue
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-helix-blue" />
            <p className="text-xs font-semibold text-helix-blue tracking-[0.2em] uppercase">
              Auto-generated by Helix
            </p>
          </div>
          <h1 className="text-4xl font-semibold text-helix-navy mb-2">
            Here's your requirement draft
          </h1>
          <p className="text-base text-helix-gray-700">
            I pulled this together from our conversation. Fields highlighted with <span className="inline-flex items-center gap-0.5 bg-blue-50 text-helix-blue text-xs px-1.5 py-0.5 rounded font-medium"><Sparkles className="w-2.5 h-2.5" />AI</span> were extracted automatically. Edit anything that's not quite right.
          </p>
        </div>

        {/* Section 1: Project Information */}
        <FormSection number="01" title="Project Information" fieldCount="5 fields">
          <FormField
            readOnly={isSubmitted}
            label="Project name"
            value={formData.project_name}
            onChange={(v) => handleChange('project_name', v)}
            isAI={true}
          />
          <FormField
            readOnly={isSubmitted}
            label="Project Type"
            value={formData.project_type}
            onChange={(v) => handleChange('project_type', v)}
            isAI={true}
          />
          <FormField
            readOnly={isSubmitted}
            label="Business Domain"
            value={formData.business_domain}
            onChange={(v) => handleChange('business_domain', v)}
            isAI={true}
          />
          <FormField
            readOnly={isSubmitted}
            label="Application Type"
            value={formData.application_type}
            onChange={(v) => handleChange('application_type', v)}
            isAI={true}
          />
          <FormField
            readOnly={isSubmitted}
            label="Target Audience"
            value={formData.target_audience}
            onChange={(v) => handleChange('target_audience', v)}
            isAI={true}
          />
        </FormSection>

        {/* Section 2: Business Details */}
        <FormSection number="02" title="Business Details" fieldCount="5 fields">
          <FormField
            readOnly={isSubmitted}
            label="Business Description"
            value={formData.business_description}
            onChange={(v) => handleChange('business_description', v)}
            isAI={true}
            multiline
          />
          <FormField
            readOnly={isSubmitted}
            label="Problem Statement"
            value={formData.problem_statement}
            onChange={(v) => handleChange('problem_statement', v)}
            isAI={true}
            multiline
          />
          <FormField
            readOnly={isSubmitted}
            label="Desired Outcomes"
            value={formData.desired_outcomes}
            onChange={(v) => handleChange('desired_outcomes', v)}
            multiline
          />
          <FormField
            readOnly={isSubmitted}
            label="Key Features"
            value={formData.key_features}
            onChange={(v) => handleChange('key_features', v)}
            isAI={true}
            multiline
          />
          <FormField
            readOnly={isSubmitted}
            label="Integrations"
            value={formData.integrations}
            onChange={(v) => handleChange('integrations', v)}
          />
        </FormSection>

        {/* Section 3: Technical Requirements */}
        <FormSection number="03" title="Technical & Timeline" fieldCount="5 fields">
          <FormField
            readOnly={isSubmitted}
            label="Timeline"
            value={formData.timeline}
            onChange={(v) => handleChange('timeline', v)}
            isAI={true}
          />
          <FormField
            readOnly={isSubmitted}
            label="Budget Range"
            value={formData.budget_range}
            onChange={(v) => handleChange('budget_range', v)}
          />
          <FormField
            readOnly={isSubmitted}
            label="Technology Preferences"
            value={formData.tech_preferences}
            onChange={(v) => handleChange('tech_preferences', v)}
            multiline
          />
          <FormField
            readOnly={isSubmitted}
            label="Scalability Needs"
            value={formData.scalability_needs}
            onChange={(v) => handleChange('scalability_needs', v)}
          />
          <FormField
            readOnly={isSubmitted}
            label="Security Requirements"
            value={formData.security_requirements}
            onChange={(v) => handleChange('security_requirements', v)}
            multiline
          />
        </FormSection>

        {/* AI Summary */}
        {application?.ai_summary && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-6 border border-blue-100 mt-8">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-helix-blue" />
              <h3 className="font-semibold text-sm text-helix-navy">AI Summary</h3>
            </div>
            <p className="text-sm text-helix-gray-700 leading-relaxed">{application.ai_summary}</p>
          </div>
        )}

        {/* Continue Button - only for non-submitted */}
        {!isSubmitted && (
          <div className="flex justify-end mt-10">
            <button
              onClick={handleContinue}
              className="flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-full hover:bg-[#0f172a]"
            >
              Continue to Documents <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FormSection({ number, title, fieldCount, children }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DCE5EF] overflow-hidden mb-6">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#DCE5EF]">
        <div className="w-8 h-8 bg-helix-navy rounded-full flex items-center justify-center">
          <span className="text-white text-xs font-semibold">{number}</span>
        </div>
        <h3 className="font-semibold text-base text-helix-navy">{title}</h3>
        <span className="text-[10px] text-helix-gray-600 font-medium">{fieldCount}</span>
      </div>
      <div className="p-6 space-y-5">
        {children}
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, isAI, multiline, readOnly }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-xs font-medium text-helix-gray-700">{label}</label>
        {isAI && (
          <span className="inline-flex items-center gap-0.5 bg-[#ECF3FC] text-helix-blue text-[10px] px-1.5 py-0.5 rounded font-medium">
            <Sparkles className="w-2.5 h-2.5" /> AI
          </span>
        )}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          readOnly={readOnly}
          className={`w-full px-4 py-3 bg-[#FCFEFF] border border-[#DCE5EF] rounded-2xl text-sm focus:outline-none resize-none ${readOnly ? 'cursor-default opacity-80' : 'focus:border-helix-blue'}`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          className={`w-full px-4 py-3 bg-[#FCFEFF] border border-[#DCE5EF] rounded-2xl text-sm focus:outline-none ${readOnly ? 'cursor-default opacity-80' : 'focus:border-helix-blue'}`}
        />
      )}
    </div>
  );
}

