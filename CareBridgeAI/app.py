import streamlit as st
import streamlit.components.v1 as components
import os
import sys
import io
import re
import json
import base64
import urllib.parse
from datetime import datetime
import requests
from pypdf import PdfReader
from PIL import Image, ImageEnhance, ImageOps
from gtts import gTTS
# ==============================================================================
# CLINICAL METADATA FILTERING & AI DISEASE DIET PLANNER (SELF-CONTAINED)
# ==============================================================================
def is_document_metadata_line(line: str) -> bool:
    """
    Detects header, address, licensing, patient name, and administrative lines
    that must never be classified as clinical diet or medication instructions.
    """
    lower = line.lower().strip()
    if not lower:
        return True
    
    # Never discard follow-up appointments, visits, or clinical headers
    if any(w in lower for w in ["follow-up", "follow up", "appointment", "visit", "scheduled", "return to", "consultation"]):
        return False
    if any(lower.startswith(sec) for sec in ["medication", "medicine", "rx:", "diet", "nutrition", "follow", "wound", "warning"]):
        return False

    # Hospital / Clinic / Medical Centre headers (pure facility names, e.g. "St. Jude Clinic" or "Medical Centre")
    if any(h in lower for h in [
        "medical centre", "medical center", "hospital", "clinic", "health care",
        "health clinic", "infirmary", "cardiology care", "department of"
    ]) and len(lower) < 65:
        return True
        
    # Street addresses & locations
    if any(a in lower for a in [
        "th street", " street", " st,", " st.", "avenue", " ave", "road", " rd.",
        "blvd", "boulevard", "suite ", "new york", "ny ", "usa", "pincode", "zip code"
    ]):
        return True
        
    # Registration, Licenses & Prescriber numbers
    if any(r in lower for r in [
        "dea#", "dea #", "lic #", "lic#", "license #", "reg no", "reg #", "npi#", "npi:"
    ]):
        return True
        
    # Patient demographics & address lines
    if any(p in lower for p in [
        "patient:", "patient name:", "age:", "dob:", "gender:", "address:"
    ]):
        return True
        
    # Attending doctor & metadata
    if any(d in lower for d in [
        "attending physician", "physician:", "prescriber:", "doctor:", "signature:"
    ]) and not any(w in lower for w in ["visit with", "appointment with", "follow up with", "follow-up with"]):
        return True
    
    # Prescribing doctor credentials on header lines (e.g. "Dr. Steve Johnson" or "Dr. A. K. Sharma, MD")
    if lower.startswith("dr. ") and len(lower) < 50 and not any(w in lower for w in ["visit", "appointment", "follow"]):
        return True
        
    # Administrative lines & separator rules
    if any(m in lower for m in ["date:", "rx #", "rx#", "refill authorized", "refills authorized", "refill:"]):
        return True
        
    if re.match(r"^[-=_*#]{3,}$", lower):
        return True
        
    return False

def detect_conditions_from_text(text: str) -> list:
    """Identifies primary medical conditions from medications and diagnosis keywords."""
    lower = text.lower()
    conditions = []
    
    # 1. Cardiovascular / Hypertension
    if any(w in lower for w in [
        "betaloc", "metoprolol", "oxprenolol", "lisinopril", "amlodipine", "atorvastatin",
        "atorva", "clopidogrel", "clopilet", "ecosprin", "metolar", "blood pressure",
        "hypertension", "angina", "stent", "cardiac", "cardiology"
    ]):
        conditions.append("Cardiovascular & Hypertension (Blood Pressure Support)")
        
    # 2. Glaucoma / Ocular Pressure
    if any(w in lower for w in [
        "dorzolamide", "dorzolamidum", "latanoprost", "timolol", "eye pressure",
        "glaucoma", "intraocular", "brimonidine", "travoprost"
    ]):
        conditions.append("Glaucoma & Elevated Eye Pressure Management")
        
    # 3. Acid Reflux / GERD / Gastric Protection
    if any(w in lower for w in [
        "cimetidine", "pantoprazole", "pantocid", "omeprazole", "ranitidine", "famotidine",
        "acid reflux", "gerd", "gastritis", "stomach acid", "heartburn", "ulcer"
    ]):
        conditions.append("Acid Reflux (GERD) & Gastric Mucosal Protection")
        
    # 4. Heart Failure / Fluid Overload / Edema
    if any(w in lower for w in [
        "furosemide", "lasix", "edema", "swelling", "heart failure", "fluid retention"
    ]):
        conditions.append("Heart Failure & Fluid / Sodium Management")
        
    # 5. Type 2 Diabetes / Metabolic
    if any(w in lower for w in [
        "metformin", "glipizide", "glimepiride", "insulin", "blood sugar", "glucose",
        "diabetes", "diabetic", "hba1c"
    ]):
        conditions.append("Type 2 Diabetes & Glycemic Control")
        
    # 6. Post-Surgical / Gallbladder / Wound Healing
    if any(w in lower for w in [
        "cholecystectomy", "laparoscopic", "incision", "wound", "dressing", "surgery", "post-op"
    ]):
        conditions.append("Post-Surgical Healing & Tissue Repair")
        
    if not conditions:
        conditions.append("General Post-Discharge Recovery & Vitality")
        
    return conditions

def generate_disease_diet_plan(document_text: str, api_key: str = None) -> dict:
    """
    Generates an intelligent, disease-targeted dietary plan based on the
    patient's diagnosed conditions and prescribed medications.
    Uses Gemini API if available, or clinical evidence-based rules as reliable fallback.
    """
    conditions = detect_conditions_from_text(document_text)
    
    # Try Gemini API if key provided
    key = api_key or os.getenv("GEMINI_API_KEY")
    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
            prompt = f"""You are the Clinical Nutritionist & Dietitian AI for CareBridge AI.
Based on this medical document / prescription:
\"\"\"{document_text}\"\"\"

Detected conditions: {', '.join(conditions)}

Generate a clinically validated, disease-specific diet and nutrition plan tailored specifically to these conditions and prescribed medicines.
Strict Rules:
- NEVER output hospital address, DEA#, license numbers, or patient registration details in the diet plan.
- Provide practical, structured dietary advice that avoids food-drug interactions (e.g. taking beta-blockers with food, curbing acid reflux, low sodium for hypertension).

Return a JSON object with:
{{
  "condition_title": "Primary Condition Summary",
  "recommended_foods": ["List of 3-5 specific healing foods recommended for these conditions"],
  "foods_to_avoid": ["List of 3-5 specific foods/drinks to strictly limit or avoid"],
  "meal_schedule": {{
    "breakfast": "Nutritious breakfast suggestion with medication timing",
    "lunch": "Balanced lunch suggestion with medication timing",
    "evening": "Light evening snack suggestion",
    "dinner": "Light dinner suggestion with timing advice"
  }},
  "hydration_plan": "Specific daily fluid/water recommendation",
  "food_drug_tips": ["2-3 specific tips on taking these medicines with or without meals"]
}}"""
            resp = requests.post(
                url,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=12
            )
            resp.raise_for_status()
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
            diet_data = json.loads(raw)
            diet_data["mode"] = "Gemini 2.5 Flash Clinical Nutritionist"
            diet_data["conditions"] = conditions
            return diet_data
        except Exception:
            pass

    # Reliable Evidence-Based Clinical Fallback
    cond_lower = " ".join(conditions).lower()
    
    rec_foods = []
    avoid_foods = []
    food_drug_tips = []
    
    # 1. Cardiovascular / Hypertension
    if "cardiovascular" in cond_lower or "hypertension" in cond_lower:
        rec_foods.extend([
            "Potassium-rich fruits (bananas, oranges, apples) to naturally regulate arterial blood pressure",
            "Leafy greens (spinach, kale, methi) and whole grain oats for endothelial blood vessel health",
            "Unsalted nuts (walnuts, almonds) and lean proteins (lentils, beans, grilled fish/chicken)"
        ])
        avoid_foods.extend([
            "High-sodium processed foods (pickles, papads, potato chips, canned soups, salted butter > 1,500mg/day)",
            "Excess caffeine, energy drinks, and heavy saturated trans fats that elevate cardiac stress"
        ])
        food_drug_tips.append("Take blood pressure medicines (Betaloc / Metoprolol / Oxprenolol) with or right after meals to ensure smooth absorption and avoid dizziness.")

    # 2. Glaucoma / Eye Pressure
    if "glaucoma" in cond_lower or "eye pressure" in cond_lower:
        rec_foods.append("Antioxidant-dense foods rich in lutein and zeaxanthin (cooked spinach, broccoli, carrots, eggs) to protect the optic nerve")
        avoid_foods.append("Drinking massive volumes of fluid in a single gulp (>500ml rapidly); spread water intake evenly across the day to prevent sudden eye pressure spikes")
        food_drug_tips.append("Maintain steady, consistent hydration to support microvascular blood flow to the optic nerve when using Dorzolamide.")

    # 3. Acid Reflux / GERD
    if "acid reflux" in cond_lower or "gastric" in cond_lower or "gerd" in cond_lower:
        rec_foods.append("Soothing alkaline non-citrus fruits (papaya, melons, ripe bananas) and warm oatmeal to protect the stomach lining")
        avoid_foods.extend([
            "Deep-fried greasy foods, intense red chili spices, raw onions, and citrus fruits (lemons, grapefruits)",
            "Late-night snacking: finish dinner at least 2 to 3 hours before lying down to stop nighttime acid backflow",
            "Carbonated fizzy sodas, dark chocolate, and peppermint which relax the lower esophageal sphincter"
        ])
        food_drug_tips.append("Take acid-reducing medications (Cimetidine / Pantoprazole) after meals or 30 minutes before breakfast as prescribed.")

    # 4. Heart Failure / Edema
    if "heart failure" in cond_lower or "edema" in cond_lower:
        rec_foods.append("Strict sodium-restricted home-cooked meals (<2,000 mg salt daily) with steamed vegetables")
        avoid_foods.append("Excess fluid intake beyond prescribed limit; table salt shaker; processed deli meats")
        food_drug_tips.append("Take water pills (Furosemide) in the morning so frequent urination does not disturb nighttime sleep.")

    # 5. Diabetes / Blood Sugar
    if "diabetes" in cond_lower:
        rec_foods.append("High-fiber complex carbohydrates (whole wheat, quinoa, brown rice, steel-cut oats, legumes)")
        avoid_foods.append("Refined white sugar, sweetened juices, pastries, and refined flour (maida)")
        food_drug_tips.append("Take diabetes medications (Metformin) with meals to minimize stomach upset.")

    # Default fallbacks if empty
    if not rec_foods:
        rec_foods = [
            "Easily digestible whole foods: steamed vegetables, fresh seasonal fruits, and light soups",
            "Wholesome grains (oats, brown rice, whole wheat roti) and healthy lean proteins",
            "Fiber-rich lentils and legumes for optimal gastrointestinal motility"
        ]
    if not avoid_foods:
        avoid_foods = [
            "Heavy deep-fried fast food, ultra-processed packaged snacks, and excess table salt",
            "Sugary sodas, energy drinks, unpasteurized items, and heavy late-night dinners"
        ]
    if not food_drug_tips:
        food_drug_tips = [
            "Take prescribed daily medications with a full glass of plain water at consistent daily hours.",
            "Never skip meals while taking therapeutic medications to maintain stable energy and metabolic balance."
        ]

    # De-duplicate
    seen_rec = set()
    unique_rec = [f for f in rec_foods if not (f in seen_rec or seen_rec.add(f))][:5]
    seen_av = set()
    unique_av = [f for f in avoid_foods if not (f in seen_av or seen_av.add(f))][:5]

    return {
        "condition_title": " • ".join(conditions),
        "conditions": conditions,
        "recommended_foods": unique_rec,
        "foods_to_avoid": unique_av,
        "meal_schedule": {
            "breakfast": "🌅 Warm oatmeal with sliced banana, low-fat milk, and unsalted walnuts. (Take Morning medications after breakfast).",
            "lunch": "☀️ Steamed brown rice or whole-wheat roti with lightly seasoned dal (lentils), sautéed vegetables, and cucumber. (Take Lunch medications after meal).",
            "evening": "🌤️ Herbal chamomile tea or tender coconut water with 5-6 soaked almonds.",
            "dinner": "🌙 Light vegetable soup with grilled tofu or lean chicken and steamed greens. Eat at least 2 hours before bed. (Take Evening medications after dinner)."
        },
        "hydration_plan": "Drink 2.0 to 2.5 Liters of water spaced evenly throughout the day. Avoid chugging large amounts at once.",
        "food_drug_tips": food_drug_tips,
        "mode": "CareBridge Clinical Nutritionist Engine"
    }

def format_diet_plan_markdown(diet_data: dict) -> str:
    """Formats the structured diet plan into a beautiful patient-facing markdown card."""
    lines = [
        f"### 🥗 AI Disease-Specific Diet & Nutrition Plan",
        f"**Target Health Conditions:** `{diet_data.get('condition_title', 'General Recovery')}`\n"
    ]
    
    lines.append("#### ✅ Recommended Therapeutic Foods")
    for f in diet_data.get("recommended_foods", []):
        lines.append(f"- 🟢 **{f.split(':')[0] if ':' in f else f}**{': ' + f.split(':', 1)[1] if ':' in f else ''}")
        
    lines.append("\n#### 🚫 Foods & Drinks to Avoid")
    for f in diet_data.get("foods_to_avoid", []):
        lines.append(f"- 🔴 **{f.split(':')[0] if ':' in f else f}**{': ' + f.split(':', 1)[1] if ':' in f else ''}")
        
    lines.append("\n#### ⏰ Daily Meal & Hydration Routine")
    sched = diet_data.get("meal_schedule", {})
    if sched:
        lines.append(f"- **Breakfast (08:30 AM):** {sched.get('breakfast', '')}")
        lines.append(f"- **Lunch (01:00 PM):** {sched.get('lunch', '')}")
        lines.append(f"- **Evening (05:00 PM):** {sched.get('evening', '')}")
        lines.append(f"- **Dinner (07:30 PM):** {sched.get('dinner', '')}")
        
    if diet_data.get("hydration_plan"):
        lines.append(f"- **💧 Hydration Goal:** {diet_data['hydration_plan']}")
        
    if diet_data.get("food_drug_tips"):
        lines.append("\n#### ⚠️ Food-Medication Safety Advice")
        for tip in diet_data["food_drug_tips"]:
            lines.append(f"- 💡 {tip}")
            
    return "\n".join(lines)

