import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { applicationsAPI } from '../services/api';
import {
  CheckCircle, Download, Copy, ArrowRight,
  Mail, Globe, ChevronDown, Loader2, CheckCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useGlobalHandsFreeVoice } from '../hooks/useGlobalHandsFreeVoice';

const LANGUAGE_OPTIONS = [
  { value: 'english',   label: 'English',   native: 'English',  flag: '🇬🇧' },
  { value: 'tamil',     label: 'Tamil',     native: 'தமிழ்',   flag: '🇮🇳' },
  { value: 'malayalam', label: 'Malayalam', native: 'മലയാളം', flag: '🇮🇳' },
  { value: 'telugu',    label: 'Telugu',    native: 'తెలుగు',  flag: '🇮🇳' },
  { value: 'kannada',   label: 'Kannada',   native: 'ಕನ್ನಡ',  flag: '🇮🇳' },
  { value: 'hindi',     label: 'Hindi',     native: 'हिन्दी', flag: '🇮🇳' },
  { value: 'tanglish',  label: 'Tanglish',  native: 'Tanglish', flag: '🇮🇳' },
  { value: 'manglish',  label: 'Manglish',  native: 'Manglish', flag: '🇮🇳' },
  { value: 'hinglish',  label: 'Hinglish',  native: 'Hinglish', flag: '🇮🇳' },
  { value: 'tenglish',  label: 'Tenglish',  native: 'Tenglish', flag: '🇮🇳' },
];

