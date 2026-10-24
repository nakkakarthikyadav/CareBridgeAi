import re
import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

def detect_confusions_rule_based(document_text: str):
    """
    Local heuristic confusion detector.
    Analyzes document text for ambiguous medication instructions, conflicting dates,
    unreadable fragments, and missing essential details.
    """
    issues = []
    lines = [line.strip() for line in document_text.split("\n") if line.strip()]

    # 1. Pattern: Medicine instruction missing a clear drug name or unreadable
    flagged_med_lines = set()
    for line in lines:
        lower_line = line.lower()
        
        # Check for unreadable / smudged text
        if any(term in lower_line for term in ["unreadable", "illegible", "blurred", "smudged", "medicine name"]):
            if line not in flagged_med_lines:
                flagged_med_lines.add(line)
                issues.append({
                    "issue_type": "Unclear Medication Reference",
                    "severity": "High",
                    "original_text": line,
                    "explanation": "This instruction describes taking medication, but the specific medicine name is missing or marked unreadable.",
                    "recommendation": "Do NOT take any unknown pill. Contact your doctor or hospital pharmacist immediately to verify the exact drug name.",
                    "status": "Needs Confirmation"
                })
        
        # Check for floating "take 1 capsule/tablet" with no recognized drug name
        elif re.search(r"\btake\s+(?:one|two|\d+)?\s*(?:tablet|pill|capsule|dose)", lower_line):
            known_meds = ["lisinopril", "furosemide", "metoprolol", "acetaminophen", "cephalexin", "aspirin", "amoxicillin", "atorvastatin", "ibuprofen"]
            if not any(med in lower_line for med in known_meds):
                if line not in flagged_med_lines:
                    flagged_med_lines.add(line)
                    issues.append({
                        "issue_type": "Unclear Medication Reference",
                        "severity": "High",
                        "original_text": line,
                        "explanation": "An instruction specifies taking a pill or dose, but no known medication name is attached to it.",
                        "recommendation": "Contact your prescribing doctor or hospital pharmacy to clarify which medicine this refers to.",
                        "status": "Needs Confirmation"
                    })

    # 2. Pattern: Conflicting Follow-Up Dates
    followup_lines = [l for l in lines if any(w in l.lower() for w in ["follow-up", "follow up", "appointment", "clinic note", "return to"])]
    if len(followup_lines) >= 2:
        dates_in_followups = []
        for fl in followup_lines:
            found = re.findall(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?", fl, re.IGNORECASE)
            dates_in_followups.extend(found)
        
        unique_dates = list(set(dates_in_followups))
        if len(unique_dates) > 1:
            issues.append({
                "issue_type": "Conflicting Follow-up Dates",
                "severity": "Medium",
                "original_text": " ... ".join([f.strip("- ") for f in followup_lines if any(d in f for d in unique_dates)]),
                "explanation": f"The document mentions multiple conflicting dates ({' vs '.join(unique_dates)}) for your follow-up clinic visit.",
                "recommendation": "Call the clinic receptionist or doctor's office to confirm the exact date and time of your scheduled appointment.",
                "status": "Needs Confirmation"
            })

    # 3. Pattern: Medication Dosage Missing Frequency or Timing
    for line in lines:
        lower_line = line.lower()
        # Skip diet/nutrition lines that mention sodium or food milligrams
        if any(w in lower_line for w in ["diet", "sodium", "salt", "fluid", "lifting", "weight", "lbs", "mg/dl"]):
            continue
        
        # Check if it has a dosage (e.g. 50mg, 10mg) but no frequency
        if re.search(r"\b\d+\s*(?:mg|mcg|ml)\b", lower_line) and any(m in lower_line for m in ["tablet", "capsule", "take", "pill"]):
            has_timing = any(t in lower_line for t in ["daily", "morning", "night", "evening", "hour", "times", "bedtime", "needed", "q8h", "bid", "tid", "qid"])
            if not has_timing and line not in flagged_med_lines:
                flagged_med_lines.add(line)
                issues.append({
                    "issue_type": "Missing Medication Timing/Frequency",
                    "severity": "Medium",
                    "original_text": line,
                    "explanation": "This medication lists a dosage strength, but does not state the daily schedule or timing (e.g., morning, with meals, or every 8 hours).",
                    "recommendation": "Consult with your pharmacist to check the label or call your physician for the exact dosing schedule.",
                    "status": "Needs Confirmation"
                })

    return issues

def detect_confusions_with_gemini(document_text: str, api_key: str):
    """
    Uses Gemini LLM API to analyze document for genuine medical ambiguities.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    prompt = f"""You are the 'Confusion Detector' module for CareBridge AI, a patient safety assistant.
Analyze this hospital discharge summary text and identify any instructions that are potentially unclear, incomplete, or contradictory.

Specific things to look for:
1. Instructions mentioning taking medication where the medicine name is missing, unclear, or unreadable.
2. Missing or ambiguous medication timing/frequency.
3. Conflicting appointment dates or contradictory instructions.
4. Instructions requiring professional confirmation.

Discharge summary text:
\"\"\"
{document_text}
\"\"\"

Respond ONLY with a valid JSON array of objects. Do not include markdown formatting or extra text outside the JSON.
Each object must have these exact keys:
- "issue_type": Short category (e.g. "Unclear Medication Reference", "Conflicting Follow-up Dates")
- "severity": "High", "Medium", or "Low"
- "original_text": Exact quote or sentence from document
- "explanation": Plain-English explanation of why this instruction is unclear or dangerous
- "recommendation": Actionable advice asking the patient to contact doctor or pharmacist
- "status": "Needs Confirmation"

If no ambiguities are found, return an empty array [].
"""

    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1}
    }

    response = requests.post(url, headers=headers, json=payload, timeout=15)
    response.raise_for_status()
    data = response.json()
    raw_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```(?:json)?\n?", "", raw_text)
        raw_text = re.sub(r"\n?```$", "", raw_text)
    
    return json.loads(raw_text)

def analyze_document_confusion(document_text: str, api_key: str = None):
    """
    Main entry point for Confusion Detector.
    Attempts Gemini API if key is available; falls back to rule-based detection seamlessly.
    """
    if not document_text or not document_text.strip():
        return []

    key = api_key or os.getenv("GEMINI_API_KEY")
    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            return detect_confusions_with_gemini(document_text, key.strip())
        except Exception:
            return detect_confusions_rule_based(document_text)
    
    return detect_confusions_rule_based(document_text)

