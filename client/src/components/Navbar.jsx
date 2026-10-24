import React, { useState, useEffect } from 'react';
import { playMedicalChime } from '../utils/audioChime';

export default function Navbar({
  activeTab,
  setActiveTab,
  userProfile,
  setUserProfile,
  openProfileModal,
  openEmergencyModal,
  setToastMessage,
  onOpenDashboard,
  onSignOut,
  theme = 'light',
  setTheme
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    if (setTheme) {
      setTheme(nextTheme);
    }
    if (setToastMessage) {
      setToastMessage(nextTheme === 'dark' ? "🌙 Dark Mode activated" : "☀️ Day Mode activated");
    }
  };
  const [alertsEnabled, setAlertsEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_in_app_alerts_enabled');
      return saved !== 'false';
    } catch {
      return true;
    }
  });
  const [alertsDropdownOpen, setAlertsDropdownOpen] = useState(false);
  const [upcomingMeds, setUpcomingMeds] = useState([]);

  // Sync upcoming medications and outside click handling
  useEffect(() => {
    const updateUpcoming = () => {
      try {
        const saved = localStorage.getItem('carebridge_meds_checklist');
        if (saved) {
          const list = JSON.parse(saved);
          if (Array.isArray(list)) {
            setUpcomingMeds(list.filter(m => !m.done));
          }
        }
      } catch {}
    };
    updateUpcoming();
    window.addEventListener('carebridge_meds_updated', updateUpcoming);
    return () => window.removeEventListener('carebridge_meds_updated', updateUpcoming);
  }, []);

  useEffect(() => {
    if (!alertsDropdownOpen) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.nav-alerts-wrapper')) {
        setAlertsDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [alertsDropdownOpen]);

  const handleToggleAlerts = (e) => {
    if (e) e.stopPropagation();
    const nextState = !alertsEnabled;
    setAlertsEnabled(nextState);
    try {
      localStorage.setItem('carebridge_in_app_alerts_enabled', nextState ? 'true' : 'false');
      window.dispatchEvent(new Event('carebridge_alerts_toggled'));
    } catch {}

    if (nextState) {
      playMedicalChime();
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }
      if (setToastMessage) setToastMessage("🔔 In-App Medication Alerts: Allowed & Active!");
    } else {
      if (setToastMessage) setToastMessage("🔕 In-App Medication Alerts: Muted");
    }
  };

  const handleTriggerTestFromNav = (e) => {
    if (e) e.stopPropagation();
    setAlertsDropdownOpen(false);
    const firstMed = upcomingMeds[0] || {
      id: 'test_' + Date.now(),
      title: 'Diclofenac 50mg',
      dose: '1 tablet (50mg)',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      instructions: 'Take with water after meals.'
    };
    window.dispatchEvent(new CustomEvent('carebridge_test_alarm', { detail: firstMed }));
    if (setToastMessage) setToastMessage("🔔 In-app dose reminder test triggered!");
  };

  const handleTestChime = () => {
    playMedicalChime();
    setToastMessage("🔔 Medical chime sound tested successfully!");
  };

  const scrollToSection = (tabId, elementId) => {
    setActiveTab(tabId);
    setMobileMenuOpen(false);
    if (elementId) {
      setTimeout(() => {
        const el = document.getElementById(elementId);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
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
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  };

  // Get 2-letter initials
  const getInitials = (nameStr) => {
    if (!nameStr) return 'P';
    const parts = nameStr.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  };

  return (
    <nav className="navbar-dribbble">
      <div className="navbar-container">
        {/* Brand Logo */}
        <div 
          className="logo-dribbble" 
          onClick={() => scrollToSection('home', 'hero-section')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flexShrink: 0 }}
        >
          <div className="logo-cross-icon" style={{
            width: '34px',
            height: '34px',
            background: '#4f46e5',
            borderRadius: '9px',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.15rem',
            fontWeight: 900,
            boxShadow: '0 4px 10px rgba(79, 70, 229, 0.3)'
          }}>
            ✚
          </div>
          <div className="logo-text" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.5px', color: '#1e1b4b', textTransform: 'uppercase' }}>
            <span>CareBridge</span>
            <span style={{ color: '#4f46e5', marginLeft: '6px' }}>AI</span>
          </div>
        </div>

        {/* Desktop Nav Menu */}
        <ul className="nav-menu-dribbble">
          <li>
            <button
              className={`nav-link-btn ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => scrollToSection('home', 'hero-section')}
            >
              Home
            </button>
          </li>
          <li>
            <button
              className="nav-link-btn"
              onClick={() => scrollToSection('about', 'about-section')}
            >
              About
            </button>
          </li>
          <li>
            <button
              className="nav-link-btn"
              onClick={() => scrollToSection('prescriptions')}
            >
              Prescriptions
            </button>
          </li>
          <li>
            <button
              className={`nav-link-btn ${activeTab === 'verify' ? 'active' : ''}`}
              onClick={() => scrollToSection('verify')}
            >
              Handwritten OCR
            </button>
          </li>
          <li>
            <button
              className={`nav-link-btn ${activeTab === 'confusion' ? 'active' : ''}`}
              onClick={() => scrollToSection('confusion')}
            >
              Confusion Guard
            </button>
          </li>
          <li>
            <button
              className={`nav-link-btn ${activeTab === 'recovery' ? 'active' : ''}`}
              onClick={() => scrollToSection('recovery')}
            >
              Track Medications
            </button>
          </li>
          <li>
            <button
              className={`nav-link-btn ${activeTab === 'diet' ? 'active' : ''}`}
              onClick={() => scrollToSection('diet')}
            >
              Diet Plan
            </button>
          </li>
        </ul>

        {/* Right Actions: Search, Bell Icon for In-App Alerts, Profile / Sign In */}
        <div className="navbar-right-actions">
          <div className="search-box-pill desktop-only">
            <input
              type="text"
              placeholder="Search..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  scrollToSection('confusion', 'workspace-section');
                }
              }}
            />
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>🔍</span>
          </div>

          {/* Day / Dark Mode Toggle Button */}
          <button
            type="button"
            className="btn-theme-toggle"
            onClick={handleToggleTheme}
            title={theme === 'dark' ? "Switch to Day Mode (Light)" : "Switch to Dark Mode"}
            aria-label="Toggle dark and day mode"
          >
            <span className="theme-toggle-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span className="desktop-only theme-toggle-text">
              {theme === 'dark' ? 'Day' : 'Dark'}
            </span>
          </button>

          {/* In-App Alerts Bell Icon (Before Sign In key) */}
          <div className="nav-alerts-wrapper" style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn-nav-alerts-bell"
              onClick={() => setAlertsDropdownOpen(!alertsDropdownOpen)}
              title={alertsEnabled ? "In-App Alerts: Allowed (Click to manage)" : "In-App Alerts: Muted (Click to allow)"}
              style={{
                background: alertsEnabled ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' : '#f1f5f9',
                border: `1.5px solid ${alertsEnabled ? '#f59e0b' : '#cbd5e1'}`,
                borderRadius: '8px',
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: alertsEnabled ? '#92400e' : '#64748b',
                fontWeight: 700,
                fontSize: '0.825rem',
                transition: 'all 0.2s ease',
                boxShadow: alertsEnabled ? '0 2px 8px rgba(245, 158, 11, 0.25)' : 'none'
              }}
            >
              <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{alertsEnabled ? '🔔' : '🔕'}</span>
              <span className="desktop-only alerts-toggle-text" style={{ fontSize: '0.8rem', fontWeight: 800 }}>
                {alertsEnabled ? 'Alerts ON' : 'Alerts OFF'}
              </span>
              {alertsEnabled && (
                <span style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 6px #10b981'
                }} />
              )}
            </button>

            {/* Dropdown Menu on Click */}
            {alertsDropdownOpen && (
              <div 
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '310px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  boxShadow: '0 12px 30px rgba(0, 0, 0, 0.15)',
                  padding: '1rem',
                  zIndex: 10001,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  animation: 'fadeIn 0.2s ease'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '1.1rem' }}>🔔</span>
                    <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>In-App Medication Alerts</strong>
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: alertsEnabled ? '#dcfce7' : '#f1f5f9',
                    color: alertsEnabled ? '#15803d' : '#64748b'
                  }}>
                    {alertsEnabled ? '🟢 ACTIVE' : '⚪ MUTED'}
                  </span>
                </div>

                {/* Master Allow / Mute Switch */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#f8fafc',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0'
                }}>
                  <div>
                    <div style={{ fontSize: '0.825rem', fontWeight: 700, color: '#1e293b' }}>
                      Allow In-App Alerts
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      Sound chime & modal at dose time
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleAlerts}
                    style={{
                      background: alertsEnabled ? '#10b981' : '#94a3b8',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '20px',
                      padding: '4px 12px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {alertsEnabled ? 'Allowed ✓' : 'Allow Alerts'}
                  </button>
                </div>

                {/* Upcoming Schedule Info */}
                <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    Scheduled Doses ({upcomingMeds.length}):
                  </div>
                  {upcomingMeds.length === 0 ? (
                    <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No active medications in checklist.</div>
                  ) : (
                    <div style={{ maxHeight: '110px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {upcomingMeds.slice(0, 4).map(m => (
                        <div key={m.id} style={{ background: '#f8fafc', padding: '4px 8px', borderRadius: '4px', fontSize: '0.72rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                            {m.title || m.text}
                          </span>
                          <span style={{ color: '#4f46e5', fontWeight: 700 }}>
                            {m.time || m.schedule || 'Scheduled'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Action: Test In-App Alert */}
                <button
                  type="button"
                  onClick={handleTriggerTestFromNav}
                  style={{
                    background: '#e0e7ff',
                    color: '#3730a3',
                    border: '1px solid #c7d2fe',
                    borderRadius: '8px',
                    padding: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🔔</span> Test In-App Alert Now
                </button>
              </div>
            )}
          </div>

          {/* User Sign In / Profile dropdown */}
          {!userProfile?.isLoggedIn && !userProfile?.name ? (
            <button
              className="btn-signin-pill"
              onClick={openProfileModal}
              title="Sign in to your patient account"
            >
              <span className="signin-icon" style={{ fontSize: '0.9rem' }}>🔑</span>
              <span>Sign In</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {onOpenDashboard && (
                <button
                  type="button"
                  className="btn-nav-dashboard desktop-only"
                  onClick={onOpenDashboard}
                  style={{
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '7px 14px',
                    fontSize: '0.825rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>Patient Dashboard →</span>
                </button>
              )}

              <div className="user-menu-wrapper">
                <button
                  className="user-pill-btn"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#f8fafc',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: '9999px',
                    padding: '4px 8px 4px 4px',
                    cursor: 'pointer'
                  }}
                >
                  <div className="user-avatar-initials" style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: '#4f46e5',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {getInitials(userProfile.name)}
                  </div>
                  <span className="user-name-text desktop-only" style={{
                    fontSize: '0.825rem',
                    fontWeight: 700,
                    color: '#1e293b',
                    maxWidth: '90px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {userProfile.name}
                  </span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>⌵</span>
                </button>

                {dropdownOpen && (
                  <div className="user-dropdown-card">
                    <div className="dropdown-user-header">
                      <strong>{userProfile.name}</strong>
                      <span>{userProfile.diagnosis || 'Post-Discharge Recovery'}</span>
                      {userProfile.phone && <span>📞 {userProfile.phone}</span>}
                    </div>

                    {onOpenDashboard && (
                      <button
                        className="dropdown-item-btn"
                        onClick={() => {
                          setDropdownOpen(false);
                          onOpenDashboard();
                        }}
                      >
                        📊 Open Recovery Dashboard
                      </button>
                    )}

                    <button
                      className="dropdown-item-btn"
                      onClick={() => {
                        setDropdownOpen(false);
                        scrollToSection('timeline', 'workspace-section');
                      }}
                    >
                      ⏰ My Recovery Timetable
                    </button>

                    <button
                      className="dropdown-item-btn"
                      onClick={() => {
                        setDropdownOpen(false);
                        openProfileModal();
                      }}
                    >
                      ⚙️ Edit Clinical Profile
                    </button>

                    <button
                      className="dropdown-item-btn signout"
                      onClick={handleSignOut}
                    >
                      🚪 Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile Hamburger Button */}
          <button
            className="mobile-hamburger-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="mobile-nav-drawer">
          {/* Day / Dark Mode Switcher Card in Mobile Drawer */}
          <div className="mobile-drawer-theme-card">
            <span style={{ fontSize: '0.825rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🎨</span> Appearance:
            </span>
            <div className="mobile-theme-pills">
              <button
                type="button"
                className={`mobile-theme-pill ${theme !== 'dark' ? 'active' : ''}`}
                onClick={() => {
                  if (setTheme) setTheme('light');
                  if (setToastMessage) setToastMessage("☀️ Day Mode activated");
                }}
              >
                ☀️ Day Mode
              </button>
              <button
                type="button"
                className={`mobile-theme-pill ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => {
                  if (setTheme) setTheme('dark');
                  if (setToastMessage) setToastMessage("🌙 Dark Mode activated");
                }}
              >
                🌙 Dark Mode
              </button>
            </div>
          </div>

          {/* Sign In CTA Banner at top of Mobile Menu if not logged in */}
          {!userProfile?.isLoggedIn && !userProfile?.name ? (
            <div style={{
              background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
              border: '1.5px solid #c7d2fe',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px'
            }}>
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e1b4b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🔑</span> Patient Sign In
                </div>
                <div style={{ fontSize: '0.72rem', color: '#4338ca' }}>
                  Access your prescriptions & alarms
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openProfileModal();
                }}
                style={{
                  background: '#4f46e5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)'
                }}
              >
                Sign In →
              </button>
            </div>
          ) : (
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '10px 14px',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#4f46e5',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {getInitials(userProfile.name)}
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>{userProfile.name}</div>
                  <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 700 }}>● Active Patient</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openProfileModal();
                }}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#475569',
                  cursor: 'pointer'
                }}
              >
                Edit Profile
              </button>
            </div>
          )}

          <ul className="mobile-nav-list">
            <li>
              <button
                className={`mobile-nav-link ${activeTab === 'home' ? 'active' : ''}`}
                onClick={() => scrollToSection('home', 'hero-section')}
              >
                🏠 Home
              </button>
            </li>
            <li>
              <button
                className="mobile-nav-link"
                onClick={() => scrollToSection('about', 'about-section')}
              >
                ℹ️ About CareBridge
              </button>
            </li>
            <li>
              <button
                className="mobile-nav-link"
                onClick={() => scrollToSection('prescriptions')}
              >
                💊 Latest Prescriptions
              </button>
            </li>
            <li>
              <button
                className={`mobile-nav-link ${activeTab === 'verify' ? 'active' : ''}`}
                onClick={() => scrollToSection('verify')}
              >
                📝 Handwritten Prescription OCR
              </button>
            </li>
            <li>
              <button
                className={`mobile-nav-link ${activeTab === 'confusion' ? 'active' : ''}`}
                onClick={() => scrollToSection('confusion')}
              >
                🧠 Confusion &amp; LASA Guard
              </button>
            </li>
            <li>
              <button
                className={`mobile-nav-link ${activeTab === 'recovery' ? 'active' : ''}`}
                onClick={() => scrollToSection('recovery')}
              >
                💊 Track Prescribed Medications
              </button>
            </li>
            <li>
              <button
                className={`mobile-nav-link ${activeTab === 'diet' ? 'active' : ''}`}
                onClick={() => scrollToSection('diet')}
              >
                🥗 Clinical Diet Planner
              </button>
            </li>
          </ul>

          <div className="mobile-drawer-footer">
            {!userProfile?.isLoggedIn && !userProfile?.name ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openProfileModal();
                }}
                className="btn-mobile-action"
                style={{ background: '#4f46e5', color: '#ffffff', fontWeight: 800 }}
              >
                🔑 Sign In to Patient Account
              </button>
            ) : (
              onOpenDashboard && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenDashboard();
                  }}
                  className="btn-mobile-action"
                  style={{ background: '#4f46e5', color: '#ffffff', fontWeight: 800 }}
                >
                  📊 Open Recovery Dashboard
                </button>
              )
            )}

            <button
              type="button"
              onClick={() => {
                handleTestChime();
                setMobileMenuOpen(false);
              }}
              className="btn-mobile-action"
            >
              🔔 Test Medical Chime Audio
            </button>

            {userProfile?.isLoggedIn && (
              <button
                type="button"
                onClick={handleSignOut}
                className="btn-mobile-action signout"
              >
                🚪 Sign Out ({userProfile.name})
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
