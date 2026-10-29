import React, { useState, useEffect } from 'react';
import { playMedicalChime, triggerBrowserNotification } from '../utils/audioChime';

const INITIAL_MEDS = [];
const INITIAL_ADVICE = [];
const INITIAL_DIET = [];

export default function TimelineView({ setToastMessage }) {
  // Dynamic synchronization helper from active prescriptions
  const extractMedsFromPrescriptions = () => {
    try {
      const rxSaved = localStorage.getItem('carebridge_portal_prescriptions');
      if (rxSaved) {
        const rxs = JSON.parse(rxSaved).filter(p => p.id !== 'rx_1' && p.id !== 'rx_2');
        if (rxs.length > 0) {
          const extracted = rxs.flatMap(rx => (rx.medications || []).map((m, idx) => ({
            id: `rx_med_${rx.id}_${idx}`,
            title: `${m.name} ${m.dosage && m.dosage !== 'As directed' ? m.dosage : ''}`.trim(),
            time: m.schedule?.toLowerCase().includes('night') || m.schedule?.toLowerCase().includes('evening') ? '08:00 PM' : '08:00 AM',
            dose: m.dosage || '1 dose',
            done: false,
            alarmEnabled: true
          })));
          if (extracted.length > 0) return extracted;
        }
      }
      const saved = localStorage.getItem('carebridge_meds_checklist');
      if (saved) {
        const parsed = JSON.parse(saved);
        const filtered = parsed.filter(m => !['m1', 'm2', 'm3', 'm4'].includes(m.id));
        if (filtered.length > 0) return filtered;
      }
    } catch {}
    return [];
  };

  const [meds, setMeds] = useState(extractMedsFromPrescriptions);

  // Re-sync checklist whenever prescriptions change or are uploaded
  useEffect(() => {
    const handlePrescriptionUpdate = () => {
      const freshMeds = extractMedsFromPrescriptions();
      setMeds(prev => {
        return freshMeds.map(fresh => {
          const match = prev.find(p => p.id === fresh.id || p.title === fresh.title);
          return match ? { ...fresh, done: match.done, alarmEnabled: match.alarmEnabled } : fresh;
        });
      });
    };

    window.addEventListener('carebridge:prescription-updated', handlePrescriptionUpdate);
    window.addEventListener('storage', handlePrescriptionUpdate);
    return () => {
      window.removeEventListener('carebridge:prescription-updated', handlePrescriptionUpdate);
      window.removeEventListener('storage', handlePrescriptionUpdate);
    };
  }, []);

  const [advice, setAdvice] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_advice_checklist');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.filter(a => !['a1', 'a2', 'a3', 'a4'].includes(a.id));
      }
    } catch {}
    return [];
  });

  const [diet, setDiet] = useState(() => {
    try {
      const saved = localStorage.getItem('carebridge_diet_checklist');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.filter(d => !['d1', 'd2'].includes(d.id));
      }
    } catch {}
    return [];
  });

  const [activityLogs, setActivityLogs] = useState(() => {
    const saved = localStorage.getItem('carebridge_activity_logs');
    return saved ? JSON.parse(saved) : [];
  });

  // Adding new custom item state
  const [newItemText, setNewItemText] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('meds'); // 'meds' | 'advice' | 'diet'
  const [newItemTime, setNewItemTime] = useState('08:00 AM');
  const [showAddForm, setShowAddForm] = useState(false);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('carebridge_meds_checklist', JSON.stringify(meds));
    localStorage.setItem('carebridge_advice_checklist', JSON.stringify(advice));
    localStorage.setItem('carebridge_diet_checklist', JSON.stringify(diet));
    localStorage.setItem('carebridge_activity_logs', JSON.stringify(activityLogs));
  }, [meds, advice, diet, activityLogs]);

  const allItems = [...meds, ...advice, ...diet];
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
            const medLabel = (item.title || item.text || item.name || 'Medication').split('—')[0].trim();
            logAction(`Took dose: ${medLabel} at ${nowStr}`);
            setToastMessage(`✅ Marked dose completed: ${medLabel}`);
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
            const advLabel = (item.title || item.text || 'Discharge Advice').slice(0, 45);
            logAction(`Completed: ${advLabel}... at ${nowStr}`);
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
            const dietLabel = (item.title || item.text || 'Diet Protocol').slice(0, 40);
            logAction(`Adhered to: ${dietLabel}... at ${nowStr}`);
          }
          return { ...item, done: newDone };
        }
        return item;
      }));
    }
  };

  const logAction = (text) => {
    setActivityLogs(prev => [text, ...prev.slice(0, 6)]);
  };

  const handleAddItem = (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    const newItem = {
      id: `task_${Date.now()}`,
      text: newItemText.trim(),
      category: newItemCategory === 'meds' ? 'Confirmed Medications' : newItemCategory === 'advice' ? 'Discharge Advice' : 'Diet & Lifestyle',
      done: false,
      ...(newItemCategory === 'meds' ? { time: newItemTime } : {})
    };

    if (newItemCategory === 'meds') {
      setMeds(prev => [...prev, newItem]);
    } else if (newItemCategory === 'advice') {
      setAdvice(prev => [...prev, newItem]);
    } else {
      setDiet(prev => [...prev, newItem]);
    }

    setToastMessage(`Added task to ${newItem.category}`);
    setNewItemText('');
    setShowAddForm(false);
  };

  const handleMarkAllDone = () => {
    playMedicalChime();
    setMeds(prev => prev.map(i => ({ ...i, done: true })));
    setAdvice(prev => prev.map(i => ({ ...i, done: true })));
    setDiet(prev => prev.map(i => ({ ...i, done: true })));
    logAction(`All tasks marked completed for today at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    setToastMessage('🎉 Outstanding! 100% adherence achieved for today.');
  };

  const handleReset = () => {
    setMeds(prev => prev.map(i => ({ ...i, done: false })));
    setAdvice(prev => prev.map(i => ({ ...i, done: false })));
    setDiet(prev => prev.map(i => ({ ...i, done: false })));
    setToastMessage('Checklist reset for new cycle.');
  };

  const handleSoundChime = (label) => {
    triggerBrowserNotification(
      '⏰ CareBridge Medication Alarm',
      `Time for: ${label}. Please take your prescribed dose with water.`
    );
    setToastMessage(`🔔 Audio chime sounded for: ${label}`);
  };

  return (
    <div className="recovery-journey-wrapper">
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.85fr', gap: '2.5rem', alignItems: 'flex-start' }}>
        
        {/* Left Column: Daily Recovery Checklist */}
        <div className="checklist-column">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.6rem' }}>📋</span>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--navy)', margin: 0 }}>
                Daily Recovery Checklist
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
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {showAddForm ? '✕ Close Form' : '➕ Add Item'}
            </button>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Check off items as you complete them throughout your day.
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
                  placeholder="Task or medicine description..."
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  className="auth-input"
                  required
                />
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  className="form-select"
                >
                  <option value="meds">Medication</option>
                  <option value="advice">Advice</option>
                  <option value="diet">Diet & Lifestyle</option>
                </select>
              </div>

              {newItemCategory === 'meds' && (
                <div style={{ marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="Schedule time (e.g. 08:00 AM)"
                    value={newItemTime}
                    onChange={(e) => setNewItemTime(e.target.value)}
                    className="auth-input"
                  />
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
                meds.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => toggleItem(item.id, 'meds')}
                    style={{
                      background: item.done ? '#f8fafc' : '#ffffff',
                      border: `1px solid ${item.done ? '#bbf7d0' : '#e2e8f0'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input 
                        type="checkbox" 
                        checked={item.done} 
                        onChange={() => {}} 
                        style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#4f46e5' }}
                      />
                      <span style={{ 
                        fontSize: '0.9rem', 
                        fontWeight: 600, 
                        color: item.done ? '#15803d' : 'var(--navy)',
                        textDecoration: item.done ? 'line-through' : 'none'
                      }}>
                        {item.title || item.text || item.name || 'Prescribed Medication'}
                      </span>
                    </div>

                    <button
                      type="button"
                      title="Play synthesized audio alarm chime"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSoundChime((item.title || item.text || item.name || 'Medication').split('—')[0].trim());
                      }}
                      style={{
                        background: 'none',
                        border: '1px solid #e2e8f0',
                        borderRadius: '50%',
                        width: '28px',
                        height: '28px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.8rem'
                      }}
                    >
                      🔔
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 2: Discharge Advice */}
          <div style={{ marginBottom: '1.75rem' }}>
            <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '0.85rem' }}>
              🩺 Discharge Advice
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {advice.length === 0 ? (
                <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                  ⚪ No discharge advice in checklist yet.
                </div>
              ) : (
                advice.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => toggleItem(item.id, 'advice')}
                    style={{
                      background: item.done ? '#f8fafc' : '#ffffff',
                      border: `1px solid ${item.done ? '#bbf7d0' : '#e2e8f0'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={item.done} 
                      onChange={() => {}} 
                      style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#4f46e5' }}
                    />
                    <span style={{ 
                      fontSize: '0.9rem', 
                      fontWeight: 500, 
                      color: item.done ? '#15803d' : '#334155',
                      textDecoration: item.done ? 'line-through' : 'none'
                    }}>
                      {item.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 3: Diet & Lifestyle */}
          <div>
            <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '0.85rem' }}>
              🥗 Diet &amp; Lifestyle Instructions
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {diet.length === 0 ? (
                <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                  ⚪ No diet or lifestyle instructions recorded yet.
                </div>
              ) : (
                diet.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => toggleItem(item.id, 'diet')}
                    style={{
                      background: item.done ? '#f8fafc' : '#ffffff',
                      border: `1px solid ${item.done ? '#bbf7d0' : '#e2e8f0'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={item.done} 
                      onChange={() => {}} 
                      style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#4f46e5' }}
                    />
                    <span style={{ 
                      fontSize: '0.9rem', 
                      fontWeight: 500, 
                      color: item.done ? '#15803d' : '#334155',
                      textDecoration: item.done ? 'line-through' : 'none'
                    }}>
                      {item.text}
                    </span>
                  </div>
                ))
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
                  Tasks Completed
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
            <span>{completedCount > 0 && adherenceRate === 100 ? '100% Adherence Milestone Reached' : `${completedCount} of ${totalCount} Daily Tasks Finished`}</span>
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

          {/* Control Buttons: Mark All Done & Reset */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <button 
              type="button"
              className="btn-primary"
              onClick={handleMarkAllDone}
              style={{ justifyContent: 'center', fontSize: '0.85rem', padding: '10px 14px' }}
            >
              ✅ Mark All Done
            </button>

            <button 
              type="button"
              className="btn-secondary"
              onClick={handleReset}
              style={{ justifyContent: 'center', fontSize: '0.85rem', padding: '10px 14px' }}
            >
              🔄 Reset Checklist
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
