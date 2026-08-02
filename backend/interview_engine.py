"""
Helix Adaptive Business Interview Engine

Core intelligence module that maintains a Requirement Graph,
decides what information is missing, ranks missing fields,
detects contradictions, and determines when the interview is complete.

Gemini is NOT responsible for deciding what to ask.
This engine decides. Gemini only generates natural language.
"""

import copy
from typing import Dict, List, Optional, Any, Tuple


# ═══════════════════════════════════════════════════════════════
# REQUIREMENT GRAPH TEMPLATE
# ═══════════════════════════════════════════════════════════════

REQUIREMENT_GRAPH_TEMPLATE: Dict[str, Any] = {
    "industry": None,
    "problem_statement": None,
    "business_goal": None,
    "target_users": [],
    "business_model": None,
    "platforms": [],
    "roles": [],
    "core_modules": [],
    "optional_modules": [],
    "authentication": None,
    "payments": None,
    "notifications": None,
    "reports": None,
    "integrations": [],
    "ai_features": [],
    "constraints": [],
    "future_scope": [],
}

# Fields that are scalar (string/None) vs list-based
SCALAR_FIELDS = {
    "industry", "problem_statement", "business_goal", "business_model",
    "authentication", "payments", "notifications", "reports"
}
LIST_FIELDS = {
    "target_users", "platforms", "roles", "core_modules", "optional_modules",
    "integrations", "ai_features", "constraints", "future_scope"
}

# Human-readable labels for UI display
FIELD_LABELS = {
    "industry": "Industry",
    "problem_statement": "Problem Statement",
    "business_goal": "Business Goal",
    "target_users": "Target Users",
    "business_model": "Business Model",
    "platforms": "Platforms",
    "roles": "User Roles",
    "core_modules": "Core Modules",
    "optional_modules": "Optional Modules",
    "authentication": "Authentication",
    "payments": "Payments",
    "notifications": "Notifications",
    "reports": "Reports & Analytics",
    "integrations": "Integrations",
    "ai_features": "AI Features",
    "constraints": "Constraints",
    "future_scope": "Future Scope",
}


# ═══════════════════════════════════════════════════════════════
# FIELD PRIORITY RANKING (higher = more important to ask first)
# ═══════════════════════════════════════════════════════════════

FIELD_PRIORITY: Dict[str, int] = {
    "business_goal": 100,
    "problem_statement": 95,
    "target_users": 90,
    "industry": 88,
    "core_modules": 85,
    "platforms": 80,
    "roles": 75,
    "authentication": 70,
    "payments": 65,
    "integrations": 60,
    "reports": 55,
    "notifications": 50,
    "business_model": 45,
    "ai_features": 40,
    "constraints": 35,
    "future_scope": 30,
    "optional_modules": 25,
}

# Fields that are CRITICAL — interview cannot end without them
CRITICAL_FIELDS = {
    "business_goal", "problem_statement", "target_users",
    "core_modules", "platforms"
}

# Fields that are IMPORTANT but not blocking
IMPORTANT_FIELDS = {
    "industry", "roles", "authentication", "payments"
}

# Fields that are NICE TO HAVE
OPTIONAL_FIELDS = {
    "business_model", "integrations", "reports", "notifications",
    "ai_features", "constraints", "future_scope", "optional_modules"
}


# ═══════════════════════════════════════════════════════════════
# INDUSTRY KNOWLEDGE PACKS
# ═══════════════════════════════════════════════════════════════