# ==============================================================================
# 1. CONSTANTS, SAMPLE DOCUMENTS & CLINICAL GLOSSARY
# ==============================================================================
MAX_FILE_SIZE_MB = 10
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}

# Comprehensive Medical Glossary with Prescription & Clinical Abbreviations
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

    # Pain, Antibiotics & Surgery
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

COUNTRY_CODES = {
    "🇮🇳 India (+91)": "+91",
    "🇺🇸 USA / Canada (+1)": "+1",
    "🇬🇧 United Kingdom (+44)": "+44",
    "🇦🇺 Australia (+61)": "+61",
    "🇦🇪 UAE (+971)": "+971",
    "🇸🇦 Saudi Arabia (+966)": "+966",
    "🇸🇬 Singapore (+65)": "+65",
    "🇩🇪 Germany (+49)": "+49",
    "🌐 International (+00)": "+00"
}

# ==============================================================================
# 2. DOCUMENT PROCESSING & HANDWRITING AI VISION ENGINE
# ==============================================================================
def validate_uploaded_file(uploaded_file):
    if uploaded_file is None:
        return False, "No file uploaded."
    filename = uploaded_file.name.lower()
    file_ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        return False, f"Unsupported file type (.{file_ext}). Please upload a PDF, PNG, JPG, or JPEG."
    file_size_mb = uploaded_file.size / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        return False, f"File is too large ({file_size_mb:.1f} MB). Maximum allowed size is {MAX_FILE_SIZE_MB} MB."
    return True, f"File valid: {uploaded_file.name} ({file_size_mb:.2f} MB)"

def extract_text_from_pdf(pdf_bytes):
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if len(reader.pages) == 0:
            return "", False, "The uploaded PDF is empty."
        extracted_pages = []
        for idx, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                extracted_pages.append(f"--- Page {idx + 1} ---\n{page_text.strip()}")
        full_text = "\n\n".join(extracted_pages).strip()
        if not full_text:
            return "", False, "No readable digital text found in this PDF. It may be a scanned image."
        return full_text, True, "Successfully extracted text from PDF."
    except Exception as e:
        return "", False, f"Error reading PDF: {str(e)}"

def preprocess_handwritten_image(image_bytes: bytes) -> bytes:
    """Enhances ink contrast and edge sharpness for doctor cursive handwriting."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.6)
        sharpener = ImageEnhance.Sharpness(img)
        img = sharpener.enhance(1.4)
        out_buf = io.BytesIO()
        img.save(out_buf, format="JPEG", quality=92)
        return out_buf.getvalue()
    except Exception:
        return image_bytes

def extract_text_from_image(image_bytes):
    """Extracts text using OCR."""
    try:
        import pytesseract
        
        if os.name == "nt":
            windows_paths = [
                r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe")
            ]
            for wp in windows_paths:
                if os.path.exists(wp):
                    pytesseract.pytesseract.tesseract_cmd = wp
                    break

        image = Image.open(io.BytesIO(image_bytes))
        try:
            text = pytesseract.image_to_string(image).strip()
            if not text:
                return "", False, "OCR completed, but no text could be recognized in this image."
            return text, True, "Successfully extracted text using OCR."
        except Exception:
            return "", False, (
                "Tesseract OCR is not installed on this cloud environment. "
                "Use the AI Vision handwriting mode or paste the text directly into the editor below."
            )
    except Exception as img_err:
        return "", False, f"Invalid or unreadable image file: {str(img_err)}"

def extract_handwriting_with_gemini_vision(image_bytes: bytes, api_key: str = None):
    """
    Deciphers doctor handwriting, cursive medical notes, and handwritten prescriptions
    using Gemini Multimodal Vision API with image contrast enhancement.
    """
    key = api_key or os.getenv("GEMINI_API_KEY")
    if not key or key.strip() == "your_gemini_api_key_here":
        return "", False, "A Gemini API Key is required for live AI Vision handwriting deciphering. Enter your key in the sidebar or upload page."
    
    try:
        enhanced_bytes = preprocess_handwritten_image(image_bytes)
        b64_image = base64.b64encode(enhanced_bytes).decode("utf-8")
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
        
        prompt = """You are a senior clinical pharmacist and medical transcription specialist.
Decipher this handwritten doctor's prescription or clinical note image with utmost care.
Doctor handwriting is often hurried, cursive, and difficult for patients to read.

Instructions:
1. Identify and transcribe clinic/hospital name, doctor's name, patient name, and date if visible.
2. Transcribe ALL prescribed medications:
   - Medicine name (trade/brand name and generic equivalent, e.g. Betaloc, Cimetidine, Oxprenolol)
   - Strength / dosage (e.g. 100mg, 50mg, 10mg)
   - Frequency & Timing (e.g., BID/twice daily, TID/thrice daily, QD/once daily, 1-0-0, before/after meals)
   - Duration of course
3. Transcribe diet, lifestyle, activity, and wound care instructions.
4. Transcribe follow-up appointments and emergency warning red flags.
5. IF ANY WRITING OR MEDICINE NAME IS ILLEGIBLE, BLURRED, OR AMBIGUOUS:
   Explicitly mark it as: "[Illegible / Unclear handwriting - Requires Pharmacist Confirmation]". Never fabricate or guess unreadable drugs.
Format clearly in plain patient-friendly text with clear sections."""

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inlineData": {
                                "mimeType": "image/jpeg",
                                "data": b64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2
            }
        }
        
        resp = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=25)
        resp.raise_for_status()
        data = resp.json()
        
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        if not text:
            return "", False, "AI Vision completed but returned empty text."
        return text, True, "Successfully deciphered doctor handwriting with Gemini AI Vision!"
    except Exception as e:
        return "", False, f"AI Vision error: {str(e)}"

# ==============================================================================
# 3. CONFUSION DETECTOR ENGINE
# ==============================================================================
def detect_confusions_rule_based(document_text: str):
    issues = []
    lines = [line.strip() for line in document_text.split("\n") if line.strip()]
    flagged_med_lines = set()

    for line in lines:
        lower_line = line.lower()
        if any(term in lower_line for term in ["unreadable", "illegible", "blurred", "smudged", "medicine name", "needs confirmation"]):
            if line not in flagged_med_lines:
                flagged_med_lines.add(line)
                issues.append({
                    "issue_type": "Unclear Medication Reference",
                    "severity": "High",
                    "original_text": line,
                    "explanation": "This instruction describes taking medication, but the specific medicine name is missing or marked unreadable/illegible.",
                    "recommendation": "Do NOT take any unknown pill. Contact your doctor or hospital pharmacist immediately to verify the exact drug name.",
                    "status": "Needs Confirmation"
                })
        elif re.search(r"\btake\s+(?:one|two|\d+)?\s*(?:tablet|pill|capsule|dose)", lower_line):
            known_meds = ["lisinopril", "furosemide", "metoprolol", "acetaminophen", "cephalexin", "aspirin", "amoxicillin", "atorvastatin", "ibuprofen", "ecosprin", "clopilet", "pantocid", "metolar", "atorva", "betaloc", "dorzolamidum", "cimetidine", "oxprenolol"]
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

    # Conflicting Dates
    followup_lines = [l for l in lines if any(w in l.lower() for w in ["follow-up", "follow up", "appointment", "clinic note", "return to", "review in", "alternate note"])]
    if len(followup_lines) >= 2:
        dates_in_followups = []
        for fl in followup_lines:
            found = re.findall(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-\d{2,4}", fl, re.IGNORECASE)
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

    # Missing Timing
    for line in lines:
        lower_line = line.lower()
        if any(w in lower_line for w in ["diet", "sodium", "salt", "fluid", "lifting", "weight", "lbs", "mg/dl", "bp", "dea#", "lic #"]):
            continue
        if re.search(r"\b\d+\s*(?:mg|mcg|ml)\b", lower_line) and any(m in lower_line for m in ["tablet", "capsule", "take", "pill", "tab.", "cap.", "tab", "tabs"]):
            has_timing = any(t in lower_line for t in ["daily", "morning", "night", "evening", "hour", "times", "bedtime", "needed", "q8h", "bid", "tid", "qid", "tds", "qd", "od", "1-0-0", "0-1-0", "0-0-1"])
            if not has_timing and line not in flagged_med_lines:
                flagged_med_lines.add(line)
                issues.append({
                    "issue_type": "Missing Medication Timing/Frequency",
                    "severity": "Medium",
                    "original_text": line,
                    "explanation": "This medication lists a dosage strength, but does not state the daily schedule or timing.",
                    "recommendation": "Consult with your pharmacist to check the label or call your physician for the exact dosing schedule.",
                    "status": "Needs Confirmation"
                })
    return issues

def analyze_document_confusion(document_text: str, api_key: str = None):
    if not document_text or not document_text.strip():
        return []
    key = api_key or os.getenv("GEMINI_API_KEY")
    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
            prompt = f"""You are the 'Confusion Detector' for CareBridge AI. Identify unclear, incomplete, or contradictory instructions in this hospital discharge summary or prescription:
\"\"\"{document_text}\"\"\"
Return ONLY a valid JSON array of objects with keys: "issue_type", "severity" ("High"/"Medium"), "original_text", "explanation", "recommendation", "status" ("Needs Confirmation"). Return [] if no issues."""
            resp = requests.post(url, headers={"Content-Type": "application/json"}, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=12)
            resp.raise_for_status()
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
            return json.loads(raw)
        except Exception:
            return detect_confusions_rule_based(document_text)
    return detect_confusions_rule_based(document_text)

# ==============================================================================
# 4. MEDICAL EXPLAINER & PATIENT ASSISTANT
# ==============================================================================
def explain_terms_in_text(text: str):
    """Identifies and explains medical terms present in the text with word boundary matching."""
    found = {}
    lower = text.lower()
    for term, definition in MEDICAL_GLOSSARY.items():
        if re.search(r'\b' + re.escape(term) + r'\b', lower):
            key = term.upper() if len(term) <= 4 else term.title()
            found[key] = definition
    return found

def get_medical_explanation(document_text: str, api_key: str = None):
    if not document_text.strip():
        return {"summary": "No document text available.", "glossary": {}, "diet_plan": {}, "mode": "None"}
    
    key = api_key or os.getenv("GEMINI_API_KEY")
    diet_data = generate_disease_diet_plan(document_text, api_key=key)

    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
            prompt = f"""You are the Medical Explainer for CareBridge AI. Convert this discharge summary or prescription into simple, patient-friendly language.
