"""
Helix Adaptive Business Interview Engine

Startup mentor & Business Analyst style requirement gathering.
Maintains a structured requirement model, detects missing info,
ranks knowledge gaps, and determines when the interview is
naturally complete.

The conversation should feel like discussing a business idea with a
knowledgeable partner — not filling out a form.

Target: 6–7 questions. Additional questions ONLY if critical info missing.
"""

import copy
from typing import Dict, List, Optional, Any, Tuple


# ═══════════════════════════════════════════════════════════════
# REQUIREMENT GRAPH TEMPLATE
# ═══════════════════════════════════════════════════════════════
# Structured requirement model organized by category.
# After EVERY user answer the engine silently updates this model
# with only the information the user has actually mentioned.
# Never invent information.

REQUIREMENT_GRAPH_TEMPLATE: Dict[str, Any] = {
    # ── Business Information ──
    "project_name": None,            # Business Name (if mentioned)
    "business_domain": None,         # Business Domain
    "industry": None,                # Industry (auto-detected)
    "business_description": None,    # Business Idea
    "business_goal": None,           # Business Goal
    "problem_statement": None,       # Problem the business solves
    "vision": None,                  # Long-term vision

    # ── Business Model ──
    "products_or_services": None,    # What they sell/offer
    "revenue_model": None,           # How they make money
    "sales_channel": None,           # Online, offline, both
    "customer_type": None,           # B2B, B2C, B2B2C
    "business_model": None,          # Overall business model

    # ── Users ──
    "target_audience": [],           # Target Customers
    "stakeholders": [],              # Business Stakeholders
    "roles": [],                     # User Roles in the system
    "target_users": [],              # End users

    # ── Business Process ──
    "workflow": None,                # Business Workflow
    "current_process": None,         # How things work today
    "future_process": None,          # How they want things to work

    # ── Software Requirements ──
    "key_features": [],              # Core Features
    "core_modules": [],              # Core Modules
    "optional_modules": [],          # Optional Features
    "ai_features": [],               # AI/ML Features
    "reports": None,                 # Reporting needs
    "notifications": None,           # Notification needs

    # ── Technical Requirements ──
    "integrations": [],              # Third-party Integrations
    "platforms": [],                 # Web, Mobile, Desktop
    "authentication": None,          # Auth requirements
    "payments": None,                # Payment Gateway
    "tech_preferences": [],          # Technology preferences

    # ── Non-functional Requirements ──
    "security_requirements": [],     # Security needs
    "scalability_needs": None,       # Scalability

    # ── Project Information ──
    "timeline": None,                # Timeline
    "budget_range": None,            # Budget (Optional)
    "future_scope": [],              # Future Expansion
    "risks": [],                     # Risks
    "constraints": [],               # Constraints

    # ── Additional Context ──
    "project_type": None,
    "application_type": None,
    "desired_outcomes": None,
}


# ── Field Type Classification ──
# Used by update_graph to merge extraction data correctly.

SCALAR_FIELDS = {
    "project_name", "business_domain", "industry",
    "business_description", "business_goal", "problem_statement", "vision",
    "products_or_services", "revenue_model", "sales_channel",
    "customer_type", "business_model",
    "workflow", "current_process", "future_process",
    "reports", "notifications",
    "authentication", "payments",
    "scalability_needs",
    "timeline", "budget_range",
    "project_type", "application_type", "desired_outcomes",
}

LIST_FIELDS = {
    "target_audience", "stakeholders", "roles", "target_users",
    "key_features", "core_modules", "optional_modules", "ai_features",
    "integrations", "platforms", "tech_preferences",
    "security_requirements",
    "future_scope", "risks", "constraints",
}


# ── Human-readable labels for prompts and UI ──

FIELD_LABELS = {
    "project_name": "Business Name",
    "business_domain": "Business Domain",
    "industry": "Industry",
    "business_description": "Business Idea",
    "business_goal": "Business Goal",
    "problem_statement": "Problem Statement",
    "vision": "Vision",
    "products_or_services": "Products or Services",
    "revenue_model": "Revenue Model",
    "sales_channel": "Sales Channel",
    "customer_type": "Customer Type",
    "business_model": "Business Model",
    "target_audience": "Target Customers",
    "stakeholders": "Stakeholders",
    "roles": "User Roles",
    "target_users": "Target Users",
    "workflow": "Business Workflow",
    "current_process": "Current Process",
    "future_process": "Future Process",
    "key_features": "Core Features",
    "core_modules": "Core Modules",
    "optional_modules": "Optional Features",
    "ai_features": "AI Features",
    "reports": "Reports & Analytics",
    "notifications": "Notifications",
    "integrations": "Third-party Integrations",
    "platforms": "Platforms",
    "authentication": "Authentication",
    "payments": "Payment Gateway",
    "tech_preferences": "Technology Preferences",
    "security_requirements": "Security Requirements",
    "scalability_needs": "Scalability",
    "timeline": "Timeline",
    "budget_range": "Budget",
    "future_scope": "Future Expansion",
    "risks": "Risks",
    "constraints": "Constraints",
    "project_type": "Project Type",
    "application_type": "Application Type",
    "desired_outcomes": "Desired Outcomes",
}


# ═══════════════════════════════════════════════════════════════
# FIELD PRIORITY & CLASSIFICATION
# ═══════════════════════════════════════════════════════════════
# Higher = more important to ask first.
# The engine extracts as much as possible from each answer,
# so only the BIGGEST knowledge gap triggers the next question.

