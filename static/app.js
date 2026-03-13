/* ═══════════════════════════════════════════════════════
   ChatSQL — Frontend Application
   Full conversational AI assistant for complex SQL
═══════════════════════════════════════════════════════ */
// ── AUTH & ROLE ───────────────────────────────────────
let CURRENT_USER = null;

async function initAuth() {
  try {
    const res  = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    CURRENT_USER = await res.json();
    applyRoleUI(CURRENT_USER);
  } catch(e) {
    window.location.href = '/login';
  }
}

function applyRoleUI(user) {
  // Role chip
  const chip = document.getElementById('roleChip');
  const icons = { admin:'👑', manager:'📊', analyst:'🔍', viewer:'👁' };
  chip.textContent  = `${icons[user.role] || ''} ${user.role.charAt(0).toUpperCase()+user.role.slice(1)}`;
  chip.className    = `role-chip ${user.role}`;

  // User dropdown info
  document.getElementById('udName').textContent  = user.name;
  document.getElementById('udEmail').textContent = user.email;

  // Show Manage Users only for admin
  if (user.role === 'admin') {
    document.getElementById('udAdminItem').style.display = 'flex';
  }
}

// ── ACTIVITY NOTIFICATIONS ────────────────────────────
let _alPage = 0;
const AL_LIMIT = 30;

async function fetchUnreadCount() {
  try {
    const res  = await fetch('/api/activity/unread');
    const data = await res.json();
    const badge = document.getElementById('notifBadge');
    const count = data.count || 0;
    if (count > 0) {
      badge.style.display = 'flex';
      badge.textContent   = count > 99 ? '99+' : count;
    } else {
      badge.style.display = 'none';
    }
  } catch(e) {}
}

async function openActivityLog() {
  document.getElementById('activityModal').style.display = 'flex';
  _alPage = 0;
  await loadActivityLog();
  await fetch('/api/activity/mark_read', { method: 'POST' });
  document.getElementById('notifBadge').style.display = 'none';
}

function closeActivityLog() {
  document.getElementById('activityModal').style.display = 'none';
}

async function loadActivityLog() {
  const wrap   = document.getElementById('alTableWrap');
  const role   = document.getElementById('alRoleFilter')?.value   || '';
  const action = document.getElementById('alActionFilter')?.value || '';
  wrap.innerHTML = `<div class="al-empty"><div class="al-empty-icon">⏳</div><div class="al-empty-text">Loading…</div></div>`;

  try {
    const params = new URLSearchParams({ limit: AL_LIMIT, offset: _alPage * AL_LIMIT, ...(role && {role}), ...(action && {action}) });
    const res  = await fetch(`/api/activity/feed?${params}`);
    const data = await res.json();
    if (!res.ok) {
      wrap.innerHTML = `<div class="al-empty"><div class="al-empty-icon">⚠️</div><div class="al-empty-text">${data.error}</div></div>`;
      return;
    }

    document.getElementById('alTotal').textContent = `${data.total} events`;

    if (!data.logs.length) {
      wrap.innerHTML = `
        <div class="al-empty">
          <div class="al-empty-icon">🔍</div>
          <div class="al-empty-text">No activity found</div>
          <div class="al-empty-sub">Actions will appear here as users interact</div>
        </div>`;
      document.getElementById('alPagination').innerHTML = '';
      return;
    }

    const actionLabels = {
      login:        ['🔐', 'Login'],
      logout:       ['🚪', 'Logout'],
      query_select: ['🔍', 'SELECT'],
      query_insert: ['➕', 'INSERT'],
      query_update: ['✏️', 'UPDATE'],
      query_delete: ['🗑', 'DELETE'],
      export:       ['⬇️', 'Export'],
      schema_open:  ['📊', 'Schema'],
      query_error:  ['⚠️', 'Error'],
    };

    const roleIcons = { admin:'👑', manager:'📊', analyst:'🔍', viewer:'👁' };

    wrap.innerHTML = `<div class="al-feed">${data.logs.map(log => {
      const [icon, label] = actionLabels[log.action_type] || ['•', log.action_type];
      const t = new Date(log.time);
      const timeStr  = formatLogTime(log.time);

      return `
      <div class="al-event ${!log.is_read ? 'unread' : ''}">

        <!-- Time -->
        <div class="al-ev-time">
          <div>${timeStr}</div>
        </div>

        <!-- Main -->
        <div class="al-ev-main">
          <div class="al-ev-top">
            <span class="al-ev-user">${escHtml(log.user_name)}</span>
            <span class="al-role ${log.user_role}">${roleIcons[log.user_role]||''} ${log.user_role}</span>
            <span class="al-ev-ip">${escHtml(log.ip)}</span>
          </div>
          <div class="al-ev-detail">${escHtml(log.detail || '')}</div>
          ${log.sql_query ? `<div class="al-ev-sql" title="Click to expand">${escHtml(log.sql_query)}</div>` : ''}
        </div>

        <!-- Right -->
        <div class="al-ev-right">
          <span class="al-badge ${log.action_type}">${icon} ${label}</span>
          <div style="display:flex;align-items:center;gap:5px">
            <div class="al-status-dot ${log.status}"></div>
            ${log.rows ? `<span class="al-rows-chip">${log.rows} rows</span>` : ''}
          </div>
        </div>

      </div>`;
    }).join('')}</div>`;

    // Pagination
    const totalPages = Math.ceil(data.total / AL_LIMIT);
    const pg = document.getElementById('alPagination');
    pg.innerHTML = totalPages > 1 ? `
      <button class="pg-btn" onclick="alChangePage(${_alPage-1})" ${_alPage===0?'disabled':''}>← Prev</button>
      <span>Page ${_alPage+1} of ${totalPages}</span>
      <button class="pg-btn" onclick="alChangePage(${_alPage+1})" ${_alPage>=totalPages-1?'disabled':''}>Next →</button>` : '';

  } catch(e) {
    wrap.innerHTML = `<div class="al-empty"><div class="al-empty-icon">⚠️</div><div class="al-empty-text">Failed to load activity log</div></div>`;
  }
}

async function alChangePage(page) { _alPage = page; await loadActivityLog(); }

async function clearActivityLog() {
  if (!confirm('Clear all activity logs? This cannot be undone.')) return;
  const res = await fetch('/api/activity/clear', { method: 'DELETE' });
  if (res.ok) { await loadActivityLog(); document.getElementById('notifBadge').style.display = 'none'; }
}

function formatLogTime(timeStr) {
  if (!timeStr) return '';
  const d = new Date(timeStr);
  const diff = Date.now() - d;
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString('en-IN', {day:'2-digit',month:'short'}) + ' ' + d.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
}

async function logClientActivity(actionType, detail = '') {
  try {
    await fetch('/api/activity/log', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action_type: actionType, detail }),
    });
  } catch(e) {}
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function toggleUserMenu(event) {
  event.stopPropagation();
  const dd = document.getElementById('userDropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const btn = document.getElementById('userMenuBtn');
  const dd  = document.getElementById('userDropdown');
  if (dd && btn && !btn.contains(e.target)) {
    dd.style.display = 'none';
  }
});


