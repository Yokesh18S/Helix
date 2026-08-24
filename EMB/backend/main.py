from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List
import os
import json
import shutil

from database import engine, get_db, Base
from models import User, Application, InterviewSession
from schemas import (
    UserCreate, UserLogin, UserResponse, Token,
    ApplicationCreate, ApplicationUpdate, ApplicationResponse,
    InterviewAnswer, InterviewResponse,
    VoiceProcessRequest, VoiceProcessResponse,
    GenerateRequirementsRequest
)
from auth import (
    get_password_hash, verify_password, create_access_token, get_current_user
)
from gemini_service import (
    INTERVIEW_QUESTIONS, get_question, transcribe_audio,
    process_answer, generate_requirements_summary, generate_follow_up
)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Helix API", description="AI Voice Business Consultant", version="1.0.0")

# CORS - allow all origins in production (served from same origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create uploads directory
os.makedirs("uploads", exist_ok=True)


# ============ AUTH ROUTES ============

@app.post("/api/auth/register", response_model=Token)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    # Check if user exists
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=user_data.email,
        full_name=user_data.full_name,
        hashed_password=get_password_hash(user_data.password),
        company=user_data.company,
        phone=user_data.phone
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(data={"sub": user.id})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@app.post("/api/auth/login", response_model=Token)
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token(data={"sub": user.id})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# ============ APPLICATION ROUTES ============