FIELD_PRIORITY: Dict[str, int] = {
    # ── Critical: What is the business and what problem does it solve? ──
    "business_description": 100,
    "problem_statement": 95,
    "business_goal": 90,

    # ── Important: Core details for requirement documents ──
    "key_features": 85,
    "target_audience": 80,
    "revenue_model": 75,
    "roles": 70,
    "workflow": 65,

    # ── Useful: Improves document quality ──
    "products_or_services": 55,
    "sales_channel": 52,
    "customer_type": 50,
    "platforms": 48,
    "timeline": 45,
    "integrations": 42,
    "current_process": 40,
    "future_process": 38,

    # ── Optional: Nice to have, often inferrable ──
    "business_model": 30,
    "business_domain": 28,
    "industry": 25,
    "authentication": 22,
    "payments": 20,
    "reports": 18,
    "notifications": 16,
    "scalability_needs": 14,
    "security_requirements": 12,
    "ai_features": 10,
    "budget_range": 8,
    "tech_preferences": 6,
    "constraints": 5,
    "future_scope": 4,
    "optional_modules": 3,
    "vision": 2,
    "risks": 1,

    # ── Derived/legacy: Not asked about directly ──
    "project_name": 0,
    "project_type": 0,
    "application_type": 0,
    "desired_outcomes": 0,
    "target_users": 0,
    "core_modules": 0,
    "stakeholders": 0,
}

# Fields that are CRITICAL — interview cannot end without them
CRITICAL_FIELDS = {
    "business_description", "problem_statement", "business_goal"
}

# Fields that are IMPORTANT but not blocking
IMPORTANT_FIELDS = {
    "key_features", "target_audience", "revenue_model", "roles", "workflow"
}

# Fields that are NICE TO HAVE
OPTIONAL_FIELDS = {
    "products_or_services", "sales_channel", "customer_type",
    "platforms", "timeline", "integrations", "current_process",
    "future_process", "business_model", "business_domain",
    "industry", "authentication", "payments", "reports",
    "notifications", "scalability_needs", "security_requirements",
    "ai_features", "budget_range", "tech_preferences",
    "constraints", "future_scope", "optional_modules", "vision",
    "risks", "project_name", "project_type", "application_type",
    "desired_outcomes", "target_users", "core_modules", "stakeholders",
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
    "finance": {
        "expected_modules": ["portfolio_management", "transactions", "compliance", "reporting", "risk_management", "user_dashboard"],
        "expected_roles": ["investor", "advisor", "compliance_officer", "admin"],
        "domain_questions": ["investment types supported", "regulatory compliance", "real-time market data"],
        "typical_integrations": ["market_data_feeds", "payment_gateway", "kyc_verification"],
    },
}

# Industry keyword mapping for auto-detection
INDUSTRY_KEYWORDS: Dict[str, List[str]] = {
    "restaurant": ["restaurant", "food", "dining", "cafe", "kitchen", "menu", "catering", "food delivery", "eatery"],
    "hospital": ["hospital", "clinic", "medical", "healthcare", "patient", "doctor", "appointment"],
    "ecommerce": ["ecommerce", "e-commerce", "online store", "shop", "sell products", "marketplace", "shopping"],
    "school": ["school", "college", "university", "students", "teachers", "education management", "campus"],
    "manufacturing": ["manufacturing", "factory", "production", "assembly", "plant", "jewellery", "jewelry"],
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
    "agriculture": ["agriculture", "farming", "crop", "agri", "farm management", "farmer"],
    "finance": ["finance", "investment", "stock", "mutual fund", "portfolio", "wealth management", "trading"],
}


# ═══════════════════════════════════════════════════════════════
# DOMAIN-SPECIFIC NAMED CHECKLIST ITEMS
# ═══════════════════════════════════════════════════════════════
# Each domain gets a list of human-readable named requirement items
# that appear in the checklist ONLY when that domain is detected.
# These use a "domain_" prefix on field keys so they never clash
# with universal graph fields.