// ── STATE ─────────────────────────────────────────────
const STATE = {
  conversations: [],       // [{id, title, messages:[]}]
  activeId: null,
  schema: {},
  dbConnected: false,
  dbLabel: '',
  schemaOpen: true,
  sidebarOpen: true,
  voiceRecognition: null,
  settings: {
    model: 'llama3-70b-8192',
    rowsPerPage: 10,
    autoChart: false,
  },
  totalTokens: 0,
};

// Per-result state: { msgId -> { rows, columns, page, chartType, chartInst } }
const resultState = {};

// ── INIT ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  if (CURRENT_USER?.role === 'admin') {
    document.getElementById('notifBell').style.display = 'flex';
    fetchUnreadCount();
    setInterval(fetchUnreadCount, 15000);
  }
  loadSettings();
  loadHistory();
  renderHistory();
  await checkInitialStatus();
  buildSuggestions();
});

async function checkInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.database.connected) {
      setDBConnected(data.database.url || 'Connected');
      document.getElementById('connectModal').style.display = 'none';
      await loadSchema();
    } else {
      document.getElementById('connectModal').style.display = 'flex';
    }
    document.getElementById('modelName').textContent =
      (data.groq.model || 'llama3-70b').replace('-8192','').replace('-32768','');
  } catch (e) {
    document.getElementById('connectModal').style.display = 'flex';
  }
}

// ── SETTINGS ──────────────────────────────────────────
function loadSettings() {
  const s = localStorage.getItem('chatsql_settings');
  if (s) Object.assign(STATE.settings, JSON.parse(s));
  document.getElementById('modelSelect').value      = STATE.settings.model;
  document.getElementById('rowsPerPage').value      = STATE.settings.rowsPerPage;
  document.getElementById('autoChart').checked      = STATE.settings.autoChart;
}

function saveSettings() {
  STATE.settings.model       = document.getElementById('modelSelect').value;
  STATE.settings.rowsPerPage = parseInt(document.getElementById('rowsPerPage').value);
  STATE.settings.autoChart   = document.getElementById('autoChart').checked;
  localStorage.setItem('chatsql_settings', JSON.stringify(STATE.settings));
}

