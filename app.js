// 天南海北：Supabase 專案 tiannanhaibei的連線資料（publishable key 是公開用的，可以放在這裡；絕對不要放 secret key）
const SUPABASE_URL = 'https://gkqmxdmywcfpttrbgfig.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1NGnx5BbQkV3dCmQZLcPJg_eI4zSNyF';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// 功能開關：在 Supabase 的 settings 表格改 enabled 即可，不用改程式。讀不到時用下面的預設值
let SW = { signup: true, login: true, posting: true, chat: false, video: false };
async function loadSwitches()  {
  const { data } = await db.from('settings').select('key,enabled');
  (data || []).forEach(r => { SW[r.key] = r.enabled; });
}
const CATS = ['新聞','文化','社會','生活','花園','種植','栽培','釣魚','美食','寵物','旅遊','旅居','親子','健康','教育','房產','職場','汽車','攝影','影視','體育','小說'];
const ST = { draft: '草稿', private: '僅自己可見', public: '公開' };
let user = null, tab = 'blog', cat = '全部', openId = null, chan = null;
let mineOn = false, mineTab = 'draft', editId = null, statsEl = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nick = () => user?.user_metadata?.nickname || user?.email.split('@')[0];
const fail = e => alert(/switch_off/.test(e.message) ? '這個功能暫未開放，敬請期待' : /blocked/.test(e.message) ? '內容含不允許的用語（辱罵或敏感詞），已被自動攔截' : /banned/.test(e.message) ? '你的帳號已被封鎖' : e.message);

(async () => {
  await loadSwitches();
  db.rpc('hit_site').then(() => {});
  user = (await db.auth.getSession()).data.session?.user || null;
  if (!SW.login && user) { await db.auth.signOut(); user = null; }
  db.auth.onAuthStateChange((_, s) => { user = s?.user || null; render(); showStats(); });
  render();
})();

function go(k) { tab = k; openId = null; mineOn = false; editId = null; render(); }
function authBox() {
  if (!SW.login) return alert('網站暫未開放登入，敬請期待');
  $('#am').textContent = '';
  $('#dlg button[onclick="signUp()"]').hidden = !SW.signup;
  $('#dlg').showModal();
}
async function signUp() {
  if (!SW.signup) return;
  const { error } = await db.auth.signUp({ email: $('#em').value, password: $('#pw').value,
    options: { data: { nickname: $('#nk').value.trim() || $('#em').value.split('@')[0] } } });
  $('#am').textContent = error ? error.message : '註冊成功，請到信箱點確認連結，再回來登入';
}
async function signIn() {
  const { error } = await db.auth.signInWithPassword({ email: $('#em').value, password: $('#pw').value });
  if (error) $('#am').textContent = error.message; else $('#dlg').close();
}

function render() {
  $('#who').innerHTML = user ? `${esc(nick())} <button onclick="db.auth.signOut()">登出</button>` : (SW.login ? `<button onclick="authBox()">登入／註冊</button>` : `<span class="meta" style="color:#fff">暫未開放登入</span>`);
  $('#nav').innerHTML = [['blog','博客'],['forum','論壇'],['chat','聊天']].map(([k, v]) => `<button class="${tab === k ? 'on' : ''}" onclick="go('${k}')">${v}</button>`).join('');
  if (tab === 'chat') chatView(); else if (openId) detail(); else listView();
}

// 文章表單（新文章和編輯共用）
function formHTML(p = {}) {
  return `<select id="pc">${CATS.map(c => `<option${c === p.category ? ' selected' : ''}>${c}</option>`).join('')}</select>
  <input id="pt" placeholder="標題" value="${esc(p.title || '')}"><textarea id="pb" rows="10" placeholder="貼上或撰寫文章內容">${esc(p.body || '')}</textarea>
  <label><input type="checkbox" id="own" style="width:auto;margin-right:8px">我確認內容為原創，或已獲授權；如有侵權，責任由我自己承擔</label>
  <p><select id="pv"><option value="public">公開（全站可見）</option><option value="private">僅自己可見</option></select>
  <button class="btn" onclick="savePost('draft')">存草稿</button> <button class="btn" onclick="savePost()">發表</button></p>`;
}

async function listView() {
  if (mineOn) return mineView();
  editId = null;
  let q = db.from('posts').select('id,title,category,author_name').eq('kind', tab).eq('status', 'public').order('created_at', { ascending: false }).limit(50);
  if (cat !== '全部') q = q.eq('category', cat);
  const data = (await q).data || [];
  $('#app').innerHTML = `<div class="cats">${['全部', ...CATS].map(c => `<button class="${c === cat ? 'on' : ''}" onclick="cat='${c}';render()">${c}</button>`).join('')}</div>
  <div class="card"><button class="btn" onclick="$('#np').hidden=!$('#np').hidden">${tab === 'blog' ? '寫博客' : '發文章'}</button> <button class="btn" onclick="openMine()">我的文章</button>
  <div id="np" hidden style="margin-top:10px">${formHTML()}</div></div>
  <div class="card">${data.map(p => `<div class="row" onclick="openId=${p.id};render()"><b>${esc(p.title)}</b><span>${esc(p.category)} · ${esc(p.author_name)}</span></div>`).join('') || '<p class="meta">還沒有內容，發第一篇吧</p>'}</div>`;
}

function openMine() { if (!user) return authBox(); mineOn = true; editId = null; render(); }

async function savePost(mode) {
  if (!SW.posting) return alert('發文功能暫未開放，敬請期待');
  if (!user) return authBox();
  const title = $('#pt').value.trim(), body = $('#pb').value.trim();
  const status = mode === 'draft' ? 'draft' : $('#pv').value;
  if (!title) return alert('請填寫標題');
  if (status !== 'draft' && !body) return alert('請填寫內容');
  if (status !== 'draft' && !$('#own').checked) return alert('請先確認內容為原創或已獲授權');
  const f = { category: $('#pc').value, title, body, status };
  const { error } = editId
    ? await db.from('posts').update(f).eq('id', editId)
    : await db.from('posts').insert({ ...f, kind: tab, author_id: user.id, author_name: nick() });
  if (error) return fail(error);
  editId = null; mineOn = true; mineTab = status; render();
}

// 刪除自己的文章（fromMine = true 表示從「我的文章」列表刪）
async function delPost(id, fromMine) {
  if (!user) return authBox();
  if (!confirm('確定刪除這篇文章？刪除後無法恢復，文章的回覆和譯文也會一起刪除。')) return;
  const { data, error } = await db.from('posts').delete().eq('id', id).eq('author_id', user.id).select('id');
  if (error) return fail(error);
  if (!data || !data.length) return alert('刪除失敗：沒有權限或文章已不存在');
  editId = null;
  if (fromMine) { mineOn = true; } else { openId = null; mineOn = false; }
  render();
}

