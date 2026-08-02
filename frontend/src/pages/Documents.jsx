import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { applicationsAPI } from '../services/api';
import { ArrowLeft, ArrowRight, Upload, File, X, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGlobalHandsFreeVoice } from '../hooks/useGlobalHandsFreeVoice';

export default function Documents() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [application, setApplication] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);

  useGlobalHandsFreeVoice({
    'continue': () => navigate(`/review/${id}`),
    'next': () => navigate(`/review/${id}`),
    'proceed': () => navigate(`/review/${id}`),
    'back': () => navigate(`/requirements/${id}`),
    'requirements': () => navigate(`/requirements/${id}`),
    'go back': () => navigate(`/requirements/${id}`)
  });

  useEffect(() => {
    fetchApplication();
  }, [id]);

  const fetchApplication = async () => {
    try {
      const res = await applicationsAPI.getOne(id);
      setApplication(res.data);
      setFiles(res.data.documents || []);
    } catch (err) {
      toast.error('Failed to load application');
      navigate('/dashboard');
    }
  };

  const handleUpload = async (e) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles.length) return;

    setUploading(true);
    for (let file of selectedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        await applicationsAPI.upload(id, formData);
        setFiles(prev => [...prev, file.name]);
        toast.success(`${file.name} uploaded`);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles.length) return;

    setUploading(true);
    for (let file of droppedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        await applicationsAPI.upload(id, formData);
        setFiles(prev => [...prev, file.name]);
        toast.success(`${file.name} uploaded`);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#E5F1FB] to-[#F2F2FF] pt-[67px]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Link
          to={`/requirements/${id}`}
          className="flex items-center gap-2 text-sm font-medium text-helix-gray-700 hover:text-black"
        >
          <ArrowLeft className="w-4 h-4" /> Back to requirements
        </Link>
        <button
          onClick={() => navigate(`/review/${id}`)}
          className="bg-[#1E293B] text-white text-xs font-medium px-5 py-2 rounded-full hover:bg-[#0f172a]"
        >
          Continue
        </button>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="w-72 p-6">
          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
            <StepItem number="01" label="Welcome" done />
            <StepItem number="02" label="Voice interview" done />
            <StepItem number="03" label="Requirements" done />
            <StepItem number="04" label="Documents" active />
            <StepItem number="05" label="AI summary" />
            <StepItem number="06" label="Review" />
            <StepItem number="07" label="Sign & submit" />
          </div>

          <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5 mt-4">
            <h4 className="text-xs font-semibold mb-1">Need help?</h4>
            <p className="text-xs text-helix-gray-600 leading-relaxed">
              Our AI guides you step by step. You can edit anything before submitting.
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-8">
          <h1 className="text-3xl font-semibold text-helix-navy mb-2">Upload Documents</h1>
          <p className="text-sm text-helix-gray-700 mb-8">
            Upload any supporting documents for your project requirements.
          </p>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
              <p className="text-xs text-helix-gray-600 mb-1">Project</p>
              <p className="text-sm font-semibold text-helix-navy truncate">{application?.project_name || 'Untitled'}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
              <p className="text-xs text-helix-gray-600 mb-1">Requirements</p>
              <p className="text-sm font-semibold text-helix-navy">{application?.total_requirements_captured || 0} captured</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#DCE5EF] p-5">
              <p className="text-xs text-helix-gray-600 mb-1">Documents</p>
              <p className="text-sm font-semibold text-helix-navy">{files.length} uploaded</p>
            </div>
          </div>

          {/* Upload Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="bg-white border-2 border-dashed border-[#AFD2F1] rounded-3xl p-12 text-center hover:border-helix-blue transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-helix-gray-500 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-helix-navy mb-2">
              Drag & drop files, or click to browse
            </h3>
            <p className="text-[13px] text-helix-gray-600">
              PDF · DOCX · XLSX · JPG · PNG · MP4 · MOV · up to 50MB each
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUpload}
              accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.mp4,.mov"
            />
          </div>

          {uploading && (
            <p className="text-sm text-helix-blue mt-4 text-center">Uploading...</p>
          )}

          {/* Uploaded Files */}
          {files.length > 0 && (
            <div className="mt-6 space-y-2">
              <h4 className="text-xs font-semibold text-helix-gray-700 mb-3">Uploaded files</h4>
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
                  <File className="w-4 h-4 text-helix-blue" />
                  <span className="text-sm text-helix-gray-700 flex-1">{file}</span>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
              ))}
            </div>
          )}

          {/* Continue */}
          <div className="flex justify-end mt-10">
            <button
              onClick={() => navigate(`/review/${id}`)}
              className="flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-full hover:bg-[#0f172a]"
            >
              Continue to Review <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepItem({ number, label, done, active }) {
  return (
    <div className={`flex items-center gap-3 py-2 ${active ? 'bg-white rounded-xl px-2' : ''}`}>
      <span className={`text-[10px] font-semibold ${done ? 'text-green-500' : active ? 'text-helix-blue' : 'text-helix-gray-600'}`}>
        {done ? '✓' : number}
      </span>
      <span className={`text-sm ${active ? 'font-medium text-black' : 'text-helix-gray-700'}`}>
        {label}
      </span>
    </div>
  );
}