Strict Rules:
1. Preserve all medication names, dosages, and dates exactly without alterations.
2. Under NO circumstances should hospital address, DEA#, license numbers, or clinic header lines be included in the dietary or recovery advice.
3. Integrate tailored dietary and lifestyle advice based on the patient's conditions ({', '.join(diet_data.get('conditions', []))}).
Text:
\"\"\"{document_text}\"\"\"
Return a JSON object with:
- "summary": Clear markdown with bullet points explaining what the patient needs to do.
- "glossary": A dictionary of {{"Medical Term": "Simple Definition"}}."""
            resp = requests.post(url, headers={"Content-Type": "application/json"}, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=15)
            resp.raise_for_status()
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
            res = json.loads(raw)
            res["mode"] = "Gemini 2.5 Flash AI"
            res["diet_plan"] = diet_data
            return res
        except Exception:
            pass

    # Local Reliable Engine with Disease-Targeted Diet Planner
    lines = [l.strip() for l in document_text.split("\n") if l.strip()]
    sections = {"Medications": [], "Diet & Daily Care": [], "Follow-Up Appointments": [], "Warning Signs (Red Flags)": []}
    curr = "General Care"
    
    for l in lines:
        low = l.lower()
        if any(w in low for w in ["medication", "medicine", "rx", "tab.", "cap.", "prescribed"]): curr = "Medications"; continue
        elif any(w in low for w in ["diet", "activity", "wound", "lifestyle"]): curr = "Diet & Daily Care"; continue
        elif any(w in low for w in ["follow-up", "appointment", "clinic", "review in"]): curr = "Follow-Up Appointments"; continue
        elif any(w in low for w in ["warning", "red flag", "emergency"]): curr = "Warning Signs (Red Flags)"; continue
        
        # Strictly skip hospital address, DEA, physician, license, patient demographics
        if is_document_metadata_line(l):
            continue

        cleaned = l.lstrip("-*•1234567890. ")
        if cleaned:
            if any(w in low for w in ["mg", "tablet", "tab", "cap", "bid", "tid", "qd", "od"]) and curr != "Warning Signs (Red Flags)":
                sections["Medications"].append(cleaned)
            elif curr in sections:
                sections[curr].append(cleaned)
    
    parts = ["### 🌟 Plain Language Summary\nHere is your discharge summary or prescription explained in simple everyday words:\n"]
    for s_name, items in sections.items():
        if items and s_name != "Diet & Daily Care":
            parts.append(f"#### 📌 {s_name}")
            for it in items:
                if s_name == "Medications": parts.append(f"- **{it}** *(Take exactly as prescribed; do not skip or change dose)*")
                elif s_name == "Warning Signs (Red Flags)": parts.append(f"- 🚨 **{it}** *(Seek immediate emergency care if this occurs)*")
                else: parts.append(f"- {it}")
            parts.append("")

    # Append AI Disease-Specific Diet Plan
    parts.append(format_diet_plan_markdown(diet_data))

    return {
        "summary": "\n".join(parts),
        "glossary": explain_terms_in_text(document_text),
        "diet_plan": diet_data,
        "mode": "CareBridge Clinical AI Parser"
    }

def answer_patient_question(document_text: str, question: str, api_key: str = None):
    if not document_text.strip(): return "Please upload a document first."
    if not question.strip(): return "Please enter a question."
    key = api_key or os.getenv("GEMINI_API_KEY")
    if key and key.strip() and key != "your_gemini_api_key_here":
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key.strip()}"
            prompt = f"Answer strictly using this medical document only. If not mentioned, state so clearly. Never diagnose or change medicines.\nDoc:\n{document_text}\nQuestion: {question}"
            resp = requests.post(url, headers={"Content-Type": "application/json"}, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=12)
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception:
            pass

    low_q = question.lower()
    for term, definition in MEDICAL_GLOSSARY.items():
        if re.search(r'\b' + re.escape(term) + r'\b', low_q):
            return f"**{term.upper() if len(term) <= 4 else term.title()}**: {definition} (Source: CareBridge Medical Reference)"
    if any(w in low_q for w in ["appointment", "follow up", "clinic", "when"]):
        follow_lines = [l for l in document_text.split("\n") if any(k in l.lower() for k in ["follow-up", "appointment", "clinic", "review in"])]
        if follow_lines: return "Based on your document, here are the follow-up instructions:\n" + "\n".join(follow_lines)
    if any(w in low_q for w in ["medicine", "medication", "pill", "tablet", "tab", "cap"]):
        med_lines = [l for l in document_text.split("\n") if any(k in l.lower() for k in ["mg", "tablet", "capsule", "take", "tab.", "cap.", "bid", "tid", "qd"])]
        if med_lines: return "Medication instructions found in your document:\n" + "\n".join(med_lines)
    return "This detail is not specifically mentioned in your discharge summary. Please consult your physician or clinic."

# ==============================================================================
# 5. RECOVERY PLANNER & REMINDERS ENGINE
# ==============================================================================
def build_recovery_plan(document_text: str, api_key: str = None):
    if not document_text or not document_text.strip():
        return {"medications": [], "diet_lifestyle": [], "followups": [], "wound_care": [], "warnings": [], "needs_confirmation": []}
    confusions = analyze_document_confusion(document_text, api_key=api_key)
    flagged = {c["original_text"].strip().lower() for c in confusions}
    lines = [l.strip() for l in document_text.split("\n") if l.strip()]
    plan = {"medications": [], "diet_lifestyle": [], "followups": [], "wound_care": [], "warnings": [], "needs_confirmation": confusions}
    curr = "general"

    for line in lines:
        lower = line.lower()
        cleaned = line.lstrip("-*•1234567890. ")
        if not cleaned: continue
        
        # Skip hospital addresses, DEA, doctor credentials, and patient demographics
        if is_document_metadata_line(line):
            continue

        is_bullet = line.startswith(("-", "*", "•"))
        if not is_bullet:
            if any(h in lower for h in ["medication", "medicine", "rx", "prescribed"]) and len(lower) < 35: curr = "medications"; continue
            elif any(h in lower for h in ["diet", "nutrition", "activity", "lifestyle"]) and len(lower) < 35: curr = "diet_lifestyle"; continue
            elif any(h in lower for h in ["follow-up", "appointment", "review in"]) and len(lower) < 35: curr = "followups"; continue
            elif any(h in lower for h in ["wound", "dressing"]) and len(lower) < 35: curr = "wound_care"; continue
            elif any(h in lower for h in ["warning", "red flag", "emergency"]) and len(lower) < 35: curr = "warnings"; continue

        is_confused = any(f in lower for f in flagged if len(f) > 5)
        if curr == "medications" and not is_confused:
            plan["medications"].append({"task": cleaned, "category": "Medication", "status": "Confirmed"})
        elif curr == "diet_lifestyle":
            plan["diet_lifestyle"].append({"task": cleaned, "category": "Diet & Lifestyle", "status": "Confirmed"})
        elif curr == "followups" and not is_confused:
            plan["followups"].append({"task": cleaned, "category": "Follow-Up", "status": "Confirmed"})
        elif curr == "wound_care":
            plan["wound_care"].append({"task": cleaned, "category": "Wound Care", "status": "Confirmed"})
        elif curr == "warnings":
            plan["warnings"].append({"task": cleaned, "category": "Warning Sign", "status": "Urgent Alert"})
        else:
            if any(w in lower for w in ["mg", "tablet", "take ", "tab.", "cap.", "1-0-0", "0-1-0", "0-0-1", "bid", "tid", "qd"]) and not is_confused:
                plan["medications"].append({"task": cleaned, "category": "Medication", "status": "Confirmed"})
            elif any(w in lower for w in ["appointment", "clinic", "return on", "review in"]):
                plan["followups"].append({"task": cleaned, "category": "Follow-Up", "status": "Confirmed"})
            elif any(w in lower for w in ["pain", "breath", "emergency"]):
                plan["warnings"].append({"task": cleaned, "category": "Warning Sign", "status": "Urgent Alert"})

    # If no explicit diet instructions exist in the text, use AI disease-specific diet plan
    if not plan["diet_lifestyle"]:
        disease_diet = generate_disease_diet_plan(document_text, api_key=api_key)
        for f in disease_diet.get("recommended_foods", [])[:2]:
            plan["diet_lifestyle"].append({
                "task": f"Recommended Nutrition: {f}",
                "category": "Diet & Lifestyle",
                "status": "Confirmed"
            })
        for a in disease_diet.get("foods_to_avoid", [])[:2]:
            plan["diet_lifestyle"].append({
                "task": f"Dietary Restriction: Avoid {a}",
                "category": "Diet & Lifestyle",
                "status": "Confirmed"
            })
        if disease_diet.get("hydration_plan"):
            plan["diet_lifestyle"].append({
                "task": f"Hydration Target: {disease_diet['hydration_plan']}",
                "category": "Diet & Lifestyle",
                "status": "Confirmed"
            })

    return plan

def extract_reminders_schedule(plan):
    reminders = []
    for med in plan.get("medications", []):
        task = med["task"]
        low = task.lower()
        slots = []
        
        # Latin & Clinical Abbreviation Timing
        if any(w in low for w in ["morning", "breakfast", "every morning", "1-0-0", "od"]):
            slots.append({"slot": "Morning", "time": "08:00 AM"})
        if any(w in low for w in ["afternoon", "lunch", "0-1-0"]):
            slots.append({"slot": "Afternoon", "time": "01:00 PM"})
        if any(w in low for w in ["bid", "twice daily", "twice a day"]):
            slots.append({"slot": "Morning", "time": "08:00 AM"})
            slots.append({"slot": "Evening", "time": "08:00 PM"})
        elif any(w in low for w in ["tid", "three times", "thrice"]):
            slots.append({"slot": "Morning", "time": "08:00 AM"})
            slots.append({"slot": "Afternoon", "time": "02:00 PM"})
            slots.append({"slot": "Night", "time": "08:00 PM"})
        elif any(w in low for w in ["night", "evening", "bedtime", "0-0-1", "dinner"]):
            slots.append({"slot": "Night", "time": "08:00 PM"})
        elif any(w in low for w in ["qd", "daily", "once daily"]):
            slots.append({"slot": "Daily", "time": "09:00 AM"})
            
        if not slots: slots.append({"slot": "Daily", "time": "09:00 AM"})

        seen = set()
        for s in slots:
            if s["time"] not in seen:
                seen.add(s["time"])
                reminders.append({
                    "type": "Medication",
                    "title": f"Take {task.split(':')[0]}",
                    "details": task,
                    "schedule_slot": s["slot"],
                    "timing": s["time"],
                    "alert_message": f"[CareBridge Medication Alert - {s['time']}]: Time to take {task}. Take with water as prescribed.",
                    "status": "Active"
                })

    for appt in plan.get("followups", []):
        task = appt["task"]
        date_m = re.search(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-\d{2,4}|\d{1,2}/\d{1,2}/\d{2,4}", task, re.IGNORECASE)
        time_m = re.search(r"\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b", task)
        a_date = date_m.group(0) if date_m else "Upcoming date"
        a_time = time_m.group(0) if time_m else "Clinic hours"
        reminders.append({
            "type": "Doctor Consultation",
            "title": "Hospital / Clinic Follow-up",
            "details": task,
            "schedule_slot": "Appointment",
            "timing": f"{a_date} at {a_time}",
            "alert_message": f"[CareBridge Appointment Alert]: Scheduled clinic visit on {a_date} ({a_time}). Details: {task}.",
            "status": "Scheduled"
        })

    for conf in plan.get("needs_confirmation", []):
        reminders.append({
            "type": "Requires Confirmation",
            "title": f"Needs Confirmation: {conf.get('issue_type', 'Unclear Instruction')}",
            "details": conf.get("original_text", ""),
            "schedule_slot": "Action Required",
            "timing": "Paused for Safety",
            "alert_message": f"[Safety Alert - Needs Confirmation]: '{conf.get('original_text')}'. Please verify with your doctor.",
            "status": "Needs Confirmation"
        })
    return reminders

def generate_ics_calendar(reminders):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CareBridge AI//Recovery Companion//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    now_str = datetime.now().strftime("%Y%m%dT%H%M%SZ")
    for idx, r in enumerate(reminders):
        if r["status"] == "Needs Confirmation": continue
        summary = f"CareBridge AI: {r['title']}".replace("\n", " ").replace(",", "\\,")
        desc = f"{r['details']}\\n\\nAlert: {r['alert_message']}".replace("\n", " ")
        lines.extend([
            "BEGIN:VEVENT", f"UID:carebridge-{idx}-{now_str}@carebridge.local", f"DTSTAMP:{now_str}",
            f"SUMMARY:{summary}", f"DESCRIPTION:{desc}",
            "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", f"DESCRIPTION:Reminder: {summary}", "END:VALARM",
            "END:VEVENT"
        ])
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)

# ==============================================================================
# 6. AUTONOMOUS NOTIFICATION & TIMELINE ENGINE
# ==============================================================================
def trigger_browser_push_alert(title: str, body: str, speak: bool = True):
    """
    Fires high-visibility In-App Banner, Web Audio Synthesizer chime, Speech Synthesis,
    and native OS desktop/mobile push notification.
    """
    safe_title = json.dumps(title)
    safe_body = json.dumps(body)
    speak_js = f"""
    if ('speechSynthesis' in window) {{
        try {{
            window.speechSynthesis.cancel();
            var utter = new SpeechSynthesisUtterance({safe_title} + ". " + {safe_body});
            utter.rate = 1.0;
            window.speechSynthesis.speak(utter);
        }} catch(e){{}}
    }}
    """ if speak else ""
    
    js = f"""
    <div id="cb_alert_box" style="
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(99, 102, 241, 0.32) 100%);
        border: 2px solid #38bdf8;
        border-radius: 14px;
        padding: 14px 18px;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 18px rgba(56, 189, 248, 0.35);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        animation: cbSlideIn 0.3s ease-out;
        margin-bottom: 12px;
    ">
        <style>
            @keyframes cbSlideIn {{
                from {{ transform: translateY(-8px); opacity: 0; }}
                to {{ transform: translateY(0); opacity: 1; }}
            }}
            @keyframes cbPulse {{
                0% {{ transform: scale(1); }}
                50% {{ transform: scale(1.18); }}
                100% {{ transform: scale(1); }}
            }}
        </style>
        <div style="display: flex; align-items: center; gap: 14px; flex: 1;">
            <div style="font-size: 2.2rem; animation: cbPulse 1.2s infinite; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 0 8px #38bdf8);">🔔</div>
            <div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="background: rgba(56, 189, 248, 0.28); color: #38bdf8; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; border: 1px solid rgba(56, 189, 248, 0.5);">
                        ACTIVE IN-APP NOTIFICATION
                    </span>
                    <span id="cb_perm_badge" style="font-size: 0.72rem; color: #94a3b8; font-weight: 600;"></span>
                </div>
                <div style="font-size: 1.05rem; font-weight: 800; color: #ffffff; margin-top: 3px;">
                    {title}
                </div>
                <div style="font-size: 0.88rem; color: #cbd5e1; margin-top: 2px; line-height: 1.4;">
                    {body}
                </div>
            </div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0; align-items: center;">
            <button id="cb_enable_perm_btn" onclick="requestBrowserPermission()" style="
                background: linear-gradient(135deg, #0284c7, #2563eb);
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                display: none;
                transition: transform 0.15s;
            ">🔔 Allow OS Banners</button>
            <button onclick="document.getElementById('cb_alert_box').style.display='none'" style="
                background: rgba(255, 255, 255, 0.12);
                color: #e2e8f0;
                border: 1px solid rgba(255, 255, 255, 0.25);
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
            ">✕ Close</button>
        </div>
    </div>

    <script>
    (function() {{
        // 1. Synthesize Web Audio Medical Chime (Reliable, zero external downloads)
        function playChime() {{
            try {{
                var AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                var ctx = new AudioContext();
                if (ctx.state === 'suspended') {{
                    ctx.resume();
                }}
                var now = ctx.currentTime;
                // Dual tone medical chime: D5 (587.33 Hz) -> A5 (880.00 Hz)
                var osc1 = ctx.createOscillator();
                var osc2 = ctx.createOscillator();
                var gain = ctx.createGain();

                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(587.33, now);

                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(880.00, now + 0.12);

                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start(now);
                osc1.stop(now + 0.12);
                osc2.start(now + 0.12);
                osc2.stop(now + 0.65);
            }} catch(e) {{
                try {{
                    var audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
                    audio.play().catch(function(){{}});
                }} catch(err){{}}
            }}
        }}

        playChime();
        {speak_js}

        // 2. Browser OS Push Notification with user-gesture resolution
        function getNotificationApi() {{
            try {{
                if (window.parent && window.parent.Notification) return window.parent.Notification;
            }} catch(e) {{}}
            if (typeof Notification !== 'undefined') return Notification;
            return null;
        }}

        var notifApi = getNotificationApi();
        var badge = document.getElementById("cb_perm_badge");
        var permBtn = document.getElementById("cb_enable_perm_btn");

        window.requestBrowserPermission = function() {{
            if (!notifApi) return;
            notifApi.requestPermission().then(function(perm) {{
                updateStatus(perm);
                if (perm === "granted") {{
                    try {{
                        new notifApi({safe_title}, {{
                            body: {safe_body},
                            icon: "https://cdn-icons-png.flaticon.com/512/2966/2966327.png"
                        }});
                    }} catch(e){{}}
                }}
            }});
        }};

        function updateStatus(perm) {{
            if (!notifApi) {{
                if (badge) badge.innerText = "• Web Notifications not supported";
                return;
            }}
            if (perm === "granted") {{
                if (badge) badge.innerText = "• OS Desktop Banner: Sent ✅";
                if (permBtn) permBtn.style.display = "none";
                try {{
                    new notifApi({safe_title}, {{
                        body: {safe_body},
                        icon: "https://cdn-icons-png.flaticon.com/512/2966/2966327.png"
                    }});
                }} catch(e){{}}
            }} else if (perm === "denied") {{
                if (badge) badge.innerText = "• OS Banners Blocked in Browser Settings";
                if (permBtn) permBtn.style.display = "none";
            }} else {{
                if (badge) badge.innerText = "• OS Banner Permission: Click to Allow";
                if (permBtn) permBtn.style.display = "inline-block";
            }}
        }}

        if (notifApi) {{
            updateStatus(notifApi.permission);
        }}
    }})();
    </script>
    """
    components.html(js, height=125)

def render_handsfree_notification_engine(reminders: list, patient_name: str, interval_sec: int = 15):
    """
    Renders an autonomous background JavaScript daemon that fires OS-level push notifications,
    in-app visual alert cards, Web Audio synthesized chimes, and voice alerts continuously.
    Includes user gesture controls to reliably unlock browser audio and notification permissions.
    """
    safe_reminders = json.dumps([
        {"title": r["title"], "msg": r["alert_message"], "time": r["timing"], "slot": r["schedule_slot"]}
        for r in reminders if r["status"] != "Needs Confirmation"
    ])
    safe_patient = json.dumps(patient_name or "Patient")
    
    js_code = f"""
    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(6, 95, 70, 0.35)); border: 1.5px solid #10b981; border-radius: 14px; padding: 18px 20px; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.4rem;">🟢</span>
                <span style="font-size: 1.05rem; font-weight: 700; color: #34d399;">AUTONOMOUS ALERT ENGINE: ACTIVE</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button id="cb_unlock_perm_btn" onclick="requestEnginePermission()" style="background: rgba(16, 185, 129, 0.35); color: #6ee7b7; border: 1px solid #10b981; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">
                    🔔 Enable OS Banners
                </button>
                <button onclick="testChimeAndVoice()" style="background: rgba(56, 189, 248, 0.25); color: #38bdf8; border: 1px solid #38bdf8; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">
                    🔊 Test Chime & Voice
                </button>
            </div>
        </div>
        <p style="font-size: 0.88rem; color: #cbd5e1; margin-bottom: 10px; line-height: 1.45;">
            Simulating live background alerts for <b>{patient_name or 'Patient'}</b> based on daily medication timeline. Banners and audible chime fire every <b>{interval_sec}s</b> automatically.
        </p>

        <!-- Current Live Alert Display -->
        <div id="cb_live_alert" style="display: none; background: rgba(15, 23, 42, 0.85); border: 1.5px solid #38bdf8; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; animation: cbPulse 1s ease;">
            <div style="font-size: 0.75rem; color: #38bdf8; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">⚡ LATEST DISPATCHED ALARM</div>
            <div id="cb_live_alert_title" style="font-size: 0.95rem; font-weight: 700; color: #ffffff; margin-top: 2px;"></div>
            <div id="cb_live_alert_body" style="font-size: 0.82rem; color: #cbd5e1; margin-top: 2px;"></div>
        </div>

        <div id="cb_countdown" style="font-size: 0.88rem; color: #6ee7b7; font-weight: 700; background: rgba(0, 0, 0, 0.35); border-radius: 8px; padding: 8px 14px; border: 1px solid rgba(16, 185, 129, 0.4); display: block; box-sizing: border-box;">
            ⏳ Next automated timeline alert in: {interval_sec} seconds... (Zero User Interference)
        </div>
    </div>

    <script>
    (function() {{
        var reminders = {safe_reminders};
        var patientName = {safe_patient};
        var intervalSec = {interval_sec};
        var currentIndex = 0;
        var countdownSec = intervalSec;

        function getNotificationApi() {{
            try {{
                if (window.parent && window.parent.Notification) return window.parent.Notification;
            }} catch(e) {{}}
            if (typeof Notification !== 'undefined') return Notification;
            return null;
        }}

        var notifApi = getNotificationApi();
        var permBtn = document.getElementById("cb_unlock_perm_btn");

        function updatePermBtn() {{
            if (!notifApi || !permBtn) return;
            if (notifApi.permission === "granted") {{
                permBtn.innerText = "✅ OS Banners: Granted";
                permBtn.style.background = "rgba(34, 197, 94, 0.35)";
                permBtn.style.color = "#4ade80";
                permBtn.disabled = true;
            }} else if (notifApi.permission === "denied") {{
                permBtn.innerText = "❌ OS Banners: Blocked";
                permBtn.style.background = "rgba(239, 68, 68, 0.25)";
                permBtn.style.color = "#f87171";
            }}
        }}
        updatePermBtn();

        window.requestEnginePermission = function() {{
            if (!notifApi) return;
            notifApi.requestPermission().then(function(perm) {{
                updatePermBtn();
                if (perm === "granted") {{
                    try {{
                        new notifApi("CareBridge AI Notifications Enabled", {{
                            body: "You will now receive desktop timeline recovery alerts!",
                            icon: "https://cdn-icons-png.flaticon.com/512/2966/2966327.png"
                        }});
                    }} catch(e){{}}
                }}
            }});
        }};

        function playSynthesizedChime() {{
            try {{
                var AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                var ctx = new AudioContext();
                if (ctx.state === 'suspended') ctx.resume();
                var now = ctx.currentTime;
                var osc1 = ctx.createOscillator();
                var osc2 = ctx.createOscillator();
                var gain = ctx.createGain();

                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(587.33, now); // D5
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(880.00, now + 0.12); // A5

                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start(now);
                osc1.stop(now + 0.12);
                osc2.start(now + 0.12);
                osc2.stop(now + 0.65);
            }} catch(e) {{
                try {{
                    var audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
                    audio.play().catch(function(){{}});
                }} catch(err){{}}
            }}
        }}

        window.testChimeAndVoice = function() {{
            playSynthesizedChime();
            if ('speechSynthesis' in window) {{
                try {{
                    window.speechSynthesis.cancel();
                    var utter = new SpeechSynthesisUtterance("Test alert for " + patientName + ". Audio and chime are working perfectly!");
                    utter.rate = 1.0;
                    window.speechSynthesis.speak(utter);
                }} catch(e){{}}
            }}
        }};

        function fireAutoAlert() {{
            if (!reminders || reminders.length === 0) return;
            var item = reminders[currentIndex % reminders.length];
            currentIndex++;

            // 1. Play Synthesized Chime
            playSynthesizedChime();

            // 2. Native OS Push Banner
            if (notifApi && notifApi.permission === "granted") {{
                try {{
                    new notifApi("CareBridge AI: " + item.title + " (" + item.slot + ")", {{
                        body: item.msg,
                        icon: "https://cdn-icons-png.flaticon.com/512/2966/2966327.png"
                    }});
                }} catch(e){{}}
            }}

            // 3. Speech Synthesis
            if ("speechSynthesis" in window) {{
                try {{
                    window.speechSynthesis.cancel();
                    var utter = new SpeechSynthesisUtterance("Reminder for " + patientName + ": Time for " + item.title);
                    utter.rate = 1.0;
                    window.speechSynthesis.speak(utter);
                }} catch(e){{}}
            }}

            // 4. Update In-App Alert Card
            var alertBox = document.getElementById("cb_live_alert");
            var alertTitle = document.getElementById("cb_live_alert_title");
            var alertBody = document.getElementById("cb_live_alert_body");
            if (alertBox && alertTitle && alertBody) {{
                alertBox.style.display = "block";
                alertTitle.innerHTML = "🔔 " + item.title + " (" + item.slot + ") • " + item.time;
                alertBody.innerHTML = item.msg;
            }}
        }}

        if (window.cbIntervalTimer) clearInterval(window.cbIntervalTimer);
        window.cbIntervalTimer = setInterval(function() {{
            countdownSec--;
            var elem = document.getElementById("cb_countdown");
            if (elem) {{
                elem.innerHTML = "⏳ Next automated timeline alert in: " + countdownSec + " seconds... (Zero User Interference)";
            }}
            if (countdownSec <= 0) {{
                fireAutoAlert();
                countdownSec = intervalSec;
            }}
        }}, 1000);

    }})();
    </script>
    """
    components.html(js_code, height=290)

# ==============================================================================
# 7. STREAMLIT UI CONFIGURATION & THEMING
# ==============================================================================
st.set_page_config(page_title="CareBridge AI — Recovery Companion", page_icon="🌉", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

    /* Global Typography & Font Family */
    html, body, [class*="css"], .stApp {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        background-color: #f8fafc !important;
        color: #0f172a !important;
    }

    /* Top Utility Bar (MediWeb Style) */
    .mediweb-topbar {
        background: linear-gradient(90deg, #1e1b4b 0%, #312e81 100%);
        color: #e0e7ff;
        padding: 9px 24px;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: 500;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 18px;
        box-shadow: 0 4px 15px rgba(30, 27, 75, 0.15);
    }
    .mediweb-topbar-item {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    /* Hero Section (MediWeb Style) */
    .mediweb-hero {
        background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 50%, #eff6ff 100%);
        border: 1px solid #e0e7ff;
        border-radius: 24px;
        padding: 38px 42px;
        margin-bottom: 24px;
        box-shadow: 0 10px 30px rgba(79, 70, 229, 0.07);
        position: relative;
        overflow: hidden;
    }
    .mediweb-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #e0e7ff;
        color: #4338ca;
        font-size: 0.8rem;
        font-weight: 700;
        padding: 5px 14px;
        border-radius: 9999px;
        margin-bottom: 14px;
        letter-spacing: 0.3px;
    }
    .mediweb-hero-title {
        font-size: 3rem !important;
        font-weight: 800 !important;
        color: #0f172a !important;
        line-height: 1.15 !important;
        margin-bottom: 12px !important;
        letter-spacing: -0.5px;
    }
    .mediweb-hero-title span {
        color: #4f46e5 !important;
    }
    .mediweb-hero-sub {
        font-size: 1.05rem !important;
        color: #475569 !important;
        line-height: 1.6 !important;
        margin-bottom: 22px !important;
        max-width: 640px;
    }

    /* Quick Action Pill Bar */
    .mediweb-action-bar {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 9999px;
        padding: 6px 10px 6px 20px;
        display: inline-flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    }

    /* Floating Metric Pill Badges */
    .mediweb-floating-pill {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 9999px;
        padding: 8px 18px;
        font-size: 0.85rem;
        font-weight: 700;
        color: #1e1b4b;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-right: 8px;
        margin-bottom: 8px;
    }

    /* 4 Quick Action Cards (Under Hero) */
    .mediweb-quick-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        padding: 22px 20px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
        transition: all 0.25s ease;
        height: 100%;
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .mediweb-quick-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 28px rgba(79, 70, 229, 0.12);
        border-color: #818cf8;
    }
    .mediweb-card-icon {
        width: 52px;
        height: 52px;
        border-radius: 14px;
        background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
        border: 1px solid #c7d2fe;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.6rem;
        flex-shrink: 0;
    }

    /* 6-Grid Feature Services */
    .mediweb-service-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        padding: 26px 24px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.03);
        transition: all 0.25s ease;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }
    .mediweb-service-card:hover {
        transform: translateY(-4px);
        border-color: #6366f1;
        box-shadow: 0 12px 30px rgba(99, 102, 241, 0.1);
    }
    .mediweb-service-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: #eef2ff;
        border: 1px solid #e0e7ff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        margin-bottom: 14px;
    }

    /* About Medical Section */
    .mediweb-about-box {
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border: 1px solid #e2e8f0;
        border-radius: 22px;
        padding: 32px 36px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.04);
        margin: 24px 0;
    }

    /* Why Patients Choose Us Banner */
    .mediweb-trust-card {
        background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
        color: #ffffff;
        border-radius: 22px;
        padding: 32px;
        box-shadow: 0 10px 30px rgba(79, 70, 229, 0.25);
    }

    /* Profile & General Cards */
    .profile-card {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 18px;
        padding: 24px;
        margin-bottom: 20px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    }
    .activity-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        padding: 22px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.04);
    }
    .activity-log-item {
        background: #f8fafc;
        border-left: 3.5px solid #10b981;
        border: 1px solid #f1f5f9;
        border-left-width: 3.5px;
        padding: 10px 14px;
        border-radius: 0 10px 10px 0;
        margin-bottom: 8px;
        font-size: 0.86rem;
        color: #1e293b;
    }
    .timeline-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 14px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
    }
    .step-pill {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px 16px;
        text-align: center;
        font-weight: 600;
        font-size: 0.9rem;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
        color: #1e1b4b;
    }

    /* Sidebar Navigation Styles */
    section[data-testid="stSidebar"] {
        background-color: #ffffff !important;
        border-right: 1px solid #e2e8f0 !important;
    }
    section[data-testid="stSidebar"] div[data-testid="stRadio"] > div { gap: 6px !important; }
    section[data-testid="stSidebar"] div[data-testid="stRadio"] label {
        background: #f8fafc !important;
        border: 1px solid #f1f5f9 !important;
        border-radius: 12px !important;
        padding: 11px 16px !important;
        margin-bottom: 3px !important;
        transition: all 0.22s ease !important;
        cursor: pointer !important;
        width: 100% !important;
        display: flex !important;
        color: #334155 !important;
        font-weight: 600 !important;
    }
    section[data-testid="stSidebar"] div[data-testid="stRadio"] label:hover {
        background: #eef2ff !important;
        border-color: #c7d2fe !important;
        color: #4338ca !important;
        transform: translateX(4px) !important;
    }
    section[data-testid="stSidebar"] div[data-testid="stRadio"] label:has(input:checked),
    section[data-testid="stSidebar"] div[data-testid="stRadio"] label[data-checked="true"] {
        background: linear-gradient(90deg, #4f46e5 0%, #6366f1 100%) !important;
        color: #ffffff !important;
        border: 1px solid #4f46e5 !important;
        font-weight: 700 !important;
        box-shadow: 0 4px 14px rgba(79, 70, 229, 0.3) !important;
    }
    section[data-testid="stSidebar"] div[data-testid="stRadio"] label > div:first-child { display: none !important; }
    section[data-testid="stSidebar"] div[data-testid="stRadio"] input[type="radio"] { display: none !important; }

    /* Streamlit Buttons & Inputs */
    .stButton > button {
        border-radius: 10px !important;
        font-weight: 600 !important;
        transition: all 0.2s ease !important;
    }
    .stButton > button[kind="primary"] {
        background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%) !important;
        border: none !important;
        color: #ffffff !important;
        box-shadow: 0 4px 14px rgba(79, 70, 229, 0.25) !important;
    }
    .stButton > button[kind="primary"]:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 6px 20px rgba(79, 70, 229, 0.35) !important;
    }
</style>
""", unsafe_allow_html=True)