export default function Submitted() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [application, setApplication] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailResult, setEmailResult] = useState(null); // { success, email }
  const [selectedLang, setSelectedLang] = useState('english');
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  useGlobalHandsFreeVoice({
    'dashboard': () => navigate('/dashboard'),
    'home':      () => navigate('/dashboard'),
    'back':      () => navigate('/dashboard'),
    'new interview': () => navigate('/interview'),
    'start new': () => navigate('/interview'),
    'new project': () => navigate('/interview'),
  });

  useEffect(() => {
    fetchApplication();
  }, [id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = () => setLangDropdownOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const fetchApplication = async () => {
    try {
      const res = await applicationsAPI.getOne(id);
      setApplication(res.data);

      // Detect conversation language for pre-selection suggestion
      const langCtx = res.data.language_context || {};
      const docPref = langCtx.doc_language_preference;
      if (docPref && docPref !== 'user_lang') {
        setSelectedLang(docPref.toLowerCase());
      }

      // Auto-send email on load (background)
      autoSendEmail(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const autoSendEmail = async (appData) => {
    // Only auto-send if there's a valid non-placeholder email
    const email = appData?.signer_email;
    if (!email || email.endsWith('@helix.ai')) return;
    try {
      const res = await applicationsAPI.sendEmail(id);
      if (res.data?.success) {
        setEmailSent(true);
        setEmailResult({ success: true, email: res.data.email });
      }
    } catch (_) {
      // Silent fail for auto-send
    }
  };

  const copyReference = () => {
    if (application?.reference_number) {
      navigator.clipboard.writeText(application.reference_number);
      toast.success('Reference number copied!');
    }
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const lang = selectedLang !== 'english' ? selectedLang : null;
      const blob = await applicationsAPI.downloadPdf(id, lang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ref = application?.reference_number || `REQ-${id}`;
      a.href = url;
      a.download = `Helix_Requirements_${ref}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded successfully!');
    } catch (err) {
      toast.error('PDF download failed. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await applicationsAPI.sendEmail(id);
      setEmailResult(res.data);
      if (res.data?.success) {
        setEmailSent(true);
        toast.success(`Report sent to ${res.data.email}!`);
      } else {
        toast.error(res.data?.message || 'Email delivery failed.');
      }
    } catch (err) {
      toast.error('Could not send email. Check SMTP settings.');
    } finally {
      setSendingEmail(false);
    }
  };

  if (!application) {
    return (
      <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px] flex items-center justify-center">
        <div className="animate-pulse text-helix-gray-600">Loading...</div>
      </div>
    );
  }

  const currentLangObj = LANGUAGE_OPTIONS.find(l => l.value === selectedLang) || LANGUAGE_OPTIONS[0];
  const detectedLang = application?.language_context?.locked_language;

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2 text-sm font-medium text-helix-gray-700 hover:text-black">
          Back to dashboard
        </Link>
        <Link
          to="/interview"
          className="bg-[#1E293B] text-white text-xs font-medium px-5 py-2 rounded-full hover:bg-[#0f172a]"
        >
          Start new interview
        </Link>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        {/* Success Icon */}
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-10 h-10 text-green-600" />
        </div>

        <h1 className="text-5xl font-bold text-black mb-4">
          Requirements submitted
        </h1>
        <p className="text-base text-helix-gray-700 max-w-lg mx-auto mb-10">
          Your business requirements have been signed and sent to our delivery team. We'll reach out within one business day.
        </p>

        {/* Email notification banner */}
        {emailSent && emailResult?.email && (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-3 flex items-center gap-3 max-w-lg mx-auto mb-6 text-left">
            <CheckCheck className="w-5 h-5 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-800">
              Report emailed to <strong>{emailResult.email}</strong> with PDF attached.
            </p>
          </div>
        )}

        {/* Info Card */}
        <div className="bg-white rounded-2xl border border-[#DCE5EF] p-6 max-w-lg mx-auto text-left">
          {/* Reference */}
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-helix-gray-700 tracking-[0.18em] mb-1">REFERENCE NUMBER</p>
            <div className="flex items-center gap-3">
              <p className="text-xl font-semibold text-helix-navy">{application.reference_number}</p>
              <button
                onClick={copyReference}
                className="p-2 bg-blue-50 border border-[#DCE5EF] rounded-xl hover:bg-blue-100"
              >
                <Copy className="w-4 h-4 text-helix-blue" />
              </button>
            </div>
          </div>

          <hr className="border-[#DCE5EF] mb-4" />

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold text-helix-gray-700 tracking-[0.18em] mb-1">SUBMITTED</p>
              <p className="text-sm text-helix-navy">
                {application.submitted_at ? new Date(application.submitted_at).toLocaleString() : 'Just now'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-helix-gray-700 tracking-[0.18em] mb-1">STATUS</p>
              <p className="text-sm text-helix-navy">Under review</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-helix-gray-700 tracking-[0.18em] mb-1">OWNER</p>
              <p className="text-sm text-helix-navy">Helix · AI consultant</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-helix-gray-700 tracking-[0.18em] mb-1">NEXT STEP</p>
              <p className="text-sm text-helix-navy">Analyst assignment</p>
            </div>
          </div>
        </div>

        {/* ── Language Selector for PDF ── */}
        <div className="bg-white border border-[#DCE5EF] rounded-2xl p-4 max-w-lg mx-auto mt-4 text-left">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-indigo-600" />
              <div>
                <p className="text-xs font-semibold text-helix-navy">PDF Language</p>
                {detectedLang && detectedLang.toLowerCase() !== 'english' && (
                  <p className="text-[10px] text-indigo-600">Detected: {detectedLang}</p>
                )}
              </div>
            </div>

            {/* Language Dropdown */}
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setLangDropdownOpen(prev => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-xl text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
              >
                <span>{currentLangObj.flag}</span>
                <span>{currentLangObj.label}</span>
                {currentLangObj.native !== currentLangObj.label && (
                  <span className="text-indigo-400 text-xs font-normal">({currentLangObj.native})</span>
                )}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${langDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {langDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-indigo-100 rounded-2xl shadow-xl z-50 overflow-hidden">
                  <div className="py-1 max-h-64 overflow-y-auto">
                    {LANGUAGE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setSelectedLang(opt.value); setLangDropdownOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-indigo-50 transition-colors ${selectedLang === opt.value ? 'bg-indigo-50' : ''}`}
                      >
                        <span>{opt.flag}</span>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-indigo-900">{opt.label}</span>
                          {opt.native !== opt.label && (
                            <span className="text-xs text-indigo-400">{opt.native}</span>
                          )}
                        </div>
                        {selectedLang === opt.value && (
                          <span className="ml-auto text-indigo-600 font-bold text-sm">✓</span>
                        )}
                        {detectedLang && opt.label.toLowerCase() === detectedLang.toLowerCase() && selectedLang !== opt.value && (
                          <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">AI detected</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-6">
          {/* Download PDF */}
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="flex items-center gap-2 bg-helix-navy text-white font-normal text-base px-6 py-3 rounded-full hover:bg-[#0f172a] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {downloadingPdf
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>
              : <><Download className="w-4 h-4" /> Download requirement PDF</>
            }
          </button>

          {/* Send Email */}
          <button
            onClick={handleSendEmail}
            disabled={sendingEmail}
            className={`flex items-center gap-2 font-normal text-base px-6 py-3 rounded-full border transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
              emailSent
                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                : 'bg-white text-helix-navy border-gray-200 hover:border-gray-400'
            }`}
          >
            {sendingEmail
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
              : emailSent
              ? <><CheckCheck className="w-4 h-4" /> Email sent!</>
              : <><Mail className="w-4 h-4" /> Send to email</>
            }
          </button>

          {/* View all applications */}
          <Link
            to="/dashboard"
            className="flex items-center gap-2 bg-white text-helix-navy font-normal text-base px-6 py-3 rounded-full border border-gray-200 hover:border-gray-400"
          >
            View all applications <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Email instructions if no email configured */}
        {!emailSent && !sendingEmail && (
          <p className="text-xs text-helix-gray-600 mt-4 text-center">
            Email with PDF attachment is sent to your registered email automatically upon submission.
          </p>
        )}
      </div>
    </div>
  );
}
