import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { applicationsAPI } from '../services/api';
import { CheckCircle, Download, Copy, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Submitted() {
  const { id } = useParams();
  const [application, setApplication] = useState(null);

  useEffect(() => {
    fetchApplication();
  }, [id]);

  const fetchApplication = async () => {
    try {
      const res = await applicationsAPI.getOne(id);
      setApplication(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const copyReference = () => {
    if (application?.reference_number) {
      navigator.clipboard.writeText(application.reference_number);
      toast.success('Reference number copied!');
    }
  };

  if (!application) {
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
          to="/dashboard"
          className="flex items-center gap-2 text-sm font-medium text-helix-gray-700 hover:text-black"
        >
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

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-4 mt-8">
          <button className="flex items-center gap-2 bg-helix-navy text-white font-normal text-base px-6 py-3 rounded-full hover:bg-[#0f172a]">
            <Download className="w-4 h-4" /> Download requirement PDF
          </button>
          <Link
            to="/dashboard"
            className="flex items-center gap-2 bg-white text-helix-navy font-normal text-base px-6 py-3 rounded-full border border-gray-200 hover:border-gray-400"
          >
            View all applications <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