function openSettings()  { document.getElementById('settingsModal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }

// ── DB CONNECT ────────────────────────────────────────
function setDbTemplate(type) {
  const map = {
    postgresql: 'postgresql://user:password@localhost:5432/mydb',
    mysql:      'mysql+pymysql://user:password@localhost:3306/mydb',
    sqlite:     'sqlite:///./mydb.sqlite',
    mssql:      'mssql+pyodbc://user:password@localhost/mydb?driver=ODBC+Driver+17+for+SQL+Server',
  };
  document.getElementById('dbUrlInput').value = map[type] || '';
}

function openConnectModal() {
  document.getElementById('connectError').style.display = 'none';
  document.getElementById('connectModal').style.display = 'flex';
}

async function connectDB() {
  const url = document.getElementById('dbUrlInput').value.trim();
  if (!url) return showConnectError('Please enter a database URL');
  const btn = document.getElementById('connectBtn');
  const txt = document.getElementById('connectBtnText');
  btn.disabled = true; txt.textContent = 'Connecting…';
  document.getElementById('connectError').style.display = 'none';
  try {
    const res  = await fetch('/api/connect', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({database_url: url})
    });
    const data = await res.json();
    if (!res.ok || !data.connected) throw new Error(data.error || 'Connection failed');
    const host = url.split('@').pop()?.split('/')[0] || url;
    setDBConnected(host);
    document.getElementById('connectModal').style.display = 'none';
    await loadSchema();
  } catch(e) {
    showConnectError(e.message);
  } finally {
    btn.disabled = false; txt.textContent = 'Connect Database';
  }
}

function showConnectError(msg) {
  const el = document.getElementById('connectError');
  el.textContent = msg; el.style.display = 'block';
}

function skipConnect() { document.getElementById('connectModal').style.display = 'none'; }

function setDBConnected(label) {
  STATE.dbConnected = true;
  STATE.dbLabel = label;
  document.getElementById('dsDot').className = 'ds-dot connected';
  document.getElementById('dsLabel').textContent = 'Connected';
  document.getElementById('dsUrl').textContent = label;
}

// ── SCHEMA ────────────────────────────────────────────
async function loadSchema() {
  try {
    const res  = await fetch('/api/schema');
    STATE.schema = await res.json();
    if (STATE.schema.error) { STATE.schema = {}; return; }
    renderSchemaTree(STATE.schema);
    const tableCount  = Object.keys(STATE.schema).length;
    const columnCount = Object.values(STATE.schema).reduce((a,t)=>a+t.columns.length,0);
    document.getElementById('spStats').textContent =
      `${tableCount} tables · ${columnCount} columns`;
    buildSuggestions();
  } catch(e) { console.warn('Schema load failed', e); }
}

function renderSchemaTree(schema, filter='') {
  const tree = document.getElementById('schemaTree');
  tree.innerHTML = '';
  const tables = Object.entries(schema);
  if (!tables.length) { tree.innerHTML = '<div class="sp-empty">No tables found</div>'; return; }

  tables.forEach(([tbl, info]) => {
    if (filter && !tbl.toLowerCase().includes(filter) &&
        !info.columns.some(c=>c.name.toLowerCase().includes(filter))) return;

    const node = document.createElement('div');
    node.className = 'db-node';
    const colCount = info.columns.length;

    node.innerHTML = `
      <div class="tbl-row" onclick="toggleTbl(this,'cols-${tbl}')">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
        ${escHtml(tbl)}
        <span class="tbl-count">${colCount}</span>
      </div>
      <div class="col-list" id="cols-${tbl}" style="display:none"></div>`;

    const colList = node.querySelector(`#cols-${tbl}`);
    info.columns.forEach(col => {
      const div = document.createElement('div');
      div.className = 'col-row';
      div.innerHTML = `
        <span class="col-left">
          ${col.primary_key ? '<span class="pk-badge">🔑</span>' : ''}
          <span class="col-nm">${escHtml(col.name)}</span>
        </span>
        <span class="col-type">${col.type.split('(')[0].toLowerCase()}</span>
        <span class="col-ins">+ insert</span>`;
      div.onclick = () => insertColName(col.name);
      colList.appendChild(div);
    });
    tree.appendChild(node);
  });
}

function toggleTbl(el, id) {
  const list = document.getElementById(id);
  if (!list) return;
  const open = list.style.display !== 'none';
  list.style.display = open ? 'none' : '';
  el.style.color = open ? '' : 'var(--t1)';
}

function filterSchema(q) { renderSchemaTree(STATE.schema, q.toLowerCase()); }

function insertColName(name) {
  const ta = document.getElementById('mainInput');
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const after  = ta.value.slice(pos);
  ta.value = before + name + after;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + name.length;
}

function toggleSchema() {
  STATE.schemaOpen = !STATE.schemaOpen;
  document.getElementById('schemaPanel').classList.toggle('collapsed', !STATE.schemaOpen);
  document.getElementById('schemaToggleBtn').classList.toggle('active', STATE.schemaOpen);
  if (STATE.schemaOpen) logClientActivity('schema_open', 'Opened schema browser');
}

// ── SUGGESTIONS ───────────────────────────────────────
const DEFAULT_SUGGESTIONS = [
  'Show me all records from the first table',
  'Count rows in each table',
  'Find duplicate entries',
  'Show the most recently added records',
  'List all unique values in a column',
];

function buildSuggestions() {
  const grid = document.getElementById('suggestGrid');
  let pills = DEFAULT_SUGGESTIONS;
  const tables = Object.keys(STATE.schema);
  if (tables.length) {
    const t = tables[0];
    pills = [
      `Show all records from ${t}`,
      `Count rows in ${t}`,
      `Find duplicates in ${t}`,
      `Show recent entries in ${t}`,
      tables[1] ? `Join ${t} with ${tables[1]}` : `Show unique values in ${t}`,
    ];
  }
  grid.innerHTML = pills.map(p =>
    `<div class="es-pill" onclick="quickAsk('${escAttr(p)}')">${escHtml(p)}</div>`
  ).join('');
}

function quickAsk(q) {
  document.getElementById('mainInput').value = q;
  sendMessage();
}

// ── CONVERSATIONS ─────────────────────────────────────
function loadHistory() {
  const h = localStorage.getItem('chatsql_conversations');
  if (h) STATE.conversations = JSON.parse(h);
  if (STATE.conversations.length) STATE.activeId = STATE.conversations[0].id;
}

function saveHistory() {
  // Keep last 30 conversations
  STATE.conversations = STATE.conversations.slice(0, 30);
  localStorage.setItem('chatsql_conversations', JSON.stringify(
    STATE.conversations.map(c => ({...c, messages: c.messages.slice(-40)}))
  ));
}

function getActiveConversation() {
  return STATE.conversations.find(c => c.id === STATE.activeId);
}

function newChat() {
  const id = 'conv_' + Date.now();
  STATE.conversations.unshift({ id, title: 'New Conversation', messages: [], createdAt: Date.now() });
  STATE.activeId = id;
  STATE.totalTokens = 0;
  saveHistory();
  renderHistory();
  clearThreadUI();
  document.getElementById('chatTitle').textContent = 'New Conversation';
  document.getElementById('tokenCounter').style.display = 'none';
  document.getElementById('contextDisplay').style.display = 'none';
  document.getElementById('ctxTags').innerHTML = '';
}

function loadConversation(id) {
  STATE.activeId = id;
  renderHistory();
  const conv = getActiveConversation();
  if (!conv) return;
  document.getElementById('chatTitle').textContent = conv.title;
  clearThreadUI();
  // Re-render messages from history (text only, no live results)
  conv.messages.forEach(msg => {
    if (msg.role === 'user')      renderUserBubble(msg.content);
    else if (msg.role === 'assistant') renderAITextBubble(msg.content, msg.sql);
  });
  if (conv.messages.length) document.getElementById('emptyState').style.display = 'none';
}

function clearThreadUI() {
  const t = document.getElementById('thread');
  t.innerHTML = '';
  const es = document.createElement('div');
  es.className = 'empty-state'; es.id = 'emptyState';
  es.innerHTML = document.getElementById('emptyState')?.innerHTML ||
    `<div class="es-glyph">🔮</div><h2>Ask anything about your data</h2>
     <p>Type a question in plain English.</p><div class="es-grid" id="suggestGrid"></div>`;
  t.appendChild(es);
  buildSuggestions();
}

function renderHistory() {
  const el = document.getElementById('chatHistory');
  if (!STATE.conversations.length) {
    el.innerHTML = '<div class="ch-empty">No conversations yet</div>';
    return;
  }
  el.innerHTML = STATE.conversations.map(c => `
    <div class="ch-item ${c.id === STATE.activeId ? 'active' : ''}" onclick="loadConversation('${c.id}')">
      <div class="ch-icon">💬</div>
      <div class="ch-body">
        <div class="ch-q">${escHtml(c.title)}</div>
        <div class="ch-time">${timeAgo(c.createdAt)}</div>
      </div>
    </div>`).join('');
}

function clearChat() {
  if (!STATE.activeId) return;
  const conv = getActiveConversation();
  if (conv) conv.messages = [];
  saveHistory();
  clearThreadUI();
  document.getElementById('tokenCounter').style.display = 'none';
  document.getElementById('contextDisplay').style.display = 'none';
}

function exportHistory() {
  const conv = getActiveConversation();
  if (!conv) return alert('No active conversation');
  const blob = new Blob([JSON.stringify(conv, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chatsql-${conv.id}.json`;
  a.click();
}

// ── SEND MESSAGE ──────────────────────────────────────
let isSending = false;

async function sendMessage() {
  const ta = document.getElementById('mainInput');
  const question = ta.value.trim();
  if (!question || isSending) return;

  // Ensure we have an active conversation
  if (!STATE.activeId) newChat();
  const conv = getActiveConversation();

  // Hide empty state
  document.getElementById('emptyState').style.display = 'none';

  ta.value = ''; ta.style.height = 'auto';
  isSending = true;
  document.getElementById('sendBtn').disabled = true;

  // Render user bubble
  renderUserBubble(question);

  // Add to history
  conv.messages.push({role:'user', content: question});

  // Update title from first question
  if (conv.messages.filter(m=>m.role==='user').length === 1) {
    conv.title = question.slice(0,50);
    document.getElementById('chatTitle').textContent = conv.title;
    renderHistory();
  }

  // Show thinking
  const thinkId = showThinking();

  // Build history for context (last 8 turns)
  const historyForAPI = conv.messages.slice(-8).map(m => ({role:m.role, content:m.content}));

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ question, history: historyForAPI })
    });
    const data = await res.json();
    hideThinking(thinkId);

    if (!res.ok) throw new Error(data.error || 'Server error');

    // Update tokens
    STATE.totalTokens += data.tokens_used || 0;
    document.getElementById('tokenCount').textContent = STATE.totalTokens;
    document.getElementById('tokenCounter').style.display = 'block';

    // Update context display
    updateContextDisplay(question);

    // Render AI response
    renderAIResponse(data);

    // Save to history
    conv.messages.push({
      role: 'assistant',
      content: data.explanation || data.raw_llm || '',
      sql: data.generated_sql || ''
    });
    saveHistory();

  } catch(e) {
    hideThinking(thinkId);
    renderErrorBubble(`Connection error: ${e.message}`);
  } finally {
    isSending = false;
    document.getElementById('sendBtn').disabled = false;
  }
}

// ── RENDER FUNCTIONS ──────────────────────────────────
function renderUserBubble(text) {
  const t = document.getElementById('thread');
  const div = document.createElement('div');
  div.className = 'msg-row user';
  div.innerHTML = `
    <div class="msg-av av-user">U</div>
    <div class="msg-body">
      <div class="bubble">${escHtml(text)}</div>
    </div>`;
  t.appendChild(div);
  scrollThread();
}

function renderAITextBubble(text, sql) {
  const t = document.getElementById('thread');
  const div = document.createElement('div');
  div.className = 'msg-row';
  div.innerHTML = `
    <div class="msg-av av-ai">AI</div>
    <div class="msg-body">
      <div class="bubble">${escHtml(text)}</div>
      ${sql ? `<div class="sql-card"><div class="sql-head">
        <span class="sql-lang-tag">⚡ SQL</span>
      </div><pre class="sql-code-block">${highlightSQL(sql)}</pre></div>` : ''}
    </div>`;
  t.appendChild(div);
  scrollThread();
}

function renderAIResponse(data) {
  const t = document.getElementById('thread');
  const msgId = 'msg_' + Date.now();
  const div = document.createElement('div');
  div.className = 'msg-row';
  div.id = msgId;

  const parts = [];

  // 1. Explanation bubble
  if (data.explanation) {
    parts.push(`<div class="bubble">${escHtml(data.explanation)}</div>`);
  }

  // 2. SQL card
  if (data.generated_sql) {
    parts.push(buildSQLCard(data.generated_sql, msgId));
  }

  // 3. Result or Error
  if (data.db_result) {
    const r = data.db_result;
    if (r.type === 'select') {
      parts.push(buildResultCard(r, msgId));
    } else if (r.type === 'dml') {
      parts.push(`<div class="dml-card">✅ Query executed — ${r.rowcount || 0} row(s) affected · ${r.elapsed_ms}ms</div>`);
    } else if (r.type === 'error') {
      parts.push(buildErrorCard(r.error, data.fix_suggestion, data.generated_sql, msgId));
    }
  }

  // 4. Follow-up suggestions
  parts.push(buildFollowUps(data));

  div.innerHTML = `
    <div class="msg-av av-ai">AI</div>
    <div class="msg-body" style="max-width:92%">${parts.join('')}</div>`;

  t.appendChild(div);

  // Store result state if select
  if (data.db_result?.type === 'select') {
    resultState[msgId] = {
      rows: data.db_result.rows,
      columns: data.db_result.columns,
      page: 1,
      chartType: 'bar',
      chartInst: null,
    };
    renderTablePage(msgId);

    // Auto-chart
    if (STATE.settings.autoChart && canChart(data.db_result.rows)) {
      toggleChart(msgId, true);
    }
  }

  scrollThread();
}

function buildSQLCard(sql, msgId) {
  return `<div class="sql-card">
    <div class="sql-head">
      <span class="sql-lang-tag">
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
        SQL
      </span>
      <div class="sql-head-btns">
        <button class="sql-hbtn" onclick="copySql(this,'${msgId}')">📋 Copy</button>
       ${CURRENT_USER?.permissions?.custom_sql ? `<button class="sql-hbtn" onclick="openSqlEdit('${msgId}')">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button class="sql-hbtn" onclick="rerunSql('${msgId}')">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Run
        </button>` : ''}
        <button class="sql-hbtn" onclick="rerunSql('${msgId}')">▶ Run</button>
      </div>
    </div>
    <pre class="sql-code-block" id="sqlBlock_${msgId}">${highlightSQL(sql)}</pre>
  </div>`;
}

function buildResultCard(r, msgId) {
  const cols = r.columns;
  const colOptions = cols.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('');
  return `<div class="result-card" id="resultCard_${msgId}">
    <div class="result-head">
      <div class="result-stats">
        <span class="rs-item"><b id="rowLabel_${msgId}">${r.row_count}</b> rows</span>
        <span class="rs-sep"></span>
        <span class="rs-item"><b>${r.elapsed_ms}ms</b></span>
        <span class="rs-sep"></span>
        <span class="rs-item">${r.columns.length} cols</span>
      </div>
      <div class="result-actions">
        <button class="ra-btn" id="chartBtn_${msgId}" onclick="toggleChart('${msgId}')">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          Chart
        </button>
        ${CURRENT_USER?.permissions?.export ? `
        <button class="ra-btn" onclick="exportCSV('${msgId}')">⬇ CSV</button>
        <button class="ra-btn" onclick="exportJSON('${msgId}')">⬇ JSON</button>
        <button class="ra-btn" onclick="exportExcel('${msgId}')">⬇ Excel</button>` : ''}
      </div>
    </div>
    <div id="tblWrap_${msgId}"></div>
    <div id="paginationWrap_${msgId}"></div>

    <!-- CHART ZONE -->
    <div id="chartZone_${msgId}" style="display:none" class="chart-zone">

      <!-- Toolbar row 1: chart type + actions -->
      <div class="chart-toolbar">
        <div class="chart-type-bar">
          <button class="ct-btn active" data-type="bar"      onclick="switchChart('${msgId}','bar',this)">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Bar
          </button>
          <button class="ct-btn" data-type="line"     onclick="switchChart('${msgId}','line',this)">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 19 9 5 6 12 2 12"/></svg>
            Line
          </button>
          <button class="ct-btn" data-type="area"     onclick="switchChart('${msgId}','area',this)">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 19 9 5 6 12 2 12"/><path d="M2 12v8h20v-8"/></svg>
            Area
          </button>
          <button class="ct-btn" data-type="pie"      onclick="switchChart('${msgId}','pie',this)">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
            Pie
          </button>
          <button class="ct-btn" data-type="doughnut" onclick="switchChart('${msgId}','doughnut',this)">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
            Donut
          </button>
        </div>
        <div class="chart-actions">
          <button class="ca-btn" onclick="downloadChart('${msgId}')" title="Download PNG">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            PNG
          </button>
          <button class="ca-btn" onclick="openFullscreen('${msgId}')" title="Fullscreen">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            Fullscreen
          </button>
        </div>
      </div>

      <!-- Toolbar row 2: axis selectors -->
      <div class="axis-selectors">
        <div class="axis-group">
          <label class="axis-label">X Axis</label>
          <select class="axis-select" id="xAxis_${msgId}" onchange="renderChart('${msgId}', getCurrentChartType('${msgId}'))">
            ${colOptions}
          </select>
        </div>
        <div class="axis-group">
          <label class="axis-label">Y Axis</label>
          <select class="axis-select" id="yAxis_${msgId}" onchange="renderChart('${msgId}', getCurrentChartType('${msgId}'))">
            ${colOptions}
          </select>
        </div>
      </div>

      <!-- Canvas -->
      <div class="chart-canvas-wrap" id="chartWrap_${msgId}">
        <canvas id="chart_${msgId}"></canvas>
      </div>

    </div>
  </div>`;
}

function buildErrorCard(error, fixSuggestion, originalSql, msgId) {
  let fixHtml = '';
  if (fixSuggestion) {
    const fixSql = extractRawSql(fixSuggestion);
    const fixExplanation = fixSuggestion.replace(/```[\s\S]*?```/g,'').trim();
    fixHtml = `
      <div class="ec-fix">${escHtml(fixExplanation)}</div>
      ${fixSql ? `<div class="ec-fix-sql">${escHtml(fixSql)}</div>
      <button class="apply-fix-btn" onclick="applyFix('${msgId}','${escAttr(fixSql)}')">
        ▶ Apply Fix & Run
      </button>` : ''}`;
  }
  return `<div class="error-card">
    <div class="ec-title">⚠ Query Error</div>
    <div class="ec-msg">${escHtml(error)}</div>
    ${fixHtml}
  </div>`;
}

function buildFollowUps(data) {
  const suggestions = generateFollowUps(data);
  if (!suggestions.length) return '';
  return `<div class="followup-row">
    <span style="font-size:11px;color:var(--t3);margin-top:2px">Follow-up:</span>
    ${suggestions.map(s=>`<div class="fu-pill" onclick="quickAsk('${escAttr(s)}')">${escHtml(s)}</div>`).join('')}
  </div>`;
}

function generateFollowUps(data) {
  const pills = [];
  if (data.db_result?.type === 'select' && data.db_result.row_count > 0) {
    pills.push('Sort by the first column descending');
    if (data.db_result.row_count > 10) pills.push(`Show only the top 10`);
    pills.push('Export this as CSV');
  } else if (data.db_result?.type === 'error') {
    pills.push('Try a simpler version of this query');
    pills.push('Show the table structure instead');
  }
  return pills.slice(0, 3);
}

// ── THINKING ──────────────────────────────────────────
function showThinking() {
  const id = 'thinking_' + Date.now();
  const t  = document.getElementById('thread');
  const div = document.createElement('div');
  div.id = id; div.className = 'thinking-row';
  div.innerHTML = `
    <div class="msg-av av-ai">AI</div>
    <div class="thinking-bubble">
      <div class="dots"><span></span><span></span><span></span></div>
    </div>`;
  t.appendChild(div);
  scrollThread();
  return id;
}
function hideThinking(id) {
  document.getElementById(id)?.remove();
}

function renderErrorBubble(msg) {
  const t = document.getElementById('thread');
  const div = document.createElement('div');
  div.className = 'msg-row';
  div.innerHTML = `
    <div class="msg-av av-ai">AI</div>
    <div class="msg-body">
      <div class="error-card">
        <div class="ec-title">⚠ Error</div>
        <div class="ec-msg">${escHtml(msg)}</div>
      </div>
    </div>`;
  t.appendChild(div);
  scrollThread();
}

// ── TABLE PAGINATION ──────────────────────────────────
function renderTablePage(msgId) {
  const rs = resultState[msgId]; if (!rs) return;
  const { rows, columns, page } = rs;
  const perPage  = STATE.settings.rowsPerPage;
  const total    = rows.length;
  const start    = (page - 1) * perPage;
  const pageRows = rows.slice(start, start + perPage);
  const totalPages = Math.ceil(total / perPage);

  // Table
  let html = `<div class="tbl-wrap"><table class="data-tbl">
    <thead><tr>${columns.map(c=>`<th>${escHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>`;
  pageRows.forEach(row => {
    html += '<tr>' + columns.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return `<td><span class="null-val">NULL</span></td>`;
      return `<td>${escHtml(String(v))}</td>`;
    }).join('') + '</tr>';
  });
  html += '</tbody></table></div>';
  document.getElementById('tblWrap_' + msgId).innerHTML = html;

  // Pagination
  let pg = '';
  if (totalPages > 1) {
    pg = `<div class="tbl-pagination">
      <button class="pg-btn" onclick="changePage('${msgId}',${page-1})" ${page<=1?'disabled':''}>← Prev</button>
      <span>Page ${page} of ${totalPages} · ${total} rows</span>
      <button class="pg-btn" onclick="changePage('${msgId}',${page+1})" ${page>=totalPages?'disabled':''}>Next →</button>
    </div>`;
  } else {
    pg = `<div class="tbl-pagination"><span>${total} row${total===1?'':'s'}</span></div>`;
  }
  document.getElementById('paginationWrap_' + msgId).innerHTML = pg;
}

function changePage(msgId, page) {
  if (!resultState[msgId]) return;
  const total = resultState[msgId].rows.length;
  const perPage = STATE.settings.rowsPerPage;
  const maxPage = Math.ceil(total / perPage);
  if (page < 1 || page > maxPage) return;
  resultState[msgId].page = page;
  renderTablePage(msgId);
  scrollThread();
}

// ── CHART ─────────────────────────────────────────────
function canChart(rows) {
  if (!rows?.length) return false;
  const keys = Object.keys(rows[0]);
  return keys.some(k => !isNaN(Number(rows[0][k])));
}

function toggleChart(msgId, forceShow) {
  const zone = document.getElementById('chartZone_' + msgId);
  const btn  = document.getElementById('chartBtn_'  + msgId);
  if (!zone) return;
  const showing = zone.style.display !== 'none';
  if (forceShow === true || !showing) {
    zone.style.display = 'block';
    btn?.classList.add('active');
    // Auto-pick best X/Y columns
    autoSelectAxes(msgId);
    renderChart(msgId, resultState[msgId]?.chartType || 'bar');
  } else {
    zone.style.display = 'none';
    btn?.classList.remove('active');
  }
  scrollThread();
}

function autoSelectAxes(msgId) {
  const rs = resultState[msgId]; if (!rs) return;
  const cols = rs.columns;
  const xSel = document.getElementById('xAxis_' + msgId);
  const ySel = document.getElementById('yAxis_' + msgId);
  if (!xSel || !ySel) return;

  // Find first text column for X, first numeric column for Y
  const numericCols = cols.filter(c => rs.rows.length && !isNaN(Number(rs.rows[0][c])) && rs.rows[0][c] !== null);
  const textCols    = cols.filter(c => !numericCols.includes(c));

  xSel.value = textCols[0]    || cols[0];
  ySel.value = numericCols[0] || cols[1] || cols[0];
}

function getCurrentChartType(msgId) {
  return resultState[msgId]?.chartType || 'bar';
}

function switchChart(msgId, type, btn) {
  if (!resultState[msgId]) return;
  resultState[msgId].chartType = type;
  document.querySelectorAll(`#chartZone_${msgId} .ct-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderChart(msgId, type);
}

function renderChart(msgId, type) {
  const rs = resultState[msgId]; if (!rs?.rows?.length) return;
  const canvas = document.getElementById('chart_' + msgId); if (!canvas) return;
  if (rs.chartInst) { rs.chartInst.destroy(); rs.chartInst = null; }

  // Get selected axes
  const xSel = document.getElementById('xAxis_' + msgId);
  const ySel = document.getElementById('yAxis_' + msgId);
  const labelKey = xSel ? xSel.value : rs.columns[0];
  const valueKey = ySel ? ySel.value : (rs.columns.find((k,i) => i>0 && !isNaN(Number(rs.rows[0][k]))) || rs.columns[1] || rs.columns[0]);

  const labels = rs.rows.map(r => String(r[labelKey] ?? ''));
  const values = rs.rows.map(r => Number(r[valueKey]) || 0);

  const isPie  = type === 'pie' || type === 'doughnut';
  const isArea = type === 'area';
  const chartType = isArea ? 'line' : type;

  const ctx  = canvas.getContext('2d');

  // Gradient for bar/area
  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(0,229,176,.75)');
  grad.addColorStop(1, 'rgba(0,229,176,.05)');

  // Area fill gradient
  const areaGrad = ctx.createLinearGradient(0, 0, 0, 280);
  areaGrad.addColorStop(0, 'rgba(0,229,176,.35)');
  areaGrad.addColorStop(1, 'rgba(0,229,176,.01)');

  const PIE_COLORS = [
    '#00e5b0','#00b8ff','#7b61ff','#ff6b9d',
    '#ffb347','#4ecdc4','#45b7d1','#96ceb4',
    '#ffeaa7','#fd79a8','#a29bfe','#55efc4'
  ];

  rs.chartInst = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label: valueKey,
        data: values,
        backgroundColor: isPie ? PIE_COLORS : isArea ? areaGrad : grad,
        borderColor: isPie ? 'rgba(5,8,16,.6)' : '#00e5b0',
        borderWidth: isPie ? 2 : 2,
        borderRadius: chartType === 'bar' ? 8 : 0,
        borderSkipped: false,
        tension: .42,
        fill: isArea ? true : false,
        pointBackgroundColor: '#00e5b0',
        pointBorderColor: '#050810',
        pointBorderWidth: 2,
        pointRadius: (chartType === 'line' || isArea) ? 4 : 0,
        pointHoverRadius: (chartType === 'line' || isArea) ? 7 : 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: isPie,
          labels: {
            color: '#8494b8',
            font: { size: 12, family: 'Figtree' },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 10,
          },
        },
        tooltip: {
          backgroundColor: '#0d1220',
          borderColor: 'rgba(0,229,176,.25)',
          borderWidth: 1,
          titleColor: '#f0f4ff',
          bodyColor: '#8494b8',
          padding: 14,
          cornerRadius: 10,
          titleFont: { family: 'Figtree', weight: '700', size: 13 },
          bodyFont:  { family: 'Figtree', size: 12 },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y ?? ctx.parsed}`
          }
        },
      },
      scales: !isPie ? {
        y: {
          beginAtZero: true,
          grid:   { color: 'rgba(0,229,176,.06)', drawBorder: false },
          border: { display: false, dash: [4,4] },
          ticks:  { color: '#3a4a6a', font: { size: 11, family: 'Figtree' }, padding: 8 },
        },
        x: {
          grid:   { display: false },
          border: { display: false },
          ticks:  { color: '#3a4a6a', font: { size: 11, family: 'Figtree' }, maxRotation: 40, padding: 6 },
        },
      } : {},
    },
  });

  // Store chart type
  resultState[msgId].chartType = type;
}

