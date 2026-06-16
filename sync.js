const Sync = (() => {
  let supabaseClient = null;

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

  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    const cfg = getConfig();
    if (!window.supabase?.createClient) {
      throw new Error('Supabase SDK 未載入，請重新整理頁面');
    }
    supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      db: { schema: 'public' },
    });
    return supabaseClient;
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
      const { data, error } = await getSupabaseClient()
        .from('entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Supabase 讀取失敗：${error.message}`);
      return (data || []).map(rowToEntry);
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
      const { error } = await getSupabaseClient()
        .from('entries')
        .upsert(entryToRow(entry));
      if (error) throw new Error(`Supabase 寫入失敗：${error.message}`);
    }
  }

  async function deleteEntry(id) {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') {
      await googleRequest({ action: 'delete', id });
      return;
    }
    if (cfg.syncMode === 'supabase') {
      const { error } = await getSupabaseClient()
        .from('entries')
        .delete()
        .eq('id', id);
      if (error) throw new Error(`Supabase 刪除失敗：${error.message}`);
    }
  }

  async function bulkReplace(entries) {
    const cfg = getConfig();
    if (cfg.syncMode === 'google') {
      await googleRequest({ action: 'bulkReplace', entries });
      return;
    }
    if (cfg.syncMode === 'supabase') {
      const client = getSupabaseClient();
      const { error: delError } = await client.from('entries').delete().neq('id', '');
      if (delError) throw new Error(`Supabase 清空失敗：${delError.message}`);
      if (entries.length === 0) return;
      const { error } = await client.from('entries').insert(entries.map(entryToRow));
      if (error) throw new Error(`Supabase 批量寫入失敗：${error.message}`);
    }
  }

  function supportsAvatars() {
    return getConfig().syncMode === 'supabase' && isActive();
  }

  async function loadAvatars() {
    if (!supportsAvatars()) return {};
    const { data, error } = await getSupabaseClient()
      .from('player_avatars')
      .select('*');
    if (error) throw new Error(`頭像讀取失敗：${error.message}`);
    const map = {};
    (data || []).forEach((row) => {
      const cacheBust = row.updated_at ? `?t=${row.updated_at}` : '';
      map[row.player_id] = `${row.avatar_url}${cacheBust}`;
    });
    return map;
  }

  async function uploadAvatar(playerId, blob) {
    if (!supportsAvatars()) throw new Error('目前僅 Supabase 模式支援頭像上傳');

    const path = `${playerId}.jpg`;
    const client = getSupabaseClient();
    const { error: uploadError } = await client.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (uploadError) throw new Error(`頭像上傳失敗：${uploadError.message}`);

    const { data: publicData } = client.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = publicData.publicUrl;
    const updatedAt = Date.now();
    const { error } = await client.from('player_avatars').upsert({
      player_id: playerId,
      avatar_url: avatarUrl,
      updated_at: updatedAt,
    });
    if (error) throw new Error(`頭像資料寫入失敗：${error.message}`);

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