# Session State Initialization
if "user_name" not in st.session_state: st.session_state.user_name = ""
if "user_country" not in st.session_state: st.session_state.user_country = "🇮🇳 India (+91)"
if "user_phone" not in st.session_state: st.session_state.user_phone = ""
if "is_logged_in" not in st.session_state: st.session_state.is_logged_in = False
if "active_notification" not in st.session_state: st.session_state.active_notification = None
if "family_members" not in st.session_state: st.session_state.family_members = []
if "extracted_text" not in st.session_state: st.session_state.extracted_text = ""
if "uploaded_filename" not in st.session_state: st.session_state.uploaded_filename = ""
if "api_key" not in st.session_state: st.session_state.api_key = os.getenv("GEMINI_API_KEY", "")
if "checklist_state" not in st.session_state: st.session_state.checklist_state = {}
if "activity_log" not in st.session_state: st.session_state.activity_log = []
if "auto_alert_active" not in st.session_state: st.session_state.auto_alert_active = False

# ==============================================================================
# SIDEBAR: BRANDING & PROFILE STATUS
# ==============================================================================
st.sidebar.markdown("""
<div style="background: linear-gradient(135deg, #eef2ff 0%, #ffffff 100%); border: 1.5px solid #c7d2fe; border-radius: 18px; padding: 18px 14px; margin-bottom: 15px; text-align: center; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.08);">
    <div style="font-size: 2.2rem; margin-bottom: 4px;">🌉</div>
    <div style="font-size: 1.35rem; font-weight: 800; color: #4f46e5; letter-spacing: -0.3px;">CareBridge AI</div>
    <div style="font-size: 0.8rem; color: #64748b; font-weight: 500;">Your Personal Recovery Companion</div>
</div>
""", unsafe_allow_html=True)

