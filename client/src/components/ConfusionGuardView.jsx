import React, { useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';

const SAMPLES = [
  'Metoprolol Tartrate vs Succinate ER',
  'Hydralazine vs Hydroxyzine',
  'Celebrex vs Celexa',
  'Aspirin with Ibuprofen together',
  'Warfarin with Cranberry juice'
];

export default function ConfusionGuardView() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleCheck = async (textToCheck) => {
    const searchText = textToCheck || query;
    if (!searchText.trim()) {
      setError('Please enter a medication name or pair to check.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/confusion-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchText })
      });

      const data = await response.json();
      if (data.success && data.data) {
        setResult(data.data);
      } else {
        setError(data.error || 'Failed to check medication safety.');
      }
    } catch (err) {
      console.error(err);
      setError('Could not connect to the backend server.');
    } finally {
      setLoading(false);
    }
  };

  const getRiskClass = (risk) => {
    switch ((risk || '').toLowerCase()) {
      case 'critical': return 'confusion-risk-critical';
      case 'high': return 'confusion-risk-high';
      case 'moderate': return 'confusion-risk-moderate';
      default: return 'confusion-risk-low';
    }
  };

  return (
    <section className="module-section">
      <div className="module-header">
        <span className="module-header-badge">Clinical Safety Protocol</span>
        <h2>Medication Confusion &amp; LASA Guard</h2>
        <p>Prevent fatal sound-alike / look-alike drug mix-ups and dangerous contraindications.</p>
      </div>

      <div className="module-body-card">
        <div className="form-group">
          <label className="form-label">Enter Drug Name, Pair, or Medical Term</label>
          <div className="search-input-group">
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g., Metoprolol Tartrate, Hydralazine, or Prednisone dose..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
            />
            <button 
              className="btn-primary" 
              onClick={() => handleCheck()}
              disabled={loading}
            >
              {loading ? 'Evaluating...' : '🛡️ Safety Scan'}
            </button>
          </div>
        </div>

        {/* Quick Sample Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '1rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>Popular Clinical Checks:</span>
          {SAMPLES.map((s, idx) => (
            <button
              key={idx}
              type="button"
              className="btn-quick-sample-chip"
              onClick={() => {
                setQuery(s);
                handleCheck(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ marginTop: '1.5rem', padding: '12px', background: 'var(--danger-light)', color: 'var(--danger)', borderRadius: 'var(--radius-md)' }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ marginTop: '2rem', borderTop: '2px solid var(--border-light)', paddingTop: '2rem' }}>
            {/* Risk Badge */}
            {result.riskLevel && (
              <div className={`confusion-risk-banner ${getRiskClass(result.riskLevel)}`}>
                <div>
                  <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800 }}>Assessed Risk Severity</span>
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '4px 0 0 0' }}>{result.riskLevel} Clinical Confusion Risk</h3>
                </div>
                <div style={{ fontSize: '2rem' }}>
                  {result.riskLevel === 'Critical' || result.riskLevel === 'High' ? '🚨' : '🛡️'}
                </div>
              </div>
            )}

            {/* Alert & Guidance */}
            {result.safetyAlert && (
              <div className="confusion-analysis-card">
                <h4 className="confusion-analysis-title">
                  ⚠️ Clinical Safety Analysis
                </h4>
                <p className="confusion-analysis-text">{result.safetyAlert}</p>
              </div>
            )}

            {/* Look-Alike Breakdown */}
            {result.lookAlikeDrugs && result.lookAlikeDrugs.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 className="confusion-section-heading">
                  🔄 Commonly Confused Medications &amp; Critical Distinctions
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                  {result.lookAlikeDrugs.map((item, i) => (
                    <div key={i} className="confusion-drug-card">
                      <div className="confusion-drug-name">
                        {item.name}
                      </div>
                      <p className="confusion-drug-distinction">
                        {item.distinction}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actionable guidance */}
            {result.actionableGuidance && (
              <div className="confusion-action-card">
                <strong className="confusion-action-title">
                  📌 What You Must Check on the Box / Bottle Right Now:
                </strong>
                <p className="confusion-action-text">{result.actionableGuidance}</p>
              </div>
            )}

            {/* Questions for pharmacist */}
            {result.questionsToConfirmWithPharmacist && (
              <div className="confusion-pharmacist-card">
                <strong className="confusion-pharmacist-title">
                  💬 Double-check with your pharmacist:
                </strong>
                <ul className="confusion-pharmacist-list">
                  {result.questionsToConfirmWithPharmacist.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