async function mineView() {
  if (!user) { mineOn = false; return listView(); }
  const { data } = await db.from('posts').select('id,kind,title,category,status').eq('author_id', user.id).order('created_at', { ascending: false });
  const vm = {};
  ((await db.rpc('my_post_views')).data || []).forEach(r => { vm[r.id] = r.views; });
  const all = data || [], rows = all.filter(p => p.status === mineTab);
  $('#app').innerHTML = `<div class="card"><button class="btn" onclick="mineOn=false;editId=null;render()">返回列表</button>
  <h2>我的文章</h2><div class="cats">${Object.keys(ST).map(k => `<button class="${k === mineTab ? 'on' : ''}" onclick="mineTab='${k}';editId=null;render()">${ST[k]} (${all.filter(p => p.status === k).length})</button>`).join('')}</div></div>
  <div id="ef"></div>
  <div class="card">${rows.map(p => `<div class="row"><b style="cursor:pointer" onclick="openId=${p.id};mineOn=false;render()">${esc(p.title)}</b><span>${p.kind === 'blog' ? '博客' : '論壇'} · ${esc(p.category)}${p.status === 'public' ? ' · ' + (vm[p.id] || 0) + ' 次瀏覽' : ''}</span> <button class="btn" onclick="editPost(${p.id})">編輯</button> <button class="btn" onclick="delPost(${p.id},true)">刪除</button></div>`).join('') || '<p class="meta">這裡還沒有文章</p>'}</div>`;
}

async function editPost(id) {
  const { data: p } = await db.from('posts').select('id,category,title,body,status').eq('id', id).single();
  if (!p) return;
  editId = id;
  $('#ef').innerHTML = `<div class="card"><h3>編輯文章</h3>${formHTML(p)}<p><button class="btn" onclick="editId=null;$('#ef').innerHTML=''">取消</button></p></div>`;
  $('#pv').value = p.status === 'private' ? 'private' : 'public';
  $('#own').checked = p.status !== 'draft';
  $('#ef').scrollIntoView({ behavior: 'smooth' });
}
async function startEdit(id, st) { openId = null; mineOn = true; mineTab = st; editId = null; await mineView(); editPost(id); }

async function detail() {
  const { data: p } = await db.from('posts').select('id,kind,category,title,body,author_id,author_name,status,created_at,updated_at').eq('id', openId).single();
  const rs = (await db.from('replies').select('*').eq('post_id', openId).order('created_at')).data || [];
  if (!p) { openId = null; return render(); }
  const mine = !!user && p.author_id === user.id;
  try { // 同一個瀏覽器、同一次瀏覽只算一次；作者自己看不計
    const seen = JSON.parse(sessionStorage.getItem('seen') || '[]');
    if (!mine && p.status === 'public' && !seen.includes(p.id)) { seen.push(p.id); sessionStorage.setItem('seen', JSON.stringify(seen)); db.rpc('bump_view', { pid: p.id }); }
  } catch (e) {}
  const extra = (p.updated_at ? ' · 已編輯 ' + new Date(p.updated_at).toLocaleDateString() : '') + (p.status !== 'public' ? ' · ' + ST[p.status] : '');
  $('#app').innerHTML = `<div class="card"><button class="btn" onclick="openId=null;render()">返回列表</button>${mine ? ` <button class="btn" onclick="startEdit(${p.id},'${p.status}')">編輯</button> <button class="btn" onclick="delPost(${p.id})">刪除</button>` : ''}
  <h2>${esc(p.title)}</h2><div class="meta">${esc(p.category)} · ${esc(p.author_name)}${extra}</div><p class="body">${esc(p.body)}</p>
  <h3>${rs.length} 則回覆</h3>${rs.map(r => `<p><b>${esc(r.author_name)}</b><br><span class="body">${esc(r.body)}</span></p>`).join('')}
  ${p.status === 'public' ? '<textarea id="rb" rows="3" placeholder="寫下你的回覆"></textarea><button class="btn" onclick="reply()">發表回覆</button>' : ''}</div>`;
}
async function reply() {
  if (!user) return authBox();
  const body = $('#rb').value.trim(); if (!body) return;
  const { error } = await db.from('replies').insert({ post_id: openId, body, author_id: user.id, author_name: nick() });
  if (error) fail(error); else render();
}

const linkify = t => esc(t).replace(/https:\/\/meet\.jit\.si\/qiaoju-[A-Za-z0-9]+/g, u => `<a href="${u}" target="_blank" rel="noopener">加入視頻</a>`);
const bub = m => `<p><b>${esc(m.author_name)}</b>　${linkify(m.body)}</p>`;
async function chatView() {
  if (!SW.chat) { $('#app').innerHTML = '<div class="card"><h2>聊天</h2><p>聊天功能暫未開放，敬請期待。</p></div>'; return; }
  const m = ((await db.from('messages').select('*').eq('room', 'lobby').order('created_at', { ascending: false }).limit(50)).data || []).reverse();
  $('#app').innerHTML = `<div class="card"><h2>大家在此聊天</h2>${SW.video ? '<p><button class="btn" onclick="startVideo()">開視頻房間</button></p>' : ''}<div id="msgs">${m.map(bub).join('')}</div>
  <div class="send"><input id="cm" placeholder="輸入訊息" onkeydown="if(event.key==='Enter')send()"><button class="btn" onclick="send()">發送</button></div></div>`;
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
  if (!chan) chan = db.channel('lobby').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
    const b = $('#msgs'); if (tab === 'chat' && b) { b.insertAdjacentHTML('beforeend', bub(p.new)); b.scrollTop = b.scrollHeight; }
  }).subscribe();
}
async function send() {
  if (!user) return authBox();
  const body = $('#cm').value.trim(); if (!body) return;
  const { error } = await db.from('messages').insert({ body, author_id: user.id, author_name: nick() });
  if (error) fail(error); else $('#cm').value = '';
}

