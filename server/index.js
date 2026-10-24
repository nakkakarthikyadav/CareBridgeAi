import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  handleRegister,
  handleLogin,
  handleGoogleAuth,
  handleGetMe,
  handleUpdateProfile
} from './auth.js';
import v1Router from './api_v1.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from parent directory or current directory
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Mount /api/v1 REST API
app.use('/api/v1', v1Router);

// Multer memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Helper: Call Gemini REST API directly with fallback models
async function callGemini(prompt, systemInstruction = '', inlineData = null) {
  const models = [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-3.7-flash',
    'gemini-3.8-flash'
  ];

  if (GEMINI_API_KEY && GEMINI_API_KEY.trim() && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        
        const contentsParts = [];
        if (inlineData) {
          contentsParts.push({
            inlineData: {
              mimeType: inlineData.mimeType,
              data: inlineData.base64
            }
          });
        }
        contentsParts.push({ text: prompt });

        const requestBody = {
          contents: [{ role: 'user', parts: contentsParts }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            maxOutputTokens: 2048
          }
        };

        if (systemInstruction) {
          requestBody.systemInstruction = {
            parts: [{ text: systemInstruction }]
          };
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0];
          const text = candidate?.content?.parts?.map(p => p.text).join('') || '';
          if (text) {
            console.log(`[Gemini API] Successfully generated content using model: ${model}`);
            return text;
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          console.warn(`[Gemini API] Model ${model} returned HTTP ${response.status}:`, errData?.error?.message || response.statusText);
        }
      } catch (err) {
        console.warn(`Failed on model ${model}:`, err.message);
      }
    }
  }

  // If Gemini API could not process the request, throw an error instead of returning mock data
  throw new Error("Clinical AI service temporarily unavailable. Please verify your connection or Gemini API key.");
}

// Authentication & Patient Identity Routes
app.post('/api/auth/register', handleRegister);
app.post('/api/auth/login', handleLogin);
app.post('/api/auth/google', handleGoogleAuth);
app.get('/api/auth/me', handleGetMe);
app.put('/api/auth/profile', handleUpdateProfile);


// 1b. Handwritten Prescription Recognition (Automate identification & recognition of handwritten text from image)
app.post('/api/handwritten-ocr', upload.single('prescriptionImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please upload a prescription image to analyze.' });
    }

    const fileData = {
      mimeType: req.file.mimetype,
      base64: req.file.buffer.toString('base64')
    };

    const systemPrompt = `You are an automated Optical Character Recognition (OCR) and Handwritten Text Recognition (HTR) system specializing in physician handwriting identification and transcription, inspired by CRNN-CTC handwriting recognition pipelines.
Your task is to accurately transcribe messy cursive medical handwriting from the prescription image into normal, clear, typed digital text.
You must expand all medical abbreviations (e.g. Rx, tid, bid, od, sos, po, hs) and correct common handwriting misinterpretations using a medical lexicon.`;

    const userPrompt = `Analyze this handwritten prescription image.
Perform automated line-level and word-level recognition.

Return a valid JSON response with the following format:
{
  "detectedDoctor": "Doctor name and credentials detected",
  "detectedClinic": "Clinic or hospital header name",
  "prescriptionDate": "Date on prescription",
  "patientName": "Patient name and age",
  "rawHandwrittenLines": [
    "Exact verbatim line 1 transcribed from handwriting",
    "Exact verbatim line 2 transcribed from handwriting"
  ],
  "normalizedDigitalText": "Clean, polished normal typed text ready to print or email",
  "medicationsList": [
    {
      "drugName": "Medication brand / generic name",
      "dosage": "Dosage (e.g. 500mg)",
      "frequency": "Frequency in plain English (e.g. Three times daily)",
      "duration": "Duration (e.g. 7 days)",
      "instructions": "e.g. Take with water after meals",
      "caution": "Special precautions or warnings"
    }
  ],
  "abbreviationsExpanded": [
    {"abbreviation": "tid", "meaning": "Ter in die (Three times a day)"},
    {"abbreviation": "sos", "meaning": "Si opus sit (If needed for symptoms)"},
    {"abbreviation": "od", "meaning": "Omni die (Once a day)"}
  ],
  "confidenceScore": "96.4%"
}
Return only JSON without markdown fences.`;

    const rawResponse = await callGemini(userPrompt, systemPrompt, fileData);
    let cleaned = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { rawText: rawResponse };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Handwritten OCR error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Document Analysis (Upload & OCR / Translation)