DOMAIN_CHECKLIST_ITEMS: Dict[str, List[Dict[str, str]]] = {
    "restaurant": [
        {"field": "domain_menu_management",  "label": "Menu Management"},
        {"field": "domain_food_ordering",    "label": "Food Ordering"},
        {"field": "domain_table_management", "label": "Table Management"},
        {"field": "domain_kitchen_workflow", "label": "Kitchen Workflow"},
        {"field": "domain_delivery",         "label": "Delivery"},
        {"field": "domain_payment",          "label": "Payment"},
        {"field": "domain_customer_mgmt",    "label": "Customer Management"},
        {"field": "domain_staff_roles",      "label": "Staff Roles"},
    ],
    "hospital": [
        {"field": "domain_patient_mgmt",     "label": "Patient Management"},
        {"field": "domain_doctor_mgmt",      "label": "Doctor Management"},
        {"field": "domain_appointments",     "label": "Appointment Management"},
        {"field": "domain_medical_records",  "label": "Medical Records"},
        {"field": "domain_billing",          "label": "Billing"},
        {"field": "domain_pharmacy",         "label": "Pharmacy"},
        {"field": "domain_compliance",       "label": "Compliance"},
        {"field": "domain_staff_roles",      "label": "User Roles"},
    ],
    "healthcare": [
        {"field": "domain_patient_mgmt",     "label": "Patient Management"},
        {"field": "domain_teleconsult",      "label": "Teleconsultation"},
        {"field": "domain_prescriptions",    "label": "Prescriptions"},
        {"field": "domain_health_monitoring","label": "Health Monitoring"},
        {"field": "domain_billing",          "label": "Billing"},
        {"field": "domain_compliance",       "label": "Compliance"},
    ],
    "ecommerce": [
        {"field": "domain_products",         "label": "Products"},
        {"field": "domain_shopping_cart",    "label": "Shopping Cart"},
        {"field": "domain_orders",           "label": "Orders"},
        {"field": "domain_payment",          "label": "Payments"},
        {"field": "domain_shipping",         "label": "Shipping"},
        {"field": "domain_inventory",        "label": "Inventory"},
        {"field": "domain_discounts",        "label": "Discounts & Promotions"},
        {"field": "domain_customer_mgmt",    "label": "Customers"},
    ],
    "school": [
        {"field": "domain_student_mgmt",     "label": "Student Management"},
        {"field": "domain_teacher_mgmt",     "label": "Teacher Management"},
        {"field": "domain_attendance",       "label": "Attendance"},
        {"field": "domain_assessments",      "label": "Assessments"},
        {"field": "domain_timetable",        "label": "Timetable"},
        {"field": "domain_parent_access",    "label": "Parent Access"},
        {"field": "domain_fees",             "label": "Fee Management"},
    ],
    "education": [
        {"field": "domain_courses",          "label": "Courses"},
        {"field": "domain_student_mgmt",     "label": "Student Management"},
        {"field": "domain_teacher_mgmt",     "label": "Teacher / Instructor"},
        {"field": "domain_content_delivery", "label": "Learning Content"},
        {"field": "domain_assessments",      "label": "Assessments"},
        {"field": "domain_certificates",     "label": "Certificates"},
        {"field": "domain_payment",          "label": "Subscriptions / Payment"},
    ],
    "manufacturing": [
        {"field": "domain_production",       "label": "Production"},
        {"field": "domain_raw_materials",    "label": "Raw Materials"},
        {"field": "domain_inventory",        "label": "Inventory"},
        {"field": "domain_suppliers",        "label": "Suppliers"},
        {"field": "domain_quality_control",  "label": "Quality Control"},
        {"field": "domain_workforce",        "label": "Employees"},
        {"field": "domain_reports",          "label": "Reports"},
        {"field": "domain_logistics",        "label": "Logistics"},
    ],
    "agriculture": [
        {"field": "domain_farmers",          "label": "Farmers"},
        {"field": "domain_crops",            "label": "Crops"},
        {"field": "domain_weather",          "label": "Weather Monitoring"},
        {"field": "domain_equipment",        "label": "Equipment"},
        {"field": "domain_inventory",        "label": "Inventory"},
        {"field": "domain_marketplace",      "label": "Marketplace"},
        {"field": "domain_buyers",           "label": "Buyers"},
        {"field": "domain_ai_recommendations","label": "AI Recommendations"},
    ],
    "real_estate": [
        {"field": "domain_properties",       "label": "Properties"},
        {"field": "domain_property_search",  "label": "Property Search"},
        {"field": "domain_listings",         "label": "Property Listings"},
        {"field": "domain_buyers",           "label": "Buyers"},
        {"field": "domain_sellers",          "label": "Sellers"},
        {"field": "domain_agents",           "label": "Agents"},
        {"field": "domain_appointments",     "label": "Appointments"},
        {"field": "domain_payment",          "label": "Payments"},
        {"field": "domain_documents",        "label": "Documents"},
    ],
    "logistics": [
        {"field": "domain_fleet_mgmt",       "label": "Fleet Management"},
        {"field": "domain_route_opt",        "label": "Route Optimization"},
        {"field": "domain_tracking",         "label": "Tracking"},
        {"field": "domain_warehouse",        "label": "Warehouse"},
        {"field": "domain_billing",          "label": "Billing"},
        {"field": "domain_staff_roles",      "label": "Driver & Staff Roles"},
    ],
    "banking": [
        {"field": "domain_accounts",         "label": "Account Management"},
        {"field": "domain_transactions",     "label": "Transactions"},
        {"field": "domain_loans",            "label": "Loans & Credit"},
        {"field": "domain_kyc",              "label": "KYC Verification"},
        {"field": "domain_compliance",       "label": "Compliance"},
        {"field": "domain_reports",          "label": "Reports"},
    ],
    "finance": [
        {"field": "domain_portfolio",        "label": "Portfolio Management"},
        {"field": "domain_transactions",     "label": "Transactions"},
        {"field": "domain_compliance",       "label": "Compliance"},
        {"field": "domain_reports",          "label": "Reports"},
        {"field": "domain_risk_mgmt",        "label": "Risk Management"},
    ],
    "travel": [
        {"field": "domain_search_booking",   "label": "Search & Booking"},
        {"field": "domain_itinerary",        "label": "Itinerary"},
        {"field": "domain_payment",          "label": "Payments"},
        {"field": "domain_reviews",          "label": "Reviews"},
        {"field": "domain_loyalty",          "label": "Loyalty Program"},
    ],
    "hr": [
        {"field": "domain_recruitment",      "label": "Recruitment"},
        {"field": "domain_employee_mgmt",    "label": "Employee Management"},
        {"field": "domain_payroll",          "label": "Payroll"},
        {"field": "domain_attendance",       "label": "Attendance"},
        {"field": "domain_leave_mgmt",       "label": "Leave Management"},
        {"field": "domain_performance",      "label": "Performance Reviews"},
    ],
    "saas": [
        {"field": "domain_user_mgmt",        "label": "User Management"},
        {"field": "domain_subscription",     "label": "Subscription & Billing"},
        {"field": "domain_dashboard",        "label": "Dashboard"},
        {"field": "domain_api_access",       "label": "API Access"},
        {"field": "domain_analytics",        "label": "Analytics"},
        {"field": "domain_admin_panel",      "label": "Admin Panel"},
    ],
    "erp": [
        {"field": "domain_finance_module",   "label": "Finance"},
        {"field": "domain_hr_module",        "label": "HR"},
        {"field": "domain_inventory",        "label": "Inventory"},
        {"field": "domain_procurement",      "label": "Procurement"},
        {"field": "domain_reports",          "label": "Reports"},
    ],
    "crm": [
        {"field": "domain_contacts",         "label": "Contact Management"},
        {"field": "domain_pipeline",         "label": "Sales Pipeline"},
        {"field": "domain_deals",            "label": "Deals"},
        {"field": "domain_email_tracking",   "label": "Email Tracking"},
        {"field": "domain_automation",       "label": "Automation"},
        {"field": "domain_reports",          "label": "Reports"},
    ],
}


