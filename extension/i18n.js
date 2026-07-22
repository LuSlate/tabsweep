/**
 * i18n.js — dashboard language (zh/en), DOM-free
 *
 * Loaded by index.html before app.js. Not loaded by the service worker
 * (background has no UI strings). chrome/DOM access lives inside
 * functions only, so selfcheck can vm-load this file in node.
 *
 * Manual toggle beats _locales/chrome.i18n here: the platform API
 * follows the browser UI language only and can't switch at runtime.
 */

const I18N = {
  en: {
    // settings panel + static
    aiGrouping: 'AI grouping',
    endpoint: 'Endpoint',
    apiKeyLabel: 'API key',
    modelLabel: 'Model',
    maxTokensLabel: 'Max response tokens',
    testConnection: 'Test connection & list models',
    testing: '⏳ Testing…',
    autoBackground: 'Auto group in background (every 30 min)',
    regroupAll: 'Re-group all tabs now',
    autoCloseTitle: 'Auto-close',
    scheduledSweep: 'Scheduled background sweep',
    scanInterval: 'Scan interval (min)',
    closeTabsIdle: 'Close tabs idle (minutes)',
    closeGroupsIdle: 'Close groups idle (minutes)',
    dailyAt: 'Daily at (overrides interval)',
    saveSettings: 'Save settings',
    workspacesTitle: 'Workspaces',
    savedForLater: 'Saved for later',
    nothingSaved: 'NOTHING SAVED.',
    archiveTitle: 'Archive',
    searchArchived: 'Search archived tabs...',
    openTabsSuffix: 'OPEN TABS',
    noResults: 'No results',
    // command bar
    cmdSweep: '> Sweep {n} stale',
    cmdCloseDash: '> Close {n} extra dashboard{s}',
    cmdCloseAiDupes: '> Close {n} AI dupe{s}',
    cmdSmartGroup: '> Smart group',
    cmdGroupChrome: '> Group in Chrome',
    cmdAuto: 'Auto',
    cmdCloseAll: '> Close all {n}',
    // group sections
    homepages: 'Homepages',
    taskDot: 'Task · {label}',
    taskTabs: 'Task · {n} tabs',
    stash: 'Stash',
    stashTitle: 'Save this group and close its tabs',
    closeN: 'Close {n}',
    dedupN: 'Dedup {n}',
    moreN: '+{n} more',
    saveTabTitle: 'Save for later',
    closeTabTitle: 'Close this tab',
    // AI sweep band
    aiSweepBand: 'AI sweep · {n}',
    closeSelected: 'Close selected',
    dismiss: 'Dismiss',
    // workspaces / deferred
    wsMeta: '{n} tab{s} · saved {ago}',
    restore: 'Restore',
    deleteLabel: 'Delete',
    stashedCount: '{n} stashed',
    itemsCount: '{n} item{s}',
    tabsCount: '{n} tab{s}',
    // empty state
    allClear: 'All clear',
    noOpenTabs: 'No open tabs',
    // timeAgo
    justNow: 'just now',
    minAgo: '{n} min ago',
    hrsAgo: '{n} hr{s} ago',
    yesterday: 'yesterday',
    daysAgo: '{n} days ago',
    // toasts + transient states
    toastSwept: 'Swept {n} stale tab{s} — saved to archive',
    toastAutoSwept: 'Auto-swept {n} stale tab{s} — saved to archive',
    toastAiTick: 'AI: {g} groups · {d} dupes · {c} close suggestions',
    toastRestored: 'Restored {n} tab{s} — {name}',
    toastWsDeleted: 'Workspace deleted',
    toastDashClosed: 'Closed extra dashboard tabs',
    toastEnterKey: 'Enter an API key first',
    toastConnModels: 'Connected — {n} model{s} available',
    toastConnNoList: 'Connected — this endpoint has no model listing',
    toastConnFailed: 'Connection failed: {msg}',
    toastSettingsSaved: 'Settings saved',
    toastNeedKey: 'Set an API key in ⚙ Settings first',
    toastSmartFailed: 'Smart group failed: {msg}',
    toastRegrouped: 'Re-grouped into {n} tasks',
    toastRegroupFailed: 'Re-group failed: {msg}',
    toastActionFailed: 'Something went wrong — try reloading the page',
    toastTabClosed: 'Tab closed',
    toastSaveFailed: 'Failed to save tab',
    toastDeferred: 'Saved for later',
    toastClosedFrom: 'Closed {n} tab{s} from {label}',
    toastStashed: 'Stashed {n} tab{s} — {name}',
    toastAiDupesClosed: 'Closed {n} AI dupe{s} — saved to archive',
    toastDupesClosed: 'Closed duplicates, kept one copy each',
    toastNothingSelected: 'Nothing selected',
    toastClosedArchived: 'Closed {n} tab{s} — saved to archive',
    toastAllClosed: 'All tabs closed. Fresh start.',
    toastAutoGroupOn: 'Auto-grouping on',
    toastAutoGroupOff: 'Auto-grouping off',
    toastGrouped: 'Grouped {n} tabs into {m} group{s}',
    toastNothingGroup: 'Nothing to group',
    toastStorageFull: 'Archive storage full — sweep paused. Clear old archive entries.',
    youtubeVideo: 'YouTube Video',
    grouping: '⏳ Grouping…',
    regrouping: '⏳ Re-grouping…',
  },
  zh: {
    aiGrouping: 'AI 分组',
    endpoint: '端点',
    apiKeyLabel: 'API 密钥',
    modelLabel: '模型',
    maxTokensLabel: '响应 token 上限',
    testConnection: '测试连接并列出模型',
    testing: '⏳ 测试中…',
    autoBackground: '后台自动分组（每 30 分钟）',
    regroupAll: '立即全量重新分组',
    autoCloseTitle: '自动关闭',
    scheduledSweep: '后台定时清扫',
    scanInterval: '扫描间隔（分钟）',
    closeTabsIdle: '闲置标签关闭（分钟）',
    closeGroupsIdle: '闲置分组关闭（分钟）',
    dailyAt: '每日定时（覆盖间隔）',
    saveSettings: '保存设置',
    workspacesTitle: '工作区',
    savedForLater: '稍后阅读',
    nothingSaved: '这里空空如也',
    archiveTitle: '归档',
    searchArchived: '搜索归档标签…',
    openTabsSuffix: '个打开的标签',
    noResults: '无结果',
    cmdSweep: '> 清扫 {n} 个过期',
    cmdCloseDash: '> 关闭 {n} 个多余仪表盘',
    cmdCloseAiDupes: '> 关闭 {n} 个 AI 重复',
    cmdSmartGroup: '> 智能分组',
    cmdGroupChrome: '> 在 Chrome 中分组',
    cmdAuto: '自动',
    cmdCloseAll: '> 关闭全部 {n}',
    homepages: '主页',
    taskDot: '任务 · {label}',
    taskTabs: '任务 · {n} 个标签',
    stash: '暂存',
    stashTitle: '保存此分组并关闭其标签',
    closeN: '关闭 {n}',
    dedupN: '去重 {n}',
    moreN: '还有 {n} 个',
    saveTabTitle: '存入稍后阅读',
    closeTabTitle: '关闭此标签',
    aiSweepBand: 'AI 清扫 · {n}',
    closeSelected: '关闭选中',
    dismiss: '忽略',
    wsMeta: '{n} 个标签 · 保存于 {ago}',
    restore: '恢复',
    deleteLabel: '删除',
    stashedCount: '{n} 个已暂存',
    itemsCount: '{n} 项',
    tabsCount: '{n} 个标签',
    allClear: '全部清净',
    noOpenTabs: '没有打开的标签',
    justNow: '刚刚',
    minAgo: '{n} 分钟前',
    hrsAgo: '{n} 小时前',
    yesterday: '昨天',
    daysAgo: '{n} 天前',
    toastSwept: '已清扫 {n} 个过期标签 — 已存入归档',
    toastAutoSwept: '已自动清扫 {n} 个过期标签 — 已存入归档',
    toastAiTick: 'AI：{g} 个分组 · {d} 个重复 · {c} 条关闭建议',
    toastRestored: '已恢复 {n} 个标签 — {name}',
    toastWsDeleted: '工作区已删除',
    toastDashClosed: '已关闭多余仪表盘',
    toastEnterKey: '请先输入 API 密钥',
    toastConnModels: '连接成功 — 共 {n} 个模型',
    toastConnNoList: '连接成功 — 此端点无模型列表',
    toastConnFailed: '连接失败：{msg}',
    toastSettingsSaved: '设置已保存',
    toastNeedKey: '请先在 ⚙ 设置中填入 API 密钥',
    toastSmartFailed: '智能分组失败：{msg}',
    toastRegrouped: '已重新分为 {n} 个任务组',
    toastRegroupFailed: '重新分组失败：{msg}',
    toastActionFailed: '操作失败 — 请刷新页面重试',
    toastTabClosed: '标签已关闭',
    toastSaveFailed: '保存标签失败',
    toastDeferred: '已存入稍后阅读',
    toastClosedFrom: '已关闭「{label}」的 {n} 个标签',
    toastStashed: '已暂存 {n} 个标签 — {name}',
    toastAiDupesClosed: '已关闭 {n} 个 AI 重复 — 已存入归档',
    toastDupesClosed: '已关闭重复标签，各保留一份',
    toastNothingSelected: '未选中任何项',
    toastClosedArchived: '已关闭 {n} 个标签 — 已存入归档',
    toastAllClosed: '全部标签已关闭，重新开始。',
    toastAutoGroupOn: '自动分组已开启',
    toastAutoGroupOff: '自动分组已关闭',
    toastGrouped: '已将 {n} 个标签分为 {m} 组',
    toastNothingGroup: '没有可分组的标签',
    toastStorageFull: '归档存储已满 — 清扫暂停。请清理旧归档条目。',
    youtubeVideo: 'YouTube 视频',
    grouping: '⏳ 分组中…',
    regrouping: '⏳ 重新分组中…',
  },
};

