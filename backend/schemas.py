from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime


# ============ AUTH SCHEMAS ============

class UserCreate(BaseModel):
    email: str
    full_name: str
    password: str
    company: Optional[str] = None
    phone: Optional[str] = None


class UserLogin(BaseModel):
    phone: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    company: Optional[str] = None
    phone: Optional[str] = None
    is_admin: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


# ============ APPLICATION SCHEMAS ============

class ApplicationCreate(BaseModel):
    project_name: Optional[str] = None
    guest_token: Optional[str] = None  # set when creating as guest


class ApplicationUpdate(BaseModel):
    project_name: Optional[str] = None
    project_type: Optional[str] = None
    business_domain: Optional[str] = None
    application_type: Optional[str] = None
    target_audience: Optional[str] = None
    business_description: Optional[str] = None
    problem_statement: Optional[str] = None
    desired_outcomes: Optional[str] = None
    key_features: Optional[str] = None
    integrations: Optional[str] = None
    timeline: Optional[str] = None
    budget_range: Optional[str] = None
    tech_preferences: Optional[str] = None
    scalability_needs: Optional[str] = None
    security_requirements: Optional[str] = None
    ai_summary: Optional[str] = None
    signature_data: Optional[str] = None
    signer_email: Optional[str] = None


class ApplicationResponse(BaseModel):
    id: int
    reference_number: str
    user_id: Optional[int] = None  # null for guest sessions
    guest_token: Optional[str] = None
    is_guest: bool = False
    status: str
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    project_name: Optional[str] = None
    project_type: Optional[str] = None
    business_domain: Optional[str] = None
    application_type: Optional[str] = None
    target_audience: Optional[str] = None
    business_description: Optional[str] = None
    problem_statement: Optional[str] = None
    desired_outcomes: Optional[str] = None
    key_features: Optional[str] = None
    integrations: Optional[str] = None
    timeline: Optional[str] = None
    budget_range: Optional[str] = None
    tech_preferences: Optional[str] = None
    scalability_needs: Optional[str] = None
    security_requirements: Optional[str] = None
    ai_summary: Optional[str] = None
    requirements_json: Optional[Dict[str, Any]] = None
    total_requirements_captured: int = 0
    signature_data: Optional[str] = None
    signer_email: Optional[str] = None
    documents: Optional[List[str]] = None

    class Config:
        from_attributes = True


# ============ INTERVIEW SCHEMAS ============

class InterviewAnswer(BaseModel):
    answer_text: str
    question_number: Optional[int] = None  # auto-assigned by server


class InterviewResponse(BaseModel):
    id: int
    application_id: int
    question_number: int
    question_text: str
    answer_text: Optional[str] = None
    ai_extraction: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class VoiceProcessRequest(BaseModel):
    audio_base64: str
    application_id: int
    question_number: Optional[int] = None  # auto-assigned by server
    guest_token: Optional[str] = None  # for unauthenticated guest sessions


class VoiceProcessResponse(BaseModel):
    transcribed_text: str
    ai_extraction: Optional[Dict[str, Any]] = None
    next_question: Optional[str] = None
    acknowledgement: Optional[str] = None
    interview_complete: bool = False
    coverage: Optional[Dict[str, Any]] = None
    contradiction: Optional[str] = None
    question_number: int = 0
    reasoning: Optional[str] = None
    targeted_fields: Optional[List[str]] = None
    language_code: Optional[str] = None


class GenerateRequirementsRequest(BaseModel):
    application_id: int
    guest_token: Optional[str] = None  # for guest sessions


# ============ GUEST CLAIM SCHEMA ============

class ClaimGuestSessionRequest(BaseModel):
    guest_token: str


class ClaimGuestSessionResponse(BaseModel):
    application_id: int
    message: str


# ============ AUTH VOICE NLP SCHEMAS ============

class AuthVoiceNlpRequest(BaseModel):
    flow: str
    current_step: str
    user_transcript: str
    form_data: Dict[str, str]
    retry_count: int


class AuthVoiceNlpResponse(BaseModel):
    parsed_value: Optional[str] = None
    command: Optional[str] = None
    ai_response: str
    should_confirm: bool


# ============ OTP SCHEMAS ============

class OtpInitiateRequest(BaseModel):
    phone: str
    name: Optional[str] = None


class OtpInitiateResponse(BaseModel):
    status: str
    message: str
    is_new: bool
    simulated_otp: str


class OtpVerifyRequest(BaseModel):
    phone: str
    otp_code: str


