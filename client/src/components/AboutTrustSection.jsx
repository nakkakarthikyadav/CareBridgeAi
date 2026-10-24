import React from 'react';

export default function AboutTrustSection({ onOpenWorkspace }) {
  return (
    <section id="about-section" className="about-dribbble-section">
      {/* Left Column: Team Photo with Trustpilot Float Badge */}
      <div className="about-photo-wrapper">
        <img 
          src="/medical_team.jpg" 
          alt="CareBridge Clinical Recovery Team" 
          className="about-team-img"
        />

        <div className="trustpilot-float-badge">
          <div className="trustpilot-stars">
            <span>★</span>
            <span style={{ color: '#101828', fontWeight: 800 }}>Clinical TrustScore</span>
            <span style={{ color: '#00b67a' }}>★★★★★</span>
          </div>
          <div className="trustpilot-score">
            Rating <strong>4.9 / 5.0</strong> | 12,000+ Recoveries Guided
          </div>
        </div>
      </div>

      {/* Right Column: Text & Signature */}
      <div className="about-content-column">
        <span className="about-content-pill">The CareBridge Mission</span>

        <h2 className="about-heading">
          Eliminating Post-Discharge Medication Errors and Confusion.
        </h2>

        <p className="about-desc">
          Nearly 1 in 5 patients suffer adverse medical events within 30 days of hospital discharge—predominantly 
          caused by misunderstood doctor handwriting, missed critical doses, and dangerous Look-Alike / Sound-Alike 
          drug mix-ups. CareBridge AI gives recovering patients and family caregivers crystal-clear digital instructions, 
          continuous drug safety verification, and automated audio alarms so you can recover safely at home.
        </p>

        <div className="about-signature-row">
          <button 
            className="btn-about-pill"
            onClick={() => onOpenWorkspace('handwritten')}
          >
            <span>Scan Prescription</span>
            <span>↗</span>
          </button>
        </div>
      </div>
    </section>
  );
}
