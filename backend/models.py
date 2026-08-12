from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base
import uuid


def generate_ref():
    return f"REQ-{datetime.now().year}-{uuid.uuid4().hex[:6].upper()}"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    company = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    otp_code = Column(String(10), nullable=True)
    otp_expiry = Column(DateTime, nullable=True)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    applications = relationship("Application", back_populates="user")


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    reference_number = Column(String(50), unique=True, default=generate_ref)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # nullable for guest sessions
    guest_token = Column(String(64), nullable=True, index=True)  # random token for guest sessions
    is_guest = Column(Boolean, default=False)  # True until claimed by a user
    status = Column(String(50), default="draft")  # draft, in_progress, submitted, under_review, completed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    submitted_at = Column(DateTime, nullable=True)

    # Project Information (extracted by AI)
    project_name = Column(String(500), nullable=True)
    project_type = Column(String(255), nullable=True)
    business_domain = Column(String(255), nullable=True)
    application_type = Column(String(255), nullable=True)
    target_audience = Column(Text, nullable=True)

    # Business Details
    business_description = Column(Text, nullable=True)
    problem_statement = Column(Text, nullable=True)
    desired_outcomes = Column(Text, nullable=True)
    key_features = Column(Text, nullable=True)
    integrations = Column(Text, nullable=True)
    timeline = Column(String(255), nullable=True)
    budget_range = Column(String(255), nullable=True)

    # Technical Requirements
    tech_preferences = Column(Text, nullable=True)
    scalability_needs = Column(Text, nullable=True)
    security_requirements = Column(Text, nullable=True)

    # AI-extracted data & Language Memory
    ai_summary = Column(Text, nullable=True)
    requirements_json = Column(JSON, nullable=True)
    total_requirements_captured = Column(Integer, default=0)
    language_context = Column(JSON, nullable=True)  # Locked language context, speaking style, formality, etc.

    # Signature
    signature_data = Column(Text, nullable=True)  # Base64 signature
    signer_email = Column(String(255), nullable=True)

    # Documents
    documents = Column(JSON, nullable=True)  # List of uploaded file paths

    user = relationship("User", back_populates="applications")
    interviews = relationship("InterviewSession", back_populates="application")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    question_number = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    answer_text = Column(Text, nullable=True)
    answer_audio_path = Column(String(500), nullable=True)
    ai_extraction = Column(JSON, nullable=True)  # What AI extracted from this answer
    created_at = Column(DateTime, default=datetime.utcnow)

    application = relationship("Application", back_populates="interviews")

