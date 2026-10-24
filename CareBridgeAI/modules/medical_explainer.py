import os
import re
import json
import requests
from dotenv import load_dotenv

load_dotenv()

# Common Medical Glossary for offline / local explanations
MEDICAL_GLOSSARY = {
    # Beta-blockers & Cardiovascular
    "betaloc": "A brand name for metoprolol tartrate, a beta-blocker medicine that slows down heart rate and lowers high blood pressure.",
    "oxprenolol": "A non-cardioselective beta-blocker medication used to treat high blood pressure, angina (chest pain), and irregular heart rhythms.",
    "metoprolol": "A beta-blocker medicine that slows down heart rate and lowers blood pressure.",
    "lisinopril": "An ACE inhibitor blood pressure medication that relaxes blood vessels so blood flows more smoothly.",
    "furosemide": "A water pill (diuretic) that helps your body get rid of extra salt and fluid through urine.",
    "atorvastatin": "A cholesterol-lowering medication (statin) that protects heart and blood vessel health.",
    "atorva": "Atorvastatin, a medication used to lower bad cholesterol and reduce the risk of heart disease.",
    "clopidogrel": "A blood thinner that prevents blood clots after heart procedures, stents, or heart attacks.",
    "clopilet": "A brand name for clopidogrel, a blood thinner that prevents platelets from sticking together to form clots.",
    "ecosprin": "Low-dose enteric-coated aspirin (75mg/150mg) used to prevent blood clots and protect against heart attacks.",
    "metolar": "Extended-release metoprolol succinate, prescribed to maintain stable heart rate and blood pressure.",

    # Gastrointestinal & Acid Reducers
    "cimetidine": "An H2-receptor blocker that reduces stomach acid production, treating heartburn, acid reflux, and stomach ulcers.",
    "pantoprazole": "A proton pump inhibitor (PPI) that decreases the amount of acid produced in the stomach.",
    "pantocid": "A brand name for pantoprazole, taken before breakfast to protect the stomach lining and prevent acid reflux.",

    # Eye & Glaucoma
    "dorzolamidum": "Dorzolamide, an eye medication (carbonic anhydrase inhibitor) that reduces high fluid pressure inside the eyes.",
    "dorzolamide": "A medication that lowers high intraocular pressure in patients with open-angle glaucoma or ocular hypertension.",

    # Pain, Antibiotics & Post-Op
    "acetaminophen": "A common over-the-counter pain reliever and fever reducer (like Tylenol or Paracetamol).",
    "cephalexin": "An antibiotic medicine used to treat or prevent bacterial infections.",
    "ibuprofen": "A non-steroidal anti-inflammatory drug (NSAID) used for pain and swelling reduction.",
    "cholecystectomy": "Surgical removal of the gallbladder.",
    "laparoscopic": "A minimally invasive surgery done through tiny keyhole incisions with a camera.",
    "edema": "Swelling caused by fluid trapped in your body's tissues (often in feet, ankles, or legs).",
    "hypertension": "High blood pressure.",
    "congestive heart failure": "A condition where the heart doesn't pump blood as strongly as it should, often causing fluid buildup.",
    "exacerbation": "A sudden worsening of symptoms or flare-up of a chronic condition.",
    "sodium restricted": "Eating less salt (under 2,000 mg/day) to prevent fluid retention and protect your heart and kidneys.",
    "post-op": "Post-operative, meaning the period right after surgery.",

    # Standard Clinical Prescription Shorthand / Latin Abbreviations
    "bid": "Twice a day (from Latin 'bis in die') — taken approximately every 12 hours (morning and evening).",
    "tid": "Three times a day (from Latin 'ter in die') — taken approximately every 8 hours (morning, afternoon, and evening).",
    "qd": "Once daily (from Latin 'quaque die') — taken once every 24 hours at the same time each day.",
    "qid": "Four times a day (from Latin 'quater in die') — taken every 6 hours.",
    "od": "Once a day (from Latin 'omne in die') — taken once daily.",
    "prn": "As needed (from Latin 'pro re nata') — taken only when necessary for specific symptoms.",
    "q8h": "Every 8 hours throughout the day.",
    "q12h": "Every 12 hours throughout the day.",
    "tab": "Tablet, a solid pill to be swallowed with water.",
    "cap": "Capsule, medication enclosed in an easy-to-swallow gelatin shell.",
    "po": "By mouth (from Latin 'per os').",
    "pc": "After meals (from Latin 'post cibum').",
    "ac": "Before meals (from Latin 'ante cibum').",
    "refill": "Permission from your doctor to obtain an additional supply of medicine from the pharmacy without another appointment."
}

