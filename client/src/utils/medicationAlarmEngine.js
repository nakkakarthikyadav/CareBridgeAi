/**
 * Real-time In-App Medication Alarm & Notification Engine
 * Monitors the patient's medication schedule and fires synchronized
 * in-app audio chimes, visual alerts, and push notifications when doses are due.
 */

// In-memory set of fired dose keys for the current session
const firedDoses = new Set();

/**
 * Returns formatted time variants for the current minute:
 * e.g., for 4:06 PM: ['04:06pm', '4:06pm', '16:06', '04:06', '4:06', '04:06am', '4:06am']
 */
export function getCurrentTimeVariants(date = new Date()) {
  const h24 = date.getHours();
  const m = date.getMinutes();
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const otherAmpm = ampm === 'pm' ? 'am' : 'pm';
  const h12 = h24 % 12 || 12;

  const mPad = (m < 10 ? '0' : '') + m;
  const h12Pad = (h12 < 10 ? '0' : '') + h12;
  const h24Pad = (h24 < 10 ? '0' : '') + h24;

  return [
    `${h12Pad}:${mPad}${ampm}`,
    `${h12}:${mPad}${ampm}`,
    `${h12Pad}:${mPad} ${ampm}`,
    `${h12}:${mPad} ${ampm}`,
    `${h24Pad}:${mPad}`,
    // Suffix-free 12-hour/24-hour clock variants
    `${h12Pad}:${mPad}`,
    `${h12}:${mPad}`,
    // AM/PM typo tolerance for daytime user testing (e.g., entered 04:06 AM when clock is 4:06 PM)
    `${h12Pad}:${mPad}${otherAmpm}`,
    `${h12}:${mPad}${otherAmpm}`
  ].map(s => s.toLowerCase().replace(/\s+/g, ''));
}

/**
 * Robustly checks if the given medication time or schedule string is due now.
 * Supports:
 * 1. Exact 12-hour AM/PM formats ("04:06 PM")
 * 2. 24-hour military formats ("16:06")
 * 3. Plain times without AM/PM ("04:06", "4:06")
 * 4. User AM/PM typo tolerance (e.g. user set "04:06 AM" while testing at 4:06 PM)
 * 5. 2-minute catch-up window so doses aren't missed if saved seconds before minute changes
 */
export function isDoseDueAtTime(timeString, date = new Date()) {
  if (!timeString || typeof timeString !== 'string') return false;

  const cleanTarget = timeString.toLowerCase().replace(/\s+/g, '');
  const variants = getCurrentTimeVariants(date);

  // Direct substring match with all variants
  if (variants.some(variant => cleanTarget.includes(variant))) {
    return true;
  }

  // Parse hour and minute numerically
  const match = timeString.match(/(\d{1,2}):(\d{2})(?:\s*([ap]\.?m\.?))?/i);
  if (!match) return false;

  const rawH = parseInt(match[1], 10);
  const rawM = parseInt(match[2], 10);
  if (isNaN(rawH) || isNaN(rawM) || rawM < 0 || rawM > 59) return false;

  const ampm = match[3] ? match[3].toLowerCase().replace(/\./g, '') : null;
  const currH24 = date.getHours();
  const currM = date.getMinutes();
  const currH12 = currH24 % 12 || 12;

  // 1. Direct 24-hour clock match with 2-minute catchup
  let targetH24 = rawH;
  if (ampm === 'pm' && rawH < 12) targetH24 = rawH + 12;
  if (ampm === 'am' && rawH === 12) targetH24 = 0;

  const targetTotal24 = targetH24 * 60 + rawM;
  const currTotal24 = currH24 * 60 + currM;
  const diff24 = currTotal24 - targetTotal24;
  if (diff24 >= 0 && diff24 <= 2) return true;

  // 2. 12-hour clock match with AM/PM tolerance (e.g., entered 04:06 AM at 4:06 PM or omitted AM/PM)
  const targetTotal12 = (rawH % 12) * 60 + rawM;
  const currTotal12 = (currH12 % 12) * 60 + currM;
  const diff12 = currTotal12 - targetTotal12;
  if (diff12 >= 0 && diff12 <= 2) return true;

  return false;
}

/**
 * Generates a unique key for an item's alert in a given minute
 */
export function getMinuteKey(itemId, date = new Date()) {
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const h = date.getHours();
  const m = date.getMinutes();
  return `${itemId}_${y}-${mo}-${d}_${h}:${m}`;
}