@app.post("/api/applications", response_model=ApplicationResponse)
def create_application(
    app_data: ApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = Application(
        user_id=current_user.id,
        project_name=app_data.project_name,
        status="draft"
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return ApplicationResponse.model_validate(application)


@app.get("/api/applications", response_model=List[ApplicationResponse])
def get_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Filter out empty drafts (applications with no questions answered)
    # Only show apps that have at least some progress
    if current_user.is_admin:
        applications = db.query(Application).filter(
            (Application.status != "draft") | (Application.total_requirements_captured > 0)
        ).order_by(Application.created_at.desc()).all()
    else:
        applications = db.query(Application).filter(
            Application.user_id == current_user.id,
            (Application.status != "draft") | (Application.total_requirements_captured > 0)
        ).order_by(Application.created_at.desc()).all()
    return [ApplicationResponse.model_validate(a) for a in applications]


@app.get("/api/applications/{app_id}", response_model=ApplicationResponse)
def get_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    return ApplicationResponse.model_validate(application)


@app.put("/api/applications/{app_id}", response_model=ApplicationResponse)
def update_application(
    app_id: int,
    app_data: ApplicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    update_data = app_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            setattr(application, key, value)

    application.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(application)
    return ApplicationResponse.model_validate(application)


@app.post("/api/applications/{app_id}/submit", response_model=ApplicationResponse)
def submit_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    application.status = "submitted"
    application.submitted_at = datetime.utcnow()
    db.commit()
    db.refresh(application)
    return ApplicationResponse.model_validate(application)


@app.delete("/api/applications/{app_id}")
def delete_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    # Admin can delete anything; users can only delete their own drafts
    is_own_draft = (application.user_id == current_user.id and application.status == "draft")
    if not current_user.is_admin and not is_own_draft:
        raise HTTPException(status_code=403, detail="Not authorized to delete this application")

    # Delete related interview sessions first
    db.query(InterviewSession).filter(InterviewSession.application_id == app_id).delete()
    db.delete(application)
    db.commit()
    return {"message": "Application deleted successfully", "id": app_id}


# ============ INTERVIEW ROUTES ============

@app.get("/api/interview/questions")
def get_interview_questions():
    return {"questions": INTERVIEW_QUESTIONS, "total": len(INTERVIEW_QUESTIONS)}


@app.post("/api/interview/process-voice", response_model=VoiceProcessResponse)
async def process_voice(
    request: VoiceProcessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Transcribe audio
    transcribed_text = await transcribe_audio(request.audio_base64)

    # Get previous answers for context
    prev_sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == request.application_id
    ).order_by(InterviewSession.question_number).all()

    previous_answers = [
        {"q": s.question_number, "answer": s.answer_text}
        for s in prev_sessions if s.answer_text
    ]

    # Process with AI
    result = await process_answer(request.question_number, transcribed_text, previous_answers)

    # Save interview session
    question = get_question(request.question_number)
    session = InterviewSession(
        application_id=request.application_id,
        question_number=request.question_number,
        question_text=question["text"],
        answer_text=transcribed_text,
        ai_extraction=result.get("extraction")
    )
    db.add(session)

    # Update application with extracted requirements count
    application = db.query(Application).filter(Application.id == request.application_id).first()
    if application:
        total_answered = len(prev_sessions) + 1
        application.total_requirements_captured = total_answered
        # Only promote from draft to in_progress after 4+ questions answered
        if total_answered >= 4:
            application.status = "in_progress"

    db.commit()

    # Get next question
    next_q = get_question(request.question_number + 1)
    next_question_text = next_q["text"] if next_q else None

    # Generate follow-up if needed
    follow_up = await generate_follow_up(request.question_number, transcribed_text)

    return VoiceProcessResponse(
        transcribed_text=transcribed_text,
        ai_extraction=result.get("extraction"),
        next_question=next_question_text,
        follow_up=follow_up
    )


@app.post("/api/interview/process-text", response_model=VoiceProcessResponse)
async def process_text_answer(
    request: InterviewAnswer,
    application_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Process a text-based answer (for typing instead of voice)"""
    prev_sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == application_id
    ).order_by(InterviewSession.question_number).all()

    previous_answers = [
        {"q": s.question_number, "answer": s.answer_text}
        for s in prev_sessions if s.answer_text
    ]

    result = await process_answer(request.question_number, request.answer_text, previous_answers)

    question = get_question(request.question_number)
    session = InterviewSession(
        application_id=application_id,
        question_number=request.question_number,
        question_text=question["text"],
        answer_text=request.answer_text,
        ai_extraction=result.get("extraction")
    )
    db.add(session)

    application = db.query(Application).filter(Application.id == application_id).first()
    if application:
        total_answered = len(prev_sessions) + 1
        application.total_requirements_captured = total_answered
        # Only promote from draft to in_progress after 4+ questions answered
        if total_answered >= 4:
            application.status = "in_progress"

    db.commit()

    next_q = get_question(request.question_number + 1)
    next_question_text = next_q["text"] if next_q else None
    follow_up = await generate_follow_up(request.question_number, request.answer_text)

    return VoiceProcessResponse(
        transcribed_text=request.answer_text,
        ai_extraction=result.get("extraction"),
        next_question=next_question_text,
        follow_up=follow_up
    )


@app.get("/api/interview/{app_id}/sessions", response_model=List[InterviewResponse])
def get_interview_sessions(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id
    ).order_by(InterviewSession.question_number).all()
    return [InterviewResponse.model_validate(s) for s in sessions]


# ============ REQUIREMENTS GENERATION ============

@app.post("/api/requirements/generate", response_model=ApplicationResponse)
async def generate_requirements(
    request: GenerateRequirementsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = db.query(Application).filter(Application.id == request.application_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Get all interview sessions
    sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == request.application_id
    ).order_by(InterviewSession.question_number).all()

    interview_data = {
        "answers": [
            {
                "question": s.question_text,
                "answer": s.answer_text,
                "extraction": s.ai_extraction
            }
            for s in sessions
        ]
    }

    # Generate requirements summary
    summary = await generate_requirements_summary(interview_data)

    # Helper to convert lists to comma-separated strings for text fields
    def to_str(val):
        if val is None:
            return ""
        if isinstance(val, list):
            return ", ".join(str(v) for v in val)
        return str(val)

    # Update application
    application.ai_summary = to_str(summary.get("ai_summary", ""))
    application.project_name = to_str(summary.get("project_name", "")) or application.project_name
    application.project_type = to_str(summary.get("project_type", ""))
    application.business_domain = to_str(summary.get("business_domain", ""))
    application.application_type = to_str(summary.get("application_type", ""))
    application.target_audience = to_str(summary.get("target_audience", ""))
    application.key_features = to_str(summary.get("key_features", ""))
    application.requirements_json = summary
    application.total_requirements_captured = summary.get("total_requirements", len(sessions))
    application.status = "in_progress"
    application.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(application)
    return ApplicationResponse.model_validate(application)


# ============ FILE UPLOAD ============

@app.post("/api/applications/{app_id}/upload")
async def upload_document(
    app_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Save file
    upload_dir = f"uploads/{app_id}"
    os.makedirs(upload_dir, exist_ok=True)
    file_path = f"{upload_dir}/{file.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Update application documents list
    docs = application.documents or []
    docs.append(file.filename)
    application.documents = docs
    application.updated_at = datetime.utcnow()
    db.commit()

    return {"filename": file.filename, "message": "File uploaded successfully"}


# ============ ADMIN ROUTES ============

@app.get("/api/admin/stats")
def get_admin_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    total_apps = db.query(Application).count()
    submitted = db.query(Application).filter(Application.status == "submitted").count()
    in_progress = db.query(Application).filter(Application.status == "in_progress").count()
    total_users = db.query(User).count()

    return {
        "total_applications": total_apps,
        "submitted": submitted,
        "in_progress": in_progress,
        "total_users": total_users
    }


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "Helix API", "version": "1.0.0"}


# ============ SERVE FRONTEND (Production) ============
# Serve React static files if the 'static' directory exists (Docker build)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

if os.path.isdir(STATIC_DIR):
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    # Catch-all: serve index.html for any non-API route (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If it's a file that exists in static dir, serve it
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html (React Router handles routing)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

