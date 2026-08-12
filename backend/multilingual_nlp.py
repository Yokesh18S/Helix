"""
Helix Production-Grade Multilingual NLP & Language Engine

Handles:
- Language Identification (Pure languages + Mixed: Tanglish, Manglish, Hinglish, Tenglish, Kanglish)
- Explicit Language Switch Detection ("Continue in English", "Tamil-la pesu", "Malayalam please", etc.)
- Language Lock & Session Memory Manager
- Intent & Sentiment & Formality Analysis
- Code-switching and Dialect preservation
"""

import re
import json
import os
from typing import Dict, Any, Optional, Tuple
import google.generativeai as genai

# Language Code Mapping
LANGUAGE_CODE_MAP = {
    "English": "en-US",
    "Tamil": "ta-IN",
    "Tanglish": "en-IN",  # Tanglish is Tamil in English/Latin script
    "Malayalam": "ml-IN",
    "Manglish": "en-IN",  # Manglish is Malayalam in English/Latin script
    "Hindi": "hi-IN",
    "Hinglish": "en-IN",  # Hinglish is Hindi in English/Latin script
    "Telugu": "te-IN",
    "Tenglish": "en-IN",  # Tenglish is Telugu in English/Latin script
    "Kannada": "kn-IN",
    "Kanglish": "en-IN",  # Kanglish is Kannada in English/Latin script
    "Bengali": "bn-IN",
    "Marathi": "mr-IN",
    "Gujarati": "gu-IN",
    "Punjabi": "pa-IN",
}

