import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Critical Security: In production, enforce strong JWT_SECRET from environment
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  console.error('[FATAL SECURITY ERROR] Strong JWT_SECRET (min 32 chars) must be configured in environment variables for production.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || 'carebridge_clinical_development_jwt_secret_min_32_chars_2026';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory Rate Limiter for Authentication Endpoints
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_AUTH_ATTEMPTS = 15; // Max 15 attempts per minute per IP

export function authRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-client';
  const now = Date.now();
  const clientRecord = rateLimitMap.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > clientRecord.resetTime) {
    clientRecord.count = 0;
    clientRecord.resetTime = now + RATE_LIMIT_WINDOW_MS;
  }

  clientRecord.count += 1;
  rateLimitMap.set(ip, clientRecord);

  if (clientRecord.count > MAX_AUTH_ATTEMPTS) {
    return res.status(429).json({
      success: false,
      error: 'Too many authentication attempts. Please wait 60 seconds before trying again.'
    });
  }

  next();
}

// Password hashing using Scrypt with randomized salt
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  try {
    const candidateHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const candBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (candBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(candBuf, storedBuf);
  } catch {
    return false;
  }
}

// Token creation (HS256)
export function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days expiration
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

// Timing-safe Token verification
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return decoded;
  } catch {
    return null;
  }
}

// Authentication Middleware to protect routes
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please provide a valid Bearer token.'
    });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded || !decoded.id) {
    return res.status(401).json({
      success: false,
      error: 'Session invalid or expired. Please sign in again.'
    });
  }

  req.user = decoded;
  next();
}

// Patient Authorization Middleware (Anti-IDOR)
export function authorizePatient(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Unauthorized.' });
  }

  const requestedPatientId = req.params.patientId;
  // Patient is authorized if accessing their own record, or has role CLINICIAN/ADMIN
  if (requestedPatientId && req.user.id !== requestedPatientId && req.user.role !== 'ADMIN' && req.user.role !== 'CLINICIAN') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: You do not have permission to access records for this patient.'
    });
  }

  next();
}

// Read users from JSON file
export function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading users database:', err.message);
    return [];
  }
}

// Save users to JSON file
export function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving users database:', err.message);
    return false;
  }
}

// Sanitize user object for client responses
export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...safeUser } = user;
  return safeUser;
}

// ----------------- Auth API Handlers -----------------

