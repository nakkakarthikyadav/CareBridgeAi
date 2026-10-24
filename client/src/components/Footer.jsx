import React from 'react';

export default function Footer({ onOpenWorkspace }) {
  return (
    <footer className="dribbble-footer">
      <div className="footer-grid-dribbble">
        <div className="footer-col">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
            <div className="logo-cross-icon" style={{ width: '30px', height: '30px', fontSize: '1rem' }}>✚</div>
            <span style={{ color: '#ffffff', fontSize: '1.35rem', fontWeight: 800 }}>CareBridge AI</span>
          </div>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.7, marginBottom: '1.25rem', color: '#94a3b8' }}>
            Leading clinical transition and post-discharge recovery platform. 
            Empowering patients, families, and hospitals with automated handwriting recognition and verified medication safety protocols.
          </p>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            CareBridge Clinical AI Architecture • Powered by Google Gemini AI
          </div>
        </div>

        <div className="footer-col">
          <h5>Departments</h5>
          <ul>
            <li><a href="#cardiology" onClick={(e) => { e.preventDefault(); onOpenWorkspace('confusion'); }}>Cardiology</a></li>
            <li><a href="#neurology" onClick={(e) => { e.preventDefault(); onOpenWorkspace('confusion'); }}>Neurology</a></li>
            <li><a href="#orthopedics" onClick={(e) => { e.preventDefault(); onOpenWorkspace('timeline'); }}>Orthopedics</a></li>
            <li><a href="#diet" onClick={(e) => { e.preventDefault(); onOpenWorkspace('diet'); }}>Clinical Nutrition</a></li>
          </ul>
        </div>

        <div className="footer-col">
          <h5>Clinical Tools</h5>
          <ul>
            <li><a href="#handwritten" onClick={(e) => { e.preventDefault(); onOpenWorkspace('handwritten'); }}>Handwritten OCR</a></li>
            <li><a href="#confusion" onClick={(e) => { e.preventDefault(); onOpenWorkspace('confusion'); }}>Confusion Safety Guard</a></li>
            <li><a href="#timeline" onClick={(e) => { e.preventDefault(); onOpenWorkspace('timeline'); }}>Medication Timetable</a></li>
            <li><a href="#discharge" onClick={(e) => { e.preventDefault(); onOpenWorkspace('document'); }}>Discharge Explainer</a></li>
          </ul>
        </div>

        <div className="footer-col">
          <h5>Emergency &amp; Hours</h5>
          <ul>
            <li><strong style={{ color: '#ef4444' }}>Hospital Emergency:</strong> Direct Call From Prescription</li>
            <li><strong style={{ color: '#e2e8f0' }}>Outpatient Care:</strong> 24/7 Recovery Support</li>
            <li><span style={{ color: '#94a3b8' }}>Mon - Sun: 24/7 Monitoring</span></li>
            <li><span style={{ color: '#94a3b8' }}>Chicago, IL • Suite 400</span></li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom-dribbble">
        <div>
          &copy; {new Date().getFullYear()} CareBridge AI Healthcare Systems. All rights reserved.
        </div>
        <div style={{ display: 'flex', gap: '1.75rem', color: '#64748b' }}>
          <span>Privacy Policy</span>
          <span>Terms of Clinical Care</span>
          <span>Security &amp; HIPAA</span>
        </div>
      </div>
    </footer>
  );
}