async function startVideo() {
  if (!user) return authBox();
  const url = 'https://meet.jit.si/qiaoju-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const { error } = await db.from('messages').insert({ body: '邀請大家視頻：' + url, author_id: user.id, author_name: nick() });
  if (error) return fail(error);
  window.open(url, '_blank', 'noopener');
}
// 全站統計：只有站長帳號看得到（資料庫端也會擋）
async function showStats() {
  if (statsEl) { statsEl.remove(); statsEl = null; }
  if (!user) return;
  try {
    const { data: ok } = await db.rpc('is_admin');
    if (!ok) return;
    const { data } = await db.rpc('admin_stats');
    if (!data) return;
    statsEl = document.createElement('div');
    statsEl.style.cssText = 'text-align:center;color:#888;font-size:13px;padding:12px';
    statsEl.textContent = '今日訪問 ' + data.today + ' ｜ 累計訪問 ' + data.total + ' ｜ 文章 ' + data.posts;
    document.body.appendChild(statsEl);
  } catch (e) {}
}
(() => {
  const EN = {
    '天南海北':'tiannanhaibei','博客':'Blog','論壇':'Forum','聊天':'Chat',
    '登入 / 註冊':'Log in / Sign up','登入／註冊':'Log in / Sign up','登入':'Log in','註冊':'Sign up','登出':'Log out',
    '全部':'All','新聞':'News','文化':'Culture','社會':'Society','生活':'Life','花園':'Garden','種植':'Planting','栽培':'Growing',
    '釣魚':'Fishing','美食':'Food','寵物':'Pets','旅遊':'Travel','旅居':'Living Abroad','親子':'Parenting','健康':'Health',
    '教育':'Education','房產':'Real Estate','職場':'Careers','汽車':'Cars','攝影':'Photography','影視':'Film & TV','體育':'Sports','小說':'Fiction',
    '寫博客':'Write a blog','故事動畫':'Story Animator','奇門遁甲':'Qimen Divination','命盤解讀':'Fortune-Telling','中醫養生':'Chinese Medicine Wellness','住宿':'Stays','發表回覆':'Post reply','發表':'Publish','發送':'Send','取消':'Cancel','關閉':'Close',
    '大家在此聊天':'Chat with everyone','開視頻房間':'Start video room','輸入訊息':'Type a message',
    '信箱':'Email','密碼':'Password','暱稱':'Nickname','標題':'Title','內容':'Content','分類':'Category','回覆':'Replies','返回':'Back',
    '返回列表':'Back to list','存草稿':'Save draft','我的文章':'My posts','編輯':'Edit','刪除':'Delete','草稿':'Draft','公開':'Public','僅自己可見':'Only me','公開（全站可見）':'Public (everyone)'
  };
  let lang = 'zh';
  try { lang = localStorage.getItem('lang') || 'zh'; } catch (e) {}
  const orig = new WeakMap();
  const tr = s => {
    const t = s.trim(); if (!t) return s;
    if (EN[t]) return s.replace(t, EN[t]);
    let m = t.match(/^(.+?) · (.+?) · (\d+) 次瀏覽$/);
    if (m) return s.replace(t, (EN[m[1]] || m[1]) + ' · ' + m[2] + ' · ' + m[3] + ' views');
    m = t.match(/^(.+?) · (.+)$/);
    if (m && EN[m[1]]) return s.replace(t, EN[m[1]] + ' · ' + m[2]);
    m = t.match(/^今日訪問 (\d+)\s*[|｜]\s*累計訪問 (\d+)\s*[|｜]\s*文章 (\d+)$/);
    if (m) return s.replace(t, 'Today ' + m[1] + ' | Total ' + m[2] + ' | Posts ' + m[3]);
    if (t.indexOf('版權投訴與廣告合作') === 0) return s.replace('版權投訴與廣告合作：', 'Copyright complaints & advertising: ').replace('版權投訴與廣告合作:', 'Copyright complaints & advertising: ');
    return s;
  };
  function walk() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA') continue;
      if (lang === 'en') {
        if (!orig.has(n)) { const r = tr(n.nodeValue); if (r !== n.nodeValue) { orig.set(n, n.nodeValue); n.nodeValue = r; } }
      } else if (orig.has(n)) { n.nodeValue = orig.get(n); orig.delete(n); }
    }
    document.querySelectorAll('[placeholder]').forEach(el => {
      if (lang === 'en') {
        if (!el.dataset.zh && EN[el.placeholder]) { el.dataset.zh = el.placeholder; el.placeholder = EN[el.placeholder]; }
      } else if (el.dataset.zh) { el.placeholder = el.dataset.zh; delete el.dataset.zh; }
    });
  }
  const obs = new MutationObserver(() => { obs.disconnect(); walk(); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); });
  const btn = document.createElement('button');
  btn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;padding:6px 12px;border:0;border-radius:16px;background:#2f6f73;color:#fff;font-size:13px;cursor:pointer;opacity:.9';
  const label = () => { btn.textContent = lang === 'en' ? '中 / EN' : '中 / EN'; btn.title = lang === 'en' ? '切換為中文' : 'Switch to English'; };
  btn.onclick = () => {
    lang = lang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem('lang', lang); } catch (e) {}
    location.reload ();
  };
  document.body.appendChild(btn); label();
  walk(); obs.observe(document.body, { childList: true, subtree: true, characterData: true });
})();
(() => {
  let stayOn = false;
  const KINDS = ['酒店', '民宿', '短租公寓', '出租屋（長租）'];
  const _go = go, _render = render, _lv = listView, _cv = chatView, _dt = detail;
  go = k => { stayOn = false; _go(k); };
  listView = (...a) => stayOn ? undefined : _lv(...a);
  chatView = (...a) => stayOn ? undefined : _cv(...a);
  detail = (...a) => stayOn ? undefined : _dt(...a);
  render = () => {
    _render();
    const nav = $('#nav');
    if (nav) {
      if (stayOn) nav.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      const b = document.createElement('button');
      b.textContent = '住宿';
      b.className = stayOn ? 'on' : '';
      b.onclick = () => { stayOn = true; openId = null; render(); };
      nav.appendChild(b);
    }
    if (stayOn) stayView();
  };
  const gm = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

  async function stayView(q = {}) {
    $('#app').innerHTML = '<div class="card"><h2>住宿與租房</h2>'
      + '<input id="sc" placeholder="城市（例如：Tbilisi、曼谷、悉尼）" value="' + esc(q.city || '') + '"> '
      + '<select id="sk"><option value="">全部類型</option>'
      + KINDS.map(k => '<option' + (q.kind === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select> '
      + '<button class="btn" id="sgo">搜索</button> <button class="btn" id="snew">發布房源</button>'
      + '<p><small>聯絡方式、附近超市和餐館由房東自己填寫，請直接聯繫房東，線下付款。</small></p></div><div id="slist"></div>';
    $('#sgo').onclick = () => stayView({ city: $('#sc').value.trim(), kind: $('#sk').value });
    $('#snew').onclick = stayForm;
    let r = db.from('stays').select('*').order('created_at', { ascending: false }).limit(50);
    if (q.city) r = r.ilike('city', '%' + q.city + '%');
    if (q.kind) r = r.eq('kind', q.kind);
    const { data, error } = await r;
    if (error) { $('#slist').innerHTML = '<div class="card"><small>載入失敗，請稍後再試</small></div>'; return; }
    $('#slist').innerHTML = (data || []).map(s =>
      '<div class="card"><h3>' + esc(s.title) + '</h3>'
      + '<div><small>' + esc(s.kind || '') + ' · ' + esc(s.city) + ' · ' + esc(s.price || '') + ' · ' + esc(s.owner_name || '') + '</small></div>'
      + (s.address ? '<p>地址：' + esc(s.address) + '</p>' : '')
      + (s.nearby_market ? '<p>附近超市：' + esc(s.nearby_market) + '</p>' : '')
      + (s.nearby_food ? '<p>附近餐館：' + esc(s.nearby_food) + '</p>' : '')
      + '<p>' + esc(s.description || '') + '</p>'
      + (s.address ? '<p><small><a target="_blank" rel="noopener" href="' + gm(s.address) + '">地圖位置</a> · '
        + '<a target="_blank" rel="noopener" href="' + gm('restaurants near ' + s.address) + '">周邊餐館</a> · '
        + '<a target="_blank" rel="noopener" href="' + gm('supermarket near ' + s.address) + '">周邊超市</a></small></p>' : '')
      + '<p>聯絡方式：<b>' + esc(s.contact) + '</b></p>'
      + (user && s.owner_id === user.id ? '<button class="btn" data-del="' + s.id + '">刪除我的房源</button>' : '')
      + '</div>').join('') || '<div class="card"><small>暫時沒有房源</small></div>';
    document.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('確定刪除這個房源？')) return;
        const { error } = await db.from('stays').delete().eq('id', b.dataset.del);
        if (error) return fail(error);
        stayView(q);
      };
    });
  }

  function stayForm() {
    if (!user) return authBox();
    if (!SW.posting) return alert('這個功能暫未開放，敬請期待');
    $('#slist').innerHTML = '<div class="card"><h3>發布房源</h3>'
      + '<select id="f_kind">' + KINDS.map(k => '<option>' + k + '</option>').join('') + '</select><br>'
      + '<input id="f_city" placeholder="城市"><br>'
      + '<input id="f_title" placeholder="標題（例如：市中心兩居室）"><br>'
      + '<input id="f_price" placeholder="價格（例如：每晚 40 美元 / 每月 500 美元）"><br>'
      + '<input id="f_addr" placeholder="詳細地址（用於顯示地圖連結）"><br>'
      + '<input id="f_market" placeholder="附近超市（例如：步行 5 分鐘，Carrefour）"><br>'
      + '<input id="f_food" placeholder="附近餐館（例如：步行 3 分鐘，有中餐館）"><br>'
      + '<textarea id="f_desc" rows="4" placeholder="介紹（設施、規則、租期）"></textarea><br>'
      + '<input id="f_contact" placeholder="聯絡方式（微信/WhatsApp/電話/郵箱）"><br>'
      + '<button class="btn" id="f_ok">發布</button></div>';
    $('#f_ok').onclick = async () => {
      const v = id => $(id).value.trim();
      if (!v('#f_city') || !v('#f_title') || !v('#f_contact')) return alert('請填寫城市、標題和聯絡方式');
      const { error } = await db.from('stays').insert({
        owner_id: user.id, owner_name: nick(), kind: v('#f_kind'), city: v('#f_city'), title: v('#f_title'),
        price: v('#f_price'), address: v('#f_addr'), nearby_market: v('#f_market'), nearby_food: v('#f_food'),
        description: v('#f_desc'), contact: v('#f_contact')
      });
      if (error) return fail(error);
      stayView();
    };
  }
})();
// ===== 文章翻譯：按鈕 → 已存譯文 → Cloudflare AI → 額度滿改用 Google 翻譯 =====
(() => {
  const _dt = detail;
  const L = () => { try { return localStorage.getItem('lang') === 'en' ? 'en' : 'zh'; } catch (e) { return 'zh'; } };
  const T = {
    zh: { go: '翻譯', orig: '顯示原文', busy: '翻譯中…', full: '今日 AI 翻譯額度已滿，已改用瀏覽器翻譯' },
    en: { go: 'Translate', orig: 'Show original', busy: 'Translating…', full: "Today's AI translation quota is used up. Switched to browser translation." }
  };
  detail = async (...a) => {
    await _dt(...a);
    const h = document.querySelector('#app h2'), b = document.querySelector('#app p.body');
    const back = document.querySelector('#app .card button.btn');
    if (!h || !b || !back || document.getElementById('trbtn')) return;
    const to = L(), t = T[to];
    const btn = document.createElement('button');
    btn.className = 'btn'; btn.id = 'trbtn'; btn.style.marginLeft = '8px'; btn.textContent = t.go;
    back.after(btn);
    const o = { title: h.textContent, body: b.textContent };
    let shown = false;
    const show = (ti, bo, on) => { h.textContent = ti; b.textContent = bo; shown = on; btn.textContent = on ? t.orig : t.go; };
    btn.onclick = async () => {
      if (shown) return show(o.title, o.body, false);
      btn.textContent = t.busy;
      const id = openId;
      let r = null;
      try { r = (await db.from('translations').select('title,body').eq('post_id', id).eq('lang', to).maybeSingle()).data; } catch (e) {}
      if (!r) {
        try {
          const res = await fetch('/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: o.title, body: o.body, to }) });
          if (!res.ok) throw new Error('quota');
          r = await res.json();
          if (!r.title && !r.body) throw new Error('empty');
          if (user) db.from('translations').insert({ post_id: id, lang: to, title: r.title, body: r.body }).then(() => {});
        } catch (e) { btn.textContent = t.go; alert(t.full); return gtranslate(to); }
      }
      show(r.title, r.body, true);
    };
  };
  function gtranslate(to) {
    const code = to === 'en' ? 'en' : 'zh-TW';
    const pick = () => { const s = document.querySelector('.goog-te-combo'); if (s) { s.value = code; s.dispatchEvent(new Event('change')); } };
    if (window.google && google.translate && google.translate.TranslateElement) return pick();
    let g = document.getElementById('gt');
    if (!g) { g = document.createElement('div'); g.id = 'gt'; g.style.cssText = 'position:absolute;left:-9999px'; document.body.appendChild(g); }
    window.gtInit = () => { new google.translate.TranslateElement({ pageLanguage: 'zh-TW', includedLanguages: 'en,zh-TW', autoDisplay: false }, 'gt'); setTimeout(pick, 800); };
    const s = document.createElement('script'); s.src = 'https://translate.google.com/translate_a/element.js?cb=gtInit'; document.head.appendChild(s);
  }
})();
// ===== 生活欄：健康小常識搜索 =====
(() => {
  const SHOW = ['生活']; // 想讓「健康」分類也有搜索框，改成 ['生活','健康']
  const TIPS = [
    { t: '感冒', k: ['感冒','流鼻涕','鼻塞','打噴嚏','著涼'],
      do: ['多休息，多喝溫水', '鼻塞可用生理鹽水沖洗鼻腔', '喉嚨痛可用淡鹽水漱口', '室內保持空氣流通，不要太乾燥', '感冒多由病毒引起，抗生素沒有用，一般 7 到 10 天會慢慢好轉'],
      go: ['高燒（39°C 以上）或發燒超過 3 天', '呼吸困難、胸痛', '症狀超過 10 天沒好轉，或好轉後又加重', '嬰幼兒、孕婦、老人和有慢性病的人，建議早點看醫生'] },
    { t: '頭痛', k: ['頭痛','頭疼','頭暈','偏頭痛'],
      do: ['在安靜、光線暗的地方休息', '補充水分，規律睡眠，少看螢幕', '緊張性頭痛可以熱敷或輕輕按摩頸肩', '要吃止痛藥請按說明書，不要超量，也不要長期頻繁吃'],
      go: ['突然出現劇烈頭痛，是從沒有過的那種痛', '頭痛同時發燒、脖子僵硬', '意識模糊、說話不清、手腳無力、視力突然改變', '頭部受傷之後的頭痛', '頭痛越來越頻繁或越來越重'] },
    { t: '發燒', k: ['發燒','發熱','高燒','體溫'],
      do: ['多喝水，多休息', '穿輕薄衣物，不要捂汗', '可用溫水擦拭身體（不要用酒精或冰水）', '量體溫並記錄時間'],
      go: ['3 個月以下嬰兒體溫 38°C 以上', '體溫超過 39.5°C，或超過 3 天不退', '抽搐、皮疹、呼吸困難', '精神很差、一直想睡、很難叫醒'] },
    { t: '咳嗽、喉嚨痛', k: ['咳嗽','喉嚨痛','嗓子痛','喉嚨','咳痰'],
      do: ['多喝溫水，避免煙霧和灰塵', '喉嚨痛可用淡鹽水漱口', '1 歲以上可喝一點蜂蜜水緩解咳嗽（1 歲以下不能喝蜂蜜）', '室內保持適當濕度'],
      go: ['咳嗽超過 3 週', '咳血、呼吸急促或喘鳴', '喉嚨痛到吞嚥或呼吸困難', '高燒不退'] },
    { t: '腹瀉、嘔吐', k: ['腹瀉','拉肚子','嘔吐','噁心','胃痛'],
      do: ['少量多次補充水分，最好喝口服補液鹽', '先吃清淡、容易消化的食物', '注意洗手，避免傳染給家人'],
      go: ['大便有血或黑色大便', '高燒', '脫水：口很乾、尿很少、頭暈、哭時沒眼淚', '超過 2 到 3 天沒好轉', '嬰幼兒、老人、孕婦，建議早點就醫'] }
  ];
  const li = a => '<ul style="margin:4px 0 10px;padding-left:20px">' + a.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  const _lv = listView;
  listView = async (...a) => {
    await _lv(...a);
    const cats = document.querySelector('#app .cats');
    if (mineOn || !SHOW.includes(cat) || !cats || document.getElementById('hs')) return;
    const box = document.createElement('div');
    box.className = 'card'; box.id = 'hs';
    box.innerHTML = '<h3 style="margin-top:0">健康小常識搜索</h3>'
      + '<input id="hq" placeholder="輸入症狀，例如：頭疼、感冒、發燒"> <button class="btn" id="hgo">搜索</button>'
      + '<div id="hres"></div>'
      + '<p class="meta">以上為一般生活常識，不能代替醫生診斷。症狀嚴重或持續請就醫；出現胸痛、呼吸困難、意識不清，請立即撥打當地急救電話。</p>';
    cats.after(box);
    const run = async () => {
      const q = document.getElementById('hq').value.trim(), out = document.getElementById('hres');
      if (!q) { out.innerHTML = ''; return; }
      const hit = TIPS.filter(x => x.t.includes(q) || x.k.some(w => q.includes(w) || (q.length > 1 && w.includes(q))));
      let html = hit.map(x => '<div class="card" style="margin:10px 0 0"><h3 style="margin-top:0">' + x.t + '</h3><b>可以這樣做</b>' + li(x.do) + '<b>出現這些情況請就醫</b>' + li(x.go) + '</div>').join('');
      if (!hit.length) html = '<p class="meta">暫時沒有這個症狀的小常識，下面看看社區裡有沒有相關文章。</p>';
      const like = '%' + q.replace(/[%_,()]/g, '') + '%';
      let posts = [];
      try {
        const [r1, r2] = await Promise.all([
          db.from('posts').select('id,title,category,author_name').eq('status', 'public').ilike('title', like).limit(10),
          db.from('posts').select('id,title,category,author_name').eq('status', 'public').ilike('body', like).limit(10)
        ]);
        const seen = {};
        posts = [...(r1.data || []), ...(r2.data || [])].filter(p => !seen[p.id] && (seen[p.id] = 1));
      } catch (e) {}
      html += '<h3>社區相關文章</h3>' + (posts.map(p => '<div class="row" onclick="openId=' + p.id + ';render()"><b>' + esc(p.title) + '</b><span>' + esc(p.category) + ' · ' + esc(p.author_name) + '</span></div>').join('') || '<p class="meta">沒有找到相關文章</p>');
      out.innerHTML = html;
    };
    document.getElementById('hgo').onclick = run;
    document.getElementById('hq').onkeydown = e => { if (e.key === 'Enter') run(); };
  };
})();

// ===== 私信（站內一對一）：貼在 app.js 最後面 =====
// 開關：Supabase settings 表 key = 'dm'，預設關閉
(() => {
  if (!('dm' in SW)) SW.dm = false;
  let peer = null, timer = null, sig = '', first = true, unread = 0, rows = [], lastBadge = 0;

  const dlg = document.createElement('dialog');
  dlg.id = 'dmdlg';
  dlg.style.cssText = 'max-width:560px;width:94%;padding:0;overflow:hidden';
  dlg.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)">'
    + '<button class="btn" id="dmback" style="display:none">返回</button>'
    + '<b id="dmtitle" style="flex:1">私信</b>'
    + '<button class="btn" id="dmblk" style="display:none"></button>'
    + '<button class="btn" id="dmx">關閉</button></div>'
    + '<div id="dmsearch" style="padding:10px 12px;border-bottom:1px solid var(--line)">'
    + '<div class="send" style="margin:0"><input id="dmq" placeholder="輸入對方暱稱，找人發私信"><button class="btn" id="dmfind">搜尋</button></div>'
    + '<div id="dmres"></div></div>'
    + '<div id="dmbody" style="padding:12px;height:50vh;overflow-y:auto"></div>'
    + '<div id="dmft" class="send" style="display:none;padding:10px 12px;border-top:1px solid var(--line);margin:0">'
    + '<input id="dmin" maxlength="2000" placeholder="輸入私信（發出後不能編輯或刪除）"><button class="btn" id="dmsend">發送</button></div>';
  document.body.appendChild(dlg);
  const q = s => dlg.querySelector(s);
  const disp = (el, on, type) => { el.style.display = on ? (type || '') : 'none'; };
  const when = t => new Date(t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const MSG = {
    dm_refused: '對方目前無法接收你的私信',
    dm_unblock_first: '你已封鎖這位用戶，請先解除封鎖',
    dm_too_fast: '發送太快了，請稍後再試',
    dm_self: '不能給自己發私信',
    dm_empty: '請輸入內容'
  };
  const dmFail = e => {
    const k = Object.keys(MSG).find(x => (e.message || '').includes(x));
    if (k) alert(MSG[k]); else fail(e);
  };

  function openDM(p) {
    if (!user) return authBox();
    if (!SW.dm) return alert('私信功能暫未開放，敬請期待');
    peer = p || null; first = true; sig = '';
    if (!dlg.open) dlg.showModal();
    clearInterval(timer); timer = setInterval(refresh, 10000);
    refresh();
    if (p) setTimeout(() => q('#dmin').focus(), 250);
  }
  const refresh = () => (peer ? thread() : list());

  async function list() {
    disp(q('#dmback'), false); disp(q('#dmblk'), false); disp(q('#dmft'), false); disp(q('#dmsearch'), true);
    q('#dmtitle').textContent = '私信';
    const { data, error } = await db.from('dm_messages')
      .select('id,sender_id,recipient_id,sender_name,recipient_name,body,created_at,read_at')
      .or('sender_id.eq.' + user.id + ',recipient_id.eq.' + user.id)
      .order('created_at', { ascending: false }).limit(300);
    if (peer) return;
    if (error) { q('#dmbody').innerHTML = '<p class="meta">載入失敗：' + esc(error.message) + '</p>'; return; }
    const m = new Map();
    (data || []).forEach(r => {
      const mine = r.sender_id === user.id, id = mine ? r.recipient_id : r.sender_id;
      if (!m.has(id)) m.set(id, { id, name: (mine ? r.recipient_name : r.sender_name) || '用戶', last: r.body, at: r.created_at, unread: 0 });
      if (!mine && !r.read_at) m.get(id).unread++;
    });
    rows = [...m.values()];
    const s = JSON.stringify(rows);
    if (s === sig) return;
    sig = s;
    q('#dmbody').innerHTML = rows.map((c, i) =>
      '<div class="row" data-i="' + i + '"><b>' + esc(c.name) + (c.unread ? ' <span style="color:#d33">(' + c.unread + ')</span>' : '') + '</b>'
      + '<span>' + esc(c.last.slice(0, 30)) + ' · ' + when(c.at) + '</span></div>').join('')
      || '<p class="meta">還沒有私信。在上面輸入對方暱稱搜尋，或在文章頁點「私信作者」就可以開始。</p>';
  }

  async function thread() {
    const p = peer, me = user.id;
    q('#dmtitle').textContent = p.name;
    disp(q('#dmback'), true); disp(q('#dmft'), true, 'flex'); disp(q('#dmsearch'), false);
    const [r, b] = await Promise.all([
      db.from('dm_messages').select('id,sender_id,body,created_at,read_at')
        .or('and(sender_id.eq.' + me + ',recipient_id.eq.' + p.id + '),and(sender_id.eq.' + p.id + ',recipient_id.eq.' + me + ')')
        .order('created_at', { ascending: true }).limit(300),
      db.from('dm_blocks').select('blocked_id').eq('blocker_id', me).eq('blocked_id', p.id)
    ]);
    if (p !== peer) return;
    if (r.error) { q('#dmbody').innerHTML = '<p class="meta">載入失敗：' + esc(r.error.message) + '</p>'; return; }
    const blocked = !!(b.data && b.data.length);
    const bb = q('#dmblk');
    disp(bb, true); bb.textContent = blocked ? '解除封鎖' : '封鎖'; bb.dataset.on = blocked ? '1' : '';
    const data = r.data || [];
    const s = data.map(x => x.id).join(',') + '|' + blocked;
    if (s !== sig) {
      sig = s;
      const box = q('#dmbody'), near = first || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = data.map(x => {
        const mine = x.sender_id === me;
        return '<div style="display:flex;justify-content:' + (mine ? 'flex-end' : 'flex-start') + ';margin:6px 0">'
          + '<div style="max-width:80%;background:' + (mine ? 'var(--soft)' : 'var(--bg)') + ';border:1px solid var(--line);border-radius:10px;padding:6px 10px">'
          + '<div class="body">' + esc(x.body) + '</div>'
          + '<div class="meta">' + when(x.created_at) + (mine ? '' : ' · <a href="#" data-rep="' + x.id + '" data-from="' + x.sender_id + '">舉報</a>') + '</div></div></div>';
      }).join('') || '<p class="meta">打個招呼吧</p>';
      if (near) box.scrollTop = box.scrollHeight;
      first = false;
    }
    if (data.some(x => x.sender_id === p.id && !x.read_at)) {
      await db.from('dm_messages').update({ read_at: new Date().toISOString() }).eq('recipient_id', me).eq('sender_id', p.id).is('read_at', null);
      refreshBadge();
    }
  }

  async function report(id, from) {
    const reason = prompt('請簡述舉報原因（可留空）');
    if (reason === null) return;
    const { error } = await db.from('dm_reports').insert({ message_id: id, reporter_id: user.id, reported_id: from, reason: reason.trim().slice(0, 300) });
    if (error) return alert(error.code === '23505' ? '你已經舉報過這則私信了' : error.message);
    alert('已提交，站長會查看');
  }

  async function sendDM() {
    const el = q('#dmin'), body = el.value.trim();
    if (!body || !peer) return;
    const { error } = await db.from('dm_messages').insert({ sender_id: user.id, recipient_id: peer.id, sender_name: nick(), recipient_name: peer.name, body });
    if (error) return dmFail(error);
    el.value = ''; sig = ''; thread();
  }

  async function find() {
    const v = q('#dmq').value.trim(), out = q('#dmres');
    if (v.length < 2) { out.innerHTML = '<p class="meta">請至少輸入 2 個字</p>'; return; }
    const { data, error } = await db.rpc('dm_find_user', { q: v });
    if (error) { out.innerHTML = '<p class="meta">搜尋失敗：' + esc(error.message) + '</p>'; return; }
    out.innerHTML = (data || []).map(u => '<div class="row" data-u="' + u.id + '" data-n="' + esc(u.name) + '"><b>' + esc(u.name) + '</b><span>發私信</span></div>').join('')
      || '<p class="meta">找不到這個暱稱</p>';
  }
  q('#dmfind').onclick = find;
  q('#dmq').onkeydown = e => { if (e.key === 'Enter') find(); };
  q('#dmres').onclick = e => {
    const r = e.target.closest('[data-u]');
    if (!r) return;
    peer = { id: r.dataset.u, name: r.dataset.n }; first = true; sig = '';
    q('#dmres').innerHTML = ''; q('#dmq').value = '';
    refresh();
  };
  q('#dmsend').onclick = sendDM;
  q('#dmin').onkeydown = e => { if (e.key === 'Enter') sendDM(); };
  q('#dmx').onclick = () => dlg.close();
  q('#dmback').onclick = () => { peer = null; sig = ''; refresh(); };
  q('#dmblk').onclick = async () => {
    const on = q('#dmblk').dataset.on === '1';
    if (!on && !confirm('封鎖後，對方無法再給你發私信。確定封鎖？')) return;
    const t = db.from('dm_blocks');
    const { error } = on
      ? await t.delete().eq('blocker_id', user.id).eq('blocked_id', peer.id)
      : await t.insert({ blocker_id: user.id, blocked_id: peer.id });
    if (error) return alert(error.message);
    sig = ''; thread();
  };
  q('#dmbody').onclick = e => {
    const row = e.target.closest('[data-i]');
    if (row) { const c = rows[+row.dataset.i]; peer = { id: c.id, name: c.name }; first = true; sig = ''; return refresh(); }
    const rep = e.target.closest('[data-rep]');
    if (rep) { e.preventDefault(); report(+rep.dataset.rep, rep.dataset.from); }
  };
  dlg.addEventListener('close', () => { clearInterval(timer); peer = null; refreshBadge(); });

  // 未讀數
  async function refreshBadge() {
    lastBadge = Date.now();
    if (!user || !SW.dm) { unread = 0; return; }
    const { count } = await db.from('dm_messages').select('id', { count: 'exact', head: true }).eq('recipient_id', user.id).is('read_at', null);
    unread = count || 0;
    const b = document.getElementById('dmbtn');
    if (b) b.textContent = '私信' + (unread ? ' (' + unread + ')' : '');
  }
  setInterval(refreshBadge, 30000);

  // 頂部「私信」按鈕（登入且開關打開才出現）
  const _render = render;
  render = () => {
    _render();
    const w = $('#who');
    if (w && user && SW.dm) {
      const b = document.createElement('button');
      b.id = 'dmbtn'; b.style.marginRight = '6px';
      b.textContent = '私信' + (unread ? ' (' + unread + ')' : '');
      b.onclick = () => openDM();
      w.insertBefore(b, w.querySelector('button'));
      if (Date.now() - lastBadge > 15000) refreshBadge();
    }
  };

  // 每個作者名字旁邊的「私信」小按鈕：文章頁、每則回覆、文章列表
  const mk = (id, name) => {
    const b = document.createElement('button');
    b.className = 'dmq'; b.textContent = '私信';
    b.style.cssText = 'margin-left:6px;padding:0 8px;font-size:12px;line-height:20px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--brand);cursor:pointer';
    b.onclick = e => { e.stopPropagation(); openDM({ id, name }); };
    return b;
  };
  const me = () => (user ? user.id : null);

  const _dt = detail;
  detail = async (...a) => {
    await _dt(...a);
    if (!SW.dm || document.getElementById('dmpost')) return;
    const id = openId, back = document.querySelector('#app .card button.btn');
    if (!id || !back) return;
    const [pr, rr] = await Promise.all([
      db.from('posts').select('author_id,author_name').eq('id', id).single(),
      db.from('replies').select('author_id,author_name').eq('post_id', id).order('created_at')
    ]);
    if (id !== openId || !document.body.contains(back) || document.getElementById('dmpost')) return;
    const p = pr.data;
    if (p && p.author_id !== me()) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = 'dmpost'; b.style.marginLeft = '8px'; b.textContent = '私信作者';
      b.onclick = () => openDM({ id: p.author_id, name: p.author_name });
      back.after(b);
      const meta = document.querySelector('#app .card .meta');
      if (meta) meta.appendChild(mk(p.author_id, p.author_name));
    }
    const ps = [...document.querySelectorAll('#app .card p')].filter(x => x.children[0] && x.children[0].tagName === 'B' && x.children[1] && x.children[1].tagName === 'BR');
    const rs = rr.data || [];
    if (ps.length === rs.length) ps.forEach((x, k) => { if (rs[k].author_id !== me()) x.children[0].after(mk(rs[k].author_id, rs[k].author_name)); });
  };

  const _lv = listView;
  listView = async (...a) => {
    await _lv(...a);
    if (!SW.dm || mineOn) return;
    const rows = [...document.querySelectorAll('#app .row[onclick]')].filter(r => !r.closest('#hs') && /openId=\d+/.test(r.getAttribute('onclick')));
    if (!rows.length) return;
    const ids = rows.map(r => +r.getAttribute('onclick').match(/openId=(\d+)/)[1]);
    const { data } = await db.from('posts').select('id,author_id,author_name').in('id', ids);
    const by = {};
    (data || []).forEach(x => { by[x.id] = x; });
    rows.forEach((r, k) => {
      const x = by[ids[k]], sp = r.querySelector('span');
      if (x && sp && x.author_id !== me() && !r.querySelector('.dmq') && document.body.contains(r)) sp.appendChild(mk(x.author_id, x.author_name));
    });
  };
})();
// ===== 文章獨立網址：/p/文章編號 =====
(() => {
  const m = location.pathname.match(/^\/p\/(\d+)/);
  if (m) { openId = +m[1]; tab = 'blog'; }
  const _r = render;
  render = () => {
    _r();
    const want = openId && !mineOn ? '/p/' + openId : '/';
    if (location.pathname !== want) history.pushState(null, '', want);
  };
  addEventListener('popstate', () => {
    const k = location.pathname.match(/^\/p\/(\d+)/);
    openId = k ? +k[1] : null; mineOn = false; render();
  });
})();
// ===== 文章內圖片：單獨一行的圖片網址自動顯示 =====
(() => {
  const _dt = detail;
  const IMG = /^https:\/\/\S+\.(?:jpe?g|png|gif|webp)(?:\?\S*)?$/i;
  detail = async (...a) => {
    await _dt(...a);
    const b = document.querySelector('#app p.body');
    if (!b || b.dataset.img) return;
    b.dataset.img = '1';
    const lines = b.textContent.split('\n');
    if (!lines.some(l => IMG.test(l.trim()))) return;
    b.innerHTML = lines.map(l => IMG.test(l.trim())
      ? '<img src="' + esc(l.trim()) + '" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%;height:auto;display:block;margin:8px 0;border-radius:6px" alt="">'
      : esc(l)).join('<br>');
  };
})();
// ===== 文章插入圖片：拍照或相冊上傳 =====
(() => {
  const shrink = file => new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b => b ? res(b) : rej(new Error('壓縮失敗')), 'image/jpeg', 0.8);
    };
    img.onerror = () => rej(new Error('無法讀取圖片'));
    img.src = u;
  });
  const add = () => {
    const ta = document.getElementById('pb');
    if (!ta || document.getElementById('imgup')) return;
    const w = document.createElement('div');
    w.id = 'imgup';
    w.innerHTML = '<label class="btn" style="display:inline-block;cursor:pointer;margin:6px 0">插入圖片<input type="file" accept="image/*" hidden></label> <label class="btn" style="display:inline-block;cursor:pointer;margin:6px 0">拍照<input type="file" accept="image/*" capture="environment" hidden></label> <span class="meta"></span>';

    ta.after(w);
    const msg = w.querySelector('span');
    const onPick = async inp => {
      const f = inp.files[0]; inp.value = '';

      if (!f) return;
      if (!user) return authBox();
      msg.textContent = '上傳中…';
      try {
        const blob = await shrink(f);
        const path = user.id + '/' + Date.now() + '.jpg';
        const { error } = await db.storage.from('post-images').upload(path, blob, { contentType: 'image/jpeg' });
        if (error) throw error;
        const url = db.storage.from('post-images').getPublicUrl(path).data.publicUrl;
        const pos = ta.selectionStart ?? ta.value.length;
        const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
        ta.value = before + (before && !before.endsWith('\n') ? '\n' : '') + url + '\n' + after;
        msg.textContent = '已插入';
      } catch (e) { msg.textContent = '上傳失敗：' + (e.message || e); }
    };
    w.querySelectorAll('input').forEach(i => { i.onchange = () => onPick(i); });
  };
  new MutationObserver(add).observe(document.body, { childList: true, subtree: true });
})();
// ===== 防丟稿：寫到一半自動暫存（拍照後頁面被手機重新載入，文字也能恢復）=====
(() => {
  const K = 'draft_v1';
  const get = () => { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) { return null; } };
  const put = v => { try { if (v) localStorage.setItem(K, JSON.stringify(v)); else localStorage.removeItem(K); } catch (e) {} };
  const save = () => {
    if (editId) return;
    const t = $('#pt'), b = $('#pb'), c = $('#pc');
    if (!t || !b) return;
    put(t.value || b.value ? { t: t.value, b: b.value, c: c ? c.value : '' } : null);
  };
  document.addEventListener('input', save);
  document.addEventListener('change', save);
  const restore = () => {
    const t = $('#pt'), b = $('#pb');
    if (!t || !b || b.dataset.rs || editId) return;
    b.dataset.rs = '1';
    const d = get();
    if (!d || t.value || b.value) return;
    t.value = d.t || ''; b.value = d.b || '';
    const c = $('#pc'); if (c && d.c) c.value = d.c;
    const np = $('#np'); if (np) np.hidden = false;
  };
  new MutationObserver(restore).observe(document.body, { childList: true, subtree: true });
  restore();
  const _sp = savePost;
  savePost = async (...a) => { await _sp(...a); if (mineOn) put(null); };
})();
// ===== 頁面內相機：不離開網頁直接拍照（避免手機切到相機 App 時把網頁關掉）=====
(() => {
  const dlg = document.createElement('dialog');
  dlg.style.cssText = 'max-width:560px;width:96%;padding:10px;text-align:center';
  dlg.innerHTML = '<video id="camv" playsinline autoplay muted style="width:100%;max-height:60vh;background:#000;border-radius:8px"></video>'
    + '<p style="margin:8px 0"><button class="btn" id="camshot">拍照</button> <button class="btn" id="camx">取消</button></p>';
  document.body.appendChild(dlg);
  const v = dlg.querySelector('#camv');
  let stream = null;
  const stop = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; v.srcObject = null; };
  const close = () => { stop(); if (dlg.open) dlg.close(); };
  dlg.querySelector('#camx').onclick = close;
  dlg.addEventListener('close', stop);
  dlg.querySelector('#camshot').onclick = () => {
    if (!v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => {
      close();
      if (!b) return alert('拍照失敗，請再試一次');
      const inp = document.querySelector('#imgup input:not([capture])');
      if (!inp) return;
      const dt = new DataTransfer();
      dt.items.add(new File([b], 'camera.jpg', { type: 'image/jpeg' }));
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change'));
    }, 'image/jpeg', 0.9);
  };
  async function openCam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert('這個瀏覽器不支援網頁內拍照，請先用手機相機拍好，再點「插入圖片」選取');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      v.srcObject = stream;
      dlg.showModal();
      v.play().catch(() => {});
    } catch (e) {
      alert('無法開啟相機（請允許網站使用相機）。也可以先用手機相機拍好，再點「插入圖片」選取');
    }
  }
  const attach = () => {
    const inp = document.querySelector('#imgup input[capture]');
    if (!inp || inp.dataset.cam) return;
    inp.dataset.cam = '1';
    inp.addEventListener('click', e => { e.preventDefault(); openCam(); });
  };
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  attach();
})();
// ===== 文章內視頻：單獨一行的 YouTube 連結（或 mp4 直連）自動變成播放器 =====
(() => {
  const _dt = detail;
  const YT = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&?#]\S*)?$/i;
  const MP4 = /^https:\/\/\S+\.(?:mp4|webm|mov)(?:\?\S*)?$/i;
  const player = line => {
    const y = line.match(YT);
    if (y) {
      const d = document.createElement('div');
      d.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;margin:8px 0;background:#000;border-radius:6px;overflow:hidden';
      d.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + y[1] + '" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>';
      return d;
    }
    if (MP4.test(line)) {
      const v = document.createElement('video');
      v.src = line; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      v.style.cssText = 'max-width:100%;display:block;margin:8px 0;border-radius:6px';
      return v;
    }
    return null;
  };
  detail = async (...a) => {
    await _dt(...a);
    const b = document.querySelector('#app p.body');
    if (!b || b.dataset.vid) return;
    b.dataset.vid = '1';
    const nodes = [], w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    nodes.forEach(t => {
      const lines = t.nodeValue.split('\n');
      if (!lines.some(l => player(l.trim()))) return;
      const f = document.createDocumentFragment();
      lines.forEach((l, i) => {
        const p = player(l.trim());
        if (p) f.appendChild(p); else if (l) f.appendChild(document.createTextNode(l + (i < lines.length - 1 ? '\n' : '')));
        else if (i < lines.length - 1) f.appendChild(document.createTextNode('\n'));
      });
      t.replaceWith(f);
    });
  };
})();
// ===== 手機上傳視頻（開關：Supabase settings 表 key = 'vidup'，預設關閉）=====
(() => {
  if (!('vidup' in SW)) SW.vidup = false;
  const MAX = 50 * 1024 * 1024; // 與 Supabase 免費版單檔上限一致
  const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
  const add = () => {
    const w = document.getElementById('imgup');
    if (!w || !SW.vidup || document.getElementById('vidbtn')) return;
    const lab = document.createElement('label');
    lab.id = 'vidbtn'; lab.className = 'btn';
    lab.style.cssText = 'display:inline-block;cursor:pointer;margin:6px 0 6px 6px';
    lab.innerHTML = '上傳視頻<input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" hidden>';
    w.insertBefore(lab, w.querySelector('span'));
    const msg = w.querySelector('span'), inp = lab.querySelector('input');
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      if (!user) return authBox();
      const ext = EXT[f.type] || (/\.(mp4|webm|mov)$/i.test(f.name) ? f.name.split('.').pop().toLowerCase() : '');
      if (!ext) { msg.textContent = '只支援 mp4、webm、mov 格式'; return; }
      if (f.size > MAX) { msg.textContent = '視頻太大（' + Math.round(f.size / 1048576) + 'MB），上限 50MB，請先壓縮或剪短'; return; }
      msg.textContent = '視頻上傳中，請不要離開頁面…';
      try {
        const path = user.id + '/' + Date.now() + '.' + ext;
        const { error } = await db.storage.from('post-videos').upload(path, f, { contentType: EXT[f.type] ? f.type : 'video/' + ext });
        if (error) throw error;
        const url = db.storage.from('post-videos').getPublicUrl(path).data.publicUrl;
        const ta = document.getElementById('pb');
        if (!ta) { msg.textContent = '上傳完成，但找不到輸入框'; return; }
        const pos = ta.selectionStart ?? ta.value.length;
        const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
        ta.value = before + (before && !before.endsWith('\n') ? '\n' : '') + url + '\n' + after;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        msg.textContent = '視頻已插入';
      } catch (e) { msg.textContent = '上傳失敗：' + (e.message || e); }
    };
  };
  new MutationObserver(add).observe(document.body, { childList: true, subtree: true });
  add();
})();