def explain_terms_in_text(text: str):
    """Identifies and explains medical terms present in the text with word boundary matching."""
    found_terms = {}
    lower = text.lower()
    for term, definition in MEDICAL_GLOSSARY.items():
        if re.search(r'\b' + re.escape(term) + r'\b', lower):
            key = term.upper() if len(term) <= 4 else term.title()
            found_terms[key] = definition
    return found_terms

try:
    from modules.disease_diet_planner import is_document_metadata_line, generate_disease_diet_plan, format_diet_plan_markdown
except ModuleNotFoundError:
    from disease_diet_planner import is_document_metadata_line, generate_disease_diet_plan, format_diet_plan_markdown

def generate_local_explanation(document_text: str):
    """
    Offline patient-friendly explanation generator.
    Parses document text, groups instructions into clean sections,
    and extracts medical terminology without modifying dosages or dates.
    Integrates AI disease-specific diet plan and excludes administrative metadata.
    """
    lines = [l.strip() for l in document_text.split("\n") if l.strip()]
    
    sections = {
        "Medications": [],
        "Diet & Daily Care": [],
        "Follow-Up Appointments": [],
        "Warning Signs (Red Flags)": []
    }
    
    current_sec = "General Instructions"
    for line in lines:
        lower = line.lower()
        if any(w in lower for w in ["medication", "medicine", "rx", "tab.", "cap.", "prescribed"]):
            current_sec = "Medications"
            continue
        elif any(w in lower for w in ["diet", "activity", "wound", "care", "lifestyle"]):
            current_sec = "Diet & Daily Care"
            continue
        elif any(w in lower for w in ["follow-up", "follow up", "appointment", "clinic", "review in"]):
            current_sec = "Follow-Up Appointments"
            continue
        elif any(w in lower for w in ["warning", "red flag", "emergency", "call 911"]):
            current_sec = "Warning Signs (Red Flags)"
            continue
        
        # Skip hospital headers, doctor credentials, and street addresses
        if is_document_metadata_line(line):
            continue

        # Clean line and categorize
        cleaned = line.lstrip("-*•1234567890. ")
        if cleaned:
            # If line mentions pills or dosages, put in medications
            if any(w in lower for w in ["mg", "tablet", "tab", "cap", "bid", "tid", "qd", "od"]) and current_sec != "Warning Signs (Red Flags)":
                sections["Medications"].append(cleaned)
            elif current_sec in sections:
                sections[current_sec].append(cleaned)
    
    # Identify glossary terms
    terms = explain_terms_in_text(document_text)

    # Build patient-friendly summary
    summary_parts = [
        "### 🌟 Plain Language Summary\n",
        "Here is what your discharge summary means in everyday words, keeping all original medicine names, dosages, and dates exactly as written:\n"
    ]

    for sec_name, items in sections.items():
        if items and sec_name != "Diet & Daily Care":
            summary_parts.append(f"#### 📌 {sec_name}")
            for item in items:
                if sec_name == "Medications":
                    summary_parts.append(f"- **{item}** *(Take exactly as instructed; do not change dose)*")
                elif sec_name == "Warning Signs (Red Flags)":
                    summary_parts.append(f"- 🚨 **{item}** *(Seek immediate medical help if this happens)*")
                else:
                    summary_parts.append(f"- {item}")
            summary_parts.append("")

    # Add AI Disease-Specific Diet Plan
    diet_plan = generate_disease_diet_plan(document_text)
    summary_parts.append(format_diet_plan_markdown(diet_plan))

    return {
        "summary": "\n".join(summary_parts),
        "glossary": terms,
        "mode": "Local Reliable Parser"
    }

