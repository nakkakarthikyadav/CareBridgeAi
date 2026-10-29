import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken, authorizePatient, readUsers } from './auth.js';
import { callGemini, parseGeminiJson } from './geminiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const v1Router = express.Router();

// Synchronous JSON file persistence helpers with atomic write semantics
function getStore(filename, defaultData = []) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf-8');
    } catch {}
    return defaultData;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[Store] Could not parse ${filename}, using default:`, err.message);
    return defaultData;
  }
}

function saveStore(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  const tempPath = `${filePath}.tmp_${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    console.error(`[Store] Failed to save store ${filename}:`, err.message);
  }
}

// Global data stores
let patientsStore = getStore('v1_patients.json', []);
let prescriptionsStore = getStore('v1_prescriptions.json', []);
let medsStore = getStore('v1_medications.json', []);
let logsStore = getStore('v1_medication_logs.json', []);
let appointmentsStore = getStore('v1_appointments.json', []);
let recoveryStore = getStore('v1_recovery.json', []);
let notificationsStore = getStore('v1_notifications.json', []);

// Protect all /api/v1 routes with JWT authentication
v1Router.use(authenticateToken);

// -------------------------------------------------------------
// 1. PATIENT PROFILES & CAREGIVERS (Anti-IDOR Enforced)
// -------------------------------------------------------------

// GET /api/v1/patients/:patientId
v1Router.get('/patients/:patientId', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  let patient = patientsStore.find(p => p.id === patientId);

  // If patient profile is not yet initialized in patientsStore, bootstrap from users.json
  if (!patient) {
    const users = readUsers();
    const user = users.find(u => u.id === patientId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Patient profile not found.' });
    }

    patient = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      diagnosis: user.diagnosis || 'Post-Discharge Clinical Recovery',
      dischargeDate: user.dischargeDate || new Date().toISOString().split('T')[0],
      emergencyContact: user.emergencyContact || '',
      caregivers: [],
      allergies: [],
      dietaryRestrictions: [],
      clinicalInstructions: '',
      createdAt: user.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    patientsStore.push(patient);
    saveStore('v1_patients.json', patientsStore);
  }

  res.json({ success: true, data: patient });
});

// PATCH /api/v1/patients/:patientId
v1Router.patch('/patients/:patientId', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const idx = patientsStore.findIndex(p => p.id === patientId);

  if (idx !== -1) {
    const allowedUpdates = [
      'name', 'phone', 'diagnosis', 'dischargeDate', 
      'emergencyContact', 'allergies', 'dietaryRestrictions', 'clinicalInstructions'
    ];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    patientsStore[idx] = { ...patientsStore[idx], ...updates, updatedAt: new Date().toISOString() };
    saveStore('v1_patients.json', patientsStore);
    res.json({ success: true, data: patientsStore[idx] });
  } else {
    // Bootstrap and save
    const newProfile = {
      id: patientId,
      name: req.body.name || req.user.name || 'Patient',
      diagnosis: req.body.diagnosis || 'Post-Discharge Recovery',
      dischargeDate: req.body.dischargeDate || new Date().toISOString().split('T')[0],
      emergencyContact: req.body.emergencyContact || '',
      allergies: req.body.allergies || [],
      dietaryRestrictions: req.body.dietaryRestrictions || [],
      clinicalInstructions: req.body.clinicalInstructions || '',
      caregivers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    patientsStore.push(newProfile);
    saveStore('v1_patients.json', patientsStore);
    res.json({ success: true, data: newProfile });
  }
});

// POST /api/v1/patients/:patientId/caregivers
v1Router.post('/patients/:patientId/caregivers', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const { name, phone, relationship = 'Caregiver', accessLevel = 'FULL_ACCESS' } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Caregiver name is required.' });
  }

  let patient = patientsStore.find(p => p.id === patientId);
  if (!patient) {
    return res.status(404).json({ success: false, error: 'Patient profile not found.' });
  }

  const newCaregiver = {
    id: `cg_${Date.now()}`,
    name: name.trim(),
    phone: phone ? phone.trim() : '',
    relationship,
    accessLevel,
    isApproved: true,
    addedAt: new Date().toISOString()
  };

  if (!patient.caregivers) patient.caregivers = [];
  patient.caregivers.push(newCaregiver);
  saveStore('v1_patients.json', patientsStore);

  res.status(201).json({ success: true, data: newCaregiver });
});

