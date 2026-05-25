// =====================================================================
// main.js — entry point. Wires auth, client switcher, and pages.
// =====================================================================
import { sb, LAST_CLIENT_KEY } from './config.js';
import { signIn, signOut, getSession, loadUserContext, onAuthChange } from './auth.js';
import { loadMessages, sendMessage, unsubscribeMessages } from './messages.js';

// App state
const state = {
  user: null,        // auth user
  profile: null,     // profiles row (display_name, is_team)
  clients: [],       // [{id, name}]
  currentClientId: null,
};

// DOM refs (filled in on DOMContentLoaded)
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  bindLoginForm();
  bindAppShell();

  const session = await getSession();
  if (session) {
    await enterApp(session.user);
  } else {
    showLogin();
  }

  // React to login/logout from elsewhere (e.g. another tab).
  onAuthChange(async (session) => {
    if (session) await enterApp(session.user);
    else showLogin();
  });
});

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
function bindLoginForm() {
  const form = $('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    const errEl = $('loginErr');
    const btn = $('loginBtn');

    errEl.textContent = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';

    try {
      await signIn(email, password);
      // onAuthChange will fire and call enterApp.
    } catch (err) {
      errEl.textContent = err.message || 'Sign-in failed.';
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function showLogin() {
  state.user = null;
  state.profile = null;
  state.clients = [];
  state.currentClientId = null;
  unsubscribeMessages();
  $('loginScreen').style.display = 'flex';
  $('appShell').style.display = 'none';
  $('loginBtn').disabled = false;
  $('loginBtn').textContent = 'Sign in';
  $('loginPassword').value = '';
}

// ---------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------
async function enterApp(user) {
  state.user = user;

  try {
    const { profile, clients } = await loadUserContext(user.id);
    state.profile = profile;
    state.clients = clients;
    // expose for messages.js render heuristic
    window.__bg_user_is_team = !!profile.is_team;
  } catch (err) {
    console.error('loadUserContext failed:', err);
    alert('Could not load your account. Please try again or contact Bald Ginger.');
    await signOut();
    return;
  }

  // Populate user card
  const displayName = state.profile.display_name || state.profile.email;
  $('userName').textContent = displayName;
  $('userRole').textContent = state.profile.is_team ? 'Team member' : 'Client';
  $('userAvatar').textContent = initials(displayName);

  // Populate client switcher
  populateClientSwitcher();

  $('loginScreen').style.display = 'none';
  $('appShell').style.display = 'block';

  // Pick a client and load it
  if (state.clients.length === 0) {
    showNoClients();
  } else {
    const saved = localStorage.getItem(LAST_CLIENT_KEY);
    const initial = state.clients.find((c) => c.id === saved) || state.clients[0];
    setCurrentClient(initial.id);
  }
}

function bindAppShell() {
  $('logoutBtn').addEventListener('click', async () => {
    await signOut();
    // onAuthChange fires → showLogin()
  });

  $('clientSelect').addEventListener('change', (e) => {
    setCurrentClient(e.target.value);
  });

  // Composer
  $('composerSend').addEventListener('click', handleSend);
  $('composerInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
}

function populateClientSwitcher() {
  const sel = $('clientSelect');
  sel.innerHTML = state.clients
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');
}

function setCurrentClient(clientId) {
  state.currentClientId = clientId;
  localStorage.setItem(LAST_CLIENT_KEY, clientId);
  $('clientSelect').value = clientId;

  const client = state.clients.find((c) => c.id === clientId);
  $('pageTitle').textContent = client ? client.name : 'Messages';
  $('pageSub').textContent = 'Client-specific messages with the Bald Ginger team';

  // Show the messages page (only page for now)
  $('noClientsState').style.display = 'none';
  $('messagesPage').style.display = 'block';

  loadMessages(clientId, $('msgList'), state.user.id);
}

function showNoClients() {
  $('messagesPage').style.display = 'none';
  $('noClientsState').style.display = 'block';
  $('pageTitle').textContent = 'Welcome';
  $('pageSub').textContent = '';
}

async function handleSend() {
  const input = $('composerInput');
  const body = input.value.trim();
  if (!body || !state.currentClientId) return;

  const btn = $('composerSend');
  btn.disabled = true;
  try {
    await sendMessage({
      clientId: state.currentClientId,
      author: state.profile.display_name || state.profile.email,
      body,
      isTeam: !!state.profile.is_team,
    });
    input.value = '';
  } catch (err) {
    console.error('sendMessage failed:', err);
    alert('Could not send your message. ' + (err.message || ''));
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
