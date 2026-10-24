/**
 * Utility for extracting hospital phone numbers from prescriptions 
 * and initiating direct phone calls.
 * 
 * If a prescription does not have a phone number, the emergency call 
 * button is removed entirely.
 */

export function cleanPhoneForDial(phoneStr) {
  if (!phoneStr) return '';
  const trimmed = String(phoneStr).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function extractPhoneFromText(text) {
  if (!text || typeof text !== 'string') return '';
  
  // 1. Look for explicit keyword prefixes: Tel, Phone, Ph, Mob, Mobile, Emergency, Contact, Call
  const keywordMatch = text.match(/(?:tel|phone|ph|mob|mobile|emergency|contact|call)[\s.:#-]*([+]?[\d\s().-]{7,18}\d)/i);
  if (keywordMatch && keywordMatch[1]) {
    const cleaned = keywordMatch[1].trim();
    if (cleaned.replace(/\D/g, '').length >= 7) {
      return cleaned;
    }
  }

  // 2. Match standard telephone patterns:
  // e.g. +91 98765 43210, +1 (555) 019-8234, 555-0198, 080-23456789, 9876543210
  const match = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  if (match && match[0].replace(/\D/g, '').length >= 7) {
    return match[0].trim();
  }

  // 3. Match 10-digit mobile number anywhere
  const tenDigit = text.match(/\b[6-9]\d{9}\b/);
  if (tenDigit) {
    return tenDigit[0];
  }

  return '';
}

export function extractHospitalContact(prescriptions = [], userProfile = null) {
  const rxList = Array.isArray(prescriptions) ? prescriptions : [];

  // 1. Check prescriptions list (newest first)
  for (const rx of rxList) {
    if (!rx) continue;

    const hospitalName = rx.hospitalName || rx.clinic || 'Treating Hospital';
    const doctor = rx.doctor || 'Attending Physician';

    // Direct hospitalPhone field on prescription
    if (rx.hospitalPhone && String(rx.hospitalPhone).trim()) {
      const p = String(rx.hospitalPhone).trim();
      return {
        hospitalName,
        doctor,
        phone: p,
        cleanPhone: cleanPhoneForDial(p),
        hasNumber: true,
        source: 'prescription'
      };
    }

    // Try extracting from clinic string, notes, or title
    const textPool = [
      rx.clinic,
      rx.notes,
      rx.title,
      rx.doctor,
      Array.isArray(rx.rawHandwrittenLines) ? rx.rawHandwrittenLines.join(' ') : ''
    ].filter(Boolean).join(' ');

    const extracted = extractPhoneFromText(textPool);
    if (extracted) {
      return {
        hospitalName,
        doctor,
        phone: extracted,
        cleanPhone: cleanPhoneForDial(extracted),
        hasNumber: true,
        source: 'prescription-text'
      };
    }
  }

  // 2. Check localStorage saved hospital emergency number
  try {
    const savedPhone = localStorage.getItem('carebridge_hospital_phone');
    const savedName = localStorage.getItem('carebridge_hospital_name');
    if (savedPhone && savedPhone.trim()) {
      const p = savedPhone.trim();
      return {
        hospitalName: savedName || 'Treating Hospital',
        doctor: 'Attending Physician',
        phone: p,
        cleanPhone: cleanPhoneForDial(p),
        hasNumber: true,
        source: 'saved'
      };
    }
  } catch {}

  // 3. Check userProfile emergency contact if available
  if (userProfile?.emergencyContact && userProfile.emergencyContact.trim()) {
    const p = userProfile.emergencyContact.trim();
    if (p.replace(/\D/g, '').length >= 7) {
      return {
        hospitalName: 'Emergency Hospital Contact',
        doctor: 'Attending Physician',
        phone: p,
        cleanPhone: cleanPhoneForDial(p),
        hasNumber: true,
        source: 'profile'
      };
    }
  }

  // No phone number found in prescription -> hasNumber: false
  return {
    hospitalName: '',
    doctor: '',
    phone: '',
    cleanPhone: '',
    hasNumber: false,
    source: 'none'
  };
}

export function saveHospitalContact(phone, hospitalName = '') {
  if (!phone) return;
  try {
    localStorage.setItem('carebridge_hospital_phone', phone.trim());
    if (hospitalName) {
      localStorage.setItem('carebridge_hospital_name', hospitalName.trim());
    }

    const saved = localStorage.getItem('carebridge_portal_prescriptions');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed[0].hospitalPhone = phone.trim();
        if (hospitalName) parsed[0].hospitalName = hospitalName.trim();
        localStorage.setItem('carebridge_portal_prescriptions', JSON.stringify(parsed));
      }
    }
  } catch (e) {
    console.error('Failed to save hospital contact', e);
  }
}

export function directCallHospital(phone) {
  if (!phone) return false;
  const dial = cleanPhoneForDial(phone);
  if (!dial) return false;

  window.location.href = `tel:${dial}`;
  return true;
}
