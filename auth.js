/**
 * auth.js — Ghost Form Auth Logic
 * Handles login, signup, session management via Supabase REST API
 */

const SUPABASE_URL      = 'https://czoleruusckauzjcmmml.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tNpP7lz1K5T5NtgnT0OqAw_THzXSU28';

/* ── Helpers ──────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }

function showAlert(elId, msg, type = 'error') {
  const el = $(elId);
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
}
function hideAlert(elId) {
  $(elId).classList.add('hidden');
}

function setLoading(btnId, textId, spinnerId, loading) {
  $(btnId).disabled = loading;
  $(textId).textContent = loading ? (btnId === 'loginBtn' ? 'Signing in…' : 'Creating account…') : (btnId === 'loginBtn' ? 'Sign In' : 'Create Account');
  $(spinnerId).classList.toggle('hidden', !loading);
}

function openAuth(mode = 'login') {
  $('authOverlay').classList.remove('hidden');
  $('authOverlay').style.display = 'flex';
  switchView(mode);
}

function closeAuth() {
  $('authOverlay').style.display = 'none';
  $('authOverlay').classList.add('hidden');
}

function switchView(view) {
  $('loginView').classList.toggle('hidden', view !== 'login');
  $('signupView').classList.toggle('hidden', view !== 'signup');
  $('successView').classList.toggle('hidden', view !== 'success');
}

/* ── Session persistence ──────────────────────────────────── */
function saveSession(session, user) {
  const data = {
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    Date.now() + (session.expires_in || 3600) * 1000,
    user: {
      id:    user.id,
      email: user.email,
      name:  user.user_metadata?.name || user.email.split('@')[0],
    }
  };
  // Use localStorage since auth.html is NOT an extension page (opened in tab)
  localStorage.setItem('gf_session', JSON.stringify(data));
  // Also try chrome.storage if available (extension context)
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ gf_session: data });
  }
}

function getSession() {
  try {
    const raw = localStorage.getItem('gf_session');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() > data.expires_at) {
      localStorage.removeItem('gf_session');
      return null;
    }
    return data;
  } catch { return null; }
}

/* ── Supabase REST Auth API ───────────────────────────────── */
async function supabaseSignUp(email, password, name) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      data: { name: name || email.split('@')[0] }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || 'Sign up failed');
  return data;
}

async function supabaseSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Invalid credentials');
  return data;
}

/* ── Redirect to dashboard ────────────────────────────────── */
function redirectToDashboard() {
  switchView('success');
  setTimeout(() => {
    window.location.href = 'dashboard.html';
  }, 1400);
}

/* ── Init: check if already logged in ────────────────────── */
function initAuthPage() {
  const session = getSession();
  if (session) {
    // Already logged in — go straight to dashboard
    window.location.href = 'dashboard.html';
    return;
  }

  /* Nav buttons */
  $('navLoginBtn').addEventListener('click',    () => openAuth('login'));
  $('navSignupBtn').addEventListener('click',   () => openAuth('signup'));
  $('heroGetStarted').addEventListener('click', () => openAuth('signup'));
  $('heroSignIn').addEventListener('click',     () => openAuth('login'));
  $('ctaSignup').addEventListener('click',      () => openAuth('signup'));
  $('authClose').addEventListener('click',      closeAuth);

  /* Toggle between login / signup */
  $('goToSignup').addEventListener('click', () => { hideAlert('loginAlert'); switchView('signup'); });
  $('goToLogin').addEventListener('click',  () => { hideAlert('signupAlert'); switchView('login'); });

  /* Close on backdrop click */
  $('authOverlay').addEventListener('click', e => {
    if (e.target === $('authOverlay')) closeAuth();
  });

  /* ── LOGIN FORM ─────────────────────────────────────────── */
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    hideAlert('loginAlert');

    const email    = $('loginEmail').value.trim();
    const password = $('loginPassword').value;

    if (!email || !password) {
      showAlert('loginAlert', 'Please fill in both fields.');
      return;
    }

    setLoading('loginBtn', 'loginBtnText', 'loginSpinner', true);
    try {
      const data = await supabaseSignIn(email, password);
      saveSession(data, data.user);
      redirectToDashboard();
    } catch (err) {
      showAlert('loginAlert', err.message);
      setLoading('loginBtn', 'loginBtnText', 'loginSpinner', false);
    }
  });

  /* ── SIGN UP FORM ───────────────────────────────────────── */
  $('signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    hideAlert('signupAlert');

    const name     = $('signupName').value.trim();
    const email    = $('signupEmail').value.trim();
    const password = $('signupPassword').value;

    if (!email || !password) {
      showAlert('signupAlert', 'Email and password are required.');
      return;
    }
    if (password.length < 8) {
      showAlert('signupAlert', 'Password must be at least 8 characters.');
      return;
    }

    setLoading('signupBtn', 'signupBtnText', 'signupSpinner', true);
    try {
      const data = await supabaseSignUp(email, password, name);

      // Supabase may require email confirmation — handle both paths
      if (data.access_token) {
        // Auto-confirmed (email confirm disabled in Supabase project)
        saveSession(data, data.user);
        redirectToDashboard();
      } else {
        // Email confirmation required
        showAlert('signupAlert',
          '✅ Account created! Check your email to confirm, then sign in.',
          'success'
        );
        setLoading('signupBtn', 'signupBtnText', 'signupSpinner', false);
      }
    } catch (err) {
      showAlert('signupAlert', err.message);
      setLoading('signupBtn', 'signupBtnText', 'signupSpinner', false);
    }
  });
}

/* ── Boot ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initAuthPage);
