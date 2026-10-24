import React, { useState, useEffect } from 'react';
import HandwrittenOCRView from './HandwrittenOCRView';
import ConfusionGuardView from './ConfusionGuardView';
import DietPlannerView from './DietPlannerView';
import TimelineView from './TimelineView';
import DocumentAnalysisView from './DocumentAnalysisView';
import { extractHospitalContact, directCallHospital } from '../utils/hospitalContact';
import { playMedicalChime, triggerBrowserNotification } from '../utils/audioChime';

export default function DashboardPortal({ 
  userProfile, 
  setUserProfile, 
  onViewLandingPage, 
  openEmergencyModal, 
  openProfileModal, 
  setToastMessage,
  onSignOut,
  initialStep,
  theme,
  setTheme
}) {
  // Current active step in the recovery pipeline
  // 'overview' | 'prescriptions' | 'upload' | 'verify' | 'reminders' | 'followup' | 'recovery' | 'diet' | 'confusion'
  const [activeStep, setActiveStep] = useState(initialStep || 'overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Real-time In-App Medication Dose Alert Modal State
  const [activeDoseAlert, setActiveDoseAlert] = useState(null);

  // Latest Prescriptions State (stored in localStorage)
  const [prescriptions, setPrescriptions] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_portal_prescriptions');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Filter out legacy mock data & phantom unuploaded data
        return parsed.filter(p => p.id !== 'rx_1' && p.id !== 'rx_2' && !(p.title === 'Hospital Discharge Prescription' && p.doctor === 'Attending Physician' && !p.imagePreview));
      }
    } catch {}
    return [];
  });

  // Hospital Contact extracted from uploaded prescriptions
  const hospitalContact = extractHospitalContact(prescriptions, userProfile);

  const handleEmergencyCall = () => {
    if (hospitalContact.hasNumber && hospitalContact.phone) {
      if (typeof setToastMessage === 'function') {
        setToastMessage(`📞 Direct dialing hospital: ${hospitalContact.hospitalName || 'Clinic'} (${hospitalContact.phone})...`);
      }
      directCallHospital(hospitalContact.phone);
    }
  };

  useEffect(() => {
    if (initialStep) {
      setActiveStep(initialStep);
    }
  }, [initialStep]);

  const handleDeletePrescription = (id) => {
    const updated = prescriptions.filter(p => p.id !== id);
    setPrescriptions(updated);
    if (updated.length === 0) {
      localStorage.removeItem('carebridge_portal_prescriptions');
      localStorage.removeItem('carebridge_meds_checklist');
      localStorage.removeItem('carebridge_advice_checklist');
      localStorage.removeItem('carebridge_diet_checklist');
      setShowAddAnotherRx(true);
      if (typeof setToastMessage === 'function') {
        setToastMessage('Prescription removed. Ready to upload a new prescription.');
      }
    } else {
      localStorage.setItem('carebridge_portal_prescriptions', JSON.stringify(updated));
      if (typeof setToastMessage === 'function') {
        setToastMessage('Prescription removed.');
      }
    }
  };

  // Filter for prescriptions tab
  const [prescriptionFilter, setPrescriptionFilter] = useState('all'); // 'all' | 'active' | 'refills'
  const [previewModalRx, setPreviewModalRx] = useState(null);
  const [showAddAnotherRx, setShowAddAnotherRx] = useState(false);

  // Appointments for the follow-up step
  const [appointments, setAppointments] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_portal_appointments');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Filter out legacy mock data
        return parsed.filter(a => a.id !== 'apt_1' && a.id !== 'apt_2');
      }
    } catch {}
    return [];
  });

  // New appointment form state
  const [showAddApt, setShowAddApt] = useState(false);
  const [newDoctor, setNewDoctor] = useState('');
  const [newClinic, setNewClinic] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newSpecialty, setNewSpecialty] = useState('');
  const [newPrep, setNewPrep] = useState('');

  // Recovery Vitals State
  const [painLevel, setPainLevel] = useState(3);
  const [temperature, setTemperature] = useState('98.6');
  const [systolic, setSystolic] = useState('120');
  const [diastolic, setDiastolic] = useState('80');
  const [energyLevel, setEnergyLevel] = useState(4);
  const [woundStatus, setWoundStatus] = useState('Clean & Healing');
  const [vitalsNotes, setVitalsNotes] = useState('');
  const [recoveryLogs, setRecoveryLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_portal_vitals_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.filter(l => !(l.temperature === '98.4°F' && l.bloodPressure === '122/78'));
      }
    } catch {}
    return [];
  });

  const handleSavePrescription = (newRx, newApt = null, newMeds = []) => {
    setPrescriptions(prev => {
      const filtered = (prev || []).filter(p => p.id !== newRx.id);
      const updated = [newRx, ...filtered];
      try {
        localStorage.setItem('carebridge_portal_prescriptions', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save prescriptions to localStorage', err);
      }
      return updated;
    });

    if (newApt) {
      setAppointments(prev => {
        const filtered = (prev || []).filter(a => a.id !== newApt.id);
        const updated = [newApt, ...filtered];
        try {
          localStorage.setItem('carebridge_portal_appointments', JSON.stringify(updated));
        } catch (err) {
          console.error('Failed to save appointments to localStorage', err);
        }
        return updated;
      });
    }

    if (newMeds && newMeds.length > 0) {
      try {
        const saved = localStorage.getItem('carebridge_meds_checklist');
        const existing = saved ? JSON.parse(saved) : [];
        const cleanExisting = existing.filter(e => 
          !['m1', 'm2', 'm3', 'm4'].includes(e.id) &&
          !e.title?.toLowerCase().includes('pantoprazole 40')
        );
        const merged = [...newMeds, ...cleanExisting.filter(e => !newMeds.some(m => m.title === e.title))];
        localStorage.setItem('carebridge_meds_checklist', JSON.stringify(merged));
        window.dispatchEvent(new Event('carebridge_meds_updated'));
      } catch (err) {
        console.error('Failed to sync checklist', err);
      }
    }

    playMedicalChime();
    setToastMessage(`✅ Prescription from ${newRx.doctor || 'Doctor'} uploaded and saved to your dashboard!`);
  };

  const handleSignOut = () => {
    if (onSignOut) {
      onSignOut();
    } else {
      const cleared = { name: '', email: '', phone: '', diagnosis: '', isLoggedIn: false };
      setUserProfile(cleared);
      localStorage.removeItem('carebridge_user');
      localStorage.removeItem('carebridge_auth_token');
      setToastMessage('Signed out successfully.');
    }
  };

  const handleToggleAlarm = (id) => {
    playMedicalChime();
    setAppointments(prev => prev.map(a => {
      if (a.id === id) {
        const next = !a.alarmSet;
        if (next) {
          triggerBrowserNotification('Follow-Up Reminder Set', `Reminder active for ${a.doctor} on ${a.date}`);
          setToastMessage(`🔔 Reminder alarm active for ${a.doctor}`);
        } else {
          setToastMessage(`Reminder muted for ${a.doctor}`);
        }
        return { ...a, alarmSet: next };
      }
      return a;
    }));
  };

  // Calendar export (.ics)
  const handleExportIcs = (apt) => {
    try {
      const dateClean = (apt.date || '2026-11-02').replace(/-/g, '');
      const icsData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CareBridge AI//Post-Discharge Medical Checkup//EN',
        'BEGIN:VEVENT',
        `SUMMARY:Medical Checkup: ${apt.doctor}`,
        `DESCRIPTION:${apt.specialty} - ${apt.prepNotes}. Location: ${apt.clinic}`,
        `LOCATION:${apt.clinic}`,
        `DTSTART:${dateClean}T103000Z`,
        `DTEND:${dateClean}T113000Z`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', `checkup_${apt.doctor.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setToastMessage(`📅 Saved calendar event (.ics) for ${apt.doctor}!`);
    } catch {
      setToastMessage('Could not export calendar invite.');
    }
  };

  const handleSaveAppointment = (e) => {
    e.preventDefault();
    if (!newDoctor || !newDate) {
      setToastMessage('Please enter doctor name and appointment date.');
      return;
    }

    const newObj = {
      id: `apt_${Date.now()}`,
      doctor: newDoctor,
      clinic: newClinic || 'Outpatient Clinic',
      date: newDate,
      time: newTime || '10:00 AM',
      daysRemaining: Math.max(1, Math.round((new Date(newDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
      specialty: newSpecialty || 'Clinical Follow-up',
      prepNotes: newPrep || 'Bring current discharge paperwork and active medications.',
      alarmSet: true
    };

    const updated = [newObj, ...appointments];
    setAppointments(updated);
    localStorage.setItem('carebridge_portal_appointments', JSON.stringify(updated));
    setShowAddApt(false);
    setNewDoctor('');
    setNewClinic('');
    setNewDate('');
    setNewTime('');
    setNewSpecialty('');
    setNewPrep('');
    setToastMessage(`✅ Saved follow-up appointment with ${newObj.doctor}`);
  };

  const handleSaveVitals = (e) => {
    e.preventDefault();
    playMedicalChime();

    const tempNum = parseFloat(temperature);
    const isFever = !isNaN(tempNum) && tempNum >= 100.4;
    const isHighPain = painLevel >= 8;
    const isWoundIssue = woundStatus.includes('Redness') || woundStatus.includes('Drainage');

    const status = (isFever || isHighPain || isWoundIssue) ? 'Red Flag Alert' : 'Normal Healing';
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newLog = {
      date: `Today, ${timeStr}`,
      painLevel,
      temperature: `${temperature}°F`,
      bloodPressure: `${systolic}/${diastolic}`,
      energyLevel: energyLevel >= 4 ? 'Good Mobility' : 'Resting / Fatigue',
      woundStatus,
      notes: vitalsNotes,
      status
    };

    const updated = [newLog, ...recoveryLogs.slice(0, 8)];
    setRecoveryLogs(updated);
    localStorage.setItem('carebridge_portal_vitals_logs', JSON.stringify(updated));

    if (status === 'Red Flag Alert') {
      setToastMessage('🚨 High Red-Flag symptom logged! Please consult your doctor.');
    } else {
      setToastMessage("✅ Today's recovery vitals recorded successfully!");
    }
    setVitalsNotes('');
  };

  const tempNum = parseFloat(temperature);
  const showFeverAlert = !isNaN(tempNum) && tempNum >= 100.4;
  const showPainAlert = painLevel >= 8;

  // Print/Export prescription summary
  const handlePrintPrescription = (rx) => {
    const textLines = [
      `CAREBRIDGE AI - CLINICAL PRESCRIPTION SUMMARY`,
      `----------------------------------------------`,
      `Patient Name: ${userProfile?.name || 'Patient'}`,
      `Diagnosis: ${rx.diagnosis}`,
      `Prescribing Doctor: ${rx.doctor}`,
      `Clinic / Hospital: ${rx.clinic}`,
      `Date Issued: ${rx.date}`,
      `Refill Status: ${rx.refill}`,
      ``,
      `ACTIVE MEDICATIONS:`,
      ...rx.medications.map((m, idx) => `${idx + 1}. ${m.name} - ${m.dosage}\n   Schedule: ${m.schedule}\n   Instructions: ${m.instructions}`),
      ``,
      `CLINICAL PRECAUTIONS & NOTES:`,
      rx.notes || 'None recorded.',
      `----------------------------------------------`,
      `Generated by CareBridge AI Patient Portal.`
    ].join('\n');

    const blob = new Blob([textLines], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `Prescription_${rx.id}_${userProfile?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Patient'}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToastMessage(`📄 Exported prescription summary for ${rx.doctor}`);
  };

  // Pipeline navigation items (Prescription is handled once in Step 1, then other recovery steps)
  const sidebarItems = [
    { id: 'overview', icon: '📊', stepNum: null, label: 'Recovery Overview', sub: 'Health status & tools' },
    { id: 'prescriptions', icon: '💊', stepNum: 'Step 1', label: '1. Prescriptions & Meds', sub: prescriptions.length > 0 ? `${prescriptions.length} Active Rx` : 'Upload once', badge: prescriptions.length > 0 ? `${prescriptions.length} Active` : null },
    { id: 'followup', icon: '📅', stepNum: 'Step 2', label: '2. Follow-up Visits', sub: 'Doctor checkups & dates', badge: appointments.length > 0 ? `${appointments.length} Scheduled` : null },
    { id: 'recovery', icon: '⏰', stepNum: 'Step 3', label: '3. Track Medications', sub: 'Daily tablet tracker & alarms' },
    { id: 'diet', icon: '🥗', stepNum: 'Step 4', label: '4. Diet & Nutrition', sub: 'Foods to eat & avoid' },
    { id: 'confusion', icon: '🛡️', stepNum: 'Step 5', label: '5. Confusion Guard', sub: 'LASA drug safety' }
  ];

  const filteredPrescriptions = prescriptions.filter(rx => {
    if (prescriptionFilter === 'active') return rx.status === 'Active';
    if (prescriptionFilter === 'refills') return rx.refill.toLowerCase().includes('refill');
    return true;
  });

  return (
    <div className="dashboard-container">
      {/* Mobile Drawer Backdrop */}
      <div 
        className={`dashboard-mobile-backdrop ${mobileMenuOpen ? 'mobile-open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Mobile Sticky Header (Visible on <= 900px) */}
      <header className="dashboard-mobile-header">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '7px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#1e293b',
            cursor: 'pointer'
          }}
        >
          <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>☰</span>
          <span>Menu</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            background: '#4f46e5',
            borderRadius: '7px',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            fontSize: '0.95rem'
          }}>
            ✚
          </div>
          <strong style={{ fontSize: '1rem', color: 'var(--navy)' }}>CareBridge AI</strong>
        </div>

        {hospitalContact.hasNumber && hospitalContact.phone && (
          <button
            type="button"
            onClick={handleEmergencyCall}
            style={{
              background: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: '9999px',
              padding: '6px 12px',
              fontSize: '0.75rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(220, 38, 38, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <span>📞</span>
            <span>Call Hospital ({hospitalContact.phone})</span>
          </button>
        )}
      </header>

      {/* ======================= SLEEK CLINICAL SIDEBAR ======================= */}
      <aside className={`dashboard-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div>
          {/* Logo Brand Header */}
          <div className="sidebar-brand-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: '#4f46e5',
                borderRadius: '8px',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '1.1rem'
              }}>
                ✚
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--navy)' }}>
                CareBridge <span style={{ color: '#4f46e5' }}>AI</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                background: '#eef2ff',
                color: '#4f46e5',
                fontSize: '0.7rem',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '9999px',
                border: '1px solid #c7d2fe'
              }}>
                PORTAL
              </span>

              {/* Mobile Close Button */}
              <button
                type="button"
                className="mobile-close-btn"
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  color: '#64748b',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* User Welcome Card */}
          <div className="sidebar-user-card">
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: '#4f46e5',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.1rem',
              flexShrink: 0,
              boxShadow: '0 4px 10px rgba(79, 70, 229, 0.25)'
            }}>
              {userProfile?.name ? userProfile.name[0].toUpperCase() : 'P'}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div className="sidebar-user-name">
                {userProfile?.name || 'Patient'}
              </div>
              <div className="sidebar-user-diag">
                {userProfile?.diagnosis || 'Post-Discharge Recovery'}
              </div>
            </div>
          </div>

          {/* Sidebar Navigation Items */}
          <div style={{ padding: '0.75rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{
              fontSize: '0.7rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: '#94a3b8',
              letterSpacing: '0.6px',
              padding: '0.25rem 0.75rem 0.5rem 0.75rem'
            }}>
              Recovery Workspace
            </div>

            {sidebarItems.map((item) => {
              const isActive = activeStep === item.id;
              const stepIndex = item.stepNum ? item.stepNum.replace('Step ', '') : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveStep(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`sidebar-nav-btn ${isActive ? 'active' : ''}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', flexShrink: 0 }}>
                      {item.icon}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                        {stepIndex && (
                          <span className={`sidebar-step-tag step-${stepIndex}`}>
                            Step {stepIndex}
                          </span>
                        )}
                        <span className="sidebar-nav-label">{item.label}</span>
                      </div>
                      <div className="sidebar-nav-sub">
                        {item.sub}
                      </div>
                    </div>
                  </div>

                  {item.badge && (
                    <span className="sidebar-nav-badge">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sidebar Footer with Caregiver Profile, Emergency, Landing toggle & Sign Out */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border-light, #f1f5f9)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Day/Dark Mode Switcher in Sidebar */}
          {typeof setTheme === 'function' && (
            <button
              type="button"
              className="sidebar-footer-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              style={{ justifyContent: 'space-between' }}
            >
              <span>{theme === 'dark' ? '☀️ Theme: Dark' : '🌙 Theme: Day'}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#4f46e5' }}>Toggle</span>
            </button>
          )}

          <button
            type="button"
            className="sidebar-footer-btn"
            onClick={() => {
              openProfileModal();
              setMobileMenuOpen(false);
            }}
          >
            <span>👤</span>
            <span>Profile &amp; Caregiver</span>
          </button>

          {hospitalContact.hasNumber && hospitalContact.phone && (
            <button
              type="button"
              onClick={() => {
                handleEmergencyCall();
                setMobileMenuOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '9999px',
                padding: '10px 14px',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)',
                transition: 'all 0.15s ease'
              }}
            >
              <span>📞</span>
              <span>Emergency Call: {hospitalContact.phone}</span>
            </button>
          )}

          <button
            type="button"
            className="sidebar-footer-btn-danger"
            onClick={handleSignOut}
          >
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ======================= MAIN DASHBOARD WORKSPACE ======================= */}
      <main className="dashboard-main-content">
        
        {/* Top Header Bar */}
        <div className="dashboard-top-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>🏥</span>
              <h1 className="dashboard-header-title">
                Patient Recovery Dashboard
              </h1>
            </div>
            <p className="dashboard-header-sub">
              Logged in as <strong>{userProfile?.name || 'Patient'}</strong> • {userProfile?.diagnosis || 'Post-Discharge Recovery'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {typeof setTheme === 'function' && (
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="dashboard-theme-toggle-btn"
                title={`Switch to ${theme === 'dark' ? 'Day Light' : 'Dark Night'} Mode`}
              >
                <span>{theme === 'dark' ? '☀️ Day Mode' : '🌙 Dark Mode'}</span>
              </button>
            )}

            {typeof onViewLandingPage === 'function' && (
              <button
                type="button"
                onClick={onViewLandingPage}
                className="dashboard-landing-btn"
              >
                <span>🌐 Public Site</span>
              </button>
            )}
          </div>
        </div>

        {/* ================= STEP CONTENT AREA ================= */}

        {/* 1. OVERVIEW: CLEAN CLINICAL HEALTH DASHBOARD */}
        {activeStep === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            {/* Welcome banner & Platform Purpose */}
            <div className="overview-hero-card">
              <div style={{ width: '100%' }}>
                <span className="portal-step-badge">
                  POST-DISCHARGE CLINICAL SAFETY PROTOCOL • ACTIVE MONITORING
                </span>
                <h2 className="overview-hero-title">
                  Welcome to CareBridge AI, <span style={{ color: '#4f46e5' }}>{userProfile?.name || 'Patient'}</span>!
                </h2>
                <p className="overview-hero-desc">
                  CareBridge AI bridges the vulnerable transition from hospital to home. We decode doctor prescriptions, verify dangerous drug interactions, and schedule automated alarms so you never miss a dose.
                </p>
              </div>

              {/* 5-Step Quick Launch Bar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', marginTop: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-light, #e2e8f0)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted, #64748b)', letterSpacing: '0.5px' }}>
                  Quick Step Navigation (Steps 1 – 5):
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-step-quick-pill step-1"
                    onClick={() => {
                      setShowAddAnotherRx(prescriptions.length === 0);
                      setActiveStep('prescriptions');
                    }}
                  >
                    <span>💊</span>
                    <span>1. Prescriptions ({prescriptions.length})</span>
                  </button>

                  <button
                    type="button"
                    className="btn-step-quick-pill step-2"
                    onClick={() => setActiveStep('followup')}
                  >
                    <span>📅</span>
                    <span>2. Follow-Up Visits ({appointments.length})</span>
                  </button>

                  <button
                    type="button"
                    className="btn-step-quick-pill step-3"
                    onClick={() => setActiveStep('recovery')}
                  >
                    <span>⏰</span>
                    <span>3. Track Medications</span>
                  </button>

                  <button
                    type="button"
                    className="btn-step-quick-pill step-4"
                    onClick={() => setActiveStep('diet')}
                  >
                    <span>🥗</span>
                    <span>4. Diet &amp; Nutrition</span>
                  </button>

                  <button
                    type="button"
                    className="btn-step-quick-pill step-5"
                    onClick={() => setActiveStep('confusion')}
                  >
                    <span>🛡️</span>
                    <span>5. Confusion Guard</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 5-Step Post-Discharge Recovery Pathway */}
            <div className="recovery-pathway-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <span className="portal-step-badge">
                    5-STEP RECOVERY PROTOCOL
                  </span>
                  <h3 className="recovery-pathway-title">
                    Your Step-by-Step Care Journey
                  </h3>
                  <p className="recovery-pathway-desc">
                    Follow these 5 clinical steps to safely manage your medications, checkups, daily recovery, and diet at home.
                  </p>
                </div>
              </div>

              <div className="recovery-pathway-grid">
                {/* Step 1 */}
                <div 
                  className="pathway-step-card step-1"
                  onClick={() => {
                    setShowAddAnotherRx(false);
                    setActiveStep('prescriptions');
                  }}
                >
                  <div>
                    <div className="pathway-step-header">
                      <span className="pathway-step-num">Step 1</span>
                      <span style={{ fontSize: '1.4rem' }}>💊</span>
                    </div>
                    <div className="pathway-step-title">1. Prescriptions &amp; Meds</div>
                    <div className="pathway-step-desc">
                      Upload doctor scripts once. Vision OCR extracts drugs, doses, and schedules.
                    </div>
                  </div>
                  <div>
                    <span className="pathway-step-badge" style={{
                      background: prescriptions.length > 0 ? '#ecfdf5' : '#eef2ff',
                      color: prescriptions.length > 0 ? '#059669' : '#4338ca',
                      border: `1px solid ${prescriptions.length > 0 ? '#a7f3d0' : '#c7d2fe'}`
                    }}>
                      {prescriptions.length > 0 ? `✓ ${prescriptions.length} Active Rx` : 'Upload Script'}
                    </span>
                    <div className="pathway-step-action">
                      <span>Open Step 1</span>
                      <span>→</span>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div 
                  className="pathway-step-card step-2"
                  onClick={() => setActiveStep('followup')}
                >
                  <div>
                    <div className="pathway-step-header">
                      <span className="pathway-step-num" style={{ color: '#0284c7' }}>Step 2</span>
                      <span style={{ fontSize: '1.4rem' }}>📅</span>
                    </div>
                    <div className="pathway-step-title">2. Follow-Up Visits</div>
                    <div className="pathway-step-desc">
                      Doctor checkups, postoperative clinic reviews, and calendar reminder sync (.ics).
                    </div>
                  </div>
                  <div>
                    <span className="pathway-step-badge" style={{
                      background: appointments.length > 0 ? '#e0f2fe' : '#f1f5f9',
                      color: appointments.length > 0 ? '#0369a1' : '#475569',
                      border: `1px solid ${appointments.length > 0 ? '#bae6fd' : '#e2e8f0'}`
                    }}>
                      {appointments.length > 0 ? `🗓️ ${appointments.length} Scheduled` : 'Add Checkup'}
                    </span>
                    <div className="pathway-step-action" style={{ color: '#0284c7' }}>
                      <span>Open Step 2</span>
                      <span>→</span>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div 
                  className="pathway-step-card step-3"
                  onClick={() => setActiveStep('recovery')}
                >
                  <div>
                    <div className="pathway-step-header">
                      <span className="pathway-step-num" style={{ color: '#059669' }}>Step 3</span>
                      <span style={{ fontSize: '1.4rem' }}>⏰</span>
                    </div>
                    <div className="pathway-step-title">3. Track Medications</div>
                    <div className="pathway-step-desc">
                      Daily tablet checklist, chime alarms, and live dose adherence progress tracking.
                    </div>
                  </div>
                  <div>
                    <span className="pathway-step-badge" style={{
                      background: '#ecfdf5',
                      color: '#047857',
                      border: '1px solid #a7f3d0'
                    }}>
                      🔔 Alarms Active
                    </span>
                    <div className="pathway-step-action" style={{ color: '#059669' }}>
                      <span>Open Step 3</span>
                      <span>→</span>
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div 
                  className="pathway-step-card step-4"
                  onClick={() => setActiveStep('diet')}
                >
                  <div>
                    <div className="pathway-step-header">
                      <span className="pathway-step-num" style={{ color: '#d97706' }}>Step 4</span>
                      <span style={{ fontSize: '1.4rem' }}>🥗</span>
                    </div>
                    <div className="pathway-step-title">4. Diet &amp; Nutrition</div>
                    <div className="pathway-step-desc">
                      Foods that accelerate tissue repair, meals to prioritize, and strict food-drug conflicts.
                    </div>
                  </div>
                  <div>
                    <span className="pathway-step-badge" style={{
                      background: '#fffbeb',
                      color: '#b45309',
                      border: '1px solid #fde68a'
                    }}>
                      🥗 Healing Meals
                    </span>
                    <div className="pathway-step-action" style={{ color: '#d97706' }}>
                      <span>Open Step 4</span>
                      <span>→</span>
                    </div>
                  </div>
                </div>

                {/* Step 5 */}
                <div 
                  className="pathway-step-card step-5"
                  onClick={() => setActiveStep('confusion')}
                >
                  <div>
                    <div className="pathway-step-header">
                      <span className="pathway-step-num" style={{ color: '#dc2626' }}>Step 5</span>
                      <span style={{ fontSize: '1.4rem' }}>⚠️</span>
                    </div>
                    <div className="pathway-step-title">5. Confusion Guard</div>
                    <div className="pathway-step-desc">
                      Look-Alike / Sound-Alike error prevention (LASA safety) and drug-drug conflict screen.
                    </div>
                  </div>
                  <div>
                    <span className="pathway-step-badge" style={{
                      background: '#fef2f2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca'
                    }}>
                      🛡️ Safety Guard
                    </span>
                    <div className="pathway-step-action" style={{ color: '#dc2626' }}>
                      <span>Open Step 5</span>
                      <span>→</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Clinical Status Overview: 3 Real-time Recovery Metrics */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1rem'
            }}>
              {/* Metric 1: Active Meds */}
              <div 
                onClick={() => setActiveStep('prescriptions')}
                className="overview-metric-card"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="overview-metric-label">
                    Active Medications
                  </span>
                  <span style={{ fontSize: '1.2rem' }}>💊</span>
                </div>
                {(() => {
                  const allMeds = prescriptions.flatMap(p => p.medications || []);
                  return (
                    <>
                      <div className="overview-metric-val">
                        {allMeds.length > 0 ? `${allMeds.length} On Schedule` : '0 Active'}
                      </div>
                      <p className="overview-metric-desc" style={{ color: allMeds.length > 0 ? '#4f46e5' : '#64748b' }}>
                        {allMeds.length > 0 ? allMeds.slice(0, 3).map(m => m.name).join(', ') : 'No active prescriptions on file'}
                      </p>
                      <div style={{ marginTop: '10px', fontSize: '0.75rem', color: allMeds.length > 0 ? '#16a34a' : '#64748b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>{allMeds.length > 0 ? '✓' : 'ℹ️'}</span> {allMeds.length > 0 ? 'Verified via Clinical OCR' : 'Upload prescription to track doses'}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Metric 2: Next Dose */}
              <div 
                onClick={() => setActiveStep('recovery')}
                className="overview-metric-card"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="overview-metric-label">
                    Next Scheduled Dose
                  </span>
                  <span style={{ fontSize: '1.2rem' }}>⏰</span>
                </div>
                {(() => {
                  const allMeds = prescriptions.flatMap(p => p.medications || []);
                  const firstMed = allMeds[0];
                  return (
                    <>
                      <div className="overview-metric-val">
                        {firstMed ? (firstMed.schedule || 'Scheduled') : 'None Pending'}
                      </div>
                      <p className="overview-metric-desc">
                        {firstMed ? `${firstMed.name} ${firstMed.dosage ? `(${firstMed.dosage})` : ''}` : 'No upcoming dose alarms'}
                      </p>
                      <div style={{ marginTop: '10px', fontSize: '0.75rem', color: '#4f46e5', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>🔔</span> Web Audio chime alarms enabled
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Metric 3: Doctor Checkup */}
              <div 
                onClick={() => setActiveStep('followup')}
                className="overview-metric-card"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="overview-metric-label">
                    Post-Op Checkup
                  </span>
                  <span style={{ fontSize: '1.2rem' }}>📅</span>
                </div>
                {(() => {
                  const firstApt = appointments && appointments.length > 0 ? appointments[0] : null;
                  return (
                    <>
                      <div className="overview-metric-val">
                        {firstApt ? `${firstApt.date} (in ${firstApt.daysRemaining || 0}d)` : 'None Scheduled'}
                      </div>
                      <p className="overview-metric-desc">
                        {firstApt ? `${firstApt.doctor} • ${firstApt.specialty || 'Follow-up'}` : 'No upcoming doctor visits'}
                      </p>
                      <div style={{ marginTop: '10px', fontSize: '0.75rem', color: '#0284c7', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>📍</span> {firstApt?.clinic || 'Add checkup in Schedule Follow-up'}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* What CareBridge AI Does - 3 Clean Tool Cards */}
            <div className="overview-services-card">
              <div style={{ marginBottom: '1.25rem' }}>
                <span className="portal-step-badge">
                  CAREBRIDGE AI PLATFORM SERVICES
                </span>
                <h3 className="overview-services-title">
                  Everything you need for safe recovery at home
                </h3>
                <p className="overview-services-desc">
                  Select any tool below or use the sidebar navigation to manage your recovery journey.
                </p>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '1rem'
              }}>
                {/* Tool 1 */}
                <div 
                  onClick={() => {
                    setShowAddAnotherRx(false);
                    setActiveStep('prescriptions');
                  }}
                  className="overview-tool-card"
                >
                  <div>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>💊</div>
                    <strong className="overview-tool-title">
                      Step 1: Prescriptions &amp; Meds
                    </strong>
                    <p className="overview-tool-desc">
                      Upload prescription photos or hospital discharge summaries. Our clinical OCR translates doctor handwriting and extracts verified medications.
                    </p>
                  </div>
                  <div style={{ marginTop: '1rem', color: '#4f46e5', fontSize: '0.825rem', fontWeight: 800 }}>
                    {prescriptions.length > 0 ? `View ${prescriptions.length} Prescriptions →` : 'Upload Prescription Scan →'}
                  </div>
                </div>

                {/* Tool 2 */}
                <div 
                  onClick={() => setActiveStep('confusion')}
                  className="overview-tool-card"
                >
                  <div>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🛡️</div>
                    <strong className="overview-tool-title">
                      Step 5: Confusion Guard (LASA Safety)
                    </strong>
                    <p className="overview-tool-desc">
                      Screen medications for dangerous Look-Alike / Sound-Alike errors (e.g. Metoprolol vs Hydralazine) and detect adverse drug-drug conflicts.
                    </p>
                  </div>
                  <div style={{ marginTop: '1rem', color: '#4f46e5', fontSize: '0.825rem', fontWeight: 800 }}>
                    Check Drug Safety &rarr;
                  </div>
                </div>

                {/* Tool 3 */}
                <div 
                  onClick={() => setActiveStep('diet')}
                  className="overview-tool-card"
                >
                  <div>
                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🥗</div>
                    <strong className="overview-tool-title">
                      Step 4: Clinical Recovery Diet
                    </strong>
                    <p className="overview-tool-desc">
                      Personalized dietary plans tailored to your specific surgery or cardiac stent to support tissue repair and prevent food-drug interactions.
                    </p>
                  </div>
                  <div style={{ marginTop: '1rem', color: '#4f46e5', fontSize: '0.825rem', fontWeight: 800 }}>
                    Generate Diet Plan &rarr;
                  </div>
                </div>
              </div>
            </div>

            {/* Latest Prescriptions Spotlight */}
            <div className="overview-spotlight-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h3 className="overview-services-title" style={{ margin: 0 }}>
                    💊 Latest Prescriptions On File ({prescriptions.length})
                  </h3>
                  <p className="overview-services-desc" style={{ marginTop: '4px' }}>
                    Your active physician prescriptions and medication dosages parsed by clinical OCR.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-step-action"
                    onClick={() => setActiveStep('prescriptions')}
                  >
                    View All Details →
                  </button>

                  <button
                    type="button"
                    className="btn-hero-launch"
                    onClick={() => {
                      setShowAddAnotherRx(true);
                      setActiveStep('prescriptions');
                    }}
                    style={{ padding: '8px 18px', fontSize: '0.8rem' }}
                  >
                    + Add Prescription
                  </button>
                </div>
              </div>

              {/* Showcase the top prescription or friendly empty state */}
              {prescriptions[0] ? (
                <div className="overview-spotlight-inner">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '1rem' }}>
                    <div>
                      <span style={{ fontSize: '0.725rem', fontWeight: 800, color: '#4f46e5', background: '#eef2ff', padding: '3px 10px', borderRadius: '9999px', border: '1px solid #c7d2fe' }}>
                        ✓ {prescriptions[0].status} • Issued {prescriptions[0].date}
                      </span>
                      <h4 className="overview-tool-title" style={{ margin: '8px 0 3px 0', fontSize: '1.15rem' }}>
                        {prescriptions[0].title}
                      </h4>
                      <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        Prescribed by <strong>{prescriptions[0].doctor}</strong> • {prescriptions[0].clinic}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handlePrintPrescription(prescriptions[0])}
                      style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: '0.775rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      📄 Download Summary (.txt)
                    </button>
                  </div>

                  {/* Medications badges */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                    {(prescriptions[0].medications || []).map((m, idx) => (
                      <div key={idx} className="overview-med-pill-card" style={{
                        borderLeft: m.critical ? '4px solid #ef4444' : '4px solid #4f46e5'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong className="overview-med-pill-name">{m.name}</strong>
                          <span className="overview-med-pill-dosage">
                            {m.dosage}
                          </span>
                        </div>
                        <div className="overview-med-pill-sub">
                          {m.schedule}
                        </div>
                        {m.critical && (
                          <span style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 700, display: 'block', marginTop: '4px' }}>
                            ⚠️ Do NOT miss doses
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="overview-empty-state-box">
                  <span style={{ fontSize: '2.2rem' }}>📄</span>
                  <h4 className="overview-tool-title" style={{ margin: '8px 0 4px 0' }}>
                    No Prescriptions Uploaded Yet
                  </h4>
                  <p className="overview-tool-desc" style={{ maxWidth: '440px', margin: '0 auto 1.25rem auto' }}>
                    Upload a smartphone photo of your doctor's handwritten prescription or hospital discharge summary. Our AI will automatically decode medication names, schedules, and safety warnings.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddAnotherRx(false);
                      setActiveStep('prescriptions');
                    }}
                    className="btn-hero-launch"
                    style={{ margin: '0 auto', padding: '9px 20px', fontSize: '0.825rem' }}
                  >
                    <span>📤 Upload Prescription (Step 1)</span>
                    <span>→</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 1: PRESCRIPTIONS & MEDICATIONS (Handled once) */}
        {(activeStep === 'prescriptions' || activeStep === 'upload' || activeStep === 'verify') && (
          <div>
            <div className="portal-step-card">
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <span className="portal-step-badge">
                    Step 1 of 5
                  </span>
                  <h2 className="portal-step-title">
                    {prescriptions.length === 0 || showAddAnotherRx
                      ? "1. Upload Prescription / Hospital Discharge Summary"
                      : "1. Prescriptions & Active Medications"}
                  </h2>
                  <p className="portal-step-subtitle">
                    {prescriptions.length === 0 || showAddAnotherRx
                      ? "Upload doctor's cursive prescription or hospital discharge summary once. All medications, dosages, and schedules will be automatically decoded."
                      : "Review your verified medications, check dosages, and proceed to daily dose timetable & alarms."}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setShowAddAnotherRx(true)}
                    style={{
                      background: (showAddAnotherRx || prescriptions.length === 0) ? '#4f46e5' : '#ffffff',
                      color: (showAddAnotherRx || prescriptions.length === 0) ? '#ffffff' : '#4f46e5',
                      border: '1.5px solid #4f46e5',
                      borderRadius: '9999px',
                      padding: '8px 16px',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>📤</span>
                    <span>Upload Prescription</span>
                  </button>

                  {prescriptions.length > 0 && showAddAnotherRx && (
                    <button
                      type="button"
                      onClick={() => setShowAddAnotherRx(false)}
                      style={{
                        background: '#f8fafc',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '9999px',
                        padding: '8px 16px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      ← View Prescriptions ({prescriptions.length})
                    </button>
                  )}

                  {prescriptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrescriptions([]);
                        localStorage.removeItem('carebridge_portal_prescriptions');
                        localStorage.removeItem('carebridge_meds_checklist');
                        localStorage.removeItem('carebridge_advice_checklist');
                        localStorage.removeItem('carebridge_diet_checklist');
                        setShowAddAnotherRx(true);
                        setToastMessage('Cleared all prescriptions. Ready to upload a new one.');
                      }}
                      style={{
                        background: '#fff1f2',
                        color: '#e11d48',
                        border: '1px solid #fecdd3',
                        borderRadius: '9999px',
                        padding: '8px 14px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      🗑️ Clear &amp; Upload Fresh
                    </button>
                  )}
                </div>
              </div>

              {(prescriptions.length === 0 || showAddAnotherRx) ? (
                /* Single unified upload workspace when no prescriptions exist or adding another */
                <div>
                  <DocumentAnalysisView 
                    onSavePrescription={(newRx, newApt, newMeds) => {
                      handleSavePrescription(newRx, newApt, newMeds);
                      setShowAddAnotherRx(false);
                      setActiveStep('prescriptions');
                    }}
                    onNavigateToPrescriptions={() => {
                      setShowAddAnotherRx(false);
                      setActiveStep('prescriptions');
                    }}
                    onNavigateToOverview={() => setActiveStep('overview')}
                    onNavigateToStep={(step) => {
                      setShowAddAnotherRx(false);
                      setActiveStep(step);
                    }}
                  />
                </div>
              ) : (
                <>
                  {/* Filters row with purposeful clinical palette */}
                  <div className="rx-filter-group">
                    <button
                      type="button"
                      onClick={() => setPrescriptionFilter('all')}
                      className={`rx-filter-btn rx-filter-btn-all ${prescriptionFilter === 'all' ? 'active' : ''}`}
                    >
                      <span>📋</span>
                      <span>All Prescriptions ({prescriptions.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPrescriptionFilter('active')}
                      className={`rx-filter-btn rx-filter-btn-active ${prescriptionFilter === 'active' ? 'active' : ''}`}
                    >
                      <span>✓</span>
                      <span>Active Courses ({prescriptions.filter(p => p.status === 'Active').length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPrescriptionFilter('refills')}
                      className={`rx-filter-btn rx-filter-btn-refills ${prescriptionFilter === 'refills' ? 'active' : ''}`}
                    >
                      <span>🔄</span>
                      <span>Refills Available</span>
                    </button>
                  </div>

                  {/* Prescriptions List Cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {filteredPrescriptions.map((rx) => (
                  <div
                    key={rx.id}
                    className="clinical-rx-card"
                  >
                    {/* Prescription Top Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-light, #e2e8f0)', paddingBottom: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{
                            background: '#ecfdf5',
                            color: '#059669',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            padding: '3px 12px',
                            borderRadius: '9999px',
                            border: '1.5px solid #6ee7b7',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            ✓ {rx.status}
                          </span>
                          <span style={{
                            background: '#f8fafc',
                            color: '#334155',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: '9999px',
                            border: '1px solid #e2e8f0'
                          }}>
                            📅 Prescribed: <strong>{rx.date}</strong>
                          </span>
                          <span style={{
                            background: '#eef2ff',
                            color: '#4f46e5',
                            fontSize: '0.725rem',
                            fontWeight: 800,
                            padding: '3px 10px',
                            borderRadius: '9999px',
                            border: '1px solid #c7d2fe'
                          }}>
                            {rx.documentType}
                          </span>
                        </div>

                        <h3 className="clinical-rx-title">
                          {rx.title}
                        </h3>

                        <div style={{ fontSize: '0.875rem', color: 'var(--text-main, #334155)' }}>
                          Prescribing Physician: <strong style={{ color: 'var(--navy, #0f172a)' }}>{rx.doctor}</strong> • <span style={{ color: '#0d9488', fontWeight: 600 }}>📍 {rx.clinic}</span>
                        </div>
                        <div style={{ fontSize: '0.825rem', color: 'var(--text-main, #334155)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span>Diagnosis:</span>
                          <span style={{
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontWeight: 700
                          }}>
                            {rx.diagnosis}
                          </span>
                          <span>•</span>
                          <span>Refill: <strong>{rx.refill}</strong></span>
                        </div>
                        {Boolean(rx.hospitalPhone && String(rx.hospitalPhone).trim()) && (
                          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{
                              background: '#fff1f2',
                              border: '1.5px solid #fecdd3',
                              color: '#e11d48',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              padding: '3px 10px',
                              borderRadius: '6px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}>
                              🚨 Hospital Phone: <strong>{rx.hospitalPhone}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setToastMessage(`📞 Direct dialing ${rx.clinic || rx.hospitalName || 'hospital'} (${rx.hospitalPhone})...`);
                                directCallHospital(rx.hospitalPhone);
                              }}
                              style={{
                                background: '#dc2626',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 12px',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)'
                              }}
                            >
                              <span>📞</span>
                              <span>Direct Call Hospital</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Right top actions */}
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {rx.imagePreview && (
                          <button
                            type="button"
                            onClick={() => setPreviewModalRx(rx)}
                            style={{
                              background: '#f0fdf4',
                              border: '1.5px solid #86efac',
                              color: '#15803d',
                              borderRadius: 'var(--radius-sm)',
                              padding: '8px 14px',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <span>🔍</span>
                            <span>View Scan</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handlePrintPrescription(rx)}
                          style={{
                            background: '#eff6ff',
                            border: '1.5px solid #93c5fd',
                            color: '#1d4ed8',
                            borderRadius: 'var(--radius-sm)',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <span>📄</span>
                          <span>Export / Print</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeletePrescription(rx.id)}
                          style={{
                            background: '#fff1f2',
                            border: '1.5px solid #fecdd3',
                            color: '#e11d48',
                            borderRadius: 'var(--radius-sm)',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <span>🗑️</span>
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    {/* Prescribed Medications Grid */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', color: '#4f46e5', letterSpacing: '0.5px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>💊</span>
                        <span>Active Prescribed Medications ({rx.medications.length})</span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                        {rx.medications.map((med, idx) => (
                          <div
                            key={idx}
                            className="clinical-med-card"
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <strong className="clinical-med-name">{med.name}</strong>
                              <span className="clinical-med-dosage">
                                {med.dosage}
                              </span>
                            </div>

                            <div className="clinical-med-schedule">
                              ⏰ {med.schedule}
                            </div>

                            <div style={{ fontSize: '0.8rem', color: 'var(--text-main, #334155)', lineHeight: 1.45, marginTop: '4px' }}>
                              {med.instructions}
                            </div>

                            {med.critical && (
                              <div style={{
                                marginTop: '8px',
                                background: '#fffbeb',
                                border: '1.5px solid #fde68a',
                                color: '#b45309',
                                fontSize: '0.725rem',
                                fontWeight: 800,
                                padding: '6px 10px',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}>
                                <span>⚠️</span>
                                <span><strong>SAFETY ALERT:</strong> Do not miss doses. Prescribed for essential cardiac/clinical stabilization.</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Physician Notes & Precautions */}
                    {rx.notes && (
                      <div style={{
                        background: '#f8fafc',
                        border: '1.5px solid #e2e8f0',
                        borderLeft: '4px solid #f59e0b',
                        borderRadius: 'var(--radius-md)',
                        padding: '10px 14px',
                        fontSize: '0.825rem',
                        color: 'var(--text-main, #334155)',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <span style={{ fontSize: '1.1rem' }}>💡</span>
                        <span><strong style={{ color: '#b45309' }}>Physician Directions:</strong> {rx.notes}</span>
                      </div>
                    )}

                    {/* Action buttons on card footer */}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', paddingTop: '0.75rem', borderTop: '1px solid var(--border-light, #e2e8f0)' }}>
                      <button
                        type="button"
                        onClick={() => {
                          playMedicalChime();
                          setToastMessage(`⏰ Medication alarms armed for ${rx.doctor}'s prescription!`);
                          setActiveStep('recovery');
                        }}
                        style={{
                          background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                          border: 'none',
                          color: '#ffffff',
                          borderRadius: 'var(--radius-sm)',
                          padding: '9px 18px',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.28)'
                        }}
                      >
                        <span>⏰</span>
                        <span>Track Medications &amp; Alarms</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveStep('confusion')}
                        style={{
                          background: '#fffbeb',
                          border: '1.5px solid #fde68a',
                          color: '#b45309',
                          borderRadius: 'var(--radius-sm)',
                          padding: '9px 16px',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span>⚠️</span>
                        <span>Check LASA Confusions</span>
                      </button>
                    </div>

                  </div>
                ))}
              </div>

                  {/* Step 1 Completion & Sequential Progression to Step 2 */}
                  <div className="step-completion-banner">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.3rem' }}>✅</span>
                        <h4 className="step-completion-title">
                          Step 1 Complete: {prescriptions.length} Prescription{prescriptions.length > 1 ? 's' : ''} on File
                        </h4>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0 0' }}>
                        Your verified medications are saved. Now proceed to configure your dose timetable and audio alarms.
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setShowAddAnotherRx(true)}
                        style={{
                          background: '#ffffff',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: 'var(--radius-md)',
                          padding: '10px 18px',
                          fontSize: '0.825rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        📤 Upload Another Prescription
                      </button>

                      <button
                        type="button"
                        className="btn-hero-launch"
                        onClick={() => {
                          try { playMedicalChime(); } catch (_) {}
                          setActiveStep('followup');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{ padding: '10px 22px', fontSize: '0.85rem' }}
                      >
                        <span>Proceed to Step 2: Follow-Up Visits</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>
        )}

        {/* STEP 3: SCHEDULE FOLLOW-UP VISITS */}
        {activeStep === 'followup' && (
          <div>
            <div className="portal-step-card portal-step-followup">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <span className="portal-step-badge">
                    Step 2 of 5
                  </span>
                  <h2 className="portal-step-title">
                    2. Upcoming Medical Follow-Ups &amp; Clinic Checkups
                  </h2>
                  <p className="portal-step-subtitle">
                    Never miss a crucial postoperative appointment. Sync reminders with your phone's calendar (.ics).
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-step-action"
                    onClick={() => setShowAddApt(!showAddApt)}
                  >
                    <span>{showAddApt ? '✕ Close Form' : '➕ Add Checkup'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn-hero-launch"
                    onClick={() => {
                      try { playMedicalChime(); } catch (_) {}
                      setActiveStep('recovery');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    style={{ padding: '8px 18px', fontSize: '0.825rem' }}
                  >
                    <span>Proceed to Step 3: Track Medications</span>
                    <span>→</span>
                  </button>
                </div>
              </div>

              {/* Add Checkup Form */}
              {showAddApt && (
                <form onSubmit={handleSaveAppointment} className="portal-form-card">
                  <h4 className="portal-form-title">
                    Schedule New Follow-Up Checkup
                  </h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label className="portal-form-label">
                        Doctor Name *
                      </label>
                      <input 
                        type="text"
                        className="auth-input"
                        placeholder="e.g. Dr. Jennifer Wu, MD"
                        value={newDoctor}
                        onChange={(e) => setNewDoctor(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label className="portal-form-label">
                        Clinic / Hospital Location
                      </label>
                      <input 
                        type="text"
                        className="auth-input"
                        placeholder="e.g. St. Elizabeth Outpatient Clinic"
                        value={newClinic}
                        onChange={(e) => setNewClinic(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label className="portal-form-label">
                        Date *
                      </label>
                      <input 
                        type="date"
                        className="auth-input"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label className="portal-form-label">
                        Time
                      </label>
                      <input 
                        type="text"
                        className="auth-input"
                        placeholder="e.g. 10:30 AM"
                        value={newTime}
                        onChange={(e) => setNewTime(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="portal-form-label">
                        Specialty
                      </label>
                      <input 
                        type="text"
                        className="auth-input"
                        placeholder="e.g. Cardiology"
                        value={newSpecialty}
                        onChange={(e) => setNewSpecialty(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <label className="portal-form-label">
                      Preparation Notes (e.g. Fasting 8 hrs, bring medication list)
                    </label>
                    <input 
                      type="text"
                      className="auth-input"
                      placeholder="e.g. Fast 8 hours prior to appointment; hold morning blood pressure medicine"
                      value={newPrep}
                      onChange={(e) => setNewPrep(e.target.value)}
                    />
                  </div>

                  <button 
                    type="submit" 
                    className="btn-hero-launch" 
                    style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                  >
                    Save Appointment &amp; Arm Reminder
                  </button>
                </form>
              )}

              {/* Appointments List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {appointments.length === 0 ? (
                  <div className="portal-empty-card">
                    <span style={{ fontSize: '2.5rem' }}>📅</span>
                    <h4 className="portal-empty-card-title">
                      No Follow-Up Appointments Scheduled
                    </h4>
                    <p className="portal-empty-card-desc">
                      Add your scheduled postoperative visits or clinical checkups to set automated alarm reminders and export calendar events.
                    </p>
                    <button
                      type="button"
                      className="btn-hero-launch"
                      onClick={() => setShowAddApt(true)}
                      style={{ padding: '9px 22px', fontSize: '0.825rem', margin: '0 auto' }}
                    >
                      ➕ Add Follow-Up Checkup
                    </button>
                  </div>
                ) : (
                  appointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="portal-appointment-card"
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span className="portal-appointment-doctor">
                              {apt.doctor}
                            </span>
                            <span className="portal-appointment-specialty">
                              {apt.specialty}
                            </span>
                          </div>
                          <div className="portal-appointment-clinic">
                            📍 {apt.clinic}
                          </div>
                        </div>

                        <span className={`portal-appointment-date-badge ${apt.daysRemaining <= 5 ? 'urgent' : ''}`}>
                          🗓️ {apt.date} • {apt.time} (In {apt.daysRemaining} days)
                        </span>
                      </div>

                      {apt.prepNotes && (
                        <div className="portal-appointment-prep">
                          <strong>Preparation:</strong> {apt.prepNotes}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className={`btn-appointment-action ${apt.alarmSet ? 'alarm-armed' : ''}`}
                          onClick={() => handleToggleAlarm(apt.id)}
                        >
                          <span>{apt.alarmSet ? '🔔' : '🔕'}</span>
                          <span>{apt.alarmSet ? 'Alarm Armed' : 'Set Alarm'}</span>
                        </button>

                        <button
                          type="button"
                          className="btn-appointment-action"
                          onClick={() => handleExportIcs(apt)}
                        >
                          <span>📅</span>
                          <span>Export to Calendar (.ics)</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Step 3 Bottom Progression Bar */}
              <div style={{
                marginTop: '2rem',
                borderTop: '1px solid var(--border-light, #e2e8f0)',
                paddingTop: '1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <button
                  type="button"
                  className="portal-nav-btn-back"
                  onClick={() => {
                    setActiveStep('verify');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  ← Back to Step 1: Prescriptions
                </button>
                <button
                  type="button"
                  className="btn-hero-launch"
                  onClick={() => {
                    try { playMedicalChime(); } catch (_) {}
                    setActiveStep('recovery');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={{ padding: '10px 22px', fontSize: '0.85rem' }}
                >
                  <span>Proceed to Step 3: Track Medications</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: TRACK MEDICATIONS */}
        {activeStep === 'recovery' && (
          <div>
            <div className="portal-step-card portal-step-medications">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <span className="portal-step-badge">
                    Step 3 of 5
                  </span>
                  <h2 className="portal-step-title">
                    3. Track Daily Prescribed Medications
                  </h2>
                  <p className="portal-step-subtitle">
                    Track confirmed medication tablets from your prescription, check off taken doses, and arm audio chime alarms.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-hero-launch"
                  onClick={() => {
                    try { playMedicalChime(); } catch (_) {}
                    setActiveStep('diet');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={{ padding: '8px 18px', fontSize: '0.825rem' }}
                >
                  <span>Proceed to Step 4: Diet Planner</span>
                  <span>→</span>
                </button>
              </div>

              {/* Medication Tracking Hub & Checklist */}
              <TimelineView setToastMessage={setToastMessage} />

              {/* Step 4 Bottom Progression Bar */}
              <div style={{
                marginTop: '2rem',
                borderTop: '1px solid var(--border-light, #e2e8f0)',
                paddingTop: '1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <button
                  type="button"
                  className="portal-nav-btn-back"
                  onClick={() => {
                    setActiveStep('followup');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  ← Back to Step 2: Follow-Up Visits
                </button>
                <button
                  type="button"
                  className="btn-hero-launch"
                  onClick={() => {
                    try { playMedicalChime(); } catch (_) {}
                    setActiveStep('diet');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={{ padding: '10px 22px', fontSize: '0.85rem' }}
                >
                  <span>Proceed to Step 4: Diet Planner</span>
                  <span>→</span>
                </button>
              </div>

            </div>
          </div>
        )}

        {/* STEP 5: DIET & NUTRITION TAB */}
        {activeStep === 'diet' && (
          <div className="portal-step-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <span className="portal-step-badge">
                  Step 4 of 5
                </span>
                <h2 className="portal-step-title">
                  4. Post-Discharge Diet &amp; Clinical Nutrition
                </h2>
                <p className="portal-step-subtitle">
                  Tailored meal recommendations, foods that promote tissue healing, and items to strictly avoid with your medications.
                </p>
              </div>

              <button
                type="button"
                className="btn-hero-launch"
                onClick={() => {
                  try { playMedicalChime(); } catch (_) {}
                  setActiveStep('confusion');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ padding: '8px 18px', fontSize: '0.825rem' }}
              >
                <span>Proceed to Step 5: Confusion Guard</span>
                <span>→</span>
              </button>
            </div>

            <DietPlannerView />

            {/* Step 4 Bottom Progression Bar */}
            <div style={{
              marginTop: '2rem',
              borderTop: '1px solid #f1f5f9',
              paddingTop: '1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <button
                type="button"
                onClick={() => {
                  setActiveStep('recovery');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{
                  background: '#f8fafc',
                  color: '#64748b',
                  border: '1px solid #e2e8f0',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px',
                  fontSize: '0.825rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                ← Back to Step 3: Track Medications
              </button>
              <button
                type="button"
                className="btn-hero-launch"
                onClick={() => {
                  try { playMedicalChime(); } catch (_) {}
                  setActiveStep('confusion');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ padding: '10px 22px', fontSize: '0.85rem' }}
              >
                <span>Proceed to Step 5: Confusion Guard</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: CONFUSION SAFETY GUARD TAB */}
        {activeStep === 'confusion' && (
          <div className="portal-step-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <span className="portal-step-badge">
                  Step 5 of 5
                </span>
                <h2 className="portal-step-title">
                  5. Medication Confusion Guard &amp; LASA Drug Safety
                </h2>
                <p className="portal-step-subtitle">
                  Verify high-risk look-alike sound-alike (LASA) pharmaceutical drug confusions to prevent adverse events.
                </p>
              </div>

              <button
                type="button"
                className="btn-hero-launch"
                onClick={() => {
                  playMedicalChime();
                  setToastMessage('🎉 Recovery protocol walkthrough completed!');
                  setActiveStep('overview');
                }}
                style={{ padding: '8px 18px', fontSize: '0.825rem' }}
              >
                <span>✓ Return to Recovery Overview</span>
                <span>→</span>
              </button>
            </div>

            <ConfusionGuardView />

            {/* Step 5 Bottom Progression Bar */}
            <div style={{
              marginTop: '2rem',
              borderTop: '1px solid #f1f5f9',
              paddingTop: '1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <button
                type="button"
                onClick={() => setActiveStep('diet')}
                style={{
                  background: '#f8fafc',
                  color: '#64748b',
                  border: '1px solid #e2e8f0',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px',
                  fontSize: '0.825rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                ← Back to Step 4: Diet &amp; Nutrition
              </button>
              <button
                type="button"
                className="btn-hero-launch"
                onClick={() => {
                  playMedicalChime();
                  setToastMessage('🎉 All 6 recovery protocol steps completed!');
                  setActiveStep('overview');
                }}
                style={{ padding: '10px 22px', fontSize: '0.85rem' }}
              >
                <span>✓ All Steps Completed • Return to Overview</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}

      </main>

      {/* Lightbox Modal for Prescription Document Scan */}
      {previewModalRx && (
        <div 
          className="modal-overlay" 
          onClick={() => setPreviewModalRx(null)}
          style={{ zIndex: 10000 }}
        >
          <div 
            className="modal-dialog" 
            onClick={(e) => e.stopPropagation()} 
            style={{ maxWidth: '640px', width: '90%' }}
          >
            <button 
              type="button" 
              onClick={() => setPreviewModalRx(null)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#94a3b8'
              }}
            >
              ×
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📄</span>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--navy)', margin: 0 }}>
                {previewModalRx.title}
              </h3>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
              Physician: <strong>{previewModalRx.doctor}</strong> • Date: <strong>{previewModalRx.date}</strong>
            </p>

            <div style={{
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              textAlign: 'center',
              maxHeight: '480px'
            }}>
              {previewModalRx.imagePreview ? (
                <img 
                  src={previewModalRx.imagePreview} 
                  alt="Doctor prescription note scan" 
                  style={{ width: '100%', height: 'auto', maxHeight: '480px', objectFit: 'contain', display: 'block' }}
                />
              ) : (
                <div style={{ padding: '3rem 1.5rem', color: '#64748b' }}>
                  <span>📄</span>
                  <p style={{ margin: '8px 0 0 0', fontWeight: 700 }}>No original image preview stored for this digital prescription.</p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => {
                  setPreviewModalRx(null);
                  setActiveStep('verify');
                }}
                className="btn-hero-launch"
                style={{ padding: '8px 16px', fontSize: '0.8rem' }}
              >
                🔍 Analyze in OCR Pipeline
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