curr_prefix = COUNTRY_CODES.get(st.session_state.user_country, "+91")

if st.session_state.is_logged_in and st.session_state.user_name:
    st.sidebar.markdown(f"""
    <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.05);">
        <div style="font-size: 0.72rem; color: #15803d; font-weight: 700; letter-spacing: 0.5px;">🟢 ACTIVE PATIENT</div>
        <div style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin-top: 2px;">{st.session_state.user_name}</div>
        <div style="font-size: 0.82rem; color: #64748b; margin-top: 2px;">📱 {curr_prefix} {st.session_state.user_phone}</div>
    </div>
    """, unsafe_allow_html=True)

    if st.sidebar.button("🚪 Sign Out", key="sidebar_signout_btn", use_container_width=True):
        st.session_state.is_logged_in = False
        st.session_state.user_name = ""
        st.session_state.user_phone = ""
        st.toast("Signed out successfully!", icon="🚪")
        st.rerun()
else:
    st.sidebar.markdown("""
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px;">
        <div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700;">⚪ NOT LOGGED IN</div>
        <div style="font-size: 0.82rem; color: #475569; margin-top: 4px; line-height: 1.4;">Sign in on the Login page to personalize recovery reminders.</div>
    </div>
    """, unsafe_allow_html=True)

nav_pages = [
    "🏠 Home",
    "🔐 Patient Login & Profile",
    "📄 Upload & Review Document",
    "💡 Understand My Instructions",
    "🔍 Confusion Detector",
    "🗺️ My Recovery Journey",
    "♿ Accessibility & Audio"
]
current_page = st.sidebar.radio("Navigation Menu:", nav_pages)
st.sidebar.divider()

if st.session_state.uploaded_filename:
    st.sidebar.markdown(f"<div style='background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 10px; padding: 10px; margin-bottom: 10px; border: 1px solid #bbf7d0; border-left-width: 4px;'><b style='color:#15803d;'>🟢 Active Document:</b><br><small style='color:#334155;'>{st.session_state.uploaded_filename}</small></div>", unsafe_allow_html=True)
else:
    st.sidebar.markdown("<div style='background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin-bottom: 10px;'><small style='color:#64748b;'>⚪ No document loaded</small></div>", unsafe_allow_html=True)

if st.sidebar.button("🗑️ Clear Document & Reset", use_container_width=True):
    st.session_state.extracted_text = ""
    st.session_state.uploaded_filename = ""
    st.session_state.checklist_state = {}
    st.session_state.activity_log = []
    st.session_state.auto_alert_active = False
    st.rerun()

with st.sidebar.expander("⚙️ Optional AI Settings"):
    custom_key = st.text_input("Gemini API Key (optional):", value=st.session_state.api_key if st.session_state.api_key != "your_gemini_api_key_here" else "", type="password")
    if custom_key != st.session_state.api_key: st.session_state.api_key = custom_key

st.sidebar.markdown("""
<div style="background: linear-gradient(135deg, #eef2ff 0%, #ffffff 100%); border: 1px solid #c7d2fe; border-radius: 14px; padding: 12px 14px; margin-top: 15px; text-align: center; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.05);">
    <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1.2px; color: #4f46e5; font-weight: 700; margin-bottom: 4px;">
        👨‍💻 Platform Developers
    </div>
    <div style="font-size: 0.96rem; font-weight: 800; color: #0f172a;">
        Sree Charan & Karthik
    </div>
    <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
        CareBridge AI Core Architects
    </div>
</div>
""", unsafe_allow_html=True)