// POST /api/auth/register
export async function handleRegister(req, res) {
  try {
    const { name, emailOrPhone, password, diagnosis = '', emergencyContact = '', phone = '', dischargeDate = '' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }
    if (!emailOrPhone || !emailOrPhone.trim()) {
      return res.status(400).json({ success: false, error: 'Email or phone number is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const normalizedIdentifier = emailOrPhone.trim().toLowerCase();
    const isEmail = normalizedIdentifier.includes('@');
    const users = readUsers();

    // Check if user already exists
    const existing = users.find(u => 
      (isEmail && u.email && u.email.toLowerCase() === normalizedIdentifier) ||
      (!isEmail && u.phone && u.phone.replace(/\D/g, '') === normalizedIdentifier.replace(/\D/g, ''))
    );

    if (existing) {
      return res.status(409).json({ 
        success: false, 
        error: isEmail ? 'An account with this email already exists. Please sign in.' : 'This phone number is already registered.' 
      });
    }

    const { hash, salt } = hashPassword(password);
    const userId = `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const newUser = {
      id: userId,
      name: name.trim(),
      email: isEmail ? normalizedIdentifier : '',
      phone: !isEmail ? emailOrPhone.trim() : (phone.trim() || ''),
      passwordHash: hash,
      salt: salt,
      role: 'PATIENT',
      authProvider: 'local',
      diagnosis: diagnosis.trim() || 'General Post-Discharge Recovery',
      dischargeDate: dischargeDate.trim() || new Date().toISOString().split('T')[0],
      emergencyContact: emergencyContact.trim(),
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name.trim())}&backgroundColor=0d9488,0284c7,2563eb`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

    const token = createToken({ id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role });
    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: sanitizeUser(newUser)
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error during registration.' });
  }
}

// POST /api/auth/login
export async function handleLogin(req, res) {
  try {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
      return res.status(400).json({ success: false, error: 'Please provide both credentials and password.' });
    }

    const identifier = emailOrPhone.trim().toLowerCase();
    const isEmail = identifier.includes('@');
    const users = readUsers();

    const user = users.find(u => {
      if (isEmail && u.email && u.email.toLowerCase() === identifier) return true;
      if (!isEmail && u.phone) {
        return u.phone.replace(/\D/g, '') === identifier.replace(/\D/g, '');
      }
      return false;
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials. Please verify email/phone and password.' });
    }

    if (!user.passwordHash || !user.salt) {
      if (user.authProvider === 'google') {
        return res.status(400).json({ 
          success: false, 
          error: 'This account was created with Google Sign-In. Please sign in with Google.' 
        });
      }
    }

    const isValid = verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials. Please verify email/phone and password.' });
    }

    user.lastLoginAt = new Date().toISOString();
    saveUsers(users);

    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role || 'PATIENT' });
    return res.json({
      success: true,
      message: 'Signed in successfully.',
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error during sign in.' });
  }
}

// POST /api/auth/google
export async function handleGoogleAuth(req, res) {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ success: false, error: 'Google credential ID token is required.' });
    }

    let googleData = null;
    try {
      const verifyResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
      if (verifyResp.ok) {
        googleData = await verifyResp.json();
      }
    } catch (networkErr) {
      console.warn('Could not verify with Google tokeninfo endpoint:', networkErr.message);
    }

    if (!googleData || !googleData.email) {
      return res.status(400).json({ success: false, error: 'Invalid or expired Google authentication credential.' });
    }

    const googleEmail = (googleData.email || '').toLowerCase().trim();
    const googleId = googleData.sub;
    const name = googleData.name || googleData.given_name || googleEmail.split('@')[0];
    const avatarUrl = googleData.picture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;

    const users = readUsers();
    let user = users.find(u => 
      (googleEmail && u.email && u.email.toLowerCase() === googleEmail) ||
      (u.googleId && u.googleId === googleId)
    );

    if (user) {
      user.googleId = googleId;
      user.avatarUrl = avatarUrl;
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
    } else {
      user = {
        id: `usr_g_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        name: name,
        email: googleEmail,
        phone: '',
        googleId: googleId,
        role: 'PATIENT',
        authProvider: 'google',
        diagnosis: 'Post-Discharge Recovery Care',
        dischargeDate: new Date().toISOString().split('T')[0],
        emergencyContact: '',
        avatarUrl: avatarUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      users.push(user);
    }

    saveUsers(users);

    const token = createToken({ id: user.id, email: user.email, name: user.name, role: user.role || 'PATIENT' });
    return res.json({
      success: true,
      message: `Welcome, ${user.name}!`,
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Google OAuth error:', error.message);
    return res.status(500).json({ success: false, error: 'Google sign-in processing failed.' });
  }
}

// GET /api/auth/me
export async function handleGetMe(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const users = readUsers();
    const user = users.find(u => u.id === userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    return res.json({
      success: true,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Auth verification error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to authenticate user.' });
  }
}

// PUT /api/auth/profile
export async function handleUpdateProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const { name, phone, diagnosis, emergencyContact, dischargeDate } = req.body;
    const users = readUsers();
    const user = users.find(u => u.id === userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (name && name.trim()) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (diagnosis !== undefined) user.diagnosis = diagnosis.trim();
    if (emergencyContact !== undefined) user.emergencyContact = emergencyContact.trim();
    if (dischargeDate !== undefined) user.dischargeDate = dischargeDate.trim();
    user.updatedAt = new Date().toISOString();

    saveUsers(users);

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Update profile error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
}
