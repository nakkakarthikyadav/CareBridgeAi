import React, { useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';

export default function HandwrittenOCRView({ onSavePrescription, onNavigateToPrescriptions, onNavigateToOverview }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Editable review state
  const [reviewedDoctor, setReviewedDoctor] = useState('');
  const [reviewedClinic, setReviewedClinic] = useState('');
  const [reviewedDate, setReviewedDate] = useState('');
  const [reviewedMedications, setReviewedMedications] = useState([]);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setImagePreview(URL.createObjectURL(file));
      setResult(null);
      setIsConfirmed(false);
    }
  };

  const handleRecognize = async () => {
    if (!selectedFile) {
      setError('Please select or upload a handwritten prescription image first.');
      return;
    }

    setLoading(true);
    setError('');
    setIsConfirmed(false);

    try {
      const formData = new FormData();
      formData.append('prescriptionImage', selectedFile);

      const response = await fetch(`${API_BASE_URL}/api/handwritten-ocr`, {
        method: 'POST',
        body: formData
      });

      const resData = await response.json();
      if (resData.success && resData.data) {
        setResult(resData.data);
        setReviewedDoctor(resData.data.detectedDoctor || '');
        setReviewedClinic(resData.data.detectedClinic || '');
        setReviewedDate(resData.data.prescriptionDate || new Date().toISOString().split('T')[0]);

        const initialMeds = (resData.data.medicationsList || []).map((m, idx) => ({
          id: `med_${Date.now()}_${idx}`,
          drugName: m.drugName || 'Medication',
          dosage: m.dosage || 'As directed',
          frequency: m.frequency || 'Daily',
          instructions: m.instructions || 'Follow directions.',
          caution: m.caution || ''
        }));
        setReviewedMedications(initialMeds);
      } else {
        setError(resData.error || 'Failed to recognize handwritten prescription.');
      }
    } catch (err) {
      console.error(err);
      setError('Could not connect to backend server. Make sure server is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleMedChange = (index, field, value) => {
    setReviewedMedications(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveMed = (index) => {
    setReviewedMedications(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleAddMed = () => {
    setReviewedMedications(prev => [
      ...prev,
      {
        id: `med_${Date.now()}_${prev.length}`,
        drugName: '',
        dosage: 'As directed',
        frequency: 'Once daily',
        instructions: '',
        caution: ''
      }
    ]);
  };

  // Human confirmation step: User reviews & approves before schedules are created
  const handleConfirmAndSave = () => {
    const medsList = reviewedMedications.map(m => ({
      id: m.id,
      name: m.drugName.trim() || 'Medication',
      dosage: m.dosage.trim() || 'As directed',
      schedule: m.frequency.trim() || 'Daily',
      instructions: m.instructions.trim() || 'Take as directed by physician.',
      critical: Boolean(m.caution)
    }));

    const newPrescription = {
      id: `rx_${Date.now()}`,
      title: "Doctor's Handwritten Prescription",
      doctor: reviewedDoctor.trim() || 'Prescribing Physician',
      clinic: reviewedClinic.trim() || 'Medical Clinic',
      date: reviewedDate || new Date().toISOString().split('T')[0],
      diagnosis: 'Physician Prescribed Treatment Course',
      status: 'Active',
      refill: '',
      documentType: 'Handwritten Doctor Note (OCR & HTR Verified)',
      imagePreview: imagePreview || null,
      medications: medsList,
      dailyCareChecklist: [],
      emergencyRedFlags: [],
      notes: result?.normalizedDigitalText || 'Transcribed from handwritten prescription and verified by patient.',
      verificationStatus: 'VERIFIED',
      humanVerified: true
    };

    const newChecklistMeds = medsList.map((m, idx) => ({
      id: `chk_med_${Date.now()}_${idx}`,
      title: `${m.name} ${m.dosage !== 'As directed' ? m.dosage : ''}`.trim(),
      time: m.schedule?.toLowerCase().includes('night') || m.schedule?.toLowerCase().includes('evening') ? '08:00 PM' : '08:00 AM',
      dose: m.dosage || '1 dose',
      done: false,
      alarmEnabled: true
    }));

    if (onSavePrescription) {
      onSavePrescription(newPrescription, null, newChecklistMeds);
    } else {
      try {
        const saved = localStorage.getItem('carebridge_portal_prescriptions');
        const list = saved ? JSON.parse(saved) : [];
        const updated = [newPrescription, ...list.filter(p => p.id !== newPrescription.id)];
        localStorage.setItem('carebridge_portal_prescriptions', JSON.stringify(updated));

        if (newChecklistMeds.length > 0) {
          const savedMeds = localStorage.getItem('carebridge_meds_checklist');
          const listMeds = savedMeds ? JSON.parse(savedMeds) : [];
          localStorage.setItem('carebridge_meds_checklist', JSON.stringify([...newChecklistMeds, ...listMeds]));
        }
      } catch (err) {
        console.error('Failed to save handwritten prescription to localStorage', err);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('carebridge:prescription-updated'));
    }

    setIsConfirmed(true);
  };

  return (
    <div className="handwritten-ocr-container">
      <div className="ocr-grid-layout">
        {/* Left: Image input & preview */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--navy)' }}>
              📷 Doctor's Handwritten Prescription
            </span>
            {selectedFile && (
              <button 
                type="button" 
                onClick={() => {
                  setSelectedFile(null);
                  setImagePreview(null);
                  setResult(null);
                  setIsConfirmed(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                ✕ Clear
              </button>
            )}
          </div>

          <div 
            style={{
              border: '2px dashed #cbd5e1',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: '#f8fafc',
              textAlign: 'center',
              position: 'relative',
              cursor: 'pointer'
            }}
            onClick={() => document.getElementById('handwritingFileInput').click()}
          >
            {imagePreview ? (
              <img 
                src={imagePreview} 
                alt="Handwritten prescription preview" 
                style={{ width: '100%', maxHeight: '420px', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <div style={{ padding: '3rem 1.5rem' }}>
                <span style={{ fontSize: '3rem' }}>✍️</span>
                <p style={{ fontWeight: 700, marginTop: '0.5rem' }}>Click or drop doctor's prescription here</p>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Supports physician cursive handwriting &amp; clinical symbols</span>
              </div>
            )}
          </div>

          <input 
            id="handwritingFileInput" 
            type="file" 
            accept="image/*" 
            style={{ display: 'none' }} 
            onChange={handleFileChange}
          />

          <button 
            className="btn-hero-launch" 
            onClick={handleRecognize} 
            disabled={loading || !selectedFile}
            style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem', padding: '14px', opacity: !selectedFile ? 0.6 : 1 }}
          >
            {loading ? '🧠 Transcribing Cursive Handwriting...' : '⚡ Recognize Handwritten Text'}
          </button>

          <div style={{ marginTop: '1rem', background: '#eef2ff', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.775rem', color: '#4338ca' }}>
            <strong>Clinical Safety Protocol:</strong> All OCR extractions require patient/clinician review before medication alarms and schedules are activated.
          </div>
        </div>

        {/* Right: Converted normal text results & review */}
        <div>
          {error && (
            <div style={{ padding: '12px 16px', background: 'var(--danger-light)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontWeight: 600, marginBottom: '1.5rem' }}>
              {error}
            </div>
          )}

          {!result && !loading && (
            <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '3rem 2rem', textAlign: 'center' }}>
              <span style={{ fontSize: '2.5rem' }}>📝</span>
              <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--navy)', marginTop: '0.75rem' }}>
                Automated Handwriting Transcription Ready
              </h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: '440px', margin: '0.5rem auto 1.5rem auto' }}>
                Upload a doctor's cursive prescription to transcribe it into clean digital text and expand Latin medical abbreviations.
              </p>
              <button 
                className="btn-signin-pill" 
                onClick={() => document.getElementById('handwritingFileInput').click()} 
                style={{ margin: '0 auto' }}
              >
                📂 Choose Prescription Photo
              </button>
            </div>
          )}

          {loading && (
            <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '3rem 2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', animation: 'spin 1.5s infinite linear' }}>⏳</div>
              <h4 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--navy)', marginTop: '1rem' }}>
                Transcribing Physician Cursive Handwriting...
              </h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Applying neural OCR and expanding medical Latin tags.
              </p>
            </div>
          )}

          {result && (
            <div style={{ background: '#ffffff', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '2rem', boxShadow: 'var(--shadow-sm)' }}>
              
              {/* Confirmed Banner */}
              {isConfirmed ? (
                <div style={{
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: '1.5px solid #10b981',
                  borderRadius: '12px',
                  padding: '1rem 1.25rem',
                  marginBottom: '1.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.4rem' }}>✅</span>
                    <div>
                      <strong style={{ color: '#064e3b', fontSize: '0.98rem', display: 'block' }}>
                        Prescription Verified &amp; Schedules Created!
                      </strong>
                      <span style={{ color: '#047857', fontSize: '0.8rem' }}>
                        Your verified medications and dose reminders are active in your Recovery Dashboard.
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {onNavigateToPrescriptions && (
                      <button
                        type="button"
                        onClick={onNavigateToPrescriptions}
                        style={{
                          background: '#059669',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '8px 16px',
                          fontSize: '0.825rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        💊 View Prescriptions →
                      </button>
                    )}
                    {onNavigateToOverview && (
                      <button
                        type="button"
                        onClick={onNavigateToOverview}
                        style={{
                          background: '#ffffff',
                          color: '#065f46',
                          border: '1px solid #a7f3d0',
                          borderRadius: '8px',
                          padding: '8px 14px',
                          fontSize: '0.825rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        🏠 Dashboard
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  marginBottom: '1.5rem',
                  fontSize: '0.85rem',
                  color: '#92400e'
                }}>
                  <strong>⚠️ Review Extracted Details:</strong> Please verify the transcribed medications and instructions below. Correct any misread words before confirming to create active reminder schedules.
                </div>
              )}

              {/* Ambiguous fields alert if flagged */}
              {result.ambiguousOrUnclearFields && result.ambiguousOrUnclearFields.length > 0 && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginBottom: '1.25rem',
                  fontSize: '0.825rem',
                  color: '#991b1b'
                }}>
                  <strong>🔍 Unclear / Ambiguous Fields Flagged by OCR:</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {result.ambiguousOrUnclearFields.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Editable Physician & Clinic Header */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block' }}>
                    Prescribing Doctor
                  </label>
                  <input
                    type="text"
                    value={reviewedDoctor}
                    onChange={(e) => setReviewedDoctor(e.target.value)}
                    placeholder="Doctor Name (e.g. Dr. Rajesh Kumar)"
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block' }}>
                    Clinic / Hospital Header
                  </label>
                  <input
                    type="text"
                    value={reviewedClinic}
                    onChange={(e) => setReviewedClinic(e.target.value)}
                    placeholder="Clinic or Hospital Name"
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block' }}>
                    Prescription Date
                  </label>
                  <input
                    type="date"
                    value={reviewedDate}
                    onChange={(e) => setReviewedDate(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.875rem', marginTop: '4px' }}
                  />
                </div>
              </div>

              {/* Normalized typed text display */}
              <div style={{ marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Normal Typed Transcription:
                </span>
                <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '1rem 1.25rem', marginTop: '6px', fontSize: '0.925rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--navy)' }}>
                  {result.normalizedDigitalText || (result.rawHandwrittenLines ? result.rawHandwrittenLines.join('\n') : result.rawText)}
                </div>
              </div>

              {/* Editable Medications List */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Prescribed Medications (Click any field to correct):
                  </span>
                  <button
                    type="button"
                    onClick={handleAddMed}
                    style={{ background: 'none', border: 'none', color: '#4f46e5', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    + Add Medication
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {reviewedMedications.map((m, idx) => (
                    <div key={idx} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderLeft: '4px solid #4f46e5', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={m.drugName}
                          onChange={(e) => handleMedChange(idx, 'drugName', e.target.value)}
                          placeholder="Drug Name"
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '0.9rem' }}
                        />
                        <input
                          type="text"
                          value={m.dosage}
                          onChange={(e) => handleMedChange(idx, 'dosage', e.target.value)}
                          placeholder="Dosage (e.g. 500mg)"
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        />
                        <input
                          type="text"
                          value={m.frequency}
                          onChange={(e) => handleMedChange(idx, 'frequency', e.target.value)}
                          placeholder="Frequency"
                          style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveMed(idx)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.1rem' }}
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                      <input
                        type="text"
                        value={m.instructions}
                        onChange={(e) => handleMedChange(idx, 'instructions', e.target.value)}
                        placeholder="Instructions (e.g. Take with water after meals)"
                        style={{ width: '100%', marginTop: '6px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#475569' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Abbreviations decoded */}
              {result.abbreviationsExpanded && result.abbreviationsExpanded.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: '1.5rem' }}>
                  <strong style={{ fontSize: '0.8rem', color: '#92400e', display: 'block', marginBottom: '4px' }}>
                    💡 Latin Medical Abbreviations Decoded:
                  </strong>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.8rem', color: '#78350f' }}>
                    {result.abbreviationsExpanded.map((item, i) => (
                      <span key={i}>
                        <strong>{item.abbreviation}:</strong> {item.meaning}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Human Confirmation Action Button */}
              {!isConfirmed && (
                <button
                  type="button"
                  onClick={handleConfirmAndSave}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '1rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <span>✓</span>
                  <span>Confirm Verified Prescription &amp; Activate Medication Schedules</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
