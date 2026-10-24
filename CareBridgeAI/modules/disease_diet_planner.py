import re
import os
import json
import requests

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
