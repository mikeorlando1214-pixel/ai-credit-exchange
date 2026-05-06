/* ═══════════════════════════════════════════════════════════════
   AI Credit Exchange — Vault  |  script.js  v2.0
   Calculator + Vault (deposit / withdraw / exchange) + History
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONFIG ─────────────────────────────────────────────────── */
const API_BASE = 'https://ai-credit-exchange-1.onrender.com';

const PLATFORM_META = {
  openai:     { symbol: 'OAI', color: '#10A37F', name: 'OpenAI Credit' },
  perplexity: { symbol: 'PPX', color: '#FF6B2B', name: 'Perplexity Credit' },
};

const TYPE_ICONS = {
  deposit:  '↓',
  withdraw: '↑',
  exchange: '⇄',
};

/* ─── STATE ──────────────────────────────────────────────────── */
let vaultBalances   = {};   // { openai: 5000, perplexity: 9250 }
let exchangeRates   = {};   // { openai: { perplexity: 1.85 }, ... }
let previewPending  = false; // whether exchange preview is shown & valid
let backendOnline   = false;

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */

/** POST JSON to an API endpoint, return parsed response. */
async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

/** GET an API endpoint, return parsed response. */
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return res.json();
}

/** Format a number with commas and up to 4 decimal places. */
function fmt(n, decimals = 4) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** Format a timestamp as a relative time string. */
function relativeTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 5)   return 'just now';
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

/** Set loading state on an action button. */
function setLoading(btn, loading) {
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled  = loading;
  if (text)    text.hidden    = loading;
  if (spinner) spinner.hidden = !loading;
}