// -------------------------------------------------------------
// 2. PRESCRIPTIONS (Verified Documents & Extractions)
// -------------------------------------------------------------

// GET /api/v1/patients/:patientId/prescriptions
v1Router.get('/patients/:patientId/prescriptions', authorizePatient, (req, res) => {
  const patientPrescriptions = prescriptionsStore.filter(p => p.patientId === req.params.patientId);
  res.json({ success: true, data: patientPrescriptions });
});

// POST /api/v1/patients/:patientId/prescriptions
v1Router.post('/patients/:patientId/prescriptions', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const {
    title, doctor, clinic, date, diagnosis, status = 'Active',
    refill, documentType, imagePreview, medications = [],
    dailyCareChecklist = [], emergencyRedFlags = [], notes,
    verificationStatus = 'VERIFIED',
    humanVerified = true
  } = req.body;

  const newRx = {
    id: `rx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    patientId,
    title: title || 'Clinical Prescription Record',
    doctor: doctor || '',
    clinic: clinic || '',
    date: date || new Date().toISOString().split('T')[0],
    diagnosis: diagnosis || '',
    status,
    refill: refill || '',
    documentType: documentType || 'Digital Prescription',
    imagePreview: imagePreview || null,
    medications,
    dailyCareChecklist,
    emergencyRedFlags,
    notes: notes || '',
    verificationStatus,
    humanVerified: Boolean(humanVerified),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  prescriptionsStore.unshift(newRx);
  saveStore('v1_prescriptions.json', prescriptionsStore);

  // Automatically record verified medications into the patient's active medication list if specified
  if (req.body.syncToActiveMedications && Array.isArray(medications) && medications.length > 0) {
    for (const med of medications) {
      const medEntry = {
        id: `med_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        patientId,
        prescriptionId: newRx.id,
        name: med.name || med.drugName || 'Medication',
        dosage: med.dosage || 'As directed',
        schedule: med.schedule || med.frequency || 'Daily',
        instructions: med.instructions || '',
        critical: Boolean(med.critical || med.caution),
        verificationStatus: 'VERIFIED',
        isActive: true,
        alarmEnabled: true,
        createdAt: new Date().toISOString()
      };
      medsStore.push(medEntry);
    }
    saveStore('v1_medications.json', medsStore);
  }

  res.status(201).json({ success: true, data: newRx });
});

// DELETE /api/v1/patients/:patientId/prescriptions/:prescriptionId
v1Router.delete('/patients/:patientId/prescriptions/:prescriptionId', authorizePatient, (req, res) => {
  const { patientId, prescriptionId } = req.params;
  const initialLen = prescriptionsStore.length;
  prescriptionsStore = prescriptionsStore.filter(p => !(p.id === prescriptionId && p.patientId === patientId));

  if (prescriptionsStore.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Prescription record not found.' });
  }

  saveStore('v1_prescriptions.json', prescriptionsStore);
  res.json({ success: true, message: 'Prescription removed successfully.' });
});

// -------------------------------------------------------------
// 3. MEDICATIONS & DOSE LOGS
// -------------------------------------------------------------

// GET /api/v1/patients/:patientId/medications
v1Router.get('/patients/:patientId/medications', authorizePatient, (req, res) => {
  const patientMeds = medsStore.filter(m => m.patientId === req.params.patientId);
  res.json({ success: true, data: patientMeds });
});