// ── CHART EXTRAS ──────────────────────────────────────
function downloadChart(msgId) {
  const canvas = document.getElementById('chart_' + msgId);
  if (!canvas) return;

  // Create white-bg version for download
  const offscreen = document.createElement('canvas');
  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;
  const ctx = offscreen.getContext('2d');
  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);
  ctx.drawImage(canvas, 0, 0);

  const a = document.createElement('a');
  a.href     = offscreen.toDataURL('image/png');
  a.download = `chart_${msgId}.png`;
  a.click();
}

function openFullscreen(msgId) {
  const rs = resultState[msgId]; if (!rs) return;

  // Create fullscreen overlay
  const overlay = document.createElement('div');
  overlay.id        = 'fsOverlay';
  overlay.className = 'fs-overlay';
  overlay.innerHTML = `
    <div class="fs-box">
      <div class="fs-head">
        <div class="fs-title">Chart — ${rs.columns.join(', ')}</div>
        <div class="fs-actions">
          <button class="ca-btn" onclick="downloadChartFs('${msgId}')">⬇ PNG</button>
          <button class="ca-btn danger" onclick="closeFullscreen()">✕ Close</button>
        </div>
      </div>
      <div class="chart-type-bar" style="padding:0 20px 14px">
        <button class="ct-btn active" onclick="switchFsChart('${msgId}','bar',this)">Bar</button>
        <button class="ct-btn" onclick="switchFsChart('${msgId}','line',this)">Line</button>
        <button class="ct-btn" onclick="switchFsChart('${msgId}','area',this)">Area</button>
        <button class="ct-btn" onclick="switchFsChart('${msgId}','pie',this)">Pie</button>
        <button class="ct-btn" onclick="switchFsChart('${msgId}','doughnut',this)">Donut</button>
      </div>
      <div class="fs-canvas-wrap">
        <canvas id="fsCanvas"></canvas>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) closeFullscreen(); };

  // Render chart in fullscreen canvas
  renderFsChart(msgId, rs.chartType || 'bar');
}

let _fsChartInst = null;

function renderFsChart(msgId, type) {
  const rs = resultState[msgId]; if (!rs?.rows?.length) return;
  const canvas = document.getElementById('fsCanvas'); if (!canvas) return;
  if (_fsChartInst) { _fsChartInst.destroy(); _fsChartInst = null; }

  const xSel = document.getElementById('xAxis_' + msgId);
  const ySel = document.getElementById('yAxis_' + msgId);
  const labelKey = xSel ? xSel.value : rs.columns[0];
  const valueKey = ySel ? ySel.value : rs.columns[1] || rs.columns[0];

  const labels   = rs.rows.map(r => String(r[labelKey] ?? ''));
  const values   = rs.rows.map(r => Number(r[valueKey]) || 0);
  const isPie    = type === 'pie' || type === 'doughnut';
  const isArea   = type === 'area';
  const chartType= isArea ? 'line' : type;

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 420);
  grad.addColorStop(0, 'rgba(0,229,176,.75)');
  grad.addColorStop(1, 'rgba(0,229,176,.05)');

  const PIE_COLORS = ['#00e5b0','#00b8ff','#7b61ff','#ff6b9d','#ffb347','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7','#fd79a8'];

  _fsChartInst = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label: valueKey,
        data: values,
        backgroundColor: isPie ? PIE_COLORS : grad,
        borderColor: isPie ? 'rgba(5,8,16,.6)' : '#00e5b0',
        borderWidth: 2,
        borderRadius: chartType === 'bar' ? 10 : 0,
        tension: .42,
        fill: isArea,
        pointBackgroundColor: '#00e5b0',
        pointBorderColor: '#050810',
        pointBorderWidth: 2,
        pointRadius: (chartType === 'line' || isArea) ? 5 : 0,
        pointHoverRadius: 8,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: isPie, labels: { color: '#8494b8', font: { size: 13, family: 'Figtree' }, padding: 20 }},
        tooltip: {
          backgroundColor: '#0d1220', borderColor: 'rgba(0,229,176,.25)', borderWidth: 1,
          titleColor: '#f0f4ff', bodyColor: '#8494b8', padding: 16, cornerRadius: 12,
          titleFont: { family: 'Figtree', weight: '700', size: 14 },
          bodyFont:  { family: 'Figtree', size: 13 },
        },
      },
      scales: !isPie ? {
        y: { beginAtZero: true, grid: { color: 'rgba(0,229,176,.06)' }, border: { display: false }, ticks: { color: '#3a4a6a', font: { size: 12, family: 'Figtree' } }},
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#3a4a6a', font: { size: 12, family: 'Figtree' }, maxRotation: 40 }},
      } : {},
    },
  });
}

function switchFsChart(msgId, type, btn) {
  document.querySelectorAll('#fsOverlay .ct-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFsChart(msgId, type);
}

function downloadChartFs(msgId) {
  const canvas = document.getElementById('fsCanvas'); if (!canvas) return;
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(canvas, 0, 0);
  const a = document.createElement('a');
  a.href = off.toDataURL('image/png');
  a.download = `chart_fullscreen_${msgId}.png`;
  a.click();
}

function closeFullscreen() {
  if (_fsChartInst) { _fsChartInst.destroy(); _fsChartInst = null; }
  document.getElementById('fsOverlay')?.remove();
}

// ── SQL EDIT / RE-RUN ─────────────────────────────────
let editMsgId = null;

function openSqlEdit(msgId) {
  editMsgId = msgId;
  const block = document.getElementById('sqlBlock_' + msgId);
  const rawSql = block ? block.innerText : '';
  document.getElementById('sqlEditArea').value = rawSql;
  document.getElementById('sqlEditError').style.display = 'none';
  document.getElementById('sqlEditModal').style.display = 'flex';
}

function closeSqlEdit() {
  document.getElementById('sqlEditModal').style.display = 'none';
  editMsgId = null;
}

async function runEditedSql() {
  const sql = document.getElementById('sqlEditArea').value.trim();
  if (!sql) return;
  const errEl = document.getElementById('sqlEditError');
  errEl.style.display = 'none';

  try {
    const res  = await fetch('/api/run_sql', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({sql})
    });
    const data = await res.json();
    closeSqlEdit();
    // Update the SQL block display
    if (editMsgId) {
      const block = document.getElementById('sqlBlock_' + editMsgId);
      if (block) block.innerHTML = highlightSQL(sql);
    }
    // Show new results
    if (data.type === 'select' && editMsgId) {
      resultState[editMsgId] = { rows: data.rows, columns: data.columns, page: 1, chartType: 'bar', chartInst: null };
      renderTablePage(editMsgId);
    } else if (data.type === 'error') {
      errEl.textContent = data.error; errEl.style.display = 'block';
      return;
    }
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  }
}

async function rerunSql(msgId) {
  const block = document.getElementById('sqlBlock_' + msgId);
  if (!block) return;
  const sql = block.innerText.trim();
  const btn = block.closest('.sql-card')?.querySelector('.sql-hbtn:last-child');
  if (btn) { btn.textContent = '⏳ Running…'; btn.disabled = true; }
  try {
    const res  = await fetch('/api/run_sql', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({sql})
    });
    const data = await res.json();
    if (data.type === 'select') {
      resultState[msgId] = { rows: data.rows, columns: data.columns, page: 1, chartType: 'bar', chartInst: null };
      renderTablePage(msgId);
    }
  } catch(e) {} finally {
    if (btn) { btn.textContent = '▶ Run'; btn.disabled = false; }
  }
}

async function applyFix(msgId, fixSql) {
  const res  = await fetch('/api/run_sql', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sql: fixSql})
  });
  const data = await res.json();
  if (data.type === 'select') {
    resultState[msgId] = { rows: data.rows, columns: data.columns, page: 1, chartType: 'bar', chartInst: null };
    // Append new result card to existing message
    const msgBody = document.querySelector(`#${msgId === 'undefined' ? '' : ''}[id]`);
    alert(`Fix applied — ${data.row_count} row(s) returned. Check the result above.`);
  } else if (data.type === 'error') {
    alert('Fix also failed: ' + data.error);
  }
}

