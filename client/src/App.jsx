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
import Footer from './components/Footer';
import DashboardPortal from './components/DashboardPortal';

export default function App() {
  const [activeTab, setActiveTab] = useState('handwritten');
  const [currentLang, setLanguage] = useState('English');
  const [toastMessage, setToastMessage] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);

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
    else if (tabName === 'timeline') mapped = 'reminders';
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
        />
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
      />
    </div>
  );
}