def generate_ai_explanation(document_text: str, api_key: str):
    """
    Calls Gemini API to generate patient-friendly explanation,
    strictly preserving medication names, dosages, and dates.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    prompt = f"""You are the Medical Explainer module for CareBridge AI.
Your job is to convert this hospital discharge summary or doctor prescription into clear, simple, patient-friendly language for an elderly patient or family caregiver.

Strict Safety Rules:
1. Preserve ALL medication names, exact dosages, frequencies, and follow-up dates WITHOUT ANY ALTERATION.
2. Never invent missing prescriptions or assume unmentioned instructions.
3. Use short, easily readable sentences.
4. Explain any medical terminology in simple, everyday language.
5. Emphasize urgent warning signs (red flags) clearly.

Prescription / Discharge text:
\"\"\"
{document_text}
\"\"\"

Respond with a JSON object with two keys:
- "summary": A clear markdown string formatted with headers, short bullet points, and plain-English explanations.
- "glossary": A dictionary of {{"Medical Term": "Simple Definition"}} for any complex terms appearing in the document.
"""

    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2}
    }

    response = requests.post(url, headers=headers, json=payload, timeout=20)
    response.raise_for_status()
    data = response.json()
    raw_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```(?:json)?\n?", "", raw_text)
        raw_text = re.sub(r"\n?```$", "", raw_text)
    
    result = json.loads(raw_text)
    result["mode"] = "Gemini 2.5 Flash AI"
    return result

def get_medical_explanation(document_text: str, api_key: str = None):
    """
    Main entry point for generating patient explanations.
    Uses Gemini if key available; falls back to local parser.
    """
    if not document_text or not document_text.strip():
        return {
            "summary": "No document text available to explain.",
            "glossary": {},
            "mode": "None"
        }
    
    key = api_key or os.getenv("GEMINI_API_KEY")
    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            return generate_ai_explanation(document_text, key.strip())
        except Exception:
            return generate_local_explanation(document_text)
    
    return generate_local_explanation(document_text)

def answer_patient_question(document_text: str, question: str, api_key: str = None):
    """
    Grounded Q&A assistant: Answers strictly based on the provided document text.
    Refuses to diagnose, invent medications, or guess missing information.
    """
    if not document_text.strip():
        return "Please upload a discharge summary first."
    if not question.strip():
        return "Please ask a question."
        
    key = api_key or os.getenv("GEMINI_API_KEY")
    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
            prompt = f"""You are the CareBridge AI Patient Assistant.
Answer the patient's question STRICTLY based on the provided discharge summary or prescription text below.

Safety Guidelines:
1. ONLY state facts explicitly written in the document.
2. If the document does not mention the answer, reply: "This information is not mentioned in your discharge summary. Please consult your doctor or clinic."
3. NEVER prescribe new medications, diagnose new conditions, or suggest changing dosages.
4. Keep answers short, clear, and reassuring.

Document:
\"\"\"
{document_text}
\"\"\"

Patient Question:
{question}
"""
            headers = {"Content-Type": "application/json"}
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2}
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception:
            pass

    # Local Fallback Search
    lower_q = question.lower()
    for term, definition in MEDICAL_GLOSSARY.items():
        if term in lower_q:
            return f"**{term.upper() if len(term) <= 4 else term.title()}**: {definition} (Source: CareBridge Medical Glossary)"
    
    if any(w in lower_q for w in ["appointment", "follow up", "follow-up", "clinic", "when"]):
        follow_lines = [l for l in document_text.split("\n") if any(k in l.lower() for k in ["follow-up", "appointment", "clinic", "review in"])]
        if follow_lines:
            return "Based on your document, here are the follow-up instructions:\n" + "\n".join(follow_lines)
            
    if any(w in lower_q for w in ["medicine", "medication", "pill", "tablet", "tab", "cap"]):
        med_lines = [l for l in document_text.split("\n") if any(k in l.lower() for k in ["mg", "tablet", "capsule", "take", "tab.", "cap.", "bid", "tid", "qd", "1-0-0"])]
        if med_lines:
            return "Medication instructions found in your document:\n" + "\n".join(med_lines)

    return "This detail is not specifically mentioned in your discharge summary. Please consult your physician or clinic for guidance."
