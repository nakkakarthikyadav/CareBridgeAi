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
          <h2 className="diet-module-title">Condition-Specific Recovery Diet Planner</h2>
          <p className="diet-module-desc">Accelerate tissue healing, manage drug-food interactions, and reduce systemic inflammation.</p>
        </div>
      </div>

      <div className="module-body-card">
        {/* Gemini API Key Configuration Banner */}
        <div className={`diet-gemini-banner ${userApiKey ? 'configured' : 'offline'}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <strong className="diet-gemini-title">
              <span>✨</span> Google Gemini AI Integration
              <span className={`diet-gemini-badge ${userApiKey ? 'live' : 'offline'}`}>
                {userApiKey ? '✓ Live Gemini Key Configured' : 'Offline Clinical Protocol Active'}
              </span>
            </strong>
            <button
              type="button"
              onClick={() => setShowKeyConfig(!showKeyConfig)}
              className="diet-key-toggle-btn"
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
              <p className="diet-gemini-note">
                💡 CareBridge AI queries Google Gemini in real-time with this key. If left blank, it uses <code>GEMINI_API_KEY</code> from <code>.env</code> or the built-in clinical nutritionist protocol.
              </p>
            </div>
          )}
        </div>

        {/* Prescription-Linked Clinical Profile */}
        {detectedRx ? (
          <div className="diet-rx-linked-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>📋</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--success, #0f766e)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Diagnosis Extracted from Prescription
                </span>
                <span className="diet-rx-badge">
                  ✓ Prescription Linked
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomCondition(!showCustomCondition)}
                className="diet-btn-pill"
              >
                {showCustomCondition ? '✕ Hide Custom Input' : '✏️ Change Condition'}
              </button>
            </div>

            <div className="diet-condition-title">
              {condition || detectedRx.diagnosis || detectedRx.title}
            </div>

            {detectedRx.medications && detectedRx.medications.length > 0 && (
              <div className="diet-eval-meds-box">
                <span className="diet-eval-meds-label">
                  💊 Evaluated Medications for Food-Drug Interactions:
                </span>
                <span className="diet-eval-meds-list">
                  {detectedRx.medications.map(m => `${m.name || m.drugName || 'Medication'} ${m.dosage && m.dosage !== 'As directed' ? `(${m.dosage})` : ''}`).join(' • ')}
                </span>
              </div>
            )}

            <div className="diet-rx-safeguard-note">
              <span>✨</span>
              <span>Gemini AI tailors the recovery diet plan to this clinical indication and safeguards against adverse food-drug interactions.</span>
            </div>
          </div>
        ) : (
          <div className="diet-no-rx-banner">
            <div>
              <div className="diet-no-rx-title">
                📄 No Prescription Uploaded Yet
              </div>
              <div className="diet-no-rx-desc">
                Upload your doctor's prescription in Step 1 to automatically extract your disease and medications, or specify a condition below.
              </div>
            </div>
          </div>
        )}

        {/* Condition presets (Shown only if custom toggle enabled or no prescription exists) */}
        {(!detectedRx || showCustomCondition) && (
          <div className="diet-preset-box">
            <label className="diet-preset-label">
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
                    className={`diet-preset-pill ${isSelected ? 'active' : ''}`}
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
            <span className="diet-pref-selected-badge">
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '1.5rem' }}>
              <div>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  Targeted Clinical Plan
                </span>
                <h3 className="diet-result-title">
                  {result.identifiedDisease || condition || 'Clinical Recovery Protocol'}
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`diet-pref-pill ${preference.toLowerCase()}`}>
                  {preference === 'Vegetarian' ? '🥦 Pure Vegetarian' : preference === 'Non-Vegetarian' ? '🍗 Non-Vegetarian' : '🥚 Eggetarian'}
                </span>
                <span className={`diet-source-pill ${aiSource?.includes('Gemini') ? 'gemini' : 'clinical'}`}>
                  {aiSource?.includes('Gemini') ? `✨ ${aiSource}` : '🛡️ CareBridge Clinical Nutrition Protocol'}
                </span>
              </div>
            </div>

            {/* Rationale */}
            {result.dietaryRationale && (
              <div className="diet-rationale-card">
                <h4 className="diet-rationale-title">
                  <span>🧬</span> Recovery Nutrition Rationale
                </h4>
                <p className="diet-rationale-text">
                  {result.dietaryRationale}
                </p>
              </div>
            )}

            {/* Foods to Emphasize & Avoid in 2 columns (Side-by-Side on all screens) */}
            <div className="diet-columns-grid">
              {/* Emphasize */}
              <div className="diet-column-card diet-column-emphasize">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 className="diet-column-title" style={{ margin: 0, fontWeight: 800, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🥦</span> Foods to Emphasize
                  </h4>
                  <span className="diet-status-pill emphasize">
                    ✓ Recommended
                  </span>
                </div>
                <div className="diet-food-list">
                  {result.foodsToEmphasize && result.foodsToEmphasize.length > 0 ? (
                    result.foodsToEmphasize.map((f, i) => {
                      const title = typeof f === 'string' ? f.split(/[:\-–—]/)[0] : (f.food || f.name || f.title || 'Therapeutic Food');
                      const desc = typeof f === 'string' ? (f.includes(':') ? f.split(':').slice(1).join(':') : 'Supports recovery') : (f.benefit || f.reason || f.description || 'Supports recovery');
                      return (
                        <div key={i} className="diet-food-item diet-food-item-emphasize">
                          <strong className="diet-food-title">{title}</strong>
                          <div className="diet-food-desc">{desc}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="diet-food-empty">
                      No specific foods highlighted.
                    </div>
                  )}
                </div>
              </div>

              {/* Avoid */}
              <div className="diet-column-card diet-column-avoid">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 className="diet-column-title" style={{ margin: 0, fontWeight: 800, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚠️</span> Foods to Strictly Avoid
                  </h4>
                  <span className="diet-status-pill avoid">
                    ✕ Restricted
                  </span>
                </div>
                <div className="diet-food-list">
                  {result.foodsToStrictlyAvoid && result.foodsToStrictlyAvoid.length > 0 ? (
                    result.foodsToStrictlyAvoid.map((f, i) => {
                      const title = typeof f === 'string' ? f.split(/[:\-–—]/)[0] : (f.food || f.name || f.title || 'Restricted Item');
                      const desc = typeof f === 'string' ? (f.includes(':') ? f.split(':').slice(1).join(':') : 'Interferes with recovery') : (f.reason || f.benefit || f.description || 'Interferes with recovery');
                      return (
                        <div key={i} className="diet-food-item diet-food-item-avoid">
                          <strong className="diet-food-title">{title}</strong>
                          <div className="diet-food-desc">{desc}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="diet-food-empty">
                      No severe food restrictions identified.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sample Meal Plan */}
            {result.sampleMealPlan && (
              <div className="diet-meal-schedule-box">
                <h4 className="diet-meal-schedule-title">
                  <span>🍽️</span> 24-Hour Recovery Nutrition Schedule
                </h4>
                <div className="diet-sample-meal-grid">
                  <div className="diet-sample-meal-card">
                    <span className="diet-meal-badge breakfast">🌅 Breakfast</span>
                    <p className="diet-sample-meal-text">{result.sampleMealPlan.breakfast}</p>
                  </div>
                  <div className="diet-sample-meal-card">
                    <span className="diet-meal-badge lunch">☀️ Lunch</span>
                    <p className="diet-sample-meal-text">{result.sampleMealPlan.lunch}</p>
                  </div>
                  <div className="diet-sample-meal-card">
                    <span className="diet-meal-badge snack">☕ Afternoon Snack</span>
                    <p className="diet-sample-meal-text">{result.sampleMealPlan.eveningSnack || result.sampleMealPlan.midMorningSnack || 'Warm herbal tea with soaked almonds'}</p>
                  </div>
                  <div className="diet-sample-meal-card">
                    <span className="diet-meal-badge dinner">🌙 Dinner</span>
                    <p className="diet-sample-meal-text">{result.sampleMealPlan.dinner}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Hydration */}
            {result.hydrationGoal && (
              <div className="diet-hydration-box">
                <span style={{ fontSize: '1.5rem' }}>💧</span>
                <div>
                  <strong className="diet-hydration-label">Daily Hydration Protocol:</strong>
                  <span className="diet-hydration-val">{result.hydrationGoal}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
