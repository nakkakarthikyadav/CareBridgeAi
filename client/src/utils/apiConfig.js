// API Configuration for local development and live cloud production deployment
export const API_BASE_URL = typeof window !== 'undefined' && window.location.origin.includes(':5173')
  ? 'http://localhost:5000'
  : '';

export function getAuthToken() {
  try {
    return localStorage.getItem('carebridge_auth_token') || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem('carebridge_auth_token', token);
    } else {
      localStorage.removeItem('carebridge_auth_token');
    }
  } catch {}
}

export function clearAuthToken() {
  try {
    localStorage.removeItem('carebridge_auth_token');
    localStorage.removeItem('carebridge_user');
  } catch {}
}

/**
 * Authenticated Fetch wrapper that automatically attaches JWT Bearer token
 * and handles session expiration gracefully.
 */
export async function authFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  const token = getAuthToken();

  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If body is JSON and Content-Type not set, set it
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    // Unauthorized / Expired session
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('carebridge:session-expired'));
  }

  return response;
}

// ----------------- Patient API Service -----------------
export const api = {
  // Profile
  getPatientProfile: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}`);
    return res.json();
  },
  updatePatientProfile: async (patientId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
    return res.json();
  },

  // Prescriptions
  getPrescriptions: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/prescriptions`);
    return res.json();
  },
  savePrescription: async (patientId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/prescriptions`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  deletePrescription: async (patientId, prescriptionId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/prescriptions/${prescriptionId}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  // Medications
  getMedications: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/medications`);
    return res.json();
  },
  saveMedication: async (patientId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/medications`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  updateMedication: async (patientId, medicationId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/medications/${medicationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  deleteMedication: async (patientId, medicationId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/medications/${medicationId}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  // Dose Logs
  logDose: async (patientId, medicationId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/medications/${medicationId}/logs`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  getDoseLogs: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/medication-logs`);
    return res.json();
  },

  // Appointments
  getAppointments: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/appointments`);
    return res.json();
  },
  saveAppointment: async (patientId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  updateAppointment: async (patientId, appointmentId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  deleteAppointment: async (patientId, appointmentId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/appointments/${appointmentId}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  // Recovery Vitals & Observations
  getRecoveryLogs: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/recovery`);
    return res.json();
  },
  saveRecoveryLog: async (patientId, data) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/recovery`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return res.json();
  },
  getRecoverySummary: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/recovery/summary`);
    return res.json();
  },

  // Notifications
  getNotifications: async (patientId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/notifications`);
    return res.json();
  },
  markNotificationRead: async (patientId, notificationId) => {
    const res = await authFetch(`/api/v1/patients/${patientId}/notifications/${notificationId}/read`, {
      method: 'PATCH'
    });
    return res.json();
  }
};
