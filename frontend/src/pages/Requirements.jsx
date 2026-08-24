import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { applicationsAPI, requirementsAPI } from '../services/api';
import { ArrowLeft, Sparkles, Save, ArrowRight, Globe, ChevronDown, Mail, Send, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGlobalHandsFreeVoice } from '../hooks/useGlobalHandsFreeVoice';
import { useVoiceAgent } from '../context/VoiceAgentContext';

// All supported languages for the document selector (including Korean)
const LANGUAGE_OPTIONS = [
  { value: 'english',   label: 'English',     native: 'English',    flag: '🇬🇧' },
  { value: 'korean',    label: 'Korean',      native: '한국어',    flag: '🇰🇷' },
  { value: 'tamil',     label: 'Tamil',       native: 'தமிழ்',      flag: '🇮🇳' },
  { value: 'malayalam', label: 'Malayalam',   native: 'മലയാളം',    flag: '🇮🇳' },
  { value: 'telugu',    label: 'Telugu',      native: 'తెలుగు',    flag: '🇮🇳' },
  { value: 'kannada',   label: 'Kannada',     native: 'ಕನ್ನಡ',    flag: '🇮🇳' },
  { value: 'hindi',     label: 'Hindi',       native: 'हिन्दी',    flag: '🇮🇳' },
  { value: 'tanglish',  label: 'Tanglish',    native: 'Tanglish',   flag: '🇮🇳' },
  { value: 'manglish',  label: 'Manglish',    native: 'Manglish',   flag: '🇮🇳' },
  { value: 'hinglish',  label: 'Hinglish',    native: 'Hinglish',   flag: '🇮🇳' },
  { value: 'tenglish',  label: 'Tenglish',    native: 'Tenglish',   flag: '🇮🇳' },
];

