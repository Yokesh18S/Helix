from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import os
import json
import shutil
import uuid
import random

from database import engine, get_db, Base
from models import User, Application, InterviewSession
from schemas import (
    UserCreate, UserLogin, UserResponse, Token,
    ApplicationCreate, ApplicationUpdate, ApplicationResponse,
    InterviewAnswer, InterviewResponse,
    VoiceProcessRequest, VoiceProcessResponse,
    GenerateRequirementsRequest, AuthVoiceNlpRequest, AuthVoiceNlpResponse,
    ClaimGuestSessionRequest, ClaimGuestSessionResponse,
    OtpInitiateRequest, OtpInitiateResponse, OtpVerifyRequest
)
from auth import (
    get_password_hash, verify_password, create_access_token, get_current_user
)
from gemini_service import (
    transcribe_audio, extract_requirements, generate_question,
    generate_requirements_summary, process_auth_voice_nlp
)
from interview_engine import (
    create_graph, update_graph, detect_contradictions,
    calculate_coverage, get_next_question_fields, get_opening_question,
    get_graph_summary_for_prompt, format_qa_history,
    FIELD_LABELS, INDUSTRY_PACKS
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
    # Check if email is already registered
    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Check if phone number is already registered
    if user_data.phone:
        existing_phone = db.query(User).filter(User.phone == user_data.phone).first()
        if existing_phone:
            raise HTTPException(status_code=409, detail="Phone number is already registered")

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
    user = db.query(User).filter(User.phone == user_data.phone).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with that phone number.")
    if not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="The password is incorrect.")

    access_token = create_access_token(data={"sub": user.id})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@app.post("/api/auth/otp/initiate", response_model=OtpInitiateResponse)
def initiate_otp(request_data: OtpInitiateRequest, db: Session = Depends(get_db)):
    phone = request_data.phone.strip()
    name = request_data.name.strip() if request_data.name else None
    
    # Check if user with that phone number exists
    user = db.query(User).filter(User.phone == phone).first()
    is_new = False
    
    if not user:
        is_new = True
        # Create a new user profile
        email_str = f"{phone}@helix.ai"
        user = User(
            email=email_str,
            full_name=name or "New User",
            phone=phone,
            hashed_password=get_password_hash(str(uuid.uuid4())),
            company="Helix Guest"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif name and (not user.full_name or user.full_name == "New User"):
        # Update name if it was a default placeholder
        user.full_name = name
        db.commit()
        db.refresh(user)

    # Generate 6-digit OTP
    otp = str(random.randint(100000, 999999))
    user.otp_code = otp
    user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    db.commit()
    
    print(f"\n==========================================")
    print(f" OTP GENERATED FOR {phone}: {otp}")
    print(f"==========================================\n")
    
    return OtpInitiateResponse(
        status="success",
        message="OTP initiated successfully",
        is_new=is_new,
        simulated_otp=otp
    )


@app.post("/api/auth/otp/verify", response_model=Token)
def verify_otp(request_data: OtpVerifyRequest, db: Session = Depends(get_db)):
    phone = request_data.phone.strip()
    otp_code = request_data.otp_code.strip()
    
    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        raise HTTPException(status_code=404, detail="No profile found with that phone number.")
        
    if not user.otp_code or user.otp_code != otp_code:
        raise HTTPException(status_code=400, detail="Invalid OTP code.")
        
    if not user.otp_expiry or user.otp_expiry < datetime.utcnow():
        raise HTTPException(status_code=400, detail="OTP code has expired.")
        
    # OTP is correct and valid, verify & clean up
    user.otp_code = None
    user.otp_expiry = None
    db.commit()
    db.refresh(user)
    
    access_token = create_access_token(data={"sub": user.id})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@app.post("/api/auth/voice-nlp", response_model=AuthVoiceNlpResponse)
async def process_auth_voice_transcript(request: AuthVoiceNlpRequest):
    """Process user voice input during signin/signup using Gemini NLU/NLG"""
    result = await process_auth_voice_nlp(
        flow=request.flow,
        current_step=request.current_step,
        user_transcript=request.user_transcript,
        form_data=request.form_data,
        retry_count=request.retry_count
    )

    if not result:
        # Backend fallback to avoid crashing if Gemini fails
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini voice processing failed"
        )

    return AuthVoiceNlpResponse(
        parsed_value=result.get("parsed_value"),
        command=result.get("command"),
        ai_response=result.get("ai_response", ""),
        should_confirm=result.get("should_confirm", False)
    )


# ============ APPLICATION ROUTES ============

