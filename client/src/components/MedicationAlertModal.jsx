import React, { useEffect } from 'react';
import { playMedicalChime } from '../utils/audioChime';

export default function MedicationAlertModal({ alertItem, onMarkTaken, onSnooze, onClose }) {
  if (!alertItem) return null;

  useEffect(() => {
    // Play chime sound when alert opens
    playMedicalChime();
  }, [alertItem]);

  const drugName = alertItem.title || alertItem.name || alertItem.text || 'Prescribed Medication';
  const dose = alertItem.dose || '1 dose';
  const time = alertItem.time || 'Now';
  const instructions = alertItem.instructions || alertItem.schedule || 'Take as prescribed with water.';

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{
        zIndex: 10000,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      <div 
        className="modal-dialog" 
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '520px',
          width: '100%',
          background: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(239, 68, 68, 0.1)',
          padding: '2rem',
          textAlign: 'left',
          position: 'relative'
        }}
      >
        {/* Top Header Badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
              border: '2px solid #fecaca',
              borderRadius: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem',
              animation: 'bounce 1s infinite alternate'
            }}>
              🔔
            </div>
            <div>
              <span style={{
                background: '#fee2e2',
                color: '#dc2626',
                fontSize: '0.75rem',
                fontWeight: 900,
                padding: '3px 10px',
                borderRadius: '9999px',
                textTransform: 'uppercase',
                letterSpacing: '0.6px'
              }}>
                Scheduled Alarm • Due Now
              </span>
              <h3 style={{ margin: '4px 0 0 0', fontSize: '1.35rem', fontWeight: 900, color: 'var(--navy)' }}>
                Medication Dose Alert!
              </h3>
            </div>
          </div>

          <button 
            type="button" 
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              fontSize: '1rem',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        {/* Medication Card Details */}
        <div style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
          border: '1.5px solid #c7d2fe',
          borderRadius: '16px',
          padding: '1.25rem',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '1.2rem' }}>💊</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#1e1b4b' }}>
              {drugName}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <span style={{
              background: '#ffffff',
              border: '1px solid #c7d2fe',
              color: '#4338ca',
              fontSize: '0.8rem',
              fontWeight: 800,
              padding: '3px 10px',
              borderRadius: '6px'
            }}>
              ⏰ Time: {time}
            </span>
            <span style={{
              background: '#ffffff',
              border: '1px solid #c7d2fe',
              color: '#4338ca',
              fontSize: '0.8rem',
              fontWeight: 800,
              padding: '3px 10px',
              borderRadius: '6px'
            }}>
              ⚖️ Dose: {dose}
            </span>
          </div>

          {instructions && (
            <p style={{ margin: 0, fontSize: '0.825rem', color: '#475569', lineHeight: 1.4 }}>
              <strong>Instructions:</strong> {instructions}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            type="button"
            onClick={() => onMarkTaken(alertItem)}
            style={{
              width: '100%',
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              padding: '13px',
              fontSize: '1rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
              transition: 'all 0.15s ease'
            }}
          >
            <span>✓</span>
            <span>Mark Dose as Taken Now</span>
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button
              type="button"
              onClick={() => onSnooze(alertItem, 5)}
              style={{
                background: '#ffffff',
                color: '#475569',
                border: '1.5px solid #cbd5e1',
                borderRadius: '10px',
                padding: '10px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <span>⏰</span>
              <span>Snooze (5m)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                playMedicalChime();
              }}
              style={{
                background: '#eef2ff',
                color: '#4f46e5',
                border: '1.5px solid #c7d2fe',
                borderRadius: '10px',
                padding: '10px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <span>🔔</span>
              <span>Replay Chime</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
