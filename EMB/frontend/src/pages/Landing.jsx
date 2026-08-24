import { Link } from 'react-router-dom';
import { Mic, FileText, CheckCircle, Zap, MessageSquare, Shield } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#E9EDF6] pt-[67px]">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center px-4 pt-16 pb-12">
        {/* Badge */}
        <div className="bg-white rounded-full px-5 py-2 mb-8 shadow-sm">
          <span className="text-xs font-medium text-helix-gray-700 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-helix-gray-600 rounded-full"></span>
            New Voice-first AI consultant
          </span>
        </div>

        {/* Hero Title */}
        <h1 className="font-inter font-extrabold text-6xl md:text-[80px] leading-tight text-center max-w-[600px]">
          Just <span className="gradient-text">talk</span>. We'll write the requirements.
        </h1>

        {/* Subtitle */}
        <p className="text-lg font-medium text-helix-gray-600 text-center max-w-[637px] mt-8 leading-relaxed">
          Have a 10-minute voice conversation with our AI business consultant. It listens, asks the right follow-ups, and auto-generates a complete requirement document — no forms to fill.
        </p>

        {/* CTA Buttons */}
        <div className="flex items-center gap-4 mt-10">
          <Link
            to="/interview"
            className="flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-[32px] hover:bg-[#0f172a] transition-all hover:scale-105"
          >
            <Mic className="w-4 h-4" />
            Start voice interview
          </Link>
          <Link
            to="/login"
            className="flex items-center gap-2 bg-white text-[#1E293B] font-medium text-sm px-8 py-4 rounded-[32px] border border-gray-200 hover:border-gray-400 transition-all"
          >
            View my applications
          </Link>
        </div>

        {/* Stats */}
        <p className="text-[13px] font-medium text-helix-gray-600 mt-6">
          10 minutes · 12 questions · No signup required for the demo
        </p>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold text-helix-gray-600 tracking-[0.13em] text-center mb-4">
            HOW IT WORKS
          </p>
          <h2 className="text-3xl font-semibold text-center text-black mb-16">
            Three simple steps to your requirements
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center mb-5">
                <MessageSquare className="w-6 h-6 text-helix-purple" />
              </div>
              <h3 className="font-semibold text-lg mb-2">1. Voice Interview</h3>
              <p className="text-sm text-helix-gray-600 leading-relaxed">
                Answer 12 guided questions by speaking naturally. Our AI asks smart follow-ups to capture every detail.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center mb-5">
                <FileText className="w-6 h-6 text-helix-blue" />
              </div>
              <h3 className="font-semibold text-lg mb-2">2. AI Generates Requirements</h3>
              <p className="text-sm text-helix-gray-600 leading-relaxed">
                Our AI extracts and organizes your requirements in real-time. Review, edit, and perfect before submitting.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center mb-5">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <h3 className="font-semibold text-lg mb-2">3. Sign & Submit</h3>
              <p className="text-sm text-helix-gray-600 leading-relaxed">
                Review the complete document, sign digitally, and submit. Get your reference number instantly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 text-center">
        <h2 className="text-[28px] font-semibold text-black mb-3">
          Stop filling forms. Start a conversation.
        </h2>
        <p className="text-sm font-medium text-helix-gray-600 mb-8">
          Your AI consultant is ready when you are.
        </p>
        <Link
          to="/interview"
          className="inline-flex items-center gap-2 bg-[#1E293B] text-white font-medium text-sm px-8 py-4 rounded-[32px] hover:bg-[#0f172a] transition-all hover:scale-105"
        >
          <Mic className="w-4 h-4" />
          Start voice interview
        </Link>
      </section>

      {/* Features Grid */}
      <section className="py-16 px-4 bg-white/50">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-start gap-3 p-6">
            <Zap className="w-5 h-5 text-helix-purple mt-1 flex-shrink-0" />
            <div>
              <h4 className="font-semibold text-sm mb-1">AI-Powered Extraction</h4>
              <p className="text-xs text-helix-gray-600">Real-time requirement extraction as you speak</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-6">
            <Shield className="w-5 h-5 text-helix-blue mt-1 flex-shrink-0" />
            <div>
              <h4 className="font-semibold text-sm mb-1">Secure & Private</h4>
              <p className="text-xs text-helix-gray-600">Your data is encrypted and protected</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-6">
            <FileText className="w-5 h-5 text-green-500 mt-1 flex-shrink-0" />
            <div>
              <h4 className="font-semibold text-sm mb-1">Editable Documents</h4>
              <p className="text-xs text-helix-gray-600">Edit any field before final submission</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

