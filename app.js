const STORAGE_KEY = 'game-ledger-data';
const EXPORT_SCHEMA_VERSION = 1;
const GAME_TYPES = {
  poker: { label: '德州扑克', short: '德', badge: 'poker' },
  mahjong: { label: '麻将', short: '麻', badge: 'mahjong' },
  sports: { label: '体育', short: '体', badge: 'sports' },
};

const EMOJI_OPTIONS = ['🦈', '🐶', '🐦', '🐱', '🐻', '🦊', '🐼', '🦁', '🐸', '🐷', '🐵', '🦄'];

let state = loadState();
let newPlayerAvatar = { type: 'emoji', value: EMOJI_OPTIONS[0] };
let editingEntryId = null;

// ── Storage ──────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { players: [], entries: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
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

function avatarHTML(player, size = '') {
  if (player.avatar?.type === 'image' && player.avatar.value) {
    return `<img src="${player.avatar.value}" alt="">`;
  }
  const emoji = player.avatar?.value || player.name.charAt(0);
  return size ? emoji : `<span>${emoji}</span>`;
}

async function compressImage(file, maxSize = 128) {
  return new Promise((resolve, reject) => {
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
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Render ───────────────────────────────────────────

function render() {
  renderSummary();
  renderScoreInputs();
  renderLedger();
  renderPlayers();
  updateBalance('balanceBar', 'balanceValue', 'balanceHint', 'submitBtn', getFormScores());
}

function getFilteredEntries() {
  const filter = document.getElementById('filterType')?.value || 'all';
  if (filter === 'all') return state.entries;
  return state.entries.filter((e) => e.type === filter);
}

function computeTotals(entries) {
  const totals = {};
  state.players.forEach((p) => { totals[p.id] = 0; });
  entries.forEach((entry) => {
    state.players.forEach((p) => {
      totals[p.id] += entry.scores[p.id] || 0;
    });
  });
  return totals;
}

function renderSummary() {
  const grid = document.getElementById('summaryGrid');
  const totals = computeTotals(getFilteredEntries());

  if (state.players.length === 0) {
    grid.innerHTML = '<p class="empty-hint">請先新增決鬥者</p>';
    return;
  }

  grid.innerHTML = state.players.map((p) => {
    const t = totals[p.id] || 0;
    const cls = t > 0 ? 'positive' : t < 0 ? 'negative' : 'zero';
    return `
      <div class="summary-item">
        <div class="avatar">${avatarHTML(p)}</div>
        <div class="name">${escapeHTML(p.name)}</div>
        <div class="total ${cls}">${formatNum(t)}</div>
      </div>`;
  }).join('');
}

function renderScoreInputs(containerId = 'scoreInputs', prefix = '') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (state.players.length === 0) {
    container.innerHTML = '<p class="hint-text">請先到下方新增決鬥者</p>';
    return;
  }

  container.innerHTML = state.players.map((p) => `
    <div class="score-field">
      <div class="mini-avatar">${avatarHTML(p)}</div>
      <span class="player-name">${escapeHTML(p.name)}</span>
      <input type="number" step="any" data-player="${p.id}" id="${prefix}score-${p.id}"
        placeholder="0" value="0">
    </div>
  `).join('');

  container.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener('input', () => {
      if (containerId === 'scoreInputs') {
        updateBalance('balanceBar', 'balanceValue', 'balanceHint', 'submitBtn', getFormScores());
      } else {
        updateBalance('editBalanceBar', 'editBalanceValue', 'editBalanceHint', 'editSave', getEditScores());
      }
    });
  });
}

function scoreClass(n) {
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'zero';
}