// POST /api/v1/patients/:patientId/medications
v1Router.post('/patients/:patientId/medications', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const { name, dosage, schedule, instructions, critical, time } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Medication name is required.' });
  }

  const newMed = {
    id: `med_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    patientId,
    name: name.trim(),
    dosage: dosage ? dosage.trim() : 'As directed',
    schedule: schedule ? schedule.trim() : 'Daily',
    time: time ? time.trim() : '08:00 AM',
    instructions: instructions ? instructions.trim() : '',
    critical: Boolean(critical),
    verificationStatus: 'VERIFIED',
    isActive: true,
    alarmEnabled: true,
    createdAt: new Date().toISOString()
  };

  medsStore.push(newMed);
  saveStore('v1_medications.json', medsStore);
  res.status(201).json({ success: true, data: newMed });
});

// PATCH /api/v1/patients/:patientId/medications/:medicationId
v1Router.patch('/patients/:patientId/medications/:medicationId', authorizePatient, (req, res) => {
  const { patientId, medicationId } = req.params;
  const idx = medsStore.findIndex(m => m.id === medicationId && m.patientId === patientId);

  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Medication not found.' });
  }

  medsStore[idx] = { ...medsStore[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveStore('v1_medications.json', medsStore);
  res.json({ success: true, data: medsStore[idx] });
});

// DELETE /api/v1/patients/:patientId/medications/:medicationId
v1Router.delete('/patients/:patientId/medications/:medicationId', authorizePatient, (req, res) => {
  const { patientId, medicationId } = req.params;
  const initialLen = medsStore.length;
  medsStore = medsStore.filter(m => !(m.id === medicationId && m.patientId === patientId));

  if (medsStore.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Medication not found.' });
  }

  saveStore('v1_medications.json', medsStore);
  res.json({ success: true, message: 'Medication discontinued/removed.' });
});

// POST /api/v1/patients/:patientId/medications/:medicationId/logs
v1Router.post('/patients/:patientId/medications/:medicationId/logs', authorizePatient, (req, res) => {
  const { patientId, medicationId } = req.params;
  const med = medsStore.find(m => m.id === medicationId && m.patientId === patientId);

  const newLog = {
    id: `log_${Date.now()}`,
    patientId,
    medicationId,
    medicationName: med ? med.name : (req.body.medicationName || 'Medication'),
    dosage: med ? med.dosage : (req.body.dosage || ''),
    status: req.body.status || 'TAKEN', // 'TAKEN' | 'SKIPPED' | 'MISSED'
    notes: req.body.notes || '',
    loggedByRole: req.user.role || 'PATIENT',
    loggedByName: req.user.name || 'Patient',
    loggedAt: new Date().toISOString()
  };

  logsStore.unshift(newLog);
  saveStore('v1_medication_logs.json', logsStore);
  res.status(201).json({ success: true, data: newLog });
});

// GET /api/v1/patients/:patientId/medication-logs
v1Router.get('/patients/:patientId/medication-logs', authorizePatient, (req, res) => {
  const patientLogs = logsStore.filter(l => l.patientId === req.params.patientId);
  res.json({ success: true, data: patientLogs.slice(0, 50) });
});

// -------------------------------------------------------------
// 4. APPOINTMENTS (Anti-IDOR Filtered)
// -------------------------------------------------------------

// GET /api/v1/patients/:patientId/appointments
v1Router.get('/patients/:patientId/appointments', authorizePatient, (req, res) => {
  const patientAppointments = appointmentsStore.filter(a => a.patientId === req.params.patientId);
  res.json({ success: true, data: patientAppointments });
});

// POST /api/v1/patients/:patientId/appointments
v1Router.post('/patients/:patientId/appointments', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const { doctor, clinic, date, time, specialty, prepNotes } = req.body;

  if (!doctor || !date) {
    return res.status(400).json({ success: false, error: 'Doctor name and appointment date are required.' });
  }

  const newApt = {
    id: `apt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    patientId,
    doctor: doctor.trim(),
    clinic: clinic ? clinic.trim() : 'Outpatient Clinic',
    date: date.trim(),
    time: time ? time.trim() : '10:00 AM',
    specialty: specialty ? specialty.trim() : 'Post-Discharge Follow-Up',
    prepNotes: prepNotes ? prepNotes.trim() : 'Bring discharge summary and current medications.',
    status: 'UPCOMING',
    alarmSet: true,
    createdAt: new Date().toISOString()
  };

  appointmentsStore.unshift(newApt);
  saveStore('v1_appointments.json', appointmentsStore);
  res.status(201).json({ success: true, data: newApt });
});

