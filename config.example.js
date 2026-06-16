// 複製為 config.js 並填入你的設定
window.LEDGER_CONFIG = {
  // 'local' | 'google' | 'supabase'
  syncMode: 'local',

  // Google 試算表（Apps Script 網址，見 google-apps-script/Code.gs）
  googleApiUrl: '',
  // 與 Apps Script 裡 TOKEN 一致（若 repo 公開，建議改用 Supabase）
  googleToken: '',

  // Supabase（免費雲端資料庫，見 supabase/schema.sql）
  supabaseUrl: '',
  // publishable key 或 anon public key 均可
  supabaseAnonKey: '',

  // 自動重新整理間隔（秒），0 = 關閉
  autoRefreshSeconds: 30,
};
