import React, { useState, useRef } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { extractPhoneFromText, saveHospitalContact } from '../utils/hospitalContact';

export default function DocumentAnalysisView({ currentLang, onSavePrescription, onNavigateToPrescriptions, onNavigateToOverview, onNavigateToStep }) {
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' | 'paste'
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [docType, setDocType] = useState('Discharge Summary');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const autoSavePrescription = (data, previewUrl, fileObj) => {
    const rawMeds = data.medications || data.medicationsList || [];
    const medsList = rawMeds.map((m, idx) => ({
      id: `med_${Date.now()}_${idx}`,
      name: m.name || m.drugName || 'Medication',
      dosage: m.dosage || 'As directed',
      schedule: m.schedule || m.frequency || 'Daily',
      instructions: m.instructions || m.purpose || 'Follow physician instructions.',
      critical: Boolean(m.criticalWarning || m.caution)
    }));

    const extractedPhone = data.hospitalPhone || 
      extractPhoneFromText(data.detectedClinic) || 
      extractPhoneFromText(data.summary) || 
      extractPhoneFromText(inputText);
    const hospitalName = data.hospitalName || data.detectedClinic || 'Outpatient Specialty Clinic';

    if (extractedPhone) {
      saveHospitalContact(extractedPhone, hospitalName);
    }

    const newPrescription = {
      id: `rx_${Date.now()}`,
      title: docType === 'Handwritten Prescription' ? "Doctor's Handwritten Prescription" : (data.docTitle || "Hospital Discharge Prescription"),
      doctor: data.detectedDoctor || 'Attending Physician',
      clinic: data.detectedClinic || 'Outpatient Specialty Clinic',
      hospitalName: hospitalName,
      hospitalPhone: extractedPhone || '',
      date: new Date().toISOString().split('T')[0],
      diagnosis: (data.keyDiagnoses && data.keyDiagnoses.join(', ')) || 'Clinical Post-Discharge Treatment',
      status: 'Active',
      refill: '1 Refill Remaining (30-day supply)',
      documentType: fileObj ? `${fileObj.type?.includes('pdf') ? 'PDF Scan' : 'Prescription Photo'} (Vision OCR)` : 'Clinical Text Record',
      imagePreview: previewUrl || null,
      medications: medsList,
      dailyCareChecklist: data.dailyCareChecklist || [],
      emergencyRedFlags: data.emergencyRedFlags || [],
      notes: data.summary || 'Uploaded and verified by CareBridge AI Clinical Vision OCR.'
    };

    let newApt = null;
    if (data.followUpAppointment) {
      newApt = {
        id: `apt_${Date.now()}`,
        doctor: data.detectedDoctor || 'Specialty Follow-up Clinic',
        clinic: data.detectedClinic || 'Outpatient Medical Center',
        specialty: 'Post-Discharge Review',
        date: data.followUpAppointment,
        daysRemaining: 10,
        notes: 'Bring current medication list and vitals log.'
      };
    }

    const newChecklistMeds = medsList.map((m, idx) => {
      const drugTitle = `${m.name} ${m.dosage !== 'As directed' ? m.dosage : ''}`.trim();
      return {
        id: `chk_med_${Date.now()}_${idx}`,
        title: drugTitle,
        text: drugTitle,
        time: m.schedule?.toLowerCase().includes('night') || m.schedule?.toLowerCase().includes('evening') ? '08:00 PM' : '08:00 AM',
        dose: m.dosage || '1 dose',
        schedule: m.schedule || '',
        instructions: m.instructions || m.purpose || '',
        done: false,
        alarmEnabled: true
      };
    });

    // Sync daily home care checklist to Step 4 Daily Recovery Checklist
    if (data.dailyCareChecklist && data.dailyCareChecklist.length > 0) {
      try {
        const adviceItems = data.dailyCareChecklist.map((task, idx) => ({
          id: `advice_${Date.now()}_${idx}`,
          title: task,
          text: task,
          time: 'Daily Care',
          done: false
        }));
        const savedAdvice = localStorage.getItem('carebridge_advice_checklist');
        const listAdvice = savedAdvice ? JSON.parse(savedAdvice) : [];
        const mergedAdvice = [...adviceItems, ...listAdvice.filter(a => !adviceItems.some(i => (i.title === a.title || i.text === a.title)))];
        localStorage.setItem('carebridge_advice_checklist', JSON.stringify(mergedAdvice));
      } catch (err) {
        console.error('Failed to sync advice checklist to localStorage', err);
      }
    }

    // Sync dietary restrictions to Step 4 Diet & Lifestyle Instructions
    if (data.dietaryRestrictions && data.dietaryRestrictions.length > 0) {
      try {
        const dietItems = data.dietaryRestrictions.map((rule, idx) => ({
          id: `diet_${Date.now()}_${idx}`,
          title: rule,
          text: rule,
          time: 'Diet Rule',
          done: false
        }));
        const savedDiet = localStorage.getItem('carebridge_diet_checklist');
        const listDiet = savedDiet ? JSON.parse(savedDiet) : [];
        const mergedDiet = [...dietItems, ...listDiet.filter(d => !dietItems.some(i => (i.title === d.title || i.text === d.title)))];
        localStorage.setItem('carebridge_diet_checklist', JSON.stringify(mergedDiet));
      } catch (err) {
        console.error('Failed to sync diet checklist to localStorage', err);
      }
    }

    if (onSavePrescription) {
      onSavePrescription(newPrescription, newApt, newChecklistMeds);
    } else {
      try {
        const saved = localStorage.getItem('carebridge_portal_prescriptions');
        const list = saved ? JSON.parse(saved) : [];
        const updated = [newPrescription, ...list.filter(p => p.id !== newPrescription.id)];
        localStorage.setItem('carebridge_portal_prescriptions', JSON.stringify(updated));

        if (newApt) {
          const savedApt = localStorage.getItem('carebridge_portal_appointments');
          const listApt = savedApt ? JSON.parse(savedApt) : [];
          localStorage.setItem('carebridge_portal_appointments', JSON.stringify([newApt, ...listApt]));
        }

        if (newChecklistMeds.length > 0) {
          const savedMeds = localStorage.getItem('carebridge_meds_checklist');
          const listMeds = savedMeds ? JSON.parse(savedMeds) : [];
          const cleanExisting = listMeds.filter(m => 
            !['m1', 'm2', 'm3', 'm4'].includes(m.id) &&
            !m.title?.toLowerCase().includes('pantoprazole 40')
          );
          localStorage.setItem('carebridge_meds_checklist', JSON.stringify([...newChecklistMeds, ...cleanExisting.filter(e => !newChecklistMeds.some(m => m.title === e.title))]));
          window.dispatchEvent(new Event('carebridge_meds_updated'));
        }
      } catch (err) {
        console.error('Failed to auto-save prescription to localStorage', err);
      }
    }

    setSavedSuccess(true);
  };

  const handleFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setError('');
    setResult(null);
    setSavedSuccess(false);

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    setSelectedFile(null);
    setFilePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleAnalyze = async () => {
    if (!inputText && !selectedFile) {
      setError('Please select a file to upload or paste your prescription/discharge text.');
      return;
    }

    setLoading(true);
    setError('');
    setSavedSuccess(false);

    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append('file', selectedFile);
      }
      formData.append('textContent', inputText);
      formData.append('language', currentLang || 'English');
      formData.append('docType', docType);

      const response = await fetch(`${API_BASE_URL}/api/analyze-document`, {
        method: 'POST',
        body: formData
      });

      const resData = await response.json();
      if (resData.success && resData.data) {
        const normData = { ...resData.data };
        if (!normData.medications && normData.medicationsList) {
          normData.medications = normData.medicationsList.map(m => ({
            name: m.drugName || m.name || 'Medication',
            dosage: m.dosage || 'As directed',
            schedule: m.frequency || m.schedule || 'Daily',
            instructions: m.instructions || m.caution || 'Follow physician instructions.',
            criticalWarning: m.caution || ''
          }));
        }
        setResult(normData);
        autoSavePrescription(normData, filePreviewUrl, selectedFile);
      } else {
        setError(resData.error || 'Failed to process document. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setError('Could not connect to the backend server. Ensure it is running on port 5000.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToMyPrescriptions = () => {
    if (!result) return;
    autoSavePrescription(result, filePreviewUrl, selectedFile);
  };

  return (
    <div className="document-analysis-container">
      {/* Module Title & Introduction */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span className="module-header-badge">
            Vision OCR &amp; Medical Translation
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', fontWeight: 600 }}>
            Automated extraction of medicines, doses &amp; schedules
          </span>
        </div>
        <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--navy, #0f172a)', margin: '4px 0' }}>
          Upload Document or Doctor's Prescription
        </h3>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-main, #475569)', lineHeight: 1.5 }}>
          Upload your doctor's handwritten note or hospital discharge paperwork once. All medications will be parsed and organized into their respective sections.
        </p>
      </div>

      {/* Mode Selection Tabs with Vibrant Clinical Palette */}
      <div className="ocr-mode-tab-bar">
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`ocr-mode-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
        >
          <span style={{ fontSize: '1.1rem' }}>📤</span>
          <span>Upload File (Photo or PDF)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('paste')}
          className={`ocr-mode-tab-btn ${activeTab === 'paste' ? 'active' : ''}`}
        >
          <span style={{ fontSize: '1.1rem' }}>✍️</span>
          <span>Paste Medical Notes / Text</span>
        </button>
      </div>

      {/* ================= TAB 1: UPLOAD FILE ================= */}
      {activeTab === 'upload' && (
        <div style={{ marginBottom: '1.5rem' }}>
          {/* Active File Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            className={`ocr-file-dropzone ${isDragOver ? 'drag-over' : ''}`}
          >
            {/* Hidden Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.heic,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />

            {!selectedFile ? (
              <div>
                <div className="ocr-dropzone-icon">
                  📄
                </div>

                <h4 className="ocr-dropzone-title">
                  Click to Browse or Drag &amp; Drop Prescription Here
                </h4>
                <p className="ocr-dropzone-sub">
                  Upload a photo of handwritten doctor cursive, smartphone snapshot of prescription, or digital hospital PDF summary.
                </p>

                {/* Prominent Action Buttons inside the dropzone */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '11px 22px',
                      fontSize: '0.875rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 12px rgba(79, 70, 229, 0.28)'
                    }}
                  >
                    <span>📂</span>
                    <span>Choose File from Device (PDF / Image)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
                    style={{
                      background: '#ecfdf5',
                      color: '#059669',
                      border: '1.5px solid #86efac',
                      borderRadius: '8px',
                      padding: '11px 20px',
                      fontSize: '0.875rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>📷</span>
                    <span>Take Photo / Camera</span>
                  </button>
                </div>

                <div style={{ marginTop: '1.25rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                  Supported formats: JPG, PNG, PDF, HEIC up to 25MB • Vision AI OCR enabled
                </div>
              </div>
            ) : (
              /* Selected File Banner */
              <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'left' }}>
                <div style={{
                  background: '#ffffff',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
                }}>
                  {filePreviewUrl ? (
                    <img
                      src={filePreviewUrl}
                      alt="Prescription preview"
                      style={{
                        width: '64px',
                        height: '64px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1'
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '8px',
                      background: '#f1f5f9',
                      color: '#4f46e5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.8rem',
                      border: '1px solid #e2e8f0'
                    }}>
                      📑
                    </div>
                  )}

                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {selectedFile.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                      Size: {(selectedFile.size / 1024).toFixed(1)} KB • Type: {selectedFile.type || 'Document'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    style={{
                      background: '#fff1f2',
                      border: '1.5px solid #fecdd3',
                      color: '#e11d48',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    ✕ Remove
                  </button>
                </div>

                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4f46e5',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    Choose a different file
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 2: PASTE TEXT ================= */}
      {activeTab === 'paste' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b' }}>
              Paste Hospital Discharge Summary or Prescription Text
            </label>
          </div>

          <textarea
            rows={8}
            placeholder="Paste clinical discharge summary, medication instructions, physician handwritten notes, or pharmacy labels here..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="ocr-paste-textarea form-textarea"
          />
        </div>
      )}

      {/* Control Bar: Document Type & Primary Analyze Button */}
      <div className="ocr-control-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span className="ocr-control-label">
            Document Classification:
          </span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="ocr-control-select form-select"
          >
            <option value="Discharge Summary">Hospital Discharge Summary</option>
            <option value="Handwritten Prescription">Handwritten Doctor Prescription</option>
            <option value="Lab / Imaging Report">Lab / Bloodwork / Imaging Report</option>
            <option value="Surgical Operative Note">Surgical Operative Protocol</option>
          </select>
        </div>

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading || (!selectedFile && !inputText)}
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 28px',
            fontSize: '0.9rem',
            fontWeight: 800,
            cursor: loading || (!selectedFile && !inputText) ? 'not-allowed' : 'pointer',
            opacity: loading || (!selectedFile && !inputText) ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)'
          }}
        >
          {loading ? (
            <>
              <span>⏳</span>
              <span>Running Clinical OCR &amp; Extraction...</span>
            </>
          ) : (
            <>
              <span>🔍</span>
              <span>Scan &amp; Extract Medications</span>
            </>
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          marginTop: '1.25rem',
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '10px',
          color: '#b91c1c',
          fontSize: '0.875rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* ================= RESULTS CONFIRMATION & ROUTING ================= */}
      {result && (
        <div style={{ marginTop: '2rem', borderTop: '1.5px solid #e2e8f0', paddingTop: '1.5rem' }}>
          
          {/* Top Success Banner with Clean Clinical Styling */}
          <div style={{
            background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)',
            border: '1.5px solid #86efac',
            borderRadius: '14px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.25rem',
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.08)'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: '#059669',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  fontWeight: 900,
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>✓</span>
                <h4 style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  color: '#065f46'
                }}>
                  Prescription &amp; Medical Data Decoded &amp; Synchronized
                </h4>
              </div>
              <p style={{
                margin: '6px 0 0 0',
                fontSize: '0.875rem',
                color: '#111827',
                lineHeight: 1.5
              }}>
                Your document has been verified. All extracted details have been placed into their dedicated recovery options below:
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={onNavigateToPrescriptions}
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)'
                }}
              >
                <span>View Prescriptions (Step 1)</span>
                <span>→</span>
              </button>

              {onNavigateToStep && (
                <button
                  type="button"
                  onClick={() => onNavigateToStep('followup')}
                  style={{
                    background: '#ffffff',
                    color: '#334155',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '10px 18px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>Follow-Up Visits (Step 2)</span>
                  <span>→</span>
                </button>
              )}
            </div>
          </div>

          {/* 3 Step Distribution Cards (Shows where each item lives) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1rem',
            marginBottom: '1.75rem'
          }}>
            <div className="ocr-dist-card">
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary, #4f46e5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Option 1 • Medical Records
                </span>
                <h5 style={{ margin: '6px 0 4px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--navy)' }}>
                  Prescriptions &amp; Medications
                </h5>
                <p className="ocr-dist-desc">
                  {result.medications?.length || 0} active medications parsed with dosages and schedule instructions.
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateToPrescriptions}
                style={{
                  marginTop: '1rem',
                  background: '#4f46e5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Go to Step 1: Prescriptions →
              </button>
            </div>

            <div className="ocr-dist-card">
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Option 2 • Clinic Checkups
                </span>
                <h5 style={{ margin: '6px 0 4px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--navy)' }}>
                  Follow-Up Visits
                </h5>
                <p className="ocr-dist-desc">
                  {result.followUpAppointment ? `Appointment date: ${result.followUpAppointment}.` : 'Postoperative doctor visits and calendar reminders.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToStep ? onNavigateToStep('followup') : onNavigateToPrescriptions()}
                style={{
                  marginTop: '1rem',
                  background: 'var(--success-light, #f0fdf4)',
                  color: 'var(--success, #16a34a)',
                  border: '1px solid var(--border-light, #bbf7d0)',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Go to Step 2: Follow-Up Visits →
              </button>
            </div>

            <div className="ocr-dist-card">
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Option 3 • Daily Medication Tracking
                </span>
                <h5 style={{ margin: '6px 0 4px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--navy)' }}>
                  Track Prescribed Medications
                </h5>
                <p className="ocr-dist-desc">
                  Daily medication checklist, audio alarm chimes, and live adherence tracker.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToStep ? onNavigateToStep('recovery') : onNavigateToPrescriptions()}
                style={{
                  marginTop: '1rem',
                  background: 'var(--primary-light, #eef2ff)',
                  color: 'var(--primary, #4f46e5)',
                  border: '1px solid var(--border-light, #c7d2fe)',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Go to Step 3: Track Medications →
              </button>
            </div>
          </div>

          {/* Plain-Language Clinical Summary Box */}
          <div className="ocr-summary-card">
            <h4 style={{ color: 'var(--navy)', fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
              Plain-Language Clinical Summary
            </h4>
            <p className="ocr-summary-text">
              {result.summary || result.rawText}
            </p>

            {result.keyDiagnoses && result.keyDiagnoses.length > 0 && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {result.keyDiagnoses.map((diag, i) => (
                  <span
                    key={i}
                    className="ocr-diag-pill"
                  >
                    ✓ {diag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Extracted Prescribed Medications Cards */}
          {result.medications && result.medications.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--navy)', margin: 0 }}>
                  Extracted Medications ({result.medications.length})
                </h4>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                {result.medications.map((med, idx) => (
                  <div
                    key={idx}
                    className="ocr-med-card"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--navy)' }}>
                        {med.name}
                      </div>
                      <span className="ocr-med-schedule-pill">
                        {med.schedule}
                      </span>
                    </div>

                    <div className="ocr-med-purpose">
                      <strong>Purpose:</strong> {med.purpose}
                    </div>

                    {med.instructions && (
                      <div className="ocr-med-instructions">
                        <strong>Instructions:</strong> {med.instructions}
                      </div>
                    )}

                    {med.criticalWarning && (
                      <div style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#b91c1c',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        marginTop: '0.5rem'
                      }}>
                        ⚠️ Critical: {med.criticalWarning}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
