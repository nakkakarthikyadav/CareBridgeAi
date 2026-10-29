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
  handleUpdateProfile,
  authRateLimiter,
  authenticateToken
} from './auth.js';
import v1Router from './api_v1.js';
import { callGemini, parseGeminiJson } from './geminiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from parent directory or current directory
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check Endpoint for Render / Deployment monitoring
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'CareBridge AI Post-Discharge Clinical Platform',
    version: '1.0.0',
    aiIntegration: {
      provider: 'Google Gemini',
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here')
    }
  });
});

// Mount /api/v1 REST API (Protected by JWT auth & anti-IDOR authorization)
app.use('/api/v1', v1Router);

// Multer memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf'];
    if (allowedMime.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Please upload a JPEG, PNG, WEBP image or PDF document.'));
    }
  }
});

// Authentication & Patient Identity Routes (with Rate Limiting)
app.post('/api/auth/register', authRateLimiter, handleRegister);
app.post('/api/auth/login', authRateLimiter, handleLogin);
app.post('/api/auth/google', authRateLimiter, handleGoogleAuth);
app.get('/api/auth/me', authenticateToken, handleGetMe);
app.put('/api/auth/profile', authenticateToken, handleUpdateProfile);

// 1. Handwritten Prescription Recognition (OCR + Clinical Extraction)
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
Your task is to accurately transcribe medical handwriting from the prescription image into clear digital text.
Extract only the text that is genuinely visible on the image. Do NOT invent missing medications, clinics, or physician names.
Identify any abbreviations (e.g. Rx, tid, bid, od, sos, po, hs) and clearly flag any ambiguous, smudged, or uncertain handwriting.`;

    const userPrompt = `Analyze this handwritten prescription image.
Perform line-level and word-level recognition.

Return a valid JSON response with the following format:
{
  "detectedDoctor": "Doctor name and credentials if visible, or null",
  "detectedClinic": "Clinic or hospital header name if visible, or null",
  "prescriptionDate": "Date on prescription if visible, or null",
  "patientName": "Patient name and age if visible, or null",
  "rawHandwrittenLines": [
    "Exact verbatim line transcribed from handwriting"
  ],
  "normalizedDigitalText": "Clean, polished normal typed text",
  "medicationsList": [
    {
      "drugName": "Medication brand / generic name",
      "dosage": "Dosage (e.g. 500mg, or 'As directed' if not legible)",
      "frequency": "Frequency in plain English (e.g. Twice daily)",
      "duration": "Duration if stated",
      "instructions": "Directions for use",
      "caution": "Special precautions or warnings"
    }
  ],
  "abbreviationsExpanded": [
    {"abbreviation": "tid", "meaning": "Three times a day"}
  ],
  "ambiguousOrUnclearFields": [
    "List of any specific words, numbers, or dosages that are unclear and require patient or pharmacist confirmation"
  ],
  "verificationRequired": true
}
Return only JSON without markdown fences.`;

    const aiResult = await callGemini(userPrompt, systemPrompt, fileData);
    const parsed = parseGeminiJson(aiResult.text);

    res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.error('Handwritten OCR error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'OCR_PROCESSING_FAILED'
    });
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

    if (!fileData && (!textContent || !textContent.trim())) {
      return res.status(400).json({ success: false, error: 'Please provide either a document file or document text to analyze.' });
    }

    const systemPrompt = `You are CareBridge AI, a clinical medical communication assistant.
Your job is to read and transcribe the provided medical document or prescription image with 100% fidelity.
CRITICAL CLINICAL INSTRUCTION:
- Extract ONLY the medications, dosages, routes, and instructions that are ACTUALLY WRITTEN or PRINTED on the attached document.
- NEVER invent, hallucinate, or default to generic medications (such as Aspirin, Lisinopril, Metoprolol, or Amoxicillin) unless they are genuinely written in this specific document.
- If the document contains 1 medication, return only that 1 medication. If it contains 3, return exactly those 3. If no medications are found, return an empty array [].
Language requested: ${language}.`;

    const userPrompt = `Analyze the attached medical document (${docType}):
${textContent ? `DOCUMENT CONTENT:\n${textContent}\n` : 'Carefully read the attached image/file.'}