INDUSTRY_PACKS: Dict[str, Dict[str, Any]] = {
    "restaurant": {
        "expected_modules": ["menu_management", "ordering", "kitchen_display", "delivery_tracking", "table_reservation", "billing"],
        "expected_roles": ["customer", "restaurant_owner", "chef", "delivery_partner", "admin"],
        "domain_questions": ["dine-in vs delivery vs both", "single vs multi-branch", "online payment methods", "loyalty programs"],
        "typical_integrations": ["payment_gateway", "maps_api", "sms_notifications"],
    },
    "hospital": {
        "expected_modules": ["appointment_booking", "patient_records", "doctor_dashboard", "billing", "pharmacy", "lab_reports"],
        "expected_roles": ["patient", "doctor", "nurse", "receptionist", "admin", "pharmacist"],
        "domain_questions": ["appointment booking online vs walk-in", "electronic health records", "insurance integration", "telemedicine support"],
        "typical_integrations": ["insurance_api", "lab_systems", "payment_gateway"],
    },
    "ecommerce": {
        "expected_modules": ["product_catalog", "cart", "checkout", "order_tracking", "inventory", "reviews", "promotions"],
        "expected_roles": ["buyer", "seller", "admin", "delivery_partner"],
        "domain_questions": ["physical vs digital products", "marketplace vs single vendor", "payment methods", "return and refund policy"],
        "typical_integrations": ["payment_gateway", "shipping_api", "analytics", "email_marketing"],
    },
    "school": {
        "expected_modules": ["student_portal", "teacher_portal", "parent_portal", "attendance", "gradebook", "timetable", "fees"],
        "expected_roles": ["student", "teacher", "parent", "principal", "admin"],
        "domain_questions": ["online classes support", "exam and grading system", "fee payment online", "parent-teacher communication"],
        "typical_integrations": ["video_conferencing", "payment_gateway", "sms_notifications"],
    },
    "manufacturing": {
        "expected_modules": ["production_planning", "inventory", "quality_control", "supply_chain", "workforce_management", "reporting"],
        "expected_roles": ["plant_manager", "operator", "quality_inspector", "procurement", "admin"],
        "domain_questions": ["batch vs continuous production", "raw material tracking", "quality compliance standards", "equipment maintenance tracking"],
        "typical_integrations": ["erp_system", "iot_sensors", "accounting_software"],
    },
    "healthcare": {
        "expected_modules": ["patient_management", "teleconsultation", "prescriptions", "health_monitoring", "billing"],
        "expected_roles": ["patient", "healthcare_provider", "caregiver", "admin"],
        "domain_questions": ["HIPAA or data privacy compliance", "wearable device integration", "prescription management"],
        "typical_integrations": ["ehr_systems", "wearable_apis", "insurance_api"],
    },
    "banking": {
        "expected_modules": ["account_management", "transactions", "loans", "cards", "kyc", "reporting"],
        "expected_roles": ["customer", "bank_officer", "branch_manager", "admin"],
        "domain_questions": ["retail vs corporate banking", "loan and credit products", "KYC verification", "regulatory compliance"],
        "typical_integrations": ["core_banking", "payment_networks", "credit_bureau"],
    },
    "logistics": {
        "expected_modules": ["fleet_management", "route_optimization", "warehouse_management", "tracking", "billing"],
        "expected_roles": ["shipper", "carrier", "driver", "warehouse_staff", "admin"],
        "domain_questions": ["last-mile vs long-haul", "real-time tracking", "warehouse management"],
        "typical_integrations": ["gps_tracking", "maps_api", "erp_system"],
    },
    "education": {
        "expected_modules": ["course_catalog", "enrollment", "content_delivery", "assessments", "certificates", "discussion_forums"],
        "expected_roles": ["student", "instructor", "content_creator", "admin"],
        "domain_questions": ["live classes vs pre-recorded", "certification and accreditation", "subscription vs one-time payment"],
        "typical_integrations": ["video_streaming", "payment_gateway", "lms_standards"],
    },
    "real_estate": {
        "expected_modules": ["property_listings", "search_filters", "virtual_tours", "agent_management", "lead_management", "contracts"],
        "expected_roles": ["buyer", "seller", "agent", "property_manager", "admin"],
        "domain_questions": ["rental vs sales vs both", "virtual tour support", "agent commission tracking"],
        "typical_integrations": ["maps_api", "payment_gateway", "crm"],
    },
    "travel": {
        "expected_modules": ["search_booking", "itinerary", "reviews", "payments", "notifications", "loyalty"],
        "expected_roles": ["traveler", "travel_agent", "hotel_partner", "admin"],
        "domain_questions": ["flights, hotels, packages, or all", "multi-currency support", "cancellation policies"],
        "typical_integrations": ["gds_systems", "payment_gateway", "maps_api"],
    },
    "hr": {
        "expected_modules": ["recruitment", "employee_management", "payroll", "attendance", "leave_management", "performance_reviews"],
        "expected_roles": ["employee", "manager", "hr_admin", "recruiter"],
        "domain_questions": ["payroll integration", "remote workforce support", "compliance and labor laws"],
        "typical_integrations": ["payroll_system", "accounting_software", "job_boards"],
    },
    "erp": {
        "expected_modules": ["finance", "hr", "inventory", "procurement", "manufacturing", "crm", "reporting"],
        "expected_roles": ["department_heads", "employees", "managers", "admin"],
        "domain_questions": ["which departments to cover first", "existing systems to replace", "multi-location support"],
        "typical_integrations": ["accounting_software", "bank_feeds", "third_party_apis"],
    },
    "crm": {
        "expected_modules": ["contact_management", "pipeline", "deals", "email_tracking", "reporting", "automation"],
        "expected_roles": ["sales_rep", "sales_manager", "marketing", "admin"],
        "domain_questions": ["B2B vs B2C", "email and call integration", "marketing automation"],
        "typical_integrations": ["email_service", "phone_system", "marketing_tools"],
    },
    "saas": {
        "expected_modules": ["user_management", "subscription_billing", "dashboards", "api_access", "analytics", "admin_panel"],
        "expected_roles": ["end_user", "team_admin", "super_admin"],
        "domain_questions": ["pricing tiers and plans", "multi-tenant architecture", "API access for integrations", "white-labeling support"],
        "typical_integrations": ["payment_gateway", "analytics", "email_service"],
    },
    "agriculture": {
        "expected_modules": ["crop_management", "weather_monitoring", "marketplace", "supply_chain", "iot_monitoring"],
        "expected_roles": ["farmer", "buyer", "agronomist", "admin"],
        "domain_questions": ["IoT sensor integration", "weather data integration", "direct-to-consumer marketplace"],
        "typical_integrations": ["iot_platforms", "weather_apis", "payment_gateway"],
    },
}