// PATCH /api/v1/patients/:patientId/appointments/:appointmentId
v1Router.patch('/patients/:patientId/appointments/:appointmentId', authorizePatient, (req, res) => {
  const { patientId, appointmentId } = req.params;
  const idx = appointmentsStore.findIndex(a => a.id === appointmentId && a.patientId === patientId);

  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Appointment not found.' });
  }

  appointmentsStore[idx] = { ...appointmentsStore[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveStore('v1_appointments.json', appointmentsStore);
  res.json({ success: true, data: appointmentsStore[idx] });
});

// DELETE /api/v1/patients/:patientId/appointments/:appointmentId
v1Router.delete('/patients/:patientId/appointments/:appointmentId', authorizePatient, (req, res) => {
  const { patientId, appointmentId } = req.params;
  const initialLen = appointmentsStore.length;
  appointmentsStore = appointmentsStore.filter(a => !(a.id === appointmentId && a.patientId === patientId));

  if (appointmentsStore.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Appointment not found.' });
  }

  saveStore('v1_appointments.json', appointmentsStore);
  res.json({ success: true, message: 'Appointment cancelled/removed.' });
});

// -------------------------------------------------------------
// 5. RECOVERY OBSERVATIONS & CLINICAL VITALS
// -------------------------------------------------------------

// GET /api/v1/patients/:patientId/recovery
v1Router.get('/patients/:patientId/recovery', authorizePatient, (req, res) => {
  const patientVitals = recoveryStore.filter(r => r.patientId === req.params.patientId);
  res.json({ success: true, data: patientVitals });
});

// POST /api/v1/patients/:patientId/recovery
v1Router.post('/patients/:patientId/recovery', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const { painLevel = 0, temperature = 98.6, systolicBp = 120, diastolicBp = 80, energyScore = 4, sleepQuality = 4, woundStatus = 'Clean & Healing', notes = '' } = req.body;

  const tempNum = parseFloat(temperature);
  const painNum = parseInt(painLevel, 10);
  const sysNum = parseInt(systolicBp, 10);
  const diaNum = parseInt(diastolicBp, 10);

  // Validate ranges
  if (!isNaN(tempNum) && (tempNum < 90 || tempNum > 110)) {
    return res.status(400).json({ success: false, error: 'Temperature must be between 90°F and 110°F.' });
  }
  if (!isNaN(painNum) && (painNum < 0 || painNum > 10)) {
    return res.status(400).json({ success: false, error: 'Pain score must be between 0 and 10.' });
  }

  // Clinical Red Flag rules: Fever >= 100.4°F, Severe pain >= 8, or Hypertensive crisis
  const hasFever = !isNaN(tempNum) && tempNum >= 100.4;
  const hasSeverePain = !isNaN(painNum) && painNum >= 8;
  const hasCriticalBp = (!isNaN(sysNum) && sysNum >= 180) || (!isNaN(diaNum) && diaNum >= 120);
  const hasRedFlag = hasFever || hasSeverePain || hasCriticalBp;

  const newEntry = {
    id: `rec_${Date.now()}`,
    patientId,
    entryDate: new Date().toISOString(),
    painLevel: painNum,
    temperature: tempNum,
    systolicBp: sysNum,
    diastolicBp: diaNum,
    energyScore: parseInt(energyScore, 10) || 4,
    sleepQuality: parseInt(sleepQuality, 10) || 4,
    woundStatus: woundStatus.trim(),
    notes: notes ? notes.trim() : '',
    hasRedFlag,
    redFlagReason: hasRedFlag
      ? [hasFever && 'Fever >= 100.4°F', hasSeverePain && 'Severe pain >= 8/10', hasCriticalBp && 'Critical Blood Pressure'].filter(Boolean).join(', ')
      : null,
    loggedBy: req.user.name || 'Patient'
  };

  recoveryStore.unshift(newEntry);
  saveStore('v1_recovery.json', recoveryStore);
  res.status(201).json({ success: true, data: newEntry });
});

