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
- Write 1-2 SHORT sentences that acknowledge what the user said AND show you understood it.
- Reference the actual business idea or information from their answer — do NOT be generic.
- Show a small insight or relevant context about their domain — like a knowledgeable business partner would say.
- Keep it natural and concise. Max 2 sentences. No more.
- Do NOT start with hollow words like "Great!", "Wonderful!", "Absolutely!", "Of course!", "Sure!", "Certainly!", "Fantastic!", "Awesome!"
- Do NOT repeat the user's exact words back to them.
- Do NOT write long multi-sentence explanations.
- Do NOT invent facts, revenue numbers, market size, or business details not mentioned by the user.
- GOOD examples:
  User: "I want to start a soap company."
  → "That's an interesting direction. A soap business usually depends on how you source ingredients and reach your end customers."

  User: "I want to open a restaurant."
  → "Nice idea. Restaurants often revolve around smooth ordering, kitchen operations, and building a loyal customer base."

  User: "I provide AI services for small businesses."
  → "That's a useful space to be in. AI services for small businesses can help automate repetitive work and improve day-to-day efficiency."

  User: "I want to build an e-commerce platform."
  → "That makes sense. E-commerce platforms typically need to handle product listings, payments, and reliable order fulfillment."

  User: "We sell agricultural produce to markets."
  → "Got it. Agricultural businesses often deal with supply chain coordination, seasonal demand, and connecting farmers to buyers efficiently."

- For unknown or very early-stage ideas, simply reflect what you understood without inventing domain claims.

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
1. Write 1-2 SHORT sentences acknowledging the user's last answer in "{target_lang}".
   - Be specific to what they said. Show a useful insight about their domain. Do NOT be generic.
   - Do NOT start with hollow praise like "Great!" or "Fantastic!".
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



