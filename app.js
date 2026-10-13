// 僑聚網：Supabase 專案 qiaoju 的連線資料（publishable key 是公開用的，可以放在這裡；絕對不要放 secret key）
const SUPABASE_URL = 'https://gkqmxdmywcfpttrbgfig.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1NGnx5BbQkV3dCmQZLcPJg_eI4zSNyF';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// 功能開關：在 Supabase 的 settings 表格改 enabled 即可，不用改程式。讀不到時用下面的預設值
let SW = { signup: true, login: true, posting: true, chat: false, video: false };
async function loadSwitches() 
  const { data } = await db.from('settings').select('key,enabled');
  (data || []).forEach(r => { SW[r.key] = r.enabled; });
}
const CATS = ['新聞','文化','社會','生活','花園','種植','栽培','釣魚','美食','寵物','旅遊','旅居','親子','健康','教育','房產','職場','汽車','攝影','影視','體育','小說'];
let user = null, tab = 'blog', cat = '全部', openId = null, chan = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nick = () => user?.user_metadata?.nickname || user?.email.split('@')[0];
const fail = e => alert(/switch_off/.test(e.message) ? '這個功能暫未開放，敬請期待' : /blocked/.test(e.message) ? '內容含不允許的用語（辱罵或敏感詞），已被自動攔截' : /banned/.test(e.message) ? '你的帳號已被封鎖' : e.message);

(async () => {
  await loadSwitches();
  try { if (!sessionStorage.getItem('hit')) { sessionStorage.setItem('hit', '1'); db.rpc('hit_site'); } } catch (e) {}
  user = (await db.auth.getSession()).data.session?.user || null;
  if (!SW.login && user) { await db.auth.signOut(); user = null; }
  db.auth.onAuthStateChange((_, s) => { user = s?.user || null; render(); });
  render();
})();

function go(k) { tab = k; openId = null; render(); }
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

async function listView() {
  let q = db.from('posts').select('id,title,category,author_name,views').eq('kind', tab).order('created_at', { ascending: false }).limit(50);
  if (cat !== '全部') q = q.eq('category', cat);
  const data = (await q).data || [];
  $('#app').innerHTML = `<div class="cats">${['全部', ...CATS].map(c => `<button class="${c === cat ? 'on' : ''}" onclick="cat='${c}';render()">${c}</button>`).join('')}</div>
  <div class="card"><button class="btn" onclick="$('#np').hidden=!$('#np').hidden">${tab === 'blog' ? '寫博客' : '發文章'}</button>
  <div id="np" hidden style="margin-top:10px"><select id="pc">${CATS.map(c => `<option>${c}</option>`).join('')}</select>
  <input id="pt" placeholder="標題"><textarea id="pb" rows="10" placeholder="貼上或撰寫文章內容"></textarea>
  <label><input type="checkbox" id="own" style="width:auto;margin-right:8px">我確認內容為原創，或已獲授權；如有侵權，責任由我自己承擔</label>
  <p><button class="btn" onclick="newPost()">發表</button></p></div></div>
  <div class="card">${data.map(p => `<div class="row" onclick="openId=${p.id};render()"><b>${esc(p.title)}</b><span>${esc(p.category)} · ${esc(p.author_name)} · ${p.views || 0} 次瀏覽</span></div>`).join('') || '<p class="meta">還沒有內容，發第一篇吧</p>'}</div>`;
}

async function newPost() {
  if (!SW.posting) return alert('發文功能暫未開放，敬請期待');
  if (!user) return authBox();
  const title = $('#pt').value.trim(), body = $('#pb').value.trim();
  if (!title || !body) return alert('請填寫標題和內容');
  if (!$('#own').checked) return alert('請先確認內容為原創或已獲授權');
  const { error } = await db.from('posts').insert({ kind: tab, category: $('#pc').value, title, body, author_id: user.id, author_name: nick() });
  if (error) fail(error); else render();
}

async function detail() {
  const { data: p } = await db.from('posts').select('*').eq('id', openId).single();
  const rs = (await db.from('replies').select('*').eq('post_id', openId).order('created_at')).data || [];
  if (!p) { openId = null; return render(); }
  try { // 同一個瀏覽器、同一次瀏覽只算一次
    const seen = JSON.parse(sessionStorage.getItem('seen') || '[]');
    if (!seen.includes(p.id)) { seen.push(p.id); sessionStorage.setItem('seen', JSON.stringify(seen)); db.rpc('view_post', { pid: p.id }); p.views = (p.views || 0) + 1; }
  } catch (e) {}
  $('#app').innerHTML = `<div class="card"><button class="btn" onclick="openId=null;render()">返回列表</button>
  <h2>${esc(p.title)}</h2><div class="meta">${esc(p.category)} · ${esc(p.author_name)} · ${p.views || 0} 次瀏覽</div><p class="body">${esc(p.body)}</p>
  <h3>${rs.length} 則回覆</h3>${rs.map(r => `<p><b>${esc(r.author_name)}</b><br><span class="body">${esc(r.body)}</span></p>`).join('')}
  <textarea id="rb" rows="3" placeholder="寫下你的回覆"></textarea><button class="btn" onclick="reply()">發表回覆</button></div>`;
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
(async () => {
  try {
    await new Promise(r => setTimeout(r, 1500));
    const { data } = await db.rpc('site_stats');
    if (!data) return;
    const d = document.createElement('div');
    d.style.cssText = 'text-align:center;color:#888;font-size:13px;padding:12px';
    d.textContent = '今日訪問 ' + data.today + ' ｜ 累計訪問 ' + data.total + ' ｜ 文章 ' + data.posts;
    document.body.appendChild(d);
  } catch (e) {}
})();
