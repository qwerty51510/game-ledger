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

  return {
    getConfig,
    mode,
    isActive,
    label,
    loadEntries,
    upsertEntry,
    deleteEntry,
    bulkReplace,
  };
})();
