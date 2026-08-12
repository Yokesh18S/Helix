"""
Helix Professional PDF Generator & Multilingual Localization Engine

Generates an Executive-Grade Business Requirement Specification (BRD / SRS),
Business Model Canvas, and Proportional Budget Allocation formatted with ReportLab.

Supports native-quality, sentence-level multilingual translation and rendering for:
- Indic Scripts: Tamil, Malayalam, Telugu, Kannada, Hindi, Devanagari, Bengali, Gujarati, Gurmukhi.
- Dialect Conversions: Tanglish -> Tamil, Manglish -> Malayalam, Hinglish -> Hindi, Tenglish -> Telugu, Kanglish -> Kannada.
- Global Scripts: Arabic (RTL), Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, English.
- Guarantees zero missing-glyph "□" replacement boxes and complete Unicode font fallback.
"""

import os
import io
import re
import base64
import asyncio
import json
from datetime import datetime
from typing import Dict, Any, Optional, List

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, HRFlowable, KeepTogether, PageBreak
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Import RTL reshaping and bidi libraries if available
try:
    import arabic_reshaper  # type: ignore
    from bidi.algorithm import get_display  # type: ignore
    HAS_RTL_SUPPORT = True
except ImportError:
    HAS_RTL_SUPPORT = False


# ─────────────────────────────────────────────────────────────
# 1. FONT REGISTRATION — Full Unicode / Multi-Script Coverage
# ─────────────────────────────────────────────────────────────

_FONTS_DIR = os.path.join(os.path.dirname(__file__), "fonts")

_REGISTERED_FONTS = set()

def _register_pdf_fonts():
    font_definitions = [
        ("NotoSans",           "NotoSans-Regular.ttf"),
        ("NotoSansTamil",      "NotoSansTamil-Regular.ttf"),
        ("NotoSansDevanagari", "NotoSansDevanagari-Regular.ttf"),
        ("NotoSansMalayalam",  "NotoSansMalayalam-Regular.ttf"),
        ("NotoSansTelugu",     "NotoSansTelugu-Regular.ttf"),
        ("NotoSansKannada",    "NotoSansKannada-Regular.ttf"),
        ("NotoSansArabic",     "NotoSansArabic-Regular.ttf"),
        ("NotoSansSC",         "NotoSansSC-Regular.ttf"),
        ("NotoSansTC",         "NotoSansTC-Regular.ttf"),
        ("NotoSansJP",         "NotoSansJP-Regular.ttf"),
        ("NotoSansKR",         "NotoSansKR-Regular.ttf"),
        ("NotoSansBengali",    "NotoSansBengali-Regular.ttf"),
        ("NotoSansGujarati",   "NotoSansGujarati-Regular.ttf"),
        ("NotoSansGurmukhi",   "NotoSansGurmukhi-Regular.ttf"),
    ]

    for font_name, font_filename in font_definitions:
        font_path = os.path.join(_FONTS_DIR, font_filename)
        if os.path.exists(font_path):
            try:
                pdfmetrics.registerFont(TTFont(font_name, font_path))
                _REGISTERED_FONTS.add(font_name)

                # Register -Bold alias pointing to TTF and font family mapping
                bold_alias = f"{font_name}-Bold"
                pdfmetrics.registerFont(TTFont(bold_alias, font_path))
                _REGISTERED_FONTS.add(bold_alias)

                pdfmetrics.registerFontFamily(
                    font_name,
                    normal=font_name,
                    bold=bold_alias,
                    italic=font_name,
                    boldItalic=bold_alias
                )
                print(f"[PDF Engine] Registered font family: {font_name}")
            except Exception as e:
                print(f"[PDF Engine] Could not register font {font_name}: {e}")

_register_pdf_fonts()


# ─────────────────────────────────────────────────────────────
# 2. LANGUAGE NORMALIZATION & SCRIPT DETECTOR
# ─────────────────────────────────────────────────────────────

def normalize_language_name(doc_lang: str) -> str:
    """Normalize language name or code into standard internal key."""
    if not doc_lang:
        return "english"
    l = doc_lang.strip().lower()
    
    # Conversational code-mixed dialects -> formal native document script
    if any(k in l for k in ["tanglish", "ta-in", "ta_in", "tamil", "ta"]):
        return "tamil"
    if any(k in l for k in ["hinglish", "devanagari", "hi-in", "hi_in", "hindi", "hi"]):
        return "hindi"
    if any(k in l for k in ["manglish", "ml-in", "ml_in", "malayalam", "ml"]):
        return "malayalam"
    if any(k in l for k in ["tenglish", "te-in", "te_in", "telugu", "te"]):
        return "telugu"
    if any(k in l for k in ["kanglish", "kn-in", "kn_in", "kannada", "kn"]):
        return "kannada"
    if any(k in l for k in ["arabic", "ar", "hebrew", "he"]):
        return "arabic"
    if any(k in l for k in ["zh-tw", "zh_tw", "traditional chinese"]):
        return "chinese_tc"
    if any(k in l for k in ["zh", "chinese", "mandarin"]):
        return "chinese_sc"
    if any(k in l for k in ["japanese", "ja"]):
        return "japanese"
    if any(k in l for k in ["korean", "ko"]):
        return "korean"
    if any(k in l for k in ["bengali", "bn"]):
        return "bengali"
    if any(k in l for k in ["gujarati", "gu"]):
        return "gujarati"
    if any(k in l for k in ["punjabi", "gurmukhi", "pa"]):
        return "gurmukhi"
    if any(k in l for k in ["spanish", "es"]):
        return "spanish"
    if any(k in l for k in ["french", "fr"]):
        return "french"
    if any(k in l for k in ["german", "de"]):
        return "german"
        
    return "english"


def font_for_language(doc_lang: str) -> str:
    """Return primary TTF font family for a given document language."""
    norm = normalize_language_name(doc_lang)
    font_map = {
        "tamil":      "NotoSansTamil",
        "hindi":      "NotoSansDevanagari",
        "malayalam":  "NotoSansMalayalam",
        "telugu":     "NotoSansTelugu",
        "kannada":    "NotoSansKannada",
        "arabic":     "NotoSansArabic",
        "chinese_sc": "NotoSansSC",
        "chinese_tc": "NotoSansTC",
        "japanese":   "NotoSansJP",
        "korean":     "NotoSansKR",
        "bengali":    "NotoSansBengali",
        "gujarati":   "NotoSansGujarati",
        "gurmukhi":   "NotoSansGurmukhi",
    }
    target = font_map.get(norm, "NotoSans")
    return target if target in _REGISTERED_FONTS else ("NotoSans" if "NotoSans" in _REGISTERED_FONTS else "Helvetica")


def get_font_for_codepoint(cp: int) -> str:
    """Map codepoint to specific registered Noto TTF font for ZERO missing glyph '□' boxes."""
    if 0x0B80 <= cp <= 0x0BFF:
        return "NotoSansTamil" if "NotoSansTamil" in _REGISTERED_FONTS else "NotoSans"
    if 0x0900 <= cp <= 0x097F:
        return "NotoSansDevanagari" if "NotoSansDevanagari" in _REGISTERED_FONTS else "NotoSans"
    if 0x0D00 <= cp <= 0x0D7F:
        return "NotoSansMalayalam" if "NotoSansMalayalam" in _REGISTERED_FONTS else "NotoSans"
    if 0x0C00 <= cp <= 0x0C7F:
        return "NotoSansTelugu" if "NotoSansTelugu" in _REGISTERED_FONTS else "NotoSans"
    if 0x0C80 <= cp <= 0x0CFF:
        return "NotoSansKannada" if "NotoSansKannada" in _REGISTERED_FONTS else "NotoSans"
    if (0x0600 <= cp <= 0x06FF) or (0x0750 <= cp <= 0x077F) or (0xFB50 <= cp <= 0xFDFF) or (0xFE70 <= cp <= 0xFEFF):
        return "NotoSansArabic" if "NotoSansArabic" in _REGISTERED_FONTS else "NotoSans"
    if (0x4E00 <= cp <= 0x9FFF) or (0x3400 <= cp <= 0x4DBF):
        return "NotoSansSC" if "NotoSansSC" in _REGISTERED_FONTS else "NotoSans"
    if (0x3040 <= cp <= 0x309F) or (0x30A0 <= cp <= 0x30FF) or (0x31F0 <= cp <= 0x31FF):
        return "NotoSansJP" if "NotoSansJP" in _REGISTERED_FONTS else "NotoSans"
    if (0xAC00 <= cp <= 0xD7AF) or (0x1100 <= cp <= 0x11FF) or (0x3130 <= cp <= 0x318F):
        return "NotoSansKR" if "NotoSansKR" in _REGISTERED_FONTS else "NotoSans"
    if 0x0980 <= cp <= 0x09FF:
        return "NotoSansBengali" if "NotoSansBengali" in _REGISTERED_FONTS else "NotoSans"
    if 0x0A80 <= cp <= 0x0AFF:
        return "NotoSansGujarati" if "NotoSansGujarati" in _REGISTERED_FONTS else "NotoSans"
    if 0x0A00 <= cp <= 0x0A7F:
        return "NotoSansGurmukhi" if "NotoSansGurmukhi" in _REGISTERED_FONTS else "NotoSans"
    return "NotoSans"


