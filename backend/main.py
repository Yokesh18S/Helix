from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
import io
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
    OtpInitiateRequest, OtpInitiateResponse, OtpVerifyRequest,
    ParseProfileRequest
)
from auth import (
    get_password_hash, verify_password, create_access_token, get_current_user
)
from gemini_service import (
    transcribe_audio, extract_requirements, generate_question,
    generate_requirements_summary, process_auth_voice_nlp,
    parse_profile_information
)
from interview_engine import (
    create_graph, update_graph, detect_contradictions,
    calculate_coverage, get_next_question_fields, get_opening_question,
    get_graph_summary_for_prompt, format_qa_history,
    FIELD_LABELS, INDUSTRY_PACKS
)
from multilingual_nlp import analyze_language_and_nlp
from pdf_service import generate_pdf_for_application, generate_application_pdf
from email_service import send_requirements_email

# Create tables
Base.metadata.create_all(bind=engine)

# Auto-migrate missing columns for SQLite DB
try:
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "applications" in inspector.get_table_names():
        existing_cols = [c["name"] for c in inspector.get_columns("applications")]
        with engine.connect() as conn:
            if "business_canvas" not in existing_cols:
                conn.execute(text("ALTER TABLE applications ADD COLUMN business_canvas JSON"))
                print("DB Migration: Added business_canvas column")
            if "budget_planner" not in existing_cols:
                conn.execute(text("ALTER TABLE applications ADD COLUMN budget_planner JSON"))
                print("DB Migration: Added budget_planner column")
            if "contact_email" not in existing_cols:
                conn.execute(text("ALTER TABLE applications ADD COLUMN contact_email VARCHAR(255)"))
                print("DB Migration: Added contact_email column")
            conn.commit()
except Exception as e:
    print(f"DB Migration Notice: {e}")

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
    if current_user.is_admin:
        applications = db.query(Application).order_by(Application.created_at.desc()).all()
    else:
        applications = db.query(Application).filter(
            Application.user_id == current_user.id
        ).order_by(Application.created_at.desc()).all()
    return [ApplicationResponse.model_validate(a) for a in applications]


@app.get("/api/applications/{app_id}", response_model=ApplicationResponse)
def get_application(
    app_id: int,
    req: Request,
    db: Session = Depends(get_db),
    guest_token: Optional[str] = None,
):
    current_user = None
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    if current_user:
        if application.user_id == current_user.id or current_user.is_admin:
            return ApplicationResponse.model_validate(application)
        if application.is_guest or application.user_id is None or (guest_token and application.guest_token == guest_token):
            application.user_id = current_user.id
            application.is_guest = False
            db.commit()
            db.refresh(application)
            return ApplicationResponse.model_validate(application)

    if guest_token and application.guest_token == guest_token:
        return ApplicationResponse.model_validate(application)

    raise HTTPException(status_code=403, detail="Not authorized")


@app.put("/api/applications/{app_id}", response_model=ApplicationResponse)
def update_application(
    app_id: int,
    app_data: ApplicationUpdate,
    req: Request,
    db: Session = Depends(get_db),
    guest_token: Optional[str] = None,
):
    current_user = None
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    authorized = False
    if current_user:
        if application.user_id == current_user.id or current_user.is_admin:
            authorized = True
        elif application.is_guest or application.user_id is None:
            application.user_id = current_user.id
            application.is_guest = False
            authorized = True
    elif guest_token and application.guest_token == guest_token:
        authorized = True

    if not authorized:
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
def validate_and_normalize_phone(phone_str: str) -> Optional[str]:
    import re
    # Extract digits only
    digits = re.sub(r'\D', '', phone_str)
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) == 10:
        return digits
    return None

def validate_name(name_str: str) -> Optional[str]:
    import re
    if not name_str:
        return None
    name_str = name_str.strip()
    name_str = re.sub(r'^["\']|["\']$', '', name_str).strip()
    if len(name_str) > 100 or len(name_str) < 2:
        return None
    return name_str

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
    # Check if this answer is a correction of name or phone
    curr_name = (application.language_context or {}).get("captured_name", "")
    curr_phone = (application.language_context or {}).get("captured_phone", "")
    
    profile_check = await parse_profile_information(
        user_transcript=answer_text,
        current_phase="questions",
        current_name=curr_name,
        current_phone=curr_phone
    )
    
    if profile_check.get("is_correction"):
        corrected_field = profile_check.get("corrected_field")
        new_name = profile_check.get("name")
        new_phone = profile_check.get("phone")
        
        updated_name = None
        updated_phone = None
        
        user = None
        if application.user:
            user = application.user
        elif curr_phone:
            user = db.query(User).filter(User.phone == curr_phone).first()
            
        if user:
            if new_name and user.full_name != new_name:
                user.full_name = new_name
                updated_name = new_name
            if new_phone and user.phone != new_phone:
                user.phone = new_phone
                updated_phone = new_phone
            db.commit()
            db.refresh(user)
        else:
            if new_name:
                updated_name = new_name
            if new_phone:
                updated_phone = new_phone
                
        # Update our cached profile in language_context
        lang_context = application.language_context or {}
        if updated_name:
            lang_context["captured_name"] = updated_name
        elif new_name:
            lang_context["captured_name"] = new_name
            
        if updated_phone:
            lang_context["captured_phone"] = updated_phone
        elif new_phone:
            lang_context["captured_phone"] = new_phone
            
        application.language_context = lang_context
        db.commit()
        
        # Determine the acknowledgement response
        ack = ""
        resolved_name = updated_name or new_name or curr_name
        resolved_phone = updated_phone or new_phone or curr_phone
        if corrected_field == "name":
            ack = f"Got it, I've updated your name to {resolved_name}."
        elif corrected_field == "phone":
            ack = f"Got it, I've updated your phone number to {resolved_phone}."
        elif corrected_field == "both":
            ack = f"Got it, I've updated your name to {resolved_name} and phone number to {resolved_phone}."
        else:
            ack = "Got it, I've updated your information."
            
        # Get the current question text to replay
        sessions = db.query(InterviewSession).filter(
            InterviewSession.application_id == application.id
        ).order_by(InterviewSession.question_number).all()
        current_session = None
        for s in sessions:
            if s.answer_text is None:
                current_session = s
                break
        current_q_text = current_session.question_text if current_session else "Could you tell me more about the business?"
        current_q_num = current_session.question_number if current_session else 1
        
        coverage = calculate_coverage(application.requirements_json or create_graph())
        
        return VoiceProcessResponse(
            transcribed_text=answer_text,
            next_question=current_q_text,
            acknowledgement=ack,
            interview_complete=False,
            coverage=coverage,
            question_number=current_q_num,
            is_correction=True,
            updated_name=resolved_name,
            updated_phone=resolved_phone
        )

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

    # Multilingual NLP Engine: Language Identification, Lock Enforcement, Intent & Sentiment
    prev_lang_context = application.language_context or {}
    lang_context = await analyze_language_and_nlp(answer_text, current_context=prev_lang_context)
    application.language_context = lang_context

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
    # Extract email if mentioned in transcript
    import re
    email_match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', answer_text)
    if email_match:
        application.contact_email = email_match.group(0)

    # Step 7: Decide next question or completion (Hard cap at 10 questions)
    if current_q_number >= 10:
        interview_complete = True
        next_fields = None
    else:
        next_fields = get_next_question_fields(graph, coverage, current_q_number)
        interview_complete = next_fields is None

    next_question_text = None
    acknowledgement = None
    reasoning = None
    targeted_fields = None

    if not interview_complete:
        # Step 8: Generate the next dynamic question in user's locked language
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
            missing_optional=coverage.get("missing_optional"),
            language_context=lang_context
        )
        raw_question = gen_result.get("question", "Could you tell me more?")
        acknowledgement = gen_result.get("acknowledgement", "Thanks.")
        # Send raw_question and acknowledgement separately — frontend handles display & TTS ordering
        next_question_text = raw_question
        reasoning = gen_result.get("reasoning")
        targeted_fields = gen_result.get("targeted_fields")
        language_code = gen_result.get("language_code", lang_context.get("language_code", "en-US"))

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
        locked_lang = lang_context.get("locked_language", "English")
        if locked_lang == "Tanglish":
            acknowledgement = "Super! Naan unga project requirements ellam purinjikitenaa."
        elif locked_lang == "Manglish":
            acknowledgement = "Super! Njangal ningalude project requirements ellam manassilakki."
        elif locked_lang == "Hinglish":
            acknowledgement = "Bahut accha! Mujhe aapke saare project requirements samajh aa gaye hain."
        elif locked_lang == "Tenglish":
            acknowledgement = "Super! Naaku me project requirements anni artham ayyayi."
        elif locked_lang == "Kanglish":
            acknowledgement = "Thumbanalla! Nanage nimma project requirements ellavu artha aayitu."
        else:
            acknowledgement = "Excellent! I now have a thorough understanding of your project."
        language_code = lang_context.get("language_code", "en-US")

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
        language_code=language_code,
        language_context=lang_context
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

    captured_name = (application.language_context or {}).get("captured_name", "")
    if not captured_name and application.user and application.user.full_name:
        captured_name = application.user.full_name
    opening = get_opening_question(captured_name)
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

    # Transcribe audio with language context hint
    transcribed_text = await transcribe_audio(
        request.audio_base64,
        language_context=application.language_context
    )
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


