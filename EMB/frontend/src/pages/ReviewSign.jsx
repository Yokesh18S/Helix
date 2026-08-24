import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { applicationsAPI } from '../services/api';
import { ArrowLeft, CheckCircle, Circle, Pen, Send } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ReviewSign() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signerEmail, setSignerEmail] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const canvasRef = useRef(null);
  const [checklist, setChecklist] = useState({
    infoVerified: false,
    requirementsVerified: false,
    documentsUploaded: false,
    aiSummaryReviewed: false,
  });

  useEffect(() => {
    fetchApplication();
  }, [id]);

  useEffect(() => {
    if (user) setSignerEmail(user.email);
  }, [user]);

  const fetchApplication = async () => {
    try {
      const res = await applicationsAPI.getOne(id);
      setApplication(res.data);
    } catch (err) {
      toast.error('Failed to load application');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  // Canvas drawing for signature
  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    setSignatureData(canvas.toDataURL());
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData('');
  };

  const handleSubmit = async () => {
    const allChecked = Object.values(checklist).every(v => v);
    if (!allChecked) {
      toast.error('Please verify all checklist items');
      return;
    }
    if (!signatureData) {
      toast.error('Please provide your signature');
      return;
    }
    if (!signerEmail) {
      toast.error('Please provide your email');
      return;
    }

    setSubmitting(true);
    try {
      // Save signature
      await applicationsAPI.update(id, {
        signature_data: signatureData,
        signer_email: signerEmail
      });
      // Submit
      await applicationsAPI.submit(id);
      toast.success('Application submitted successfully!');
      navigate(`/submitted/${id}`);
    } catch (err) {
      toast.error('Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px] flex items-center justify-center">
        <div className="animate-pulse text-helix-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Link
          to={`/documents/${id}`}
          className="flex items-center gap-2 text-sm font-medium text-helix-gray-700 hover:text-black"
        >
          <ArrowLeft className="w-4 h-4" /> Back to documents
        </Link>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-[#1E293B] text-white text-xs font-medium px-5 py-2 rounded-full hover:bg-[#0f172a] disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <p className="text-xs font-semibold text-helix-blue tracking-[0.24em] text-center mb-2">FINAL STEP</p>
        <h1 className="text-4xl font-semibold text-helix-navy text-center mb-2">
          Sign & approve submission
        </h1>
        <p className="text-base text-helix-gray-700 text-center mb-10">
          Confirm your details, sign digitally, and submit the requirement document.
        </p>

        {/* Checklist */}
        <div className="bg-white rounded-2xl border border-[#DCE5EF] p-6 mb-6">
          <h3 className="font-semibold text-base text-helix-navy mb-4">Review Checklist</h3>
          <div className="space-y-3">
            <ChecklistItem
              label="Information verified"
              checked={checklist.infoVerified}
              onChange={() => setChecklist(prev => ({ ...prev, infoVerified: !prev.infoVerified }))}
            />
            <ChecklistItem
              label="Requirements verified"
              checked={checklist.requirementsVerified}
              onChange={() => setChecklist(prev => ({ ...prev, requirementsVerified: !prev.requirementsVerified }))}
            />
            <ChecklistItem
              label="Documents uploaded"
              checked={checklist.documentsUploaded}
              onChange={() => setChecklist(prev => ({ ...prev, documentsUploaded: !prev.documentsUploaded }))}
            />
            <ChecklistItem
              label="AI summary reviewed"
              checked={checklist.aiSummaryReviewed}
              onChange={() => setChecklist(prev => ({ ...prev, aiSummaryReviewed: !prev.aiSummaryReviewed }))}
            />
          </div>
        </div>

        {/* Signature */}
        <div className="bg-white rounded-2xl border border-[#DCE5EF] p-6 mb-6">
          <h3 className="font-semibold text-base text-helix-navy mb-1">Digital Signature</h3>
          <p className="text-[10px] text-helix-gray-600 mb-4">
            Sign with mouse, trackpad or touchscreen.
          </p>

          <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
            <canvas
              ref={canvasRef}
              width={580}
              height={150}
              className="w-full cursor-crosshair bg-gray-50"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
            />
          </div>
          <button
            onClick={clearSignature}
            className="text-xs text-helix-gray-500 hover:text-red-500"
          >
            Clear signature
          </button>
        </div>

        {/* Email */}
        <div className="bg-white rounded-2xl border border-[#DCE5EF] p-6 mb-8">
          <h3 className="font-semibold text-base text-helix-navy mb-1">Confirmation Email</h3>
          <p className="text-[10px] text-helix-gray-600 mb-4">
            We'll send the signed requirement PDF to this address.
          </p>
          <input
            type="email"
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-helix-blue"
            placeholder="your@email.com"
          />
        </div>

        {/* Submit */}
        <div className="flex justify-center">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 bg-[#1E293B] text-white font-medium text-base px-10 py-4 rounded-full hover:bg-[#0f172a] disabled:opacity-50 transition-all hover:scale-105"
          >
            <Send className="w-4 h-4" />
            {submitting ? 'Submitting...' : 'Submit Requirements'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ label, checked, onChange }) {
  return (
    <button onClick={onChange} className="flex items-center gap-3 w-full text-left">
      {checked ? (
        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
      ) : (
        <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />
      )}
      <span className={`text-sm ${checked ? 'text-black' : 'text-helix-gray-700'}`}>{label}</span>
    </button>
  );
}

