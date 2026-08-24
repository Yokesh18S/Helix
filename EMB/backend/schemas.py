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
    email: str
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
    user_id: int
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
    question_number: int
    answer_text: str


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
    question_number: int


class VoiceProcessResponse(BaseModel):
    transcribed_text: str
    ai_extraction: Optional[Dict[str, Any]] = None
    next_question: Optional[str] = None
    follow_up: Optional[str] = None


class GenerateRequirementsRequest(BaseModel):
    application_id: int