let _lang = 'en';

/** pickLang(navLanguage) → 'zh' | 'en' — pure. */
function pickLang(navLanguage) {
  return /^zh/i.test(navLanguage || '') ? 'zh' : 'en';
}

/** setLang(l) — normalizes to 'zh' | 'en'. Pure (DOM side effects stay in init/toggle). */
function setLang(l) { _lang = l === 'zh' ? 'zh' : 'en'; }

function currentLang() { return _lang; }

/**
 * t(key, vars?) — current-lang lookup → en fallback → key itself.
 * `{name}` tokens are replaced with vars[name] (missing → '').
 * English plurals ride the {s} var (caller passes n !== 1 ? 's' : '');
 * zh strings simply omit it.
 */
function t(key, vars) {
  const dict = I18N[_lang] || I18N.en;
  let s = dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  // ponytail: iterative split/join allows cascading re-substitution if any
  // substitution value contains {another_key}. No current caller does, but
  // a single-pass regex replace (e.g. s.replace(/\{(\w+)\}/g, ...)) would fix it
  // if caller-controlled values are ever used.
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k] != null ? String(vars[k]) : '');
  return s;
}

/** initI18n() — storage `lang` wins; unset → browser language. Call before first render. */
async function initI18n() {
  const { lang } = await chrome.storage.local.get('lang');
  setLang(lang || pickLang(navigator.language));
  document.documentElement.lang = currentLang() === 'zh' ? 'zh-CN' : 'en';
  applyStaticI18n();
  updateLangToggle();
}

/** applyStaticI18n() — re-translate every [data-i18n] / [data-i18n-placeholder] element. */
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

/** updateLangToggle() — the topbar button shows the language you'd switch TO. */
function updateLangToggle() {
  const btn = document.getElementById('langToggle');
  if (btn) btn.textContent = currentLang() === 'zh' ? 'EN' : '中';
}

/** toggleLang() — flip, persist, re-apply static strings. Caller then re-renders. */
async function toggleLang() {
  setLang(currentLang() === 'zh' ? 'en' : 'zh');
  await chrome.storage.local.set({ lang: currentLang() });
  document.documentElement.lang = currentLang() === 'zh' ? 'zh-CN' : 'en';
  applyStaticI18n();
  updateLangToggle();
}