// GET /api/v1/patients/:patientId/recovery/summary (Computed from actual data)
v1Router.get('/patients/:patientId/recovery/summary', authorizePatient, (req, res) => {
  const { patientId } = req.params;
  const patientLogs = recoveryStore.filter(r => r.patientId === patientId);
  const patientDoseLogs = logsStore.filter(l => l.patientId === patientId);

  const totalEntries = patientLogs.length;
  const avgPain = totalEntries > 0
    ? (patientLogs.reduce((acc, r) => acc + (Number(r.painLevel) || 0), 0) / totalEntries).toFixed(1)
    : '0.0';

  // Calculate actual adherence rate from patient dose logs
  const totalDoses = patientDoseLogs.length;
  const takenDoses = patientDoseLogs.filter(d => d.status === 'TAKEN').length;
  const adherenceRate = totalDoses > 0 ? Math.round((takenDoses / totalDoses) * 100) : 100;

  // Calculate recovery day from patient discharge date
  const patient = patientsStore.find(p => p.id === patientId);
  let currentRecoveryDay = 1;
  if (patient && patient.dischargeDate) {
    const diffMs = Date.now() - new Date(patient.dischargeDate).getTime();
    currentRecoveryDay = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
  }

  const redFlagsCount = patientLogs.filter(r => r.hasRedFlag).length;

  res.json({
    success: true,
    data: {
      currentRecoveryDay: Math.min(currentRecoveryDay, 30),
      totalProtocolDays: 14,
      recoveryPercent: Math.min(100, Math.round((currentRecoveryDay / 14) * 100)),
      averagePainScore: avgPain,
      adherenceRate,
      recentRedFlagsCount: redFlagsCount,
      totalObservations: totalEntries
    }
  });
});

// -------------------------------------------------------------
// 6. NOTIFICATIONS
// -------------------------------------------------------------

// GET /api/v1/patients/:patientId/notifications
v1Router.get('/patients/:patientId/notifications', authorizePatient, (req, res) => {
  const patientNotifs = notificationsStore.filter(n => n.patientId === req.params.patientId || !n.patientId);
  res.json({ success: true, data: patientNotifs });
});

// PATCH /api/v1/patients/:patientId/notifications/:notificationId/read
v1Router.patch('/patients/:patientId/notifications/:notificationId/read', authorizePatient, (req, res) => {
  const { notificationId } = req.params;
  notificationsStore = notificationsStore.map(n =>
    n.id === notificationId ? { ...n, isRead: true } : n
  );
  saveStore('v1_notifications.json', notificationsStore);
  res.json({ success: true, message: 'Notification marked as read.' });
});

// -------------------------------------------------------------
// 7. LIVE AI ASSISTANT ENDPOINTS (Powered by Gemini Service)
// -------------------------------------------------------------