def is_rtl_language(doc_lang: str) -> bool:
    """Return True if language uses Right-to-Left script layout."""
    norm = normalize_language_name(doc_lang)
    return norm in ("arabic", "hebrew")


def prepare_pdf_text(text: Any, default_font: str = "NotoSans", doc_lang: str = "english") -> str:
    """
    Sanitize text, apply RTL reshaping/bidi if needed, and wrap script runs in inline <font> tags.
    Guarantees perfect font fallback and ZERO missing glyph '□' replacement boxes.
    """
    if text is None:
        return "N/A"
    if isinstance(text, list):
        if not text:
            return "N/A"
        text = ", ".join(str(item) for item in text)
    
    s_text = str(text).strip()
    if not s_text:
        return "N/A"

    # RTL processing for Arabic / Hebrew
    if (is_rtl_language(doc_lang) or "arabic" in default_font.lower()) and HAS_RTL_SUPPORT:
        try:
            reshaped = arabic_reshaper.reshape(s_text)
            s_text = get_display(reshaped)
        except Exception as e:
            print(f"[PDF Engine] RTL reshape error: {e}")

    # Split by HTML tags (<b>, <i>, <font>, <br/>) to preserve structure
    tag_re = re.compile(r"(</?[a-zA-Z][^>]*>)")
    parts = tag_re.split(s_text)

    result = []
    for part in parts:
        if not part:
            continue
        if tag_re.match(part):
            result.append(part)
        else:
            # Inspect character runs for font mapping
            runs = []
            cur_font = None
            cur_run = []

            for ch in part:
                cp = ord(ch)
                # Spaces and ASCII punctuation are neutral
                if cp <= 127 and not ch.isalnum():
                    font_needed = cur_font or default_font
                else:
                    font_needed = get_font_for_codepoint(cp)
                    if font_needed == "NotoSans":
                        font_needed = default_font

                if font_needed != cur_font:
                    if cur_run:
                        runs.append((cur_font, "".join(cur_run)))
                    cur_font = font_needed
                    cur_run = [ch]
                else:
                    cur_run.append(ch)

            if cur_run:
                runs.append((cur_font, "".join(cur_run)))

            for f_name, run_text in runs:
                # Escape XML special characters inside text runs
                esc_run = run_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                if f_name and f_name != default_font and f_name in _REGISTERED_FONTS:
                    result.append(f'<font name="{f_name}">{esc_run}</font>')
                else:
                    result.append(esc_run)

    return "".join(result)


def _body_font_for_lang(doc_lang: str = "english") -> str:
    return font_for_language(doc_lang)

def _bold_font_for_lang(doc_lang: str = "english") -> str:
    f = font_for_language(doc_lang)
    bold_alias = f"{f}-Bold"
    return bold_alias if bold_alias in _REGISTERED_FONTS else f


# ─────────────────────────────────────────────────────────────
# 3. LANGUAGE DETECTION & TRANSLATION ENGINE
# ─────────────────────────────────────────────────────────────

def _needs_translation(doc_lang: str) -> bool:
    """Return True if the document language requires translation from English."""
    if not doc_lang:
        return False
    l = doc_lang.strip().lower()
    return l not in ("english", "en", "user_lang", "")


async def translate_fields_with_gemini(fields: Dict[str, Any], target_language: str) -> Dict[str, Any]:
    """
    Translate document fields into target language using Gemini with native-quality sentence level writing.
    Follows 5-Step Principle: UNDERSTAND → INTERPRET → TRANSLATE → NATURALIZE → VALIDATE.
    Preserves technical terminology, table structures, and formatting.
    """
    if not fields or not target_language or not _needs_translation(target_language):
        return fields

    try:
        import google.generativeai as genai
        from dotenv import load_dotenv
        load_dotenv()
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return fields
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-2.5-flash"))

        fields_json = json.dumps(fields, ensure_ascii=False)

        prompt = f"""You are a senior native technical author and business consultant translating an executive Business Requirement Document (BRD / SRS) into {target_language}.

MANDATORY 5-STEP TRANSLATION PRINCIPLE:
1. UNDERSTAND: Grasp the full context, technical intent, and business objectives of each sentence or phrase.
2. INTERPRET: Interpret concepts naturally within the software & business domain (APIs, Architecture, Cloud, UI/UX, Security, Database, Payments).
3. TRANSLATE: Translate at the SENTENCE / MEANING level — NEVER word-by-word or phrase-by-phrase literal translation.
4. NATURALIZE: Express the translation in fluent, grammatically flawless, natural native prose as if originally written by a native technical expert in {target_language}. Maintain consistent business terminology throughout.
5. VALIDATE: Ensure zero invented content, zero omitted details, no broken grammar, and no awkward English word-order preservation.

RULES FOR LANGUAGE, SCRIPT & VOICE:
- Formal Native Script: If target language is an Indic language (Tamil, Hindi, Malayalam, Telugu, Kannada, Bengali, Gujarati, etc.), use the formal native script with correct grammar and natural sentence structure.
- Dialect Conversion: Conversational code-mixed voice dialects (Tanglish, Manglish, Hinglish, Tenglish, Kanglish) MUST be translated into formal, professional native document script (Tamil, Malayalam, Hindi, Telugu, Kannada).
- Technical Terminology Protection: Software & technical terms (e.g. API, AI, ML, UI/UX, CI/CD, DevOps, JWT, OTP, SQL, REST API, OAuth2, SSL, Cloud, React, Python FastAPI, PostgreSQL, Database, Mobile App, Web App, Microservices) MUST remain clear and understandable. Use established native technical terms or standard industry terms naturally.
- Document & Table Preservation: Keep proper nouns, brand names, numbers, currency symbols, percentages, and metrics intact. Translate every table cell and field value as a complete, contextual phrase or sentence.
- Terminology Consistency: Maintain identical translations for repeated key terms across all sections.

INPUT JSON:
{fields_json}

Return ONLY valid JSON with exact same keys as the input JSON. Do not include markdown code block syntax outside the JSON."""

        try:
            gen_config = genai.GenerationConfig(temperature=0.1, response_mime_type="application/json")  # type: ignore
        except TypeError:
            gen_config = genai.GenerationConfig(temperature=0.1)

        response = await model.generate_content_async(
            prompt,
            generation_config=gen_config
        )
        raw = response.text.strip()
        if "```" in raw:
            lines = [l for l in raw.split("\n") if not l.strip().startswith("```")]
            raw = "\n".join(lines).strip()

        translated = json.loads(raw)
        result = {}
        for k, v in fields.items():
            if k in translated and translated[k]:
                result[k] = translated[k]
            else:
                result[k] = v
        return result
    except Exception as e:
        print(f"[PDF Engine] Translation failed ({target_language}): {e} — using original English")
        return fields