@app.post("/api/interview/parse-profile", response_model=VoiceProcessResponse)
async def parse_profile(
    request: ParseProfileRequest,
    db: Session = Depends(get_db)
):
    user_transcript = request.user_transcript.strip()
    current_phase = request.current_phase
    current_name = request.current_name or ""
    current_phone = request.current_phone or ""
    application_id = request.application_id
    
    # 1. Parse using Gemini NLU
    result = await parse_profile_information(
        user_transcript=user_transcript,
        current_phase=current_phase,
        current_name=current_name,
        current_phone=current_phone
    )
    
    extracted_name = result.get("name")
    extracted_phone = result.get("phone")
    extracted_business_idea = result.get("business_idea")
    is_correction = result.get("is_correction", False)
    corrected_field = result.get("corrected_field")
    uncertain = result.get("uncertain", False)
    
    # Validate & Normalize
    valid_phone = None
    if extracted_phone:
        valid_phone = validate_and_normalize_phone(extracted_phone)
        
    valid_name = validate_name(extracted_name) if extracted_name else None
    
    # Merge values
    name = valid_name or current_name or None
    phone = valid_phone or current_phone or None
    
    # If the user explicitly corrected their name/phone, update the DB record if profile exists
    if is_correction and (valid_name or valid_phone):
        old_phone = current_phone or ""
        user = db.query(User).filter(User.phone == old_phone).first() if old_phone else None
        if user:
            if valid_name and user.full_name != valid_name:
                user.full_name = valid_name
            if valid_phone and user.phone != valid_phone:
                user.phone = valid_phone
            db.commit()
            
    # Storing captured name/phone in Application's language_context so the engine has it
    if application_id and (name or phone):
        application = db.query(Application).filter(Application.id == application_id).first()
        if application:
            lang_context = application.language_context or {}
            if name:
                lang_context["captured_name"] = name
            if phone:
                lang_context["captured_phone"] = phone
            application.language_context = lang_context
            db.commit()
            
    next_phase = current_phase
    simulated_otp = None
    ai_response = ""
    engine_response = None
    
    # If we have both name and phone now, complete setup and transition to QUESTIONS
    if name and phone:
        next_phase = "questions"
        
        # Initiate OTP
        user = db.query(User).filter(User.phone == phone).first()
        is_new = False
        
        if not user:
            is_new = True
            email_str = f"{phone}@helix.ai"
            user = User(
                email=email_str,
                full_name=name,
                phone=phone,
                hashed_password=get_password_hash(str(uuid.uuid4())),
                company="Helix Guest"
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        elif name and (not user.full_name or user.full_name == "New User"):
            user.full_name = name
            db.commit()
            db.refresh(user)

        # Generate 6-digit OTP
        otp = str(random.randint(100000, 999999))
        user.otp_code = otp
        user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
        db.commit()
        
        simulated_otp = otp
        print(f"\n==========================================")
        print(f" OTP GENERATED FOR {phone}: {otp} (via parse-profile)")
        print(f"==========================================\n")
        
        # Process business idea if user provided it in the initial message
        if extracted_business_idea and application_id:
            application = db.query(Application).filter(Application.id == application_id).first()
            if application:
                engine_response = await _process_answer_through_engine(
                    application=application,
                    answer_text=extracted_business_idea,
                    db=db
                )
                
        # Generate next question prompt
        if engine_response:
            ai_response = engine_response.next_question
        else:
            first_name = name.strip().split()[0].capitalize()
            ai_response = f"Thanks, {first_name}. Let's get started. Tell me about the business idea you're thinking about."
            
    elif name and not phone:
        next_phase = "phone"
        first_name = name.strip().split()[0].capitalize()
        if current_phase == "name":
            ai_response = f"Thank you, {first_name}! And what is your phone number?"
        else:
            ai_response = f"Thanks, {first_name}. Could you please say your phone number?"
            
    elif not name and phone:
        next_phase = "name"
        if current_phase == "phone":
            ai_response = "Got your phone number, but could you please tell me your name first?"
        else:
            ai_response = "Could you please tell me your name?"
            
    else:
        # None captured or uncertain
        next_phase = current_phase
        if current_phase == "name":
            ai_response = "I couldn't catch your name. Could you please say your name?"
        else:
            ai_response = "I couldn't get a valid phone number. Please say your 10-digit number."
            
    return VoiceProcessResponse(
        transcribed_text=user_transcript,
        next_question=ai_response,
        acknowledgement=None,
        interview_complete=False,
        coverage=calculate_coverage(create_graph()),
        question_number=1,
        is_correction=is_correction,
        updated_name=name,
        updated_phone=phone,
        next_phase=next_phase,
        simulated_otp=simulated_otp,
        engine_response=(
            engine_response.model_dump()
            if hasattr(engine_response, "model_dump")
            else (engine_response.dict() if engine_response else None)
        )
    )





# ============ GUEST SESSION CLAIM ============

@app.post("/api/interview/claim", response_model=ClaimGuestSessionResponse)
def claim_guest_session(
    data: ClaimGuestSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """After sign-in/register, transfer guest application(s) to the authenticated user."""
    claimed_app = None

    if data.application_id:
        app_by_id = db.query(Application).filter(Application.id == data.application_id).first()
        if app_by_id:
            app_by_id.user_id = current_user.id
            app_by_id.is_guest = False
            claimed_app = app_by_id

    if data.guest_token:
        apps_by_token = db.query(Application).filter(
            Application.guest_token == data.guest_token
        ).all()
        for app in apps_by_token:
            app.user_id = current_user.id
            app.is_guest = False
            if not claimed_app:
                claimed_app = app

    if not claimed_app and data.application_id:
        claimed_app = db.query(Application).filter(
            Application.id == data.application_id,
            Application.user_id == current_user.id
        ).first()

    if not claimed_app:
        raise HTTPException(status_code=404, detail="Guest session not found or already claimed")

    db.commit()
    db.refresh(claimed_app)

    return ClaimGuestSessionResponse(
        application_id=claimed_app.id,
        message="Interview session successfully linked to your account"
    )


@app.get("/api/interview/{app_id}/sessions", response_model=List[InterviewResponse])
def get_interview_sessions(
    app_id: int,
    req: Request,
    db: Session = Depends(get_db),
):
    current_user = None
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from auth import decode_token
            token = auth_header.split(" ", 1)[1]
            current_user = decode_token(token, db)
        except Exception:
            pass

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    if current_user:
        if application.is_guest or application.user_id is None:
            application.user_id = current_user.id
            application.is_guest = False
            db.commit()

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

    # Verify ownership or claim guest application
    if current_user:
        if application.is_guest or application.user_id is None or (request.guest_token and application.guest_token == request.guest_token):
            application.user_id = current_user.id
            application.is_guest = False
            db.commit()
            db.refresh(application)
        elif application.user_id != current_user.id and not current_user.is_admin:
            raise HTTPException(status_code=403, detail="Not authorized")
    elif application.is_guest and request.guest_token and application.guest_token != request.guest_token:
        raise HTTPException(status_code=403, detail="Invalid guest token")

    # Update document language preference if supplied
    if request.doc_language_preference:
        lang_ctx = dict(application.language_context or {})
        lang_ctx["doc_language_preference"] = request.doc_language_preference
        application.language_context = lang_ctx
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(application, "language_context")

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

    # Generate requirements summary in user's preferred language or English
    summary = await generate_requirements_summary(
        interview_data,
        language_context=application.language_context,
        doc_language_preference=request.doc_language_preference
    )

    # Helper to convert lists to comma-separated strings for text fields
    def to_str(val):
        if val is None:
            return ""
        if isinstance(val, list):
            return ", ".join(str(v) for v in val)
        return str(val)

    # Update application — map ALL Gemini-extracted fields back to the application
    application.ai_summary             = to_str(summary.get("ai_summary", ""))
    application.project_name           = to_str(summary.get("project_name", ""))           or application.project_name
    application.project_type           = to_str(summary.get("project_type", ""))           or application.project_type
    application.business_domain        = to_str(summary.get("business_domain", ""))        or application.business_domain
    application.application_type       = to_str(summary.get("application_type", ""))       or application.application_type
    application.target_audience        = to_str(summary.get("target_audience", ""))        or application.target_audience
    application.business_description   = to_str(summary.get("business_description", ""))   or application.business_description
    application.problem_statement      = to_str(summary.get("problem_statement", ""))      or application.problem_statement
    application.desired_outcomes       = to_str(summary.get("desired_outcomes", ""))       or application.desired_outcomes
    application.key_features           = to_str(summary.get("key_features", ""))           or application.key_features
    application.integrations           = to_str(summary.get("integrations", ""))           or application.integrations
    application.timeline               = to_str(summary.get("timeline", ""))               or application.timeline
    application.budget_range           = to_str(summary.get("budget_range", ""))           or application.budget_range
    application.tech_preferences       = to_str(summary.get("tech_preferences", ""))       or application.tech_preferences
    application.scalability_needs      = to_str(summary.get("scalability_needs", ""))      or application.scalability_needs
    application.security_requirements  = to_str(summary.get("security_requirements", ""))  or application.security_requirements
    application.business_canvas        = summary.get("business_model_canvas")
    application.budget_planner         = summary.get("budget_planner")
    application.requirements_json      = summary
    application.total_requirements_captured = summary.get("total_requirements", len(sessions))
    application.status      = "in_progress"
    application.updated_at  = datetime.utcnow()

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


# ============ PDF DOWNLOAD & EMAIL ROUTES ============

@app.get("/api/applications/{app_id}/pdf")
async def download_application_pdf(
    app_id: int,
    req: Request,
    db: Session = Depends(get_db),
    guest_token: Optional[str] = None,
    lang: Optional[str] = None,
):
    """
    Generate and stream the Business Requirement PDF for the given application.
    Optional `lang` query param overrides the document language stored on the app.
    """
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

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Auth check
    authorized = False
    if current_user:
        if application.user_id == current_user.id or current_user.is_admin:
            authorized = True
        elif application.is_guest or application.user_id is None:
            authorized = True
    elif guest_token and application.guest_token == guest_token:
        authorized = True
    elif application.is_guest:
        authorized = True  # guest viewing their own session
    if not authorized:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Build a plain dict for the PDF service
    app_dict = {
        "id": application.id,
        "reference_number": application.reference_number,
        "project_name": application.project_name,
        "project_type": application.project_type,
        "business_domain": application.business_domain,
        "application_type": application.application_type,
        "target_audience": application.target_audience,
        "business_description": application.business_description,
        "problem_statement": application.problem_statement,
        "desired_outcomes": application.desired_outcomes,
        "key_features": application.key_features,
        "integrations": application.integrations,
        "timeline": application.timeline,
        "budget_range": application.budget_range,
        "tech_preferences": application.tech_preferences,
        "scalability_needs": application.scalability_needs,
        "security_requirements": application.security_requirements,
        "ai_summary": application.ai_summary,
        "requirements_json": application.requirements_json,
        "signature_data": application.signature_data,
        "signer_email": application.signer_email,
        "status": application.status,
        "submitted_at": str(application.submitted_at) if application.submitted_at else None,
        "total_requirements_captured": application.total_requirements_captured or 0,
        "language_context": application.language_context or {},
    }

    # Override language if requested via query param
    if lang:
        lang_ctx = dict(app_dict["language_context"])
        lang_ctx["doc_language_preference"] = lang
        app_dict["language_context"] = lang_ctx

    # Generate PDF (with translation if needed)
    try:
        pdf_bytes = await generate_pdf_for_application(app_dict)
    except Exception as e:
        print(f"[PDF] Generation error: {e}")
        # Fallback — generate without translation
        pdf_bytes = generate_application_pdf(app_dict)

    ref_no = application.reference_number or f"REQ-{app_id}"
    filename = f"Helix_Requirements_{ref_no}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.post("/api/applications/{app_id}/send-email")
async def send_application_email(
    app_id: int,
    req: Request,
    db: Session = Depends(get_db),
    guest_token: Optional[str] = None,
):
    """
    Generate the PDF and send it via SMTP to the application owner's email.
    Returns {success, message, email}.
    """
    # Parse optional json body
    body_email = None
    body_lang = None
    try:
        body = await req.json()
        if isinstance(body, dict):
            body_email = body.get("recipient_email") or body.get("email")
            body_lang = body.get("doc_language_preference") or body.get("lang")
    except Exception:
        pass

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

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # Build dict same as above
    app_dict = {
        "id": application.id,
        "reference_number": application.reference_number,
        "project_name": application.project_name,
        "project_type": application.project_type,
        "business_domain": application.business_domain,
        "application_type": application.application_type,
        "target_audience": application.target_audience,
        "business_description": application.business_description,
        "problem_statement": application.problem_statement,
        "desired_outcomes": application.desired_outcomes,
        "key_features": application.key_features,
        "integrations": application.integrations,
        "timeline": application.timeline,
        "budget_range": application.budget_range,
        "tech_preferences": application.tech_preferences,
        "scalability_needs": application.scalability_needs,
        "security_requirements": application.security_requirements,
        "ai_summary": application.ai_summary,
        "business_canvas": application.business_canvas,
        "budget_planner": application.budget_planner,
        "requirements_json": application.requirements_json,
        "signature_data": application.signature_data,
        "signer_email": application.signer_email,
        "status": application.status,
        "submitted_at": str(application.submitted_at) if application.submitted_at else None,
        "total_requirements_captured": application.total_requirements_captured or 0,
        "language_context": application.language_context or {},
    }

    if body_lang:
        lang_ctx = dict(app_dict["language_context"])
        lang_ctx["doc_language_preference"] = body_lang
        app_dict["language_context"] = lang_ctx

    # Add user info for recipient resolution
    if current_user:
        app_dict["user"] = {"email": current_user.email, "full_name": current_user.full_name}

    # Generate PDF
    try:
        pdf_bytes = await generate_pdf_for_application(app_dict)
    except Exception as e:
        print(f"[EMAIL] PDF generation error: {e}")
        pdf_bytes = generate_application_pdf(app_dict)

    # Determine recipient — body_email > signer_email > contact_email > user.email > fallback
    recipient = body_email or application.signer_email or application.contact_email or (current_user.email if current_user else None)
    if recipient and recipient.endswith("@helix.ai"):
        # Phone-derived placeholder — check contact_email or signer_email
        recipient = application.signer_email or application.contact_email or None

    if not recipient:
        return {"success": False, "message": "No valid email address found for this application.", "email": None}

    success = send_requirements_email(app_dict, pdf_bytes, recipient_email=recipient)
    return {
        "success": success,
        "message": f"Email successfully sent to {recipient}!" if success else "Email delivery failed. Check SMTP credentials in .env.",
        "email": recipient
    }


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


# ============ VAPI TOOL-CALL HANDLER ============
# Vapi calls this endpoint when the assistant needs to execute a backend tool.
# Each tool call is routed to the appropriate existing service.

@app.post("/api/vapi/tool-call")
async def vapi_tool_call(request: Request, db: Session = Depends(get_db)):
    """
    Central handler for all Vapi server tool calls.
    Vapi sends: { message: { type: 'tool-calls', toolCallList: [...], call: { ... } } }
    We process each tool call and return results.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Vapi wraps in a message envelope
    message = body.get("message", body)
    msg_type = message.get("type", "")

    # Handle tool-calls message type
    tool_call_list = message.get("toolCallList", [])
    if not tool_call_list:
        # Some Vapi versions use 'toolCalls' directly
        tool_call_list = message.get("toolCalls", [])

    if not tool_call_list:
        return {"results": []}

    results = []
    for tool_call in tool_call_list:
        tool_call_id = tool_call.get("id", "")
        fn = tool_call.get("function", {})
        tool_name = fn.get("name", "")
        raw_args = fn.get("arguments", "{}")

        # Parse arguments (Vapi may send as string or dict)
        if isinstance(raw_args, str):
            try:
                args = json.loads(raw_args)
            except Exception:
                args = {}
        else:
            args = raw_args or {}

        print(f"[Vapi Tool] {tool_name}: {json.dumps(args)[:200]}")

        # ── Route to handler ──────────────────────────────────────────────────
        try:
            if tool_name == "getApplicationContext":
                result = await _vapi_get_application_context(args, db)
            elif tool_name == "saveInterviewAnswer":
                result = await _vapi_save_interview_answer(args, db)
            elif tool_name == "completeInterview":
                result = await _vapi_complete_interview(args, db)
            elif tool_name == "initiateOtp":
                result = await _vapi_initiate_otp(args, db)
            else:
                result = {"error": f"Unknown tool: {tool_name}"}

            results.append({
                "toolCallId": tool_call_id,
                "result": json.dumps(result) if isinstance(result, dict) else str(result)
            })
        except Exception as e:
            print(f"[Vapi Tool] ERROR in {tool_name}: {e}")
            results.append({
                "toolCallId": tool_call_id,
                "result": json.dumps({"error": str(e), "success": False})
            })

    return {"results": results}


async def _vapi_get_application_context(args: dict, db: Session) -> dict:
    """Return application + user context to Vapi so it can personalize the interview."""
    app_id_raw = args.get("application_id")
    if not app_id_raw:
        return {"error": "application_id is required", "success": False}

    try:
        app_id = int(app_id_raw)
    except (ValueError, TypeError):
        return {"error": "Invalid application_id", "success": False}

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        return {"error": "Application not found", "success": False}

    # Gather existing interview sessions
    sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id
    ).order_by(InterviewSession.question_number).all()

    answered_sessions = [s for s in sessions if s.answer_text is not None]

    # Gather user info
    user_name = ""
    user_phone = ""
    is_authenticated = False

    lang_ctx = application.language_context or {}
    user_name = lang_ctx.get("captured_name", "")
    user_phone = lang_ctx.get("captured_phone", "")

    if application.user:
        user_name = user_name or application.user.full_name or ""
        user_phone = user_phone or application.user.phone or ""
        is_authenticated = True

    # Build Q&A history summary for Vapi
    qa_history = [
        {"question": s.question_text, "answer": s.answer_text}
        for s in answered_sessions
    ]

    # Existing requirements graph fields
    req_graph = application.requirements_json or {}

    return {
        "success": True,
        "application_id": app_id,
        "user_name": user_name,
        "user_phone": user_phone,
        "is_authenticated": is_authenticated,
        "is_guest": application.is_guest,
        "questions_answered": len(answered_sessions),
        "qa_history": qa_history,
        "existing_requirements": {
            "business_domain": req_graph.get("industry") or application.business_domain or "",
            "business_description": application.business_description or "",
            "problem_statement": application.problem_statement or "",
            "key_features": application.key_features or "",
            "target_audience": application.target_audience or "",
        }
    }


async def _vapi_save_interview_answer(args: dict, db: Session) -> dict:
    """Save a single interview Q&A pair to the database."""
    app_id_raw = args.get("application_id")
    question = args.get("question", "").strip()
    answer = args.get("answer", "").strip()
    language = args.get("language", "en-US")

    if not app_id_raw or not question or not answer:
        return {"error": "application_id, question, and answer are required", "success": False}

    try:
        app_id = int(app_id_raw)
    except (ValueError, TypeError):
        return {"error": "Invalid application_id", "success": False}

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        return {"error": "Application not found", "success": False}

    # Get the next question number
    existing_count = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id
    ).count()
    q_number = existing_count + 1

    # Upsert: if an unanswered session exists with this question text, use it
    existing_session = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id,
        InterviewSession.answer_text == None  # noqa: E711
    ).first()

    if existing_session:
        existing_session.answer_text = answer
        existing_session.question_text = question
        # Trigger lightweight Gemini extraction in the background (non-blocking)
        try:
            from gemini_service import extract_requirements
            from interview_engine import create_graph, update_graph, get_graph_summary_for_prompt
            graph = application.requirements_json or create_graph()
            graph_summary = get_graph_summary_for_prompt(graph)
            extraction = await extract_requirements(answer, question, graph_summary)
            existing_session.ai_extraction = extraction
            graph = update_graph(graph, extraction)
            application.requirements_json = graph
        except Exception as ex:
            print(f"[Vapi] Background extraction warning: {ex}")
    else:
        # Create new session record
        session = InterviewSession(
            application_id=app_id,
            question_number=q_number,
            question_text=question,
            answer_text=answer,
            ai_extraction=None
        )
        db.add(session)
        # Try extraction
        try:
            from gemini_service import extract_requirements
            from interview_engine import create_graph, update_graph, get_graph_summary_for_prompt
            graph = application.requirements_json or create_graph()
            graph_summary = get_graph_summary_for_prompt(graph)
            extraction = await extract_requirements(answer, question, graph_summary)
            session.ai_extraction = extraction
            graph = update_graph(graph, extraction)
            application.requirements_json = graph
        except Exception as ex:
            print(f"[Vapi] Background extraction warning: {ex}")

    # Update language context and persistent extracted info
    lang_ctx = dict(application.language_context or {})
    if language and language != "en-US":
        lang_ctx["language_code"] = language

    # Extract user info / project info if present in extraction
    ext = extraction_to_return if 'extraction_to_return' in locals() and extraction_to_return else None
    if not ext and 'existing_session' in locals() and existing_session and existing_session.ai_extraction:
        ext = existing_session.ai_extraction
    if ext and isinstance(ext, dict):
        if ext.get("name") and not lang_ctx.get("captured_name"):
            lang_ctx["captured_name"] = str(ext["name"])
        if ext.get("phone") and not lang_ctx.get("captured_phone"):
            lang_ctx["captured_phone"] = str(ext["phone"])
        if ext.get("email") and not application.contact_email:
            application.contact_email = str(ext["email"])
        if ext.get("project_name") and not application.project_name:
            application.project_name = str(ext["project_name"])
        if ext.get("business_domain") and not application.business_domain:
            application.business_domain = str(ext["business_domain"])

    # ── Write key scalars back to application row immediately (live update) ──
    # This ensures the Requirements page is populated even before completeInterview.
    def _to_str_live(val):
        if val is None: return None
        if isinstance(val, list): return ", ".join(str(v) for v in val) if val else None
        s = str(val).strip()
        return s if s else None

    # Use the extraction dict we just computed above (local 'extraction' var from the try blocks)
    try:
        _extraction_data = extraction if 'extraction' in locals() and isinstance(extraction, dict) else None
        if not _extraction_data and 'existing_session' in locals() and existing_session and existing_session.ai_extraction:
            _extraction_data = existing_session.ai_extraction
        if isinstance(_extraction_data, str):
            import json as _json2
            try: _extraction_data = _json2.loads(_extraction_data)
            except: _extraction_data = {}

        if _extraction_data and isinstance(_extraction_data, dict):
            # Scalar fields — only set if not already populated
            field_map = {
                "business_description":  "business_description",
                "problem_statement":     "problem_statement",
                "business_goal":         "desired_outcomes",
                "desired_outcomes":      "desired_outcomes",
                "target_audience":       "target_audience",
                "timeline":              "timeline",
                "budget_range":          "budget_range",
                "scalability_needs":     "scalability_needs",
                "industry":              "business_domain",
                "business_domain":       "business_domain",
                "project_name":          "project_name",
                "application_type":      "application_type",
                "project_type":          "project_type",
            }
            # List fields — append new values
            list_field_map = {
                "key_features":          "key_features",
                "core_modules":          "key_features",
                "integrations":          "integrations",
                "tech_preferences":      "tech_preferences",
                "security_requirements": "security_requirements",
            }
            for ext_key, app_field in field_map.items():
                val = _extraction_data.get(ext_key)
                val_str = _to_str_live(val)
                if val_str and not getattr(application, app_field, None):
                    setattr(application, app_field, val_str)
                    print(f"[Vapi][LiveUpdate] {app_field} = {val_str[:80]!r}")

            for ext_key, app_field in list_field_map.items():
                val = _extraction_data.get(ext_key)
                if val and isinstance(val, list) and val:
                    existing_val = getattr(application, app_field, None) or ""
                    new_items = [v for v in val if str(v).strip() and str(v).strip() not in existing_val]
                    if new_items:
                        if existing_val:
                            setattr(application, app_field, existing_val + ", " + ", ".join(str(v) for v in new_items))
                        else:
                            setattr(application, app_field, ", ".join(str(v) for v in new_items))
                        print(f"[Vapi][LiveUpdate] {app_field} += {new_items}")
    except Exception as live_ex:
        print(f"[Vapi][LiveUpdate] Warning: {live_ex}")

    application.language_context = lang_ctx
    application.status = "in_progress"

    db.commit()

    # ── Compute question count & completion signal ───────────────────────────
    final_count = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id,
        InterviewSession.answer_text != None  # noqa: E711
    ).count()

    # Calculate coverage from the updated graph
    coverage_data = {}
    coverage_pct = 0
    should_complete = False
    try:
        from interview_engine import calculate_coverage, CRITICAL_FIELDS
        graph = application.requirements_json or {}
        cov = calculate_coverage(graph)
        coverage_pct = cov.get("overall_percent", 0)
        coverage_data = {
            "overall_percent":  coverage_pct,
            "collected_fields": cov.get("collected_fields", []),
            "missing_fields":   cov.get("missing_fields", []),
            "checklist":        cov.get("checklist", []),
            "domain_label":     cov.get("domain_label"),
        }
        critical_missing = [f for f in cov.get("missing_critical", []) if f in CRITICAL_FIELDS]
        # should_complete when: answered ≥8 questions OR (≥6 and no critical gaps and coverage ≥65%)
        if final_count >= 8:
            should_complete = True
        elif final_count >= 6 and not critical_missing and coverage_pct >= 65:
            should_complete = True
    except Exception as ex:
        print(f"[Vapi] Coverage calc warning: {ex}")

    print(f"[Vapi][Q{q_number}] saved. questions_answered={final_count}, coverage={coverage_pct:.0f}%, should_complete={should_complete}")

    # ── Return extraction to frontend for live panel ─────────────────────────
    extraction_to_return = None
    key_points = []
    try:
        # Fetch the just-saved session's extraction for the live panel
        saved_session = db.query(InterviewSession).filter(
            InterviewSession.application_id == app_id,
            InterviewSession.answer_text == answer,
        ).order_by(InterviewSession.question_number.desc()).first()
        if saved_session and saved_session.ai_extraction:
            ext = saved_session.ai_extraction
            if isinstance(ext, str):
                import json as _json
                try: ext = _json.loads(ext)
                except: ext = {}
            extraction_to_return = ext
            key_points = ext.get("key_points", [])
    except Exception:
        pass

    return {
        "success": True,
        "message": "Answer saved successfully",
        "question_number": q_number,
        "questions_answered": final_count,
        "should_complete": should_complete,
        "coverage_percent": coverage_pct,
        "coverage": coverage_data,
        "extraction": extraction_to_return,
        "key_points": key_points,
    }


async def _vapi_complete_interview(args: dict, db: Session) -> dict:
    """Mark the interview as complete and trigger requirements generation."""
    app_id_raw = args.get("application_id")
    summary = args.get("summary", "")

    if not app_id_raw:
        return {"error": "application_id is required", "success": False}

    try:
        app_id = int(app_id_raw)
    except (ValueError, TypeError):
        return {"error": "Invalid application_id", "success": False}

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        return {"error": "Application not found", "success": False}

    # Mark all unanswered sessions as complete
    unanswered = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id,
        InterviewSession.answer_text == None  # noqa: E711
    ).all()
    for s in unanswered:
        s.answer_text = "[Interview completed]"

    application.status = "in_progress"
    application.ai_summary = summary
    db.commit()

    # ── Build rich application_data for Gemini ────────────────────────────────
    # Merge ALL per-answer ai_extraction dicts into one context dict so Gemini
    # has every structured fact it needs to fill the requirements form fields.
    try:
        sessions = db.query(InterviewSession).filter(
            InterviewSession.application_id == app_id
        ).order_by(InterviewSession.question_number).all()

        answered = [s for s in sessions if s.answer_text and s.answer_text != "[Interview completed]"]

        # ── 1. Start with the Vapi-provided summary text ─────────────────────
        merged: dict = {}
        if summary:
            merged["vapi_summary"] = summary

        # ── 2. Merge all per-answer extractions ──────────────────────────────
        list_fields = {
            "target_audience", "stakeholders", "roles", "target_users",
            "key_features", "core_modules", "optional_modules", "ai_features",
            "integrations", "platforms", "tech_preferences",
            "security_requirements", "future_scope", "risks", "constraints",
            "key_points", "requirements",
        }

        for session in answered:
            ext = session.ai_extraction or {}
            if isinstance(ext, str):
                import json as _json
                try:
                    ext = _json.loads(ext)
                except Exception:
                    ext = {}
            for key, val in ext.items():
                if key in ("confidence_hints", "category"):
                    continue
                if val is None or val == "" or val == []:
                    continue
                if key in list_fields:
                    existing = merged.get(key, [])
                    if isinstance(existing, list) and isinstance(val, list):
                        for item in val:
                            if item and item not in existing:
                                existing.append(item)
                        merged[key] = existing
                    elif isinstance(val, list):
                        merged[key] = val
                else:
                    # Scalar fields: keep first non-empty value
                    if not merged.get(key):
                        merged[key] = val

        # ── 3. Add raw Q&A transcript as additional context ──────────────────
        merged["interview_transcript"] = [
            {"question": s.question_text, "answer": s.answer_text}
            for s in answered
        ]

        # ── 4. Add any fields already on the application object ──────────────
        for col in ("project_name", "business_domain", "business_description",
                    "problem_statement", "key_features", "target_audience"):
            val = getattr(application, col, None)
            if val and not merged.get(col):
                merged[col] = val

        print(f"[Vapi] Merged extraction context for app {app_id}: {list(merged.keys())}")

        # ── 5. Generate requirements summary via Gemini ──────────────────────
        from gemini_service import generate_requirements_summary

        req_summary = await generate_requirements_summary(
            merged,
            language_context=application.language_context,
            doc_language_preference=None
        )

        def to_str(val):
            if val is None: return ""
            if isinstance(val, list): return ", ".join(str(v) for v in val)
            return str(val)

        # ── 6. Write every field back to the application row ─────────────────
        application.project_name          = to_str(req_summary.get("project_name", ""))          or application.project_name
        application.project_type          = to_str(req_summary.get("project_type", ""))          or application.project_type
        application.business_domain       = to_str(req_summary.get("business_domain", ""))       or application.business_domain
        application.application_type      = to_str(req_summary.get("application_type", ""))      or application.application_type
        application.target_audience       = to_str(req_summary.get("target_audience", ""))       or application.target_audience
        application.business_description  = to_str(req_summary.get("business_description", ""))  or application.business_description
        application.problem_statement     = to_str(req_summary.get("problem_statement", ""))     or application.problem_statement
        application.desired_outcomes      = to_str(req_summary.get("desired_outcomes", ""))      or application.desired_outcomes
        application.key_features          = to_str(req_summary.get("key_features", ""))          or application.key_features
        application.integrations          = to_str(req_summary.get("integrations", ""))          or application.integrations
        application.timeline              = to_str(req_summary.get("timeline", ""))              or application.timeline
        application.budget_range          = to_str(req_summary.get("budget_range", ""))          or application.budget_range
        application.tech_preferences      = to_str(req_summary.get("tech_preferences", ""))      or application.tech_preferences
        application.scalability_needs     = to_str(req_summary.get("scalability_needs", ""))     or application.scalability_needs
        application.security_requirements = to_str(req_summary.get("security_requirements", "")) or application.security_requirements
        application.ai_summary            = to_str(req_summary.get("ai_summary", ""))            or application.ai_summary
        application.business_canvas       = req_summary.get("business_model_canvas")
        application.budget_planner        = req_summary.get("budget_planner")
        application.requirements_json     = req_summary
        application.total_requirements_captured = req_summary.get("total_requirements", len(answered))
        application.status = "in_progress"
        application.updated_at = datetime.utcnow()
        db.commit()
        print(f"[Vapi] ✅ Requirements generated for application {app_id}: "
              f"project={application.project_name!r}, domain={application.business_domain!r}")
    except Exception as ex:
        import traceback
        print(f"[Vapi] REQUIREMENTS GENERATION ERROR: {ex}")
        traceback.print_exc()
        # Non-fatal — frontend can retry via /api/requirements/generate

    return {
        "success": True,
        "message": "Interview complete. Requirements are being prepared.",
        "application_id": app_id,
        "redirect_to": f"/requirements/{app_id}"
    }


async def _vapi_initiate_otp(args: dict, db: Session) -> dict:
    """Initiate OTP for a guest user and associate with current application."""
    phone = args.get("phone", "").strip()
    name = args.get("name", "").strip()
    app_id_raw = args.get("application_id")

    if not phone:
        return {"error": "phone is required", "success": False}

    # Normalize phone
    import re
    digits = re.sub(r"\D", "", phone)
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) != 10:
        return {"error": "Invalid phone number. Must be 10 digits.", "success": False}

    # Check if user exists, create if not
    user = db.query(User).filter(User.phone == digits).first()
    if not user:
        # Create a placeholder user for OTP
        user = User(
            email=f"{digits}@helix-guest.com",
            full_name=name or "Helix User",
            hashed_password=get_password_hash(str(uuid.uuid4())),
            phone=digits
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif name and (not user.full_name or user.full_name in ("Helix User", "New User")):
        user.full_name = name
        db.commit()

    # Link user contact info to application if application_id provided
    if app_id_raw:
        try:
            app_id = int(app_id_raw)
            application = db.query(Application).filter(Application.id == app_id).first()
            if application:
                lang_ctx = dict(application.language_context or {})
                if name:
                    lang_ctx["captured_name"] = name
                lang_ctx["captured_phone"] = digits
                application.language_context = lang_ctx
                if user.email and not user.email.endswith("@helix-guest.com"):
                    application.contact_email = user.email
                elif not application.contact_email:
                    application.contact_email = f"{digits}@helix.ai"
                db.commit()
        except (ValueError, TypeError):
            pass

    # Generate OTP
    otp_code = str(random.randint(100000, 999999))
    user.otp_code = otp_code
    user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    db.commit()

    print(f"\n==========================================")
    print(f" OTP GENERATED FOR {digits}: {otp_code} (via Vapi tool)")
    print(f"==========================================\n")

    return {
        "success": True,
        "message": f"OTP sent to {digits}",
        "simulated_otp": otp_code  # dev only — remove in production
    }


@app.post("/api/vapi/update-server-url")
async def update_vapi_server_url(request: Request):
    """
    Update the Vapi assistant's server URL when the tunnel changes.
    Call this after starting a new Cloudflare tunnel for the backend.
    POST { "tunnel_url": "https://example.trycloudflare.com" }
    """
    body = await request.json()
    tunnel_url = body.get("tunnel_url", "").rstrip("/")

    if not tunnel_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="tunnel_url must start with https://")

    VAPI_API_KEY = "c6b80ecd-d0ed-46df-b2f3-85561cda30fc"
    ASSISTANT_ID = "ff179db8-6206-4bfa-b8b0-241723e1ddab"
    server_url = f"{tunnel_url}/api/vapi/tool-call"

    # Build tools config
    tools = [
        {"type": "function", "function": {"name": n, "description": d, "parameters": p}, "server": {"url": server_url}}
        for n, d, p in [
            ("getApplicationContext", "Get application context for the interview.", {"type": "object", "properties": {"application_id": {"type": "string"}}, "required": ["application_id"]}),
            ("saveInterviewAnswer", "Save a business interview answer.", {"type": "object", "properties": {"application_id": {"type": "string"}, "question": {"type": "string"}, "answer": {"type": "string"}, "language": {"type": "string"}}, "required": ["application_id", "question", "answer"]}),
            ("completeInterview", "Complete the interview and generate requirements.", {"type": "object", "properties": {"application_id": {"type": "string"}, "summary": {"type": "string"}}, "required": ["application_id", "summary"]}),
            ("initiateOtp", "Initiate OTP for guest user sign-in.", {"type": "object", "properties": {"phone": {"type": "string"}, "name": {"type": "string"}, "application_id": {"type": "string"}}, "required": ["phone"]}),
        ]
    ]

    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.patch(
                f"https://api.vapi.ai/assistant/{ASSISTANT_ID}",
                json={"tools": tools},
                headers={"Authorization": f"Bearer {VAPI_API_KEY}", "Content-Type": "application/json"},
                timeout=15.0
            )
        if resp.status_code in (200, 201):
            return {"success": True, "server_url": server_url, "vapi_status": resp.status_code}
        else:
            return {"success": False, "error": resp.text, "server_url": server_url, "note": "Update Vapi dashboard manually if this fails"}
    except Exception as ex:
        return {"success": False, "error": str(ex), "server_url": server_url, "note": "Update Vapi dashboard manually"}


# ── Helix System Prompt for Vapi Assistant ─────────────────────────────────────
_HELIX_VAPI_SYSTEM_PROMPT = """\
You are Helix, an AI Business Requirements Companion. Your mission is to conduct a focused, friendly business requirements interview.

IMPORTANT: The user's name and phone number have ALREADY been collected before this call. You will receive them in variableValues as {{user_name}} and in the call metadata. Do NOT ask for name or phone again.

INTERVIEW START:
1. At the very start of the call, call getApplicationContext with application_id from metadata.
2. Greet the user by name using {{user_name}}. Example: "Hi {{user_name}}, I'm Helix. Let's discuss your business idea — tell me what you're looking to build."
3. If the user has already answered some questions (questions_answered > 0), acknowledge that and continue from where they left off.

BUSINESS INTERVIEW (6 to 8 questions):
1. Ask 6 to 8 focused, domain-tailored business questions covering: business idea, problem, target audience, key features, platform, timeline, budget, security, integrations.
2. Ask ONE question at a time. Keep questions short, clear, and conversational.
3. After EVERY user response, immediately call saveInterviewAnswer with application_id, the exact question text, and the user's verbatim answer.
4. saveInterviewAnswer returns questions_answered and should_complete. When should_complete is true OR questions_answered >= 8, call completeInterview.

COMPLETION:
1. When should_complete is true or 8+ questions answered, call completeInterview with application_id and a comprehensive summary of all requirements collected.
2. After calling completeInterview, say: "Thank you! I've captured all your requirements. Please check your phone — a verification code has been sent. Enter it on screen to view your project requirements."
3. Stop the interview after completeInterview. Do not ask more questions.

SPEAKING STYLE:
- Speak like a friendly, expert business consultant — warm and natural.
- Keep each question short (1-2 sentences max).
- Do not use filler words like Great, Wonderful, or Fantastic.
- Do not repeat the user's words back verbatim.
- Never invent business details the user did not mention.
"""


@app.post("/api/vapi/sync-assistant")
async def sync_vapi_assistant(request: Request):
    """
    Patch the Vapi assistant with the correct Helix system prompt and tool definitions.
    This enforces the 8-10 question hard limit and enables extraction-to-requirements flow.
    POST { "server_url": "https://your-backend.example.com" }  (optional — defaults to VAPI_SERVER_URL)
    """
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    server_url_base = (
        body.get("server_url")
        or os.getenv("VAPI_SERVER_URL", "http://localhost:8000")
    ).rstrip("/")

    VAPI_API_KEY  = (
        body.get("api_key")
        or os.getenv("VAPI_PRIVATE_KEY", "")
        or os.getenv("VAPI_PUBLIC_KEY", "")
    )
    ASSISTANT_ID  = (
        body.get("assistant_id")
        or os.getenv("VAPI_ASSISTANT_ID", "ff179db8-6206-4bfa-b8b0-241723e1ddab")
    )

    tool_endpoint = f"{server_url_base}/api/vapi/tool-call"

    tools = [
        {
            "type": "function",
            "function": {
                "name": "getApplicationContext",
                "description": (
                    "Call this at the START of the interview. Returns user info, number of questions already answered, "
                    "and existing requirements so you can personalise and not repeat questions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "The application ID from call metadata."}
                    },
                    "required": ["application_id"]
                }
            },
            "server": {"url": tool_endpoint}
        },
        {
            "type": "function",
            "function": {
                "name": "saveInterviewAnswer",
                "description": (
                    "Save a user's answer after EVERY question. Returns questions_answered count, should_complete boolean "
                    "(true when ≥8 questions answered or coverage is sufficient), and coverage_percent. "
                    "When should_complete is true, call completeInterview immediately."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "Application ID."},
                        "question":        {"type": "string", "description": "Exact question text that was asked."},
                        "answer":          {"type": "string", "description": "User's verbatim spoken answer."},
                        "language":        {"type": "string", "description": "Detected language code (e.g. en-US, ta-IN)."}
                    },
                    "required": ["application_id", "question", "answer"]
                }
            },
            "server": {"url": tool_endpoint}
        },
        {
            "type": "function",
            "function": {
                "name": "completeInterview",
                "description": (
                    "Call this when should_complete is true OR when 8+ questions have been asked. "
                    "Triggers requirements generation and returns a redirect path to the requirements page. "
                    "Always call this to close the interview — never end the call without calling this first."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "application_id": {"type": "string", "description": "Application ID."},
                        "summary":        {"type": "string", "description": "Full summary of ALL requirements collected during the interview."}
                    },
                    "required": ["application_id", "summary"]
                }
            },
            "server": {"url": tool_endpoint}
        },
        {
            "type": "function",
            "function": {
                "name": "initiateOtp",
                "description": "Initiate OTP verification for a guest user who wants to save their requirements.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone": {"type": "string", "description": "User's phone number."},
                        "name":  {"type": "string", "description": "User's name."}
                    },
                    "required": ["phone"]
                }
            },
            "server": {"url": tool_endpoint}
        },
    ]

    patch_payload = {
        "model": {
            "provider": "openai",
            "model": "gpt-4o",
            "systemPrompt": _HELIX_VAPI_SYSTEM_PROMPT,
        },
        "tools": tools,
    }

    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.patch(
                f"https://api.vapi.ai/assistant/{ASSISTANT_ID}",
                json=patch_payload,
                headers={"Authorization": f"Bearer {VAPI_API_KEY}", "Content-Type": "application/json"},
                timeout=20.0
            )
        print(f"[Vapi Sync] status={resp.status_code}  body={resp.text[:300]}")
        if resp.status_code in (200, 201):
            return {
                "success": True,
                "message": "Vapi assistant synced successfully with Helix system prompt and tools.",
                "tool_endpoint": tool_endpoint,
                "vapi_status": resp.status_code,
            }
        else:
            return {
                "success": False,
                "error": resp.text,
                "tool_endpoint": tool_endpoint,
                "note": "Update Vapi dashboard manually if this fails.",
            }
    except Exception as ex:
        return {
            "success": False,
            "error": str(ex),
            "tool_endpoint": tool_endpoint,
            "note": "Update Vapi dashboard manually.",
        }


@app.post("/api/vapi/complete-interview")
async def vapi_complete_interview_direct(request: Request, db: Session = Depends(get_db)):
    """
    Direct HTTP endpoint (not a Vapi tool) the frontend calls when the Vapi call ends
    without Vapi having called completeInterview itself.
    Guarantees requirements are always generated even if Vapi ended unexpectedly.
    POST { "application_id": 123 }
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    app_id_raw = body.get("application_id")
    if not app_id_raw:
        raise HTTPException(status_code=400, detail="application_id is required")

    try:
        app_id = int(app_id_raw)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid application_id")

    application = db.query(Application).filter(Application.id == app_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    # If already completed (has requirements data), skip regeneration
    if application.status == "completed" and application.requirements_json:
        return {
            "success": True,
            "message": "Requirements already generated.",
            "application_id": app_id,
            "redirect_to": f"/requirements/{app_id}",
            "already_complete": True,
        }

    # Build a summary from the Q&A history
    sessions = db.query(InterviewSession).filter(
        InterviewSession.application_id == app_id
    ).order_by(InterviewSession.question_number).all()

    answered = [s for s in sessions if s.answer_text and s.answer_text != "[Interview completed]"]
    summary_parts = [f"Q: {s.question_text}\nA: {s.answer_text}" for s in answered]
    auto_summary = "\n\n".join(summary_parts) if summary_parts else "No answers recorded."

    # Delegate to the existing complete handler
    result = await _vapi_complete_interview(
        {"application_id": str(app_id), "summary": auto_summary},
        db
    )
    result["source"] = "frontend_fallback"
    return result


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "Helix API", "version": "1.0.0"}


@app.get("/api/vapi/system-prompt")
def get_vapi_system_prompt():
    """
    Returns the exact Helix system prompt to paste into the Vapi dashboard.
    GET /api/vapi/system-prompt
    """
    return {
        "system_prompt": _HELIX_VAPI_SYSTEM_PROMPT,
        "assistant_id": os.getenv("VAPI_ASSISTANT_ID", "ff179db8-6206-4bfa-b8b0-241723e1ddab"),
        "instructions": (
            "Paste this system_prompt into your Vapi assistant's 'System Prompt' field. "
            "Also ensure all tool server URLs point to your backend's /api/vapi/tool-call endpoint."
        )
    }



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