# Industry keyword mapping for auto-detection
INDUSTRY_KEYWORDS: Dict[str, List[str]] = {
    "restaurant": ["restaurant", "food", "dining", "cafe", "kitchen", "menu", "catering", "food delivery", "eatery"],
    "hospital": ["hospital", "clinic", "medical", "healthcare", "patient", "doctor", "appointment"],
    "ecommerce": ["ecommerce", "e-commerce", "online store", "shop", "sell products", "marketplace", "shopping"],
    "school": ["school", "college", "university", "students", "teachers", "education management", "campus"],
    "manufacturing": ["manufacturing", "factory", "production", "assembly", "plant"],
    "healthcare": ["health", "wellness", "telemedicine", "telehealth", "medical app", "fitness"],
    "banking": ["bank", "banking", "fintech", "financial", "loan", "credit"],
    "logistics": ["logistics", "shipping", "delivery", "fleet", "warehouse", "transport", "courier"],
    "education": ["learning", "courses", "lms", "e-learning", "online education", "training platform", "edtech"],
    "real_estate": ["real estate", "property", "housing", "rental", "apartment", "broker"],
    "travel": ["travel", "tourism", "booking", "hotel", "flight", "trip", "vacation"],
    "hr": ["hr", "human resources", "recruitment", "payroll", "employee management", "hiring"],
    "erp": ["erp", "enterprise resource", "business management"],
    "crm": ["crm", "customer relationship", "sales pipeline", "lead management"],
    "saas": ["saas", "software as a service", "subscription platform", "cloud platform"],
    "agriculture": ["agriculture", "farming", "crop", "agri", "farm management"],
}


# ═══════════════════════════════════════════════════════════════
# CORE ENGINE FUNCTIONS
# ═══════════════════════════════════════════════════════════════

def create_graph() -> Dict[str, Any]:
    """Create a fresh requirement graph."""
    return copy.deepcopy(REQUIREMENT_GRAPH_TEMPLATE)