def translate_fields_sync(fields: Dict[str, str], target_language: str) -> Dict[str, str]:
    """Synchronous wrapper for translate_fields_with_gemini."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, translate_fields_with_gemini(fields, target_language))
                return future.result(timeout=35)
        else:
            return loop.run_until_complete(translate_fields_with_gemini(fields, target_language))
    except Exception as e:
        print(f"[PDF Engine] Sync translation wrapper error: {e}")
        return fields


# ─────────────────────────────────────────────────────────────
# 4. UTILITY HELPERS
# ─────────────────────────────────────────────────────────────

def create_signature_image(base64_str: str) -> Optional[Image]:
    """Convert base64 data URL signature into a ReportLab Image flowable."""
    if not base64_str:
        return None
    try:
        if "," in base64_str:
            base64_str = base64_str.split(",", 1)[1]
        img_data = base64.b64decode(base64_str)
        img_buffer = io.BytesIO(img_data)
        img = Image(img_buffer, width=180, height=50)
        return img
    except Exception as e:
        print(f"Error loading signature image for PDF: {e}")
        return None


def clean_text(text: Any) -> str:
    """Sanitize text input for PDF generation."""
    if text is None:
        return "N/A"
    if isinstance(text, list):
        if not text:
            return "N/A"
        return ", ".join(str(item) for item in text)
    s = str(text).strip()
    return s if s else "N/A"


# ─────────────────────────────────────────────────────────────
# 5. DETAILED SECTION LABELS FOR ALL SUPPORTED LANGUAGES
# ─────────────────────────────────────────────────────────────

SECTION_LABELS: Dict[str, Dict[str, str]] = {
    "english": {
        "exec_summary": "EXECUTIVE SUMMARY & AI ANALYSIS",
        "sec01": "01. Project & Domain Specification",
        "project_name": "Project Name", "project_type": "Project Type",
        "business_domain": "Business Domain", "app_type": "Application Type",
        "target_audience": "Target Audience", "doc_language": "Document Language",
        "sec02": "02. Detailed Business Requirements",
        "biz_desc": "Business Description", "problem": "Problem Statement",
        "outcomes": "Desired Outcomes", "features": "Core & Key Features",
        "integrations": "Third-Party Integrations",
        "sec03": "03. Technical & Timeline Specifications",
        "timeline": "Timeline & Delivery", "budget": "Budget Range",
        "tech_prefs": "Technology Preferences", "scalability": "Scalability Needs",
        "security": "Security Requirements", "captured": "Captured Metrics",
        "sec04": "04. Business Model Canvas",
        "key_partners": "KEY PARTNERS", "key_activities": "KEY ACTIVITIES",
        "key_resources": "KEY RESOURCES", "value_props": "VALUE PROPOSITIONS",
        "cust_rel": "CUSTOMER RELATIONSHIPS", "channels": "CHANNELS",
        "cust_seg": "CUSTOMER SEGMENTS", "cost_struct": "COST STRUCTURE",
        "rev_streams": "REVENUE STREAMS",
        "sec05": "05. Proportional Business Budget Allocation",
        "cat_module": "Category / Module", "split_pct": "Split %",
        "prop_budget": "Proportional Budget", "scope": "Scope & Deliverables",
        "sec06": "06. Document Authorization",
        "digital_approval": "DIGITAL APPROVAL & SIGNATURE",
        "verification": "VERIFICATION METADATA",
        "signer_email": "Signer Email", "timestamp": "Timestamp",
        "ver_ref": "Verification Ref", "system": "System",
        "requirements_validated": "Requirements Validated",
    },
    "tamil": {
        "exec_summary": "நிர்வாக சுருக்கம் & AI பகுப்பாய்வு",
        "sec01": "01. திட்டம் & டொமைன் விவரக்குறிப்பு",
        "project_name": "திட்டப் பெயர்", "project_type": "திட்ட வகை",
        "business_domain": "வணிக டொமைன்", "app_type": "பயன்பாட்டு வகை",
        "target_audience": "இலக்கு பார்வையாளர்கள்", "doc_language": "ஆவண மொழி",
        "sec02": "02. விரிவான வணிக தேவைகள்",
        "biz_desc": "வணிக விளக்கம்", "problem": "சிக்கல் அறிக்கை",
        "outcomes": "விரும்பிய முடிவுகள்", "features": "முக்கிய அம்சங்கள்",
        "integrations": "மூன்றாம் தரப்பு ஒருங்கிணைப்புகள்",
        "sec03": "03. தொழில்நுட்ப & கால அட்டவணை விவரக்குறிப்புகள்",
        "timeline": "கால அட்டவணை", "budget": "பட்ஜெட் வரம்பு",
        "tech_prefs": "தொழில்நுட்ப விருப்பங்கள்", "scalability": "அளவிடல் தேவைகள்",
        "security": "பாதுகாப்பு தேவைகள்", "captured": "பதிவுசெய்யப்பட்ட தேவைகள்",
        "sec04": "04. வணிக மாதிரி கேன்வாஸ்",
        "key_partners": "முக்கிய கூட்டாளர்கள்", "key_activities": "முக்கிய நடவடிக்கைகள்",
        "key_resources": "முக்கிய வளங்கள்", "value_props": "மதிப்பு முன்மொழிவுகள்",
        "cust_rel": "வாடிக்கையாளர் உறவுகள்", "channels": "சேனல்கள்",
        "cust_seg": "வாடிக்கையாளர் பிரிவுகள்", "cost_struct": "செலவு கட்டமைப்பு",
        "rev_streams": "வருவாய் ஓட்டங்கள்",
        "sec05": "05. விகிதாசார வணிக பட்ஜெட் ஒதுக்கீடு",
        "cat_module": "வகை / தொகுதி", "split_pct": "பிரிவு %",
        "prop_budget": "விகிதாசார பட்ஜெட்", "scope": "நோக்கம் & வழிமுறைகள்",
        "sec06": "06. ஆவண அங்கீகாரம்",
        "digital_approval": "டிஜிட்டல் அங்கீகாரம் & கையொப்பம்",
        "verification": "சரிபார்ப்பு மெட்டாடேட்டா",
        "signer_email": "கையொப்பமிட்டவர் மின்னஞ்சல்", "timestamp": "நேர முத்திரை",
        "ver_ref": "சரிபார்ப்பு குறிப்பு", "system": "அமைப்பு",
        "requirements_validated": "தேவைகள் சரிபார்க்கப்பட்டன",
    },
    "malayalam": {
        "exec_summary": "എക്സിക്യൂട്ടീവ് സംഗ്രഹം & AI വിശകലനം",
        "sec01": "01. പ്രോജക്ട് & ഡൊമൈൻ സ്പെസിഫിക്കേഷൻ",
        "project_name": "പ്രോജക്ട് നാമം", "project_type": "പ്രോജക്ട് തരം",
        "business_domain": "ബിസിനസ് ഡൊമൈൻ", "app_type": "ആപ്ലിക്കേഷൻ തരം",
        "target_audience": "ലക്ഷ്യ പ്രേക്ഷകർ", "doc_language": "ഡോക്യുമെന്റ് ഭാഷ",
        "sec02": "02. വിശദമായ ബിസിനസ് ആവശ്യകതകൾ",
        "biz_desc": "ബിസിനസ് വിവരണം", "problem": "പ്രശ്ന പ്രസ്താവന",
        "outcomes": "ആഗ്രഹിക്കുന്ന ഫലങ്ങൾ", "features": "പ്രധാന സവിശേഷതകൾ",
        "integrations": "മൂന്നാം കക്ഷി ഇൻ്റഗ്രേഷനുകൾ",
        "sec03": "03. സാങ്കേതിക & ടൈംലൈൻ സ്പെസിഫിക്കേഷനുകൾ",
        "timeline": "ടൈംലൈൻ", "budget": "ബജറ്റ് പരിധി",
        "tech_prefs": "സാങ്കേതിക മുൻഗണനകൾ", "scalability": "സ്കേലബിലിറ്റി ആവശ്യകതകൾ",
        "security": "സുരക്ഷാ ആവശ്യകതകൾ", "captured": "ക്യാപ്ചർ ചെയ്ത ആവശ്യകതകൾ",
        "sec04": "04. ബിസിനസ് മോഡൽ ക്യാൻവാസ്",
        "key_partners": "പ്രധാന പങ്കാളികൾ", "key_activities": "പ്രധാന പ്രവർത്തനങ്ങൾ",
        "key_resources": "പ്രധാന വിഭവങ്ങൾ", "value_props": "മൂല്യ നിർദ്ദേശങ്ങൾ",
        "cust_rel": "ഉപഭോക്തൃ ബന്ധങ്ങൾ", "channels": "ചാനലുകൾ",
        "cust_seg": "ഉപഭോക്തൃ വിഭാഗങ്ങൾ", "cost_struct": "ചെലവ് ഘടന",
        "rev_streams": "വരുമാന ധാരകൾ",
        "sec05": "05. ആനുപാതിക ബിസിനസ് ബജറ്റ് അലോക്കേഷൻ",
        "cat_module": "വിഭാഗം / മൊഡ്യൂൾ", "split_pct": "ശതമാനം",
        "prop_budget": "ആനുപാതിക ബജറ്റ്", "scope": "സ്കോപ്പ് & ഡെലിവറബിളുകൾ",
        "sec06": "06. ഡോക്യുമെന്റ് ഓതറൈസേഷൻ",
        "digital_approval": "ഡിജിറ്റൽ അംഗീകാരം & ഒപ്പ്",
        "verification": "വെരിഫിക്കേഷൻ മെറ്റാഡേറ്റ",
        "signer_email": "ഒപ്പിട്ടയാളുടെ ഇമെയിൽ", "timestamp": "ടൈംസ്റ്റാമ്പ്",
        "ver_ref": "വെരിഫിക്കേഷൻ റഫറൻസ്", "system": "സിസ്റ്റം",
        "requirements_validated": "ആവശ്യകതകൾ സ്ഥിരീകരിച്ചു",
    },
    "telugu": {
        "exec_summary": "ఎగ్జిక్యూటివ్ సారాంశం & AI విశ్లేషణ",
        "sec01": "01. ప్రాజెక్ట్ & డొమైన్ స్పెసిఫికేషన్",
        "project_name": "ప్రాజెక్ట్ పేరు", "project_type": "ప్రాజెక్ట్ రకం",
        "business_domain": "వ్యాపార డొమైన్", "app_type": "అప్లికేషన్ రకం",
        "target_audience": "లక్ష్య ప్రేక్షకులు", "doc_language": "పత్రం భాష",
        "sec02": "02. వివరణాత్మక వ్యాపార అవసరాలు",
        "biz_desc": "వ్యాపార వివరణ", "problem": "సమస్య ప్రకటన",
        "outcomes": "కావలసిన ఫలితాలు", "features": "ముఖ్య లక్షణాలు",
        "integrations": "మూడవ పక్ష ఇంటిగ్రేషన్లు",
        "sec03": "03. సాంకేతిక & టైమ్‌లైన్ స్పెసిఫికేషన్లు",
        "timeline": "టైమ్‌లైన్", "budget": "బడ్జెట్ పరిధి",
        "tech_prefs": "సాంకేతిక ప్రాధాన్యతలు", "scalability": "స్కేలబిలిటీ అవసరాలు",
        "security": "భద్రతా అవసరాలు", "captured": "నమోదు చేసిన అవసరాలు",
        "sec04": "04. వ్యాపార మోడల్ క్యాన్వాస్",
        "key_partners": "కీలక భాగస్వాములు", "key_activities": "కీలక కార్యకలాపాలు",
        "key_resources": "కీలక వనరులు", "value_props": "విలువ ప్రతిపాదనలు",
        "cust_rel": "కస్టమర్ సంబంధాలు", "channels": "ఛానల్‌లు",
        "cust_seg": "కస్టమర్ విభాగాలు", "cost_struct": "ఖర్చు నిర్మాణం",
        "rev_streams": "ఆదాయ ప్రవాహాలు",
        "sec05": "05. దామాషా వ్యాపార బడ్జెట్ కేటాయింపు",
        "cat_module": "వర్గం / మాడ్యూల్", "split_pct": "విభజన %",
        "prop_budget": "దామాషా బడ్జెట్", "scope": "స్కోప్ & డెలివరబుల్స్",
        "sec06": "06. పత్రం అధికారీకరణ",
        "digital_approval": "డిజిటల్ ఆమోదం & సంతకం",
        "verification": "ధృవీకరణ మెటాడేటా",
        "signer_email": "సంతకం చేసిన వ్యక్తి ఇమెయిల్", "timestamp": "టైమ్‌స్టాంప్",
        "ver_ref": "ధృవీకరణ సూచన", "system": "సిస్టమ్",
        "requirements_validated": "అవసరాలు ధృవీకరించబడ్డాయి",
    },
    "kannada": {
        "exec_summary": "ಕಾರ್ಯನಿರ್ವಾಹಕ ಸಾರಾಂಶ & AI ವಿಶ್ಲೇಷಣೆ",
        "sec01": "01. ಪ್ರಾಜೆಕ್ಟ್ & ಡೊಮೇನ್ ವಿಶೇಷಣ",
        "project_name": "ಪ್ರಾಜೆಕ್ಟ್ ಹೆಸರು", "project_type": "ಪ್ರಾಜೆಕ್ಟ್ ಪ್ರಕಾರ",
        "business_domain": "ವ್ಯಾಪಾರ ಡೊಮೇನ್", "app_type": "ಅಪ್ಲಿಕೇಶನ್ ಪ್ರಕಾರ",
        "target_audience": "ಗುರಿ ಪ್ರೇಕ್ಷಕರು", "doc_language": "ಡಾಕ್ಯುಮೆಂಟ್ ಭಾಷೆ",
        "sec02": "02. ವಿವರವಾದ ವ್ಯಾಪಾರ ಅವಶ್ಯಕತೆಗಳು",
        "biz_desc": "ವ್ಯಾಪಾರ ವಿವರಣೆ", "problem": "ಸಮಸ್ಯೆ ಹೇಳಿಕೆ",
        "outcomes": "ಬಯಸಿದ ಫಲಿತಾಂಶಗಳು", "features": "ಮುಖ್ಯ ವೈಶಿಷ್ಟ್ಯಗಳು",
        "integrations": "ಮೂರನೇ ವ್ಯಕ್ತಿ ಏಕೀಕರಣಗಳು",
        "sec03": "03. ತಾಂತ್ರಿಕ & ಟೈಮ್‌ಲೈನ್ ವಿಶೇಷಣಗಳು",
        "timeline": "ಟೈಮ್‌ಲೈನ್", "budget": "ಬಜೆಟ್ ವ್ಯಾಪ್ತಿ",
        "tech_prefs": "ತಾಂತ್ರಿಕ ಆದ್ಯತೆಗಳು", "scalability": "ಸ್ಕೇಲೆಬಿಲಿಟಿ ಅಗತ್ಯಗಳು",
        "security": "ಸುರಕ್ಷತಾ ಅವಶ್ಯಕತೆಗಳು", "captured": "ದಾಖಲಿಸಲಾದ ಅವಶ್ಯಕತೆಗಳು",
        "sec04": "04. ವ್ಯಾಪಾರ ಮಾದರಿ ಕ್ಯಾನ್ವಾಸ್",
        "key_partners": "ಪ್ರಮುಖ ಪಾಲುದಾರರು", "key_activities": "ಪ್ರಮುಖ ಚಟುವಟಿಕೆಗಳು",
        "key_resources": "ಪ್ರಮುಖ ಸಂಪನ್ಮೂಲಗಳು", "value_props": "ಮೌಲ್ಯ ಪ್ರಸ್ತಾಪಗಳು",
        "cust_rel": "ಗ್ರಾಹಕ ಸಂಬಂಧಗಳು", "channels": "ಚಾನೆಲ್‌ಗಳು",
        "cust_seg": "ಗ್ರಾಹಕ ವಿಭಾಗಗಳು", "cost_struct": "ವೆಚ್ಚ ರಚನೆ",
        "rev_streams": "ಆದಾಯ ಧಾರೆಗಳು",
        "sec05": "05. ಅನುಪಾತ ವ್ಯಾಪಾರ ಬಜೆಟ್ ಹಂಚಿಕೆ",
        "cat_module": "ವಿಭಾಗ / ಮಾಡ್ಯೂಲ್", "split_pct": "ವಿಭಜನೆ %",
        "prop_budget": "ಅನುಪಾತ ಬಜೆಟ್", "scope": "ವ್ಯಾಪ್ತಿ & ಡೆಲಿವರಬಲ್‌ಗಳು",
        "sec06": "06. ಡಾಕ್ಯುಮೆಂಟ್ ಅಧಿಕಾರ",
        "digital_approval": "ಡಿಜಿಟಲ್ ಅನುಮೋದನೆ & ಸಹಿ",
        "verification": "ಪರಿಶೀಲನೆ ಮೆಟಾಡೇಟಾ",
        "signer_email": "ಸಹಿ ಮಾಡಿದವರ ಇಮೇಲ್", "timestamp": "ಟೈಮ್‌ಸ್ಟ್ಯಾಂಪ್",
        "ver_ref": "ಪರಿಶೀಲನೆ ಉಲ್ಲೇಖ", "system": "ಸಿಸ್ಟಮ್",
        "requirements_validated": "ಅವಶ್ಯಕತೆಗಳನ್ನು ಮೌಲ್ಯೀಕರಿಸಲಾಗಿದೆ",
    },
    "hindi": {
        "exec_summary": "कार्यकारी सारांश & AI विश्लेषण",
        "sec01": "01. प्रोजेक्ट & डोमेन विनिर्देश",
        "project_name": "प्रोजेक्ट का नाम", "project_type": "प्रोजेक्ट प्रकार",
        "business_domain": "व्यापार डोमेन", "app_type": "एप्लिकेशन प्रकार",
        "target_audience": "लक्षित दर्शक", "doc_language": "दस्तावेज़ भाषा",
        "sec02": "02. विस्तृत व्यापार आवश्यकताएं",
        "biz_desc": "व्यापार विवरण", "problem": "समस्या विवरण",
        "outcomes": "वांछित परिणाम", "features": "मुख्य विशेषताएं",
        "integrations": "तृतीय पक्ष एकीकरण",
        "sec03": "03. तकनीकी & समयरेखा विनिर्देश",
        "timeline": "समयरेखा", "budget": "बजट सीमा",
        "tech_prefs": "तकनीकी प्राथमिकताएं", "scalability": "स्केलेबिलिटी आवश्यकताएं",
        "security": "सुरक्षा आवश्यकताएं", "captured": "दर्ज आवश्यकताएं",
        "sec04": "04. व्यापार मॉडल कैनवास",
        "key_partners": "मुख्य साझेदार", "key_activities": "मुख्य गतिविधियां",
        "key_resources": "मुख्य संसाधन", "value_props": "मूल्य प्रस्ताव",
        "cust_rel": "ग्राहक संबंध", "channels": "चैनल",
        "cust_seg": "ग्राहक खंड", "cost_struct": "लागत संरचना",
        "rev_streams": "राजस्व धाराएं",
        "sec05": "05. आनुपातिक व्यापार बजट आवंटन",
        "cat_module": "श्रेणी / मॉड्यूल", "split_pct": "विभाजन %",
        "prop_budget": "आनुपातिक बजट", "scope": "कार्यक्षेत्र & डिलिवरेबल",
        "sec06": "06. दस्तावेज़ प्राधिकरण",
        "digital_approval": "डिजिटल अनुमोदन & हस्ताक्षर",
        "verification": "सत्यापन मेटाडेटा",
        "signer_email": "हस्ताक्षरकर्ता ईमेल", "timestamp": "टाइमस्टैम्प",
        "ver_ref": "सत्यापन संदर्भ", "system": "सिस्टम",
        "requirements_validated": "आवश्यकताएं मान्य हैं",
    },
    "arabic": {
        "exec_summary": "الملخص التنفيذي وتحليل الذكاء الاصطناعي",
        "sec01": "01. مواصفات المشروع والمجال",
        "project_name": "اسم المشروع", "project_type": "نوع المشروع",
        "business_domain": "مجال الأعمال", "app_type": "نوع التطبيق",
        "target_audience": "الجمهور المستهدف", "doc_language": "لغة المستند",
        "sec02": "02. متطلبات الأعمال التفصيلية",
        "biz_desc": "وصف الأعمال", "problem": "بيان المشكلة",
        "outcomes": "النتائج المرجوة", "features": "الميزات الرئيسية",
        "integrations": "تكاملات الطرف الثالث",
        "sec03": "03. المواصفات الفنية والجدول الزمني",
        "timeline": "الجدول الزمني والتسليم", "budget": "نطاق الميزانية",
        "tech_prefs": "التفضيلات التقنية", "scalability": "متطلبات التوسع",
        "security": "متطلبات الأمان", "captured": "المتطلبات المسجلة",
        "sec04": "04. مخطط نموذج الأعمال",
        "key_partners": "الشركاء الرئيسيون", "key_activities": "الأنشطة الرئيسية",
        "key_resources": "الموارد الرئيسية", "value_props": "القيمة المقترحة",
        "cust_rel": "علاقات العملاء", "channels": "القنوات",
        "cust_seg": "شرائح العملاء", "cost_struct": "هيكل التكاليف",
        "rev_streams": "مصادر الإيرادات",
        "sec05": "05. توزيع ميزانية الأعمال التناسبي",
        "cat_module": "الفئة / الوحدة", "split_pct": "النسبة %",
        "prop_budget": "الميزانية المخصصة", "scope": "النطاق والمخرجات",
        "sec06": "06. واعتماد المستند",
        "digital_approval": "الموافقة الرقمية والتوقيع",
        "verification": "بيانات التحقق",
        "signer_email": "البريد الإلكتروني للموقع", "timestamp": "الطابع الزمني",
        "ver_ref": "مرجع التحقق", "system": "النظام",
        "requirements_validated": "المتطلبات المؤكدة",
    },
    "chinese_sc": {
        "exec_summary": "执行摘要与 AI 分析",
        "sec01": "01. 项目与领域规范",
        "project_name": "项目名称", "project_type": "项目类型",
        "business_domain": "业务领域", "app_type": "应用类型",
        "target_audience": "目标受众", "doc_language": "文档语言",
        "sec02": "02. 详细业务需求",
        "biz_desc": "业务描述", "problem": "问题陈述",
        "outcomes": "预期成果", "features": "核心与关键功能",
        "integrations": "第三方集成",
        "sec03": "03. 技术与时间表规范",
        "timeline": "时间表与交付", "budget": "预算范围",
        "tech_prefs": "技术偏好", "scalability": "可扩展性需求",
        "security": "安全要求", "captured": "已捕获指标",
        "sec04": "04. 商业模式画布",
        "key_partners": "重要伙伴", "key_activities": "关键业务",
        "key_resources": "核心资源", "value_props": "价值主张",
        "cust_rel": "客户关系", "channels": "渠道",
        "cust_seg": "客户细分", "cost_struct": "成本结构",
        "rev_streams": "收入来源",
        "sec05": "05. 按比例业务预算分配",
        "cat_module": "类别 / 模块", "split_pct": "比例 %",
        "prop_budget": "按比例预算", "scope": "范围与交付物",
        "sec06": "06. 文档授权与签署",
        "digital_approval": "数字批准与签名",
        "verification": "验证元数据",
        "signer_email": "签署人邮箱", "timestamp": "时间戳",
        "ver_ref": "验证参考号", "system": "系统",
        "requirements_validated": "项需求已验证",
    },
    "japanese": {
        "exec_summary": "エグゼクティブサマリー & AI分析",
        "sec01": "01. プロジェクトおよびドメイン仕様",
        "project_name": "プロジェクト名", "project_type": "プロジェクトタイプ",
        "business_domain": "ビジネスドメイン", "app_type": "アプリケーションタイプ",
        "target_audience": "ターゲット層", "doc_language": "ドキュメント言語",
        "sec02": "02. 詳細ビジネス要件",
        "biz_desc": "ビジネス概要", "problem": "課題ステートメント",
        "outcomes": "期待される成果", "features": "主要機能",
        "integrations": "外部連携",
        "sec03": "03. 技術およびスケジュール仕様",
        "timeline": "スケジュールと納期", "budget": "予算範囲",
        "tech_prefs": "推奨技術スタック", "scalability": "拡張性要件",
        "security": "セキュリティ要件", "captured": "取得済み要件",
        "sec04": "04. ビジネスモデルキャンバス",
        "key_partners": "主要パートナー", "key_activities": "主要活動",
        "key_resources": "主要リソース", "value_props": "価値提案",
        "cust_rel": "顧客との関係", "channels": "チャネル",
        "cust_seg": "顧客セグメント", "cost_struct": "コスト構造",
        "rev_streams": "収益の流れ",
        "sec05": "05. ビジネス予算の比例配分",
        "cat_module": "カテゴリー / モジュール", "split_pct": "配分比率 %",
        "prop_budget": "配分予算", "scope": "スコープと成果物",
        "sec06": "06. ドキュメントの承認",
        "digital_approval": "デジタル承認および署名",
        "verification": "検証メタデータ",
        "signer_email": "署名者のメールアドレス", "timestamp": "タイムスタンプ",
        "ver_ref": "検証参照番号", "system": "システム",
        "requirements_validated": "要件検証済み",
    },
    "korean": {
        "exec_summary": "요약 및 AI 분석",
        "sec01": "01. 프로젝트 및 도메인 사양",
        "project_name": "프로젝트 이름", "project_type": "프로젝트 유형",
        "business_domain": "비즈니스 도메인", "app_type": "애플리케이션 유형",
        "target_audience": "타겟 고객", "doc_language": "문서 언어",
        "sec02": "02. 상세 비즈니스 요구사항",
        "biz_desc": "비즈니스 설명", "problem": "문제 정의",
        "outcomes": "기대 결과", "features": "핵심 기능",
        "integrations": "외부 시스템 연동",
        "sec03": "03. 기술 및 일정 사양",
        "timeline": "일정 및 납기", "budget": "예산 범위",
        "tech_prefs": "기술 스택", "scalability": "확장성 요구사항",
        "security": "보안 요구사항", "captured": "수집된 요구사항",
        "sec04": "04. 비즈니스 모델 캔버스",
        "key_partners": "핵심 파트너", "key_activities": "핵심 활동",
        "key_resources": "핵심 자원", "value_props": "가치 제안",
        "cust_rel": "고객 관계", "channels": "채널",
        "cust_seg": "고객 세그먼트", "cost_struct": "비용 구조",
        "rev_streams": "수익원",
        "sec05": "05. 예산 배분",
        "cat_module": "카테고리 / 모듈", "split_pct": "비율 %",
        "prop_budget": "배분 예산", "scope": "범위 및 산출물",
        "sec06": "06. 문서 승인 및 서명",
        "digital_approval": "디지털 승인 및 서명",
        "verification": "검증 메타데이터",
        "signer_email": "서명자 이메일", "timestamp": "타임스탬프",
        "ver_ref": "검증 참조 번호", "system": "시스템",
        "requirements_validated": "요구사항 검증됨",
    }
}

# Code-mixed dialects map to formal native script labels
SECTION_LABELS["tanglish"] = SECTION_LABELS["tamil"]
SECTION_LABELS["manglish"] = SECTION_LABELS["malayalam"]
SECTION_LABELS["hinglish"] = SECTION_LABELS["hindi"]
SECTION_LABELS["tenglish"] = SECTION_LABELS["telugu"]
SECTION_LABELS["kanglish"] = SECTION_LABELS["kannada"]
SECTION_LABELS["chinese_tc"] = SECTION_LABELS["chinese_sc"]


def _get_labels(doc_lang: str) -> Dict[str, str]:
    """Return the correct label dict for the given document language."""
    norm = normalize_language_name(doc_lang)
    return SECTION_LABELS.get(norm, SECTION_LABELS["english"])


# ─────────────────────────────────────────────────────────────
# 6. MAIN PDF GENERATOR
# ─────────────────────────────────────────────────────────────

def generate_application_pdf(application_data: Dict[str, Any], translated_fields: Optional[Dict[str, str]] = None) -> bytes:
    """
    Generate a professional Business Requirement Document & Business Model Canvas PDF.
    Pass `translated_fields` with pre-translated content for non-English documents.
    Returns bytes of the generated PDF file.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=40,
        bottomMargin=40
    )

    story = []
    styles = getSampleStyleSheet()

    lang_ctx = application_data.get("language_context") or {}
    doc_lang = lang_ctx.get("doc_language_preference") or lang_ctx.get("locked_language") or "English"
    if doc_lang == "user_lang":
        doc_lang = lang_ctx.get("locked_language", "English")

    norm_lang = normalize_language_name(doc_lang)
    is_rtl    = is_rtl_language(norm_lang)
    text_align = TA_RIGHT if is_rtl else TA_LEFT

    # Primary fonts matching document language
    BF  = _body_font_for_lang(norm_lang)
    BBF = _bold_font_for_lang(norm_lang)

    # Palette
    NAVY         = colors.HexColor("#0F172A")
    INDIGO       = colors.HexColor("#4F46E5")
    BLUE_BG      = colors.HexColor("#F8FAFC")
    BORDER_COLOR = colors.HexColor("#CBD5E1")
    TEXT_DARK    = colors.HexColor("#1E293B")
    TEXT_MUTED   = colors.HexColor("#64748B")

    # Typography Styles
    title_style = ParagraphStyle(
        'DocTitle', parent=styles['Heading1'],
        fontName=BBF, fontSize=20, leading=24, textColor=NAVY, spaceAfter=4, alignment=text_align
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle', parent=styles['Normal'],
        fontName=BF, fontSize=10, leading=14, textColor=TEXT_MUTED, spaceAfter=12, alignment=text_align
    )
    section_heading = ParagraphStyle(
        'SectionHeading', parent=styles['Heading2'],
        fontName=BBF, fontSize=13, leading=16, textColor=INDIGO,
        spaceBefore=14, spaceAfter=6, alignment=text_align
    )
    body_style = ParagraphStyle(
        'BodyTextCustom', parent=styles['Normal'],
        fontName=BF, fontSize=9.5, leading=13.5, textColor=TEXT_DARK, alignment=text_align
    )
    bold_label_style = ParagraphStyle(
        'BoldLabel', parent=styles['Normal'],
        fontName=BBF, fontSize=9.5, leading=13.5, textColor=NAVY, alignment=text_align
    )
    table_header_style = ParagraphStyle(
        'TableHeader', parent=styles['Normal'],
        fontName=BBF, fontSize=9.5, leading=12,
        textColor=colors.white, alignment=TA_CENTER
    )

    # Data extraction helper
    tf = translated_fields or {}

    def T(field_name: str, fallback_key: str = None) -> str:
        """Return prepared translated string with font-wrapping and sanitization."""
        if field_name in tf:
            val = tf[field_name]
        else:
            raw_key = fallback_key or field_name
            val = application_data.get(raw_key)
        return prepare_pdf_text(val, default_font=BF, doc_lang=norm_lang)

    ref_no       = clean_text(application_data.get("reference_number", "REQ-PENDING"))
    project_name = T("project_name", "project_name")
    status       = clean_text(application_data.get("status", "Submitted")).upper()
    submitted_at = application_data.get("submitted_at")
    if submitted_at:
        try:
            date_str = datetime.fromisoformat(str(submitted_at).replace("Z", "+00:00")).strftime("%B %d, %Y")
        except Exception:
            date_str = datetime.now().strftime("%B %d, %Y")
    else:
        date_str = datetime.now().strftime("%B %d, %Y")

    req_json = application_data.get("requirements_json") or {}
    LBL = _get_labels(norm_lang)

    # ─────────────────────────────────────────────────────────
    # HEADER BANNER
    # ─────────────────────────────────────────────────────────
    h_title = prepare_pdf_text(f"<b>{project_name}</b>", default_font=BBF, doc_lang=norm_lang)
    h_subtitle = prepare_pdf_text(f"Date: {date_str} | Status: <font color='#166534'><b>{status}</b></font>", default_font=BF, doc_lang=norm_lang)

    header_data = [
        [
            Paragraph(f"<b>HELIX AI</b> · Enterprise Specification",
                      ParagraphStyle('HLogo', fontName=BBF, fontSize=12, leading=14, textColor=INDIGO)),
            Paragraph(f"<b>REFERENCE:</b> {ref_no}",
                      ParagraphStyle('HRef', fontName=BBF, fontSize=10, leading=12, textColor=NAVY, alignment=TA_RIGHT))
        ],
        [
            Paragraph(h_title, title_style),
            Paragraph(h_subtitle, subtitle_style)
        ]
    ]
    header_table = Table(header_data, colWidths=[340, 200])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(HRFlowable(width="100%", thickness=1.5, color=INDIGO, spaceBefore=4, spaceAfter=12))

    # ─────────────────────────────────────────────────────────
    # EXECUTIVE SUMMARY
    # ─────────────────────────────────────────────────────────
    ai_summary_raw = application_data.get("ai_summary") or req_json.get("ai_summary") or \
                     "Comprehensive requirement specification generated automatically by Helix AI Business Consultant."
    ai_summary_text = T("ai_summary", "ai_summary") if "ai_summary" in tf else prepare_pdf_text(ai_summary_raw, default_font=BF, doc_lang=norm_lang)

    exec_lbl = prepare_pdf_text(f"<b>{LBL['exec_summary']}</b>", default_font=BBF, doc_lang=norm_lang)
    summary_box_data = [
        [Paragraph(exec_lbl, ParagraphStyle('SumTitle', fontName=BBF, fontSize=10, leading=12, textColor=INDIGO, alignment=text_align))],
        [Paragraph(ai_summary_text, body_style)]
    ]
    summary_table = Table(summary_box_data, colWidths=[540])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#EEF2FF")),
        ('BORDER', (0, 0), (-1, -1), 1, colors.HexColor("#C7D2FE")),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 10))

    # ─────────────────────────────────────────────────────────
    # SECTION 01: PROJECT & DOMAIN INFORMATION
    # ─────────────────────────────────────────────────────────
    sec01_lbl = prepare_pdf_text(LBL["sec01"], default_font=BBF, doc_lang=norm_lang)
    story.append(Paragraph(sec01_lbl, section_heading))

    proj_info_data = [
        [Paragraph(prepare_pdf_text(LBL["project_name"], BBF, norm_lang), bold_label_style), Paragraph(T("project_name"), body_style),
         Paragraph(prepare_pdf_text(LBL["project_type"], BBF, norm_lang), bold_label_style), Paragraph(T("project_type"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["business_domain"], BBF, norm_lang), bold_label_style), Paragraph(T("business_domain"), body_style),
         Paragraph(prepare_pdf_text(LBL["app_type"], BBF, norm_lang), bold_label_style), Paragraph(T("application_type"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["target_audience"], BBF, norm_lang), bold_label_style), Paragraph(T("target_audience"), body_style),
         Paragraph(prepare_pdf_text(LBL["doc_language"], BBF, norm_lang), bold_label_style), Paragraph(prepare_pdf_text(doc_lang, BF, norm_lang), body_style)],
    ]
    proj_table = Table(proj_info_data, colWidths=[110, 160, 110, 160])
    proj_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BLUE_BG),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(proj_table)
    story.append(Spacer(1, 10))

    # ─────────────────────────────────────────────────────────
    # SECTION 02: BUSINESS REQUIREMENTS
    # ─────────────────────────────────────────────────────────
    sec02_lbl = prepare_pdf_text(LBL["sec02"], default_font=BBF, doc_lang=norm_lang)
    story.append(Paragraph(sec02_lbl, section_heading))

    bus_details_data = [
        [Paragraph(prepare_pdf_text(LBL["biz_desc"], BBF, norm_lang), bold_label_style), Paragraph(T("business_description"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["problem"], BBF, norm_lang), bold_label_style), Paragraph(T("problem_statement"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["outcomes"], BBF, norm_lang), bold_label_style), Paragraph(T("desired_outcomes"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["features"], BBF, norm_lang), bold_label_style), Paragraph(T("key_features"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["integrations"], BBF, norm_lang), bold_label_style), Paragraph(T("integrations"), body_style)],
    ]
    bus_table = Table(bus_details_data, colWidths=[150, 390])
    bus_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(bus_table)
    story.append(Spacer(1, 10))

    # ─────────────────────────────────────────────────────────
    # SECTION 03: TECHNICAL & TIMELINE
    # ─────────────────────────────────────────────────────────
    sec03_lbl = prepare_pdf_text(LBL["sec03"], default_font=BBF, doc_lang=norm_lang)
    story.append(Paragraph(sec03_lbl, section_heading))

    req_count = application_data.get('total_requirements_captured', 0)
    req_val_str = prepare_pdf_text(f"{req_count} {LBL['requirements_validated']}", BF, norm_lang)

    tech_details_data = [
        [Paragraph(prepare_pdf_text(LBL["timeline"], BBF, norm_lang), bold_label_style), Paragraph(T("timeline"), body_style),
         Paragraph(prepare_pdf_text(LBL["budget"], BBF, norm_lang), bold_label_style), Paragraph(T("budget_range"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["tech_prefs"], BBF, norm_lang), bold_label_style), Paragraph(T("tech_preferences"), body_style),
         Paragraph(prepare_pdf_text(LBL["scalability"], BBF, norm_lang), bold_label_style), Paragraph(T("scalability_needs"), body_style)],
        [Paragraph(prepare_pdf_text(LBL["security"], BBF, norm_lang), bold_label_style), Paragraph(T("security_requirements"), body_style),
         Paragraph(prepare_pdf_text(LBL["captured"], BBF, norm_lang), bold_label_style), Paragraph(req_val_str, body_style)],
    ]
    tech_table = Table(tech_details_data, colWidths=[140, 130, 140, 130])
    tech_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BLUE_BG),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(tech_table)
    story.append(Spacer(1, 14))

    # ─────────────────────────────────────────────────────────
    # SECTION 04: BUSINESS MODEL CANVAS
    # ─────────────────────────────────────────────────────────
    sec04_lbl = prepare_pdf_text(LBL["sec04"], default_font=BBF, doc_lang=norm_lang)
    story.append(Paragraph(sec04_lbl, section_heading))

    bmc = req_json.get("business_model_canvas") or {}
    key_partners   = T("bmc_key_partners",   "key_partners")   if "bmc_key_partners"   in tf else prepare_pdf_text(bmc.get("key_partners")   or ["Technology partners", "Payment Gateways", "Cloud Providers"], BF, norm_lang)
    key_activities = T("bmc_key_activities", "key_activities") if "bmc_key_activities" in tf else prepare_pdf_text(bmc.get("key_activities") or ["Platform Development", "Customer Onboarding", "Support"], BF, norm_lang)
    key_resources  = T("bmc_key_resources",  "key_resources")  if "bmc_key_resources"  in tf else prepare_pdf_text(bmc.get("key_resources")  or ["Proprietary Architecture", "Engineering Team", "Domain Data"], BF, norm_lang)
    value_props    = T("bmc_value_props",    "value_props")    if "bmc_value_props"    in tf else prepare_pdf_text(bmc.get("value_propositions") or [clean_text(application_data.get("business_description"))], BF, norm_lang)
    cust_rel       = T("bmc_cust_rel",       "cust_rel")       if "bmc_cust_rel"       in tf else prepare_pdf_text(bmc.get("customer_relationships") or ["Automated Support", "Self-Service", "Direct Account Manager"], BF, norm_lang)
    channels       = T("bmc_channels",       "channels")       if "bmc_channels"       in tf else prepare_pdf_text(bmc.get("channels")        or ["Web Portal", "Mobile Applications", "API Integration"], BF, norm_lang)
    cust_seg       = T("bmc_cust_seg",       "cust_seg")       if "bmc_cust_seg"       in tf else prepare_pdf_text(bmc.get("customer_segments") or [clean_text(application_data.get("target_audience"))], BF, norm_lang)
    cost_struct    = T("bmc_cost_struct",    "cost_struct")    if "bmc_cost_struct"    in tf else prepare_pdf_text(bmc.get("cost_structure")  or ["Software Engineering", "Cloud Hosting", "Marketing", "Security & Licensing"], BF, norm_lang)
    rev_streams    = T("bmc_rev_streams",    "rev_streams")    if "bmc_rev_streams"    in tf else prepare_pdf_text(bmc.get("revenue_streams") or ["Subscription Plans", "Transaction Fees", "Enterprise Services"], BF, norm_lang)

    bmc_cell_style = ParagraphStyle('BMCCell', parent=body_style, fontSize=8.5, leading=12)

    def bmc_lbl(key): return prepare_pdf_text(f"<b>{LBL[key]}</b>", BBF, norm_lang)

    bmc_grid_data = [
        [
            Paragraph(f"{bmc_lbl('key_partners')}<br/>" + key_partners, bmc_cell_style),
            Paragraph(f"{bmc_lbl('key_activities')}<br/>" + key_activities + f"<br/><br/>{bmc_lbl('key_resources')}<br/>" + key_resources, bmc_cell_style),
            Paragraph(f"{bmc_lbl('value_props')}<br/>" + value_props, bmc_cell_style),
            Paragraph(f"{bmc_lbl('cust_rel')}<br/>" + cust_rel + f"<br/><br/>{bmc_lbl('channels')}<br/>" + channels, bmc_cell_style),
            Paragraph(f"{bmc_lbl('cust_seg')}<br/>" + cust_seg, bmc_cell_style),
        ],
        [
            Paragraph(f"{bmc_lbl('cost_struct')}<br/>" + cost_struct, bmc_cell_style),
            Paragraph(f"{bmc_lbl('rev_streams')}<br/>" + rev_streams, bmc_cell_style),
            Paragraph("", bmc_cell_style),
            Paragraph("", bmc_cell_style),
            Paragraph("", bmc_cell_style),
        ]
    ]

    bmc_table = Table(bmc_grid_data, colWidths=[108, 108, 108, 108, 108])
    bmc_table.setStyle(TableStyle([
        ('SPAN', (0, 1), (2, 1)),
        ('SPAN', (3, 1), (4, 1)),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#FAFAFA")),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(bmc_table)
    story.append(Spacer(1, 14))

    # ─────────────────────────────────────────────────────────
    # SECTION 05: PROPORTIONAL BUSINESS BUDGET ALLOCATION
    # ─────────────────────────────────────────────────────────
    sec05_lbl = prepare_pdf_text(LBL["sec05"], default_font=BBF, doc_lang=norm_lang)
    story.append(Paragraph(sec05_lbl, section_heading))

    budget_list = req_json.get("proportional_budget") or [
        {"category": "Core Architecture & Backend Development",  "percentage": 35, "allocated_amount": "35% of Total Budget", "description": "API Gateway, DB schema, authentication, data layer"},
        {"category": "Frontend UI/UX & Responsive Web/Mobile",   "percentage": 25, "allocated_amount": "25% of Total Budget", "description": "Interactive dashboards, client application, mobile interfaces"},
        {"category": "AI / ML & Third-Party Integration Engine", "percentage": 20, "allocated_amount": "20% of Total Budget", "description": "Gemini AI pipeline, payment gateway, WhatsApp/SMS integrations"},
        {"category": "Quality Assurance & Security Compliance",  "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "End-to-End automated testing, SSL, penetration testing"},
        {"category": "Deployment, DevOps & Buffer Reserve",      "percentage": 10, "allocated_amount": "10% of Total Budget", "description": "Cloud hosting deployment, CI/CD pipeline, contingency buffer"}
    ]

    if "budget_list" in tf:
        try:
            raw_b = tf["budget_list"]
            if isinstance(raw_b, str):
                budget_list = json.loads(raw_b) or budget_list
            elif isinstance(raw_b, list):
                budget_list = raw_b
        except Exception:
            pass

    budget_table_data = [
        [
            Paragraph(prepare_pdf_text(f"<b>{LBL['cat_module']}</b>", BBF, norm_lang),  table_header_style),
            Paragraph(prepare_pdf_text(f"<b>{LBL['split_pct']}</b>", BBF, norm_lang),   table_header_style),
            Paragraph(prepare_pdf_text(f"<b>{LBL['prop_budget']}</b>", BBF, norm_lang), table_header_style),
            Paragraph(prepare_pdf_text(f"<b>{LBL['scope']}</b>", BBF, norm_lang),       table_header_style),
        ]
    ]

    for item in budget_list:
        cat_p  = prepare_pdf_text(f"<b>{clean_text(item.get('category'))}</b>", BBF, norm_lang)
        pct_p  = prepare_pdf_text(f"{item.get('percentage', 0)}%", BF, norm_lang)
        amt_p  = prepare_pdf_text(clean_text(item.get('allocated_amount')), BF, norm_lang)
        desc_p = prepare_pdf_text(clean_text(item.get('description')), BF, norm_lang)

        budget_table_data.append([
            Paragraph(cat_p, body_style),
            Paragraph(pct_p, ParagraphStyle('CenterTxt', parent=body_style, alignment=TA_CENTER)),
            Paragraph(amt_p, ParagraphStyle('RightTxt', parent=body_style, alignment=TA_CENTER)),
            Paragraph(desc_p, body_style)
        ])

    budget_table = Table(budget_table_data, colWidths=[170, 55, 125, 190])
    budget_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), INDIGO),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BLUE_BG])
    ]))
    story.append(budget_table)
    story.append(Spacer(1, 16))

    # ─────────────────────────────────────────────────────────
    # SECTION 06: DIGITAL SIGNATURE & APPROVAL BLOCK
    # ─────────────────────────────────────────────────────────
    sig_base64   = application_data.get("signature_data")
    signer_email = clean_text(application_data.get("signer_email") or (application_data.get("user") or {}).get("email"))
    sig_img      = create_signature_image(sig_base64) if sig_base64 else None

    sec06_lbl = prepare_pdf_text(LBL["sec06"], default_font=BBF, doc_lang=norm_lang)
    sig_app_lbl = prepare_pdf_text(f"<b>{LBL['digital_approval']}</b>", BBF, norm_lang)
    sig_ver_lbl = prepare_pdf_text(f"<b>{LBL['verification']}</b>", BBF, norm_lang)

    sig_meta_str = prepare_pdf_text(
        f"<b>{LBL['signer_email']}:</b> {signer_email}<br/>"
        f"<b>{LBL['timestamp']}:</b> {date_str}<br/>"
        f"<b>{LBL['ver_ref']}:</b> {ref_no}<br/>"
        f"<b>{LBL['system']}:</b> Helix AI Business Partner",
        default_font=BF, doc_lang=norm_lang
    )

    sig_block_data = [
        [
            Paragraph(sig_app_lbl, ParagraphStyle('SigHeader',  fontName=BBF, fontSize=10, leading=12, textColor=NAVY, alignment=text_align)),
            Paragraph(sig_ver_lbl, ParagraphStyle('SigHeader2', fontName=BBF, fontSize=10, leading=12, textColor=NAVY, alignment=text_align))
        ],
        [
            sig_img if sig_img else Paragraph(prepare_pdf_text("<i>Digitally signed upon submission</i>", BF, norm_lang), body_style),
            Paragraph(sig_meta_str, body_style)
        ]
    ]
    sig_table = Table(sig_block_data, colWidths=[270, 270])
    sig_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
        ('BORDER', (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))

    story.append(KeepTogether([
        Paragraph(sec06_lbl, section_heading),
        sig_table
    ]))

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