export function getSlotKey(itemId, timeStr = '', date = new Date()) {
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const cleanTime = (timeStr || 'default').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${itemId}_${y}-${mo}-${d}_slot_${cleanTime}`;
}

export function hasDoseFired(itemId, timeStr = '', date = new Date()) {
  const minuteKey = getMinuteKey(itemId, date);
  const slotKey = getSlotKey(itemId, timeStr, date);

  if (firedDoses.has(minuteKey) || firedDoses.has(slotKey)) return true;

  try {
    if (sessionStorage.getItem(`alarm_fired_${minuteKey}`)) return true;
    if (sessionStorage.getItem(`alarm_fired_${slotKey}`)) return true;
  } catch {}

  return false;
}

export function recordDoseFired(itemId, timeStr = '', date = new Date()) {
  const minuteKey = getMinuteKey(itemId, date);
  const slotKey = getSlotKey(itemId, timeStr, date);

  firedDoses.add(minuteKey);
  firedDoses.add(slotKey);

  try {
    sessionStorage.setItem(`alarm_fired_${minuteKey}`, 'true');
    sessionStorage.setItem(`alarm_fired_${slotKey}`, 'true');
  } catch {}
}

export function resetFiredDose(itemId) {
  if (!itemId) {
    firedDoses.clear();
    return;
  }
  for (const key of Array.from(firedDoses)) {
    if (key.includes(itemId)) {
      firedDoses.delete(key);
    }
  }
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.includes(itemId)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

/**
 * Extracts all valid time strings from medication time, schedule, and frequency
 */
export function getAllItemTimeStrings(item) {
  if (!item) return [];
  const candidates = [];
  if (item.time) candidates.push(item.time);
  if (item.schedule) candidates.push(item.schedule);
  if (item.frequency) candidates.push(item.frequency);

  // Extract explicit times (e.g. "08:00 AM", "2:00 PM", "07:30 AM", "15:00", "03:19 PM", "04:06 AM")
  const combined = `${item.time || ''} ${item.schedule || ''} ${item.instructions || ''}`;
  const timeRegex = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/gi;
  let match;
  while ((match = timeRegex.exec(combined)) !== null) {
    candidates.push(match[1]);
  }

  // Clinical frequency standard fallback times
  const lower = combined.toLowerCase();
  if (lower.includes('tid') || lower.includes('three times') || lower.includes('3 times')) {
    candidates.push('08:00 AM', '02:00 PM', '08:00 PM');
  } else if (lower.includes('bid') || lower.includes('twice') || lower.includes('2 times')) {
    candidates.push('08:00 AM', '08:00 PM');
  } else if (lower.includes('qid') || lower.includes('four times') || lower.includes('4 times')) {
    candidates.push('08:00 AM', '12:00 PM', '04:00 PM', '08:00 PM');
  } else if (lower.includes('od') || lower.includes('once daily')) {
    candidates.push('08:00 AM');
  }

  return Array.from(new Set(candidates));
}

/**
 * Evaluates the full medication checklist and returns items that are due NOW
 */
export function getDueMedications(medications = [], date = new Date()) {
  if (!Array.isArray(medications)) return [];

  // Check if user globally disabled in-app alerts
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('carebridge_in_app_alerts_enabled') === 'false') {
      return [];
    }
  } catch {}

  const dueItems = [];

  for (const item of medications) {
    if (!item) continue;
    // Skip if already checked off as taken
    if (item.done) continue;
    // Skip if alarm explicitly muted for this specific item
    if (item.alarmEnabled === false) continue;

    const timeCandidates = getAllItemTimeStrings(item);
    if (timeCandidates.length === 0) continue;

    for (const timeStr of timeCandidates) {
      if (isDoseDueAtTime(timeStr, date)) {
        if (!hasDoseFired(item.id, timeStr, date)) {
          dueItems.push({ ...item, dueTimeSlot: timeStr });
          break; // Avoid adding same item multiple times in same cycle
        }
      }
    }
  }

  return dueItems;
}

/**
 * Parse time string into minutes from midnight (0 to 1439)
 */
export function timeStringToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = (match[3] || '').toLowerCase();

  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

/**
 * Calculates upcoming dose information
 */
export function getNextUpcomingDose(medications = [], date = new Date()) {
  if (!Array.isArray(medications) || medications.length === 0) return null;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  let nextItem = null;
  let minDiff = Infinity;

  for (const item of medications) {
    if (item.done) continue;
    const timeField = item.time || item.schedule || '';
    const doseMinutes = timeStringToMinutes(timeField);
    if (doseMinutes === null) continue;

    let diff = doseMinutes - currentMinutes;
    if (diff < 0) diff += 1440; // Next day

    if (diff < minDiff) {
      minDiff = diff;
      nextItem = { ...item, minutesUntil: diff };
    }
  }

  return nextItem;
}