# ── Evidence signals per domain item ────────────────────────────────────────
# Maps each domain_field key to a list of keyword tuples.
# If ANY keyword from ANY tuple is found in the combined graph text,
# the item is marked complete (if 2+ keywords match) or partial (if 1 matches).
# Format: List of keyword-lists. Any keyword-list can trigger the item.

DOMAIN_ITEM_SIGNALS: Dict[str, List[List[str]]] = {
    # Restaurant
    "domain_menu_management":  [["menu", "dish", "item", "food item", "cuisine", "category"]],
    "domain_food_ordering":    [["order", "ordering", "place order", "add to cart"]],
    "domain_table_management": [["table", "dine-in", "reservation", "seating", "seat"]],
    "domain_kitchen_workflow": [["kitchen", "chef", "cook", "kitchen display", "kot", "order ticket"]],
    "domain_delivery":         [["delivery", "deliver", "rider", "courier", "home delivery"]],
    "domain_payment":          [["pay", "payment", "checkout", "online payment", "cash", "upi", "card"]],
    "domain_customer_mgmt":    [["customer", "guest", "client", "loyalty", "loyalty program"]],
    "domain_staff_roles":      [["staff", "role", "waiter", "manager", "cashier", "admin", "employee"]],
    # Hospital / Healthcare
    "domain_patient_mgmt":     [["patient", "patient record", "patient profile", "case"]],
    "domain_doctor_mgmt":      [["doctor", "physician", "specialist", "consultant"]],
    "domain_appointments":     [["appointment", "booking", "schedule", "slot", "consultation"]],
    "domain_medical_records":  [["record", "history", "ehr", "emr", "report", "prescription", "lab"]],
    "domain_billing":          [["bill", "invoice", "payment", "insurance", "fee"]],
    "domain_pharmacy":         [["pharmacy", "medicine", "drug", "prescription"]],
    "domain_compliance":       [["compliance", "hipaa", "gdpr", "regulation", "audit", "standard"]],
    "domain_teleconsult":      [["tele", "video", "online consult", "remote", "telemedicine"]],
    "domain_prescriptions":    [["prescription", "medicine", "drug", "dose"]],
    "domain_health_monitoring":[["monitor", "wearable", "vitals", "health data", "sensor"]],
    # E-commerce
    "domain_products":         [["product", "item", "catalog", "listing", "sku"]],
    "domain_shopping_cart":    [["cart", "basket", "add to cart", "wishlist"]],
    "domain_orders":           [["order", "purchase", "tracking", "fulfillment"]],
    "domain_shipping":         [["ship", "shipping", "courier", "delivery", "dispatch"]],
    "domain_inventory":        [["inventory", "stock", "warehouse", "quantity"]],
    "domain_discounts":        [["discount", "coupon", "promo", "offer", "deal"]],
    # Education
    "domain_courses":          [["course", "lesson", "module", "curriculum", "subject"]],
    "domain_student_mgmt":     [["student", "learner", "pupil", "enrollment"]],
    "domain_teacher_mgmt":     [["teacher", "instructor", "tutor", "faculty", "professor"]],
    "domain_content_delivery": [["video", "lecture", "content", "material", "upload", "stream"]],
    "domain_assessments":      [["test", "exam", "quiz", "assignment", "assessment", "grade"]],
    "domain_certificates":     [["certificate", "credential", "badge", "diploma"]],
    "domain_attendance":       [["attendance", "present", "absent", "check-in"]],
    "domain_timetable":        [["timetable", "schedule", "class schedule", "period"]],
    "domain_parent_access":    [["parent", "guardian", "parent portal"]],
    "domain_fees":             [["fee", "tuition", "payment", "invoice"]],
    # Manufacturing
    "domain_production":       [["production", "manufacture", "assembly", "batch"]],
    "domain_raw_materials":    [["raw material", "material", "ingredient", "component"]],
    "domain_suppliers":        [["supplier", "vendor", "procurement"]],
    "domain_quality_control":  [["quality", "qc", "inspection", "defect", "standard"]],
    "domain_workforce":        [["worker", "employee", "operator", "staff"]],
    "domain_reports":          [["report", "analytics", "dashboard", "kpi", "chart"]],
    "domain_logistics":        [["logistic", "dispatch", "distribution", "transport"]],
    # Agriculture
    "domain_farmers":          [["farmer", "grower", "cultivator"]],
    "domain_crops":            [["crop", "plant", "harvest", "seed", "field"]],
    "domain_weather":          [["weather", "forecast", "rain", "temperature", "climate"]],
    "domain_equipment":        [["equipment", "machine", "tractor", "tool", "implement"]],
    "domain_marketplace":      [["market", "sell", "buyer", "trade", "platform"]],
    "domain_buyers":           [["buyer", "customer", "consumer", "purchaser"]],
    "domain_sellers":          [["seller", "vendor", "agent"]],
    "domain_ai_recommendations":[["ai", "recommend", "suggestion", "predict", "forecast"]],
    # Real Estate
    "domain_properties":       [["property", "house", "apartment", "flat", "land", "building"]],
    "domain_property_search":  [["search", "filter", "find property", "browse"]],
    "domain_listings":         [["listing", "post", "advertise", "list property"]],
    "domain_agents":           [["agent", "broker", "realtor"]],
    "domain_documents":        [["document", "contract", "agreement", "deed", "sign"]],
    # Logistics
    "domain_fleet_mgmt":       [["fleet", "vehicle", "truck", "driver"]],
    "domain_route_opt":        [["route", "navigation", "optimize", "gps", "path"]],
    "domain_tracking":         [["track", "real-time", "location", "status"]],
    "domain_warehouse":        [["warehouse", "depot", "storage", "inventory"]],
    # Banking / Finance
    "domain_accounts":         [["account", "bank account", "savings", "current"]],
    "domain_transactions":     [["transaction", "transfer", "payment", "debit", "credit"]],
    "domain_loans":            [["loan", "credit", "emi", "borrow", "lending"]],
    "domain_kyc":              [["kyc", "identity", "verification", "aadhaar", "pan"]],
    "domain_portfolio":        [["portfolio", "investment", "stock", "mutual fund", "trade"]],
    "domain_risk_mgmt":        [["risk", "exposure", "hedging", "compliance"]],
    # Travel
    "domain_search_booking":   [["book", "search", "flight", "hotel", "package"]],
    "domain_itinerary":        [["itinerary", "trip", "plan", "schedule"]],
    "domain_reviews":          [["review", "rating", "feedback"]],
    "domain_loyalty":          [["loyalty", "reward", "point", "membership"]],
    # HR
    "domain_recruitment":      [["recruit", "hire", "job", "candidate", "applicant"]],
    "domain_employee_mgmt":    [["employee", "staff", "worker", "onboard"]],
    "domain_payroll":          [["payroll", "salary", "wage", "pay"]],
    "domain_leave_mgmt":       [["leave", "vacation", "absence", "holiday"]],
    "domain_performance":      [["performance", "review", "appraisal", "kpi"]],
    # SaaS
    "domain_user_mgmt":        [["user", "account", "profile", "member"]],
    "domain_subscription":     [["subscription", "plan", "pricing", "billing", "tier"]],
    "domain_dashboard":        [["dashboard", "overview", "analytics", "panel"]],
    "domain_api_access":       [["api", "integration", "webhook", "endpoint"]],
    "domain_analytics":        [["analytics", "report", "metric", "insight"]],
    "domain_admin_panel":      [["admin", "admin panel", "management", "control"]],
    # ERP
    "domain_finance_module":   [["finance", "accounting", "ledger", "invoice"]],
    "domain_hr_module":        [["hr", "employee", "payroll", "human resource"]],
    "domain_procurement":      [["procurement", "purchase", "supplier", "vendor"]],
    # CRM
    "domain_contacts":         [["contact", "lead", "prospect", "client", "customer"]],
    "domain_pipeline":         [["pipeline", "funnel", "stage", "deal"]],
    "domain_deals":            [["deal", "opportunity", "sale", "close"]],
    "domain_email_tracking":   [["email", "tracking", "open", "click", "campaign"]],
    "domain_automation":       [["automation", "workflow", "trigger", "sequence"]],
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
    Never invents information — only stores what the user actually mentioned.
    Also stores confidence_hints from Gemini to power partial vs complete scoring.
    """
    for field in SCALAR_FIELDS:
        val = extraction.get(field)
        if val and isinstance(val, str) and val.strip():
            graph[field] = val.strip()

    for field in LIST_FIELDS:
        val = extraction.get(field)
        if val:
            # Ensure the field exists in the graph (backward compat)
            if field not in graph:
                graph[field] = []
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

    # ── Merge confidence_hints from Gemini ─────────────────────────────────
    # confidence_hints: {field: "explicit" | "implied" | "not_mentioned"}
    hints = extraction.get("confidence_hints", {})
    if hints and isinstance(hints, dict):
        existing_hints = graph.get("_confidence_hints", {})
        for field, hint in hints.items():
            if hint in ("explicit", "implied", "not_mentioned"):
                # Only upgrade, never downgrade: explicit > implied > not_mentioned
                current = existing_hints.get(field, "not_mentioned")
                rank = {"not_mentioned": 0, "implied": 1, "explicit": 2}
                if rank.get(hint, 0) > rank.get(current, 0):
                    existing_hints[field] = hint
        graph["_confidence_hints"] = existing_hints

    # Auto-detect industry from text fields if not yet set
    if not graph.get("industry"):
        for field in ["business_description", "business_goal", "problem_statement"]:
            if graph.get(field):
                detected = detect_industry(graph[field])
                if detected:
                    graph["industry"] = detected
                    break
        # Also check list fields for industry hints
        if not graph.get("industry"):
            all_text = " ".join(
                str(v) for v in
                graph.get("core_modules", []) +
                graph.get("target_users", []) +
                graph.get("key_features", [])
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


# ═══════════════════════════════════════════════════════════════
# DOMAIN-SPECIFIC FIELD MAPPING
# ═══════════════════════════════════════════════════════════════
# Maps each known industry to a list of additional field keys
# that are relevant for that domain (beyond universal fields).

DOMAIN_EXTRA_FIELDS: Dict[str, List[str]] = {
    "restaurant":    ["payments", "notifications", "workflow", "roles", "platforms", "integrations"],
    "hospital":      ["authentication", "security_requirements", "roles", "notifications", "integrations"],
    "healthcare":    ["authentication", "security_requirements", "roles", "notifications", "integrations"],
    "ecommerce":     ["payments", "integrations", "platforms", "notifications", "scalability_needs"],
    "school":        ["roles", "platforms", "notifications", "timeline"],
    "education":     ["roles", "platforms", "notifications", "timeline", "payments"],
    "manufacturing": ["workflow", "roles", "integrations", "scalability_needs", "current_process"],
    "saas":          ["authentication", "revenue_model", "scalability_needs", "integrations", "platforms"],
    "banking":       ["authentication", "security_requirements", "integrations", "scalability_needs"],
    "finance":       ["authentication", "security_requirements", "integrations", "scalability_needs"],
    "logistics":     ["workflow", "roles", "integrations", "platforms", "notifications"],
    "real_estate":   ["payments", "roles", "platforms", "notifications", "integrations"],
    "travel":        ["payments", "notifications", "integrations", "platforms"],
    "hr":            ["roles", "workflow", "integrations", "platforms", "notifications"],
    "erp":           ["roles", "workflow", "integrations", "platforms", "scalability_needs"],
    "crm":           ["roles", "integrations", "platforms", "notifications", "workflow"],
    "agriculture":   ["notifications", "integrations", "workflow", "platforms"],
}

# Inference rules: field → list of (condition_field, condition_check) pairs.
# If ANY condition is true, the field gets a "partial" status.
# condition_check is a callable(graph) -> bool.
PARTIAL_INFERENCE_RULES: Dict[str, List] = {
    "industry":       [("business_description", lambda g: bool(g.get("business_description")))],
    "customer_type":  [("target_audience",       lambda g: bool(g.get("target_audience")))],
    "workflow":       [("key_features",           lambda g: bool(g.get("key_features")) and bool(g.get("business_description")))],
    "business_model": [("revenue_model",          lambda g: bool(g.get("revenue_model"))),
                       ("sales_channel",          lambda g: bool(g.get("sales_channel")))],
    "notifications":  [("key_features",           lambda g: any(
                            kw in " ".join(str(f).lower() for f in (g.get("key_features") or []))
                            for kw in ["track", "remind", "alert", "status", "notify", "notif", "push"]
                       ))],
    "authentication": [("roles",                  lambda g: bool(g.get("roles")))],
    "payments":       [("sales_channel",          lambda g: "online" in str(g.get("sales_channel") or "").lower()),
                       ("key_features",           lambda g: any(
                            kw in " ".join(str(f).lower() for f in (g.get("key_features") or []))
                            for kw in ["pay", "payment", "checkout", "purchase", "buy"]
                       ))],
    "security_requirements": [
        ("authentication",       lambda g: bool(g.get("authentication"))),
        ("payments",             lambda g: bool(g.get("payments"))),
    ],
}


def get_domain_specific_fields(industry: Optional[str]) -> List[str]:
    """Return additional field keys relevant for the detected industry."""
    if not industry:
        return []
    return DOMAIN_EXTRA_FIELDS.get(industry.lower(), [])


def _get_field_evidence(graph: Dict[str, Any], field: str) -> Optional[str]:
    """Generate a short human-readable evidence string for a filled graph field."""
    val = graph.get(field)
    if not val:
        return None
    label = FIELD_LABELS.get(field, field)
    if isinstance(val, list):
        items = [str(v) for v in val[:3] if v]
        if not items:
            return None
        summary = ", ".join(items)
        if len(val) > 3:
            summary += f" (+{len(val) - 3} more)"
        return f"{label}: {summary}"
    return f"{label}: {str(val)[:80]}"


def _check_partial(graph: Dict[str, Any], field: str) -> bool:
    """Return True if the field can be inferred at partial confidence from the graph."""
    rules = PARTIAL_INFERENCE_RULES.get(field, [])
    return any(condition(graph) for _, condition in rules)


def get_domain_relevant_fields(graph: Dict[str, Any]) -> List[str]:
    """
    Determine the ordered list of UNIVERSAL fields to show in the checklist.
    Only includes the core universal fields + any additionally filled fields.
    Domain-specific named items are handled separately via DOMAIN_CHECKLIST_ITEMS.

    Priority order: critical → important → filled optional fields.
    Does NOT include ALL 30+ fields — only relevant ones.
    """
    industry = graph.get("industry")

    # Core universal base set (always shown)
    base = list(CRITICAL_FIELDS) + list(IMPORTANT_FIELDS)

    # Add domain-context fields (generic keys, not domain-named items)
    domain_extras = get_domain_specific_fields(industry)
    for f in domain_extras:
        if f not in base:
            base.append(f)

    # Deduplicate while preserving order
    seen = set()
    ordered = []
    for f in base:
        if f not in seen and FIELD_PRIORITY.get(f, 0) > 0:
            seen.add(f)
            ordered.append(f)

    # Include any additionally filled field (priority > 0, not already present)
    for field, val in graph.items():
        if field.startswith("_"):
            continue  # skip internal metadata fields like _confidence_hints
        if field in seen:
            continue
        if FIELD_PRIORITY.get(field, 0) == 0:
            continue
        is_filled = (
            (field in SCALAR_FIELDS and bool(val and str(val).strip())) or
            (field in LIST_FIELDS and bool(val and len(val) > 0))
        )
        if is_filled:
            seen.add(field)
            ordered.append(field)

    return ordered


# ── Minimum evidence thresholds for complete status ──────────────────────────
# A field is only "complete" if it has MEANINGFUL content, not just a token.
_SCALAR_MIN_CHARS = 8   # scalar values shorter than this → partial, not complete
_LIST_MIN_ITEMS   = 1   # list fields need at least 1 real item


def _build_graph_text(graph: Dict[str, Any]) -> str:
    """Build a single searchable text string from all graph values for domain item scoring."""
    parts = []
    for field, val in graph.items():
        if field.startswith("_"):
            continue
        if isinstance(val, str) and val.strip():
            parts.append(val.lower())
        elif isinstance(val, list):
            parts.extend(str(v).lower() for v in val if v)
    return " ".join(parts)


def _score_domain_item(field: str, label: str, graph_text: str) -> Dict[str, Any]:
    """
    Score a domain-specific named requirement item against the graph text.

    Returns a checklist item dict with status/confidence/evidence.

    Logic:
    - Check signal groups for this domain field.
    - Count how many signal groups have at least one keyword match.
    - If 2+ groups match → complete (0.90).
    - If 1 group matches → partial (0.55).
    - Otherwise → missing (0.0).
    """
    signal_groups = DOMAIN_ITEM_SIGNALS.get(field, [])
    if not signal_groups:
        return {"field": field, "label": label, "status": "missing", "confidence": 0.0, "evidence": None}

    matched_groups = 0
    evidence_kws: List[str] = []
    for group in signal_groups:
        for kw in group:
            if kw.lower() in graph_text:
                matched_groups += 1
                evidence_kws.append(kw)
                break  # one match per group is enough

    if matched_groups >= 2 or (len(signal_groups) == 1 and matched_groups >= 1 and len([kw for g in signal_groups for kw in g if kw.lower() in graph_text]) >= 2):
        status = "complete"
        confidence = 0.90
        evidence = f"Evidence: {', '.join(evidence_kws[:3])}"
    elif matched_groups >= 1:
        status = "partial"
        confidence = 0.55
        evidence = f"Implied via: {', '.join(evidence_kws[:2])}"
    else:
        status = "missing"
        confidence = 0.0
        evidence = None

    return {
        "field": field,
        "label": label,
        "status": status,
        "confidence": confidence,
        "evidence": evidence,
    }


def _is_field_complete(graph: Dict[str, Any], field: str) -> bool:
    """
    Return True only if the field has MEANINGFUL content (not just a filler word).
    Applies minimum length / count thresholds to prevent single-word false positives.
    Also considers confidence_hints from Gemini: an 'implied' hint downgrades to partial.
    """
    val = graph.get(field)
    hints = graph.get("_confidence_hints", {})
    hint = hints.get(field, "not_mentioned")

    # If Gemini says this field is only implied (not explicitly stated), don't mark complete
    if hint == "implied":
        return False

    if field in SCALAR_FIELDS:
        return bool(val and isinstance(val, str) and len(val.strip()) >= _SCALAR_MIN_CHARS)
    if field in LIST_FIELDS:
        if not val or not isinstance(val, list):
            return False
        real_items = [v for v in val if isinstance(v, str) and len(v.strip()) >= 2]
        return len(real_items) >= _LIST_MIN_ITEMS
    return False


def _is_field_partial(graph: Dict[str, Any], field: str) -> bool:
    """
    Return True if the field has some data but below the complete threshold,
    OR if the partial inference rules fire.
    """
    val = graph.get(field)
    hints = graph.get("_confidence_hints", {})
    hint = hints.get(field, "not_mentioned")

    # Short scalar value — has something but not enough for complete
    if field in SCALAR_FIELDS and val and isinstance(val, str):
        stripped = val.strip()
        if 1 <= len(stripped) < _SCALAR_MIN_CHARS:
            return True

    # Gemini said implied → partial
    if hint == "implied" and (
        (field in SCALAR_FIELDS and bool(val and str(val).strip())) or
        (field in LIST_FIELDS and bool(val and len(val) > 0))
    ):
        return True

    # Inference rules
    return _check_partial(graph, field)


def calculate_coverage(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate requirement coverage based on the graph.

    Returns:
    - overall_percent  : weighted coverage % (critical/important fields weighted higher)
    - checklist        : ordered list of requirement items — UNIVERSAL fields first,
                         then DOMAIN-SPECIFIC named items — each with status/confidence/evidence
    - domain           : detected business domain (None if unknown)
    - domain_label     : human-readable domain name for UI badge
    - collected_fields / missing_fields  : legacy keys (unchanged)
    - missing_critical / missing_important / missing_optional : for question targeting
    - ranked_missing / field_labels      : legacy compatibility

    Status values:
        complete  → meaningful evidence in conversation (confidence ≥ 0.9)
        partial   → some evidence but incomplete / implied (confidence 0.55)
        missing   → no evidence at all (confidence 0.0)

    Only complete items count toward %. Partial = half-credit.
    Denominator = domain-relevant universal fields only (no penalizing restaurant
    for missing 'medical records').
    """
    # ── Universal fields ─────────────────────────────────────────────────────
    relevant_fields = get_domain_relevant_fields(graph)
    industry = graph.get("industry")

    checklist: List[Dict] = []
    collected: List[str] = []   # complete fields (legacy)
    missing:   List[str] = []   # missing + partial (legacy)

    for field in relevant_fields:
        if _is_field_complete(graph, field):
            status     = "complete"
            confidence = 1.0
            evidence   = _get_field_evidence(graph, field)
            collected.append(field)
        elif _is_field_partial(graph, field):
            status     = "partial"
            confidence = 0.55
            evidence   = None
            missing.append(field)
        else:
            status     = "missing"
            confidence = 0.0
            evidence   = None
            missing.append(field)

        checklist.append({
            "field":      field,
            "label":      FIELD_LABELS.get(field, field),
            "status":     status,
            "confidence": confidence,
            "evidence":   evidence,
            "section":    "universal",
        })

    # ── Domain-specific named items ──────────────────────────────────────────
    domain_items_raw: List[Dict[str, str]] = []
    if industry:
        domain_items_raw = DOMAIN_CHECKLIST_ITEMS.get(industry.lower(), [])

    graph_text = _build_graph_text(graph)
    domain_checklist: List[Dict] = []

    for di in domain_items_raw:
        item = _score_domain_item(di["field"], di["label"], graph_text)
        item["section"] = "domain"
        domain_checklist.append(item)

    # ── Sort universal checklist: complete → partial → missing ───────────────
    status_order = {"complete": 0, "partial": 1, "missing": 2}
    checklist.sort(
        key=lambda x: (
            status_order[x["status"]],
            -FIELD_PRIORITY.get(x["field"], 0)
        )
    )

    # ── Sort domain checklist: complete → partial → missing ──────────────────
    domain_checklist.sort(key=lambda x: status_order[x["status"]])

    # ── Combined checklist (universal first, then domain) ────────────────────
    combined_checklist = checklist + domain_checklist

    # ── Weighted coverage % (universal fields only as denominator) ───────────
    total_weight  = 0.0
    filled_weight = 0.0
    for item in checklist:   # only universal fields in the weight calculation
        field    = item["field"]
        priority = FIELD_PRIORITY.get(field, 1)
        weight   = priority / 100.0
        if field in CRITICAL_FIELDS:
            weight *= 1.5
        elif field in IMPORTANT_FIELDS:
            weight *= 1.2
        total_weight += weight
        if item["status"] == "complete":
            filled_weight += weight
        elif item["status"] == "partial":
            filled_weight += weight * 0.5

    # Domain items give a small bonus (max +10%) to reward domain awareness
    domain_complete = sum(1 for d in domain_checklist if d["status"] == "complete")
    domain_total    = len(domain_checklist) or 1
    domain_bonus    = min((domain_complete / domain_total) * 0.10, 0.10)

    raw_pct = (filled_weight / total_weight) if total_weight > 0 else 0.0
    overall = round(min((raw_pct + domain_bonus) * 100, 100))

    # ── Legacy compatibility fields ──────────────────────────────────────────
    missing_critical  = [f for f in missing if f in CRITICAL_FIELDS]
    missing_important = [f for f in missing if f in IMPORTANT_FIELDS]
    missing_optional  = [f for f in missing if f in OPTIONAL_FIELDS]
    ranked_missing    = sorted(missing, key=lambda f: FIELD_PRIORITY.get(f, 0), reverse=True)
    all_label_fields  = collected + missing

    # Human-readable domain name for UI badge
    domain_label_map = {
        "restaurant":    "Restaurant",
        "hospital":      "Hospital",
        "healthcare":    "Healthcare",
        "ecommerce":     "E-Commerce",
        "school":        "School / College",
        "education":     "E-Learning / EdTech",
        "manufacturing": "Manufacturing",
        "agriculture":   "Agriculture",
        "real_estate":   "Real Estate",
        "logistics":     "Logistics",
        "banking":       "Banking / FinTech",
        "finance":       "Finance",
        "travel":        "Travel & Tourism",
        "hr":            "HR & Recruitment",
        "saas":          "SaaS Platform",
        "erp":           "ERP",
        "crm":           "CRM",
    }

    return {
        # ── New structured checklist ──
        "checklist":        combined_checklist,
        "domain":           industry,
        "domain_label":     domain_label_map.get(industry, industry.replace("_", " ").title()) if industry else None,
        # ── Legacy keys (unchanged for backward compatibility) ──
        "overall_percent":  overall,
        "collected_fields": collected,
        "missing_fields":   missing,
        "missing_critical":  missing_critical,
        "missing_important": missing_important,
        "missing_optional":  missing_optional,
        "ranked_missing":   ranked_missing,
        "field_labels":     {f: FIELD_LABELS.get(f, f) for f in all_label_fields},
    }


def get_next_question_fields(
    graph: Dict[str, Any],
    coverage: Dict[str, Any],
    question_count: int
) -> Optional[List[str]]:
    """
    Determine the single most important field to ask about next.
    Returns a list with 1 field (ONE topic per question),
    or None if the interview should end.

    Target: 6–7 questions. Hard max: 8.
    Ask additional questions ONLY if critical information is missing.
    """
    missing = coverage.get("missing_fields", [])
    critical_missing = [f for f in missing if f in CRITICAL_FIELDS]
    important_missing = [f for f in missing if f in IMPORTANT_FIELDS]

    # ── Hard stop at 8 questions ──
    if question_count >= 8:
        return None

    # ── Stop at 7+ if no critical fields missing ──
    if question_count >= 7 and not critical_missing:
        return None

    # ── Stop at 6+ if coverage is decent and no critical gaps ──
    if question_count >= 6 and coverage["overall_percent"] >= 65 and not critical_missing:
        return None

    # ── Stop at 5+ if coverage is very good ──
    if question_count >= 5 and coverage["overall_percent"] >= 80 and not critical_missing:
        return None

    # ── Stop if all critical + important fields are covered ──
    if not critical_missing and not important_missing and coverage["overall_percent"] >= 70:
        return None

    # ── Rank remaining fields by priority ──
    ranked = sorted(missing, key=lambda f: FIELD_PRIORITY.get(f, 0), reverse=True)
    if not ranked:
        return None

    # Only consider fields worth asking about (priority > 0)
    askable = [f for f in ranked if FIELD_PRIORITY.get(f, 0) > 0]
    if not askable:
        return None

    # ── Return ONE field — single topic per question ──
    return [askable[0]]


def get_opening_question(name: str = "") -> str:
    """Return the opening question for the interview, addressing user by first name if available."""
    first_name = name.strip().split()[0].capitalize() if name and name.strip() else ""
    if first_name:
        return f"Hey {first_name}! Tell me about the business idea you're thinking about."
    return "Hey! Tell me about the business idea you're thinking about."


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