// ── COPY SQL ──────────────────────────────────────────
function copySql(btn, msgId) {
  const block = document.getElementById('sqlBlock_' + msgId);
  if (!block) return;
  navigator.clipboard.writeText(block.innerText).then(() => {
    btn.textContent = '✓ Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

// ── EXPORT ────────────────────────────────────────────
function exportCSV(msgId) {
  const rs = resultState[msgId]; if (!rs?.rows?.length) return;
  logClientActivity('export', `CSV export — ${rs.rows.length} rows`);
  const cols = rs.columns;
  let csv = cols.join(',') + '\n';
  rs.rows.forEach(row => {
    csv += cols.map(c => `"${String(row[c]??'').replace(/"/g,'""')}"`).join(',') + '\n';
  });
  dlFile(csv, 'result.csv', 'text/csv');
}

function exportJSON(msgId) {
  const rs = resultState[msgId]; if (!rs?.rows?.length) return;
  logClientActivity('export', `JSON export — ${rs.rows.length} rows`);
  dlFile(JSON.stringify(rs.rows, null, 2), 'result.json', 'application/json');
}

function exportExcel(msgId) {
  const rs = resultState[msgId]; if (!rs?.rows?.length) return;
  logClientActivity('export', `Excel export — ${rs.rows.length} rows`);
  const cols = rs.columns;
  let tsv = cols.join('\t') + '\n';
  rs.rows.forEach(row => { tsv += cols.map(c => row[c]??'').join('\t') + '\n'; });
  dlFile(tsv, 'result.xls', 'application/vnd.ms-excel');
}

function dlFile(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
}

// ── VOICE MODAL ───────────────────────────────────────
let _voiceRec = null;
let _selectedLang = 'en-IN';
let _selectedLangLabel = 'English (India)';

function startVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window))
    return alert('Voice input is only supported in Chrome or Edge browser.');
  document.getElementById('voiceStep1').style.display = 'block';
  document.getElementById('voiceStep2').style.display = 'none';
  document.getElementById('voiceModal').style.display = 'flex';
}