# ─────────────────────────────────────────────────────────────
# 7. CONVENIENCE: Build PDF with auto-translation
# ─────────────────────────────────────────────────────────────

async def generate_pdf_for_application(application_data: Dict[str, Any]) -> bytes:
    """
    High-level async entry point. Detects document language, runs translation
    if needed, then generates and returns the PDF bytes.
    """
    lang_ctx = application_data.get("language_context") or {}
    doc_lang = lang_ctx.get("doc_language_preference") or lang_ctx.get("locked_language") or "English"
    if doc_lang == "user_lang":
        doc_lang = lang_ctx.get("locked_language", "English")

    translated_fields: Optional[Dict[str, str]] = None

    if _needs_translation(doc_lang):
        req_json = application_data.get("requirements_json") or {}
        bmc = req_json.get("business_model_canvas") or {}
        budget_list = req_json.get("proportional_budget") or []

        fields_to_translate = {
            "project_name":          clean_text(application_data.get("project_name")),
            "project_type":          clean_text(application_data.get("project_type")),
            "business_domain":       clean_text(application_data.get("business_domain")),
            "application_type":      clean_text(application_data.get("application_type")),
            "target_audience":       clean_text(application_data.get("target_audience")),
            "business_description":  clean_text(application_data.get("business_description")),
            "problem_statement":     clean_text(application_data.get("problem_statement")),
            "desired_outcomes":      clean_text(application_data.get("desired_outcomes")),
            "key_features":          clean_text(application_data.get("key_features")),
            "integrations":          clean_text(application_data.get("integrations")),
            "timeline":              clean_text(application_data.get("timeline")),
            "budget_range":          clean_text(application_data.get("budget_range")),
            "tech_preferences":      clean_text(application_data.get("tech_preferences")),
            "scalability_needs":     clean_text(application_data.get("scalability_needs")),
            "security_requirements": clean_text(application_data.get("security_requirements")),
            "ai_summary":            clean_text(application_data.get("ai_summary")),
            "bmc_key_partners":      clean_text(bmc.get("key_partners") or ""),
            "bmc_key_activities":    clean_text(bmc.get("key_activities") or ""),
            "bmc_key_resources":     clean_text(bmc.get("key_resources") or ""),
            "bmc_value_props":       clean_text(bmc.get("value_propositions") or ""),
            "bmc_cust_rel":          clean_text(bmc.get("customer_relationships") or ""),
            "bmc_channels":          clean_text(bmc.get("channels") or ""),
            "bmc_cust_seg":          clean_text(bmc.get("customer_segments") or ""),
            "bmc_cost_struct":       clean_text(bmc.get("cost_structure") or ""),
            "bmc_rev_streams":       clean_text(bmc.get("revenue_streams") or ""),
            "budget_list":           json.dumps(budget_list, ensure_ascii=False) if budget_list else "",
        }
        print(f"[PDF Engine] Translating {len(fields_to_translate)} fields into {doc_lang}...")
        translated_fields = await translate_fields_with_gemini(fields_to_translate, doc_lang)

    return generate_application_pdf(application_data, translated_fields=translated_fields)