# Regex patterns for explicit language switch commands
EXPLICIT_SWITCH_PATTERNS = [
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?english\b", "English", "en-US"),
    (r"\benglish\s+please\b", "English", "en-US"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?tamil\b", "Tamil", "ta-IN"),
    (r"\b(tamil[- ]?la|tamil\s+la)\s+(pesu|pesunga|sollu|talk|speak)\b", "Tanglish", "en-IN"),
    (r"\binime\s+tamil(-?la)?\b", "Tanglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?tanglish\b", "Tanglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?malayalam\b", "Malayalam", "ml-IN"),
    (r"\b(malayalam[- ]?il|malayalam\s+il)\s+(parayu|parayuka|samsarikku|talk|speak)\b", "Manglish", "en-IN"),
    (r"\bmalayalam\s+please\b", "Malayalam", "ml-IN"),
    (r"\binime\s+malayalam\b", "Manglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?manglish\b", "Manglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?hindi\b", "Hindi", "hi-IN"),
    (r"\b(hindi\s+me|hindi\s+mein)\s+(baat\s+karo|bolo|suno|talk|speak)\b", "Hinglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?hinglish\b", "Hinglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?telugu\b", "Telugu", "te-IN"),
    (r"\b(telugu[- ]?lo|telugu\s+lo)\s+(matladu|matladandi|talk|speak)\b", "Tenglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?tenglish\b", "Tenglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?kannada\b", "Kannada", "kn-IN"),
    (r"\b(kannada[- ]?dalli|kannada\s+dalli)\s+(matadi|matadadi|talk|speak)\b", "Kanglish", "en-IN"),
    (r"\b(continue|speak|talk|switch|change|use)\s+(in\s+)?kanglish\b", "Kanglish", "en-IN"),
]


def check_explicit_language_switch(text: str) -> Optional[Tuple[str, str]]:
    """Checks if the user explicitly requested a language switch."""
    text_lower = text.lower().strip()
    for pattern, lang_name, lang_code in EXPLICIT_SWITCH_PATTERNS:
        if re.search(pattern, text_lower):
            return lang_name, lang_code
    return None


async def analyze_language_and_nlp(
    user_text: str,
    current_context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Multilingual NLP Pipeline:
    1. Language Identification (Pure & Code-Mixed)
    2. Explicit Switch Detection
    3. Language Lock Enforcement & Memory Persistence
    4. Sentiment, Formality, and Vocabulary Style Analysis
    5. Intent & Entity Detection
    """
    if current_context is None:
        current_context = {}

    # Check for explicit language switch request
    explicit_switch = check_explicit_language_switch(user_text)
    if explicit_switch:
        lang_name, lang_code = explicit_switch
        print(f"[NLP Engine] Explicit language switch detected: {lang_name} ({lang_code})")
        return {
            "locked_language": lang_name,
            "language_code": lang_code,
            "confidence": 1.0,
            "is_locked": True,
            "code_mixed": lang_name in ["Tanglish", "Manglish", "Hinglish", "Tenglish", "Kanglish"],
            "formality_level": current_context.get("formality_level", "casual"),
            "speaking_style": f"User explicitly switched to {lang_name}",
            "intent": "language_switch",
            "explicit_switch": True,
            "doc_language_preference": current_context.get("doc_language_preference")
        }

    is_locked = current_context.get("is_locked", False)
    existing_lang = current_context.get("locked_language")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        # Heuristic fallback if Gemini API key not present
        text_lower = user_text.lower()
        if any(w in text_lower for w in ["naan", "oru", "venum", "sollu", "poren", "enaku", "romba", "nalla"]):
            detected = "Tanglish"
        elif any(w in text_lower for w in ["enikku", "venam", "aaranu", "cheyya", "parayu"]):
            detected = "Manglish"
        elif any(w in text_lower for w in ["mujhe", "chahiye", "banana", "bhai", "karo", "kya"]):
            detected = "Hinglish"
        elif any(w in text_lower for w in ["naku", "kavali", "undi", "cheyali"]):
            detected = "Tenglish"
        elif any(w in text_lower for w in ["nanage", "beku", "madabeku", "yaru"]):
            detected = "Kanglish"
        else:
            detected = existing_lang or "English"

        return {
            "locked_language": detected,
            "language_code": LANGUAGE_CODE_MAP.get(detected, "en-US"),
            "confidence": 0.85,
            "is_locked": True,
            "code_mixed": detected in ["Tanglish", "Manglish", "Hinglish", "Tenglish", "Kanglish"],
            "formality_level": current_context.get("formality_level", "casual"),
            "speaking_style": current_context.get("speaking_style", "Friendly conversational"),
            "intent": "business_answer",
            "explicit_switch": False,
            "doc_language_preference": current_context.get("doc_language_preference")
        }

    try:
        model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-2.5-flash"))
        prompt = f"""You are the Multilingual NLP & NLU Engine for Helix AI.
Analyze the user utterance below for language identification, code-mixing, tone, formality, and intent.

USER UTTERANCE: "{user_text}"

CURRENT CONVERSATION LANGUAGE MEMORY:
- Currently Locked Language: {existing_lang or "None"}
- Previously Locked Status: {is_locked}

DETECTION RULES:
1. Identify the exact language / code-mixed dialect:
   - Tanglish (Tamil spoken in English/Latin script, e.g., "naan soap company start panna poren", "enaku app venum", "bro romba nalla idea")
   - Manglish (Malayalam spoken in English/Latin script, e.g., "enikku oru app venam", "nalla idea aanu", "bro restaurant app venam")
   - Hinglish (Hindi spoken in English/Latin script, e.g., "mujhe ek system banana hai", "bhai yeh bahut accha hai", "super idea bhai")
   - Tenglish (Telugu spoken in English/Latin script, e.g., "naku okka app kavali", "super idea bro")
   - Kanglish (Kannada spoken in English/Latin script, e.g., "nanage ondu website beku")
   - Tamil (Pure Tamil in Tamil script)
   - Malayalam (Pure Malayalam in Malayalam script)
   - Hindi (Pure Hindi in Devanagari script)
   - Telugu (Pure Telugu in Telugu script)
   - Kannada (Pure Kannada in Kannada script)
   - English (Pure English with no regional Indian words)

2. LANGUAGE LOCK RULE:
   - If Currently Locked Language is set (e.g. Tanglish/Hinglish/Manglish/Tamil/etc.), and the user is continuing the conversation using technical English words alongside regional words or in the same style, MAINTAIN the locked language!
   - DO NOT switch to English just because the user used English terms like "company", "app", "website", "budget", "system", "components".
   - Only switch locked language if user explicitly commands a switch or speaks entirely in a completely different language with high confidence (>0.95).

3. Assign confidence score (0.0 to 1.0).
4. Identify formality_level ("casual", "semi-formal", "formal").
5. Identify key vocabulary style and slang (e.g., "bro", "bhai", "machan", "super", "accha", "romba").

Return ONLY valid JSON (no markdown):
{{
    "detected_language": "Tanglish | Manglish | Hinglish | Tenglish | Kanglish | Tamil | Malayalam | Hindi | Telugu | Kannada | English",
    "confidence": 0.95,
    "code_mixed": true or false,
    "formality_level": "casual | semi-formal | formal",
    "speaking_style": "Description of tone, slang, and vocabulary",
    "intent": "detected intent of the answer",
    "sentiment": "positive | neutral | enthusiastic"
}}
"""
        response = await model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(temperature=0.1)
        )
        raw_text = response.text.strip()
        if raw_text.startswith("```"):
            lines = raw_text.split("\n")
            if lines[0].startswith("```json") or lines[0].startswith("```"):
                lines = lines[1:-1]
            raw_text = "\n".join(lines).strip()
        res = json.loads(raw_text)

        detected_lang = res.get("detected_language", "English")

        # Apply Language Lock logic
        if is_locked and existing_lang and existing_lang != detected_lang:
            # If previously locked into a code-mixed language (e.g. Tanglish), and user answer contains domain English terms, keep locked language!
            if existing_lang in ["Tanglish", "Manglish", "Hinglish", "Tenglish", "Kanglish"] and detected_lang == "English" and res.get("confidence", 0.9) < 0.98:
                final_lang = existing_lang
            else:
                final_lang = detected_lang
        else:
            final_lang = detected_lang

        lang_code = LANGUAGE_CODE_MAP.get(final_lang, "en-IN" if res.get("code_mixed") else "en-US")

        return {
            "locked_language": final_lang,
            "language_code": lang_code,
            "confidence": res.get("confidence", 0.95),
            "is_locked": True,
            "code_mixed": res.get("code_mixed", final_lang in ["Tanglish", "Manglish", "Hinglish", "Tenglish", "Kanglish"]),
            "formality_level": res.get("formality_level", "casual"),
            "speaking_style": res.get("speaking_style", "Friendly conversational"),
            "intent": res.get("intent", "business_answer"),
            "sentiment": res.get("sentiment", "positive"),
            "explicit_switch": False,
            "doc_language_preference": current_context.get("doc_language_preference")
        }
    except Exception as e:
        print(f"[NLP Engine] Error in analyze_language_and_nlp: {e}")
        fallback_lang = existing_lang or "English"
        return {
            "locked_language": fallback_lang,
            "language_code": LANGUAGE_CODE_MAP.get(fallback_lang, "en-US"),
            "confidence": 0.8,
            "is_locked": True,
            "code_mixed": fallback_lang in ["Tanglish", "Manglish", "Hinglish", "Tenglish", "Kanglish"],
            "formality_level": "casual",
            "speaking_style": "Friendly",
            "intent": "business_answer",
            "explicit_switch": False,
            "doc_language_preference": current_context.get("doc_language_preference")
        }