// POST /api/v1/ai/explain-instructions
v1Router.post('/ai/explain-instructions', async (req, res) => {
  const { text, language = 'English' } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Text instructions are required to explain.' });
  }

  const systemPrompt = `You are CareBridge AI's Clinical Medical Communication Assistant.
Your goal is to explain complex discharge instructions and medical terminology in simple, reassuring, crystal-clear language.
Never change medication doses or instruct patients to alter treatments. Always maintain medical accuracy.
Target Language: ${language}.`;

  const userPrompt = `Please simplify and explain these discharge instructions:
"""
${text}
"""

Return valid JSON with these keys:
{
  "simplifiedSummary": "2-3 sentences plain language summary",
  "keySafetyPoints": ["Key action or precaution 1", "Key action or precaution 2"],
  "medicalTermsExplained": [
    {"term": "Medical term used", "plainMeaning": "What it means for the patient"}
  ],
  "disclaimer": "Educational AI explanation based on clinical instructions. Always confirm with your physician or care team."
}
Return only JSON without markdown fences.`;

  try {
    const aiResult = await callGemini(userPrompt, systemPrompt);
    const parsed = parseGeminiJson(aiResult.text);
    return res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.warn('[AI Explain] Gemini unavailable:', error.message);
    // Provide safe structured fallback clearly marked as baseline guidance
    return res.json({
      success: true,
      fallbackUsed: true,
      data: {
        simplifiedSummary: `Follow your written discharge instructions carefully. Ensure morning and evening doses are taken with plenty of water as directed.`,
        keySafetyPoints: [
          'Take prescribed medications at scheduled times without missing doses',
          'Do not stop or alter dosages without consulting your physician',
          'Watch for warning symptoms like fever or sudden pain escalation'
        ],
        medicalTermsExplained: [],
        disclaimer: 'Standard clinical guidance. Always confirm instructions with your primary physician.'
      },
      diagnostic: {
        errorCategory: error.code || 'AI_SERVICE_UNAVAILABLE',
        message: 'Live AI enhancement unavailable; standard clinical baseline displayed.'
      }
    });
  }
});

// POST /api/v1/ai/dietary-guidance
v1Router.post('/ai/dietary-guidance', async (req, res) => {
  const { condition, dietaryPreference = 'No restriction', allergies = 'None', language = 'English' } = req.body;

  const systemPrompt = `You are CareBridge AI's Clinical Nutrition & Diet Navigator.
Provide safe, evidence-based nutritional recommendations tailored to the patient's recovery phase and dietary restrictions.
Respect allergies strictly. Language requested: ${language}.`;

  const userPrompt = `Create a clinical dietary guide:
Condition: ${condition || 'Post-operative recovery'}
Dietary Preference: ${dietaryPreference}
Known Allergies: ${allergies}

Return valid JSON with:
{
  "condition": "${condition || 'Post-operative recovery'}",
  "dietaryRationale": "How this nutritional approach supports tissue healing and reduces inflammation",
  "recommendedFoods": [
    {"food": "Food name", "benefit": "Specific biological recovery mechanism"}
  ],
  "foodsToAvoid": [
    {"food": "Food name", "reason": "Why it harms recovery or interacts with medications"}
  ],
  "hydrationTarget": "Daily fluid intake recommendation"
}
Return only JSON without markdown fences.`;

  try {
    const aiResult = await callGemini(userPrompt, systemPrompt);
    const parsed = parseGeminiJson(aiResult.text);
    return res.json({
      success: true,
      data: parsed || { rawText: aiResult.text },
      meta: aiResult.meta
    });
  } catch (error) {
    console.warn('[AI Diet] Gemini unavailable:', error.message);
    return res.json({
      success: true,
      fallbackUsed: true,
      data: {
        condition: condition || 'Post-Discharge Recovery',
        dietaryRationale: 'High-protein, moderate-sodium hydration diet to assist tissue healing.',
        recommendedFoods: [
          { food: 'Steamed vegetables and lean proteins', benefit: 'Provides essential amino acids and micronutrients for healing.' },
          { food: 'Fresh seasonal fruits & tender coconut water', benefit: 'Rebalances electrolytes and enzymatic recovery.' }
        ],
        foodsToAvoid: [
          { food: 'Deep-fried snacks & processed foods', reason: 'High saturated fats increase arterial inflammation.' },
          { food: 'Excess sodium & heavy pickles', reason: 'Excess sodium causes fluid retention and blood pressure spikes.' }
        ],
        hydrationTarget: '2.0 to 2.5 Liters of water daily unless restricted by cardiac/renal protocol.'
      },
      diagnostic: {
        errorCategory: error.code || 'AI_SERVICE_UNAVAILABLE',
        message: 'Live AI enhancement unavailable; standard clinical baseline displayed.'
      }
    });
  }
});

export default v1Router;