def synthesize_requirements_from_transcript(application_data: Dict, chosen_language: str = "English") -> Dict[str, Any]:
    """
    Intelligently synthesize structured requirements, domain info, features, tech stack,
    timeline, budget, and business canvas from the user's actual spoken answers.
    """
    transcript = application_data.get("interview_transcript", [])
    raw_answers = []
    if isinstance(transcript, list):
        for item in transcript:
            if isinstance(item, dict) and item.get("answer"):
                raw_answers.append(str(item["answer"]))
            elif isinstance(item, str):
                raw_answers.append(item)
    
    # Also check other merged fields
    for k in ("vapi_summary", "ai_summary", "business_description", "key_points"):
        v = application_data.get(k)
        if v:
            if isinstance(v, list):
                raw_answers.extend([str(x) for x in v if str(x)])
            elif isinstance(v, str):
                raw_answers.append(v)
                
    full_text = " ".join(raw_answers)
    text_lower = full_text.lower()

    # 1. Detect Domain & Project Name
    domain = "Custom Software Solution"
    proj_name = "Business Solution Application"
    app_type = "Web & Mobile Application"

    if any(w in text_lower for w in ["restaurant", "food", "kitchen", "recipe", "dine", "menu", "cafe", "waiter"]):
        domain = "Food & Beverage / Restaurant Hospitality"
        proj_name = "Voice-Enabled Restaurant Operations Platform"
        if "voice" in text_lower:
            proj_name = "Voice-Driven Restaurant Web & Mobile Suite"
    elif any(w in text_lower for w in ["hospital", "doctor", "clinic", "patient", "medical", "health", "pharma"]):
        domain = "Healthcare & Medical Services"
        proj_name = "Healthcare & Patient Care Management Portal"
    elif any(w in text_lower for w in ["e-commerce", "ecommerce", "shop", "store", "product", "sell", "cart", "retail"]):
        domain = "E-Commerce & Digital Retail"
        proj_name = "Digital Commerce & Order Fulfillment Platform"
    elif any(w in text_lower for w in ["school", "college", "student", "teacher", "course", "lms", "learning", "education"]):
        domain = "Education & Learning Management (EdTech)"
        proj_name = "Interactive Educational Management System"
    elif any(w in text_lower for w in ["real estate", "property", "tenant", "rent", "broker", "apartment"]):
        domain = "Real Estate & Property Management"
        proj_name = "Smart Property & Tenant Management Portal"
    elif any(w in text_lower for w in ["logistics", "fleet", "delivery", "tracking", "driver", "transport", "warehouse"]):
        domain = "Logistics & Supply Chain Management"
        proj_name = "Fleet Tracking & Supply Chain Hub"
    elif any(w in text_lower for w in ["ai", "machine learning", "automation", "saas", "workflow"]):
        domain = "AI & Enterprise SaaS Automation"
        proj_name = "AI-Powered Business Automation Platform"

    # Refine project name if user explicitly described their idea
    for ans in raw_answers:
        ans_clean = re.sub(r'^(i want to build|we want to create|i am building|we are building|it is a|i want a)\s+', '', ans, flags=re.IGNORECASE).strip()
        if len(ans_clean) > 8 and any(w in ans_clean.lower() for w in ["app", "platform", "system", "website", "software", "portal"]):
            candidate = ans_clean.split('.')[0].split(',')[0].strip()
            if len(candidate) < 60:
                proj_name = candidate.title()
                break

    # 2. Extract Features & Sub-modules
    features_list = []
    if "kitchen" in text_lower:
        features_list.append("Kitchen Order Display & Workflow App")
    if "inventory" in text_lower:
        features_list.append("Real-Time Inventory & Stock Management")
    if "recipe" in text_lower:
        features_list.append("Recipe Database & Cost Calculation Module")
    if "voice" in text_lower:
        features_list.append("Voice-Activated Navigation & Fast Order Entry")
    if "order" in text_lower or "ordering" in text_lower:
        features_list.append("Live Customer Order Processing & Table Management")
    if "bill" in text_lower or "payment" in text_lower or "invoice" in text_lower:
        features_list.append("Automated Digital Billing & Invoicing")
    if "dashboard" in text_lower or "analytics" in text_lower or "report" in text_lower:
        features_list.append("Executive Analytics & Performance Dashboard")
    
    # Generic fallback features if none detected
    if not features_list:
        features_list = [
            "User Authentication & Role Management",
            "Interactive Operational Dashboard",
            "Data Tracking & Real-Time Sync",
            "Automated Notifications & Reports"
        ]

    # 3. Extract Target Audience
    audience_parts = []
    if any(w in text_lower for w in ["owner", "manager", "admin"]):
        audience_parts.append("Business Owners & Managers")
    if any(w in text_lower for w in ["kitchen", "chef", "staff", "employee", "waiter"]):
        audience_parts.append("Kitchen Staff & Operational Employees")
    if any(w in text_lower for w in ["customer", "client", "guest", "user", "diner"]):
        audience_parts.append("End Customers & Diners")
    if not audience_parts:
        audience_parts = ["Operational Managers", "Team Staff", "End Customers"]
    target_audience_str = ", ".join(audience_parts)

    # 4. Extract Platforms
    if "both" in text_lower or ("web" in text_lower and "mobile" in text_lower):
        app_type = "Web Application & Mobile Apps (iOS / Android)"
    elif "mobile" in text_lower or "app" in text_lower and "web" not in text_lower:
        app_type = "Mobile Application (iOS / Android)"
    elif "web" in text_lower:
        app_type = "Web Application (Responsive Portal)"

    # 5. Extract Integrations
    integrations_list = []
    if "whatsapp" in text_lower:
        integrations_list.append("WhatsApp Business API (Alerts & Confirmations)")
    if any(w in text_lower for w in ["payment", "stripe", "razorpay", "paypal", "upi"]):
        integrations_list.append("Payment Gateway (UPI / Cards / Net Banking)")
    if "sms" in text_lower:
        integrations_list.append("SMS Notification Gateway")
    if "email" in text_lower or "gmail" in text_lower:
        integrations_list.append("Email Integration (SMTP/SendGrid)")
    if not integrations_list:
        integrations_list = ["WhatsApp API", "Secure Payment Gateway", "Automated SMS / Email Alerts"]

    # 6. Extract Timeline
    timeline_str = "8 to 12 weeks for MVP launch"
    t_match = re.search(r'(\d+)\s*(month|week|day|year)s?', text_lower)
    if t_match:
        timeline_str = f"{t_match.group(1)} {t_match.group(2).capitalize()}{'s' if int(t_match.group(1)) > 1 else ''}"
    elif "two months" in text_lower:
        timeline_str = "2 Months"
    elif "one month" in text_lower:
        timeline_str = "1 Month"
    elif "three months" in text_lower:
        timeline_str = "3 Months"

    # 7. Extract Budget
    budget_str = "₹5,00,000 - ₹10,00,000 INR"
    b_match = re.search(r'(\d+)\s*(lakh|lac|crore|thousand|k|cr|inr|rupee)s?', text_lower)
    if "2 lakh" in text_lower or "two lakh" in text_lower:
        budget_str = "₹2,00,000 INR (2 Lakhs)"
    elif "5 lakh" in text_lower or "five lakh" in text_lower:
        budget_str = "₹5,00,000 INR (5 Lakhs)"
    elif "10 lakh" in text_lower or "ten lakh" in text_lower:
        budget_str = "₹10,00,000 INR (10 Lakhs)"
    elif b_match:
        budget_str = f"₹{b_match.group(1)} {b_match.group(2).capitalize()} INR"

    # 8. Extract Tech Stack
    tech_parts = []
    if "react" in text_lower:
        tech_parts.append("Frontend: React.js")
    elif "vue" in text_lower or "angular" in text_lower or "next" in text_lower:
        tech_parts.append("Frontend: Modern Web Framework")
    else:
        tech_parts.append("Frontend: React.js (Tailwind CSS)")

    if "node" in text_lower:
        tech_parts.append("Backend: Node.js / Express")
    elif "python" in text_lower or "fastapi" in text_lower or "django" in text_lower:
        tech_parts.append("Backend: Python FastAPI")
    else:
        tech_parts.append("Backend: Node.js REST API")

    if "postgres" in text_lower or "postgresql" in text_lower:
        tech_parts.append("Database: PostgreSQL")
    elif "mongodb" in text_lower:
        tech_parts.append("Database: MongoDB")
    elif "mysql" in text_lower:
        tech_parts.append("Database: MySQL")
    else:
        tech_parts.append("Database: PostgreSQL")

    tech_preferences_str = " | ".join(tech_parts)

    # 9. Formulate Descriptions
    desc_str = full_text[:250] if full_text else f"Comprehensive {domain} software solution designed to optimize daily workflows."
    prob_str = f"Overcoming manual delays, operational miscommunications, and disconnected workflows in {domain} through automated digital tracking."
    outcome_str = f"Achieve streamlined day-to-day operations, real-time status visibility, reduced overhead costs, and seamless customer interaction."

    if "restaurant" in text_lower or "kitchen" in text_lower:
        desc_str = "A voice-enabled restaurant management platform integrating kitchen order processing, inventory tracking, and recipe management."
        prob_str = "Eliminate verbal miscommunication, kitchen order delays, and inventory wastage through synchronized voice and digital workflows."
        outcome_str = "Accelerated table turnover, accurate real-time inventory control, zero recipe inconsistency, and enhanced diner satisfaction."

    return {
        "ai_summary": f"Business Requirements Specification for {proj_name}. {desc_str} Tailored for {target_audience_str} with {', '.join(features_list[:3])}.",
        "project_name": proj_name,
        "project_type": "Custom Enterprise Solution",
        "business_domain": domain,
        "application_type": app_type,
        "target_audience": target_audience_str,
        "business_description": desc_str,
        "problem_statement": prob_str,
        "desired_outcomes": outcome_str,
        "key_features": ", ".join(features_list),
        "integrations": ", ".join(integrations_list),
        "timeline": timeline_str,
        "budget_range": budget_str,
        "tech_preferences": tech_preferences_str,
        "scalability_needs": "Cloud auto-scaling with secure load-balanced architecture",
        "security_requirements": "SSL/TLS encryption, JWT authentication, Role-based access control (RBAC)",
        "total_requirements": len(features_list) + 5,
        "business_model_canvas": {
            "key_partners": ["Cloud Infrastructure Providers", "Payment Gateways", "WhatsApp Business Partners"],
            "key_activities": ["Platform Development & Testing", "Staff Onboarding & Training", "System Monitoring"],
            "key_resources": ["Proprietary Software Architecture", "Cloud Database", "Engineering Team"],
            "value_propositions": [f"Streamlined {domain} Workflows", "Real-Time Operational Visibility", "Voice-Enabled Productivity"],
            "customer_relationships": ["Self-Service Dashboard", "Automated Support", "Dedicated Technical Assistance"],
            "channels": [app_type, "WhatsApp Alerts", "Web Management Portal"],
            "customer_segments": audience_parts,
            "cost_structure": ["Software Engineering", "Cloud Hosting Infrastructure", "Integration & Maintenance"],
            "revenue_streams": ["SaaS Subscription License", "Transaction Processing Fee", "Custom Feature Add-ons"]
        },
        "budget_planner": {
            "total_budget_inr": budget_str,
            "development_cost_inr": "40% of Total Budget",
            "marketing_budget_inr": "20% of Total Budget",
            "operations_cost_inr": "20% of Total Budget",
            "contingency_fund_inr": "20% of Total Budget",
            "break_even_timeline": "4 to 6 months",
            "expected_roi": "180% within first year",
            "breakdown": [
                {"category": "Core Architecture & Backend", "percentage": 35, "allocated_inr": "35%", "description": "API Services, DB Schema, Authentication"},
                {"category": "Frontend UI/UX & Mobile Apps", "percentage": 25, "allocated_inr": "25%", "description": "Web App UI, Mobile Interfaces"},
                {"category": "Third-Party Integrations & Voice", "percentage": 20, "allocated_inr": "20%", "description": "Voice Navigation, WhatsApp & Payment APIs"},
                {"category": "QA & Security Audit", "percentage": 10, "allocated_inr": "10%", "description": "Automated Testing, Security Hardening"},
                {"category": "Deployment & Buffer", "percentage": 10, "allocated_inr": "10%", "description": "Cloud DevOps Setup, Contingency Reserve"}
            ]
        },
        "proportional_budget": [
            {"category": "Core Architecture & Backend", "percentage": 35, "allocated_amount": "35% of Total Budget", "description": "API Services, DB Schema, Authentication"},
            {"category": "Frontend UI/UX & Mobile Apps", "percentage": 25, "allocated_amount": "25% of Total Budget", "description": "Web App UI, Mobile Interfaces"},
            {"category": "Third-Party Integrations & Voice", "percentage": 20, "allocated_amount": "20% of Total Budget", "description": "Voice Navigation, WhatsApp & Payment APIs"},
            {"category": "Quality Assurance & Security Audit", "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Automated Testing, Security Hardening"},
            {"category": "Cloud Infrastructure & Contingency", "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Cloud Deployment, CI/CD Pipeline"}
        ],
        "doc_language_prompt": f"Generated requirement specification in {chosen_language}."
    }


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

    # Synthesize based on actual spoken transcript
    synthesized = synthesize_requirements_from_transcript(application_data, chosen_language)

    if not GEMINI_API_KEY or "your_gemini_api_key" in GEMINI_API_KEY:
        return synthesized

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = f"""You are an executive Business Analyst and native technical author generating a Business Requirement Specification (BRD / SRS), Business Model Canvas, and Detailed Budget Planner in Indian Rupees (INR ₹) in {chosen_language}.

Interview Data:
{json.dumps(application_data, indent=2)}

Base Extracted Information:
{json.dumps(synthesized, indent=2)}

Refine and return a comprehensive JSON object matching the exact keys of the base extracted information, ensuring full fidelity to the user's spoken statements."""

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
        print(f"Summary generation error, returning synthesized data: {e}")
        return synthesized


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


