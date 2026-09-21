const API = '/api';
let state = {
  auctions: [],
  currentAuctionId: null,
  currentPlayerId: null,
  teams: [],
  categories: [],
};

// ---------------- helpers ----------------
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function money(n) { 
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 }); 
}

function el(id) { return document.getElementById(id); }

function showMsg(container, text, type) {
  container.innerHTML = `<div class="msg ${type}">${text}</div>`;
  setTimeout(() => { container.innerHTML = ''; }, 4000);
}

const PALETTE = ['#00d4ff', '#ff3d81', '#ffb92e', '#9dff5c', '#4fb0c6', '#9b7ede', '#e8974a', '#5fbf87'];
function colorFor(name) {
  if (!name) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// ---------------- tab navigation ----------------
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    el('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'players') loadPlayers();
    if (btn.dataset.view === 'teams') loadTeams();
    if (btn.dataset.view === 'squads') loadContracts();
    if (btn.dataset.view === 'live') loadLiveView();
  });
});

// ==================================================================
// LIVE AUCTION VIEW
// ==================================================================
async function loadAuctions() {
  state.auctions = await api('/auctions');
  const sel = el('auctionSelect');
  sel.innerHTML = state.auctions.length
    ? state.auctions.map(a => `<option value="${a.auction_id}">${a.season} (#${a.auction_id}) — ${a.status}</option>`).join('')
    : '<option value="">No auctions yet — create one</option>';
  if (state.auctions.length && !state.currentAuctionId) {
    state.currentAuctionId = state.auctions[0].auction_id;
  }
  if (state.currentAuctionId) sel.value = state.currentAuctionId;
}

el('auctionSelect').addEventListener('change', e => {
  state.currentAuctionId = e.target.value;
  state.currentPlayerId = null;
  loadPool();
  renderScoreboard();
});

el('newAuctionBtn').addEventListener('click', async () => {
  const season = prompt('Season name (e.g. "IPL 2027 Auction"):', `Season ${new Date().getFullYear()}`);
  if (season === null) return;
  const auction = await api('/auctions', { method: 'POST', body: JSON.stringify({ season }) });
  state.currentAuctionId = auction.auction_id;
  await loadAuctions();
  loadPool();
});

async function loadPool() {
  const players = await api('/players');
  const pool = players.filter(p => p.status !== 'sold');
  const tbody = document.querySelector('#poolTable tbody');
  tbody.innerHTML = pool.length ? pool.map(p => `
    <tr>
      <td style="font-weight:600; color:var(--white);">${p.name}</td>
      <td>${p.role}</td>
      <td>${p.category_name ? `<span class="cat-chip" style="background:${colorFor(p.category_name)}22;border:1px solid ${colorFor(p.category_name)};color:${colorFor(p.category_name)}">${p.category_name}</span>` : '—'}</td>
      <td>${money(p.base_price)}</td>
      <td><span class="badge ${p.status}">${p.status.replace('_',' ')}</span></td>
      <td><button class="btn small" onclick="selectPlayerForAuction(${p.player_id})">Bid</button></td>
    </tr>
  `).join('') : `<tr><td colspan="6" class="empty-state">All players sold 🎉</td></tr>`;
}

async function selectPlayerForAuction(playerId) {
  if (!state.currentAuctionId) { alert('Create or select an auction first.'); return; }
  state.currentPlayerId = playerId;
  await renderScoreboard();
}