/** Show feedback message inside an action card. */
function showFeedback(el, type, msg) {
  el.className  = `action-feedback ${type}`;
  el.textContent = msg;
  el.hidden     = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

/* ═══════════════════════════════════════════════════════════════
   TOAST SYSTEM
═══════════════════════════════════════════════════════════════ */
const toastContainer = document.getElementById('toastContainer');

function toast(type, title, msg, duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/* ═══════════════════════════════════════════════════════════════
   CONNECTION STATUS
═══════════════════════════════════════════════════════════════ */
const statusDot  = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function setStatus(online) {
  backendOnline = online;
  statusDot.className  = `status-dot ${online ? 'online' : 'offline'}`;
  statusText.textContent = online ? 'Backend live' : 'Offline mode';
}

async function checkHealth() {
  try {
    const data = await apiGet('/api/health');
    setStatus(data.status === 'ok');
  } catch {
    setStatus(false);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TICKER
═══════════════════════════════════════════════════════════════ */
async function loadTicker() {
  try {
    const data = await apiGet('/api/rates');
    if (!data.success) return;
    exchangeRates = data.rates;
    const items = [];
    for (const [from, targets] of Object.entries(data.rates)) {
      for (const [to, rate] of Object.entries(targets)) {
        if (from === to) continue;
        const fs = PLATFORM_META[from]?.symbol || from.toUpperCase();
        const ts = PLATFORM_META[to]?.symbol   || to.toUpperCase();
        items.push(`1 ${fs} = ${Number(rate).toFixed(4)} ${ts}`);
      }
    }
    // Duplicate for seamless loop
    const doubled = [...items, ...items];
    const track = document.getElementById('tickerTrack');
    track.innerHTML = doubled.map((t, i) =>
      `<span class="ticker-item">${t}</span>${i < doubled.length - 1 ? '<span class="ticker-sep">·</span>' : ''}`
    ).join('');
  } catch { /* keep default */ }
}

/* ═══════════════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════════════ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;

    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab);
    });

    // Update panels
    document.querySelectorAll('.panel').forEach(p => {
      const isActive = p.id === `panel-${tab}`;
      p.classList.toggle('active', isActive);
      p.hidden = !isActive;
    });

    // Load vault data when switching to vault tab
    if (tab === 'vault') {
      loadVaultBalances();
      loadHistory();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   CALCULATOR
═══════════════════════════════════════════════════════════════ */
const fromAmountEl  = document.getElementById('fromAmount');
const toAmountEl    = document.getElementById('toAmount');
const fromCurrEl    = document.getElementById('fromCurrency');
const toCurrEl      = document.getElementById('toCurrency');
const fromBadgeEl   = document.getElementById('fromBadge');
const toBadgeEl     = document.getElementById('toBadge');
const ratePillEl    = document.getElementById('ratePill');
const swapBtn       = document.getElementById('swapBtn');
const convertBtn    = document.getElementById('convertBtn');
const resultPanel   = document.getElementById('resultPanel');
const calcError     = document.getElementById('calcError');

function updateCalcBadges() {
  const from = fromCurrEl.value;
  const to   = toCurrEl.value;
  const fm   = PLATFORM_META[from];
  const tm   = PLATFORM_META[to];
  fromBadgeEl.textContent = fm?.symbol || from.toUpperCase();
  fromBadgeEl.style.background = fm?.color || '#6c63ff';
  toBadgeEl.textContent   = tm?.symbol || to.toUpperCase();
  toBadgeEl.style.background   = tm?.color || '#6c63ff';

  // Update rate pill from cached rates
  if (exchangeRates[from]?.[to]) {
    const rate = exchangeRates[from][to];
    ratePillEl.textContent = `1 ${fm?.symbol} = ${Number(rate).toFixed(4)} ${tm?.symbol}`;
  }
}

fromCurrEl.addEventListener('change', () => {
  // Prevent same currency on both sides
  if (fromCurrEl.value === toCurrEl.value) {
    toCurrEl.value = Object.keys(PLATFORM_META).find(k => k !== fromCurrEl.value);
  }
  updateCalcBadges();
  resultPanel.hidden = true;
  calcError.hidden   = true;
});

toCurrEl.addEventListener('change', () => {
  if (toCurrEl.value === fromCurrEl.value) {
    fromCurrEl.value = Object.keys(PLATFORM_META).find(k => k !== toCurrEl.value);
  }
  updateCalcBadges();
  resultPanel.hidden = true;
  calcError.hidden   = true;
});

swapBtn.addEventListener('click', () => {
  const prevFrom = fromCurrEl.value;
  const prevTo   = toCurrEl.value;
  const prevConverted = toAmountEl.value;

  fromCurrEl.value = prevTo;
  toCurrEl.value   = prevFrom;
  fromAmountEl.value = prevConverted || fromAmountEl.value;
  toAmountEl.value   = '';
  updateCalcBadges();
  resultPanel.hidden = true;
  calcError.hidden   = true;
});

convertBtn.addEventListener('click', async () => {
  const amount = parseFloat(fromAmountEl.value);
  calcError.hidden   = true;
  resultPanel.hidden = true;

  if (!fromAmountEl.value || isNaN(amount) || amount <= 0) {
    calcError.textContent = 'Please enter a valid amount greater than zero.';
    calcError.hidden = false;
    return;
  }

  setLoading(convertBtn, true);

  try {
    const data = await apiPost('/api/convert', {
      amount:        amount,
      from_currency: fromCurrEl.value,
      to_currency:   toCurrEl.value,
    });

    if (!data.success) {
      calcError.textContent = data.error || 'Conversion failed.';
      calcError.hidden = false;
    } else {
      toAmountEl.value = fmt(data.converted_amount, 6);
      document.getElementById('resultRate').textContent    = data.rate_display;
      document.getElementById('resultInverse').textContent = data.inverse_rate_display;
      document.getElementById('resultTotal').textContent   =
        `${fmt(data.converted_amount, 4)} ${data.to_symbol}`;
      resultPanel.hidden = false;
    }
  } catch {
    // Offline fallback: calculate client-side
    const rate = exchangeRates[fromCurrEl.value]?.[toCurrEl.value];
    if (rate) {
      const converted = amount * rate;
      const fm = PLATFORM_META[fromCurrEl.value];
      const tm = PLATFORM_META[toCurrEl.value];
      toAmountEl.value = fmt(converted, 6);
      document.getElementById('resultRate').textContent    = `1 ${fm.symbol} = ${Number(rate).toFixed(4)} ${tm.symbol}`;
      document.getElementById('resultInverse').textContent = `1 ${tm.symbol} = ${(1/rate).toFixed(4)} ${fm.symbol}`;
      document.getElementById('resultTotal').textContent   = `${fmt(converted, 4)} ${tm.symbol}`;
      resultPanel.hidden = false;
    } else {
      calcError.textContent = 'Backend offline and no cached rates available.';
      calcError.hidden = false;
    }
  } finally {
    setLoading(convertBtn, false);
  }
});

// Allow Enter key to trigger convert
fromAmountEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') convertBtn.click();
});

/* ═══════════════════════════════════════════════════════════════
   VAULT — BALANCE CARDS
═══════════════════════════════════════════════════════════════ */
const balanceGrid = document.getElementById('balanceGrid');

async function loadVaultBalances() {
  try {
    const data = await apiGet('/api/vault/balances');
    if (!data.success) return;
    vaultBalances = {};
    for (const [platform, info] of Object.entries(data.vault)) {
      vaultBalances[platform] = info.balance;
    }
    renderBalanceCards(data.vault);
    syncWithdrawMax();
    syncExchangeMax();
  } catch {
    // Show error state in cards
    balanceGrid.innerHTML = `
      <div class="balance-card" style="grid-column:1/-1">
        <p style="color:var(--error);font-size:13px;text-align:center;padding:20px 0">
          ⚠️ Could not load vault balances — backend may be offline.
        </p>
      </div>`;
  }
}

function renderBalanceCards(vault) {
  balanceGrid.innerHTML = '';
  for (const [platform, info] of Object.entries(vault)) {
    const meta = PLATFORM_META[platform] || {};
    const card = document.createElement('div');
    card.className = 'balance-card';
    card.id = `balance-card-${platform}`;
    card.style.setProperty('--card-color', meta.color || '#6c63ff');
    card.innerHTML = `
      <div class="balance-card-header">
        <span class="balance-platform-name">${info.name || platform}</span>
        <span class="balance-symbol-badge" style="background:${meta.color || '#6c63ff'}">${info.symbol}</span>
      </div>
      <div class="balance-amount" id="balance-amount-${platform}">${fmt(info.balance, 2)}</div>
      <div class="balance-label">${info.symbol} available in vault</div>
      <span class="balance-change neutral" id="balance-change-${platform}">Demo balance</span>
    `;
    balanceGrid.appendChild(card);
  }
}

/** Animate a balance card update with flash effect. */
function animateBalanceUpdate(platform, newBalance, changeType) {
  const amountEl = document.getElementById(`balance-amount-${platform}`);
  const changeEl = document.getElementById(`balance-change-${platform}`);
  if (!amountEl) return;

  amountEl.classList.add('updating');
  setTimeout(() => {
    amountEl.textContent = fmt(newBalance, 2);
    amountEl.classList.remove('updating');
  }, 300);

  if (changeEl && changeType) {
    const labels = { deposit: 'positive', withdraw: 'negative', exchange: 'positive' };
    const texts  = { deposit: '↑ Deposited', withdraw: '↓ Withdrawn', exchange: '⇄ Exchanged' };
    changeEl.className = `balance-change ${labels[changeType] || 'neutral'}`;
    changeEl.textContent = texts[changeType] || changeType;
  }

  vaultBalances[platform] = newBalance;
}

/** Refresh all balance cards from a vault snapshot. */
function refreshBalancesFromVault(vault) {
  for (const [platform, info] of Object.entries(vault)) {
    const amountEl = document.getElementById(`balance-amount-${platform}`);
    if (amountEl) amountEl.textContent = fmt(info.balance, 2);
    vaultBalances[platform] = info.balance;
  }
  syncWithdrawMax();
  syncExchangeMax();
}

/* ═══════════════════════════════════════════════════════════════
   VAULT — DEPOSIT
═══════════════════════════════════════════════════════════════ */
const depositPlatformEl = document.getElementById('depositPlatform');
const depositAmountEl   = document.getElementById('depositAmount');
const depositSymbolEl   = document.getElementById('depositSymbol');
const depositBtn        = document.getElementById('depositBtn');
const depositFeedback   = document.getElementById('depositFeedback');

depositPlatformEl.addEventListener('change', () => {
  const meta = PLATFORM_META[depositPlatformEl.value];
  depositSymbolEl.textContent = meta?.symbol || '';
});

depositBtn.addEventListener('click', async () => {
  const platform = depositPlatformEl.value;
  const amount   = parseFloat(depositAmountEl.value);

  if (!depositAmountEl.value || isNaN(amount) || amount <= 0) {
    showFeedback(depositFeedback, 'error', 'Enter a valid amount greater than zero.');
    return;
  }

  setLoading(depositBtn, true);
  depositFeedback.hidden = true;

  try {
    const data = await apiPost('/api/vault/deposit', { platform, amount });
    if (!data.success) {
      showFeedback(depositFeedback, 'error', data.error || 'Deposit failed.');
      toast('error', 'Deposit Failed', data.error);
    } else {
      const meta = PLATFORM_META[platform];
      animateBalanceUpdate(platform, data.new_balance, 'deposit');
      refreshBalancesFromVault(data.vault);
      showFeedback(depositFeedback, 'success',
        `✓ Deposited ${fmt(data.deposited, 4)} ${meta?.symbol}. New balance: ${fmt(data.new_balance, 2)} ${meta?.symbol}`);
      toast('success', 'Deposit Successful',
        `+${fmt(data.deposited, 4)} ${meta?.symbol} added to vault`);
      depositAmountEl.value = '';
      loadHistory();
    }
  } catch {
    showFeedback(depositFeedback, 'error', 'Network error — backend may be offline.');
    toast('error', 'Network Error', 'Could not reach the backend.');
  } finally {
    setLoading(depositBtn, false);
  }
});

/* ═══════════════════════════════════════════════════════════════
   VAULT — WITHDRAW
═══════════════════════════════════════════════════════════════ */
const withdrawPlatformEl = document.getElementById('withdrawPlatform');
const withdrawAmountEl   = document.getElementById('withdrawAmount');
const withdrawSymbolEl   = document.getElementById('withdrawSymbol');
const withdrawBtn        = document.getElementById('withdrawBtn');
const withdrawMaxBtn     = document.getElementById('withdrawMaxBtn');
const withdrawFeedback   = document.getElementById('withdrawFeedback');

withdrawPlatformEl.addEventListener('change', () => {
  const meta = PLATFORM_META[withdrawPlatformEl.value];
  withdrawSymbolEl.textContent = meta?.symbol || '';
  syncWithdrawMax();
});

function syncWithdrawMax() {
  const platform = withdrawPlatformEl.value;
  const bal = vaultBalances[platform];
  withdrawMaxBtn.title = bal !== undefined ? `Max: ${fmt(bal, 4)}` : '';
}

withdrawMaxBtn.addEventListener('click', () => {
  const platform = withdrawPlatformEl.value;
  const bal = vaultBalances[platform];
  if (bal !== undefined) withdrawAmountEl.value = Number(bal).toFixed(4);
});

withdrawBtn.addEventListener('click', async () => {
  const platform = withdrawPlatformEl.value;
  const amount   = parseFloat(withdrawAmountEl.value);

  if (!withdrawAmountEl.value || isNaN(amount) || amount <= 0) {
    showFeedback(withdrawFeedback, 'error', 'Enter a valid amount greater than zero.');
    return;
  }

  setLoading(withdrawBtn, true);
  withdrawFeedback.hidden = true;

  try {
    const data = await apiPost('/api/vault/withdraw', { platform, amount });
    if (!data.success) {
      showFeedback(withdrawFeedback, 'error',
        data.error || `Insufficient balance. Available: ${fmt(data.available, 4)}`);
      toast('error', 'Withdraw Failed', data.error);
    } else {
      const meta = PLATFORM_META[platform];
      animateBalanceUpdate(platform, data.new_balance, 'withdraw');
      refreshBalancesFromVault(data.vault);
      showFeedback(withdrawFeedback, 'success',
        `✓ Withdrew ${fmt(data.withdrawn, 4)} ${meta?.symbol}. Remaining: ${fmt(data.new_balance, 2)} ${meta?.symbol}`);
      toast('success', 'Withdrawal Successful',
        `-${fmt(data.withdrawn, 4)} ${meta?.symbol} removed from vault`);
      withdrawAmountEl.value = '';
      loadHistory();
    }
  } catch {
    showFeedback(withdrawFeedback, 'error', 'Network error — backend may be offline.');
    toast('error', 'Network Error', 'Could not reach the backend.');
  } finally {
    setLoading(withdrawBtn, false);
  }
});

/* ═══════════════════════════════════════════════════════════════
   VAULT — EXCHANGE
═══════════════════════════════════════════════════════════════ */
const exchangeFromEl      = document.getElementById('exchangeFrom');
const exchangeToEl        = document.getElementById('exchangeTo');
const exchangeAmountEl    = document.getElementById('exchangeAmount');
const exchangeFromSymbol  = document.getElementById('exchangeFromSymbol');
const exchangeSwapBtn     = document.getElementById('exchangeSwapBtn');
const exchangePreviewEl   = document.getElementById('exchangePreview');
const exchangePreviewBtn  = document.getElementById('exchangePreviewBtn');
const exchangeConfirmBtn  = document.getElementById('exchangeConfirmBtn');
const exchangeMaxBtn      = document.getElementById('exchangeMaxBtn');
const exchangeFeedback    = document.getElementById('exchangeFeedback');

function syncExchangeSymbol() {
  const meta = PLATFORM_META[exchangeFromEl.value];
  exchangeFromSymbol.textContent = meta?.symbol || '';
}

function syncExchangeMax() {
  const platform = exchangeFromEl.value;
  const bal = vaultBalances[platform];
  exchangeMaxBtn.title = bal !== undefined ? `Max: ${fmt(bal, 4)}` : '';
}

exchangeFromEl.addEventListener('change', () => {
  if (exchangeFromEl.value === exchangeToEl.value) {
    exchangeToEl.value = Object.keys(PLATFORM_META).find(k => k !== exchangeFromEl.value);
  }
  syncExchangeSymbol();
  syncExchangeMax();
  resetExchangePreview();
});

exchangeToEl.addEventListener('change', () => {
  if (exchangeToEl.value === exchangeFromEl.value) {
    exchangeFromEl.value = Object.keys(PLATFORM_META).find(k => k !== exchangeToEl.value);
  }
  syncExchangeSymbol();
  resetExchangePreview();
});

exchangeSwapBtn.addEventListener('click', () => {
  const prevFrom = exchangeFromEl.value;
  exchangeFromEl.value = exchangeToEl.value;
  exchangeToEl.value   = prevFrom;
  syncExchangeSymbol();
  syncExchangeMax();
  resetExchangePreview();
});

exchangeMaxBtn.addEventListener('click', () => {
  const platform = exchangeFromEl.value;
  const bal = vaultBalances[platform];
  if (bal !== undefined) exchangeAmountEl.value = Number(bal).toFixed(4);
  resetExchangePreview();
});

exchangeAmountEl.addEventListener('input', resetExchangePreview);

function resetExchangePreview() {
  previewPending = false;
  exchangePreviewEl.hidden = true;
  exchangeConfirmBtn.disabled = true;
}

/** Preview: calculate expected output without touching vault. */
exchangePreviewBtn.addEventListener('click', async () => {
  const from   = exchangeFromEl.value;
  const to     = exchangeToEl.value;
  const amount = parseFloat(exchangeAmountEl.value);

  exchangeFeedback.hidden = true;

  if (!exchangeAmountEl.value || isNaN(amount) || amount <= 0) {
    showFeedback(exchangeFeedback, 'error', 'Enter a valid amount to preview.');
    return;
  }
  if (from === to) {
    showFeedback(exchangeFeedback, 'error', 'Source and destination must be different platforms.');
    return;
  }

  try {
    // Use /api/convert for preview (no vault interaction)
    const data = await apiPost('/api/convert', {
      amount,
      from_currency: from,
      to_currency:   to,
    });

    if (!data.success) {
      showFeedback(exchangeFeedback, 'error', data.error || 'Preview failed.');
      return;
    }

    const fromMeta = PLATFORM_META[from];
    const toMeta   = PLATFORM_META[to];

    document.getElementById('previewSend').textContent    = `${fmt(data.amount, 4)} ${fromMeta?.symbol}`;
    document.getElementById('previewRate').textContent    = data.rate_display;
    document.getElementById('previewReceive').textContent = `${fmt(data.converted_amount, 4)} ${toMeta?.symbol}`;

    exchangePreviewEl.hidden    = false;
    exchangeConfirmBtn.disabled = false;
    previewPending = true;

  } catch {
    // Offline fallback
    const rate = exchangeRates[from]?.[to];
    if (rate) {
      const converted = amount * rate;
      const fromMeta  = PLATFORM_META[from];
      const toMeta    = PLATFORM_META[to];
      document.getElementById('previewSend').textContent    = `${fmt(amount, 4)} ${fromMeta?.symbol}`;
      document.getElementById('previewRate').textContent    = `1 ${fromMeta?.symbol} = ${Number(rate).toFixed(4)} ${toMeta?.symbol}`;
      document.getElementById('previewReceive').textContent = `${fmt(converted, 4)} ${toMeta?.symbol}`;
      exchangePreviewEl.hidden    = false;
      exchangeConfirmBtn.disabled = false;
      previewPending = true;
    } else {
      showFeedback(exchangeFeedback, 'error', 'Backend offline — cannot preview exchange.');
    }
  }
});

/** Confirm: execute the exchange against the vault. */
exchangeConfirmBtn.addEventListener('click', async () => {
  if (!previewPending) return;

  const from   = exchangeFromEl.value;
  const to     = exchangeToEl.value;
  const amount = parseFloat(exchangeAmountEl.value);

  setLoading(exchangeConfirmBtn, true);
  exchangeFeedback.hidden = true;

  try {
    const data = await apiPost('/api/vault/exchange', {
      from_platform: from,
      to_platform:   to,
      amount,
    });

    if (!data.success) {
      showFeedback(exchangeFeedback, 'error', data.error || 'Exchange failed.');
      toast('error', 'Exchange Failed', data.error);
    } else {
      const fromMeta = PLATFORM_META[from];
      const toMeta   = PLATFORM_META[to];

      // Animate both balance cards
      animateBalanceUpdate(from, data.balance_after[from], 'withdraw');
      animateBalanceUpdate(to,   data.balance_after[to],   'deposit');
      refreshBalancesFromVault(data.vault);

      showFeedback(exchangeFeedback, 'success',
        `✓ Exchanged ${fmt(data.amount_sent, 4)} ${fromMeta?.symbol} → ${fmt(data.amount_received, 4)} ${toMeta?.symbol} at ${data.rate_display}`);
      toast('success', 'Exchange Complete',
        `${fmt(data.amount_sent, 4)} ${fromMeta?.symbol} → ${fmt(data.amount_received, 4)} ${toMeta?.symbol}`);

      // Reset form
      exchangeAmountEl.value = '';
      resetExchangePreview();
      loadHistory();
    }
  } catch {
    showFeedback(exchangeFeedback, 'error', 'Network error — backend may be offline.');
    toast('error', 'Network Error', 'Could not reach the backend.');
  } finally {
    setLoading(exchangeConfirmBtn, false);
  }
});

/* ═══════════════════════════════════════════════════════════════
   VAULT — RESET
═══════════════════════════════════════════════════════════════ */
document.getElementById('vaultResetBtn').addEventListener('click', async () => {
  if (!confirm('Reset vault to default demo balances? All transaction history will be cleared.')) return;

  try {
    const data = await apiPost('/api/vault/reset', {});
    if (data.success) {
      refreshBalancesFromVault(data.vault);
      renderBalanceCards(data.vault);
      loadHistory();
      toast('info', 'Vault Reset', 'Balances restored to demo defaults.');
    }
  } catch {
    toast('error', 'Reset Failed', 'Could not reach the backend.');
  }
});

/* ═══════════════════════════════════════════════════════════════
   TRANSACTION HISTORY
═══════════════════════════════════════════════════════════════ */
const historyList  = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');

async function loadHistory() {
  try {
    const data = await apiGet('/api/vault/history?limit=50');
    if (!data.success) return;
    renderHistory(data.history);
  } catch { /* silent */ }
}

function renderHistory(items) {
  historyCount.textContent = `${items.length} transaction${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    historyList.innerHTML = `
      <div class="history-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <p>No transactions yet. Deposit, withdraw, or exchange tokens to get started.</p>
      </div>`;
    return;
  }

  historyList.innerHTML = items.map(tx => {
    const icon  = TYPE_ICONS[tx.type] || '·';
    const meta  = PLATFORM_META[tx.platform] || {};
    let amountStr = '';
    let badgeClass = tx.type;

    if (tx.type === 'deposit') {
      amountStr = `+${fmt(tx.amount, 4)} ${tx.symbol}`;
    } else if (tx.type === 'withdraw') {
      amountStr = `-${fmt(tx.amount, 4)} ${tx.symbol}`;
    } else if (tx.type === 'exchange') {
      amountStr = `${fmt(tx.amount, 4)} ${tx.symbol} → ${fmt(tx.converted, 4)} ${tx.to_symbol || ''}`;
    }

    return `
      <div class="history-item">
        <div class="history-type-icon ${tx.type}">${icon}</div>
        <div class="history-info">
          <div class="history-note">${tx.note || tx.type}</div>
          <div class="history-time">${relativeTime(tx.timestamp)}</div>
        </div>
        <div class="history-amount ${tx.type}">${amountStr}</div>
        <span class="history-badge ${badgeClass}">${tx.type}</span>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
async function init() {
  await checkHealth();
  await loadTicker();
  updateCalcBadges();
  syncExchangeSymbol();

  // Periodically refresh health
  setInterval(checkHealth, 30_000);
}

init();