const STORAGE_KEY = 'game-ledger-data';
const EXPORT_SCHEMA_VERSION = 2;

const GAME_TYPES = {
  poker: { label: '德州扑克', short: '德', badge: 'poker' },
  mahjong: { label: '麻将', short: '麻', badge: 'mahjong' },
  sports: { label: '体育', short: '体', badge: 'sports' },
};

const GAME_TYPE_ORDER = ['poker', 'mahjong', 'sports'];

// 固定參賽者；avatar 預設值可被雲端頭像覆蓋
const FIXED_PLAYERS = [
  { id: 'oli', name: '奥利', avatar: null },
  { id: 'dabai', name: '大白', avatar: 'avatars/dabai.png' },
  { id: 'finn', name: '芬恩', avatar: 'avatars/finn.png' },
  { id: 'kevin', name: '凯文', avatar: null },
  { id: 'anderson', name: '安德森', avatar: null },
  { id: 'tang', name: '唐', avatar: 'avatars/tang.jpg' },
  { id: 'allen', name: '艾伦', avatar: 'avatars/allen.png' },
];

let state = loadState();
let cloudAvatars = {};
let editingEntryId = null;
let refreshTimer = null;
let currentDetailPlayerId = null;

// ── Storage ──────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    }
  } catch (_) {}
  return { entries: [] };
}

function saveStateLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveState() {
  saveStateLocal();
  render();
}

function isCloudSync() {
  return Sync.isActive();
}

function getPlayers() {
  return FIXED_PLAYERS.map((p) => ({
    ...p,
    avatar: cloudAvatars[p.id] || p.avatar,
  }));
}

function getPlayerById(id) {
  return getPlayers().find((p) => p.id === id);
}

async function compressImageToBlob(file, maxSize = 256) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await fetch(dataUrl);
  return res.blob();
}

// ── Utils ────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${y}/${parseInt(m)}/${parseInt(d)}`;
}

function formatNum(n) {
  if (n === 0) return '0';
  return n.toLocaleString('zh-TW');
}

function sumScores(scores) {
  return Object.values(scores).reduce((a, b) => a + (Number(b) || 0), 0);
}

function parseScoreExpression(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/[＋﹢]/g, '+')
    .replace(/[－﹣]/g, '-');
  if (s === '') return 0;

  let total = 0;
  let i = 0;
  while (i < s.length) {
    let sign = 1;
    if (s[i] === '+') {
      i += 1;
    } else if (s[i] === '-') {
      sign = -1;
      i += 1;
    }

    const start = i;
    if (s[i] === '.') return NaN;
    while (i < s.length && /\d/.test(s[i])) i += 1;
    if (i < s.length && s[i] === '.') {
      i += 1;
      while (i < s.length && /\d/.test(s[i])) i += 1;
    }
    if (start === i) return NaN;

    const num = Number(s.slice(start, i));
    if (Number.isNaN(num)) return NaN;
    total += sign * num;
  }

  return total;
}

function readScoreInputs(prefix = '') {
  const scores = {};
  let valid = true;
  FIXED_PLAYERS.forEach((p) => {
    const input = document.getElementById(`${prefix}score-${p.id}`);
    const parsed = parseScoreExpression(input?.value);
    if (Number.isNaN(parsed)) valid = false;
    scores[p.id] = Number.isNaN(parsed) ? 0 : parsed;
  });
  return { scores, valid };
}

function normalizeScoreInput(input) {
  const parsed = parseScoreExpression(input.value);
  if (!Number.isNaN(parsed)) input.value = String(parsed);
}