async function renderScoreboard() {
  const board = el('scoreboard');
  if (!state.currentPlayerId || !state.currentAuctionId) {
    board.innerHTML = `<p class="empty-state">Select an auction, then pick a player below to start bidding.</p>`;
    return;
  }
  const player = await api(`/players/${state.currentPlayerId}`);
  const bids = await api(`/auctions/${state.currentAuctionId}/players/${state.currentPlayerId}/bids`);
  const highest = bids.length ? bids[0] : null;
  const currentVal = highest ? highest.bid_amount : player.base_price;
  const teams = await api('/teams');

  board.innerHTML = `
    <p class="player-name">${player.name}</p>
    <p class="player-meta"><span class="country-name">${player.country}</span> • ${player.role} • ${player.category_name || 'Uncategorized'} • ${player.experience} yrs exp</p>
    <div class="price-ticker">${money(currentVal)}</div>
    <div class="price-label">${highest ? 'Current highest bid — ' + highest.team_name : 'Base price (no bids yet)'}</div>

    <!-- Quick Bid Increments -->
    <div class="quick-bid-group">
      <button class="btn-pill" onclick="quickIncrement(1000000)">+ ₹10L</button>
      <button class="btn-pill" onclick="quickIncrement(2500000)">+ ₹25L</button>
      <button class="btn-pill" onclick="quickIncrement(5000000)">+ ₹50L</button>
      <button class="btn-pill" onclick="quickIncrement(10000000)">+ ₹1Cr</button>
    </div>

    <div class="bid-controls">
      <select id="bidTeamSelect">
        ${teams.map(t => `<option value="${t.team_id}">${t.team_name} (${money(t.purse_remaining)} left)</option>`).join('')}
      </select>
      <input id="bidAmountInput" type="number" placeholder="Bid amount" step="100000">
      <button class="btn" id="placeBidBtn">Place Bid</button>
    </div>

    <div class="action-row">
      <button class="btn" id="markSoldBtn" ${highest ? '' : 'disabled'}>Mark SOLD</button>
      <button class="btn danger" id="markUnsoldBtn">Mark UNSOLD</button>
    </div>

    <div id="liveMsg"></div>

    ${bids.length ? `
      <table style="margin-top:20px;">
        <thead><tr><th>Team</th><th>Amount</th><th>Time</th></tr></thead>
        <tbody>
          ${bids.map(b => `<tr><td>${b.team_name}</td><td>${money(b.bid_amount)}</td><td>${new Date(b.bid_time).toLocaleTimeString()}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}
  `;

  el('placeBidBtn').addEventListener('click', placeBid);
  el('markSoldBtn').addEventListener('click', markSold);
  el('markUnsoldBtn').addEventListener('click', markUnsold);

  const ticker = board.querySelector('.price-ticker');
  if (ticker) { ticker.classList.add('flash'); setTimeout(() => ticker.classList.remove('flash'), 500); }
}

function quickIncrement(amt) {
  const ticker = document.querySelector('.price-ticker');
  const input = el('bidAmountInput');
  const rawCurrent = ticker ? ticker.innerText.replace(/[₹,]/g, '') : 0;
  const nextVal = (Number(rawCurrent) || 0) + amt;
  input.value = nextVal;
  input.focus();
}

async function placeBid() {
  const team_id = el('bidTeamSelect').value;
  const bid_amount = el('bidAmountInput').value;
  const msgBox = el('liveMsg');
  if (!bid_amount) { showMsg(msgBox, 'Enter a bid amount.', 'error'); return; }
  try {
    await api(`/auctions/${state.currentAuctionId}/bids`, {
      method: 'POST',
      body: JSON.stringify({ player_id: state.currentPlayerId, team_id, bid_amount }),
    });
    showMsg(msgBox, 'Bid placed successfully.', 'success');
    await renderScoreboard();
    await loadPool();
  } catch (err) {
    showMsg(msgBox, err.message, 'error');
  }
}

async function markSold() {
  const msgBox = el('liveMsg');
  try {
    await api(`/auctions/${state.currentAuctionId}/players/${state.currentPlayerId}/sold`, { method: 'POST' });
    showMsg(msgBox, 'Player marked SOLD. Contract created and purse deducted.', 'success');
    state.currentPlayerId = null;
    await renderScoreboard();
    await loadPool();
    await loadPurseStrip();
  } catch (err) {
    showMsg(msgBox, err.message, 'error');
  }
}

async function markUnsold() {
  const msgBox = el('liveMsg');
  try {
    await api(`/auctions/${state.currentAuctionId}/players/${state.currentPlayerId}/unsold`, { method: 'POST' });
    showMsg(msgBox, 'Player marked UNSOLD.', 'success');
    state.currentPlayerId = null;
    await renderScoreboard();
    await loadPool();
  } catch (err) {
    showMsg(msgBox, err.message, 'error');
  }
}

async function loadPurseStrip() {
  const teams = await api('/teams');
  el('purseStrip').innerHTML = teams.map(t => {
    const pct = Math.round((t.purse_remaining / t.purse_total) * 100);
    const c = colorFor(t.team_name);
    return `
      <div class="purse-card" style="--team-color:${c}">
        <div class="tname">${t.team_name}</div>
        <div class="pval">${money(t.purse_remaining)} <span style="font-size:0.8rem;color:var(--ash)">/ ${money(t.purse_total)}</span></div>
        <div class="pbar"><div class="pbar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

async function loadLiveView() {
  await loadAuctions();
  await loadPool();
  await loadPurseStrip();
  await renderScoreboard();
}

// ==================================================================
// PLAYERS CRUD VIEW (Inline Edit, Save, Delete)
// ==================================================================
async function loadCategories() {
  state.categories = await api('/categories');
  const sel = el('categorySelectPlayer');
  sel.innerHTML = '<option value="">Category</option>' +
    state.categories.map(c => `<option value="${c.category_id}">${c.category_name}</option>`).join('');
}

async function loadPlayers() {
  const players = await api('/players');
  const tbody = document.querySelector('#playersTable tbody');
  tbody.innerHTML = players.length ? players.map(p => `
    <tr id="player-row-${p.player_id}">
      <td>${p.player_id}</td>
      <td>
        <span class="view-val">${p.name}</span>
        <input value="${p.name}" data-field="name" data-id="${p.player_id}" class="edit-field" style="display:none;">
      </td>
      <td>
        <span class="view-val">${p.country}</span>
        <input value="${p.country}" data-field="country" data-id="${p.player_id}" class="edit-field" style="display:none;">
      </td>
      <td>${p.role}</td>
      <td>${p.category_name ? `<span class="cat-chip" style="background:${colorFor(p.category_name)}22;border:1px solid ${colorFor(p.category_name)};color:${colorFor(p.category_name)}">${p.category_name}</span>` : '—'}</td>
      <td>
        <span class="view-val">${money(p.base_price)}</span>
        <input value="${p.base_price}" type="number" data-field="base_price" data-id="${p.player_id}" class="edit-field" style="display:none;">
      </td>
      <td><span class="badge ${p.status}">${p.status.replace('_',' ')}</span></td>
      <td>${p.team_name || '—'}</td>
      <td>
        <button class="btn small secondary edit-btn" onclick="toggleEdit('player', ${p.player_id})">Edit</button>
        <button class="btn small secondary save-btn" onclick="savePlayer(${p.player_id})" style="display:none;">Save</button>
        <button class="btn small danger" onclick="deletePlayer(${p.player_id})">Delete</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="9" class="empty-state">No players yet. Add one above.</td></tr>`;
}

el('playerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const msgBox = el('playerFormMsg');
  try {
    await api('/players', { method: 'POST', body: JSON.stringify(body) });
    showMsg(msgBox, 'Player added successfully.', 'success');
    e.target.reset();
    loadPlayers();
  } catch (err) {
    showMsg(msgBox, err.message, 'error');
  }
});

async function savePlayer(id) {
  const fields = document.querySelectorAll(`.edit-field[data-id="${id}"]`);
  const body = {};
  fields.forEach(f => body[f.dataset.field] = f.value);
  try {
    await api(`/players/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    await loadPlayers();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

async function deletePlayer(id) {
  if (!confirm('Delete this player? This cannot be undone.')) return;
  try {
    await api(`/players/${id}`, { method: 'DELETE' });
    await loadPlayers();
  } catch (err) {
    alert(err.message);
  }
}

// ==================================================================
// TEAMS CRUD VIEW (Inline Edit, Save, Delete)
// ==================================================================
async function loadTeams() {
  state.teams = await api('/teams');
  const tbody = document.querySelector('#teamsTable tbody');
  tbody.innerHTML = state.teams.length ? state.teams.map(t => `
    <tr id="team-row-${t.team_id}">
      <td>${t.team_id}</td>
      <td>
        <span class="view-val">${t.team_name}</span>
        <input value="${t.team_name}" data-field="team_name" data-id="${t.team_id}" class="edit-field-t" style="display:none;">
      </td>
      <td>
        <span class="view-val">${t.owner || '—'}</span>
        <input value="${t.owner || ''}" data-field="owner" data-id="${t.team_id}" class="edit-field-t" style="display:none;">
      </td>
      <td>
        <span class="view-val">${money(t.purse_total)}</span>
        <input value="${t.purse_total}" type="number" data-field="purse_total" data-id="${t.team_id}" class="edit-field-t" style="display:none;">
      </td>
      <td style="color:var(--lime);">${money(t.purse_remaining)}</td>
      <td>
        <button class="btn small secondary edit-btn" onclick="toggleEdit('team', ${t.team_id})">Edit</button>
        <button class="btn small secondary save-btn" onclick="saveTeam(${t.team_id})" style="display:none;">Save</button>
        <button class="btn small danger" onclick="deleteTeam(${t.team_id})">Delete</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="6" class="empty-state">No teams yet. Add one above.</td></tr>`;
}

el('teamForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const msgBox = el('teamFormMsg');
  try {
    await api('/teams', { method: 'POST', body: JSON.stringify(body) });
    showMsg(msgBox, 'Team added successfully.', 'success');
    e.target.reset();
    loadTeams();
  } catch (err) {
    showMsg(msgBox, err.message, 'error');
  }
});

async function saveTeam(id) {
  const fields = document.querySelectorAll(`.edit-field-t[data-id="${id}"]`);
  const body = {};
  fields.forEach(f => body[f.dataset.field] = f.value);
  try {
    await api(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    await loadTeams();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

async function deleteTeam(id) {
  if (!confirm('Delete this team? This cannot be undone.')) return;
  try {
    await api(`/teams/${id}`, { method: 'DELETE' });
    await loadTeams();
  } catch (err) {
    alert(err.message);
  }
}

// ==================================================================
// SQUADS / CONTRACTS VIEW (Inline Edit, Save, Delete)
// ==================================================================
async function loadContracts() {
  const [contracts, teams] = await Promise.all([api('/auctions/contracts/all'), api('/teams')]);
  state.teams = teams;
  const tbody = document.querySelector('#contractsTable tbody');
  tbody.innerHTML = contracts.length ? contracts.map(c => `
    <tr id="contract-row-${c.contract_id}">
      <td style="font-weight:600; color:var(--white);">${c.player_name}</td>
      <td>${c.role}</td>
      <td>
        <span class="view-val">${c.team_name}</span>
        <select data-field="team_id" data-id="${c.contract_id}" class="edit-field-c" style="display:none;">
          ${teams.map(t => `<option value="${t.team_id}" ${t.team_id === c.team_id ? 'selected' : ''}>${t.team_name}</option>`).join('')}
        </select>
      </td>
      <td><span class="badge season">${c.auction_season}</span></td>
      <td>
        <span class="view-val">${money(c.final_price)}</span>
        <input value="${c.final_price}" type="number" min="0.01" step="0.01" data-field="final_price" data-id="${c.contract_id}" class="edit-field-c" style="display:none;">
      </td>
      <td>${new Date(c.contract_date).toLocaleString()}</td>
      <td>
        <button class="btn small secondary edit-btn" onclick="toggleEdit('contract', ${c.contract_id})">Edit</button>
        <button class="btn small secondary save-btn" onclick="saveContract(${c.contract_id})" style="display:none;">Save</button>
        <button class="btn small danger" onclick="deleteContract(${c.contract_id})">Delete</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="7" class="empty-state">No contracts finalized yet.</td></tr>`;
}

async function saveContract(id) {
  const fields = document.querySelectorAll(`.edit-field-c[data-id="${id}"]`);
  const body = {};
  fields.forEach(f => body[f.dataset.field] = f.value);
  try {
    await api(`/auctions/contracts/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    await loadContracts();
    await loadPurseStrip();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteContract(id) {
  if (!confirm('Delete this contract? The purse will be refunded and the player returned to the unsold pool.')) return;
  try {
    await api(`/auctions/contracts/${id}`, { method: 'DELETE' });
    await loadContracts();
    await loadPurseStrip();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------- UI Toggle Helper ----------------
function toggleEdit(type, id) {
  const row = el(`${type}-row-${id}`);
  const viewVals = row.querySelectorAll('.view-val');
  const editInputs = row.querySelectorAll('.edit-field, .edit-field-t, .edit-field-c');
  const editBtn = row.querySelector('.edit-btn');
  const saveBtn = row.querySelector('.save-btn');

  const isEditing = editBtn.textContent === 'Cancel';

  if (isEditing) {
    viewVals.forEach(elem => elem.style.display = '');
    editInputs.forEach(elem => elem.style.display = 'none');
    editBtn.textContent = 'Edit';
    saveBtn.style.display = 'none';
  } else {
    viewVals.forEach(elem => elem.style.display = 'none');
    editInputs.forEach(elem => elem.style.display = 'block');
    editBtn.textContent = 'Cancel';
    saveBtn.style.display = 'inline-block';
  }
}

// ==================================================================
// INIT
// ==================================================================
(async function init() {
  await loadCategories();
  await loadLiveView();
})();