Extract the exact clinical details into this JSON format:
{
  "summary": "2-3 sentences plain language summary based strictly on this document",
  "keyDiagnoses": ["diagnosis if mentioned in document"],
  "medications": [
    {
      "name": "Exact Medication Name & Dosage written on document",
      "purpose": "Plain English purpose",
      "schedule": "Schedule written (e.g., Morning, Twice daily, Bedtime)",
      "instructions": "Exact instructions written",
      "criticalWarning": "Warning if relevant"
    }
  ],
  "dailyCareChecklist": ["Specific care instructions written in document"],
  "dietaryRestrictions": ["Dietary restrictions explicitly mentioned"],
  "emergencyRedFlags": ["Red flag warning symptoms mentioned"],
  "followUpAppointment": "Follow-up date/timeframe if mentioned, or null",
  "questionsForDoctor": ["Relevant questions for physician based on this document"],
  "detectedDoctor": "Doctor name if written, or null",
  "detectedClinic": "Clinic/hospital name if written, or null"
}
Return only JSON without markdown fences.`;

    const aiResult = await callGemini(userPrompt, systemPrompt, fileData);
    const parsed = parseGeminiJson(aiResult.text);

    res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.error('Error analyzing document:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'DOCUMENT_ANALYSIS_FAILED'
    });
  }
});

// 3. Confusion Detector (LASA - Look Alike Sound Alike / Contraindications)
app.post('/api/confusion-check', async (req, res) => {
  try {
    const { query, currentMedications = [], patientConditions = [] } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, error: 'Query or medication name is required.' });
    }

    const systemPrompt = `You are CareBridge AI's Clinical Confusion Safety Guard.
Your primary role is to detect Look-Alike / Sound-Alike (LASA) drug confusions (e.g., Hydralazine vs Hydroxyzine, Metoprolol Tartrate vs Succinate, Celebrex vs Celexa),
drug-drug interactions, dose unit mix-ups (mg vs mcg), and disease contraindications.
Provide safe, educational guidance and emphasize consulting a licensed pharmacist or physician.`;

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

    const aiResult = await callGemini(userPrompt, systemPrompt);
    const parsed = parseGeminiJson(aiResult.text);

    res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.error('Confusion check error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'CONFUSION_CHECK_FAILED'
    });
  }
});

// 4. Clinical Recovery Plan & Daily Timeline
app.post('/api/recovery-plan', async (req, res) => {
  try {
    const { condition, dischargeDate, medications = [], limitations = '' } = req.body;

    const systemPrompt = `You are CareBridge AI's Post-Discharge Recovery Navigator.
Formulate an evidence-based recovery timeline for the first 14 days post-discharge based strictly on the provided medical condition and medications.`;

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
    { "time": "09:00 AM", "activity": "Nutritious Breakfast & Hydration", "icon": "nutrition", "category": "diet" },
    { "time": "11:30 AM", "activity": "Gentle mobilization / short walk as tolerated", "icon": "walk", "category": "mobility" },
    { "time": "01:00 PM", "activity": "Light Lunch + Midday dose if prescribed", "icon": "pill", "category": "medication" },
    { "time": "04:00 PM", "activity": "Rest & wound inspection / vitals logging", "icon": "check", "category": "vitals" },
    { "time": "07:30 PM", "activity": "Dinner & Evening Medication", "icon": "pill", "category": "medication" },
    { "time": "10:00 PM", "activity": "Bedtime rest & hydration", "icon": "moon", "category": "rest" }
  ],
  "warningSignals": [
    "Fever above 100.4°F (38°C)",
    "Sudden shortness of breath or chest tightness",
    "Uncontrollable nausea or inability to keep medications down"
  ]
}
Return only JSON without markdown fences.`;

    const aiResult = await callGemini(userPrompt, systemPrompt);
    const parsed = parseGeminiJson(aiResult.text);

    res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.error('Recovery plan error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RECOVERY_PLAN_FAILED'
    });
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
  "hydrationGoal": "Hydration target in liters unless restricted by protocol"
}
Return only JSON without markdown fences.`;

    const aiResult = await callGemini(userPrompt, systemPrompt);
    const parsed = parseGeminiJson(aiResult.text);

    res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.error('Diet plan error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'DIET_PLAN_FAILED'
    });
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

// Global Safe Error Handler (Never leaks stack traces)
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]:', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'An unexpected server error occurred.'
  });
});

app.listen(PORT, () => {
  console.log(`CareBridge AI Full-Stack Platform listening on http://localhost:${PORT}`);
});
