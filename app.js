// ─────────────────────────────────────────────
//  grígora  ·  app.js
//  All UI logic, state, and interactions
// ─────────────────────────────────────────────

// ── Service Worker Registration ──────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[grígora SW] Registered:', reg.scope))
      .catch(err => console.warn('[grígora SW] Registration failed:', err));
  });
}

// ── PWA Install Banner ────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  // Show our custom install button
  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    installBtn.classList.remove('hidden');
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[grígora] Install outcome:', outcome);
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    });
  }
});

window.addEventListener('appinstalled', () => {
  console.log('[grígora] App installed successfully.');
  deferredPrompt = null;
  const installBtn = document.getElementById('install-btn');
  if (installBtn) installBtn.classList.add('hidden');
});

// ── Constants ─────────────────────────────────
const CORRECT_PIN = '1234';
const STORAGE_KEY = 'grigora_state';
const INITIAL_BALANCE = 100000.00;

// ── State ─────────────────────────────────────
let state = {
  balance: INITIAL_BALANCE,
  transactions: [],
  balanceVisible: true,
};

// ── Persistence ───────────────────────────────
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
    } catch (e) {
      console.warn('[grígora] Could not parse saved state, using defaults.');
    }
  }
}

// ── Format helpers ────────────────────────────
function fmt(amount) {
  return amount.toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBalanceDisplay() {
  return state.balanceVisible ? `${fmt(state.balance)} ETB` : '••••••  ETB';
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── DOM helpers ───────────────────────────────
function qs(sel, parent = document) { return parent.querySelector(sel); }
function qsa(sel, parent = document) { return [...parent.querySelectorAll(sel)]; }
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--visible'));
  setTimeout(() => {
    t.classList.remove('toast--visible');
    setTimeout(() => t.remove(), 400);
  }, 3000);
}

// ── PIN Screen ────────────────────────────────
let pinBuffer = '';

function initPinScreen() {
  const dots = qsa('.pin-dot');
  const keys = qsa('.pin-key');
  const errorMsg = qs('#pin-error');

  function updateDots() {
    dots.forEach((d, i) => {
      d.classList.toggle('pin-dot--filled', i < pinBuffer.length);
    });
  }

  function handleKey(val) {
    if (val === 'del') {
      pinBuffer = pinBuffer.slice(0, -1);
      updateDots();
      return;
    }
    if (pinBuffer.length >= 4) return;
    pinBuffer += val;
    updateDots();

    if (pinBuffer.length === 4) {
      setTimeout(() => {
        if (pinBuffer === CORRECT_PIN) {
          hide(qs('#pin-screen'));
          show(qs('#app'));
          pinBuffer = '';
          updateDots();
          errorMsg.classList.add('hidden');
          refreshDashboard();
        } else {
          errorMsg.classList.remove('hidden');
          qs('#pin-screen').classList.add('shake');
          setTimeout(() => qs('#pin-screen').classList.remove('shake'), 500);
          pinBuffer = '';
          updateDots();
        }
      }, 150);
    }
  }

  keys.forEach(key => {
    key.addEventListener('click', () => {
      const val = key.dataset.val;
      handleKey(val);
    });
  });
}

// ── Dashboard ─────────────────────────────────
function refreshDashboard() {
  const balEl = qs('#balance-amount');
  if (balEl) balEl.textContent = fmtBalanceDisplay();
  renderTransactionList();
  renderSparkline();
}

function initBalanceToggle() {
  const btn = qs('#balance-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.balanceVisible = !state.balanceVisible;
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = state.balanceVisible ? 'fas fa-eye' : 'fas fa-eye-slash';
    }
    refreshDashboard();
  });
}

// ── Sparkline SVG ─────────────────────────────
function renderSparkline() {
  const svg = qs('#sparkline');
  if (!svg) return;

  // Build last 7 days of spending data
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const spending = [0, 0, 0, 0, 0, 0, 0];

  const now = new Date();
  state.transactions.forEach(tx => {
    if (tx.amount < 0) {
      const d = new Date(tx.date);
      const diff = Math.floor((now - d) / 86400000);
      if (diff < 7) {
        const dayIdx = (now.getDay() + 6 - diff) % 7; // 0=Mon
        spending[dayIdx] += Math.abs(tx.amount);
      }
    }
  });

  const max = Math.max(...spending, 1);
  const W = 280, H = 70, PAD = 10;
  const stepX = (W - PAD * 2) / 6;

  const pts = spending.map((v, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v / max) * (H - PAD * 2));
    return { x, y, v };
  });

  const pathD = pts.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`)).join(' ');
  const areaD = `${pathD} L ${pts[pts.length - 1].x},${H - PAD} L ${pts[0].x},${H - PAD} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFD700" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#FFD700" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#sparkGrad)"/>
    <path d="${pathD}" fill="none" stroke="#FFD700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#FFD700" opacity="${p.v > 0 ? 1 : 0.3}"/>`).join('')}
    ${days.map((d, i) => `<text x="${pts[i].x}" y="${H + 2}" text-anchor="middle" fill="#666" font-size="8" font-family="'Sora', sans-serif">${d}</text>`).join('')}
  `;
}