function renderLedger() {
  const head = document.getElementById('ledgerHead');
  const body = document.getElementById('ledgerBody');
  const hint = document.getElementById('emptyHint');
  const entries = [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (entries.length === 0 || state.players.length === 0) {
    head.innerHTML = '';
    body.innerHTML = '';
    hint.style.display = 'block';
    return;
  }

  hint.style.display = 'none';

  head.innerHTML = `<tr>
    <th>日期</th>
    ${state.players.map((p) => `<th>${escapeHTML(p.name)}</th>`).join('')}
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
        ${entry.note ? `<span style="color:var(--text-muted);font-size:0.75rem"> ${escapeHTML(entry.note)}</span>` : ''}
      </td>
      ${state.players.map((p) => {
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

function renderPlayers() {
  const list = document.getElementById('playerList');
  list.innerHTML = state.players.map((p) => `
    <div class="player-chip">
      <div class="avatar">${avatarHTML(p)}</div>
      <span class="name">${escapeHTML(p.name)}</span>
      <button class="remove-btn" data-id="${p.id}" title="移除">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => removePlayer(btn.dataset.id));
  });
}

function renderEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  picker.innerHTML = EMOJI_OPTIONS.map((e) =>
    `<button type="button" class="emoji-btn${newPlayerAvatar.type === 'emoji' && newPlayerAvatar.value === e ? ' selected' : ''}" data-emoji="${e}">${e}</button>`
  ).join('');

  picker.querySelectorAll('.emoji-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      newPlayerAvatar = { type: 'emoji', value: btn.dataset.emoji };
      updateAvatarPreview();
      renderEmojiPicker();
    });
  });
}

function updateAvatarPreview() {
  const preview = document.getElementById('newAvatarPreview');
  if (newPlayerAvatar.type === 'image') {
    preview.innerHTML = `<img src="${newPlayerAvatar.value}" alt="">`;
  } else {
    preview.innerHTML = `<span>${newPlayerAvatar.value}</span>`;
  }
}

function updateBalance(barId, valueId, hintId, btnId, scores) {
  const sum = sumScores(scores);
  const bar = document.getElementById(barId);
  const valueEl = document.getElementById(valueId);
  const hintEl = document.getElementById(hintId);
  const btn = document.getElementById(btnId);

  valueEl.textContent = formatNum(sum);
  const balanced = sum === 0;

  bar.classList.toggle('balanced', balanced);
  bar.classList.toggle('unbalanced', !balanced);

  if (balanced) {
    hintEl.textContent = '✓ 平衡，可以儲存';
  } else {
    hintEl.textContent = `✗ 差 ${formatNum(sum)}，必須等於 0`;
  }

  if (btn) btn.disabled = !balanced;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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
  if (!Array.isArray(data.players) || !Array.isArray(data.entries)) return '缺少 players / entries';
  for (const p of data.players) {
    if (!p || typeof p !== 'object') return 'players 格式錯誤';
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return 'players 欄位不完整';
  }
  for (const e of data.entries) {
    if (!e || typeof e !== 'object') return 'entries 格式錯誤';
    if (typeof e.id !== 'string' || typeof e.date !== 'string' || typeof e.type !== 'string') return 'entries 欄位不完整';
    if (!e.scores || typeof e.scores !== 'object') return 'entries.scores 格式錯誤';
    if (!(e.type in GAME_TYPES)) return `未知種類：${e.type}`;
    // 允許舊備份沒有 createdAt / note
  }
  return null;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // fallback
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
  const scores = {};
  state.players.forEach((p) => {
    const input = document.getElementById(`score-${p.id}`);
    scores[p.id] = Number(input?.value) || 0;
  });
  return scores;
}

function getEditScores() {
  const scores = {};
  state.players.forEach((p) => {
    const input = document.getElementById(`editscore-${p.id}`);
    scores[p.id] = Number(input?.value) || 0;
  });
  return scores;
}

// ── Actions ──────────────────────────────────────────

function addEntry(e) {
  e.preventDefault();
  const scores = getFormScores();
  if (sumScores(scores) !== 0) return;

  state.entries.push({
    id: uid(),
    date: document.getElementById('entryDate').value,
    type: document.getElementById('entryType').value,
    note: document.getElementById('entryNote').value.trim(),
    scores,
    createdAt: Date.now(),
  });

  document.getElementById('entryNote').value = '';
  state.players.forEach((p) => {
    const input = document.getElementById(`score-${p.id}`);
    if (input) input.value = '0';
  });

  saveState();
}

function deleteEntry(id) {
  if (!confirm('確定刪除這筆記錄？')) return;
  state.entries = state.entries.filter((e) => e.id !== id);
  saveState();
}