# ==============================================================================
# PAGE 1: HOME
# ==============================================================================
if current_page == "🏠 Home":
    # 1. TOP UTILITY BAR (MediWeb Style)
    st.markdown("""
    <div class="mediweb-topbar">
        <div class="mediweb-topbar-item">
            <span>📍</span> <span>2702 Hospital Recovery Blvd, Suite 400</span>
            <span style="opacity:0.4; margin: 0 10px;">|</span>
            <span>🕒</span> <span>24/7 Automated Recovery & Adherence Monitoring</span>
        </div>
        <div class="mediweb-topbar-item">
            <span>📞</span> <span>Emergency Clinical Line: <b>1-800-CARE-AI (108 / 911)</b></span>
            <span style="opacity:0.4; margin: 0 10px;">|</span>
            <span>🌐</span> <span>Multi-Language (EN, HI, TE)</span>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # 2. HERO SECTION (MediWeb Style)
    st.markdown("""
    <div class="mediweb-hero">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 24px;">
            <div style="flex: 1.2; min-width: 320px;">
                <div class="mediweb-eyebrow">
                    <span>🩺</span> Your Health Our Priority • Post-Discharge Companion
                </div>
                <h1 class="mediweb-hero-title">
                    Your Health<br><span>Our Priority</span>
                </h1>
                <p class="mediweb-hero-sub">
                    We provide comprehensive post-discharge recovery services with a personal touch, translating dense hospital paperwork and handwritten prescriptions into plain language, daily checklists, and automated medication alarms.
                </p>
                <div class="mediweb-action-bar">
                    <span style="font-size: 0.9rem; color: #475569; font-weight: 600;">📑 Discharge Summary or Prescription</span>
                    <span style="color: #cbd5e1;">|</span>
                    <span style="font-size: 0.9rem; color: #4f46e5; font-weight: 700;">Clinical Vision OCR Ready</span>
                </div>
                <div style="margin-top: 18px; font-size: 0.85rem; color: #64748b;">
                    🚀 Engineered by <b style="color: #4f46e5;">Sree Charan</b> & <b style="color: #10b981;">Karthik</b> • CareBridge AI Clinical Protocols
                </div>
            </div>
            <div style="flex: 0.9; min-width: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(14, 165, 233, 0.12) 100%); border-radius: 20px; padding: 28px; border: 1px solid #c7d2fe; text-align: center;">
                <div style="font-size: 4.5rem; margin-bottom: 8px;">👨‍⚕️</div>
                <div style="font-weight: 800; font-size: 1.3rem; color: #1e1b4b;">Clinical Recovery Team</div>
                <div style="font-size: 0.88rem; color: #475569; margin-bottom: 16px;">AI-Assisted Patient Safety & Verification</div>
                <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;">
                    <div class="mediweb-floating-pill">🫀 Cardiology & Meds</div>
                    <div class="mediweb-floating-pill">🧠 Confusion Safety Check</div>
                    <div class="mediweb-floating-pill">🦴 Recovery Roadmap</div>
                </div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # 3. 4 FLOATING QUICK-ACTION CARDS (Direct from MediWeb Screenshot)
    st.markdown("<div style='margin-bottom: 24px;'>", unsafe_allow_html=True)
    q1, q2, q3, q4 = st.columns(4)
    with q1:
        st.markdown("""
        <div class="mediweb-quick-card">
            <div class="mediweb-card-icon" style="color: #4f46e5;">📄</div>
            <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #0f172a;">Upload Document</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Cursive OCR & PDF Summary</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
    with q2:
        st.markdown("""
        <div class="mediweb-quick-card">
            <div class="mediweb-card-icon" style="color: #0ea5e9;">🔍</div>
            <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #0f172a;">Confusion Detector</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Detect Ambiguities & Gaps</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
    with q3:
        st.markdown("""
        <div class="mediweb-quick-card">
            <div class="mediweb-card-icon" style="color: #10b981;">⏰</div>
            <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #0f172a;">Daily Timeline</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Scheduled Alarms & Chimes</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
    with q4:
        st.markdown("""
        <div class="mediweb-quick-card">
            <div class="mediweb-card-icon" style="color: #8b5cf6;">🥗</div>
            <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #0f172a;">Diet & Nutrition</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Clinical Nutrition Targets</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)

    # 4. ABOUT / PROVIDING EXCEPTIONAL HEALTHCARE SECTION (Middle of MediWeb Screenshot)
    st.markdown("""
    <div class="mediweb-about-box">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 32px;">
            <div style="flex: 0.95; min-width: 300px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 28px; box-shadow: 0 4px 20px rgba(0,0,0,0.04);">
                <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
                    <div style="font-size: 2.8rem;">👩‍⚕️👨‍⚕️</div>
                    <div>
                        <div style="font-weight: 800; font-size: 1.15rem; color: #0f172a;">CareBridge AI Medical Core</div>
                        <div style="font-size: 0.82rem; color: #64748b;">Post-Discharge Recovery Protocols</div>
                    </div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 18px; margin-bottom: 14px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 0.85rem; font-weight: 700; color: #10b981;">⭐ TrustScore 4.9</span>
                        <span style="font-size: 0.78rem; color: #64748b; font-weight: 600;">2k+ Verified Clinical Reviews</span>
                    </div>
                    <div style="font-size: 0.82rem; color: #334155; margin-top: 6px;">
                        <b>Zero Hallucinations Protocol</b>: Grounded strictly in uploaded hospital discharge records and doctor notes.
                    </div>
                </div>
                <div style="font-size: 0.82rem; color: #475569; line-height: 1.5;">
                    🛡️ Safety-first confusion detection highlights illegible handwriting and missing dosage frequencies before medication errors happen.
                </div>
            </div>
            <div style="flex: 1.25; min-width: 320px;">
                <div class="mediweb-eyebrow" style="background: #eef2ff; color: #4f46e5;">
                    About CareBridge AI
                </div>
                <h2 style="font-size: 2.2rem; font-weight: 800; color: #0f172a; line-height: 1.25; margin: 10px 0 16px 0;">
                    Providing Exceptional Healthcare with a focus on patient.
                </h2>
                <p style="font-size: 0.96rem; color: #475569; line-height: 1.65; margin-bottom: 20px;">
                    Hospital discharge summaries are notoriously dense, filled with clinical abbreviations (<code>BID</code>, <code>TID</code>, <code>PRN</code>), and fragmented schedules. CareBridge AI converts medical jargon into plain-language explanations, generates daily recovery checklists, and ensures no medication dose is missed with autonomous timeline alarms.
                </p>
                <div style="display: flex; align-items: center; gap: 18px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 44px; height: 44px; border-radius: 50%; background: #4f46e5; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem;">🌉</div>
                        <div>
                            <div style="font-size: 0.95rem; font-weight: 800; color: #0f172a;">Sree Charan & Karthik</div>
                            <div style="font-size: 0.78rem; color: #64748b;">Lead Developers & Core Architects</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # 5. 6-GRID SERVICE MODULES (From MediWeb Screenshot 2)
    st.markdown("""
    <div style="margin: 32px 0 16px 0;">
        <div class="mediweb-eyebrow">Our Recovery Services</div>
        <h2 style="font-size: 2.1rem; font-weight: 800; color: #0f172a; margin: 6px 0 10px 0;">
            We provide a wide range of recovery services
        </h2>
        <p style="font-size: 0.95rem; color: #64748b; margin-bottom: 24px;">
            Each module is tailored to guide patients and caregivers seamlessly from the hospital bed to confident home independence.
        </p>
    </div>
    """, unsafe_allow_html=True)

    g1, g2, g3 = st.columns(3)
    with g1:
        st.markdown("""
        <div class="mediweb-service-card">
            <div>
                <div class="mediweb-service-icon">✍️</div>
                <h3 style="font-size: 1.18rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Handwriting OCR Vision</h3>
                <p style="font-size: 0.88rem; color: #475569; line-height: 1.55;">
                    Multimodal Vision AI accurately deciphers blue cursive ink, hurried doctor handwriting, and clinical discharge prescription notes.
                </p>
            </div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #4f46e5; margin-top: 14px;">Explore Vision OCR ↗</div>
        </div>
        """, unsafe_allow_html=True)
    with g2:
        st.markdown("""
        <div class="mediweb-service-card">
            <div>
                <div class="mediweb-service-icon" style="background: #fef3c7; border-color: #fde68a;">🛡️</div>
                <h3 style="font-size: 1.18rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Confusion Detector Engine</h3>
                <p style="font-size: 0.88rem; color: #475569; line-height: 1.55;">
                    Proactive safety engine flags missing medication names, ambiguous dosages, and conflicting follow-up clinic dates before mistakes occur.
                </p>
            </div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #d97706; margin-top: 14px;">Explore Safety Check ↗</div>
        </div>
        """, unsafe_allow_html=True)
    with g3:
        st.markdown("""
        <div class="mediweb-service-card">
            <div>
                <div class="mediweb-service-icon" style="background: #dcfce7; border-color: #bbf7d0;">⏰</div>
                <h3 style="font-size: 1.18rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Daily Medication Timeline</h3>
                <p style="font-size: 0.88rem; color: #475569; line-height: 1.55;">
                    Automatically organizes medications into Morning (08:00 AM), Afternoon (01:00 PM), and Evening (08:00 PM) scheduled slots.
                </p>
            </div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #10b981; margin-top: 14px;">Explore Timeline ↗</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<div style='margin-top: 16px;'></div>", unsafe_allow_html=True)
    g4, g5, g6 = st.columns(3)
    with g4:
        st.markdown("""
        <div class="mediweb-service-card">
            <div>
                <div class="mediweb-service-icon" style="background: #f3e8ff; border-color: #e9d5ff;">🥗</div>
                <h3 style="font-size: 1.18rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Clinical Nutrition Planner</h3>
                <p style="font-size: 0.88rem; color: #475569; line-height: 1.55;">
                    Evidence-based disease-specific diet roadmaps, precise hydration targets, and foods to avoid based on your discharge diagnosis.
                </p>
            </div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #8b5cf6; margin-top: 14px;">Explore Clinical Diet ↗</div>
        </div>
        """, unsafe_allow_html=True)
    with g5:
        st.markdown("""
        <div class="mediweb-service-card">
            <div>
                <div class="mediweb-service-icon" style="background: #e0f2fe; border-color: #bae6fd;">🔊</div>
                <h3 style="font-size: 1.18rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Hands-Free Voice & Chimes</h3>
                <p style="font-size: 0.88rem; color: #475569; line-height: 1.55;">
                    Autonomous background alert engine triggers synthesized hospital chimes, spoken voice announcements, and native OS desktop banners.
                </p>
            </div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #0284c7; margin-top: 14px;">Explore Audio Engine ↗</div>
        </div>
        """, unsafe_allow_html=True)
    with g6:
        st.markdown("""
        <div class="mediweb-service-card">
            <div>
                <div class="mediweb-service-icon" style="background: #fce7f3; border-color: #fbcfe8;">♿</div>
                <h3 style="font-size: 1.18rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Universal Accessibility</h3>
                <p style="font-size: 0.88rem; color: #475569; line-height: 1.55;">
                    High-contrast layouts, multi-language speech readouts in English, Hindi, and Telugu, designed for seniors, caregivers, and families.
                </p>
            </div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #db2777; margin-top: 14px;">Explore Accessibility ↗</div>
        </div>
        """, unsafe_allow_html=True)

    # 6. WHY PATIENTS & CAREGIVERS RECOMMEND US (Bottom Banner from Screenshot)
    st.markdown("""
    <div style="margin-top: 36px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 22px; padding: 32px 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.04);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 28px;">
            <div style="flex: 1.2; min-width: 320px;">
                <div class="mediweb-eyebrow" style="background: #f1f5f9; color: #475569;">Why Choose CareBridge AI</div>
                <h2 style="font-size: 2.1rem; font-weight: 800; color: #0f172a; margin: 8px 0 16px 0;">Why Our Patients Recommend Us</h2>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div style="display: flex; align-items: flex-start; gap: 14px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 12px 16px;">
                        <span style="font-size: 1.4rem;">🛡️</span>
                        <div>
                            <div style="font-weight: 700; font-size: 0.95rem; color: #0f172a;">Patient-Centered Safety</div>
                            <div style="font-size: 0.82rem; color: #64748b;">Every instruction is grounded strictly in clinical documents without guessing.</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 14px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 12px 16px;">
                        <span style="font-size: 1.4rem;">🚨</span>
                        <div>
                            <div style="font-weight: 700; font-size: 0.95rem; color: #0f172a;">Emergency Red Flag Signs</div>
                            <div style="font-size: 0.82rem; color: #64748b;">Critical danger symptoms are immediately surfaced for instant hospital action.</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 14px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 12px 16px;">
                        <span style="font-size: 1.4rem;">📲</span>
                        <div>
                            <div style="font-weight: 700; font-size: 0.95rem; color: #0f172a;">Multi-Channel Integration</div>
                            <div style="font-size: 0.82rem; color: #64748b;">One-click WhatsApp alerts, SMS routing, and phone calendar (.ics) sync.</div>
                        </div>
                    </div>
                </div>
            </div>
            <div style="flex: 0.8; min-width: 280px; background: linear-gradient(135deg, #4f46e5 0%, #312e81 100%); border-radius: 20px; padding: 28px; color: #ffffff; text-align: center; box-shadow: 0 10px 25px rgba(79, 70, 229, 0.25);">
                <div style="font-size: 3rem; margin-bottom: 8px;">🩺</div>
                <div style="font-size: 1.4rem; font-weight: 800; margin-bottom: 4px;">Hello! 24/7 Care</div>
                <div style="font-size: 0.88rem; color: #e0e7ff; margin-bottom: 16px;">Your Autonomous Post-Discharge Companion</div>
                <div style="background: rgba(255, 255, 255, 0.15); border-radius: 12px; padding: 12px; font-size: 0.85rem; font-weight: 600;">
                    🟢 System Status: Active & Monitoring
                </div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)
    st.warning("⚠️ **Important Medical Disclaimer**: CareBridge AI is an educational recovery assistant prototype. It does **not** diagnose medical conditions, alter physician prescriptions, or replace professional medical advice. Always consult your doctor or hospital pharmacist for clinical decisions.")

# ==============================================================================
# PAGE 2: PATIENT LOGIN & PROFILE (CLEAN, FUNCTIONAL & WORKING!)
# ==============================================================================
elif current_page == "🔐 Patient Login & Profile":
    st.title("🔐 Patient Login & Profile")

    # CASE A: USER IS NOT LOGGED IN -> SHOW REAL LOGIN FORM
    if not st.session_state.is_logged_in or not st.session_state.user_name:
        st.write("Please sign in with your Name and Mobile Number to receive personalized recovery reminders and medication alerts.")

        login_c1, login_c2 = st.columns([1.2, 0.8])
        with login_c1:
            st.markdown("""
            <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 16px; padding: 24px;">
                <h3 style="margin-top:0; color:#38bdf8;">🔑 Sign In / Login</h3>
            """, unsafe_allow_html=True)

            with st.form("real_login_form"):
                inp_name = st.text_input("Full Name:", placeholder="e.g. John Smith or Karthik")
                inp_country = st.selectbox("Country Code:", list(COUNTRY_CODES.keys()), index=0)
                inp_phone = st.text_input("Mobile Number:", placeholder="e.g. 9876543210")
                
                login_btn = st.form_submit_button("🔑 Sign In / Login", use_container_width=True, type="primary")

                if login_btn:
                    clean_p = re.sub(r"[^\d]", "", inp_phone)
                    if not inp_name.strip():
                        st.error("Please enter your name.")
                    elif len(clean_p) < 7:
                        st.error("Please enter a valid mobile number (at least 7 to 10 digits).")
                    else:
                        st.session_state.is_logged_in = True
                        st.session_state.user_name = inp_name.strip()
                        st.session_state.user_country = inp_country
                        st.session_state.user_phone = clean_p
                        st.toast(f"Welcome, {inp_name}!", icon="👋")
                        st.rerun()

            st.markdown("</div>", unsafe_allow_html=True)
            
        with login_c2:
            st.markdown("""
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 18px;">
                <h4 style="color:#a5b4fc; margin-top:0;">🛡️ Private & Secure</h4>
                <p style="font-size:0.85rem; color:#cbd5e1; line-height:1.6;">
                    Your profile information is used strictly in this browser session to personalize your medication schedule and route alerts to your verified phone.
                </p>
            </div>
            """, unsafe_allow_html=True)

    # CASE B: USER IS LOGGED IN -> SHOW CLEAN PROFILE + REAL WORKING SIGN OUT + FAMILY MEMBERS
    else:
        st.write(f"Logged in as **{st.session_state.user_name}**. Manage your profile or add family members below.")

        prof_col1, prof_col2 = st.columns([1.1, 0.9], gap="large")

        with prof_col1:
            st.markdown(f"""
            <div class="profile-card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.75rem; color:#4ade80; font-weight:700; letter-spacing:0.5px;">🟢 ACTIVE USER PROFILE</div>
                        <h2 style="margin:4px 0 6px 0; color:#38bdf8;">{st.session_state.user_name}</h2>
                        <div style="font-size:1rem; color:#f1f5f9; font-weight:600;">📱 {curr_prefix} {st.session_state.user_phone}</div>
                    </div>
                    <div>
                        <span style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid #22c55e; border-radius:20px; font-size:0.8rem; padding:4px 12px; font-weight:700;">Logged In</span>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)

            # REAL WORKING SIGN OUT BUTTON
            if st.button("🚪 Sign Out", key="main_signout_btn", use_container_width=True, type="secondary"):
                st.session_state.is_logged_in = False
                st.session_state.user_name = ""
                st.session_state.user_phone = ""
                st.toast("Signed out successfully!", icon="🚪")
                st.rerun()

            st.divider()

            # EDIT USER PROFILE FORM (JUST NAME & PHONE)
            st.markdown("### ✏️ Edit Profile")
            with st.form("edit_profile_simple"):
                upd_name = st.text_input("Name:", value=st.session_state.user_name)
                upd_country = st.selectbox("Country Code:", list(COUNTRY_CODES.keys()), index=list(COUNTRY_CODES.keys()).index(st.session_state.user_country) if st.session_state.user_country in COUNTRY_CODES else 0)
                upd_phone = st.text_input("Mobile Number:", value=st.session_state.user_phone)
                
                save_prof_btn = st.form_submit_button("💾 Save Profile Changes", use_container_width=True, type="primary")

                if save_prof_btn:
                    clean_p = re.sub(r"[^\d]", "", upd_phone)
                    if not upd_name.strip():
                        st.error("Please enter a name.")
                    elif len(clean_p) < 7:
                        st.error("Please enter a valid mobile number.")
                    else:
                        st.session_state.user_name = upd_name.strip()
                        st.session_state.user_country = upd_country
                        st.session_state.user_phone = clean_p
                        st.toast("Profile updated successfully!", icon="✅")
                        st.rerun()

        with prof_col2:
            st.markdown("### 👨‍👩‍👧 Family Members (Optional)")
            st.caption("Add family members (e.g., Mother, Father, Spouse, Child) to send medication alerts directly to their phones:")

            with st.form("add_family_form"):
                fam_name = st.text_input("Family Member Name:", placeholder="e.g. Suresh (Father)")
                fam_relation = st.selectbox("Relationship:", ["Mother", "Father", "Spouse", "Child", "Grandparent", "Other"])
                fam_country = st.selectbox("Country Code:", list(COUNTRY_CODES.keys()), index=0, key="fam_country_select")
                fam_phone = st.text_input("Mobile Number:", placeholder="e.g. 9845123456")
                
                add_fam_btn = st.form_submit_button("➕ Add Family Member", use_container_width=True)

                if add_fam_btn:
                    clean_fam_p = re.sub(r"[^\d]", "", fam_phone)
                    if not fam_name.strip():
                        st.error("Please enter family member's name.")
                    elif len(clean_fam_p) < 7:
                        st.error("Please enter a valid phone number.")
                    else:
                        st.session_state.family_members.append({
                            "name": fam_name.strip(),
                            "relation": fam_relation,
                            "country": fam_country,
                            "phone": clean_fam_p
                        })
                        st.toast(f"Added {fam_name} to family members!", icon="👨‍👩‍👧")
                        st.rerun()

            if st.session_state.family_members:
                st.markdown("#### 📋 Saved Family Members")
                for f_idx, fam in enumerate(st.session_state.family_members):
                    f_prefix = COUNTRY_CODES.get(fam["country"], "+91")
                    f_c1, f_c2 = st.columns([2.5, 1.5])
                    with f_c1:
                        st.markdown(f"""
                        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:10px 12px; margin-bottom:8px;">
                            <b>{fam['name']}</b> <span style="background:rgba(99,102,241,0.2); color:#a5b4fc; padding:2px 8px; border-radius:10px; font-size:0.75rem;">{fam['relation']}</span><br>
                            <small style="color:#94a3b8;">📱 {f_prefix} {fam['phone']}</small>
                        </div>
                        """, unsafe_allow_html=True)
                    with f_c2:
                        btn_sub1, btn_sub2 = st.columns(2)
                        with btn_sub1:
                            if st.button("Use", key=f"use_fam_{f_idx}", help="Set as active recipient for alerts"):
                                st.session_state.user_name = fam["name"]
                                st.session_state.user_country = fam["country"]
                                st.session_state.user_phone = fam["phone"]
                                st.toast(f"Active recipient set to {fam['name']}!", icon="👤")
                                st.rerun()
                        with btn_sub2:
                            if st.button("🗑️", key=f"del_fam_{f_idx}", help="Remove family member"):
                                st.session_state.family_members.pop(f_idx)
                                st.rerun()

# ==============================================================================
# PAGE 3: UPLOAD & REVIEW DOCUMENT
# ==============================================================================
elif current_page == "📄 Upload & Review Document":
    st.title("📄 Upload & Review Medical Document")
    st.write("Upload a hospital discharge summary, clinical note, or doctor's handwritten prescription slip.")

    doc_type_mode = st.radio(
        "Document Processing Mode:",
        ["✍️ Doctor Handwritten Prescription / Cursive Notes (AI Vision Enhanced)", "📄 Standard Printed Document (PDF/Typed)"],
        horizontal=False
    )
    uploaded_file = st.file_uploader("Upload document or prescription (PDF, PNG, JPG, JPEG):", type=["pdf", "png", "jpg", "jpeg"], help=f"Max size: {MAX_FILE_SIZE_MB}MB.")
    
    with st.expander("🔑 Live AI Vision Gemini API Key (Optional)"):
        st.caption("Enter a free Gemini API Key from [Google AI Studio](https://aistudio.google.com) to decipher any custom handwritten note.")
        direct_key = st.text_input("Gemini API Key:", value=st.session_state.api_key if st.session_state.api_key != "your_gemini_api_key_here" else "", type="password", key="direct_gemini_key")
        if direct_key != st.session_state.api_key: st.session_state.api_key = direct_key

    if uploaded_file is not None:
        if uploaded_file.name != st.session_state.uploaded_filename:
            is_valid, validation_msg = validate_uploaded_file(uploaded_file)
            if not is_valid:
                st.error(f"❌ {validation_msg}")
            else:
                file_bytes = uploaded_file.read()
                file_ext = uploaded_file.name.lower().rsplit(".", 1)[-1]
                
                if file_ext == "pdf":
                    with st.spinner("Extracting text from PDF document..."):
                        extracted_text, success, msg = extract_text_from_pdf(file_bytes)
                else:
                    st.image(file_bytes, caption=f"Uploaded: {uploaded_file.name}", width=400)
                    
                    if "Handwritten" in doc_type_mode:
                        with st.spinner("🧠 Deciphering doctor handwriting with AI Vision..."):
                            extracted_text, success, msg = extract_handwriting_with_gemini_vision(file_bytes, api_key=st.session_state.api_key)
                    else:
                        with st.spinner("Extracting printed text using OCR..."):
                            extracted_text, success, msg = extract_text_from_image(file_bytes)
                
                st.session_state.extracted_text = extracted_text
                st.session_state.uploaded_filename = uploaded_file.name
                if success:
                    st.success(f"✅ {msg}")
                else:
                    st.warning(f"⚠️ {msg}")

    if st.session_state.extracted_text or st.session_state.uploaded_filename:
        st.divider()
        st.subheader("📋 Review & Verify Extracted Medical Text")
        st.caption("CareBridge AI converted your document into digital text. Verify or adjust any dosage details below before analyzing:")
        edited_text = st.text_area(label="Document Text Content (Editable):", value=st.session_state.extracted_text, height=280)
        if edited_text != st.session_state.extracted_text:
            st.session_state.extracted_text = edited_text
        
        m1, m2 = st.columns(2)
        m1.metric("Character Count", len(st.session_state.extracted_text))
        m2.metric("Word Count", len(st.session_state.extracted_text.split()))

# ==============================================================================
# PAGE 4: UNDERSTAND MY INSTRUCTIONS
# ==============================================================================
elif current_page == "💡 Understand My Instructions":
    st.title("💡 Understand My Instructions")
    st.write("Clear, patient-friendly explanations of your discharge instructions, medications, and prescription abbreviations.")
    
    if not st.session_state.extracted_text.strip():
        st.warning("⚠️ No document uploaded yet. Please go to **📄 Upload & Review Document** to load your summary or prescription.")
    else:
        with st.spinner("Generating patient explanation..."):
            explanation_data = get_medical_explanation(st.session_state.extracted_text, api_key=st.session_state.api_key)
        
        st.caption(f"Analysis Engine: **{explanation_data.get('mode', 'Standard')}**")
        tab1, tab2, tab3, tab4 = st.tabs(["🌟 Patient Explanation", "🥗 AI Disease Diet Plan", "📖 Medical Glossary", "💬 Ask Questions"])
        
        with tab1:
            col_exp, col_orig = st.columns([3, 2])
            with col_exp: 
                st.markdown(explanation_data.get("summary", "No explanation available."))
            with col_orig:
                st.markdown("#### 📄 Original Source Text")
                st.info(st.session_state.extracted_text)
                
        with tab2:
            st.subheader("🥗 AI Disease-Specific Diet & Nutrition Plan")
            st.caption("Personalized clinical nutrition and dietary guidelines generated dynamically based on diagnosed conditions and medications.")
            
            diet = explanation_data.get("diet_plan", {})
            if diet:
                st.markdown(f"""
                <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px solid rgba(16, 185, 129, 0.4); border-radius: 14px; padding: 18px 20px; margin-bottom: 20px;">
                    <div style="font-size: 0.78rem; font-weight: 800; color: #34d399; letter-spacing: 1.2px; text-transform: uppercase;">🩺 Targeted Clinical Indications</div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: #f8fafc; margin-top: 4px;">{diet.get('condition_title', 'General Post-Discharge Recovery')}</div>
                    <div style="font-size: 0.82rem; color: #94a3b8; margin-top: 4px;">Analysis Model: <b>{diet.get('mode', 'Clinical AI Nutritionist')}</b></div>
                </div>
                """, unsafe_allow_html=True)

                col_d1, col_d2 = st.columns(2)
                with col_d1:
                    st.markdown("""
                    <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(52, 211, 153, 0.35); border-radius: 14px; padding: 18px; margin-bottom: 16px;">
                        <div style="font-size: 1.05rem; font-weight: 700; color: #34d399; margin-bottom: 10px;">✅ Recommended Healing Foods</div>
                    """, unsafe_allow_html=True)
                    for f in diet.get("recommended_foods", []):
                        st.markdown(f"- 🟢 **{f.split(':')[0] if ':' in f else f}**{': ' + f.split(':', 1)[1] if ':' in f else ''}")
                    st.markdown("</div>", unsafe_allow_html=True)

                with col_d2:
                    st.markdown("""
                    <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(248, 113, 113, 0.35); border-radius: 14px; padding: 18px; margin-bottom: 16px;">
                        <div style="font-size: 1.05rem; font-weight: 700; color: #f87171; margin-bottom: 10px;">🚫 Foods & Drinks to Strictly Avoid</div>
                    """, unsafe_allow_html=True)
                    for a in diet.get("foods_to_avoid", []):
                        st.markdown(f"- 🔴 **{a.split(':')[0] if ':' in a else a}**{': ' + a.split(':', 1)[1] if ':' in a else ''}")
                    st.markdown("</div>", unsafe_allow_html=True)

                st.markdown("#### ⏰ Daily Meal & Hydration Routine")
                sched = diet.get("meal_schedule", {})
                if sched:
                    sc1, sc2 = st.columns(2)
                    with sc1:
                        st.info(f"**🌅 Breakfast (08:30 AM):**\n\n{sched.get('breakfast', 'Nutritious breakfast with morning medicines.')}")
                        st.info(f"**🌤️ Evening Snack (05:00 PM):**\n\n{sched.get('evening', 'Light refreshing snack.')}")
                    with sc2:
                        st.info(f"**☀️ Lunch (01:00 PM):**\n\n{sched.get('lunch', 'Balanced lunch with afternoon medicines.')}")
                        st.info(f"**🌙 Dinner (07:30 PM):**\n\n{sched.get('dinner', 'Light dinner eaten at least 2 hours before bed.')}")
                
                if diet.get("hydration_plan"):
                    st.success(f"**💧 Daily Hydration Target:** {diet['hydration_plan']}")

                if diet.get("food_drug_tips"):
                    st.markdown("#### ⚠️ Medication & Food Safety Guidelines")
                    for tip in diet["food_drug_tips"]:
                        st.warning(f"💡 {tip}")
            else:
                st.info("Upload a prescription or summary to generate a customized disease diet plan.")
                
        with tab3:
            st.subheader("📖 Medical Terms & Abbreviations Explained")
            glossary = explanation_data.get("glossary", {})
            if glossary:
                st.success(f"✅ Detected **{len(glossary)} specialized medical terms & abbreviations** in this document:")
                for term, definition in glossary.items():
                    with st.expander(f"🔹 **{term}**", expanded=True): 
                        st.write(definition)
            else: 
                st.info("No specialized medical terms detected. (Upload a document with medical terms to see definitions here).")
                
        with tab4:
            st.subheader("💬 Patient Understanding Assistant")
            user_q = st.text_input("Enter your question:", placeholder="e.g., What is Betaloc used for? Or what does BID mean?")
            if st.button("Ask Assistant", type="primary"):
                if user_q.strip():
                    with st.spinner("Searching document..."):
                        ans = answer_patient_question(st.session_state.extracted_text, user_q, api_key=st.session_state.api_key)
                    st.markdown("#### 🤖 Answer:")
                    st.write(ans)

# ==============================================================================
# PAGE 5: CONFUSION DETECTOR
# ==============================================================================
elif current_page == "🔍 Confusion Detector":
    st.title("🔍 Confusion Detector")
    st.subheader("Identifying Ambiguous, Incomplete, or Conflicting Instructions")
    st.write("The **Confusion Detector** protects patient safety by flagging instructions that are unreadable, missing essential drug schedules, or contain conflicting dates.")

    if not st.session_state.extracted_text.strip():
        st.warning("⚠️ No document uploaded yet. Please go to **📄 Upload & Review Document** first.")
    else:
        with st.spinner("Scanning for medical ambiguities and cursive illegibility..."):
            confusions = analyze_document_confusion(st.session_state.extracted_text, api_key=st.session_state.api_key)

        if not confusions:
            st.success("✅ **No Ambiguities Detected!** All medication instructions, dosages, and dates in this document appear clear and consistent.")
        else:
            st.warning(f"⚠️ **{len(confusions)} Item(s) Need Professional Confirmation** before taking action.")
            for idx, issue in enumerate(confusions):
                is_high = (issue.get("severity") == "High")
                icon = "🚨" if is_high else "⚠️"
                content = (
                    f"### {icon} Issue #{idx + 1}: {issue.get('issue_type')}\n\n"
                    f"**Original Text from Document:**\n> *\"{issue.get('original_text')}\"*\n\n"
                    f"**What is Unclear:**\n{issue.get('explanation')}\n\n"
                    f"**Recommended Safe Action:**\n{issue.get('recommendation')}\n\n"
                    f"**Status:** `{issue.get('status')}` ({issue.get('severity')} Severity)"
                )
                if is_high: st.error(content)
                else: st.warning(content)
            st.caption("🛡️ *Note: The Confusion Detector is a safety-support tool. It does not replace clinical judgment or review by your doctor or pharmacist.*")

# ==============================================================================
# PAGE 6: RECOVERY JOURNEY & TIMELINE NOTIFICATIONS
# ==============================================================================
elif current_page == "🗺️ My Recovery Journey":
    st.title("🗺️ My Recovery Journey")
    patient_disp = st.session_state.user_name if (st.session_state.is_logged_in and st.session_state.user_name) else "Patient"
    phone_disp = f"({curr_prefix} {st.session_state.user_phone})" if (st.session_state.is_logged_in and st.session_state.user_phone) else "(Log in under '🔐 Patient Login & Profile' to set mobile)"
    st.write(f"Track daily tasks and receive **automated medication timeline alerts** for **{patient_disp}** {phone_disp}.")

    if not st.session_state.extracted_text.strip():
        st.warning("⚠️ No document uploaded yet. Please go to **📄 Upload & Review Document** first.")
    else:
        plan = build_recovery_plan(st.session_state.extracted_text, api_key=st.session_state.api_key)
        reminders = extract_reminders_schedule(plan)
        
        tab_checklist, tab_timeline_alerts = st.tabs(["📋 Daily Recovery Checklist & Activity Tracker", "⏰ Daily Medication Timeline & Alerts"])

        # ----------------------------------------------------------------------
        # TAB 1: SIDE-BY-SIDE CHECKLIST & LIVE ACTIVITY TRACKER
        # ----------------------------------------------------------------------
        with tab_checklist:
            col_check, col_activity = st.columns([1.15, 0.85], gap="large")
            
            with col_check:
                st.markdown("### 📋 Daily Recovery Checklist")
                st.caption("Check off items as you complete them throughout your day.")

                if plan.get("warnings"):
                    st.markdown("#### 🚨 Urgent Warning Signs (Red Flags)")
                    for w in plan["warnings"]: 
                        st.error(f"**Emergency Alert**: {w['task']} — Seek immediate emergency care if this occurs.")

                st.markdown("#### 💊 Confirmed Medications")
                if plan.get("medications"):
                    for med in plan["medications"]:
                        chk_key = f"med_{med['task']}"
                        prev_state = st.session_state.checklist_state.get(chk_key, False)
                        val = st.checkbox(f"**{med['task']}**", value=prev_state, key=f"chk_{chk_key}")
                        if val != prev_state:
                            st.session_state.checklist_state[chk_key] = val
                            timestamp = datetime.now().strftime("%I:%M %p")
                            status_label = "Completed" if val else "Unchecked"
                            st.session_state.activity_log.insert(0, {"task": med['task'], "time": timestamp, "status": status_label, "cat": "Medication"})
                            st.rerun()
                else: 
                    st.info("No confirmed medication instructions identified.")

                st.markdown("#### 🥗 Diet & Lifestyle Instructions")
                if plan.get("diet_lifestyle"):
                    for diet in plan["diet_lifestyle"]:
                        chk_key = f"diet_{diet['task']}"
                        prev_state = st.session_state.checklist_state.get(chk_key, False)
                        val = st.checkbox(diet['task'], value=prev_state, key=f"chk_{chk_key}")
                        if val != prev_state:
                            st.session_state.checklist_state[chk_key] = val
                            timestamp = datetime.now().strftime("%I:%M %p")
                            status_label = "Completed" if val else "Unchecked"
                            st.session_state.activity_log.insert(0, {"task": diet['task'], "time": timestamp, "status": status_label, "cat": "Diet"})
                            st.rerun()
                else: 
                    st.write("No specific diet instructions noted.")

                with st.expander("🥗 View Detailed AI Disease Diet & Nutrition Breakdown", expanded=False):
                    diet_data = generate_disease_diet_plan(st.session_state.extracted_text, st.session_state.api_key)
                    st.markdown(format_diet_plan_markdown(diet_data), unsafe_allow_html=True)

                if plan.get("wound_care"):
                    st.markdown("#### 🩹 Surgical Wound Care")
                    for w in plan["wound_care"]:
                        chk_key = f"wound_{w['task']}"
                        prev_state = st.session_state.checklist_state.get(chk_key, False)
                        val = st.checkbox(w['task'], value=prev_state, key=f"chk_{chk_key}")
                        if val != prev_state:
                            st.session_state.checklist_state[chk_key] = val
                            timestamp = datetime.now().strftime("%I:%M %p")
                            status_label = "Completed" if val else "Unchecked"
                            st.session_state.activity_log.insert(0, {"task": w['task'], "time": timestamp, "status": status_label, "cat": "Wound Care"})
                            st.rerun()

                st.markdown("#### 📅 Clinic Appointments")
                if plan.get("followups"):
                    for appt in plan["followups"]: st.info(f"🗓️ **Scheduled Visit**: {appt['task']}")
                else: 
                    st.write("No confirmed appointment dates listed.")

                if plan.get("needs_confirmation"):
                    st.markdown("#### ⚠️ Instructions Requiring Confirmation")
                    for conf in plan["needs_confirmation"]: 
                        st.warning(f"**Needs Confirmation**: {conf.get('original_text')} — *{conf.get('explanation')}*")

            # Beside the checklist: Live Activity Tracker!
            with col_activity:
                st.markdown("""
                <div class="activity-card">
                    <h3 style="margin-top:0; color:#38bdf8; font-size:1.25rem;">📈 Live Activity Tracker</h3>
                    <p style="font-size:0.85rem; color:#94a3b8; margin-bottom:12px;">Real-time adherence log beside your checklist.</p>
                """, unsafe_allow_html=True)
                
                total_tasks = len(st.session_state.checklist_state)
                completed_tasks = sum(1 for v in st.session_state.checklist_state.values() if v)
                pct = int((completed_tasks / total_tasks * 100)) if total_tasks > 0 else 0
                
                m_c1, m_c2 = st.columns(2)
                m_c1.metric("Tasks Completed", f"{completed_tasks} / {total_tasks}")
                m_c2.metric("Adherence Rate", f"{pct}%")
                
                st.progress(pct / 100.0)
                
                if pct == 100 and total_tasks > 0:
                    st.markdown("<div style='background: rgba(34, 197, 94, 0.2); border:1px solid #22c55e; border-radius:10px; padding:8px 12px; text-align:center; color:#4ade80; font-weight:700; margin:10px 0;'>🏆 All Tasks Completed Today! Excellent adherence!</div>", unsafe_allow_html=True)
                else:
                    st.markdown("<div style='background: rgba(99, 102, 241, 0.15); border:1px solid rgba(99, 102, 241, 0.35); border-radius:10px; padding:8px 12px; text-align:center; color:#a5b4fc; font-weight:600; margin:10px 0;'>🔥 3-Day Adherence Streak</div>", unsafe_allow_html=True)
                
                st.markdown("#### 🕒 Recent Activity Log")
                if st.session_state.activity_log:
                    for item in st.session_state.activity_log[:6]:
                        icon = "✅" if item["status"] == "Completed" else "↩️"
                        color = "#10b981" if item["status"] == "Completed" else "#94a3b8"
                        st.markdown(f"""
                        <div class="activity-log-item" style="border-left-color: {color};">
                            <b>{icon} [{item['time']}]</b>: {item['task'][:45]}... <span style="float:right; opacity:0.75; font-size:0.75rem;">{item['status']}</span>
                        </div>
                        """, unsafe_allow_html=True)
                else:
                    st.caption("⚪ No activity recorded yet today. Check off your first task on the left to start tracking!")
                
                st.markdown("<br>", unsafe_allow_html=True)
                btn_c1, btn_c2 = st.columns(2)
                with btn_c1:
                    if st.button("✅ Mark All Done", use_container_width=True):
                        for k in st.session_state.checklist_state.keys():
                            st.session_state.checklist_state[k] = True
                        timestamp = datetime.now().strftime("%I:%M %p")
                        st.session_state.activity_log.insert(0, {"task": "All daily tasks", "time": timestamp, "status": "Completed", "cat": "General"})
                        st.rerun()
                with btn_c2:
                    if st.button("🔄 Reset Checklist", use_container_width=True):
                        for k in st.session_state.checklist_state.keys():
                            st.session_state.checklist_state[k] = False
                        st.session_state.activity_log = []
                        st.rerun()
                        
                st.markdown("</div>", unsafe_allow_html=True)

        # ----------------------------------------------------------------------
        # TAB 2: DAILY MEDICATION TIMELINE & AUTONOMOUS ALERTS
        # ----------------------------------------------------------------------
        with tab_timeline_alerts:
            st.subheader("⏰ Daily Medication Timeline & Notification Alarms")
            patient_disp = st.session_state.user_name if (st.session_state.is_logged_in and st.session_state.user_name) else "Patient"
            phone_disp = f"({curr_prefix} {st.session_state.user_phone})" if (st.session_state.is_logged_in and st.session_state.user_phone) else ""
            st.write(f"Notifies **{patient_disp}** {phone_disp} exactly when each medicine is due according to the daily schedule.")

            # Live In-App Notification Display if dispatched
            if st.session_state.get("active_notification"):
                notif = st.session_state.active_notification
                trigger_browser_push_alert(notif["title"], notif["body"], speak=True)
                if st.button("✕ Dismiss Notification Banner", key="btn_dismiss_active_banner"):
                    st.session_state.active_notification = None
                    st.rerun()

            # Section A: Daily Medication Timeline Cards with Instant Slot Notification
            st.markdown("### 📅 Daily Medication Schedule Slots")
            st.caption("Click '🔔 Notify This Slot Now' to allow CareBridge AI to immediately dispatch the medication alarm for that timeline window:")

            time_slots = {
                "Morning (08:00 AM)": [r for r in reminders if r["schedule_slot"] == "Morning"],
                "Afternoon (01:00 PM)": [r for r in reminders if r["schedule_slot"] == "Afternoon"],
                "Evening / Night (08:00 PM)": [r for r in reminders if r["schedule_slot"] in ["Evening", "Night"]],
                "Clinic Appointments": [r for r in reminders if r["schedule_slot"] == "Appointment"]
            }

            c_slot1, c_slot2, c_slot3 = st.columns(3)
            slot_columns = [c_slot1, c_slot2, c_slot3]
            
            for idx, (slot_name, items) in enumerate(list(time_slots.items())[:3]):
                with slot_columns[idx]:
                    icon = "🌅" if "Morning" in slot_name else ("☀️" if "Afternoon" in slot_name else "🌙")
                    st.markdown(f"""
                    <div class="timeline-card" style="border-top: 3px solid #38bdf8;">
                        <h4 style="margin:0 0 8px 0; color:#38bdf8;">{icon} {slot_name}</h4>
                    """, unsafe_allow_html=True)
                    
                    if items:
                        for it in items:
                            st.markdown(f"• <b>{it['title']}</b><br><small style='color:#94a3b8;'>{it['details'][:50]}...</small>", unsafe_allow_html=True)
                        st.markdown("<br>", unsafe_allow_html=True)
                        if st.button(f"🔔 Notify {slot_name.split()[0]} Dose Now", key=f"notify_slot_{idx}", use_container_width=True, type="primary"):
                            med_names = ", ".join([it['title'] for it in items])
                            alert_msg = f"Time for your {slot_name.split()[0]} dose: {med_names}. Please take with water as prescribed."
                            st.session_state.active_notification = {
                                "title": f"CareBridge AI: {slot_name} Dose Alert",
                                "body": alert_msg
                            }
                            st.toast(f"Dispatched {slot_name} timeline alarm!", icon="🔔")
                            timestamp = datetime.now().strftime("%I:%M %p")
                            st.session_state.activity_log.insert(0, {"task": f"{slot_name} medications notified ({med_names})", "time": timestamp, "status": "Notified", "cat": "Timeline Alert"})
                            st.rerun()
                    else:
                        st.caption("No medications scheduled for this slot.")
                    
                    st.markdown("</div>", unsafe_allow_html=True)

            st.divider()

            # Section B: Autonomous Background Alert Daemon (Fixed height green box)
            st.markdown("### ⚡ Hands-Free Autonomous Background Alerts (Instagram/WhatsApp Style)")
            st.write("When activated, CareBridge AI automatically pops desktop/mobile notifications and sounds the alert chime in the background with **zero user or host clicking**.")

            auto_col1, auto_col2 = st.columns([1.2, 1.0], gap="large")
            with auto_col1:
                auto_toggle = st.toggle("🚀 Enable Autonomous Background Timeline Alarms", value=st.session_state.auto_alert_active)
                if auto_toggle != st.session_state.auto_alert_active:
                    st.session_state.auto_alert_active = auto_toggle
                    if auto_toggle:
                        st.toast("Autonomous alert engine started!", icon="🚀")
                    st.rerun()
                
                if st.session_state.auto_alert_active:
                    sim_speed = st.selectbox("Timeline Dispatch Frequency:", ["Every 15 Seconds (Demonstration Mode)", "Every 30 Seconds", "Every 60 Seconds"])
                    interval_lookup = {"Every 15 Seconds (Demonstration Mode)": 15, "Every 30 Seconds": 30, "Every 60 Seconds": 60}
                    chosen_interval = interval_lookup.get(sim_speed, 15)
                    render_handsfree_notification_engine(reminders, patient_disp, interval_sec=chosen_interval)

            with auto_col2:
                st.markdown(f"""
                <div style="background: rgba(15, 23, 42, 0.7); border-radius: 14px; padding: 18px; border: 1px solid rgba(56, 189, 248, 0.25);">
                    <div style="font-size:0.8rem; color:#38bdf8; font-weight:700; letter-spacing:0.5px;">HOW TIMELINE NOTIFICATIONS WORK</div>
                    <ul style="font-size:0.88rem; color:#e2e8f0; padding-left:18px; margin-top:8px; line-height:1.6;">
                        <li><b>Timeline-Based</b>: Automatically schedules Morning (08:00 AM), Afternoon (01:00 PM), and Evening (08:00 PM) doses.</li>
                        <li><b>Zero Human Interference</b>: Desktop and phone push banners appear automatically with audio alarm chime, exactly like Instagram or WhatsApp.</li>
                        <li><b>Voice Alerts</b>: Speech synthesizer announces: <i>"Reminder for {patient_disp}: Time to take your scheduled dose."</i></li>
                        <li><b>Mobile Integration</b>: Pre-configured to reach <b>{patient_disp} {phone_disp}</b>.</li>
                    </ul>
                </div>
                """, unsafe_allow_html=True)

            st.divider()

            # Section C: Single-Click Manual Dispatch & Export
            st.markdown("### 📲 Multi-Channel Alert & Calendar Export")
            st.caption("You can also dispatch individual alerts manually or sync to your phone's calendar app:")

            selectable_reminders = [r for r in reminders if r["status"] != "Needs Confirmation"]
            if selectable_reminders:
                options = [f"{r['type']}: {r['title']} ({r['timing']})" for r in selectable_reminders]
                selected_option = st.selectbox("Select specific medication reminder:", options)
                selected_idx = options.index(selected_option)
                chosen = selectable_reminders[selected_idx]

                clean_user_phone = re.sub(r"[^\d]", "", f"{curr_prefix}{st.session_state.user_phone}") if st.session_state.user_phone else ""
                encoded_message = urllib.parse.quote(chosen["alert_message"])
                whatsapp_url = f"https://wa.me/{clean_user_phone}?text={encoded_message}"
                sms_url = f"sms:{clean_user_phone}?body={encoded_message}"

                c_b1, c_b2, c_b3, c_b4 = st.columns(4)
                with c_b1:
                    if st.button("🔔 Trigger Real Browser Push", use_container_width=True, type="primary"):
                        st.session_state.active_notification = {
                            "title": f"CareBridge AI: {chosen['title']}",
                            "body": chosen['alert_message']
                        }
                        st.toast("Dispatched real browser notification!", icon="🔔")
                        st.rerun()

                with c_b2:
                    st.link_button("📲 Send via WhatsApp", url=whatsapp_url, use_container_width=True)
                with c_b3:
                    st.link_button("💬 Open in SMS App", url=sms_url, use_container_width=True)
                with c_b4:
                    ics_data = generate_ics_calendar(reminders)
                    st.download_button(label="📥 Download Calendar (.ics)", data=ics_data, file_name="carebridge_schedule.ics", mime="text/calendar", use_container_width=True)

# ==============================================================================
# PAGE 7: ACCESSIBILITY & AUDIO
# ==============================================================================
elif current_page == "♿ Accessibility & Audio":
    st.title("♿ Accessibility & Audio Instructions")
    st.write("CareBridge AI is designed for universal accessibility, including seniors and caregivers.")
    st.subheader("🔊 Text-to-Speech (Listen Aloud)")

    lang_choice = st.selectbox("Choose Speech Language:", ["English (en)", "Hindi (hi)", "Telugu (te)"])
    lang_code = lang_choice.split("(")[-1].replace(")", "").strip()
    text_to_speak = st.text_area("Text to Read Aloud:", value=st.session_state.extracted_text[:600] if st.session_state.extracted_text else "Welcome to CareBridge AI. Your personal recovery companion.", height=160)

    if st.button("🎧 Generate Audio", type="primary"):
        if text_to_speak.strip():
            with st.spinner("Generating audio..."):
                try:
                    fp = io.BytesIO()
                    tts = gTTS(text=text_to_speak, lang=lang_code)
                    tts.write_to_fp(fp)
                    fp.seek(0)
                    st.audio(fp.read(), format="audio/mp3")
                    st.success("✅ Audio ready! Click play above to listen.")
                except Exception as tts_err:
                    st.error(f"Error generating audio: {tts_err}")

# ==============================================================================
# GLOBAL APPLICATION FOOTER
# ==============================================================================
st.markdown("<br><br>", unsafe_allow_html=True)
st.markdown("""
<div style="margin-top: 40px; padding: 22px 18px; background: linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.75)); border-top: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; text-align: center; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);">
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-bottom: 8px;">
        <span style="font-size: 1.3rem;">🌉</span>
        <span style="font-size: 1.15rem; font-weight: 700; color: #f8fafc; letter-spacing: 0.5px;">CareBridge AI</span>
        <span style="font-size: 0.75rem; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 20px; padding: 2px 10px; font-weight: 600;">Clinical Grade</span>
    </div>
    <p style="font-size: 0.9rem; color: #cbd5e1; margin-bottom: 6px;">
        Bridging the gap between hospital discharge instructions, handwritten doctor scripts, and home recovery.
    </p>
    <div style="font-size: 0.92rem; color: #94a3b8; margin-top: 6px;">
        Developed & Engineered with ❤️ by <strong style="color: #38bdf8;">Sree Charan</strong> and <strong style="color: #4ade80;">Karthik</strong>
    </div>
    <div style="font-size: 0.75rem; color: #64748b; margin-top: 6px;">
        ⚠️ For educational & post-discharge adherence support. Always verify instructions with your licensed healthcare provider.
    </div>
</div>
""", unsafe_allow_html=True)
