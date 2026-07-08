# 🎙️ Insighta - AI Voice Business Consultant

An AI-powered voice-first business requirements gathering platform. Users have a voice conversation with an AI consultant that asks guided questions, extracts requirements in real-time, and generates a complete requirements document.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│  React 18 + Vite + TailwindCSS + React Router           │
│  Voice Recording (Web Audio API + MediaRecorder)         │
└─────────────────────┬───────────────────────────────────┘
                      │ REST API (HTTP/JSON)
┌─────────────────────▼───────────────────────────────────┐
│                   Backend (FastAPI)                       │
│  Authentication (JWT) │ Interview Engine │ File Upload    │
│  Gemini AI Service │ Requirements Generator              │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              SQLite Database                              │
│  Users │ Applications │ InterviewSessions                 │
└─────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              Google Gemini API                            │
│  Audio Transcription │ NLP Processing │ Summarization    │
└─────────────────────────────────────────────────────────┘
```

## 📋 Features

1. **Voice Interview** - 12 guided questions with AI follow-ups
2. **Real-time Extraction** - Live requirement extraction as you speak
3. **AI-Generated Forms** - Auto-populated requirements document
4. **Editable Requirements** - Edit any field before submission
5. **Document Upload** - Attach supporting documents
6. **Digital Signature** - Sign and approve submissions
7. **User Dashboard** - View/manage all applications
8. **Admin Panel** - Overview of all submissions and users
9. **Text Input Fallback** - Type answers if mic isn't available

## 🚀 Quick Start

### Prerequisites
- Python 3.12+ (with pip)
- Node.js 18+
- Google Gemini API Key

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate   # macOS/Linux
# venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# Start server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

### 3. Access the App

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### Default Admin Account
- Email: `admin@insighta.com`
- Password: `admin123`

## 🔧 Configuration

Edit `backend/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
SECRET_KEY=your_secret_key_here
DATABASE_URL=sqlite:///./insighta.db
```

## 📱 Pages & Flow

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Hero page with CTA |
| Login | `/login` | User authentication |
| Register | `/register` | Account creation |
| Dashboard | `/dashboard` | View applications |
| Interview | `/interview` | Voice interview (12 questions) |
| Requirements | `/requirements/:id` | Editable AI-generated form |
| Documents | `/documents/:id` | File upload |
| Review & Sign | `/review/:id` | Checklist + digital signature |
| Submitted | `/submitted/:id` | Confirmation with reference |
| Admin | `/admin` | Admin dashboard |

## 🗄️ Database Schema

### Users
- id, email, full_name, hashed_password, company, phone, is_admin, created_at

### Applications  
- id, reference_number, user_id, status, project_name, project_type, business_domain
- application_type, target_audience, business_description, problem_statement
- desired_outcomes, key_features, integrations, timeline, budget_range
- tech_preferences, scalability_needs, security_requirements
- ai_summary, requirements_json, signature_data, documents

### InterviewSessions
- id, application_id, question_number, question_text, answer_text, ai_extraction

## 🎨 Design System

Based on Figma designs:
- **Font**: Poppins (body), Inter (headings)
- **Primary Dark**: #1E293B
- **Blue**: #148DD8
- **Purple**: #945AF6
- **Background**: Linear gradient from #E5F1FB to #F2F2FF
- **Border Radius**: 23px (cards), 32px (buttons)

## 📡 API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Applications
- `POST /api/applications` - Create application
- `GET /api/applications` - List user's applications
- `GET /api/applications/:id` - Get single application
- `PUT /api/applications/:id` - Update application
- `POST /api/applications/:id/submit` - Submit application
- `POST /api/applications/:id/upload` - Upload document

### Interview
- `GET /api/interview/questions` - Get all questions
- `POST /api/interview/process-voice` - Process voice recording
- `POST /api/interview/process-text` - Process text answer
- `GET /api/interview/:id/sessions` - Get interview sessions

### Requirements
- `POST /api/requirements/generate` - Generate requirements from interview

### Admin
- `GET /api/admin/stats` - Get admin statistics

## 🛡️ Security
- JWT token-based authentication
- Password hashing with bcrypt
- CORS protection
- Input validation with Pydantic
- Role-based access (user/admin)