@app.post("/api/applications", response_model=ApplicationResponse)
def create_application(
    app_data: ApplicationCreate,
    db: Session = Depends(get_db),
    request: Request = None,
):
    # Try to get authenticated user (optional for guest mode)
    current_user = None
    auth_header = request.headers.get("Authorization") if request else None
    if auth_header and auth_header.startswith("Bearer "):
        try:
            from auth import get_current_user as _get_current_user
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    if current_user:
        # Authenticated user
        application = Application(
            user_id=current_user.id,
            project_name=app_data.project_name,
            status="draft",
            is_guest=False,
        )
    else:
        # Guest mode — require guest_token
        if not app_data.guest_token:
            raise HTTPException(status_code=400, detail="guest_token required for unauthenticated access")
        application = Application(
            user_id=None,
            guest_token=app_data.guest_token,
            project_name=app_data.project_name,
            status="draft",
            is_guest=True,
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


# ============ INTERVIEW ROUTES (Adaptive Engine) ============

# Helper: shared logic for processing an answer through the engine
async def _process_answer_through_engine(
    application: Application,
    answer_text: str,
    db: Session
) -> VoiceProcessResponse:
    """
    Core adaptive interview logic. Used by both voice and text endpoints.
    1. Load/create requirement graph
    2. Get unanswered current session
    3. Extract requirements from answer via Gemini using stored question_text
    4. Update graph
    5. Detect contradictions
    6. Calculate coverage (including categorization)
    7. Save current session answer and extraction
    8. Decide next question or completion
    9. Generate next question via Gemini (if not complete) and save as unanswered session
    """
    # Load or create requirement graph
    graph = application.requirements_json or create_graph()
    if not isinstance(graph, dict) or "business_goal" not in graph:
        graph = create_graph()

    # Get all interview sessions
    sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == application.id
    ).order_by(InterviewSession.question_number).all()

    # Find the current unanswered session
    current_session = None
    answered_sessions = []
    for s in sessions:
        if s.answer_text is None:
            current_session = s
        else:
            answered_sessions.append(s)

    # Fallback if no unanswered session exists
    if not current_session:
        if sessions:
            current_session = sessions[-1]
            if current_session.answer_text is not None:
                current_session = InterviewSession(
                    application_id=application.id,
                    question_number=len(sessions) + 1,
                    question_text=get_opening_question(),
                    answer_text=None,
                    ai_extraction=None
                )
                db.add(current_session)
                db.commit()
                # Re-query sessions
                sessions = db.query(InterviewSession).filter(
                    InterviewSession.application_id == application.id
                ).order_by(InterviewSession.question_number).all()
        else:
            current_session = InterviewSession(
                application_id=application.id,
                question_number=1,
                question_text=get_opening_question(),
                answer_text=None,
                ai_extraction=None
            )
            db.add(current_session)
            db.commit()

    # Prepare Q&A history from truly answered sessions (excluding the current one)
    qa_history = [
        {"q": s.question_number, "question": s.question_text, "answer": s.answer_text}
        for s in sessions if s.answer_text is not None and s.id != current_session.id
    ]

    current_q_number = current_session.question_number
    last_question_text = current_session.question_text

    # Step 1: Extract requirements from answer using the EXACT question that was asked
    graph_summary = get_graph_summary_for_prompt(graph)
    extraction = await extract_requirements(answer_text, last_question_text, graph_summary)

    # Step 2: Update requirement graph
    graph = update_graph(graph, extraction)

    # Step 3: Detect contradictions
    contradiction = detect_contradictions(graph, extraction, qa_history)

    # Step 4: Calculate coverage
    coverage = calculate_coverage(graph)

    # Step 5: Save the current session
    current_session.answer_text = answer_text
    current_session.ai_extraction = extraction

    # Step 6: Update application
    application.requirements_json = graph
    application.total_requirements_captured = len(coverage.get("collected_fields", []))
    if coverage["overall_percent"] >= 30:
        application.status = "in_progress"

    # Step 7: Decide next question or completion
    next_fields = get_next_question_fields(graph, coverage, current_q_number)
    interview_complete = next_fields is None

    next_question_text = None
    acknowledgement = None
    reasoning = None
    targeted_fields = None

    if not interview_complete:
        # Step 8: Generate the next dynamic question
        industry = graph.get("industry")
        industry_pack = INDUSTRY_PACKS.get(industry) if industry else None
        
        # QA history including the answer we just saved
        qa_history_with_current = qa_history + [
            {"q": current_q_number, "question": last_question_text, "answer": answer_text}
        ]
        qa_history_str = format_qa_history(qa_history_with_current)

        gen_result = await generate_question(
            missing_fields=next_fields,
            field_labels=FIELD_LABELS,
            graph_summary=get_graph_summary_for_prompt(graph),
            qa_history=qa_history_str,
            industry=industry,
            industry_pack=industry_pack,
            missing_critical=coverage.get("missing_critical"),
            missing_important=coverage.get("missing_important"),
            missing_optional=coverage.get("missing_optional")
        )
        raw_question = gen_result.get("question", "Could you tell me more?")
        acknowledgement = gen_result.get("acknowledgement", "Thanks.")
        if acknowledgement:
            next_question_text = f"{acknowledgement} {raw_question}"
        else:
            next_question_text = raw_question
        reasoning = gen_result.get("reasoning")
        targeted_fields = gen_result.get("targeted_fields")
        language_code = gen_result.get("language_code", "en-US")

        # Step 9: Save the NEXT question as an unanswered session record
        next_session = InterviewSession(
            application_id=application.id,
            question_number=current_q_number + 1,
            question_text=next_question_text,
            answer_text=None,
            ai_extraction=None
        )
        db.add(next_session)
    else:
        acknowledgement = "Excellent! I now have a thorough understanding of your project."
        language_code = "en-US"

    db.commit()

    return VoiceProcessResponse(
        transcribed_text=answer_text,
        ai_extraction=extraction,
        next_question=next_question_text,
        acknowledgement=acknowledgement,
        interview_complete=interview_complete,
        coverage=coverage,
        contradiction=contradiction,
        question_number=current_q_number,
        reasoning=reasoning,
        targeted_fields=targeted_fields,
        language_code=language_code
    )


