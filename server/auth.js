import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'carebridge_ai_jwt_secret_clinical_safe_2026';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Password hashing helper
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  try {
    const candidateHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

// Simple secure JWT helper
export function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (signature !== expectedSig) return null;

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

// Initial user list is empty
function getSeedUsers() {
  return [];
}

// Read users from JSON file
export function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      const initialUsers = [];
      fs.writeFileSync(USERS_FILE, JSON.stringify(initialUsers, null, 2), 'utf-8');
      return initialUsers;
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading users database:', err);
    return [];
  }
}

// Save users to JSON file
export function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving users database:', err);
    return false;
  }
}

// Sanitize user for client response (strips sensitive hashes)
export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...safeUser } = user;
  return safeUser;
}

// Decode Google JWT without external dependency
function decodeGoogleJwt(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payloadStr = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
}

// ----------------- Auth API Handlers -----------------

// POST /api/auth/register
export async function handleRegister(req, res) {
  try {
    const { name, emailOrPhone, password, diagnosis = '', emergencyContact = '', phone = '' } = req.body;

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
    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      email: isEmail ? normalizedIdentifier : '',
      phone: !isEmail ? emailOrPhone.trim() : (phone.trim() || ''),
      passwordHash: hash,
      salt: salt,
      authProvider: 'local',
      diagnosis: diagnosis.trim() || 'General Post-Discharge Recovery',
      emergencyContact: emergencyContact.trim(),
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name.trim())}&backgroundColor=0d9488,0284c7,2563eb`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

    const token = createToken({ id: newUser.id, email: newUser.email, name: newUser.name });
    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: sanitizeUser(newUser)
    });
  } catch (error) {
    console.error('Registration error:', error);
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
      return res.status(401).json({ success: false, error: 'No account found with this email/phone. Please check your details or sign up.' });
    }

    if (!user.passwordHash || !user.salt) {
      if (user.authProvider === 'google') {
        return res.status(400).json({ 
          success: false, 
          error: 'This account was created with Google Sign-In. Please click "Continue with Google".' 
        });
      }
    }

    const isValid = verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid password. Please try again.' });
    }

    user.lastLoginAt = new Date().toISOString();
    saveUsers(users);

    const token = createToken({ id: user.id, email: user.email, name: user.name });
    return res.json({
      success: true,
      message: 'Signed in successfully.',
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during sign in.' });
  }
}

// POST /api/auth/google
export async function handleGoogleAuth(req, res) {
  try {
    const { credential, profile } = req.body;

    let googleData = null;

    // 1. If real Google ID token (credential) passed
    if (credential) {
      try {
        // Try Google's tokeninfo verification endpoint
        const verifyResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (verifyResp.ok) {
          googleData = await verifyResp.json();
        }
      } catch (networkErr) {
        console.warn('Could not reach Google tokeninfo endpoint, falling back to decoding payload:', networkErr.message);
      }

      // Fallback: decode JWT payload
      if (!googleData) {
        googleData = decodeGoogleJwt(credential);
      }
    }

    // 2. Or fallback to direct profile payload (e.g. from simulation/dev mode)
    if (!googleData && profile) {
      googleData = profile;
    }

    if (!googleData || (!googleData.email && !googleData.sub)) {
      return res.status(400).json({ success: false, error: 'Invalid Google authentication payload.' });
    }

    const googleEmail = (googleData.email || '').toLowerCase().trim();
    const googleId = googleData.sub || googleData.id || `goog_${Date.now()}`;
    const name = googleData.name || googleData.given_name || (googleEmail ? googleEmail.split('@')[0] : 'Patient');
    const avatarUrl = googleData.picture || googleData.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;

    const users = readUsers();
    let user = users.find(u => 
      (googleEmail && u.email && u.email.toLowerCase() === googleEmail) ||
      (u.googleId && u.googleId === googleId)
    );

    if (user) {
      // Existing user: link Google ID and update avatar/login timestamp
      user.googleId = googleId;
      if (!user.avatarUrl || user.avatarUrl.includes('dicebear')) {
        user.avatarUrl = avatarUrl;
      }
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
    } else {
      // New user registration via Google OAuth
      user = {
        id: `usr_g_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: name,
        email: googleEmail,
        phone: '',
        googleId: googleId,
        authProvider: 'google',
        diagnosis: 'Post-Discharge Patient Care',
        emergencyContact: '',
        avatarUrl: avatarUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      users.push(user);
    }

    saveUsers(users);

    const token = createToken({ id: user.id, email: user.email, name: user.name });
    return res.json({
      success: true,
      message: `Welcome, ${user.name}!`,
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Google OAuth error:', error);
    return res.status(500).json({ success: false, error: 'Google sign-in processing failed.' });
  }
}

// GET /api/auth/me
export async function handleGetMe(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication token missing.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded || !decoded.id) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session. Please sign in again.' });
    }

    const users = readUsers();
    const user = users.find(u => u.id === decoded.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    return res.json({
      success: true,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(500).json({ success: false, error: 'Failed to authenticate user.' });
  }
}

// PUT /api/auth/profile
export async function handleUpdateProfile(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication token missing.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded || !decoded.id) {
      return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' });
    }

    const { name, phone, diagnosis, emergencyContact } = req.body;
    const users = readUsers();
    const user = users.find(u => u.id === decoded.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (name && name.trim()) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (diagnosis !== undefined) user.diagnosis = diagnosis.trim();
    if (emergencyContact !== undefined) user.emergencyContact = emergencyContact.trim();
    user.updatedAt = new Date().toISOString();

    saveUsers(users);

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
}
