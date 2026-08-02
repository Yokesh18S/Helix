import google.generativeai as genai
import os
import json
import base64
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# ═══════════════════════════════════════════════════════════════
# AUDIO TRANSCRIPTION
# ═══════════════════════════════════════════════════════════════

def robust_json_loads(text: str) -> Dict[str, Any]:
    text_stripped = text.strip()
    try:
        return json.loads(text_stripped)
    except Exception:
        pass

    # Slice between first '{' and last '}'
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        json_str = text[start:end+1]
        try:
            return json.loads(json_str)
        except Exception as e:
            print(f"FAILED TO PARSE SLICED JSON. Slice: {repr(json_str)}")
            raise e
    raise ValueError(f"No JSON object curly braces found in text: {repr(text)}")


async def transcribe_audio(audio_base64: str) -> str:
    """Transcribe audio using Gemini's multimodal capabilities"""
    if not GEMINI_API_KEY:
        return "[Demo mode] Audio transcription requires Gemini API key"

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        audio_bytes = base64.b64decode(audio_base64)

        response = await model.generate_content_async([
            "Transcribe this audio recording accurately. Return only the transcribed text, nothing else.",
            {"mime_type": "audio/webm", "data": audio_bytes}
        ])

        return response.text.strip()
    except Exception as e:
        print(f"Transcription error: {e}")
        return f"[Transcription error: {str(e)}]"


# ═══════════════════════════════════════════════════════════════
# REQUIREMENT EXTRACTION (Fast, focused prompt)
# ═══════════════════════════════════════════════════════════════

async def extract_requirements(
    answer_text: str,
    question_text: str,
    graph_summary: str
) -> Dict[str, Any]:
    """
    Extract structured requirements from a user's answer.
    This is a FAST, FOCUSED prompt — only extracts data, no question generation.
    """
    if not GEMINI_API_KEY:
        return {
            "key_points": [answer_text[:100]],
            "requirements": ["Requirement from answer"],
            "category": "general"
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = f"""You are a senior business analyst extracting structured requirements from an interview answer.

QUESTION ASKED: "{question_text}"
CLIENT ANSWERED: "{answer_text}"

CURRENT PROJECT CONTEXT:
{graph_summary}

Extract ALL information from this answer into the structured fields below.
Only include fields where the answer provides relevant information.
Be thorough — extract industry, users, platforms, modules, roles, etc. from context clues.

Return ONLY valid JSON (no markdown, no backticks):
{{
    "industry": "detected industry or null",
    "problem_statement": "extracted problem or null",
    "business_goal": "extracted goal or null",
    "target_users": ["list of user types mentioned"],
    "business_model": "business model or null",
    "platforms": ["web", "mobile", etc.],
    "roles": ["user roles mentioned"],
    "core_modules": ["key features/modules mentioned"],
    "optional_modules": ["nice-to-have features"],
    "authentication": "auth requirements or null",
    "payments": "payment requirements or null",
    "notifications": "notification needs or null",
    "reports": "reporting needs or null",
    "integrations": ["third-party integrations"],
    "ai_features": ["AI/ML features mentioned"],
    "constraints": ["constraints or limitations"],
    "future_scope": ["future plans mentioned"],
    "key_points": ["3-5 key points from this answer"],
    "requirements": ["specific requirements extracted"],
    "category": "primary category of this answer"
}}"""

        response = await model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.1,
            )
        )
        text = response.text
        print("RAW EXTRACTION RESPONSE FROM GEMINI:", repr(text))
        return robust_json_loads(text)
    except Exception as e:
        print(f"Extraction error: {e}")
        return {
            "key_points": [answer_text[:200]],
            "requirements": [],
            "category": "general"
        }


# ═══════════════════════════════════════════════════════════════
# QUESTION GENERATION (Fast, focused prompt)
# ═══════════════════════════════════════════════════════════════