function closeVoiceModal() {
  stopVoice();
  document.getElementById('voiceModal').style.display = 'none';
}

function selectLang(langCode, langLabel) {
  _selectedLang      = langCode;
  _selectedLangLabel = langLabel;
  document.querySelectorAll('.vm-lang-btn').forEach(b => b.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  setTimeout(() => startListening(), 180);
}

function startListening() {
  document.getElementById('voiceStep1').style.display = 'none';
  document.getElementById('voiceStep2').style.display = 'block';
  document.getElementById('vmLangActive').textContent = _selectedLangLabel;
  document.getElementById('vmStatus').textContent     = 'Listening…';
  document.getElementById('vmInterim').textContent    = '';
  document.getElementById('vmBars').classList.remove('paused');

  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  _voiceRec = new Rec();
  _voiceRec.lang            = _selectedLang;
  _voiceRec.continuous      = true;
  _voiceRec.interimResults  = true;
  _voiceRec.maxAlternatives = 1;

  _voiceRec.onstart = () => {
    document.getElementById('voiceBtn').classList.add('recording');
    document.getElementById('vmBars').classList.remove('paused');
    document.getElementById('vmStatus').textContent = 'Listening…';
  };

  _voiceRec.onresult = (e) => {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final  += e.results[i][0].transcript + ' ';
      else                      interim += e.results[i][0].transcript;
    }
    document.getElementById('vmInterim').textContent = interim || final.trim();
    if (final.trim()) {
      const ta = document.getElementById('mainInput');
      ta.value = (ta.value + ' ' + final).trim();
      autoResize(ta);
      document.getElementById('vmStatus').textContent = 'Got it! ✓';
      document.getElementById('vmBars').classList.add('paused');
      setTimeout(() => closeVoiceModal(), 700);
    }
  };

  _voiceRec.onerror = (e) => {
    const msgs = { 'not-allowed': 'Microphone access denied', 'no-speech': 'No speech detected', 'network': 'Network error' };
    document.getElementById('vmStatus').textContent = msgs[e.error] || 'Error occurred';
    document.getElementById('vmBars').classList.add('paused');
    document.getElementById('voiceBtn').classList.remove('recording');
  };

  _voiceRec.onend = () => {
    document.getElementById('voiceBtn').classList.remove('recording');
    const s = document.getElementById('vmStatus');
    if (s && s.textContent === 'Listening…') {
      s.textContent = 'Stopped';
      document.getElementById('vmBars').classList.add('paused');
    }
  };

  try { _voiceRec.start(); }
  catch(e) { document.getElementById('vmStatus').textContent = 'Could not start microphone'; }
}