async def parse_profile_information(
    user_transcript: str,
    current_phase: str,
    current_name: Optional[str] = "",
    current_phone: Optional[str] = "",
) -> Dict[str, Any]:
    """
    Parse the user's transcript to extract name, phone, and business idea.
    Recognizes corrections, handles natural variations, and normalizes output.
    """
    if not GEMINI_API_KEY:
        # Fallback for demo mode
        return {
            "name": current_name,
            "phone": current_phone,
            "business_idea": None,
            "is_correction": False,
            "corrected_field": None,
            "uncertain": True
        }

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        
        prompt = f"""You are Helix, an intelligent AI business consultant assistant.
Your task is to analyze the user's spoken or typed transcript and extract their profile details (name and phone number), detect any business idea, and identify if they are correcting previously provided details.

CURRENT CONTEXT:
- Expected Field/Phase: {current_phase} (This is the information we are currently prompting for or in)
- Currently captured Name: "{current_name or ''}"
- Currently captured Phone: "{current_phone or ''}"
- User Input: "{user_transcript}"

EXTRACTION RULES:
1. NAME:
   - Extract only the person's name. Remove conversational prefixes (e.g. "My name is", "I'm", "You can call me", "Actually, my name is").
   - Remove unnecessary punctuation.
   - Do NOT accept an entire sentence as the name.
   - If expected field is "name", prioritize extracting a person's name.
   
2. PHONE:
   - Extract only the digits of the phone number.
   - Convert spoken number words to digits (e.g. "nine eight" -> "98", "double nine" -> "99").
   - Do not invent missing digits.
   - If expected field is "phone", prioritize extracting a phone number.

3. BUSINESS IDEA:
   - Extract any mention of starting a business or a business idea. Keep it concise.

4. CORRECTION:
   - Detect if the user is correcting previously captured information (e.g. "Actually, my name is Yokesh Kumar", "Sorry, my number is...").
   - Set "is_correction" to true if they are updating a value that was already captured.
   - Identify which field is being corrected: "name", "phone", "both", or null.

Return ONLY a valid JSON object matching this schema (do not include markdown block, output only JSON):
{{
  "name": "extracted name or null",
  "phone": "extracted digits only or null",
  "business_idea": "extracted business idea or null",
  "is_correction": true or false,
  "corrected_field": "name" or "phone" or "both" or null,
  "uncertain": true or false
}}"""

        try:
            gen_config = genai.GenerationConfig(temperature=0.1, response_mime_type="application/json")
        except TypeError:
            gen_config = genai.GenerationConfig(temperature=0.1)

        response = await model.generate_content_async(
            prompt,
            generation_config=gen_config
        )
        text = response.text.strip()
        print("RAW PROFILE PARSE RESPONSE:", repr(text))
        
        return robust_json_loads(text)
    except Exception as e:
        print(f"Error in parse_profile_information: {e}")
        return {
            "name": None,
            "phone": None,
            "business_idea": None,
            "is_correction": False,
            "corrected_field": None,
            "uncertain": True
        }