async def generate_question(
    missing_fields: List[str],
    field_labels: Dict[str, str],
    graph_summary: str,
    qa_history: str,
    industry: Optional[str] = None,
    industry_pack: Optional[Dict] = None,
    missing_critical: Optional[List[str]] = None,
    missing_important: Optional[List[str]] = None,
    missing_optional: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Generate ONE natural, conversational question that covers multiple missing fields.
    This is a FAST, FOCUSED prompt — only generates the question text.
    """
    if not GEMINI_API_KEY:
        field_names = ", ".join(field_labels.get(f, f) for f in (missing_critical or missing_fields[:3]))
        return {
            "question": f"Could you tell me about: {field_names}?",
            "acknowledgement": "Thanks for that.",
            "reasoning": "Fallback mode: Gemini API key not set.",
            "targeted_fields": missing_critical or missing_fields[:3],
            "language_code": "en-US"
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        critical_desc = ", ".join(field_labels.get(f, f) for f in (missing_critical or []))
        important_desc = ", ".join(field_labels.get(f, f) for f in (missing_important or []))
        optional_desc = ", ".join(field_labels.get(f, f) for f in (missing_optional or []))

        industry_context = ""
        if industry and industry_pack:
            industry_context = f"""
INDUSTRY: {industry}
Industry-specific modules to explore: {', '.join(industry_pack.get('expected_modules', [])[:5])}
Industry-specific roles: {', '.join(industry_pack.get('expected_roles', [])[:5])}
Domain considerations: {', '.join(industry_pack.get('domain_questions', [])[:3])}
"""

        prompt = f"""You are Helix, a friendly business companion, experienced co-founder, and product consultant.
Your goal is to have a warm, natural discussion with the client to fully understand their business idea and help them refine it, with the fewest possible interactions.
Do NOT act like a robotic interviewer or run through a checklist. Be supportive, conversational, and encouraging.

PROJECT CONTEXT COLLECTED SO FAR:
{graph_summary}
{industry_context}

CONVERSATION HISTORY:
{qa_history}

MISSING INFORMATION CLASSIFIED BY IMPORTANCE:
- CRITICAL GAP (Must resolve to proceed): {critical_desc or 'None'}
- IMPORTANT GAP (Needed for system architecture): {important_desc or 'None'}
- OPTIONAL GAP (Nice to have for scope refinement): {optional_desc or 'None'}

Your task:
1. Reason about the current state of the project. Identify the most critical ambiguities or missing details.
2. Select the highest-value missing fields to target next. (E.g. solve critical gaps first; group related fields together).
3. Formulate the response containing:
   - A warm, encouraging, and supportive acknowledgement (1-2 sentences) of their last answer/idea. E.g., if they suggest a soap company, say something like: "That's a fantastic idea! The personal care industry has strong potential, especially with the growing demand for unique or natural products." Act like an excited co-founder.
   - A natural, conversational follow-up question (1-2 sentences) that flows naturally from the acknowledgement and asks for the next set of details (e.g., "I'd love to understand your vision better—are you planning handmade soaps, herbal products, or a larger commercial brand?").
4. Language and Script Rules:
   - Identify the language and script used by the client in their last answer (e.g., English, Hindi script, Tamil script, Hinglish, Tanglish, etc.).
   - You MUST generate your response (acknowledgement and question) in the EXACT same language and script style as the client's last answer. If they spoke Tamil script, respond in Tamil script. If they spoke Tanglish (Tamil in English letters), respond in Tanglish. Do not translate their language to English or Hindi; respond in their own language.
   - For Tanglish and Hinglish, write in English script (Latin letters) but using the client's vocabulary, Hinglish/Tanglish phrasing, and friendly tone.
   - Do NOT use markdown, asterisks, emojis, or formatting.
5. Choose the appropriate Speech Recognition and TTS language code (`language_code`):
   - For pure English: use "en-US"
   - For Hindi (Devanagari script): use "hi-IN"
   - For Tamil (Tamil script): use "ta-IN"
   - For Tanglish, Hinglish, or code-mixed Indian English in Latin script: use "en-IN"

Return ONLY valid JSON (no markdown, no backticks):
{{
    "reasoning": "1-2 sentence explanation of your analysis of what's missing and why you chose these fields",
    "acknowledgement": "A warm, encouraging, and supportive co-founder acknowledgment in their language/style",
    "question": "Your friendly, conversational follow-up question in their language/style",
    "targeted_fields": ["list of field keys targeted by this question, e.g. 'target_users', 'platforms'"],
    "language_code": "The language code matching the script and language above (e.g., 'en-US', 'hi-IN', 'ta-IN', 'en-IN')"
}}"""

        response = await model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.7,
            )
        )
        text = response.text
        print("RAW QUESTION RESPONSE FROM GEMINI:", repr(text))
        return robust_json_loads(text)
    except Exception as e:
        print(f"Question generation error: {e}")
        fallback_fields = missing_critical or missing_fields[:3]
        field_names = ", ".join(field_labels.get(f, f) for f in fallback_fields)
        return {
            "question": f"Could you tell me about: {field_names}?",
            "acknowledgement": "Thanks.",
            "reasoning": f"Fallback mode due to error: {str(e)}",
            "targeted_fields": fallback_fields,
            "language_code": "en-US"
        }


# ═══════════════════════════════════════════════════════════════
# REQUIREMENTS SUMMARY GENERATION
# ═══════════════════════════════════════════════════════════════

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

        prompt = f"""Based on the following interview responses and requirement graph, generate a comprehensive business requirements document summary.

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

        response = await model.generate_content_async(prompt)
        response_text = response.text
        return robust_json_loads(response_text)
    except Exception as e:
        print(f"Summary generation error: {e}")
        return {
            "ai_summary": "Error generating summary. Please try again.",
            "total_requirements": 0
        }


# ═══════════════════════════════════════════════════════════════
# AUTH VOICE NLP (unchanged)
# ═══════════════════════════════════════════════════════════════

async def process_auth_voice_nlp(
    flow: str,
    current_step: str,
    user_transcript: str,
    form_data: dict,
    retry_count: int
) -> dict:
    """
    Use Gemini NLP, NLU, and NLG to process the authentication voice transcript.
    """
    if not GEMINI_API_KEY:
        return {}

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = f"""You are Helix, a premium AI business assistant guiding a user through voice authentication.
Flow: '{flow}' (signin or signup).
Current field: '{current_step}'.
Already collected: {json.dumps(form_data)}.
User said: "{user_transcript}".
Retry #{retry_count} for this field.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — COMMAND DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
First, check if the user spoke a navigation/control command instead of providing a field value.
Map them as follows:
  repeat / say again / what did you say     → "repeat"
  next / go next / continue                 → "next"
  back / go back / previous                 → "back"
  clear / erase / delete                    → "clear"
  skip / omit / leave blank                 → "skip"  (only valid for 'company' or 'phone')
  cancel / reset / start over               → "cancel"
  use keyboard / keyboard / type instead    → "keyboard"
  yes / correct / that's right / yep / yeah / confirm / exactly / absolutely → "confirm_yes"
  no / incorrect / wrong / try again / nope / that's wrong                  → "confirm_no"

CRITICAL RULE: If ANY of the above commands are detected, set command to the matched string
and set parsed_value to null. Do NOT attempt to parse the command as a field value.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — FIELD VALUE EXTRACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If no command was detected, extract the field value for '{current_step}':

■ 'email' or 'confirm_email':
  - Convert spoken symbols: "at"→@, "dot"/"period"→., "underscore"→_, "dash"/"hyphen"/"minus"→-
  - Remove all whitespace after substitutions.
  - CRITICAL: If the result does NOT contain "@", return null for parsed_value.

■ 'phone':
  - Convert spoken numbers: "double zero"→"00", "triple nine"→"999", etc.
  - Return a clean numeric string (digits only).
  - CRITICAL: Must be exactly 10 digits. If not, set parsed_value to null.

■ 'password' or 'confirm_password':
  - NEVER confirm passwords. ALWAYS set should_confirm to false.
  - Parse spoken symbols and case modifiers.
  - Do NOT repeat the password aloud. Just say "Password received."

■ 'full_name':
  - Extract and capitalize the full name.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — AI RESPONSE GENERATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generate a natural, concise ai_response.
Keep responses short, professional, and spoken (no markdown, no emojis).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a valid JSON object — no markdown, no backticks, no extra text:
{{
  "parsed_value": "extracted value or null",
  "command": "matched command or null",
  "ai_response": "Conversational response to speak to the user",
  "should_confirm": true or false
}}
"""

        response = await model.generate_content_async(prompt)
        text = response.text.strip()

        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```json") or lines[0].startswith("```"):
                lines = lines[1:-1]
            text = "\n".join(lines).strip()

        return json.loads(text)
    except Exception as e:
        print(f"Error in Gemini auth voice NLP: {e}")
        return {}
