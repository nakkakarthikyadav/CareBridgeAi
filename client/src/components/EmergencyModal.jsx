import React, { useEffect } from 'react';
import { extractHospitalContact, directCallHospital } from '../utils/hospitalContact';

/**
 * EmergencyModal:
 * - If a phone number is extracted from the prescription: directly triggers the phone call.
 * - If no phone number is present in the prescription: completely removed (renders null).
 */
export default function EmergencyModal({ isOpen, onClose, prescriptions = [], userProfile = null, setToastMessage }) {
  if (!isOpen) return null;

  const contact = extractHospitalContact(prescriptions, userProfile);

  useEffect(() => {
    if (isOpen) {
      if (contact.hasNumber && contact.phone) {
        if (typeof setToastMessage === 'function') {
          setToastMessage(`📞 Direct calling hospital from prescription (${contact.phone})...`);
        }
        directCallHospital(contact.phone);
      }
      onClose();
    }
  }, [isOpen]);

  // If no phone number exists on the prescription, remove completely (render nothing)
  return null;
}