// ── Transaction List ──────────────────────────
function txIcon(type) {
  const map = {
    transfer_cbe: 'fa-university',
    transfer_other: 'fa-exchange-alt',
    transfer_wallet: 'fa-mobile-alt',
    airtime: 'fa-sim-card',
    credit: 'fa-arrow-down',
  };
  return map[type] || 'fa-circle';
}

function txColor(type) {
  const map = {
    credit: '#4ade80',
    transfer_cbe: '#FFD700',
    transfer_other: '#fb923c',
    transfer_wallet: '#a78bfa',
    airtime: '#38bdf8',
  };
  return map[type] || '#888';
}

function renderTransactionList() {
  const container = qs('#transaction-list');
  if (!container) return;

  if (state.transactions.length === 0) {
    container.innerHTML = `
      <div class="tx-empty">
        <i class="fas fa-receipt"></i>
        <p>No transactions yet</p>
      </div>`;
    return;
  }

  const sorted = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  container.innerHTML = sorted.map(tx => `
    <div class="tx-item">
      <div class="tx-icon" style="background: ${txColor(tx.type)}22; color: ${txColor(tx.type)}">
        <i class="fas ${txIcon(tx.type)}"></i>
      </div>
      <div class="tx-info">
        <span class="tx-label">${tx.label}</span>
        <span class="tx-meta">${tx.subLabel || ''} · ${timeAgo(tx.date)}</span>
      </div>
      <span class="tx-amount ${tx.amount > 0 ? 'tx-amount--credit' : 'tx-amount--debit'}">
        ${tx.amount > 0 ? '+' : ''}${fmt(tx.amount)} ETB
      </span>
    </div>
  `).join('');
}

// ── Navigation ────────────────────────────────
function initNavigation() {
  const navItems = qsa('.nav-item');
  const tabs = qsa('.tab');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.tab;
      navItems.forEach(n => n.classList.remove('nav-item--active'));
      item.classList.add('nav-item--active');
      tabs.forEach(t => {
        t.classList.remove('tab--active', 'tab--enter');
        if (t.id === `tab-${target}`) {
          t.classList.add('tab--active');
          requestAnimationFrame(() => t.classList.add('tab--enter'));
          if (target === 'home') refreshDashboard();
          if (target === 'more') renderMoreTransactions();
        }
      });
    });
  });
}

// ── Transfer Form ──────────────────────────────
function initTransferForm() {
  const form = qs('#transfer-form');
  const typeSelect = qs('#transfer-type');
  const walletGroup = qs('#wallet-provider-group');
  const amountInput = qs('#transfer-amount');
  const accountInput = qs('#transfer-account');
  const noteInput = qs('#transfer-note');
  const submitBtn = qs('#transfer-submit');
  const feeDisplay = qs('#transfer-fee');

  if (!form) return;

  // Show/hide wallet provider
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'transfer_wallet') {
      show(walletGroup);
    } else {
      hide(walletGroup);
    }
    updateFeeDisplay();
  });

  amountInput.addEventListener('input', updateFeeDisplay);

  function getFee(type, amount) {
    if (type === 'transfer_cbe') return 0;
    if (type === 'transfer_other') return Math.min(Math.max(amount * 0.005, 5), 100);
    if (type === 'transfer_wallet') return 0;
    return 0;
  }

  function updateFeeDisplay() {
    const amount = parseFloat(amountInput.value) || 0;
    const type = typeSelect.value;
    const fee = getFee(type, amount);
    if (feeDisplay) {
      feeDisplay.textContent = fee === 0
        ? 'Service fee: Free'
        : `Service fee: ${fmt(fee)} ETB`;
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();

    const type = typeSelect.value;
    const account = accountInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const note = noteInput.value.trim();
    const walletProvider = qs('#wallet-provider')?.value || '';

    // Validations
    if (!account) { toast('Please enter an account number.', 'error'); return; }
    if (!amount || amount <= 0) { toast('Enter a valid amount.', 'error'); return; }

    const fee = getFee(type, amount);
    const total = amount + fee;

    if (total > state.balance) {
      toast(`Insufficient funds. Available: ${fmt(state.balance)} ETB`, 'error');
      submitBtn.classList.add('shake');
      setTimeout(() => submitBtn.classList.remove('shake'), 500);
      return;
    }

    // Build label
    let label = '';
    let subLabel = account;
    if (type === 'transfer_cbe') label = 'Transfer · CBE';
    else if (type === 'transfer_other') label = 'Transfer · Other Bank';
    else if (type === 'transfer_wallet') label = `Transfer · ${walletProvider || 'Wallet'}`;

    if (note) subLabel += ` — ${note}`;

    // Confirm dialog
    const confirmMsg = `Send ${fmt(amount)} ETB${fee > 0 ? ` + ${fmt(fee)} ETB fee` : ''} to ${account}?`;
    if (!confirm(confirmMsg)) return;

    // Apply transaction
    state.balance -= total;
    state.transactions.push({
      id: Date.now(),
      type,
      label,
      subLabel,
      amount: -total,
      date: new Date().toISOString(),
    });
    saveState();

    // Feedback
    submitBtn.classList.add('btn--success');
    setTimeout(() => submitBtn.classList.remove('btn--success'), 1500);
    toast(`${fmt(amount)} ETB sent successfully!`, 'success');

    // Reset form
    form.reset();
    hide(walletGroup);
    updateFeeDisplay();

    // Switch to home tab after brief delay
    setTimeout(() => {
      const homeNav = qs('[data-tab="home"]');
      if (homeNav) homeNav.click();
    }, 1200);
  });
}

