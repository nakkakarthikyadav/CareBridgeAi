import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';

const PRESET_CONDITIONS = [
  'Post-Cardiac Stent / Angioplasty (Low-Sodium, Antiplatelet Safe)',
  'Orthopedic Knee / Hip Replacement (High-Collagen, Anti-Inflammatory)',
  'Post-Abdominal Surgery (Low-Residue, High-Protein Healing)',
  'Type 2 Diabetes with Surgical Wound Healing',
  'Hypertension with Renal Sparing'
];

export const DIETARY_OPTIONS = [
  {
    id: 'Vegetarian',
    title: 'Vegetarian',
    icon: '🥦',
    badge: 'Pure Veg',
    desc: 'Plant-based foods, lentils, grains, seasonal vegetables, legumes & dairy'
  },
  {
    id: 'Non-Vegetarian',
    title: 'Non-Vegetarian',
    icon: '🍗',
    badge: 'Non-Veg',
    desc: 'Lean poultry, fresh fish, and meat balanced with healthy recovery vegetables'
  },
  {
    id: 'Eggetarian',
    title: 'Eggetarian',
    icon: '🥚',
    badge: 'Veg + Eggs',
    desc: 'Wholesome vegetarian nutrition enriched with protein-rich eggs'
  }
];

export default function DietPlannerView() {
  const [detectedRx, setDetectedRx] = useState(null);
  const [showCustomCondition, setShowCustomCondition] = useState(false);
  const [condition, setCondition] = useState(PRESET_CONDITIONS[0]);
  const [preference, setPreference] = useState('Vegetarian');
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('carebridge_gemini_api_key') || '');
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [aiSource, setAiSource] = useState('');
  const [error, setError] = useState('');

  // Auto-detect disease / diagnosis & active medications from prescription on file
  useEffect(() => {
    try {
      const saved = localStorage.getItem('carebridge_portal_prescriptions');
      if (saved) {
        const parsed = JSON.parse(saved).filter(p => p.id !== 'rx_1' && p.id !== 'rx_2' && !(p.title === 'Hospital Discharge Prescription' && p.doctor === 'Attending Physician' && !p.imagePreview));
        if (parsed.length > 0) {
          const rx = parsed[0];
          setDetectedRx(rx);
          if (rx.diagnosis && rx.diagnosis !== 'Clinical Post-Discharge Treatment') {
            setCondition(rx.diagnosis);
          } else if (rx.title) {
            setCondition(rx.title);
          }
          setShowCustomCondition(false);
        } else {
          setShowCustomCondition(true);
        }
      } else {
        setShowCustomCondition(true);
      }
    } catch (_) {
      setShowCustomCondition(true);
    }
  }, []);

  const handleSaveApiKey = (key) => {
    setUserApiKey(key);
    localStorage.setItem('carebridge_gemini_api_key', key.trim());
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (userApiKey.trim()) {
        headers['x-gemini-api-key'] = userApiKey.trim();
      }

      const activeMeds = (detectedRx?.medications || []).map(m => m.name || m.drugName || m).filter(Boolean);

      const response = await fetch(`${API_BASE_URL}/api/diet-plan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          condition,
          diagnosis: condition,
          medications: activeMeds,
          symptoms: detectedRx?.notes || '',
          dietaryPreference: preference,
          apiKey: userApiKey.trim() || undefined
        })
      });

      const data = await response.json();
      if (data.success && data.data) {
        setResult(data.data);
        setAiSource(data.aiSource || 'Clinical AI');
      } else {
        setError(data.error || 'Failed to generate dietary plan.');
      }
    } catch (err) {
      console.error(err);
      setError('Could not connect to backend server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="module-section">
      <div className="module-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span className="module-header-badge">Clinical Nutritionist</span>
          <h2>Condition-Specific Recovery Diet Planner</h2>
          <p>Accelerate tissue healing, manage drug-food interactions, and reduce systemic inflammation.</p>
        </div>

      </div>

      <div className="module-body-card">
        {/* Gemini API Key Configuration Banner */}
        <div style={{
          background: userApiKey ? 'linear-gradient(135deg, #f0fdf4 0%, #f8fafc 100%)' : 'linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%)',
          border: `1.5px solid ${userApiKey ? '#86efac' : '#c7d2fe'}`,
          borderRadius: 'var(--radius-md)',
          padding: '0.9rem 1.15rem',
          marginBottom: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <strong style={{ fontSize: '0.88rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>✨</span> Google Gemini AI Integration
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '9999px',
                background: userApiKey ? '#dcfce7' : '#e0e7ff',
                color: userApiKey ? '#15803d' : '#4338ca',
                border: `1px solid ${userApiKey ? '#86efac' : '#c7d2fe'}`
              }}>
                {userApiKey ? '✓ Live Gemini Key Configured' : 'Offline Clinical Protocol Active'}
              </span>
            </strong>
            <button
              type="button"
              onClick={() => setShowKeyConfig(!showKeyConfig)}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#4338ca',
                padding: '4px 10px',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {showKeyConfig ? '✕ Close Key Input' : (userApiKey ? '✏️ Edit / Change Key' : '🔑 Enter Gemini API Key')}
            </button>
          </div>

          {showKeyConfig && (
            <div style={{ animation: 'fadeIn 0.2s ease', marginTop: '4px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  placeholder="Paste your Google Gemini API key (AIzaSy...)"
                  className="form-input"
                  value={userApiKey}
                  onChange={(e) => handleSaveApiKey(e.target.value)}
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                {userApiKey && (
                  <button
                    type="button"
                    onClick={() => handleSaveApiKey('')}
                    style={{
                      background: '#fee2e2',
                      border: '1px solid #fecaca',
                      color: '#b91c1c',
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px', marginBottom: 0 }}>
                💡 CareBridge AI queries Google Gemini in real-time with this key. If left blank, it uses <code>GEMINI_API_KEY</code> from <code>.env</code> or the built-in clinical nutritionist protocol.
              </p>
            </div>
          )}
        </div>

        {/* Prescription-Linked Clinical Profile */}
        {detectedRx ? (
          <div style={{
            background: 'linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)',
            border: '2px solid #bbf7d0',
            borderRadius: 'var(--radius-lg)',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: '0 4px 15px rgba(16, 185, 129, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>🩺</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Disease Extracted from Prescription
                </span>
                <span style={{ background: '#dcfce7', color: '#166534', fontSize: '0.72rem', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px', border: '1px solid #86efac' }}>
                  ✓ Auto-Extracted
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomCondition(!showCustomCondition)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  padding: '5px 12px',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {showCustomCondition ? '✕ Hide Custom Input' : '✏️ Edit or Change Disease'}
              </button>
            </div>

            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a', margin: '4px 0 10px 0' }}>
              {condition || detectedRx.diagnosis || detectedRx.title}
            </div>

            {detectedRx.medications && detectedRx.medications.length > 0 && (
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginTop: '10px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#475569', display: 'block', marginBottom: '4px' }}>
                  💊 Prescribed Medications Evaluated for Food-Drug Safety:
                </span>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>
                  {detectedRx.medications.map(m => `${m.name || m.drugName || 'Medication'} ${m.dosage && m.dosage !== 'As directed' ? `(${m.dosage})` : ''}`).join(' • ')}
                </span>
              </div>
            )}

            <div style={{ marginTop: '12px', fontSize: '0.8rem', color: '#15803d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>✨</span>
              <span>Gemini AI extracts the exact dietary plan for this disease and protects against food-drug interactions. No typing required!</span>
            </div>
          </div>
        ) : (
          <div style={{
            background: '#f8fafc',
            border: '1.5px dashed #cbd5e1',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div>
              <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '0.9rem' }}>
                📄 No Prescription Uploaded Yet
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                Upload your doctor's prescription in Step 1 to automatically extract your disease and medications, or specify a condition below.
              </div>
            </div>
          </div>
        )}

        {/* Condition presets (Shown only if custom toggle enabled or no prescription exists) */}
        {(!detectedRx || showCustomCondition) && (
          <div style={{
            marginBottom: '1.5rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            animation: 'fadeIn 0.2s ease'
          }}>
            <label className="form-label" style={{ fontWeight: 800, color: '#334155', marginBottom: '8px', display: 'block' }}>
              Select Clinical Condition Protocol or Type Custom Condition
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {PRESET_CONDITIONS.map((cond, idx) => {
                const isSelected = condition === cond;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCondition(cond)}
                    style={{
                      background: isSelected ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#4338ca',
                      border: `1px solid ${isSelected ? '#4f46e5' : '#cbd5e1'}`,
                      padding: '7px 14px',
                      borderRadius: '9999px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: isSelected ? '0 4px 12px rgba(79, 70, 229, 0.25)' : 'none'
                    }}
                  >
                    {cond.split(' (')[0]}
                  </button>
                );
              })}
            </div>

            <input 
              type="text" 
              className="form-input" 
              value={condition} 
              placeholder="e.g. Type 2 Diabetes, Acute Bronchitis, Post-Op Cholecystectomy..."
              onChange={(e) => setCondition(e.target.value)} 
            />
          </div>
        )}

        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <label className="form-label" style={{ margin: 0, fontWeight: 800, fontSize: '0.95rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🥗</span> Dietary Preference:
            </label>
            <span style={{ fontSize: '0.78rem', color: '#4f46e5', fontWeight: 800, background: '#eef2ff', padding: '3px 10px', borderRadius: '9999px' }}>
              ✓ Selected: {preference}
            </span>
          </div>

          <div className="diet-options-selector-grid">
            {DIETARY_OPTIONS.map((opt) => {
              const isSelected = preference === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPreference(opt.id)}
                  className={`diet-option-card ${isSelected ? 'active' : ''}`}
                >
                  <div className="diet-option-header">
                    <div className="diet-option-icon-box">
                      <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{opt.icon}</span>
                    </div>
                    <span className="diet-option-badge">
                      {opt.badge}
                    </span>
                  </div>
                  <div className="diet-option-body">
                    <div className="diet-option-title-row">
                      <strong className="diet-option-title">{opt.title}</strong>
                      {isSelected ? (
                        <span className="diet-option-check">✓</span>
                      ) : (
                        <span className="diet-option-uncheck" />
                      )}
                    </div>
                    <p className="diet-option-desc">{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button 
          className="btn-primary" 
          onClick={handleGenerate} 
          disabled={loading}
          style={{ 
            width: '100%', 
            justifyContent: 'center',
            padding: '14px 28px',
            fontSize: '1rem',
            marginTop: '0.5rem',
            boxShadow: '0 6px 20px rgba(79, 70, 229, 0.32)'
          }}
        >
          {loading ? 'Consulting Gemini AI Nutrition Engine...' : (detectedRx ? `🥗 Generate Gemini AI Diet Plan for ${condition ? condition.split(' (')[0] : 'this Disease'}` : '🥗 Generate Clinical Recovery Diet')}
        </button>

        {error && (
          <div style={{ marginTop: '1.5rem', padding: '12px', background: 'var(--danger-light)', color: 'var(--danger)', borderRadius: 'var(--radius-md)' }}>
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={{ marginTop: '2.5rem', borderTop: '2px solid var(--border-light)', paddingTop: '2rem' }}>
            {/* Header with AI Source badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Targeted Clinical Plan
                </span>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--dark-indigo)', margin: '2px 0 0 0' }}>
                  {result.identifiedDisease || condition || 'Clinical Recovery Protocol'}
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '5px 12px',
                  borderRadius: '9999px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  background: preference === 'Vegetarian' ? '#ecfdf5' : preference === 'Non-Vegetarian' ? '#fef2f2' : '#fefce8',
                  color: preference === 'Vegetarian' ? '#047857' : preference === 'Non-Vegetarian' ? '#b91c1c' : '#b45309',
                  border: `1px solid ${preference === 'Vegetarian' ? '#a7f3d0' : preference === 'Non-Vegetarian' ? '#fecaca' : '#fef08a'}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}>
                  {preference === 'Vegetarian' ? '🥦 Vegetarian Diet' : preference === 'Non-Vegetarian' ? '🍗 Non-Vegetarian Diet' : '🥚 Eggetarian Diet'}
                </span>
                <span style={{
                  padding: '5px 14px',
                  borderRadius: '9999px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  background: aiSource?.includes('Gemini') ? 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' : '#ecfdf5',
                  color: aiSource?.includes('Gemini') ? '#ffffff' : '#065f46',
                  border: aiSource?.includes('Gemini') ? 'none' : '1px solid #a7f3d0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: aiSource?.includes('Gemini') ? '0 2px 8px rgba(79, 70, 229, 0.25)' : 'none'
                }}>
                  {aiSource?.includes('Gemini') ? `✨ ${aiSource}` : '🛡️ CareBridge Clinical Nutritionist Protocol'}
                </span>
              </div>
            </div>

            {/* Rationale */}
            {result.dietaryRationale && (
              <div style={{ background: 'var(--primary-light)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', marginBottom: '1.5rem' }}>
                <h4 style={{ color: 'var(--primary)', fontWeight: 800, marginBottom: '0.5rem' }}>
                  🧬 Recovery Nutrition Rationale
                </h4>
                <p style={{ lineHeight: 1.6, color: 'var(--text-main)', margin: 0 }}>{result.dietaryRationale}</p>
              </div>
            )}

            {/* Foods to Emphasize & Avoid in 2 columns (Side-by-Side on all screens) */}
            <div className="diet-columns-grid">
              {/* Emphasize */}
              <div className="diet-column-card diet-column-emphasize">
                <h4 className="diet-column-title" style={{ color: '#312e81' }}>
                  <span>🟢</span> Foods to Emphasize
                </h4>
                <div className="diet-food-list">
                  {result.foodsToEmphasize && result.foodsToEmphasize.length > 0 ? (
                    result.foodsToEmphasize.map((f, i) => {
                      const title = typeof f === 'string' ? f.split(/[:\-–—]/)[0] : (f.food || f.name || f.title || 'Therapeutic Food');
                      const desc = typeof f === 'string' ? (f.includes(':') ? f.split(':').slice(1).join(':') : 'Supports recovery') : (f.benefit || f.reason || f.description || 'Supports recovery');
                      return (
                        <div key={i} className="diet-food-item diet-food-item-emphasize">
                          <strong className="diet-food-title" style={{ color: '#4338ca' }}>{title}</strong>
                          <div className="diet-food-desc">{desc}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ background: '#ffffff', padding: '12px', borderRadius: 'var(--radius-md)', color: '#64748b', fontSize: '0.85rem' }}>
                      No specific foods highlighted.
                    </div>
                  )}
                </div>
              </div>

              {/* Avoid */}
              <div className="diet-column-card diet-column-avoid">
                <h4 className="diet-column-title" style={{ color: '#991b1b' }}>
                  <span>🔴</span> Foods to Strictly Avoid
                </h4>
                <div className="diet-food-list">
                  {result.foodsToStrictlyAvoid && result.foodsToStrictlyAvoid.length > 0 ? (
                    result.foodsToStrictlyAvoid.map((f, i) => {
                      const title = typeof f === 'string' ? f.split(/[:\-–—]/)[0] : (f.food || f.name || f.title || 'Restricted Item');
                      const desc = typeof f === 'string' ? (f.includes(':') ? f.split(':').slice(1).join(':') : 'Interferes with recovery') : (f.reason || f.benefit || f.description || 'Interferes with recovery');
                      return (
                        <div key={i} className="diet-food-item diet-food-item-avoid">
                          <strong className="diet-food-title" style={{ color: '#b91c1c' }}>{title}</strong>
                          <div className="diet-food-desc">{desc}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ background: '#ffffff', padding: '12px', borderRadius: 'var(--radius-md)', color: '#64748b', fontSize: '0.85rem' }}>
                      No severe food restrictions identified.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sample Meal Plan */}
            {result.sampleMealPlan && (
              <div style={{ background: '#ffffff', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <h4 style={{ fontWeight: 800, color: 'var(--dark-indigo)', marginBottom: '1rem' }}>
                  🍽️ Sample Daily Recovery Menu
                </h4>
                <div className="diet-sample-meal-grid">
                  <div className="diet-sample-meal-card">
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Breakfast</span>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: '4px', margin: 0 }}>{result.sampleMealPlan.breakfast}</p>
                  </div>
                  <div className="diet-sample-meal-card">
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lunch</span>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: '4px', margin: 0 }}>{result.sampleMealPlan.lunch}</p>
                  </div>
                  <div className="diet-sample-meal-card">
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Snack</span>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: '4px', margin: 0 }}>{result.sampleMealPlan.eveningSnack || result.sampleMealPlan.midMorningSnack || 'Herbal tea with soaked nuts'}</p>
                  </div>
                  <div className="diet-sample-meal-card">
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dinner</span>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: '4px', margin: 0 }}>{result.sampleMealPlan.dinner}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Hydration */}
            {result.hydrationGoal && (
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '1rem 1.5rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '1.5rem' }}>💧</span>
                <div>
                  <strong style={{ color: '#0369a1' }}>Daily Hydration Target:</strong>
                  <span style={{ marginLeft: '6px', fontSize: '0.9rem', color: '#0c4a6e' }}>{result.hydrationGoal}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