export default function Requirements() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pageActionsRef } = useVoiceAgent();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false); // Gemini auto-fill in progress
  const [formData, setFormData] = useState({});
  const [docLang, setDocLang] = useState('english');
  const [detectedLang, setDetectedLang] = useState(null);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Real-time Email Sender Modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const handleSendEmail = async () => {
    if (!emailAddress || !emailAddress.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }
    setSendingEmail(true);
    try {
      const res = await applicationsAPI.sendEmail(id, {
        recipient_email: emailAddress,
        doc_language_preference: docLang
      });
      if (res.data.success) {
        toast.success(`PDF Requirements successfully emailed to ${res.data.email || emailAddress}!`);
        setShowEmailModal(false);
      } else {
        toast.error(res.data.message || 'Failed to send email');
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send email.');
    } finally {
      setSendingEmail(false);
    }
  };

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

  // Close language dropdown on outside click
  useEffect(() => {
    const handler = () => setLangDropdownOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const fetchApplication = async () => {
    try {
      const res = await applicationsAPI.getOne(id);
      setApplication(res.data);

      // Set language: default English, but show detected language as a suggestion
      const langCtx = res.data.language_context || {};
      const locked = langCtx.locked_language || null;
      const docPref = langCtx.doc_language_preference;

      if (locked && locked.toLowerCase() !== 'english') {
        setDetectedLang(locked); // Show the detected language as a badge
      }

      // Honour saved preference, otherwise default to english
      if (docPref && docPref !== 'user_lang') {
        setDocLang(docPref.toLowerCase());
      } else {
        setDocLang('english');
      }

      const defaultEm = res.data.contact_email || res.data.signer_email || user?.email || '';
      if (defaultEm && !defaultEm.endsWith('@helix.ai') && !defaultEm.endsWith('@helix-guest.com')) {
        setEmailAddress(defaultEm);
      }

      const appData = res.data;
      const formValues = {
        project_name:          appData.project_name || '',
        project_type:          appData.project_type || '',
        business_domain:       appData.business_domain || '',
        application_type:      appData.application_type || '',
        target_audience:       appData.target_audience || '',
        business_description:  appData.business_description || '',
        problem_statement:     appData.problem_statement || '',
        desired_outcomes:      appData.desired_outcomes || '',
        key_features:          appData.key_features || '',
        integrations:          appData.integrations || '',
        timeline:              appData.timeline || '',
        budget_range:          appData.budget_range || '',
        tech_preferences:      appData.tech_preferences || '',
        scalability_needs:     appData.scalability_needs || '',
        security_requirements: appData.security_requirements || '',
      };
      setFormData(formValues);

      // ── Auto-fill: if all key fields are empty, trigger Gemini generation ──
      const allEmpty = !formValues.project_name
        && !formValues.business_domain
        && !formValues.business_description
        && !formValues.key_features;

      if (allEmpty) {
        setIsAutoGenerating(true);
        // Delay slightly so the page renders first, then auto-generate
        setTimeout(async () => {
          try {
            const guestToken = localStorage.getItem('helix_guest_token');
            const genRes = await requirementsAPI.generate({
              application_id: Number(id),
              guest_token: guestToken,
              doc_language_preference: docPref && docPref !== 'user_lang' ? docPref : 'english',
            });
            if (genRes.data) {
              setApplication(genRes.data);
              setFormData({
                project_name:          genRes.data.project_name || '',
                project_type:          genRes.data.project_type || '',
                business_domain:       genRes.data.business_domain || '',
                application_type:      genRes.data.application_type || '',
                target_audience:       genRes.data.target_audience || '',
                business_description:  genRes.data.business_description || '',
                problem_statement:     genRes.data.problem_statement || '',
                desired_outcomes:      genRes.data.desired_outcomes || '',
                key_features:          genRes.data.key_features || '',
                integrations:          genRes.data.integrations || '',
                timeline:              genRes.data.timeline || '',
                budget_range:          genRes.data.budget_range || '',
                tech_preferences:      genRes.data.tech_preferences || '',
                scalability_needs:     genRes.data.scalability_needs || '',
                security_requirements: genRes.data.security_requirements || '',
              });
              toast.success('✅ Requirements generated from your interview!');
            }
          } catch (err) {
            console.warn('Auto-generate failed:', err);
            toast.error('Could not auto-fill requirements. Use the “Generate from Interview” button.');
          } finally {
            setIsAutoGenerating(false);
          }
        }, 800);
      }
    } catch (err) {
      toast.error('Failed to load application');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const updateFormDataFromApp = (appData) => {
    setFormData({
      project_name:          appData.project_name || '',
      project_type:          appData.project_type || '',
      business_domain:       appData.business_domain || '',
      application_type:      appData.application_type || '',
      target_audience:       appData.target_audience || '',
      business_description:  appData.business_description || '',
      problem_statement:     appData.problem_statement || '',
      desired_outcomes:      appData.desired_outcomes || '',
      key_features:          appData.key_features || '',
      integrations:          appData.integrations || '',
      timeline:              appData.timeline || '',
      budget_range:          appData.budget_range || '',
      tech_preferences:      appData.tech_preferences || '',
      scalability_needs:     appData.scalability_needs || '',
      security_requirements: appData.security_requirements || '',
    });
  };

  const handleLanguageChange = async (newLang) => {
    setDocLang(newLang);
    setLangDropdownOpen(false);
    if (newLang === docLang) return;

    setLoading(true);
    try {
      const guestToken = localStorage.getItem('helix_guest_token');
      const res = await requirementsAPI.generate({
        application_id: Number(id),
        guest_token: guestToken,
        doc_language_preference: newLang,
      });
      setApplication(res.data);
      updateFormDataFromApp(res.data);
      const langObj = LANGUAGE_OPTIONS.find(l => l.value === newLang);
      toast.success(`Document language set to ${langObj?.label || newLang}`);
    } catch (err) {
      toast.error('Failed to update document language');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoFillAi = async () => {
    setLoading(true);
    try {
      const guestToken = localStorage.getItem('helix_guest_token');
      const res = await requirementsAPI.generate({
        application_id: Number(id),
        guest_token: guestToken,
        doc_language_preference: docLang,
      });
      setApplication(res.data);
      updateFormDataFromApp(res.data);
      toast.success('AI completed and enriched all requirement fields!');
    } catch (err) {
      toast.error('Failed to auto-fill requirements');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Register Voice Agent Actions
  pageActionsRef.current = {
    changeLanguage: async ({ language }) => {
      const langObj = LANGUAGE_OPTIONS.find(l => 
        l.label.toLowerCase() === language.toLowerCase() || 
        l.value.toLowerCase() === language.toLowerCase()
      );
      const newLang = langObj ? langObj.value : language.toLowerCase();
      return handleLanguageChange(newLang);
    },
    checkRequirements: async () => {
      return handleAutoFillAi();
    }
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

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const blob = await applicationsAPI.downloadPdf(id, docLang !== 'english' ? docLang : null);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ref = application?.reference_number || `REQ-${id}`;
      a.href = url;
      a.download = `Helix_Requirements_${ref}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded!');
    } catch (err) {
      toast.error('PDF download failed. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px] flex items-center justify-center">
        <div className="animate-pulse text-helix-gray-600">Loading requirements...</div>
      </div>
    );
  }

  const isSubmitted = application?.status === 'submitted';
  const currentLangObj = LANGUAGE_OPTIONS.find(l => l.value === docLang) || LANGUAGE_OPTIONS[0];

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
          {isSubmitted && (
            <button
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex items-center gap-1 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-full"
            >
              {downloadingPdf ? 'Generating...' : '↓ Download PDF'}
            </button>
          )}
          {!isSubmitted && (
            <>
              <button
                onClick={() => setShowEmailModal(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 border border-emerald-200 rounded-full transition-all"
              >
                <Mail className="w-3.5 h-3.5 text-emerald-600" /> Email PDF
              </button>
              <button
                onClick={handleAutoFillAi}
                disabled={loading || isAutoGenerating}
                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 border border-indigo-200 rounded-full transition-all disabled:opacity-60"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                {isAutoGenerating ? 'Generating...' : 'Regenerate from Interview'}
              </button>
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
          <p className="text-base text-helix-gray-700 mb-4">
            I pulled this together from our conversation. Fields highlighted with <span className="inline-flex items-center gap-0.5 bg-blue-50 text-helix-blue text-xs px-1.5 py-0.5 rounded font-medium"><Sparkles className="w-2.5 h-2.5" />AI</span> were extracted automatically. Edit anything that's not quite right.
          </p>

          {/* ── Document Language Selector ── */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600 text-white rounded-xl">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-indigo-950">Document Language</h4>
                  <p className="text-xs text-indigo-700">
                    {detectedLang && detectedLang.toLowerCase() !== 'english'
                      ? <>Helix detected your conversation was in <strong>{detectedLang}</strong>. Default is English — change below if needed.</>
                      : <>Choose the language for your PDF report. Default is <strong>English</strong>.</>
                    }
                  </p>
                </div>
              </div>

              {/* Language Dropdown */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setLangDropdownOpen(prev => !prev)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 rounded-xl text-sm font-semibold text-indigo-800 hover:bg-indigo-50 shadow-sm"
                >
                  <span>{currentLangObj.flag}</span>
                  <span>{currentLangObj.label}</span>
                  {currentLangObj.native !== currentLangObj.label && (
                    <span className="text-indigo-400 font-normal">({currentLangObj.native})</span>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${langDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {langDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-indigo-100 rounded-2xl shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100">
                      <p className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider">Select Language</p>
                    </div>
                    <div className="py-1 max-h-72 overflow-y-auto">
                      {LANGUAGE_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => handleLanguageChange(opt.value)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-indigo-50 transition-colors ${docLang === opt.value ? 'bg-indigo-50' : ''}`}
                        >
                          <span className="text-lg">{opt.flag}</span>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-indigo-900">{opt.label}</span>
                            {opt.native !== opt.label && (
                              <span className="text-xs text-indigo-500">{opt.native}</span>
                            )}
                          </div>
                          {docLang === opt.value && (
                            <span className="ml-auto text-indigo-600 font-bold text-sm">✓</span>
                          )}
                          {detectedLang && opt.label.toLowerCase() === detectedLang.toLowerCase() && docLang !== opt.value && (
                            <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Detected</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: Project Information */}
        <FormSection number="01" title="Project Information" fieldCount="5 fields">
          <FormField readOnly={isSubmitted} label="Project name"      value={formData.project_name}      onChange={(v) => handleChange('project_name', v)}      isAI={true} />
          <FormField readOnly={isSubmitted} label="Project Type"      value={formData.project_type}      onChange={(v) => handleChange('project_type', v)}      isAI={true} />
          <FormField readOnly={isSubmitted} label="Business Domain"   value={formData.business_domain}   onChange={(v) => handleChange('business_domain', v)}   isAI={true} />
          <FormField readOnly={isSubmitted} label="Application Type"  value={formData.application_type}  onChange={(v) => handleChange('application_type', v)}  isAI={true} />
          <FormField readOnly={isSubmitted} label="Target Audience"   value={formData.target_audience}   onChange={(v) => handleChange('target_audience', v)}   isAI={true} />
        </FormSection>

        {/* Section 2: Business Details */}
        <FormSection number="02" title="Business Details" fieldCount="5 fields">
          <FormField readOnly={isSubmitted} label="Business Description" value={formData.business_description} onChange={(v) => handleChange('business_description', v)} isAI={true}  multiline />
          <FormField readOnly={isSubmitted} label="Problem Statement"    value={formData.problem_statement}    onChange={(v) => handleChange('problem_statement', v)}    isAI={true}  multiline />
          <FormField readOnly={isSubmitted} label="Desired Outcomes"     value={formData.desired_outcomes}     onChange={(v) => handleChange('desired_outcomes', v)}                  multiline />
          <FormField readOnly={isSubmitted} label="Key Features"         value={formData.key_features}         onChange={(v) => handleChange('key_features', v)}         isAI={true}  multiline />
          <FormField readOnly={isSubmitted} label="Integrations"         value={formData.integrations}         onChange={(v) => handleChange('integrations', v)} />
        </FormSection>

        {/* Section 3: Technical Requirements */}
        <FormSection number="03" title="Technical & Timeline" fieldCount="5 fields">
          <FormField readOnly={isSubmitted} label="Timeline"                value={formData.timeline}              onChange={(v) => handleChange('timeline', v)}              isAI={true} />
          <FormField readOnly={isSubmitted} label="Budget Range"            value={formData.budget_range}          onChange={(v) => handleChange('budget_range', v)} />
          <FormField readOnly={isSubmitted} label="Technology Preferences"  value={formData.tech_preferences}      onChange={(v) => handleChange('tech_preferences', v)}     multiline />
          <FormField readOnly={isSubmitted} label="Scalability Needs"       value={formData.scalability_needs}     onChange={(v) => handleChange('scalability_needs', v)} />
          <FormField readOnly={isSubmitted} label="Security Requirements"   value={formData.security_requirements} onChange={(v) => handleChange('security_requirements', v)} multiline />
        </FormSection>

        {/* Section 4: Business Model Canvas (BMC) */}
        {application?.requirements_json?.business_model_canvas && (
          <FormSection number="04" title="Business Model Canvas" fieldCount="9 blocks">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Key Partners</h4>
                <p className="text-xs text-slate-700">{Array.isArray(application.requirements_json.business_model_canvas.key_partners) ? application.requirements_json.business_model_canvas.key_partners.join(', ') : application.requirements_json.business_model_canvas.key_partners}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Key Activities</h4>
                <p className="text-xs text-slate-700">{Array.isArray(application.requirements_json.business_model_canvas.key_activities) ? application.requirements_json.business_model_canvas.key_activities.join(', ') : application.requirements_json.business_model_canvas.key_activities}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Value Propositions</h4>
                <p className="text-xs text-slate-700">{Array.isArray(application.requirements_json.business_model_canvas.value_propositions) ? application.requirements_json.business_model_canvas.value_propositions.join(', ') : application.requirements_json.business_model_canvas.value_propositions}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Customer Relationships</h4>
                <p className="text-xs text-slate-700">{Array.isArray(application.requirements_json.business_model_canvas.customer_relationships) ? application.requirements_json.business_model_canvas.customer_relationships.join(', ') : application.requirements_json.business_model_canvas.customer_relationships}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Customer Segments</h4>
                <p className="text-xs text-slate-700">{Array.isArray(application.requirements_json.business_model_canvas.customer_segments) ? application.requirements_json.business_model_canvas.customer_segments.join(', ') : application.requirements_json.business_model_canvas.customer_segments}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">Revenue Streams</h4>
                <p className="text-xs text-slate-700">{Array.isArray(application.requirements_json.business_model_canvas.revenue_streams) ? application.requirements_json.business_model_canvas.revenue_streams.join(', ') : application.requirements_json.business_model_canvas.revenue_streams}</p>
              </div>
            </div>
          </FormSection>
        )}

        {/* Section 5: Proportional Business Budget Allocation */}
        {application?.requirements_json?.proportional_budget && Array.isArray(application.requirements_json.proportional_budget) && (
          <FormSection number="05" title="Proportional Budget Allocation" fieldCount={`${application.requirements_json.proportional_budget.length} modules`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-indigo-900 text-white font-semibold">
                    <th className="p-3 rounded-l-lg">Module / Category</th>
                    <th className="p-3 text-center">Split %</th>
                    <th className="p-3">Scope & Deliverables</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {application.requirements_json.proportional_budget.map((item, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-3 font-semibold text-slate-900">{item.category}</td>
                      <td className="p-3 text-center font-bold text-indigo-600">{item.percentage}%</td>
                      <td className="p-3 text-slate-600">{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

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

      {/* Real-time Email Sender Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-3xl p-6 bg-white shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-gray-900">Email Requirements PDF</h3>
                  <p className="text-xs text-gray-500">Send official PDF directly to recipient</p>
                </div>
              </div>
              <button onClick={() => setShowEmailModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Recipient Email Address</label>
              <input
                type="email"
                value={emailAddress}
                onChange={e => setEmailAddress(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:outline-none text-sm font-medium"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Document will be sent in <strong>{currentLangObj.label} ({currentLangObj.native})</strong> with full Business Canvas.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEmailModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !emailAddress}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-emerald-200"
              >
                {sendingEmail ? 'Sending...' : <><Send className="w-4 h-4" /> Send Email</>}
              </button>
            </div>
          </div>
        </div>
      )}
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