app.post('/api/analyze-document', upload.single('file'), async (req, res) => {
  try {
    const { textContent, language = 'English', docType = 'Discharge Summary' } = req.body;
    let fileData = null;

    if (req.file) {
      fileData = {
        mimeType: req.file.mimetype,
        base64: req.file.buffer.toString('base64')
      };
    }

    const systemPrompt = `You are CareBridge AI, a clinical medical communication assistant designed by Sree Charan & Karthik.
You translate complex hospital discharge documents and handwritten prescriptions into plain, empathetic, crystal-clear instructions for patients and their families.
Always prioritize safety, detect potential medication confusion, highlight red flags, and provide actionable next steps.
Language requested: ${language}.`;

    const userPrompt = `Please analyze this medical document (${docType}):
${textContent ? `DOCUMENT CONTENT:\n${textContent}\n` : 'Document provided as attached image/file.'}

Provide a structured response in clean JSON format with these exact keys:
{
  "summary": "2-3 sentences plain language summary of hospital stay/diagnosis",
  "keyDiagnoses": ["diagnosis 1", "diagnosis 2"],
  "medications": [
    {
      "name": "Medication Name & Dosage",
      "purpose": "Why patient takes it in simple words",
      "schedule": "Exact time of day (Morning, Noon, Night)",
      "instructions": "e.g. With food, avoid milk, do not crush",
      "criticalWarning": "e.g. Do not stop abruptly"
    }
  ],
  "dailyCareChecklist": ["task 1", "task 2", "task 3"],
  "dietaryRestrictions": ["restriction 1", "restriction 2"],
  "emergencyRedFlags": ["Red flag symptom 1 needing ER immediately", "Red flag 2"],
  "followUpAppointment": "Date or timeframe recommended",
  "questionsForDoctor": ["Question 1 patient should ask", "Question 2"]
}
Ensure you return ONLY valid JSON without markdown fences.`;

    const rawResponse = await callGemini(userPrompt, systemPrompt, fileData);
    let cleaned = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { rawText: rawResponse };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Error analyzing document:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Confusion Detector (LASA - Look Alike Sound Alike / Contraindications)
app.post('/api/confusion-check', async (req, res) => {
  try {
    const { query, currentMedications = [], patientConditions = [] } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query or medication name is required.' });
    }

    const systemPrompt = `You are CareBridge AI's Clinical Confusion Safety Guard.
Your primary role is to detect Look-Alike / Sound-Alike (LASA) drug confusions (e.g., Hydralazine vs Hydroxyzine, Metoprolol Tartrate vs Succinate, Celebrex vs Celexa),
drug-drug interactions, dose unit mix-ups (mg vs mcg), and disease contraindications.`;

    const userPrompt = `Patient query / medication to evaluate: "${query}"
Patient's known active medications: ${JSON.stringify(currentMedications)}
Patient's known medical conditions: ${JSON.stringify(patientConditions)}

Respond in valid JSON with:
{
  "riskLevel": "Low" | "Moderate" | "High" | "Critical",
  "lookAlikeDrugs": [
    {
      "name": "Confusing Drug Name",
      "distinction": "How it differs, what it's used for, and why confusing them is dangerous"
    }
  ],
  "safetyAlert": "Clear explanation of warning or reassurance",
  "actionableGuidance": "What the patient/caregiver must check on the box/label right now",
  "questionsToConfirmWithPharmacist": ["Question 1", "Question 2"]
}
Return only JSON without markdown fences.`;

    const rawResponse = await callGemini(userPrompt, systemPrompt);
    let cleaned = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { rawText: rawResponse };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Confusion check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Clinical Recovery Plan & Daily Timeline
app.post('/api/recovery-plan', async (req, res) => {
  try {
    const { condition, dischargeDate, medications = [], limitations = '' } = req.body;

    const systemPrompt = `You are CareBridge AI's Post-Discharge Recovery Navigator.
Formulate a personalized recovery timeline for the first 14 days post-discharge.`;

    const userPrompt = `Patient condition: ${condition || 'General Post-Surgical / Medical Recovery'}
Discharge Date: ${dischargeDate || 'Today'}
Medications: ${JSON.stringify(medications)}
Special limitations: ${limitations || 'None specified'}

Respond in valid JSON:
{
  "recoveryPhases": [
    { "phase": "Days 1-3: Acute Rest & Stabilization", "focus": "Pain management, gentle mobilization, wound vigilance", "milestones": ["milestone 1", "milestone 2"] },
    { "phase": "Days 4-7: Transitional Independence", "focus": "Gradual walking, diet normalization, follow-up scheduling", "milestones": ["milestone 1", "milestone 2"] },
    { "phase": "Days 8-14: Sustained Recovery", "focus": "Stamina recovery, suture check, full medication stabilization", "milestones": ["milestone 1", "milestone 2"] }
  ],
  "dailySchedule": [
    { "time": "08:00 AM", "activity": "Morning Medication & Blood Pressure check", "icon": "pill", "category": "medication" },
    { "time": "09:00 AM", "activity": "High-Protein Breakfast & Hydration (250ml)", "icon": "nutrition", "category": "diet" },
    { "time": "11:30 AM", "activity": "5-minute gentle hall walking with support", "icon": "walk", "category": "mobility" },
    { "time": "01:00 PM", "activity": "Light Lunch + Midday dose (if prescribed)", "icon": "pill", "category": "medication" },
    { "time": "04:00 PM", "activity": "Rest & wound inspection / temperature logging", "icon": "check", "category": "vitals" },
    { "time": "07:30 PM", "activity": "Dinner & Evening Medication", "icon": "pill", "category": "medication" },
    { "time": "10:00 PM", "activity": "Bedtime relaxation & Night vitals check", "icon": "moon", "category": "rest" }
  ],
  "warningSignals": [
    "Fever above 100.4°F (38°C)",
    "Sudden shortness of breath or chest tightness",
    "Uncontrollable nausea or inability to keep medications down"
  ]
}
Return only JSON without markdown fences.`;

    const rawResponse = await callGemini(userPrompt, systemPrompt);
    let cleaned = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { rawText: rawResponse };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Recovery plan error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Condition-Specific Clinical Diet Planner
app.post('/api/diet-plan', async (req, res) => {
  try {
    const { condition, dietaryPreference = 'No restriction', allergies = 'None' } = req.body;

    const systemPrompt = `You are CareBridge AI's Clinical Dietitian & Post-Discharge Nutrition Specialist.`;
    const userPrompt = `Create a clinical dietary plan for:
Condition: ${condition || 'Post-operative recovery'}
Dietary Preference: ${dietaryPreference}
Allergies: ${allergies}

Respond in valid JSON with:
{
  "dietaryRationale": "Why this specific nutritional profile speeds recovery for this condition",
  "foodsToEmphasize": [
    {"food": "Name", "benefit": "Specific biological recovery mechanism"}
  ],
  "foodsToStrictlyAvoid": [
    {"food": "Name", "reason": "Why it harms recovery or interacts with recovery"}
  ],
  "sampleMealPlan": {
    "breakfast": "Meal recommendation",
    "midMorningSnack": "Snack recommendation",
    "lunch": "Lunch recommendation",
    "eveningSnack": "Snack recommendation",
    "dinner": "Dinner recommendation"
  },
  "hydrationGoal": "e.g., 2.5 Liters daily unless contraindicated by heart/kidney protocol"
}
Return only JSON without markdown fences.`;

    const rawResponse = await callGemini(userPrompt, systemPrompt);
    let cleaned = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { rawText: rawResponse };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Diet plan error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve static client assets
const distPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`CareBridge AI Full-Stack Platform listening on http://localhost:${PORT}`);
});