function scoreClass(n) {
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'zero';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function resolveAssetUrl(path) {
  if (!path) return null;
  if (/^(https?:|data:)/i.test(path)) return path;
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

function avatarFallback(img) {
  const span = document.createElement('span');
  span.className = 'avatar-initial';
  span.textContent = img.dataset.fallback || '?';
  img.replaceWith(span);
}

function avatarHTML(player) {
  if (player.avatar) {
    const src = resolveAssetUrl(player.avatar);
    const initial = escapeHTML(player.name.charAt(0));
    return `<img src="${src}" alt="${escapeHTML(player.name)}" class="avatar-img" data-fallback="${initial}" onerror="avatarFallback(this)">`;
  }
  return `<span class="avatar-initial">${escapeHTML(player.name.charAt(0))}</span>`;
}

// ── Stats ────────────────────────────────────────────

function getFilteredEntries() {
  const filter = document.getElementById('filterType')?.value || 'all';
  if (filter === 'all') return state.entries;
  return state.entries.filter((e) => e.type === filter);
}

function computeTotals(entries, playerId = null) {
  const totals = {};
  FIXED_PLAYERS.forEach((p) => { totals[p.id] = 0; });
  entries.forEach((entry) => {
    FIXED_PLAYERS.forEach((p) => {
      if (playerId && p.id !== playerId) return;
      totals[p.id] += entry.scores[p.id] || 0;
    });
  });
  return totals;
}

function computePlayerBreakdown(playerId) {
  const byType = { poker: 0, mahjong: 0, sports: 0 };
  const history = [];

  state.entries.forEach((entry) => {
    const score = entry.scores[playerId] || 0;
    byType[entry.type] = (byType[entry.type] || 0) + score;
    history.push({
      id: entry.id,
      date: entry.date,
      type: entry.type,
      note: entry.note || '',
      score,
      createdAt: entry.createdAt || 0,
    });
  });

  history.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const total = GAME_TYPE_ORDER.reduce((sum, type) => sum + byType[type], 0);
  return { byType, total, history };
}

// ── Render ───────────────────────────────────────────

function render() {
  renderSummary();
  renderScoreInputs();
  renderLedger();
  updateBalance('balanceBar', 'balanceValue', 'balanceHint', 'submitBtn', readScoreInputs(''));
}

function renderSummary() {
  const grid = document.getElementById('summaryGrid');
  const totals = computeTotals(getFilteredEntries());

  grid.innerHTML = getPlayers().map((p) => {
    const t = totals[p.id] || 0;
    const cls = scoreClass(t);
    return `
      <button type="button" class="summary-item" data-player="${p.id}">
        <div class="avatar">${avatarHTML(p)}</div>
        <div class="name">${escapeHTML(p.name)}</div>
        <div class="total ${cls}">${formatNum(t)}</div>
      </button>`;
  }).join('');

  grid.querySelectorAll('.summary-item').forEach((btn) => {
    btn.addEventListener('click', () => openPlayerDetail(btn.dataset.player));
  });
}

function renderScoreInputs(containerId = 'scoreInputs', prefix = '') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = getPlayers().map((p) => `
    <div class="score-field">
      <div class="score-field-header">
        <div class="mini-avatar">${avatarHTML(p)}</div>
        <span class="player-name">${escapeHTML(p.name)}</span>
      </div>
      <input type="text" inputmode="decimal" class="score-input" data-player="${p.id}" id="${prefix}score-${p.id}"
        placeholder="0" value="0" autocomplete="off">
    </div>
  `).join('');

  container.querySelectorAll('.score-input').forEach((input) => {
    const refresh = () => {
      if (containerId === 'scoreInputs') {
        updateBalance('balanceBar', 'balanceValue', 'balanceHint', 'submitBtn', readScoreInputs(''));
      } else {
        updateBalance('editBalanceBar', 'editBalanceValue', 'editBalanceHint', 'editSave', readScoreInputs('edit'));
      }
    };
    input.addEventListener('input', refresh);
    input.addEventListener('blur', () => {
      normalizeScoreInput(input);
      refresh();
    });
  });
}

function renderLedger() {
  const head = document.getElementById('ledgerHead');
  const body = document.getElementById('ledgerBody');
  const hint = document.getElementById('emptyHint');
  const entries = [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  if (entries.length === 0) {
    head.innerHTML = '';
    body.innerHTML = '';
    hint.style.display = 'block';
    return;
  }

  hint.style.display = 'none';

  head.innerHTML = `<tr>
    <th>日期</th>
    ${getPlayers().map((p) => `<th>${escapeHTML(p.name)}</th>`).join('')}
    <th>+/- 結算</th>
    <th></th>
  </tr>`;

  body.innerHTML = entries.map((entry) => {
    const type = GAME_TYPES[entry.type];
    const rowSum = sumScores(entry.scores);
    const sumCls = rowSum === 0 ? 'zero' : 'negative';
    return `<tr>
      <td>
        ${formatDate(entry.date)}
        <span class="type-badge ${type.badge}">${type.short}</span>
        ${entry.note ? `<span class="note-inline">${escapeHTML(entry.note)}</span>` : ''}
      </td>
      ${getPlayers().map((p) => {
        const s = entry.scores[p.id] || 0;
        return `<td class="${scoreClass(s)}">${formatNum(s)}</td>`;
      }).join('')}
      <td class="${sumCls}">${formatNum(rowSum)}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-icon edit-btn" data-id="${entry.id}">編輯</button>
        <button class="btn btn-ghost btn-icon btn-danger delete-btn" data-id="${entry.id}">刪</button>
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openEdit(btn.dataset.id));
  });
  body.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
  });
}

function renderPlayerDetail(playerId) {
  const player = getPlayerById(playerId);
  if (!player) return;

  const { byType, total, history } = computePlayerBreakdown(playerId);
  const container = document.getElementById('playerDetail');

  const typeRows = GAME_TYPE_ORDER.map((type) => {
    const value = byType[type] || 0;
    return `
      <tr>
        <td><span class="type-badge ${GAME_TYPES[type].badge}">${GAME_TYPES[type].label}</span></td>
        <td class="${scoreClass(value)}">${formatNum(value)}</td>
      </tr>`;
  }).join('');

  const historyRows = history.length === 0
    ? '<tr><td colspan="3" class="empty-cell">尚無記錄</td></tr>'
    : history.map((item) => `
        <tr>
          <td>${formatDate(item.date)}</td>
          <td><span class="type-badge ${GAME_TYPES[item.type].badge}">${GAME_TYPES[item.type].short}</span></td>
          <td class="${scoreClass(item.score)}">${formatNum(item.score)}</td>
        </tr>
      `).join('');

  container.innerHTML = `
    <div class="player-detail-header">
      <div class="player-detail-avatar">${avatarHTML(player)}</div>
      <div>
        <h3>${escapeHTML(player.name)}</h3>
        <p class="hint-text">各項目總和與歷史記錄</p>
        ${Sync.supportsAvatars() ? `
          <label class="btn btn-ghost btn-sm avatar-upload-btn">
            上傳頭像（全員可見）
            <input type="file" class="avatar-upload-input" accept="image/*" hidden>
          </label>
        ` : ''}
      </div>
      <div class="player-detail-total ${scoreClass(total)}">${formatNum(total)}</div>
    </div>

    <h4 class="detail-section-title">各項目總和</h4>
    <table class="detail-table">
      <thead>
        <tr><th>項目</th><th>總和</th></tr>
      </thead>
      <tbody>
        ${typeRows}
        <tr class="detail-total-row">
          <td>總計</td>
          <td class="${scoreClass(total)}">${formatNum(total)}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="detail-section-title">歷史記錄</h4>
    <div class="table-wrap">
      <table class="detail-table">
        <thead>
          <tr><th>日期</th><th>項目</th><th>金額</th></tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;
}

function openPlayerDetail(playerId) {
  currentDetailPlayerId = playerId;
  renderPlayerDetail(playerId);
  const dialog = document.getElementById('playerDialog');
  dialog.showModal();

  const input = dialog.querySelector('.avatar-upload-input');
  if (input) {
    input.onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await handleAvatarUpload(playerId, file);
    };
  }
}

async function handleAvatarUpload(playerId, file) {
  if (!Sync.supportsAvatars()) {
    alert('請先連線 Supabase 才能上傳頭像');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('圖片太大，請選擇 5MB 以下的檔案');
    return;
  }
  try {
    updateSyncBar('loading', '上傳頭像中...');
    const blob = await compressImageToBlob(file);
    const url = await Sync.uploadAvatar(playerId, blob);
    cloudAvatars[playerId] = url;
    renderPlayerDetail(playerId);
    render();
    updateSyncBar('ok');
    alert('頭像已更新，所有人都看得到！');
  } catch (error) {
    updateSyncBar('error', `上傳失敗：${error.message}`);
    alert(`上傳失敗：${error.message}`);
  }
}

function updateBalance(barId, valueId, hintId, btnId, result) {
  const { scores, valid } = result.scores ? result : { scores: result, valid: true };
  const sum = sumScores(scores);
  const bar = document.getElementById(barId);
  const valueEl = document.getElementById(valueId);
  const hintEl = document.getElementById(hintId);
  const btn = document.getElementById(btnId);

  valueEl.textContent = formatNum(sum);
  const balanced = valid && sum === 0;

  bar.classList.toggle('balanced', balanced);
  bar.classList.toggle('unbalanced', !balanced);

  if (!valid) {
    hintEl.textContent = '✗ 算式格式不正確';
  } else if (balanced) {
    hintEl.textContent = '✓ 平衡，可以儲存';
  } else {
    hintEl.textContent = `✗ 差 ${formatNum(sum)}，必須等於 0`;
  }

  if (btn) btn.disabled = !balanced;
}

// ── Export / Import ──────────────────────────────────

function buildExportPayload() {
  return {
    schema: 'game-ledger',
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: nowISO(),
    data: state,
  };
}

function parseImportPayload(text) {
  const raw = JSON.parse(text);
  if (raw && raw.schema === 'game-ledger' && raw.data) {
    return raw.data;
  }
  return raw;
}

function validateDataShape(data) {
  if (!data || typeof data !== 'object') return '內容不是物件';
  if (!Array.isArray(data.entries)) return '缺少 entries';
  for (const e of data.entries) {
    if (!e || typeof e !== 'object') return 'entries 格式錯誤';
    if (typeof e.id !== 'string' || typeof e.date !== 'string' || typeof e.type !== 'string') return 'entries 欄位不完整';
    if (!e.scores || typeof e.scores !== 'object') return 'entries.scores 格式錯誤';
    if (!(e.type in GAME_TYPES)) return `未知種類：${e.type}`;
  }
  return null;
}

function applyImportedData(data) {
  state = { entries: data.entries };
}

function mergeImportedData(imported) {
  const merged = new Map(state.entries.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;

  imported.entries.forEach((remote) => {
    const local = merged.get(remote.id);
    if (!local) {
      merged.set(remote.id, remote);
      added++;
      return;
    }
    const localTime = local.createdAt || 0;
    const remoteTime = remote.createdAt || 0;
    if (remoteTime > localTime) {
      merged.set(remote.id, remote);
      updated++;
    }
  });

  state.entries = Array.from(merged.values());
  return { added, updated, total: state.entries.length };
}

function processImport(data, mode) {
  const err = validateDataShape(data);
  if (err) {
    alert(`備份格式不正確：${err}`);
    return Promise.resolve(false);
  }

  const run = async () => {
    if (mode === 'overwrite') {
      if (!confirm('覆蓋匯入會以備份為準，你本地多出的記錄會消失，確定繼續？')) return false;
      applyImportedData(data);
      if (isCloudSync()) await Sync.bulkReplace(state.entries);
      saveState();
      alert('覆蓋匯入成功！');
      return true;
    }

    const result = mergeImportedData(data);
    if (isCloudSync()) await Sync.bulkReplace(state.entries);
    saveState();
    alert(`合併完成！新增 ${result.added} 筆，更新 ${result.updated} 筆，共 ${result.total} 筆記錄。`);
    return true;
  };

  return run().catch((error) => {
    alert(`同步失敗：${error.message}`);
    return false;
  });
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

// ── Form helpers ─────────────────────────────────────

function getFormScores() {
  return readScoreInputs('').scores;
}

function getEditScores() {
  return readScoreInputs('edit').scores;
}

// ── Cloud sync ───────────────────────────────────────

function updateSyncBar(status = 'idle', message = '') {
  const bar = document.getElementById('syncBar');
  const text = document.getElementById('syncStatus');
  const refreshBtn = document.getElementById('refreshBtn');
  const syncHint = document.getElementById('syncHint');
  if (!bar || !text) return;

  bar.classList.remove('sync-ok', 'sync-error', 'sync-loading');
  if (status === 'ok') bar.classList.add('sync-ok');
  if (status === 'error') bar.classList.add('sync-error');
  if (status === 'loading') bar.classList.add('sync-loading');

  if (message) {
    text.textContent = message;
  } else if (isCloudSync()) {
    text.textContent = `已連線：${Sync.label()}`;
  } else if (Sync.mode() !== 'local') {
    text.textContent = `${Sync.label()}（請完成 config 設定）`;
  } else {
    text.textContent = '僅本地模式（備份需手動同步）';
  }

  if (refreshBtn) refreshBtn.hidden = !isCloudSync();
  if (syncHint) {
    syncHint.hidden = isCloudSync();
  }
}

async function refreshFromRemote() {
  if (!isCloudSync()) return;
  updateSyncBar('loading', '同步中...');
  try {
    const entriesPromise = Sync.loadEntries();
    const avatarsPromise = Sync.supportsAvatars()
      ? Sync.loadAvatars().catch(() => ({}))
      : Promise.resolve({});
    const [entries, avatars] = await Promise.all([entriesPromise, avatarsPromise]);
    state.entries = entries;
    cloudAvatars = avatars;
    saveStateLocal();
    render();
    updateSyncBar('ok', `已連線：${Sync.label()} · 剛剛更新`);
  } catch (error) {
    updateSyncBar('error', `同步失敗：${error.message}`);
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const seconds = Sync.getConfig().autoRefreshSeconds || 0;
  if (!isCloudSync() || seconds <= 0) return;
  refreshTimer = setInterval(refreshFromRemote, seconds * 1000);
}

// ── Actions ──────────────────────────────────────────

async function addEntry(e) {
  e.preventDefault();
  const { scores, valid } = readScoreInputs('');
  if (!valid) {
    alert('請檢查分數算式格式');
    return;
  }
  if (sumScores(scores) !== 0) return;

  const entry = {
    id: uid(),
    date: document.getElementById('entryDate').value,
    type: document.getElementById('entryType').value,
    note: document.getElementById('entryNote').value.trim(),
    scores,
    createdAt: Date.now(),
  };

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  try {
    if (isCloudSync()) await Sync.upsertEntry(entry);
    state.entries.push(entry);
    document.getElementById('entryNote').value = '';
    FIXED_PLAYERS.forEach((p) => {
      const input = document.getElementById(`score-${p.id}`);
      if (input) input.value = '0';
    });
    saveState();
    updateSyncBar('ok');
  } catch (error) {
    alert(`儲存失敗：${error.message}`);
    updateSyncBar('error', `同步失敗：${error.message}`);
  } finally {
    submitBtn.disabled = false;
    updateBalance('balanceBar', 'balanceValue', 'balanceHint', 'submitBtn', readScoreInputs(''));
  }
}

async function deleteEntry(id) {
  if (!confirm('確定刪除這筆記錄？')) return;
  try {
    if (isCloudSync()) await Sync.deleteEntry(id);
    state.entries = state.entries.filter((e) => e.id !== id);
    saveState();
    updateSyncBar('ok');
  } catch (error) {
    alert(`刪除失敗：${error.message}`);
    updateSyncBar('error', `同步失敗：${error.message}`);
  }
}

function openEdit(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  editingEntryId = id;

  document.getElementById('editDate').value = entry.date;
  document.getElementById('editType').value = entry.type;
  renderScoreInputs('editScoreInputs', 'edit');

  FIXED_PLAYERS.forEach((p) => {
    const input = document.getElementById(`editscore-${p.id}`);
    if (input) input.value = entry.scores[p.id] || 0;
  });

  updateBalance('editBalanceBar', 'editBalanceValue', 'editBalanceHint', 'editSave', readScoreInputs('edit'));
  document.getElementById('editDialog').showModal();
}

async function saveEdit(e) {
  e.preventDefault();
  const { scores, valid } = readScoreInputs('edit');
  if (!valid) {
    alert('請檢查分數算式格式');
    return;
  }
  if (sumScores(scores) !== 0) return;

  const entry = state.entries.find((item) => item.id === editingEntryId);
  if (!entry) return;

  entry.date = document.getElementById('editDate').value;
  entry.type = document.getElementById('editType').value;
  entry.scores = scores;

  try {
    if (isCloudSync()) await Sync.upsertEntry(entry);
    document.getElementById('editDialog').close();
    editingEntryId = null;
    saveState();
    updateSyncBar('ok');
  } catch (error) {
    alert(`更新失敗：${error.message}`);
    updateSyncBar('error', `同步失敗：${error.message}`);
  }
}

function exportData() {
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `決鬥帳本備份_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyExportText() {
  const payload = buildExportPayload();
  const text = JSON.stringify(payload);
  const ok = await copyTextToClipboard(text);
  if (ok) alert('已複製！貼到群組後，其他人用「合併匯入」即可同步，不會蓋掉各自記的帳。');
  else alert('複製失敗：請改用「下載備份」檔案分享。');
}

function importData(file, mode = 'merge') {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = parseImportPayload(e.target.result);
      await processImport(data, mode);
    } catch {
      alert('無法讀取備份檔案');
    }
  };
  reader.readAsText(file);
}

function openPasteImport() {
  const dialog = document.getElementById('pasteDialog');
  const ta = document.getElementById('pasteTextarea');
  ta.value = '';
  dialog.showModal();
  setTimeout(() => ta.focus(), 50);
}

function closePasteImport() {
  document.getElementById('pasteDialog').close();
}

async function confirmPasteImport(e, mode = 'merge') {
  if (e) e.preventDefault();
  const ta = document.getElementById('pasteTextarea');
  const text = (ta.value || '').trim();
  if (!text) return;

  let data;
  try {
    data = parseImportPayload(text);
  } catch {
    alert('貼上的內容不是有效 JSON');
    return;
  }

  const ok = await processImport(data, mode);
  if (ok) closePasteImport();
}

// ── Init ─────────────────────────────────────────────

async function init() {
  document.getElementById('entryDate').value = todayISO();

  document.getElementById('entryForm').addEventListener('submit', addEntry);
  document.getElementById('editForm').addEventListener('submit', saveEdit);
  document.getElementById('editCancel').addEventListener('click', () => {
    document.getElementById('editDialog').close();
  });
  document.getElementById('playerClose').addEventListener('click', () => {
    document.getElementById('playerDialog').close();
  });
  document.getElementById('filterType').addEventListener('change', render);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('copyExportBtn').addEventListener('click', copyExportText);
  document.getElementById('pasteImportBtn').addEventListener('click', openPasteImport);
  document.getElementById('refreshBtn')?.addEventListener('click', refreshFromRemote);

  document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0], 'merge');
    e.target.value = '';
  });

  document.getElementById('importOverwriteBtn').addEventListener('click', () => {
    document.getElementById('importOverwriteFile').click();
  });

  document.getElementById('importOverwriteFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0], 'overwrite');
    e.target.value = '';
  });

  document.getElementById('pasteForm').addEventListener('submit', (e) => confirmPasteImport(e, 'merge'));
  document.getElementById('pasteOverwrite').addEventListener('click', () => confirmPasteImport(null, 'overwrite'));
  document.getElementById('pasteCancel').addEventListener('click', closePasteImport);

  render();
  updateSyncBar();

  if (isCloudSync()) {
    if (Sync.getConfig().syncMode === 'supabase' && !window.supabase?.createClient) {
      updateSyncBar('error', 'Supabase SDK 載入失敗，請檢查網路或換網路');
      return;
    }
    await refreshFromRemote();
    startAutoRefresh();
  }
}

init();