function stopVoice() {
  if (_voiceRec) { try { _voiceRec.stop(); } catch(e) {} _voiceRec = null; }
  document.getElementById('voiceBtn').classList.remove('recording');
}
// ── CONTEXT ───────────────────────────────────────────
function updateContextDisplay(question) {
  // Extract possible table references
  const tables = Object.keys(STATE.schema);
  const mentioned = tables.filter(t => question.toLowerCase().includes(t.toLowerCase()));
  if (!mentioned.length) return;
  const ctx = mentioned.slice(0,3).join(', ');
  document.getElementById('contextText').textContent = `Context: ${ctx}`;
  document.getElementById('contextDisplay').style.display = 'flex';

  // Update context tags
  const tagsEl = document.getElementById('ctxTags');
  tagsEl.innerHTML = `<span class="ctx-label-hint">Context:</span>` +
    mentioned.map(t=>`<span class="ctx-tag-item">${escHtml(t)}<span class="ctx-tag-x" onclick="this.parentElement.remove()">✕</span></span>`).join('');
}

function clearContext() {
  document.getElementById('contextDisplay').style.display = 'none';
  document.getElementById('ctxTags').innerHTML = '';
}

// ── SIDEBAR / LAYOUT ──────────────────────────────────
function toggleSidebar() {
  STATE.sidebarOpen = !STATE.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('collapsed', !STATE.sidebarOpen);
}

