import google.generativeai as genai
import os
import json
import base64
import re
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# ═══════════════════════════════════════════════════════════════
# AUDIO TRANSCRIPTION
# ═══════════════════════════════════════════════════════════════

def robust_json_loads(text: str) -> Dict[str, Any]:
    text_stripped = text.strip()
    if "```" in text_stripped:
        lines = text_stripped.split("\n")
        cleaned_lines = [l for l in lines if not l.strip().startswith("```")]
        text_stripped = "\n".join(cleaned_lines).strip()

    try:
        return json.loads(text_stripped)
    except Exception:
        pass

    # Slice between first '{' and last '}'
    start = text_stripped.find('{')
    end = text_stripped.rfind('}')
    if start != -1 and end != -1 and end > start:
        json_str = text_stripped[start:end+1]
        try:
            return json.loads(json_str)
        except Exception:
            json_str_fixed = re.sub(r',\s*([}\]])', r'\1', json_str)
            try:
                return json.loads(json_str_fixed)
            except Exception as e:
                print(f"FAILED TO PARSE SLICED JSON. Slice: {repr(json_str)}")
                raise e
    raise ValueError(f"No JSON object curly braces found in text: {repr(text)}")


async def transcribe_audio(
    audio_base64: str,
    language_context: Optional[Dict[str, Any]] = None
) -> str:
    """Transcribe audio using Gemini's multimodal capabilities, preserving exact spoken language/dialect."""
    if not GEMINI_API_KEY:
        return "[Demo mode] Audio transcription requires Gemini API key"

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        audio_bytes = base64.b64decode(audio_base64)
        locked_lang = (language_context or {}).get("locked_language", "multilingual")

        prompt = f"""Transcribe this audio recording with 100% accuracy.
CRITICAL MULTILINGUAL INSTRUCTIONS:
- Preserve the exact spoken language, dialect, script, and code-mixing (such as Tanglish, Manglish, Hinglish, Tenglish, Kanglish, Tamil, Malayalam, Hindi, English, etc.).
- Do NOT translate the user's spoken words into English or any other language.
- If the user speaks Tanglish (Tamil in Latin script), write it down in Latin script exactly as spoken (e.g., "naan soap company start panna poren").
- If the user speaks Hinglish (Hindi in Latin script), write it down in Latin script exactly as spoken (e.g., "mujhe ek app banana hai").
- If the user speaks Manglish (Malayalam in Latin script), write it down in Latin script exactly as spoken (e.g., "enikku oru app venam").
- Locked Conversation Language: {locked_lang}
- Return ONLY the transcribed text, nothing else."""

        response = await model.generate_content_async([
            prompt,
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

        prompt = f"""You are a senior Business Analyst extracting structured requirements from a business interview conversation.

QUESTION ASKED: "{question_text}"
CLIENT ANSWERED: "{answer_text}"

CURRENT PROJECT CONTEXT:
{graph_summary}

EXTRACTION RULES:
- Extract ALL information the user has actually mentioned or clearly implied.
- Read between the lines — infer domain, users, features, workflow from context clues.
- Be thorough but NEVER invent information the user did not say or imply.
- Only include fields where the answer provides relevant information.
- Use null for scalar fields and empty arrays [] for list fields where no info was provided.
- For confidence_hints: mark each field as:
    "explicit"     — user directly and clearly stated this information (e.g. "I want to sell online" → sales_channel is explicit)
    "implied"      — can be reasonably inferred but user did not state it directly (e.g. mention of "customers" implies target_audience exists but not detailed)
    "not_mentioned"— no evidence whatsoever in the answer for this field

IMPORTANT: confidence_hints must be included for EVERY scalar field you set (non-null). Only include a field in confidence_hints if you set it to a non-null value.

Return ONLY valid JSON (no markdown, no backticks):
{{
    "industry": "detected industry or null",
    "business_description": "what the business does or null",
    "problem_statement": "problem being solved or null",
    "business_goal": "what they want to achieve or null",
    "vision": "long-term vision or null",
    "products_or_services": "what they sell or offer or null",
    "revenue_model": "how they make money or null",
    "sales_channel": "online, offline, or both or null",
    "customer_type": "B2B, B2C, B2B2C, or null",
    "business_model": "business model or null",
    "target_audience": ["target customer types"],
    "stakeholders": ["business stakeholders mentioned"],
    "roles": ["user roles in the system"],
    "target_users": ["end user types mentioned"],
    "workflow": "business workflow description or null",
    "current_process": "how things work today or null",
    "future_process": "how they want things to work or null",
    "key_features": ["core features or modules mentioned"],
    "core_modules": ["system modules mentioned"],
    "optional_modules": ["nice-to-have features"],
    "ai_features": ["AI or ML features mentioned"],
    "reports": "reporting needs or null",
    "notifications": "notification needs or null",
    "integrations": ["third-party integrations"],
    "platforms": ["web, mobile, desktop — only if user explicitly mentioned a platform"],
    "authentication": "auth requirements or null",
    "payments": "payment requirements or null",
    "tech_preferences": ["technology preferences mentioned"],
    "security_requirements": ["security needs mentioned"],
    "scalability_needs": "scalability requirements or null",
    "timeline": "timeline mentioned or null",
    "budget_range": "budget mentioned or null",
    "future_scope": ["future plans mentioned"],
    "risks": ["risks or challenges mentioned"],
    "constraints": ["constraints or limitations"],
    "key_points": ["3-5 key points from this answer"],
    "requirements": ["specific requirements extracted"],
    "category": "primary category of this answer",
    "confidence_hints": {{
        "field_name": "explicit | implied | not_mentioned"
    }}
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
    missing_optional: Optional[List[str]] = None,
    language_context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Generate ONE natural, conversational question that covers multiple missing fields,
    enforcing Helix's Production-Grade Multilingual Conversation Engine rules.
    """
    if language_context is None:
        language_context = {}

    target_lang = language_context.get("locked_language", "English")
    target_code = language_context.get("language_code", "en-US")
    speaking_style = language_context.get("speaking_style", "Friendly, supportive co-founder")
    formality_level = language_context.get("formality_level", "casual")

    if not GEMINI_API_KEY:
        field_names = ", ".join(field_labels.get(f, f) for f in (missing_critical or missing_fields[:3]))
        return {
            "question": f"Could you tell me about: {field_names}?",
            "acknowledgement": "Thanks for that.",
            "reasoning": "Fallback mode: Gemini API key not set.",
            "targeted_fields": missing_critical or missing_fields[:3],
            "language_code": target_code
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        critical_desc = ", ".join(field_labels.get(f, f) for f in (missing_critical or []))
        important_desc = ", ".join(field_labels.get(f, f) for f in (missing_important or []))
        optional_desc = ", ".join(field_labels.get(f, f) for f in (missing_optional or []))

        # Primary focus: the single most important missing field
        focus_field = field_labels.get(missing_fields[0], missing_fields[0]) if missing_fields else "general business context"

        industry_context = ""
        if industry and industry_pack:
            industry_context = f"""
INDUSTRY: {industry}
Industry-specific modules to explore: {', '.join(industry_pack.get('expected_modules', [])[:5])}
Industry-specific roles: {', '.join(industry_pack.get('expected_roles', [])[:5])}
Domain considerations: {', '.join(industry_pack.get('domain_questions', [])[:3])}
"""

        prompt = f"""You are Helix, a friendly startup mentor and experienced Business Analyst.
You are having a natural conversation with someone about their business idea.
The user should feel like they are discussing their idea with a knowledgeable partner, not filling out a form.

PERSONALITY:
- Warm, approachable, and genuinely interested
- Like a knowledgeable friend discussing a business idea over coffee
- NOT a robotic interviewer, NOT a survey, NOT a checklist
- Keep everything short and natural

ACKNOWLEDGEMENT RULES:
- Start with a SHORT, natural acknowledgement (under 8 words)
- Good examples: "That's a nice idea.", "Interesting.", "Great.", "Got it.", "That makes sense.", "Sounds good."
- Do NOT write long compliments or multi-sentence praise
- Do NOT repeat back what the user just said

QUESTION RULES:
- Ask exactly ONE question about ONE topic
- The question MUST naturally follow from their previous answer
- Keep the question short (1-2 sentences max)
- Use simple, everyday language — no technical jargon
- Do NOT ask multiple things in one question
- NEVER repeat a question whose answer is already known
- The question should feel like a natural next step in the discussion

DOMAIN ADAPTATION:
- Automatically understand the business domain from context
- Use domain-appropriate terms naturally:
  Restaurant → ordering, menu, kitchen, delivery
  Hospital → patients, doctors, appointments
  School → students, teachers, attendance
  Factory → production, inventory, suppliers
  Agriculture → crops, farmers, machinery
  E-commerce → products, payments, shipping
  Finance → transactions, compliance, security
  Real Estate → properties, buyers, agents
- Do NOT change the interview flow, just use domain terminology

EXAMPLE CONVERSATION FLOW (English):
User: "I want to start a soap company."
→ "That's a nice idea. Will you make the soap yourself or get it from another manufacturer?"

User: "We'll manufacture it."
→ "Great. Who do you mainly want to sell it to — shops, supermarkets, or directly to customers?"

User: "Directly to customers through our website."
→ "Got it. What's the main thing you want your website to handle — just orders, or also things like custom options and subscriptions?"

MUST READ: STRICT MULTILINGUAL CONVERSATION ENGINE RULES
=========================================================
1. LOCKED SESSION LANGUAGE: "{target_lang}" (Language Code: {target_code})
2. USER'S SPEAKING STYLE & FORMALITY: "{speaking_style}" | Formality: "{formality_level}"
3. ABSOLUTE RULE: You MUST generate both your acknowledgement and question in "{target_lang}".
4. DO NOT TRANSLATE TO ENGLISH or any other language unless explicitly requested by the user.

EXAMPLES OF REQUIRED RESPONSE STYLES BASED ON LOCKED LANGUAGE:
- Tanglish (Tamil in Latin script + English terms):
  "Super! Soap ungaley manufacture pannuveengala illa veliiye irundu vaangiveengala?"

- Manglish (Malayalam in Latin script + English terms):
  "Nalla idea! Restaurant app-inte main customers aaranu?"

- Hinglish (Hindi in Latin script + English terms):
  "Accha! Aapke customers kaun honge — doctors, patients, ya dono?"

- Tenglish (Telugu in Latin script + English terms):
  "Super idea! Meeru evariki ammutaru — shops ki, customers ki?"

- Kanglish (Kannada in Latin script + English terms):
  "Channagide! Bakery app ge main customers yaru?"

- Pure Tamil/Hindi/Malayalam/Telugu/Kannada: Respond in the native script.
- Pure English: Respond in English.

Formatting Constraint:
Do NOT use markdown bolding (**), asterisks (*), emojis, or text formatting.

PROJECT CONTEXT COLLECTED SO FAR:
{graph_summary}
{industry_context}

CONVERSATION HISTORY:
{qa_history}

INFORMATION GAPS (for your internal reasoning only — do NOT mention these to the user):
- CRITICAL (must-know): {critical_desc or 'None'}
- IMPORTANT (needed for good docs): {important_desc or 'None'}
- OPTIONAL (nice to have): {optional_desc or 'None'}

PRIMARY FOCUS FOR THIS QUESTION: {focus_field}
(Ask about this topic in a natural, conversational way. Do NOT use the field label directly.)

TASK:
1. Write a SHORT acknowledgement of the user's last answer in "{target_lang}".
2. Ask ONE simple, natural follow-up question about {focus_field} in "{target_lang}".
3. The question must feel like a natural continuation — NOT a survey question.

Output ONLY valid JSON (no markdown, no backticks):
{{
    "reasoning": "Why this question and what gap it fills",
    "acknowledgement": "Short acknowledgement in {target_lang}",
    "question": "One natural follow-up question in {target_lang}",
    "targeted_fields": ["field_keys this question targets"],
    "language_code": "{target_code}"
}}"""

        response = await model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.7,
            )
        )
        text = response.text
        print(f"RAW QUESTION RESPONSE ({target_lang}):", repr(text))
        res = robust_json_loads(text)
        res["language_code"] = target_code
        return res
    except Exception as e:
        print(f"Question generation error: {e}")
        fallback_fields = missing_critical or missing_fields[:1]
        field_names = ", ".join(field_labels.get(f, f) for f in fallback_fields)
        return {
            "question": f"Could you tell me about: {field_names}?",
            "acknowledgement": "Got it.",
            "reasoning": f"Fallback mode due to error: {str(e)}",
            "targeted_fields": fallback_fields,
            "language_code": target_code
        }



# ═══════════════════════════════════════════════════════════════
# REQUIREMENTS SUMMARY GENERATION
# ═══════════════════════════════════════════════════════════════

async def generate_requirements_summary(
    application_data: Dict,
    language_context: Optional[Dict[str, Any]] = None,
    doc_language_preference: Optional[str] = None
) -> Dict[str, Any]:
    """Generate a comprehensive requirements summary, Business Model Canvas, and budget allocation in user's preferred language."""
    if language_context is None:
        language_context = {}

    target_lang = language_context.get("locked_language", "English")
    pref = doc_language_preference or language_context.get("doc_language_preference", "user_lang")

    if pref and pref not in ["user_lang", "english"]:
        chosen_language = pref
    elif pref == "english":
        chosen_language = "English"
    else:
        chosen_language = target_lang

    if not GEMINI_API_KEY:
        return {
            "ai_summary": "Comprehensive business requirements specification prepared by Helix AI Consultant.",
            "project_name": application_data.get("project_name", "Untitled Project"),
            "project_type": "Software Development",
            "business_domain": "Technology",
            "application_type": "Web & Mobile Application",
            "target_audience": "Target Customers",
            "business_description": "Custom business solution",
            "problem_statement": "Operational workflow optimization",
            "desired_outcomes": "Automated processes and higher revenue",
            "key_features": "Core user management, tracking, billing",
            "integrations": "Payment Gateway, SMS, Email",
            "timeline": "3 to 6 months",
            "budget_range": "Flexible startup budget",
            "tech_preferences": "React, Python FastAPI, PostgreSQL",
            "scalability_needs": "High scalability",
            "security_requirements": "SSL, OAuth2, Data Encryption",
            "total_requirements": 12,
            "business_model_canvas": {
                "key_partners": ["Technology Partners", "Payment Providers"],
                "key_activities": ["Platform Development", "Customer Onboarding"],
                "key_resources": ["Proprietary Software", "Engineering Team"],
                "value_propositions": ["Streamlined Operations", "Scalable Growth"],
                "customer_relationships": ["Self-service", "Automated Support"],
                "channels": ["Web Portal", "Mobile Apps"],
                "customer_segments": ["End Users & Businesses"],
                "cost_structure": ["Engineering", "Cloud Infrastructure", "Marketing"],
                "revenue_streams": ["Subscription Fees", "Transaction Commission"]
            },
            "proportional_budget": [
                {"category": "Core Platform & Backend Architecture", "percentage": 35, "allocated_amount": "35% of Total Budget", "description": "API Services, DB Schema, Authentication"},
                {"category": "Frontend UI/UX & Mobile Applications", "percentage": 25, "allocated_amount": "25% of Total Budget", "description": "Client Web App, Mobile Application UI"},
                {"category": "AI / ML & Third-Party Integrations", "percentage": 20, "allocated_amount": "20% of Total Budget", "description": "Gemini Integration, Payment Gateway"},
                {"category": "Quality Assurance & Compliance", "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Automated Testing, Security Audit"},
                {"category": "Deployment & Buffer Contingency", "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Cloud DevOps, Contingency Reserve"}
            ],
            "doc_language_prompt": f"I can generate the report in {chosen_language}."
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = f"""You are an executive Business Analyst and native technical author generating a Business Requirement Specification (BRD / SRS), Business Model Canvas, and Proportional Business Budget Allocation in {chosen_language}.

MANDATORY TRANSLATION & NATIVE WRITING PRINCIPLES:
1. SENTENCE & MEANING LEVEL: Translate and write at the SENTENCE / MEANING level. NEVER translate word-by-word or produce literal dictionary translations.
2. NATURAL NATIVE PROSE: Write in fluent, grammatically correct, native professional prose as if originally authored by a native speaker in {chosen_language}.
3. DIALECT TO FORMAL NATIVE SCRIPT: If target language is code-mixed (Tanglish, Manglish, Hinglish, Tenglish, Kanglish), write the entire document in the formal, professional native script (Tamil, Malayalam, Hindi, Telugu, Kannada) with proper grammar.
4. TECHNICAL TERMINOLOGY PROTECTION: Preserve software & business domain terminology (e.g. API, AI, ML, UI/UX, CI/CD, DevOps, JWT, OTP, SQL, REST API, OAuth2, SSL, Cloud, React, Python FastAPI, PostgreSQL, Database, Mobile App, Web App). Do NOT translate technical terms into awkward or unrecognizable literal words.
5. ZERO-BLANK RULE: DO NOT leave any field empty or blank. Infer realistic, high-quality technical specifications if omitted.
6. TERMINOLOGY CONSISTENCY: Maintain uniform business and technical terminology throughout all sections.

Interview Data:
{json.dumps(application_data, indent=2)}

Generate a JSON response with the following exact keys:
{{
    "ai_summary": "Comprehensive 2-3 paragraph summary of the project requirements written naturally in {chosen_language}",
    "project_name": "Suggested project name",
    "project_type": "Type of project (e.g. Workflow Automation, E-commerce App)",
    "business_domain": "Primary business domain/industry",
    "application_type": "Application type (web, mobile app, both, etc.)",
    "target_audience": "Target audience / customer segments",
    "business_description": "Clear explanation of the business idea",
    "problem_statement": "Problem statement being solved",
    "desired_outcomes": "Desired business outcomes and vision",
    "key_features": "List of core features comma separated",
    "integrations": "Third party integrations list",
    "timeline": "Estimated project timeline (e.g., 8-12 weeks for MVP launch)",
    "budget_range": "Estimated budget range (e.g., $15,000 - $30,000)",
    "tech_preferences": "Recommended technology stack (e.g., React / Next.js, Python FastAPI, PostgreSQL, Redis)",
    "scalability_needs": "Scalability requirements (e.g., Cloud containerized auto-scaling for 50,000 MAU)",
    "security_requirements": "Security specifications (e.g., TLS/SSL encryption, OAuth2/JWT auth, PCI-DSS compliance)",
    "total_requirements": 12,
    "business_model_canvas": {{
        "key_partners": ["Technology Partners", "Payment Providers", "Cloud Vendors"],
        "key_activities": ["Platform Development", "User Acquisition", "Customer Support"],
        "key_resources": ["Proprietary Architecture", "Engineering Team", "Customer Data"],
        "value_propositions": ["Streamlined Operations", "Automated Workflow", "Scalable Performance"],
        "customer_relationships": ["Self-service Portal", "Automated Support", "Dedicated Success Manager"],
        "channels": ["Web Platform", "Mobile Applications", "REST API Integrations"],
        "customer_segments": ["Target Customers & Enterprise Clients"],
        "cost_structure": ["Software Engineering", "Cloud Infrastructure Hosting", "Marketing & Security"],
        "revenue_streams": ["Subscription Plans", "Transaction Processing", "Premium Modules"]
    }},
    "proportional_budget": [
        {{
            "category": "Core Architecture & Backend Development",
            "percentage": 35,
            "allocated_amount": "35% of Total Budget",
            "description": "API Services, DB Schema, Authentication, Core Services"
        }},
        {{
            "category": "Frontend UI/UX & Client Applications",
            "percentage": 25,
            "allocated_amount": "25% of Total Budget",
            "description": "Web App UI, Mobile Interfaces, Responsive Design"
        }},
        {{
            "category": "AI / ML & Third-Party Integrations",
            "percentage": 20,
            "allocated_amount": "20% of Total Budget",
            "description": "Gemini Integration, Payment Gateways, Messaging APIs"
        }},
        {{
            "category": "Quality Assurance & Security Compliance",
            "percentage": 10,
            "allocated_amount": "10% of Total Budget",
            "description": "Automated End-to-End Testing, Security Audits, Encryption"
        }},
        {{
            "category": "Cloud Infrastructure & Buffer Reserve",
            "percentage": 10,
            "allocated_amount": "10% of Total Budget",
            "description": "Cloud DevOps Deployment, CI/CD Pipeline, Contingency Buffer"
        }}
    ],
    "doc_language_prompt": "I can generate the report in {chosen_language}."
}}"""

        try:
            gen_config = genai.GenerationConfig(temperature=0.2, response_mime_type="application/json")  # type: ignore
        except TypeError:
            gen_config = genai.GenerationConfig(temperature=0.2)

        response = await model.generate_content_async(
            prompt,
            generation_config=gen_config
        )
        response_text = response.text
        res = robust_json_loads(response_text)
        res["doc_language_prompt"] = f"I can generate the report in {chosen_language}."
        return res
    except Exception as e:
        print(f"Summary generation error: {e}")
        # Fallback with complete field definitions
        return {
            "ai_summary": f"Comprehensive requirement specification generated in {chosen_language}.",
            "project_name": application_data.get("project_name") or "Business Requirement Draft",
            "project_type": "Custom Business Solution",
            "business_domain": "Technology & Services",
            "application_type": "Web & Mobile Application",
            "target_audience": "Target Customers & Users",
            "business_description": "End-to-end digital application workflow.",
            "problem_statement": "Operational workflow optimization and process automation.",
            "desired_outcomes": "Increased business efficiency, automation, and revenue growth.",
            "key_features": "User authentication, interactive dashboard, billing, automated reports",
            "integrations": "Payment Gateway, Email, SMS, Analytics",
            "timeline": "8 to 12 weeks for MVP development",
            "budget_range": "Flexible startup budget ($15,000 - $30,000)",
            "tech_preferences": "React, Python FastAPI, PostgreSQL, Redis",
            "scalability_needs": "High scalability auto-scaling cloud deployment",
            "security_requirements": "HTTPS/TLS, OAuth2 authentication, AES-256 encryption",
            "total_requirements": 12,
            "business_model_canvas": {
                "key_partners": ["Technology Partners", "Payment Gateways", "Cloud Hosting Vendors"],
                "key_activities": ["Platform Development", "Customer Onboarding", "Support"],
                "key_resources": ["Proprietary Architecture", "Engineering Team"],
                "value_propositions": ["Streamlined Operations", "Scalable Business Growth"],
                "customer_relationships": ["Self-service", "Automated Support"],
                "channels": ["Web Portal", "Mobile Apps"],
                "customer_segments": ["End Users & Business Clients"],
                "cost_structure": ["Engineering", "Cloud Infrastructure", "Marketing"],
                "revenue_streams": ["Subscription Fees", "Transaction Commission"]
            },
            "proportional_budget": [
                {"category": "Core Architecture & Backend", "percentage": 35, "allocated_amount": "35% of Total Budget", "description": "APIs, Database, Auth"},
                {"category": "Frontend UI/UX & Web/Mobile", "percentage": 25, "allocated_amount": "25% of Total Budget", "description": "User Interface & Dashboards"},
                {"category": "AI & Third-Party Integrations", "percentage": 20, "allocated_amount": "20% of Total Budget", "description": "AI Pipeline & Integrations"},
                {"category": "QA & Security Compliance", "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Automated Testing & Security Audit"},
                {"category": "DevOps & Cloud Deployment", "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Hosting & CI/CD Pipeline"}
            ],
            "doc_language_prompt": f"I can generate the report in {chosen_language}."
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