// ── QR Scanner (mock) ─────────────────────────
function initQRTab() {
  const scanBtn = qs('#qr-scan-btn');
  if (!scanBtn) return;
  scanBtn.addEventListener('click', () => {
    toast('Camera access required. Scanning simulated.', 'info');
    setTimeout(() => {
      qs('#qr-result').classList.remove('hidden');
    }, 1200);
  });

  const payBtn = qs('#qr-pay-btn');
  if (payBtn) {
    payBtn.addEventListener('click', () => {
      const amt = 350;
      if (amt > state.balance) { toast('Insufficient funds.', 'error'); return; }
      state.balance -= amt;
      state.transactions.push({
        id: Date.now(),
        type: 'transfer_other',
        label: 'QR Payment · Addis Cafe',
        subLabel: 'Bole Road Branch',
        amount: -amt,
        date: new Date().toISOString(),
      });
      saveState();
      toast('350.00 ETB paid to Addis Cafe!', 'success');
      hide(qs('#qr-result'));
    });
  }
}

// ── More Tab ──────────────────────────────────
function renderMoreTransactions() {
  // Just refresh the mini list in more tab if present
}

function initMoreTab() {
  const airtimeBtn = qs('#buy-airtime-btn');
  if (!airtimeBtn) return;

  airtimeBtn.addEventListener('click', () => {
    const amtStr = prompt('Enter airtime amount (ETB):', '50');
    if (!amtStr) return;
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) { toast('Invalid amount.', 'error'); return; }
    if (amt > state.balance) { toast('Insufficient funds.', 'error'); return; }

    const phone = prompt('Phone number:', '+251 9');
    if (!phone) return;

    state.balance -= amt;
    state.transactions.push({
      id: Date.now(),
      type: 'airtime',
      label: 'Airtime Top-Up',
      subLabel: phone,
      amount: -amt,
      date: new Date().toISOString(),
    });
    saveState();
    toast(`${fmt(amt)} ETB airtime purchased!`, 'success');
    refreshDashboard();
  });
}

// ── Quick Actions (Home) ──────────────────────
function initQuickActions() {
  const transferQuick = qs('#quick-transfer');
  if (transferQuick) {
    transferQuick.addEventListener('click', () => {
      qs('[data-tab="transfer"]')?.click();
    });
  }

  const airtimeQuick = qs('#quick-airtime');
  if (airtimeQuick) {
    airtimeQuick.addEventListener('click', () => {
      qs('[data-tab="more"]')?.click();
      setTimeout(() => qs('#buy-airtime-btn')?.click(), 300);
    });
  }

  const qrQuick = qs('#quick-qr');
  if (qrQuick) {
    qrQuick.addEventListener('click', () => {
      qs('[data-tab="qr"]')?.click();
    });
  }
}

// ── Boot ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadState();

  initPinScreen();
  initBalanceToggle();
  initNavigation();
  initTransferForm();
  initQRTab();
  initMoreTab();
  initQuickActions();

  // Animate pin screen in
  setTimeout(() => qs('#pin-screen')?.classList.add('pin-screen--visible'), 100);
});
