const Sync = (() => {
  function getConfig() {
    return window.LEDGER_CONFIG || { syncMode: 'local' };
  }

  function mode() {
    return getConfig().syncMode || 'local';
  }

  function isActive() {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') return !!(cfg.googleApiUrl && cfg.googleToken);
    if (cfg.syncMode === 'supabase') return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
    return false;
  }

  function label() {
    if (mode() === 'google' && isActive()) return 'Google 試算表';
    if (mode() === 'supabase' && isActive()) return 'Supabase 雲端';
    if (mode() === 'google' || mode() === 'supabase') return '尚未設定連線';
    return '僅本地';
  }

  async function googleRequest(payload) {
    const cfg = getConfig();
    const res = await fetch(cfg.googleApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: cfg.googleToken, ...payload }),
    });
    const data = JSON.parse(await res.text());
    if (!data.ok) throw new Error(data.error || 'Google API 錯誤');
    return data;
  }

  function supabaseHeaders(cfg, extra = {}) {
    return {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...extra,
    };
  }

  function rowToEntry(row) {
    return {
      id: row.id,
      date: row.date,
      type: row.type,
      note: row.note || '',
      scores: row.scores || {},
      createdAt: row.created_at || 0,
    };
  }

  function entryToRow(entry) {
    return {
      id: entry.id,
      date: entry.date,
      type: entry.type,
      note: entry.note || '',
      scores: entry.scores || {},
      created_at: entry.createdAt || Date.now(),
    };
  }

  async function loadEntries() {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') {
      const data = await googleRequest({ action: 'list' });
      return data.entries || [];
    }
    if (cfg.syncMode === 'supabase') {
      const res = await fetch(
        `${cfg.supabaseUrl}/rest/v1/entries?select=*&order=created_at.desc`,
        { headers: supabaseHeaders(cfg) },
      );
      if (!res.ok) throw new Error(`Supabase 讀取失敗 (${res.status})`);
      const rows = await res.json();
      return rows.map(rowToEntry);
    }
    return null;
  }

  async function upsertEntry(entry) {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') {
      await googleRequest({ action: 'upsert', entry });
      return;
    }
    if (cfg.syncMode === 'supabase') {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/entries`, {
        method: 'POST',
        headers: supabaseHeaders(cfg, { Prefer: 'resolution=merge-duplicates' }),
        body: JSON.stringify(entryToRow(entry)),
      });
      if (!res.ok) throw new Error(`Supabase 寫入失敗 (${res.status})`);
    }
  }

  async function deleteEntry(id) {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') {
      await googleRequest({ action: 'delete', id });
      return;
    }
    if (cfg.syncMode === 'supabase') {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/entries?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: supabaseHeaders(cfg),
      });
      if (!res.ok) throw new Error(`Supabase 刪除失敗 (${res.status})`);
    }
  }

  async function bulkReplace(entries) {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') {
      await googleRequest({ action: 'bulkReplace', entries });
      return;
    }
    if (cfg.syncMode === 'supabase') {
      const delRes = await fetch(`${cfg.supabaseUrl}/rest/v1/entries?id=not.is.null`, {
        method: 'DELETE',
        headers: supabaseHeaders(cfg),
      });
      if (!delRes.ok) throw new Error(`Supabase 清空失敗 (${delRes.status})`);
      if (entries.length === 0) return;
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/entries`, {
        method: 'POST',
        headers: supabaseHeaders(cfg),
        body: JSON.stringify(entries.map(entryToRow)),
      });
      if (!res.ok) throw new Error(`Supabase 批量寫入失敗 (${res.status})`);
    }
  }

  function supportsAvatars() {
    return getConfig().syncMode === 'supabase' && isActive();
  }

  async function loadAvatars() {
    const cfg = getConfig();
    if (!supportsAvatars()) return {};
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/player_avatars?select=*`, {
      headers: supabaseHeaders(cfg),
    });
    if (!res.ok) throw new Error(`頭像讀取失敗 (${res.status})`);
    const rows = await res.json();
    const map = {};
    rows.forEach((row) => {
      const cacheBust = row.updated_at ? `?t=${row.updated_at}` : '';
      map[row.player_id] = `${row.avatar_url}${cacheBust}`;
    });
    return map;
  }

  async function uploadAvatar(playerId, blob) {
    const cfg = getConfig();
    if (!supportsAvatars()) throw new Error('目前僅 Supabase 模式支援頭像上傳');

    const path = `${playerId}.jpg`;
    const uploadRes = await fetch(`${cfg.supabaseUrl}/storage/v1/object/avatars/${path}`, {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: blob,
    });
    if (!uploadRes.ok) throw new Error(`頭像上傳失敗 (${uploadRes.status})`);

    const avatarUrl = `${cfg.supabaseUrl}/storage/v1/object/public/avatars/${path}`;
    const updatedAt = Date.now();
    const dbRes = await fetch(`${cfg.supabaseUrl}/rest/v1/player_avatars`, {
      method: 'POST',
      headers: supabaseHeaders(cfg, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({
        player_id: playerId,
        avatar_url: avatarUrl,
        updated_at: updatedAt,
      }),
    });
    if (!dbRes.ok) throw new Error(`頭像資料寫入失敗 (${dbRes.status})`);

    return `${avatarUrl}?t=${updatedAt}`;
  }

  return {
    getConfig,
    mode,
    isActive,
    label,
    supportsAvatars,
    loadEntries,
    loadAvatars,
    uploadAvatar,
    upsertEntry,
    deleteEntry,
    bulkReplace,
  };
})();
