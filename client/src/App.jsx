import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import QuickActionCards from './components/QuickActionCards';
import AboutTrustSection from './components/AboutTrustSection';
import ServicesGrid from './components/ServicesGrid';
import HandwrittenOCRView from './components/HandwrittenOCRView';
import ConfusionGuardView from './components/ConfusionGuardView';
import TimelineView from './components/TimelineView';
import DietPlannerView from './components/DietPlannerView';
import WhyPatientsChooseUs from './components/WhyPatientsChooseUs';
import ProfileModal from './components/ProfileModal';
import EmergencyModal from './components/EmergencyModal';
import MedicationAlertModal from './components/MedicationAlertModal';
import Footer from './components/Footer';
import DashboardPortal from './components/DashboardPortal';
import { playMedicalChime, triggerBrowserNotification } from './utils/audioChime';
import { getDueMedications, recordDoseFired } from './utils/medicationAlarmEngine';

export default function App() {
  const [activeTab, setActiveTab] = useState('handwritten');
  const [currentLang, setLanguage] = useState('English');
  const [toastMessage, setToastMessage] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);
  const [activeDoseAlert, setActiveDoseAlert] = useState(null);

  // Default user state is NOT logged in (No hardcoded demo patient)
  const [userProfile, setUserProfile] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_user');
      return saved ? JSON.parse(saved) : { name: '', phone: '', diagnosis: '', isLoggedIn: false };
    } catch {
      return { name: '', phone: '', diagnosis: '', isLoggedIn: false };
    }
  });

  // If user is logged in, default directly to 'dashboard'
  const [currentView, setCurrentView] = useState(() => {
    try {
      const savedUser = localStorage.getItem('carebridge_user');
      const savedView = localStorage.getItem('carebridge_current_view');
      if (savedUser) {
        const u = JSON.parse(savedUser);
        if (u?.isLoggedIn || (u?.name && u.name.trim().length > 0)) {
          return savedView || 'dashboard';
        }
      }
    } catch {}
    return 'landing';
  });

  // Keep view choice persisted
  useEffect(() => {
    try {
      localStorage.setItem('carebridge_current_view', currentView);
    } catch {}
  }, [currentView]);

  // Dashboard initial step state
  const [dashboardInitialStep, setDashboardInitialStep] = useState('overview');

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleOpenWorkspace = (tabName) => {
    let mapped = tabName;
    if (tabName === 'handwritten') mapped = 'verify';
    else if (tabName === 'timeline' || tabName === 'reminders') mapped = 'recovery';
    else if (tabName === 'document') mapped = 'upload';
    
    setDashboardInitialStep(mapped);
    setCurrentView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLoginSuccess = (user) => {
    setCurrentView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignOut = () => {
    const cleared = { name: '', phone: '', diagnosis: '', isLoggedIn: false };
    setUserProfile(cleared);
    localStorage.removeItem('carebridge_user');
    localStorage.removeItem('carebridge_auth_token');
    setCurrentView('landing');
    setDashboardInitialStep('overview');
    setToastMessage('Signed out successfully.');
  };

  // Background Medication Alarm Monitor (runs globally every 3 seconds across both starting page and dashboard)
  useEffect(() => {
    const checkScheduledDoses = () => {
      try {
        const saved = localStorage.getItem('carebridge_meds_checklist');
        if (!saved) return;
        const medsList = JSON.parse(saved);
        if (!Array.isArray(medsList) || medsList.length === 0) return;

        const dueMeds = getDueMedications(medsList, new Date());
        if (dueMeds.length > 0) {
          const dueItem = dueMeds[0];
          recordDoseFired(dueItem.id, dueItem.dueTimeSlot || dueItem.time || '', new Date());

          playMedicalChime();
          const cleanDrug = (dueItem.title || dueItem.text || 'Prescribed Medication').split('—')[0].trim();
          triggerBrowserNotification(
            `⏰ Medication Due: ${cleanDrug}`,
            `Scheduled dose: ${dueItem.dose || '1 dose'} at ${dueItem.time || 'now'}. Please take with water.`
          );

          setActiveDoseAlert(dueItem);
          if (typeof setToastMessage === 'function') {
            setToastMessage(`🔔 Time to take your scheduled dose: ${cleanDrug}!`);
          }
        }
      } catch (err) {
        console.warn('Medication alarm ticker error:', err);
      }
    };

    checkScheduledDoses();
    const interval = setInterval(checkScheduledDoses, 3000);

    const handleCustomTestAlarm = (e) => {
      if (e.detail) {
        setActiveDoseAlert(e.detail);
        playMedicalChime();
      }
    };
    window.addEventListener('carebridge_test_alarm', handleCustomTestAlarm);

    return () => {
      clearInterval(interval);
      window.removeEventListener('carebridge_test_alarm', handleCustomTestAlarm);
    };
  }, []);

  const handleMarkTakenFromAlert = (alertItem) => {
    playMedicalChime();
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanDrug = (alertItem.title || alertItem.text || 'Prescribed Medication').split('—')[0].trim();

    try {
      const saved = localStorage.getItem('carebridge_meds_checklist');
      if (saved) {
        const medsList = JSON.parse(saved);
        const updated = medsList.map(m => m.id === alertItem.id ? { ...m, done: true } : m);
        localStorage.setItem('carebridge_meds_checklist', JSON.stringify(updated));
      }

      const savedLogs = localStorage.getItem('carebridge_activity_logs');
      const listLogs = savedLogs ? JSON.parse(savedLogs) : [];
      const updatedLogs = [`Took dose: ${cleanDrug} at ${nowStr}`, ...listLogs.slice(0, 6)];
      localStorage.setItem('carebridge_activity_logs', JSON.stringify(updatedLogs));

      window.dispatchEvent(new Event('carebridge_meds_updated'));
    } catch (e) {
      console.error(e);
    }

    setActiveDoseAlert(null);
    if (typeof setToastMessage === 'function') {
      setToastMessage(`✅ Dose marked completed: ${cleanDrug}`);
    }
  };

  const handleSnoozeFromAlert = (alertItem, minutes = 5) => {
    setActiveDoseAlert(null);
    const cleanDrug = (alertItem.title || alertItem.text || 'Prescribed Medication').split('—')[0].trim();
    if (typeof setToastMessage === 'function') {
      setToastMessage(`⏰ Snoozed ${cleanDrug} for ${minutes} minutes.`);
    }
    setTimeout(() => {
      setActiveDoseAlert(alertItem);
      playMedicalChime();
    }, minutes * 60 * 1000);
  };

  // If viewing the patient recovery dashboard
  if (currentView === 'dashboard') {
    return (
      <div className="carebridge-app">
        {/* Floating Toast Notification */}
        {toastMessage && (
          <div style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 9999,
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.875rem',
            fontWeight: 700,
            maxWidth: '420px',
            border: '1px solid rgba(255, 255, 255, 0.15)'
          }}>
            <span>{toastMessage}</span>
            <button 
              onClick={() => setToastMessage('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, color: '#ffffff', fontSize: '1rem', padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
        )}

        <DashboardPortal 
          userProfile={userProfile}
          setUserProfile={setUserProfile}
          onViewLandingPage={() => setCurrentView('landing')}
          openEmergencyModal={() => setIsEmergencyOpen(true)}
          openProfileModal={() => setIsProfileOpen(true)}
          setToastMessage={setToastMessage}
          onSignOut={handleSignOut}
          initialStep={dashboardInitialStep}
        />

        <ProfileModal 
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          userProfile={userProfile}
          setUserProfile={setUserProfile}
          setToastMessage={setToastMessage}
          onLoginSuccess={handleLoginSuccess}
        />

        <EmergencyModal 
          isOpen={isEmergencyOpen}
          onClose={() => setIsEmergencyOpen(false)}
          userProfile={userProfile}
          setToastMessage={setToastMessage}
        />

        {/* Global In-App Medication Dose Alert Modal */}
        {activeDoseAlert && (
          <MedicationAlertModal
            alertItem={activeDoseAlert}
            onMarkTaken={handleMarkTakenFromAlert}
            onSnooze={handleSnoozeFromAlert}
            onClose={() => setActiveDoseAlert(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="carebridge-landing-page">
      {/* 1. Main Navigation Bar */}
      <Navbar 
        activeTab={activeTab}
        setActiveTab={handleOpenWorkspace}
        userProfile={userProfile}
        setUserProfile={setUserProfile}
        openProfileModal={() => setIsProfileOpen(true)}
        openEmergencyModal={() => setIsEmergencyOpen(true)}
        setToastMessage={setToastMessage}
        onOpenDashboard={() => setCurrentView('dashboard')}
        onSignOut={handleSignOut}
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div style={{
          background: 'linear-gradient(90deg, #ecfdf5 0%, #e0f2fe 100%)',
          borderBottom: '1px solid #a7f3d0',
          padding: '10px 3rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.875rem',
          color: '#065f46',
          fontWeight: 700
        }}>
          <span>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, color: '#065f46' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Hero Section (Clean Dribbble Layout with Call-To-Action) */}
      <Hero 
        onOpenWorkspace={handleOpenWorkspace} 
        isLoggedIn={Boolean(userProfile?.isLoggedIn || userProfile?.name)}
        onOpenDashboard={() => setCurrentView('dashboard')}
      />

      {/* 3. Floating Quick Action Cards (Routes to Patient Portal) */}
      <QuickActionCards 
        onOpenWorkspace={handleOpenWorkspace} 
        openEmergencyModal={() => setIsEmergencyOpen(true)}
      />

      {/* 4. About Us Section (Hospital Team Photo & TrustScore) */}
      <AboutTrustSection onOpenWorkspace={handleOpenWorkspace} />

      {/* 5. Services Grid (6 Clinical Recovery Pillars) */}
      <ServicesGrid onOpenWorkspace={handleOpenWorkspace} />

      {/* 6. Why Our Patients Recommend Us */}
      <WhyPatientsChooseUs onOpenWorkspace={handleOpenWorkspace} />

      {/* 7. Hospital Footer */}
      <Footer onOpenWorkspace={handleOpenWorkspace} />

      {/* Modals */}
      <ProfileModal 
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        userProfile={userProfile}
        setUserProfile={setUserProfile}
        setToastMessage={setToastMessage}
        onLoginSuccess={handleLoginSuccess}
      />

      <EmergencyModal 
        isOpen={isEmergencyOpen}
        onClose={() => setIsEmergencyOpen(false)}
        userProfile={userProfile}
        setToastMessage={setToastMessage}
      />

      {/* Global In-App Medication Dose Alert Modal */}
      {activeDoseAlert && (
        <MedicationAlertModal
          alertItem={activeDoseAlert}
          onMarkTaken={handleMarkTakenFromAlert}
          onSnooze={handleSnoozeFromAlert}
          onClose={() => setActiveDoseAlert(null)}
        />
      )}
    </div>
  );
}
