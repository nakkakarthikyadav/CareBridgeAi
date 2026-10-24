import React, { useState, useEffect, useRef } from 'react';
import { playMedicalChime, triggerBrowserNotification } from '../utils/audioChime';
import { resetFiredDose, isDoseDueAtTime } from '../utils/medicationAlarmEngine';

const cleanLabel = (text) => {
  if (!text) return '';
  return text
    .replace(/\b(\d+)\s*(mg|mcg|ml|g)\b\s+\1\s*\2\b/gi, '$1 $2')
    .replace(/(\b\d+\s*(?:mg|mcg|ml|g)\b)\s+\1/gi, '$1')
    .trim();
};

const getItemLabel = (item) => {
  if (!item) return '';
  if (typeof item === 'string') return cleanLabel(item);
  const raw = item.text || item.title || item.name || item.drugName || item.task || '';
  return cleanLabel(raw);
};

export default function TimelineView({ setToastMessage }) {
  const [meds, setMeds] = useState(() => {
    try {
      // 1. Check for real uploaded prescriptions
      const rxSaved = localStorage.getItem('carebridge_portal_prescriptions');
      let rxExtracted = [];
      if (rxSaved) {
        const rxs = JSON.parse(rxSaved).filter(p => p.id !== 'rx_1' && p.id !== 'rx_2' && !(p.title === 'Hospital Discharge Prescription' && p.doctor === 'Attending Physician' && !p.imagePreview));
        rxExtracted = rxs.flatMap(rx => (rx.medications || []).map((m, idx) => {
          const drugName = m.name || m.drugName || 'Medication';
          const hasDosage = m.dosage && (drugName.toLowerCase().includes(m.dosage.toLowerCase().replace(/\s+/g, '')) || drugName.toLowerCase().includes(m.dosage.toLowerCase()));
          const dosageStr = (m.dosage && m.dosage !== 'As directed' && !hasDosage) ? ` ${m.dosage}` : '';
          const label = cleanLabel(`${drugName}${dosageStr}`);
          return {
            id: `rx_med_${rx.id}_${idx}`,
            title: label,
            text: label,
            time: m.schedule?.toLowerCase().includes('night') || m.schedule?.toLowerCase().includes('evening') ? '08:00 PM' : '08:00 AM',
            dose: m.dosage || '1 dose',
            schedule: m.schedule || m.frequency || '',
            instructions: m.instructions || m.purpose || '',
            done: false,
            alarmEnabled: true
          };
        }));
      }

      // 2. Check saved checklist
      const saved = localStorage.getItem('carebridge_meds_checklist');
      if (saved) {
        const parsed = JSON.parse(saved);
        const filtered = parsed.filter(m => !['m1', 'm2', 'm3', 'm4'].includes(m.id));
        const hasRealMeds = filtered.some(m => !m.title?.toLowerCase().includes('pantoprazole 40'));
        if (filtered.length > 0 && (hasRealMeds || rxExtracted.length === 0)) {
          return filtered.map(m => {
            const label = getItemLabel(m) || 'Prescribed Medication';
            return {
              ...m,
              title: label,
              text: label
            };
          });
        }
      }

      if (rxExtracted.length > 0) return rxExtracted;
    } catch {}
    return [];
  });

  const [advice, setAdvice] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_advice_checklist');
      if (saved) {
        const parsed = JSON.parse(saved);
        const filtered = parsed.filter(a => !['a1', 'a2', 'a3', 'a4'].includes(a.id));
        if (filtered.length > 0) {
          return filtered.map(a => {
            const label = getItemLabel(a) || 'Discharge Advice';
            return {
              ...a,
              title: label,
              text: label
            };
          });
        }
      }
      // Auto-extract advice from prescriptions if checklist is empty
      const rxSaved = localStorage.getItem('carebridge_portal_prescriptions');
      if (rxSaved) {
        const rxs = JSON.parse(rxSaved).filter(p => p.id !== 'rx_1' && p.id !== 'rx_2' && !(p.title === 'Hospital Discharge Prescription' && p.doctor === 'Attending Physician' && !p.imagePreview));
        const extracted = rxs.flatMap(rx => (rx.dailyCareChecklist || []).map((task, idx) => ({
          id: `rx_adv_${rx.id}_${idx}`,
          title: task,
          text: task,
          time: 'Daily Care',
          done: false
        })));
        if (extracted.length > 0) return extracted;
      }
    } catch {}
    return [];
  });

  const [diet, setDiet] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_diet_checklist');
      if (saved) {
        const parsed = JSON.parse(saved);
        const filtered = parsed.filter(d => !['d1', 'd2'].includes(d.id));
        if (filtered.length > 0) {
          return filtered.map(d => {
            const label = getItemLabel(d) || 'Dietary Rule';
            return {
              ...d,
              title: label,
              text: label
            };
          });
        }
      }
      // Auto-extract diet restrictions from prescriptions if empty
      const rxSaved = localStorage.getItem('carebridge_portal_prescriptions');
      if (rxSaved) {
        const rxs = JSON.parse(rxSaved).filter(p => p.id !== 'rx_1' && p.id !== 'rx_2' && !(p.title === 'Hospital Discharge Prescription' && p.doctor === 'Attending Physician' && !p.imagePreview));
        const extracted = rxs.flatMap(rx => (rx.dietaryRestrictions || []).map((rule, idx) => ({
          id: `rx_diet_${rx.id}_${idx}`,
          title: rule,
          text: rule,
          time: 'Diet Protocol',
          done: false
        })));
        if (extracted.length > 0) return extracted;
      }
    } catch {}
    return [];
  });

  const [activityLogs, setActivityLogs] = useState(() => {
    const saved = localStorage.getItem('carebridge_activity_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const [currentTimeStr, setCurrentTimeStr] = useState(() => 
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  const [notifPermission, setNotifPermission] = useState(() => {
    return typeof Notification !== 'undefined' ? Notification.permission : 'default';
  });

  // Adding new custom item state
  const [newItemText, setNewItemText] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('meds'); // 'meds' | 'advice' | 'diet'
  const [newItemTime, setNewItemTime] = useState(() => 
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const [showAddForm, setShowAddForm] = useState(false);

  // Live Clock ticker every second
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  const isInternalUpdate = useRef(false);

  // Listen for sync events dispatched when an alert marks a dose done or external updates occur
  useEffect(() => {
    const handleMedsSync = () => {
      if (isInternalUpdate.current) {
        isInternalUpdate.current = false;
        return;
      }
      try {
        const saved = localStorage.getItem('carebridge_meds_checklist');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setMeds(parsed);
          }
        }
        const savedLogs = localStorage.getItem('carebridge_activity_logs');
        if (savedLogs) {
          const parsedLogs = JSON.parse(savedLogs);
          if (Array.isArray(parsedLogs)) {
            setActivityLogs(parsedLogs);
          }
        }
      } catch {}
    };
    window.addEventListener('carebridge_meds_updated', handleMedsSync);
    return () => window.removeEventListener('carebridge_meds_updated', handleMedsSync);
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('carebridge_meds_checklist', JSON.stringify(meds));
    localStorage.setItem('carebridge_advice_checklist', JSON.stringify(advice));
    localStorage.setItem('carebridge_diet_checklist', JSON.stringify(diet));
    localStorage.setItem('carebridge_activity_logs', JSON.stringify(activityLogs));
  }, [meds, advice, diet, activityLogs]);

  const allItems = [...meds, ...advice];
  const completedCount = allItems.filter(i => i.done).length;
  const totalCount = allItems.length;
  const adherenceRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const toggleItem = (id, listType) => {
    playMedicalChime();
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (listType === 'meds') {
      setMeds(prev => prev.map(item => {
        if (item.id === id) {
          const newDone = !item.done;
          if (newDone) {
            const label = getItemLabel(item);
            const shortName = label.split('—')[0].trim() || 'Medication dose';
            logAction(`Took dose: ${shortName} at ${nowStr}`);
            if (setToastMessage) {
              setToastMessage(`✅ Marked dose completed: ${shortName}`);
            }
          }
          return { ...item, done: newDone };
        }
        return item;
      }));
    } else if (listType === 'advice') {
      setAdvice(prev => prev.map(item => {
        if (item.id === id) {
          const newDone = !item.done;
          if (newDone) {
            const label = getItemLabel(item);
            logAction(`Completed: ${label.slice(0, 45)}... at ${nowStr}`);
          }
          return { ...item, done: newDone };
        }
        return item;
      }));
    } else if (listType === 'diet') {
      setDiet(prev => prev.map(item => {
        if (item.id === id) {
          const newDone = !item.done;
          if (newDone) {
            const label = getItemLabel(item);
            logAction(`Adhered to: ${label.slice(0, 40)}... at ${nowStr}`);
          }
          return { ...item, done: newDone };
        }
        return item;
      }));
    }
  };

  const toggleAlarm = (e, itemId) => {
    e.stopPropagation();
    setMeds(prev => {
      const updated = prev.map(item => {
        if (item.id === itemId) {
          const nextState = item.alarmEnabled === false ? true : false;
          if (nextState) {
            playMedicalChime();
            if (setToastMessage) setToastMessage(`🔔 Alarm enabled for ${getItemLabel(item)}`);
          } else {
            if (setToastMessage) setToastMessage(`🔕 Alarm muted for ${getItemLabel(item)}`);
          }
          return { ...item, alarmEnabled: nextState };
        }
        return item;
      });
      return updated;
    });
  };

  const logAction = (text) => {
    setActivityLogs(prev => [text, ...prev.slice(0, 6)]);
  };

  const getFormattedCurrentMinute = (offsetMinutes = 0) => {
    const d = new Date(Date.now() + offsetMinutes * 60000);
    const h24 = d.getHours();
    const m = d.getMinutes();
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    const hPad = h12 < 10 ? '0' + h12 : h12;
    const mPad = m < 10 ? '0' + m : m;
    return `${hPad}:${mPad} ${ampm}`;
  };

  const handleToggleItemAmPm = (e, itemId) => {
    e.stopPropagation();
    playMedicalChime();
    resetFiredDose(itemId);
    isInternalUpdate.current = true;

    let targetUpdated = null;
    const updated = meds.map(item => {
      if (item.id === itemId) {
        const currentTimeStr = item.time || '';
        let newTime = currentTimeStr;
        if (/am/i.test(currentTimeStr)) {
          newTime = currentTimeStr.replace(/\s*am/gi, ' PM');
        } else if (/pm/i.test(currentTimeStr)) {
          newTime = currentTimeStr.replace(/\s*pm/gi, ' AM');
        } else {
          newTime = `${currentTimeStr} PM`;
        }
        if (setToastMessage) {
          setToastMessage(`Updated ${getItemLabel(item)} time to ${newTime}`);
        }
        targetUpdated = { ...item, time: newTime, done: false };
        return targetUpdated;
      }
      return item;
    });

    try {
      localStorage.setItem('carebridge_meds_checklist', JSON.stringify(updated));
    } catch {}
    setMeds(updated);
    window.dispatchEvent(new Event('carebridge_meds_updated'));

    if (targetUpdated && isDoseDueAtTime(targetUpdated.time, new Date())) {
      window.dispatchEvent(new CustomEvent('carebridge_test_alarm', { detail: targetUpdated }));
    }
  };

  const handleSetItemTimeToNow = (e, itemId) => {
    e.stopPropagation();
    playMedicalChime();
    resetFiredDose(itemId);
    isInternalUpdate.current = true;

    const nowTime = getFormattedCurrentMinute(0);
    let targetItem = null;
    const updated = meds.map(item => {
      if (item.id === itemId) {
        if (setToastMessage) {
          setToastMessage(`🔔 Set ${getItemLabel(item)} to current time (${nowTime})! Alert triggered.`);
        }
        targetItem = { ...item, time: nowTime, done: false };
        return targetItem;
      }
      return item;
    });

    try {
      localStorage.setItem('carebridge_meds_checklist', JSON.stringify(updated));
    } catch {}
    setMeds(updated);
    window.dispatchEvent(new Event('carebridge_meds_updated'));

    if (targetItem) {
      window.dispatchEvent(new CustomEvent('carebridge_test_alarm', { detail: targetItem }));
    }
  };

  const handleAddItem = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const label = (newItemText || '').trim() || 'Prescribed Medication';
    const finalTime = (newItemTime || '').trim() || getFormattedCurrentMinute(0);
    const newItem = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      text: label,
      title: label,
      category: newItemCategory === 'meds' ? 'Confirmed Medications' : newItemCategory === 'advice' ? 'Discharge Advice' : 'Diet & Lifestyle',
      done: false,
      alarmEnabled: true,
      ...(newItemCategory === 'meds' ? { time: finalTime, dose: '1 dose' } : {})
    };

    resetFiredDose(newItem.id);
    playMedicalChime();
    isInternalUpdate.current = true;

    if (newItemCategory === 'meds') {
      const updated = [...meds, newItem];
      try {
        localStorage.setItem('carebridge_meds_checklist', JSON.stringify(updated));
      } catch {}
      setMeds(updated);
    } else if (newItemCategory === 'advice') {
      const updated = [...advice, newItem];
      try {
        localStorage.setItem('carebridge_advice_checklist', JSON.stringify(updated));
      } catch {}
      setAdvice(updated);
    } else {
      const updated = [...diet, newItem];
      try {
        localStorage.setItem('carebridge_diet_checklist', JSON.stringify(updated));
      } catch {}
      setDiet(updated);
    }

    if (setToastMessage) {
      setToastMessage(`✅ Added ${label} to checklist (Scheduled: ${finalTime})`);
    }
    setNewItemText('');
    setShowAddForm(false);

    // Sync across navbar and other views
    window.dispatchEvent(new Event('carebridge_meds_updated'));

    // If scheduled time is right now or due now, trigger in-app alert immediately!
    if (newItemCategory === 'meds' && isDoseDueAtTime(finalTime, new Date())) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('carebridge_test_alarm', { detail: newItem }));
      }, 300);
    }
  };

  const handleMarkAllDone = () => {
    playMedicalChime();
    setMeds(prev => prev.map(i => ({ ...i, done: true })));
    setAdvice(prev => prev.map(i => ({ ...i, done: true })));
    setDiet(prev => prev.map(i => ({ ...i, done: true })));
    logAction(`All tasks marked completed for today at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    if (setToastMessage) {
      setToastMessage('🎉 Outstanding! 100% adherence achieved for today.');
    }
  };

  const handleReset = () => {
    setMeds(prev => prev.map(i => ({ ...i, done: false })));
    setAdvice(prev => prev.map(i => ({ ...i, done: false })));
    setDiet(prev => prev.map(i => ({ ...i, done: false })));
    if (setToastMessage) {
      setToastMessage('Checklist reset for new cycle.');
    }
  };

  const handleTestAlarmClick = () => {
    const sampleMed = meds.find(m => !m.done) || meds[0] || {
      id: 'demo_dose_' + Date.now(),
      title: 'Diclofenac 50mg',
      dose: '1 tablet (50mg)',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      instructions: 'Take immediately after food with plenty of water.'
    };

    window.dispatchEvent(new CustomEvent('carebridge_test_alarm', { detail: sampleMed }));
    if (setToastMessage) {
      setToastMessage('🔔 Triggered test in-app alert and audible chime!');
    }
  };

  const handleRequestPermission = async () => {
    if (typeof Notification !== 'undefined') {
      try {
        const res = await Notification.requestPermission();
        setNotifPermission(res);
        if (res === 'granted' && setToastMessage) {
          setToastMessage('✅ Desktop push notifications enabled for CareBridge!');
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };

  return (
    <div className="recovery-journey-wrapper">
      <div className="recovery-journey-grid">
        
        {/* Left Column: Daily Recovery Checklist */}
        <div className="checklist-column">
          
          {/* Live In-App Alarm & Scheduler Monitor Banner */}
          <div style={{
            background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
            border: '1px solid #a7f3d0',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}></span>
                <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#065f46' }}>
                  Smart Medication Alarm Engine: Active
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#047857', background: '#d1fae5', padding: '3px 10px', borderRadius: '6px' }}>
                  🕒 Clock: {currentTimeStr}
                </span>
                <button
                  type="button"
                  onClick={handleTestAlarmClick}
                  title="Test in-app alert modal & audible chime right now"
                  style={{
                    background: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 2px 6px rgba(5, 150, 105, 0.2)'
                  }}
                >
                  🔔 Test In-App Alert
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', fontSize: '0.8rem', color: '#047857' }}>
              <span>
                Monitors checklist every 3s. Automatically triggers an audible chime, push notification, and in-app dose alert modal when scheduled times arrive.
              </span>
              {typeof Notification !== 'undefined' && notifPermission !== 'granted' && (
                <button
                  type="button"
                  onClick={handleRequestPermission}
                  style={{
                    background: '#ecfdf5',
                    color: '#065f46',
                    border: '1px solid #6ee7b7',
                    borderRadius: '6px',
                    padding: '3px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  📢 Enable Push Notifications
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>💊</span>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--navy)', margin: 0 }}>
                Daily Medication Schedule
              </h3>
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              style={{
                background: '#eef2ff',
                color: '#4f46e5',
                border: '1px solid #c7d2fe',
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '0.825rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {showAddForm ? '✕ Close Form' : '➕ Add Medication'}
            </button>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Check off each medication as you take it. Scheduled alarms will alert you at the designated time.
          </p>

          {/* Add Item Form */}
          {showAddForm && (
            <form onSubmit={handleAddItem} style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Medicine name (e.g. Paracetamol, ABC, Amoxicillin)..."
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  className="auth-input"
                />
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  className="form-select"
                >
                  <option value="meds">Medication</option>
                  <option value="advice">Advice / Daily Care Task</option>
                </select>
              </div>

              {newItemCategory === 'meds' && (
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    Scheduled Alarm Time (e.g. 04:30 PM):
                  </label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                    <input
                      type="text"
                      placeholder="Schedule time (e.g. 04:30 PM)"
                      value={newItemTime}
                      onChange={(e) => setNewItemTime(e.target.value)}
                      className="auth-input"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const clean = (newItemTime || '').trim();
                        const isAm = /am/i.test(clean);
                        if (isAm) {
                          setNewItemTime(clean.replace(/\s*am/gi, ' PM'));
                        } else if (/pm/i.test(clean)) {
                          setNewItemTime(clean.replace(/\s*pm/gi, ' AM'));
                        } else {
                          setNewItemTime(`${clean} PM`);
                        }
                      }}
                      style={{
                        background: /pm/i.test(newItemTime) ? '#e0e7ff' : '#fef3c7',
                        color: /pm/i.test(newItemTime) ? '#3730a3' : '#92400e',
                        border: '1.5px solid #c7d2fe',
                        borderRadius: '8px',
                        padding: '0 14px',
                        fontWeight: 800,
                        fontSize: '0.825rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {/pm/i.test(newItemTime) ? '🌙 PM (Click for AM)' : '☀️ AM (Click for PM)'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', alignSelf: 'center' }}>Quick set:</span>
                    <button
                      type="button"
                      onClick={() => setNewItemTime(getFormattedCurrentMinute(0))}
                      style={{ background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: '4px', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      🕒 Current ({getFormattedCurrentMinute(0)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemTime(getFormattedCurrentMinute(1))}
                      style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '4px', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      ⏰ In 1 Min ({getFormattedCurrentMinute(1)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemTime(getFormattedCurrentMinute(2))}
                      style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: '4px', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      ⏰ In 2 Min ({getFormattedCurrentMinute(2)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemTime('08:00 AM')}
                      style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      08:00 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemTime('02:00 PM')}
                      style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      02:00 PM
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemTime('08:00 PM')}
                      style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      08:00 PM
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="btn-hero-launch"
                style={{ width: '100%', justifyContent: 'center', padding: '8px' }}
              >
                Save Item to Checklist
              </button>
            </form>
          )}

          {/* Section 1: Confirmed Medications */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.25rem' }}>💊</span>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--navy)' }}>
                Confirmed Medications
              </h4>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {meds.length === 0 ? (
                <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                  ⚪ No medications in checklist yet. Use "+ Add Item" or upload a prescription.
                </div>
              ) : (
                meds.map(item => {
                  const label = getItemLabel(item);
                  return (
                    <div 
                      key={item.id}
                      onClick={() => toggleItem(item.id, 'meds')}
                      style={{
                        background: item.done ? '#f8fafc' : '#ffffff',
                        border: `1px solid ${item.done ? '#bbf7d0' : '#e2e8f0'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: item.done ? 'none' : '0 1px 3px rgba(0,0,0,0.03)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                        <input 
                          type="checkbox" 
                          checked={Boolean(item.done)} 
                          onChange={() => {}} 
                          style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#4f46e5', flexShrink: 0 }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                          <span style={{ 
                            fontSize: '0.92rem', 
                            fontWeight: 700, 
                            color: item.done ? '#15803d' : 'var(--navy)',
                            textDecoration: item.done ? 'line-through' : 'none',
                            wordBreak: 'break-word'
                          }}>
                            {label}
                          </span>
                          {(item.time || item.dose || item.schedule || item.instructions) && (
                            <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {item.time && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, color: '#4f46e5' }}>⏰ {item.time}</span>
                                  {/(am|pm)/i.test(item.time) && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleToggleItemAmPm(e, item.id)}
                                      title="Switch between AM and PM"
                                      style={{
                                        background: '#e0e7ff',
                                        color: '#3730a3',
                                        border: '1px solid #c7d2fe',
                                        borderRadius: '4px',
                                        padding: '1px 6px',
                                        fontSize: '0.7rem',
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                      }}
                                    >
                                      ⇄ Switch to {/am/i.test(item.time) ? 'PM' : 'AM'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => handleSetItemTimeToNow(e, item.id)}
                                    title="Set scheduled dose to current minute to trigger alarm right now"
                                    style={{
                                      background: '#fef3c7',
                                      color: '#92400e',
                                      border: '1px solid #fde68a',
                                      borderRadius: '4px',
                                      padding: '1px 6px',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    🕒 Set to Now
                                  </button>
                                </span>
                              )}
                              {item.dose && <span>• Dose: {item.dose}</span>}
                              {item.schedule && item.schedule !== item.time && <span>• {item.schedule}</span>}
                              {item.instructions && <span>• {item.instructions}</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>



        </div>

        {/* Right Column: Live Activity Tracker */}
        <div className="tracker-column">
          {/* Dark Navy Hero Box */}
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
            borderRadius: 'var(--radius-xl)',
            padding: '1.75rem',
            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
            marginBottom: '1.25rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📈</span>
              <h4 style={{ fontSize: '1.15rem', fontWeight: 800 }}>Live Activity Tracker</h4>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              Real-time adherence log beside your checklist.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                  Doses Taken
                </span>
                <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '2px' }}>
                  {completedCount} / {totalCount}
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                  Adherence Rate
                </span>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: adherenceRate >= 80 ? '#4ade80' : '#fbbf24', marginTop: '2px' }}>
                  {adherenceRate}%
                </div>
              </div>
            </div>
          </div>

          {/* Adherence Streak Badge */}
          <div style={{
            background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
            color: '#4338ca',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            fontWeight: 800,
            fontSize: '0.9rem',
            textAlign: 'center',
            border: '1px solid #c7d2fe',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}>
            <span>{completedCount > 0 ? '🔥' : '🌱'}</span>
            <span>{completedCount > 0 && adherenceRate === 100 ? '100% Adherence Milestone Reached' : `${completedCount} of ${totalCount} Doses Taken Today`}</span>
          </div>

          {/* Recent Activity Log */}
          <div style={{
            background: '#ffffff',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '0.95rem', color: 'var(--navy)', marginBottom: '0.75rem' }}>
              <span>🕒</span>
              <span>Recent Activity Log</span>
            </div>

            {activityLogs.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                ⚪ No activity recorded yet today. Check off your first task on the left to start tracking!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activityLogs.map((log, idx) => (
                  <div key={idx} style={{ fontSize: '0.825rem', color: '#334155', background: '#f8fafc', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                    • {log}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={handleMarkAllDone}
              style={{
                flex: 1,
                background: '#4f46e5',
                color: '#ffffff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '12px',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)'
              }}
            >
              <span>✅</span> Mark All Done
            </button>

            <button
              type="button"
              onClick={handleReset}
              style={{
                background: '#ffffff',
                color: '#64748b',
                border: '1px solid #e2e8f0',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <span>🔄</span> Reset Checklist
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