// ── KEYBOARD ──────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ── HELPERS ───────────────────────────────────────────
function scrollThread() {
  const t = document.getElementById('thread');
  requestAnimationFrame(() => { t.scrollTop = t.scrollHeight; });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/\n/g,'<br>');
}

function escAttr(str) {
  return String(str).replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

function extractRawSql(text) {
  const m = text.match(/```(?:sql)?\s*([\s\S]+?)```/i);
  return m ? m[1].trim() : '';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return Math.floor(diff/86400000) + 'd ago';
}

// ── SQL SYNTAX HIGHLIGHT ──────────────────────────────
function highlightSQL(sql) {
  const keywords = ['SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','OUTER','FULL',
    'ON','GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET','INSERT','INTO','VALUES',
    'UPDATE','SET','DELETE','CREATE','TABLE','DROP','ALTER','ADD','COLUMN',
    'AND','OR','NOT','IN','EXISTS','BETWEEN','LIKE','IS','NULL','AS','WITH',
    'UNION','ALL','DISTINCT','COUNT','SUM','AVG','MIN','MAX','ROUND','COALESCE',
    'CASE','WHEN','THEN','ELSE','END','BY','ASC','DESC','PRIMARY','KEY',
    'REFERENCES','FOREIGN','DEFAULT','CONSTRAINT','INDEX'];

  let out = escHtml(sql);

  // Comments
  out = out.replace(/(--[^\n]*)/g, '<span class="cmt">$1</span>');

  // Keywords (word boundary)
  const kwPat = new RegExp(`\\b(${keywords.join('|')})\\b`, 'gi');
  out = out.replace(kwPat, m => `<span class="kw">${m.toUpperCase()}</span>`);

  // String literals
  out = out.replace(/'([^']*)'/g, "<span class=\"val\">'$1'</span>");

  // Numbers
  out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="val">$1</span>');

  return out;
}
// ── USER MANAGER ──────────────────────────────────────
async function openUserManager() {
  document.getElementById('userDropdown').style.display = 'none';
  document.getElementById('userManagerModal').style.display = 'flex';
  await loadUsers();
}

function closeUserManager() {
  document.getElementById('userManagerModal').style.display = 'none';
}

async function loadUsers() {
  const wrap = document.getElementById('umTableWrap');
  wrap.innerHTML = '<div style="color:var(--t3);font-size:13px;padding:12px 0">Loading…</div>';
  try {
    const res   = await fetch('/api/users');
    const users = await res.json();
    if (!res.ok) { wrap.innerHTML = `<div style="color:var(--red);font-size:13px">${users.error}</div>`; return; }

    const roleIcons = { admin:'👑', manager:'📊', analyst:'🔍', viewer:'👁' };
    wrap.innerHTML = `
      <div style="overflow-x:auto">
      <table class="um-table">
        <thead><tr>
          <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${users.map(u => `
          <tr id="urow_${u.id}">
            <td style="color:var(--t1);font-weight:600">${escHtml(u.name)}</td>
            <td>${escHtml(u.email)}</td>
            <td><span class="um-role-badge ${u.role}">${roleIcons[u.role]||''} ${u.role}</span></td>
            <td><span class="um-status-badge ${u.is_active?'active':'inactive'}">${u.is_active?'Active':'Inactive'}</span></td>
            <td>
              <button class="um-action-btn" onclick="editUser(${u.id},'${escAttr(u.name)}','${escAttr(u.email)}','${u.role}',${u.is_active})">Edit</button>
              <button class="um-action-btn danger" onclick="deleteUser(${u.id},'${escAttr(u.name)}')">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(e) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px">Failed to load users</div>`;
  }
}

async function addUser() {
  const name  = document.getElementById('umName').value.trim();
  const email = document.getElementById('umEmail').value.trim();
  const pass  = document.getElementById('umPassword').value.trim();
  const role  = document.getElementById('umRole').value;
  const errEl = document.getElementById('umAddError');
  errEl.style.display = 'none';
  if (!name || !email || !pass) { errEl.textContent = 'All fields are required'; errEl.style.display='block'; return; }
  try {
    const res  = await fetch('/api/users', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, email, password: pass, role })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; errEl.style.display='block'; return; }
    document.getElementById('umName').value = '';
    document.getElementById('umEmail').value = '';
    document.getElementById('umPassword').value = '';
    await loadUsers();
  } catch(e) { errEl.textContent = e.message; errEl.style.display='block'; }
}

function editUser(id, name, email, role, isActive) {
  const newName   = prompt('Name:', name);             if (newName === null) return;
  const newRole   = prompt('Role (admin/manager/analyst/viewer):', role); if (newRole === null) return;
  const newStatus = prompt('Active? (1 = yes, 0 = no):', isActive ? '1' : '0'); if (newStatus === null) return;
  const newPass   = prompt('New password (leave blank to keep current):', '');  if (newPass === null) return;

  const payload = { name: newName, role: newRole, is_active: parseInt(newStatus) };
  if (newPass.trim()) payload.password = newPass.trim();

  fetch(`/api/users/${id}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  }).then(r => r.json()).then(d => {
    if (d.success) loadUsers();
    else alert('Error: ' + d.error);
  });
}

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
  try {
    const res  = await fetch(`/api/users/${id}`, { method:'DELETE' });
    const data = await res.json();
    if (!res.ok) { alert('Error: ' + data.error); return; }
    await loadUsers();
  } catch(e) { alert('Error: ' + e.message); }
}