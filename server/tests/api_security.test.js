import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateToken, authorizePatient, createToken } from '../auth.js';
import { parseGeminiJson } from '../geminiService.js';

describe('API Security, Anti-IDOR and Clinical Rules Tests', () => {
  test('authenticateToken middleware rejects missing or malformed tokens', () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResponse = data;
        return this;
      }
    };

    // Case 1: Missing Authorization header
    const reqNoAuth = { headers: {} };
    authenticateToken(reqNoAuth, mockRes, () => {});
    assert.equal(statusCode, 401, 'Should return 401 Unauthorized for missing auth header');
    assert.equal(jsonResponse.success, false);

    // Case 2: Invalid Bearer token
    statusCode = null;
    const reqBadAuth = { headers: { authorization: 'Bearer completely.fake.token' } };
    authenticateToken(reqBadAuth, mockRes, () => {});
    assert.equal(statusCode, 401, 'Should return 401 Unauthorized for forged token');
  });

  test('authenticateToken accepts valid token and populates req.user', () => {
    const validToken = createToken({ id: 'pat_alice_1', role: 'PATIENT', name: 'Alice' });
    const req = { headers: { authorization: `Bearer ${validToken}` } };
    let nextCalled = false;

    authenticateToken(req, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'next() should be called');
    assert.equal(req.user.id, 'pat_alice_1');
    assert.equal(req.user.role, 'PATIENT');
  });

  test('Anti-IDOR: Patient A is blocked from accessing Patient B records', () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResponse = data;
        return this;
      }
    };

    // Patient A authenticated, requesting Patient B data
    const reqCrossPatient = {
      user: { id: 'patient_A', role: 'PATIENT' },
      params: { patientId: 'patient_B' }
    };

    let nextCalled = false;
    authorizePatient(reqCrossPatient, mockRes, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Patient A should NOT be permitted to access Patient B data');
    assert.equal(statusCode, 403, 'Must return 403 Forbidden for cross-patient access attempt');
    assert.ok(jsonResponse.error.includes('Forbidden'), 'Response should state forbidden');

    // Patient A accessing Patient A data
    const reqOwnPatient = {
      user: { id: 'patient_A', role: 'PATIENT' },
      params: { patientId: 'patient_A' }
    };

    nextCalled = false;
    authorizePatient(reqOwnPatient, mockRes, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, 'Patient accessing their own record must be allowed');
  });

  test('Clinician/Admin can access patient records for care management', () => {
    const reqClinician = {
      user: { id: 'doc_sarah', role: 'CLINICIAN' },
      params: { patientId: 'patient_A' }
    };

    let nextCalled = false;
    authorizePatient(reqClinician, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'Clinician role should be authorized to review patient record');
  });

  test('parseGeminiJson safely extracts JSON from markdown-wrapped AI responses', () => {
    const markdownResponse = '```json\n{\n  "riskLevel": "High",\n  "safetyAlert": "Potential contraindication detected"\n}\n```';
    const parsed = parseGeminiJson(markdownResponse);

    assert.equal(parsed.riskLevel, 'High');
    assert.equal(parsed.safetyAlert, 'Potential contraindication detected');

    // Plain JSON without markdown
    const plainJson = '{"diagnosis": "Post-op recovery"}';
    const parsedPlain = parseGeminiJson(plainJson);
    assert.equal(parsedPlain.diagnosis, 'Post-op recovery');
  });
});