@app.post("/api/interview/first-question")
def get_first_question(
    application_id: int,
    req: Request,
    db: Session = Depends(get_db),
    guest_token: Optional[str] = None,
):
    """Return the opening question or resume current active question without resetting."""
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Check if there are already sessions
    existing_sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == application_id
    ).order_by(InterviewSession.question_number).all()

    if existing_sessions:
        # Find the unanswered session
        current_session = None
        for s in existing_sessions:
            if s.answer_text is None:
                current_session = s
                break
        
        if not current_session:
            # Fallback if all are answered (should not happen normally unless done)
            graph = application.requirements_json or create_graph()
            coverage = calculate_coverage(graph)
            return {
                "question": "Excellent! The interview is complete. To register or sign in and view your requirements, please enter the 6-digit OTP code sent to your phone number.",
                "question_number": len(existing_sessions),
                "coverage": coverage,
                "interview_complete": True,
                "language_code": "en-US"
            }
        
        coverage = calculate_coverage(application.requirements_json or create_graph())
        return {
            "question": current_session.question_text,
            "question_number": current_session.question_number,
            "coverage": coverage,
            "language_code": "en-US"
        }

    # Initialize a new requirement graph
    graph = create_graph()
    application.requirements_json = graph

    opening = get_opening_question()
    coverage = calculate_coverage(graph)

    # Save the first question as an unanswered session record
    first_session = InterviewSession(
        application_id=application_id,
        question_number=1,
        question_text=opening,
        answer_text=None,
        ai_extraction=None
    )
    db.add(first_session)
    db.commit()

    return {
        "question": opening,
        "question_number": 1,
        "coverage": coverage,
        "language_code": "en-US"
    }


@app.post("/api/interview/process-voice", response_model=VoiceProcessResponse)
async def process_voice(
    request: VoiceProcessRequest,
    req: Request,
    db: Session = Depends(get_db),
):
    # Resolve user: authenticated OR guest
    current_user = None
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    # Verify application ownership
    application = db.query(Application).filter(Application.id == request.application_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if current_user and application.user_id and application.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if application.is_guest and request.guest_token and application.guest_token != request.guest_token:
        raise HTTPException(status_code=403, detail="Invalid guest token")

    # Transcribe audio
    transcribed_text = await transcribe_audio(request.audio_base64)
    if not transcribed_text or transcribed_text.startswith("["):
        return VoiceProcessResponse(
            transcribed_text=transcribed_text or "",
            interview_complete=False,
            question_number=0
        )

    # Process through adaptive engine
    return await _process_answer_through_engine(application, transcribed_text, db)


@app.post("/api/interview/process-text", response_model=VoiceProcessResponse)
async def process_text_answer(
    request: InterviewAnswer,
    application_id: int,
    req: Request,
    db: Session = Depends(get_db),
    guest_token: Optional[str] = None,
):
    """Process a text-based answer through the adaptive interview engine."""
    # Resolve user
    current_user = None
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    # Verify ownership
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if current_user and application.user_id and application.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if application.is_guest and guest_token and application.guest_token != guest_token:
        raise HTTPException(status_code=403, detail="Invalid guest token")

    # Process through adaptive engine
    return await _process_answer_through_engine(application, request.answer_text, db)




# ============ GUEST SESSION CLAIM ============

@app.post("/api/interview/claim", response_model=ClaimGuestSessionResponse)
def claim_guest_session(
    data: ClaimGuestSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """After sign-in/register, transfer a guest application to the authenticated user."""
    application = db.query(Application).filter(
        Application.guest_token == data.guest_token,
        Application.is_guest == True
    ).first()

    if not application:
        raise HTTPException(status_code=404, detail="Guest session not found or already claimed")

    # Transfer ownership
    application.user_id = current_user.id
    application.is_guest = False
    application.guest_token = None  # clear the token
    db.commit()
    db.refresh(application)

    return ClaimGuestSessionResponse(
        application_id=application.id,
        message="Interview session successfully linked to your account"
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
    req: Request,
    db: Session = Depends(get_db),
):
    # Resolve user (optional for guest)
    current_user = None
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    application = db.query(Application).filter(Application.id == request.application_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Verify ownership
    if current_user and application.user_id and application.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if application.is_guest and request.guest_token and application.guest_token != request.guest_token:
        raise HTTPException(status_code=403, detail="Invalid guest token")

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