def detect_industry(text: str) -> Optional[str]:
    """Auto-detect industry from text using keyword matching."""
    text_lower = text.lower()
    best_match = None
    best_count = 0
    for industry, keywords in INDUSTRY_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw in text_lower)
        if count > best_count:
            best_count = count
            best_match = industry
    return best_match if best_count > 0 else None


def update_graph(graph: Dict[str, Any], extraction: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge AI-extracted data into the requirement graph.
    Only updates fields that have new non-empty values.
    """
    for field in SCALAR_FIELDS:
        val = extraction.get(field)
        if val and isinstance(val, str) and val.strip():
            graph[field] = val.strip()

    for field in LIST_FIELDS:
        val = extraction.get(field)
        if val:
            if isinstance(val, list):
                existing = set(str(x).lower() for x in graph.get(field, []))
                for item in val:
                    if isinstance(item, str) and item.strip():
                        if item.strip().lower() not in existing:
                            graph[field].append(item.strip())
                            existing.add(item.strip().lower())
            elif isinstance(val, str) and val.strip():
                existing = set(str(x).lower() for x in graph.get(field, []))
                if val.strip().lower() not in existing:
                    graph[field].append(val.strip())

    # Auto-detect industry from all text fields if not yet set
    if not graph.get("industry"):
        for field in ["business_goal", "problem_statement"]:
            if graph.get(field):
                detected = detect_industry(graph[field])
                if detected:
                    graph["industry"] = detected
                    break
        # Also check list fields for industry hints
        if not graph.get("industry"):
            all_text = " ".join(
                str(v) for v in graph.get("core_modules", []) + graph.get("target_users", [])
            )
            if all_text.strip():
                detected = detect_industry(all_text)
                if detected:
                    graph["industry"] = detected

    # If industry was extracted directly by Gemini
    if extraction.get("industry") and isinstance(extraction["industry"], str):
        normalized = extraction["industry"].lower().strip()
        # Try to match to our known industry packs
        if normalized in INDUSTRY_PACKS:
            graph["industry"] = normalized
        else:
            detected = detect_industry(normalized)
            if detected:
                graph["industry"] = detected
            else:
                graph["industry"] = normalized

    return graph


def detect_contradictions(
    graph: Dict[str, Any],
    new_extraction: Dict[str, Any],
    qa_history: List[Dict]
) -> Optional[str]:
    """
    Detect contradictions between new data and existing graph.
    Returns a contradiction description string, or None.
    """
    contradictions = []

    # Platform contradiction
    existing_platforms = set(p.lower() for p in graph.get("platforms", []))
    new_platforms = new_extraction.get("platforms", [])
    if isinstance(new_platforms, list):
        new_platform_set = set(p.lower() for p in new_platforms if isinstance(p, str))
    elif isinstance(new_platforms, str):
        new_platform_set = {new_platforms.lower()}
    else:
        new_platform_set = set()

    if existing_platforms and new_platform_set:
        mobile_only = existing_platforms <= {"mobile", "mobile app", "ios", "android"}
        mentions_web = any("web" in p or "desktop" in p for p in new_platform_set)
        if mobile_only and mentions_web:
            contradictions.append(
                "You mentioned a mobile-only platform earlier, but it sounds like some users will need desktop or web access too. Should we support both mobile and web?"
            )

        web_only = existing_platforms <= {"web", "web app", "website"}
        mentions_mobile = any("mobile" in p or "app" in p or "ios" in p or "android" in p for p in new_platform_set)
        if web_only and mentions_mobile:
            contradictions.append(
                "Earlier you mentioned a web-only solution, but now it sounds like mobile access is also needed. Should we plan for both?"
            )

    # Authentication contradiction
    existing_auth = graph.get("authentication", "")
    new_auth = new_extraction.get("authentication", "")
    if existing_auth and new_auth:
        if isinstance(existing_auth, str) and isinstance(new_auth, str):
            if "no auth" in existing_auth.lower() and ("login" in new_auth.lower() or "auth" in new_auth.lower()):
                contradictions.append(
                    "Earlier you mentioned no authentication was needed, but now it seems users will need login access. Should we add authentication?"
                )

    return contradictions[0] if contradictions else None


def calculate_coverage(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate requirement coverage based on the graph.
    Returns overall percentage, collected fields, missing fields.
    """
    collected = []
    missing = []

    weights = {}
    total_weight = 0
    for field, priority in FIELD_PRIORITY.items():
        weight = priority / 100.0
        if field in CRITICAL_FIELDS:
            weight *= 1.5
        elif field in IMPORTANT_FIELDS:
            weight *= 1.2
        weights[field] = weight
        total_weight += weight

    filled_weight = 0
    for field, weight in weights.items():
        val = graph.get(field)
        is_filled = False
        if field in SCALAR_FIELDS:
            is_filled = bool(val and str(val).strip())
        elif field in LIST_FIELDS:
            is_filled = bool(val and len(val) > 0)

        if is_filled:
            collected.append(field)
            filled_weight += weight
        else:
            missing.append(field)

    overall = round((filled_weight / total_weight) * 100) if total_weight > 0 else 0
    overall = min(overall, 100)

    # Categorize the missing fields
    missing_critical = [f for f in missing if f in CRITICAL_FIELDS]
    missing_important = [f for f in missing if f in IMPORTANT_FIELDS]
    missing_optional = [f for f in missing if f in OPTIONAL_FIELDS]

    # Rank missing fields by priority
    ranked_missing = sorted(missing, key=lambda f: FIELD_PRIORITY.get(f, 0), reverse=True)

    return {
        "overall_percent": overall,
        "collected_fields": collected,
        "missing_fields": missing,
        "missing_critical": missing_critical,
        "missing_important": missing_important,
        "missing_optional": missing_optional,
        "ranked_missing": ranked_missing,
        "field_labels": {f: FIELD_LABELS.get(f, f) for f in collected + missing},
    }


def get_next_question_fields(
    graph: Dict[str, Any],
    coverage: Dict[str, Any],
    question_count: int
) -> Optional[List[str]]:
    """
    Determine which fields to ask about next.
    Returns a list of 2-3 fields to combine into one question,
    or None if the interview should end.
    """
    missing = coverage.get("missing_fields", [])
    critical_missing = [f for f in missing if f in CRITICAL_FIELDS]

    # Hard stop at 10 questions
    if question_count >= 10:
        return None

    # Stop at 8+ if no critical fields missing
    if question_count >= 8 and not critical_missing:
        return None

    # Stop if coverage is high enough and critical fields done
    if coverage["overall_percent"] >= 90 and not critical_missing:
        return None

    # Stop at 6+ if coverage is very high
    if question_count >= 6 and coverage["overall_percent"] >= 85 and not critical_missing:
        return None

    # Rank missing fields by priority
    ranked = sorted(missing, key=lambda f: FIELD_PRIORITY.get(f, 0), reverse=True)

    if not ranked:
        return None

    # Take top 2-3 fields
    return ranked[:3] if ranked else None


def get_opening_question() -> str:
    """Return the opening question for the interview."""
    return "Tell me about your business — what do you do, and what are you looking to build?"


def get_graph_summary_for_prompt(graph: Dict[str, Any]) -> str:
    """Generate a concise summary of the graph for Gemini prompts."""
    parts = []
    for field in SCALAR_FIELDS:
        val = graph.get(field)
        if val:
            parts.append(f"- {FIELD_LABELS.get(field, field)}: {val}")
    for field in LIST_FIELDS:
        val = graph.get(field)
        if val and len(val) > 0:
            parts.append(f"- {FIELD_LABELS.get(field, field)}: {', '.join(str(v) for v in val)}")
    return "\n".join(parts) if parts else "No information collected yet."


def format_qa_history(qa_history: List[Dict]) -> str:
    """Format Q&A history for Gemini prompts."""
    if not qa_history:
        return "No previous conversation."
    lines = []
    for qa in qa_history:
        lines.append(f"Q{qa.get('q', '?')}: {qa.get('question', 'N/A')}")
        lines.append(f"A{qa.get('q', '?')}: {qa.get('answer', 'N/A')}")
    return "\n".join(lines)