function openEdit(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  editingEntryId = id;

  document.getElementById('editDate').value = entry.date;
  document.getElementById('editType').value = entry.type;
  renderScoreInputs('editScoreInputs', 'edit');

  state.players.forEach((p) => {
    const input = document.getElementById(`editscore-${p.id}`);
    if (input) input.value = entry.scores[p.id] || 0;
  });

  updateBalance('editBalanceBar', 'editBalanceValue', 'editBalanceHint', 'editSave', getEditScores());
  document.getElementById('editDialog').showModal();
}

function saveEdit(e) {
  e.preventDefault();
  const scores = getEditScores();
  if (sumScores(scores) !== 0) return;

  const entry = state.entries.find((e) => e.id === editingEntryId);
  if (!entry) return;

  entry.date = document.getElementById('editDate').value;
  entry.type = document.getElementById('editType').value;
  entry.scores = scores;

  document.getElementById('editDialog').close();
  editingEntryId = null;
  saveState();
}

function addPlayer(e) {
  e.preventDefault();
  const name = document.getElementById('newPlayerName').value.trim();
  if (!name) return;

  state.players.push({
    id: uid(),
    name,
    avatar: { ...newPlayerAvatar },
  });

  document.getElementById('newPlayerName').value = '';
  newPlayerAvatar = { type: 'emoji', value: EMOJI_OPTIONS[0] };
  updateAvatarPreview();
  renderEmojiPicker();
  saveState();
}

function removePlayer(id) {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) return;
  if (!confirm(`確定移除「${p.name}」？其歷史分數會一併清除。`)) return;

  state.players = state.players.filter((pl) => pl.id !== id);
  state.entries.forEach((entry) => {
    delete entry.scores[id];
  });
  saveState();
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
  if (ok) alert('已複製！把這段文字貼到群組，其他人用「貼上匯入」即可。');
  else alert('複製失敗：請改用「下載備份」檔案分享。');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = parseImportPayload(e.target.result);
      const err = validateDataShape(data);
      if (err) {
        alert(`備份檔案格式不正確：${err}`);
        return;
      }
      if (!confirm('匯入會覆蓋現有資料，確定繼續？')) return;
      state = data;
      saveState();
      alert('匯入成功！');
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

function confirmPasteImport(e) {
  e.preventDefault();
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

  const err = validateDataShape(data);
  if (err) {
    alert(`貼上匯入失敗：${err}`);
    return;
  }

  if (!confirm('匯入會覆蓋現有資料，確定繼續？')) return;
  state = data;
  closePasteImport();
  saveState();
  alert('匯入成功！');
}

function clearAll() {
  if (!confirm('確定清除所有玩家和記錄？此操作無法復原（除非你有備份）。')) return;
  state = { players: [], entries: [] };
  saveState();
}

// ── Init ─────────────────────────────────────────────

function init() {
  document.getElementById('entryDate').value = todayISO();

  document.getElementById('entryForm').addEventListener('submit', addEntry);
  document.getElementById('playerForm').addEventListener('submit', addPlayer);
  document.getElementById('editForm').addEventListener('submit', saveEdit);
  document.getElementById('editCancel').addEventListener('click', () => {
    document.getElementById('editDialog').close();
  });
  document.getElementById('filterType').addEventListener('change', render);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('copyExportBtn').addEventListener('click', copyExportText);
  document.getElementById('pasteImportBtn').addEventListener('click', openPasteImport);
  document.getElementById('clearBtn').addEventListener('click', clearAll);

  document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('pasteForm').addEventListener('submit', confirmPasteImport);
  document.getElementById('pasteCancel').addEventListener('click', closePasteImport);

  document.getElementById('newAvatarFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('圖片太大，請選擇 5MB 以下的檔案');
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      newPlayerAvatar = { type: 'image', value: dataUrl };
      updateAvatarPreview();
      renderEmojiPicker();
    } catch {
      alert('圖片處理失敗');
    }
    e.target.value = '';
  });

  renderEmojiPicker();
  updateAvatarPreview();
  render();
}

init();
