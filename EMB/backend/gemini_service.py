import google.generativeai as genai
import os
import json
import base64
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Interview questions - the AI consultant's guided questions
INTERVIEW_QUESTIONS = [
    {
        "number": 1,
        "text": "What does your business do?",
        "context": "Understanding the core business model and operations"
    },
    {
        "number": 2,
        "text": "What problem are you trying to solve with this project?",
        "context": "Identifying the pain points and challenges"
    },
    {
        "number": 3,
        "text": "Who are the primary users of this application?",
        "context": "Understanding target audience and user personas"
    },
    {
        "number": 4,
        "text": "What are the key features you envision?",
        "context": "Core functionality requirements"
    },
    {
        "number": 5,
        "text": "Do you have any existing systems this needs to integrate with?",
        "context": "Integration requirements and constraints"
    },
    {
        "number": 6,
        "text": "What platforms should this work on — web, mobile, or both?",
        "context": "Platform and deployment requirements"
    },
    {
        "number": 7,
        "text": "What's your expected timeline for this project?",
        "context": "Timeline and milestone expectations"
    },
    {
        "number": 8,
        "text": "Do you have a budget range in mind?",
        "context": "Budget constraints and expectations"
    },
    {
        "number": 9,
        "text": "Are there any specific technology preferences or constraints?",
        "context": "Technical preferences and limitations"
    },
    {
        "number": 10,
        "text": "How many users do you expect to use this system?",
        "context": "Scalability and performance requirements"
    },
    {
        "number": 11,
        "text": "What security or compliance requirements do you have?",
        "context": "Security, privacy, and regulatory needs"
    },
    {
        "number": 12,
        "text": "Is there anything else important we should know about your project?",
        "context": "Additional requirements and context"
    }
]


def get_question(number: int) -> Optional[Dict]:
    """Get interview question by number"""
    for q in INTERVIEW_QUESTIONS:
        if q["number"] == number:
            return q
    return None


async def transcribe_audio(audio_base64: str) -> str:
    """Transcribe audio using Gemini's multimodal capabilities"""
    if not GEMINI_API_KEY:
        return "[Demo mode] Audio transcription requires Gemini API key"

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        # Decode base64 audio
        audio_bytes = base64.b64decode(audio_base64)

        response = model.generate_content([
            "Transcribe this audio recording accurately. Return only the transcribed text, nothing else.",
            {"mime_type": "audio/webm", "data": audio_bytes}
        ])

        return response.text.strip()
    except Exception as e:
        print(f"Transcription error: {e}")
        return f"[Transcription error: {str(e)}]"


async def process_answer(question_number: int, answer_text: str, previous_answers: list = None) -> Dict[str, Any]:
    """Process an interview answer and extract requirements using Gemini"""
    if not GEMINI_API_KEY:
        return {
            "extraction": {
                "key_points": [answer_text[:100]],
                "requirements": ["Requirement from answer"],
                "category": "general"
            },
            "follow_up": None
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        question = get_question(question_number)
        context = ""
        if previous_answers:
            context = "\n".join([f"Q{a['q']}: {a['answer']}" for a in previous_answers[-3:]])

        prompt = f"""You are an AI business consultant conducting a requirements gathering interview.

The current question was: "{question['text']}"
The client answered: "{answer_text}"

Previous context:
{context}

Please analyze this answer and extract:
1. Key business requirements mentioned
2. Technical requirements implied
3. Any follow-up question if the answer was vague or incomplete

Respond in JSON format:
{{
    "key_points": ["list of key points extracted"],
    "requirements": ["list of specific requirements"],
    "category": "one of: business_info, problem_statement, users, features, integrations, platform, timeline, budget, technology, scalability, security, additional",
    "follow_up": "A follow-up question if needed, or null if the answer was comprehensive",
    "extracted_fields": {{
        "project_name": "if mentioned",
        "project_type": "if mentioned", 
        "business_domain": "if mentioned",
        "application_type": "if mentioned"
    }}
}}"""

        response = model.generate_content(prompt)
        response_text = response.text.strip()

        # Clean up markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1]
            if response_text.endswith("```"):
                response_text = response_text[:-3]

        return {"extraction": json.loads(response_text), "follow_up": None}
    except Exception as e:
        print(f"Processing error: {e}")
        return {
            "extraction": {
                "key_points": [answer_text[:200]],
                "requirements": [],
                "category": "general"
            },
            "follow_up": None
        }


async def generate_requirements_summary(application_data: Dict) -> Dict[str, Any]:
    """Generate a comprehensive requirements summary from all interview data"""
    if not GEMINI_API_KEY:
        return {
            "ai_summary": "Demo summary - connect Gemini API for full AI analysis",
            "project_name": application_data.get("project_name", "Untitled Project"),
            "project_type": "Software Development",
            "business_domain": "Technology",
            "application_type": "Web Application",
            "total_requirements": 12
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = f"""Based on the following interview responses, generate a comprehensive business requirements document summary.

Interview Data:
{json.dumps(application_data, indent=2)}

Generate a JSON response with:
{{
    "ai_summary": "A comprehensive 2-3 paragraph summary of the project requirements",
    "project_name": "Suggested project name based on the conversation",
    "project_type": "Type of project (e.g., new build, existing business workflow automation, etc.)",
    "business_domain": "Primary business domain",
    "application_type": "Application type (web, mobile, both, etc.)",
    "target_audience": "Primary target users",
    "key_features": ["List of key features identified"],
    "technical_requirements": ["List of technical requirements"],
    "total_requirements": number_of_requirements_identified,
    "priority_items": ["Top priority items"],
    "risks": ["Potential risks identified"],
    "recommendations": ["AI recommendations for the project"]
}}"""

        response = model.generate_content(prompt)
        response_text = response.text.strip()

        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1]
            if response_text.endswith("```"):
                response_text = response_text[:-3]

        return json.loads(response_text)
    except Exception as e:
        print(f"Summary generation error: {e}")
        return {
            "ai_summary": "Error generating summary. Please try again.",
            "total_requirements": 0
        }


async def generate_follow_up(question_number: int, answer_text: str) -> Optional[str]:
    """Generate a contextual follow-up based on the answer"""
    if not GEMINI_API_KEY:
        return None

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        question = get_question(question_number)

        prompt = f"""As an AI business consultant, the client was asked: "{question['text']}"
They answered: "{answer_text}"

If this answer is vague, incomplete, or could use clarification, provide ONE brief follow-up question.
If the answer is clear and comprehensive, respond with just: NONE

Keep the follow-up conversational and brief (max 15 words)."""

        response = model.generate_content(prompt)
        result = response.text.strip()

        if result.upper() == "NONE" or len(result) < 5:
            return None
        return result
    except Exception:
        return None

