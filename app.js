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
    '酒店':'Hotel','民宿':'Homestay','短租公寓':'Short-term apartment','出租屋（長租）':'Room / house for rent (long-term)',
    '發布':'Post','聯絡方式（微信/WhatsApp/電話/郵箱）':'Contact (WeChat/WhatsApp/phone/email)',
    '城市（例如：Tbilisi、曼谷、悉尼）':'City (e.g. Tbilisi, Bangkok, Sydney)','城市（例如: Tbilisi、曼谷、悉尼）':'City (e.g. Tbilisi, Bangkok, Sydney)',
'城市(例如：Tbilisi、曼谷、悉尼)':'City (e.g. Tbilisi, Bangkok, Sydney)','城市(例如: Tbilisi、曼谷、悉尼)':'City (e.g. Tbilisi, Bangkok, Sydney)',
'電子信箱':'Email','密碼（至少 6 位）':'Password (at least 6 characters)','暱稱（註冊時填寫）':'Nickname (for sign-up)',
'註冊即表示你已閱讀並同意':'By signing up you agree to the ','隱私政策':'Privacy Policy','。':'.',
'發文章':'Write a post','還沒有內容，發第一篇吧':'Nothing here yet. Be the first to post.',

    '住宿與租房':'Stays & Rentals','全部類型':'All types','搜索':'Search','發布房源':'Post a listing',
'聯絡方式、附近超市和餐館由房東自己填寫，請直接聯繫房東，線下付款。':'Contact details and nearby shops and restaurants are filled in by the host. Please contact the host directly and pay offline.',
'暫時沒有房源':'No listings yet',
    '天南海北':'tiannanhaibei','博客':'Blog','論壇':'Forum','聊天':'Chat',
    '登入 / 註冊':'Log in / Sign up','登入／註冊':'Log in / Sign up','登入':'Log in','註冊':'Sign up','登出':'Log out',
    '全部':'All','新聞':'News','文化':'Culture','社會':'Society','生活':'Life','花園':'Garden','種植':'Planting','栽培':'Growing',
    '釣魚':'Fishing','美食':'Food','寵物':'Pets','旅遊':'Travel','旅居':'Living Abroad','親子':'Parenting','健康':'Health',
    '教育':'Education','房產':'Real Estate','職場':'Careers','汽車':'Cars','攝影':'Photography','影視':'Film & TV','體育':'Sports','小說':'Fiction',
    '寫博客':'Write a blog','故事動畫':'Story Animator','奇門遁甲':'Qimen Divination','命盤解讀':'Fortune-Telling','中醫養生':'Chinese Medicine Wellness','詩詞笑話':'Poetry & Jokes','音樂編曲':'Music Composer','中西料理':'Cooking','住宿':'Stays','發表回覆':'Post reply','發表':'Publish','發送':'Send','取消':'Cancel','關閉':'Close',
    '大家在此聊天':'Chat with everyone','開視頻房間':'Start video room','輸入訊息':'Type a message',
    '信箱':'Email','密碼':'Password','暱稱':'Nickname','標題':'Title','內容':'Content','分類':'Category','回覆':'Replies','返回':'Back',
    '返回列表':'Back to list','存草稿':'Save draft','我的文章':'My posts','編輯':'Edit','刪除':'Delete','草稿':'Draft','公開':'Public','僅自己可見':'Only me','公開（全站可見）':'Public (everyone)'
  };

  const VI_E = {
    'Hotel':'Khách sạn','Homestay':'Nhà dân (homestay)','Short-term apartment':'Căn hộ ngắn hạn','Room / house for rent (long-term)':'Phòng / nhà cho thuê (dài hạn)',
    'Post':'Đăng','Contact (WeChat/WhatsApp/phone/email)':'Liên hệ (WeChat/WhatsApp/điện thoại/email)',
    'City (e.g. Tbilisi, Bangkok, Sydney)':'Thành phố (ví dụ: Tbilisi, Bangkok, Sydney)',
    'Email':'Email','Password (at least 6 characters)':'Mật khẩu (ít nhất 6 ký tự)','Nickname (for sign-up)':'Biệt danh (điền khi đăng ký)',
    'By signing up you agree to the ':'Đăng ký tức là bạn đồng ý với ','Privacy Policy':'Chính sách quyền riêng tư',
    'Write a post':'Viết bài','Nothing here yet. Be the first to post.':'Chưa có nội dung. Hãy là người đăng đầu tiên.',
    'Stays & Rentals':'Lưu trú & Cho thuê','All types':'Tất cả loại','Search':'Tìm kiếm','Post a listing':'Đăng tin cho thuê',
    'Contact details and nearby shops and restaurants are filled in by the host. Please contact the host directly and pay offline.':'Thông tin liên hệ, siêu thị và nhà hàng gần đó do chủ nhà tự điền. Vui lòng liên hệ trực tiếp với chủ nhà và thanh toán trực tiếp với họ.',
    'No listings yet':'Chưa có tin nào',
    'Blog':'Blog','Forum':'Diễn đàn','Chat':'Trò chuyện',
    'Log in / Sign up':'Đăng nhập / Đăng ký','Log in':'Đăng nhập','Sign up':'Đăng ký','Log out':'Đăng xuất',
    'All':'Tất cả','News':'Tin tức','Culture':'Văn hóa','Society':'Xã hội','Life':'Đời sống','Garden':'Vườn','Planting':'Trồng trọt','Growing':'Canh tác',
    'Fishing':'Câu cá','Food':'Ẩm thực','Pets':'Thú cưng','Travel':'Du lịch','Living Abroad':'Sống ở nước ngoài','Parenting':'Nuôi dạy con','Health':'Sức khỏe',
    'Education':'Giáo dục','Real Estate':'Bất động sản','Careers':'Nghề nghiệp','Cars':'Ô tô','Photography':'Nhiếp ảnh','Film & TV':'Phim & TV','Sports':'Thể thao','Fiction':'Tiểu thuyết',
    'Write a blog':'Viết blog','Story Animator':'Hoạt hình kể chuyện','Qimen Divination':'Kỳ môn độn giáp','Fortune-Telling':'Luận giải mệnh bàn','Chinese Medicine Wellness':'Dưỡng sinh Đông y','Poetry & Jokes':'Thơ & Truyện cười','Music Composer':'Sáng tác nhạc','Cooking':'Nấu ăn','Stays':'Lưu trú',
    'Post reply':'Đăng trả lời','Publish':'Đăng bài','Send':'Gửi','Cancel':'Hủy','Close':'Đóng',
    'Chat with everyone':'Trò chuyện cùng mọi người','Start video room':'Mở phòng video','Type a message':'Nhập tin nhắn',
    'Password':'Mật khẩu','Nickname':'Biệt danh','Title':'Tiêu đề','Content':'Nội dung','Category':'Chuyên mục','Replies':'Trả lời','Back':'Quay lại',
    'Back to list':'Về danh sách','Save draft':'Lưu bản nháp','My posts':'Bài của tôi','Edit':'Sửa','Delete':'Xóa','Draft':'Bản nháp','Public':'Công khai','Only me':'Chỉ mình tôi','Public (everyone)':'Công khai (mọi người đều xem được)'
  };
  const TH_E = {
    'Hotel':'โรงแรม','Homestay':'โฮมสเตย์','Short-term apartment':'อพาร์ตเมนต์ระยะสั้น','Room / house for rent (long-term)':'ห้อง/บ้านเช่า (ระยะยาว)',
    'Post':'โพสต์','Contact (WeChat/WhatsApp/phone/email)':'ช่องทางติดต่อ (WeChat/WhatsApp/โทรศัพท์/อีเมล)',
    'City (e.g. Tbilisi, Bangkok, Sydney)':'เมือง (เช่น Tbilisi, Bangkok, Sydney)',
    'Email':'อีเมล','Password (at least 6 characters)':'รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)','Nickname (for sign-up)':'ชื่อเล่น (กรอกตอนสมัคร)',
    'By signing up you agree to the ':'การสมัครสมาชิกถือว่าคุณยอมรับ ','Privacy Policy':'นโยบายความเป็นส่วนตัว',
    'Write a post':'เขียนโพสต์','Nothing here yet. Be the first to post.':'ยังไม่มีเนื้อหา มาโพสต์เป็นคนแรกกันเถอะ',
    'Stays & Rentals':'ที่พักและห้องเช่า','All types':'ทุกประเภท','Search':'ค้นหา','Post a listing':'ลงประกาศที่พัก',
    'Contact details and nearby shops and restaurants are filled in by the host. Please contact the host directly and pay offline.':'ช่องทางติดต่อ ร้านค้าและร้านอาหารใกล้เคียงกรอกโดยเจ้าของที่พักเอง กรุณาติดต่อเจ้าของโดยตรงและชำระเงินกับเจ้าของโดยตรง',
    'No listings yet':'ยังไม่มีประกาศ',
    'Blog':'บล็อก','Forum':'ฟอรัม','Chat':'แชท',
    'Log in / Sign up':'เข้าสู่ระบบ / สมัครสมาชิก','Log in':'เข้าสู่ระบบ','Sign up':'สมัครสมาชิก','Log out':'ออกจากระบบ',
    'All':'ทั้งหมด','News':'ข่าว','Culture':'วัฒนธรรม','Society':'สังคม','Life':'ไลฟ์สไตล์','Garden':'สวน','Planting':'การปลูก','Growing':'การเพาะปลูก',
    'Fishing':'ตกปลา','Food':'อาหาร','Pets':'สัตว์เลี้ยง','Travel':'ท่องเที่ยว','Living Abroad':'ใช้ชีวิตต่างประเทศ','Parenting':'เลี้ยงลูก','Health':'สุขภาพ',
    'Education':'การศึกษา','Real Estate':'อสังหาริมทรัพย์','Careers':'อาชีพ','Cars':'รถยนต์','Photography':'การถ่ายภาพ','Film & TV':'ภาพยนตร์และทีวี','Sports':'กีฬา','Fiction':'นิยาย',
    'Write a blog':'เขียนบล็อก','Story Animator':'แอนิเมชันเล่าเรื่อง','Qimen Divination':'ฉีเหมินตุนเจี่ย','Fortune-Telling':'วิเคราะห์ผังชะตา','Chinese Medicine Wellness':'สุขภาพแพทย์แผนจีน','Poetry & Jokes':'กวีและมุกตลก','Music Composer':'แต่งเพลง','Cooking':'ทำอาหาร','Stays':'ที่พัก',
    'Post reply':'ตอบกลับ','Publish':'เผยแพร่','Send':'ส่ง','Cancel':'ยกเลิก','Close':'ปิด',
    'Chat with everyone':'คุยกับทุกคน','Start video room':'เปิดห้องวิดีโอ','Type a message':'พิมพ์ข้อความ',
    'Password':'รหัสผ่าน','Nickname':'ชื่อเล่น','Title':'หัวข้อ','Content':'เนื้อหา','Category':'หมวดหมู่','Replies':'การตอบกลับ','Back':'กลับ',
    'Back to list':'กลับไปที่รายการ','Save draft':'บันทึกแบบร่าง','My posts':'โพสต์ของฉัน','Edit':'แก้ไข','Delete':'ลบ','Draft':'แบบร่าง','Public':'สาธารณะ','Only me':'เฉพาะฉัน','Public (everyone)':'สาธารณะ (ทุกคนเห็นได้)'
  };
  const mk = m => { const o = {}; for (const k in EN) o[k] = m[EN[k]] || EN[k]; return o; };
  const DICT = { en: EN, vi: mk(VI_E), th: mk(TH_E) };
  let lang = 'zh';
  try { lang = localStorage.getItem('lang') || 'zh'; } catch (e) {}
  if (!DICT[lang]) lang = 'zh';
  const D = DICT[lang] || EN;
  document.documentElement.lang = { zh: 'zh-Hant', en: 'en', vi: 'vi', th: 'th' }[lang];
  window.__I18N = { lang, dict: D };
  const PT = {
    en: { v: (a, b, c) => a + ' · ' + b + ' · ' + c + ' views', s: (x, y, z) => 'Today ' + x + ' | Total ' + y + ' | Posts ' + z, c: 'Copyright complaints & advertising: ' },
    vi: { v: (a, b, c) => a + ' · ' + b + ' · ' + c + ' lượt xem', s: (x, y, z) => 'Hôm nay ' + x + ' | Tổng ' + y + ' | Bài viết ' + z, c: 'Khiếu nại bản quyền & quảng cáo: ' },
    th: { v: (a, b, c) => a + ' · ' + b + ' · ดู ' + c + ' ครั้ง', s: (x, y, z) => 'วันนี้ ' + x + ' | ทั้งหมด ' + y + ' | บทความ ' + z, c: 'ร้องเรียนลิขสิทธิ์และโฆษณา: ' }
  };
  const P = PT[lang] || PT.en;
  const orig = new WeakMap();
  const tr = s => {
    const t = s.trim(); if (!t) return s;
    if (D[t]) return s.replace(t, D[t]);
    let m = t.match(/^(.+?) · (.+?) · (\d+) 次瀏覽$/);
    if (m) return s.replace(t, P.v(D[m[1]] || m[1], m[2], m[3]));
    m = t.match(/^(.+?) · (.+)$/);
    if (m && D[m[1]]) return s.replace(t, D[m[1]] + ' · ' + m[2]);
    m = t.match(/^今日訪問 (\d+)\s*[|｜]\s*累計訪問 (\d+)\s*[|｜]\s*文章 (\d+)$/);
    if (m) return s.replace(t, P.s(m[1], m[2], m[3]));
    if (t.indexOf('版權投訴與廣告合作') === 0) return s.replace('版權投訴與廣告合作：', P.c).replace('版權投訴與廣告合作:', P.c);
    return s;
  };
  function walk() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA') continue;
      if (lang !== 'zh') {
        if (!orig.has(n)) { const r = tr(n.nodeValue); if (r !== n.nodeValue) { orig.set(n, n.nodeValue); n.nodeValue = r; } }
      } else if (orig.has(n)) { n.nodeValue = orig.get(n); orig.delete(n); }
    }
    document.querySelectorAll('[placeholder]').forEach(el => {
      if (lang !== 'zh') {
        if (!el.dataset.zh && D[el.placeholder]) { el.dataset.zh = el.placeholder; el.placeholder = D[el.placeholder]; }
      } else if (el.dataset.zh) { el.placeholder = el.dataset.zh; delete el.dataset.zh; }
    });
  }
  const obs = new MutationObserver(() => { obs.disconnect(); walk(); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); });
  const sel = document.createElement('select');
  sel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;width:auto;margin:0;padding:6px 10px;border:0;border-radius:16px;background:#2f6f73;color:#fff;font-size:13px;cursor:pointer;opacity:.9';
  [['zh', '中文'], ['en', 'English'], ['vi', 'Tiếng Việt'], ['th', 'ไทย']].forEach(([v, name]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = name; sel.appendChild(o);
  });
  sel.value = lang;
  sel.title = 'Language / 語言 / Ngôn ngữ / ภาษา';
  sel.onchange = () => {
    try { localStorage.setItem('lang', sel.value); } catch (e) {}
    location.reload();
  };
  document.body.appendChild(sel);
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
  const L = () => { try { const l = localStorage.getItem('lang'); return (l === 'en' || l === 'vi' || l === 'th') ? l : 'zh'; } catch (e) { return 'zh'; } };
  const T = {
    zh: { go: '翻譯', orig: '顯示原文', busy: '翻譯中…', full: '今日 AI 翻譯額度已滿，已改用瀏覽器翻譯' },
    en: { go: 'Translate', orig: 'Show original', busy: 'Translating…', full: "Today's AI translation quota is used up. Switched to browser translation." },
    vi: { go: 'Dịch', orig: 'Xem bản gốc', busy: 'Đang dịch…', full: 'Hôm nay đã hết lượt dịch AI, chuyển sang dịch của trình duyệt' },
    th: { go: 'แปล', orig: 'ดูต้นฉบับ', busy: 'กำลังแปล…', full: 'โควตาแปลด้วย AI ของวันนี้หมดแล้ว เปลี่ยนเป็นการแปลของเบราว์เซอร์' }
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
      if (!r && (to === 'vi' || to === 'th')) { btn.textContent = t.go; return gtranslate(to); }
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
    const code = ({ en: 'en', vi: 'vi', th: 'th' })[to] || 'zh-TW';
    const pick = () => { const s = document.querySelector('.goog-te-combo'); if (s) { s.value = code; s.dispatchEvent(new Event('change')); } };
    if (window.google && google.translate && google.translate.TranslateElement) return pick();
    let g = document.getElementById('gt');
    if (!g) { g = document.createElement('div'); g.id = 'gt'; g.style.cssText = 'position:absolute;left:-9999px'; document.body.appendChild(g); }
    window.gtInit = () => { new google.translate.TranslateElement({ pageLanguage: 'zh-TW', includedLanguages: 'en,zh-TW,vi,th', autoDisplay: false }, 'gt'); setTimeout(pick, 800); };
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
// ---- Placeholder / option translation (added) ----
(() => {
  const I = window.__I18N;
  if (!I || I.lang === 'zh') return;
  const norm = s => s.replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/[：:]/g, ':').replace(/[，,]/g, ',').replace(/\s+/g, '');
  const RAW = Object.assign({
    '標題（例如：市中心兩居室）': { en: 'Title (e.g. 2-bedroom in city centre)', vi: 'Tiêu đề (ví dụ: căn 2 phòng ngủ ở trung tâm)', th: 'หัวข้อ (เช่น 2 ห้องนอนใจกลางเมือง)' },
    '價格（例如：每晚 40 美元 / 每月 500 美元）': { en: 'Price (e.g. $40 per night / $500 per month)', vi: 'Giá (ví dụ: 40 USD/đêm / 500 USD/tháng)', th: 'ราคา (เช่น 40 ดอลลาร์/คืน / 500 ดอลลาร์/เดือน)' },
    '詳細地址（用於顯示地圖連結）': { en: 'Full address (used for the map link)', vi: 'Địa chỉ đầy đủ (dùng để hiện liên kết bản đồ)', th: 'ที่อยู่เต็ม (ใช้สร้างลิงก์แผนที่)' },
    '附近超市（例如：步行 5 分鐘，Carrefour）': { en: 'Nearby supermarket (e.g. 5 min walk, Carrefour)', vi: 'Siêu thị gần đó (ví dụ: đi bộ 5 phút, Carrefour)', th: 'ซูเปอร์มาร์เก็ตใกล้เคียง (เช่น เดิน 5 นาที, Carrefour)' },
    '附近餐館（例如：步行 3 分鐘，有中餐館）': { en: 'Nearby restaurants (e.g. 3 min walk, Chinese restaurant)', vi: 'Nhà hàng gần đó (ví dụ: đi bộ 3 phút, có quán Trung Hoa)', th: 'ร้านอาหารใกล้เคียง (เช่น เดิน 3 นาที, มีร้านอาหารจีน)' },
    '介紹（設施、規則、租期）': { en: 'Description (facilities, rules, lease term)', vi: 'Mô tả (tiện nghi, quy định, thời hạn thuê)', th: 'รายละเอียด (สิ่งอำนวยความสะดวก กฎ ระยะเวลาเช่า)' },
    '城市': { en: 'City', vi: 'Thành phố', th: 'เมือง' },
    '輸入對方暱稱，找人發私信': { en: "Enter the other person's nickname to send a private message", vi: 'Nhập biệt danh của người nhận để gửi tin nhắn riêng', th: 'ใส่ชื่อเล่นของอีกฝ่ายเพื่อส่งข้อความส่วนตัว' },
    '輸入私信（發出後不能編輯或刪除）': { en: 'Type a private message (cannot be edited or deleted once sent)', vi: 'Nhập tin nhắn riêng (gửi xong không thể sửa hoặc xóa)', th: 'พิมพ์ข้อความส่วนตัว (ส่งแล้วแก้ไขหรือลบไม่ได้)' }
  });
  const M = {};
  for (const k in I.dict) M[norm(k)] = I.dict[k];
  for (const k in RAW) M[norm(k)] = RAW[k][I.lang] || RAW[k].en;
  const apply = () => {
    document.querySelectorAll('[placeholder]').forEach(el => {
      const cur = el.getAttribute('placeholder') || '';
      const want = el.dataset.zh ? null : M[norm(cur)];
      if (want && cur !== want) { el.dataset.zhph = cur; el.setAttribute('placeholder', want); }
    });
    document.querySelectorAll('option').forEach(o => {
      const cur = o.textContent.trim();
      const want = M[norm(cur)];
      if (want && o.textContent !== want) o.textContent = want;
    });
  };
  let timer = 0;
  const sched = () => { clearTimeout(timer); timer = setTimeout(apply, 30); };
  new MutationObserver(sched).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', () => setTimeout(apply, 150));
  apply();
})();
// ===== 多語言：日語 韓語 西班牙語 格魯吉亞語 =====
(() => {
  let lang = 'zh'; try { lang = localStorage.getItem('lang') || 'zh'; } catch (e) {}
  const LN = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', es: 'Español', ka: 'ქართული' };
  document.querySelectorAll('body > button').forEach(b => { if (b.style.position === 'fixed') b.remove(); });
  const sel = document.createElement('select');
  sel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;padding:6px 10px;border:0;border-radius:16px;background:#2f6f73;color:#fff;font-size:13px;cursor:pointer;opacity:.9;width:auto;margin:0';
  sel.innerHTML = Object.keys(LN).map(k => '<option value="' + k + '"' + (k === lang ? ' selected' : '') + '>' + LN[k] + '</option>').join('');
  sel.onchange = () => { try { localStorage.setItem('lang', sel.value); } catch (e) {} location.reload(); };
  document.body.appendChild(sel);
  const I = { ja: 0, ko: 1, es: 2, ka: 3 }[lang];
  if (I === undefined) return;
  document.documentElement.lang = lang;
  const D = {
    '博客':['ブログ','블로그','Blog','ბლოგი'],'論壇':['フォーラム','포럼','Foro','ფორუმი'],'聊天':['チャット','채팅','Chat','ჩატი'],
    '住宿':['宿泊','숙박','Alojamiento','საცხოვრებელი'],
    '登入／註冊':['ログイン／新規登録','로그인／회원가입','Entrar／Registrarse','შესვლა／რეგისტრაცია'],
    '登入 / 註冊':['ログイン / 新規登録','로그인 / 회원가입','Entrar / Registrarse','შესვლა / რეგისტრაცია'],
    '登入':['ログイン','로그인','Entrar','შესვლა'],'註冊':['新規登録','회원가입','Registrarse','რეგისტრაცია'],'登出':['ログアウト','로그아웃','Salir','გასვლა'],
    '全部':['すべて','전체','Todos','ყველა'],'新聞':['ニュース','뉴스','Noticias','სიახლეები'],'文化':['文化','문화','Cultura','კულტურა'],
    '社會':['社会','사회','Sociedad','საზოგადოება'],'生活':['暮らし','생활','Vida','ცხოვრება'],'花園':['ガーデン','정원','Jardín','ბაღი'],
    '種植':['植え付け','식재','Siembra','დარგვა'],'栽培':['栽培','재배','Cultivo','მოყვანა'],'釣魚':['釣り','낚시','Pesca','თევზაობა'],
    '美食':['グルメ','음식','Gastronomía','კერძები'],'寵物':['ペット','반려동물','Mascotas','შინაური ცხოველები'],'旅遊':['旅行','여행','Viajes','მოგზაურობა'],
    '旅居':['海外生活','해외 생활','Vivir fuera','უცხოეთში ცხოვრება'],'親子':['子育て','육아','Crianza','ბავშვების აღზრდა'],'健康':['健康','건강','Salud','ჯანმრთელობა'],
    '教育':['教育','교육','Educación','განათლება'],'房產':['不動産','부동산','Inmuebles','უძრავი ქონება'],'職場':['仕事','직장','Trabajo','კარიერა'],
    '汽車':['車','자동차','Autos','მანქანები'],'攝影':['写真','사진','Fotografía','ფოტოგრაფია'],'影視':['映画・ドラマ','영화·드라마','Cine y TV','კინო და ტელევიზია'],
    '體育':['スポーツ','스포츠','Deportes','სპორტი'],'小說':['小説','소설','Ficción','მხატვრული ლიტერატურა'],
    '寫博客':['ブログを書く','블로그 쓰기','Escribir un blog','ბლოგის დაწერა'],'發文章':['投稿する','글쓰기','Publicar un artículo','სტატიის დაწერა'],
    '發表回覆':['返信する','답글 등록','Publicar respuesta','პასუხის გამოქვეყნება'],'發表':['公開する','게시','Publicar','გამოქვეყნება'],
    '發送':['送信','보내기','Enviar','გაგზავნა'],'取消':['キャンセル','취소','Cancelar','გაუქმება'],'關閉':['閉じる','닫기','Cerrar','დახურვა'],
    '我的文章':['自分の投稿','내 글','Mis publicaciones','ჩემი პოსტები'],'編輯':['編集','수정','Editar','რედაქტირება'],'刪除':['削除','삭제','Eliminar','წაშლა'],
    '返回列表':['一覧に戻る','목록으로','Volver a la lista','სიაში დაბრუნება'],'返回':['戻る','뒤로','Volver','უკან'],
    '存草稿':['下書き保存','임시 저장','Guardar borrador','დრაფტის შენახვა'],'草稿':['下書き','임시 저장','Borrador','დრაფტი'],
    '公開':['公開','공개','Público','საჯარო'],'僅自己可見':['自分のみ','나만 보기','Solo yo','მხოლოდ მე'],
    '公開（全站可見）':['公開（全員に表示）','공개(전체 공개)','Público (visible para todos)','საჯარო (ყველასთვის)'],
    '故事動畫':['ストーリーアニメ','스토리 애니메이션','Animador de historias','ისტორიის ანიმაცია'],
    '奇門遁甲':['奇門遁甲','기문둔갑','Qimen Dunjia','ციმენ დუნძია'],
    '命盤解讀':['命盤の解読','명반 해석','Lectura de carta natal','ბედის რუკის განმარტება'],
    '中醫養生':['漢方・養生','한의학 건강','Salud y medicina china','ჩინური მედიცინა და ჯანმრთელობა'],
    '大家在此聊天':['みんなでチャット','모두와 채팅','Chatea con todos','ჩატი ყველასთან'],
    '開視頻房間':['ビデオルームを開く','화상 방 열기','Abrir sala de video','ვიდეოოთახის გახსნა'],
    '翻譯':['翻訳','번역','Traducir','თარგმნა'],'顯示原文':['原文を表示','원문 보기','Ver original','ორიგინალის ნახვა'],
    '私信':['メッセージ','쪽지','Mensaje','შეტყობინება'],
    '輸入訊息':['メッセージを入力','메시지 입력','Escribe un mensaje','შეიყვანეთ შეტყობინება'],
    '標題':['タイトル','제목','Título','სათაური'],
    '貼上或撰寫文章內容':['本文を貼り付けるか入力','내용을 붙여넣거나 작성하세요','Pega o escribe el contenido','ჩასვით ან დაწერეთ ტექსტი'],
    '寫下你的回覆':['返信を書く','답글을 작성하세요','Escribe tu respuesta','დაწერეთ პასუხი'],
    '電子信箱':['メールアドレス','이메일','Correo electrónico','ელფოსტა'],
    '密碼（至少 6 位）':['パスワード（6文字以上）','비밀번호(6자 이상)','Contraseña (mín. 6)','პაროლი (მინ. 6 სიმბოლო)'],
    '暱稱（註冊時填寫）':['ニックネーム（登録時）','닉네임(가입 시)','Apodo (al registrarte)','მეტსახელი (რეგისტრაციისას)']
  };
  const VW = [' 回閲覧', ' 회 조회', ' visitas', ' ნახვა'];
  const RP = ['{n}件の返信', '답글 {n}개', '{n} respuestas', '{n} პასუხი'];
  const FT = ['著作権に関する苦情・広告のお問い合わせ：', '저작권 신고 및 광고 문의: ', 'Quejas de derechos de autor y publicidad: ', 'საავტორო უფლებების საჩივრები და რეკლამა: '];
  const T = s => (D[s] ? D[s][I] : null);
  const tr = s => {
    const t = s.trim(); if (!t) return s;
    const d = T(t); if (d) return s.replace(t, d);
    let m = t.match(/^(.+?) · (.+?) · (\d+) 次瀏覽$/);
    if (m) return s.replace(t, (T(m[1]) || m[1]) + ' · ' + m[2] + ' · ' + m[3] + VW[I]);
    m = t.match(/^(\d+) 則回覆$/);
    if (m) return s.replace(t, RP[I].replace('{n}', m[1]));
    m = t.match(/^(.+?) · (.+)$/);
    if (m && T(m[1])) return s.replace(t, T(m[1]) + ' · ' + m[2]);
    if (t.indexOf('版權投訴與廣告合作') === 0) return s.replace(/版權投訴與廣告合作[：:]\s*/, FT[I]);
    return s;
  };
  function walk() {
    document.querySelectorAll('select#pc option').forEach(o => { if (!o.hasAttribute('value')) o.setAttribute('value', o.textContent); });
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA') continue;
      const r = tr(n.nodeValue); if (r !== n.nodeValue) n.nodeValue = r;
    }
    document.querySelectorAll('[placeholder]').forEach(el => { const d = T(el.placeholder); if (d) el.placeholder = d; });
  }
  const obs = new MutationObserver(() => { obs.disconnect(); walk(); obs.observe(document.body, { childList: true, subtree: true }); });
  walk(); obs.observe(document.body, { childList: true, subtree: true });
})();
// 加入越南語和泰語選項
(() => {
  const s = document.querySelector('body > select');
  if (!s) return;
  let cur = ''; try { cur = localStorage.getItem('lang') || ''; } catch (e) {}
  [['vi', 'Ti\u1ebfng Vi\u1ec7t'], ['th', '\u0e44\u0e17\u0e22']].forEach(([v, t]) => {
    if ([...s.options].some(o => o.value === v)) return;
    const o = document.createElement('option');
    o.value = v; o.textContent = t; o.selected = (cur === v);
    s.appendChild(o);
  });
})();
// ===== merge language selects =====
(() => {
  document.querySelectorAll('body > select').forEach(s => { if (s.style.position === 'fixed') s.remove(); });
  let lang = 'zh'; try { lang = localStorage.getItem('lang') || 'zh'; } catch (e) {}
  const LN = { zh: '\u4e2d\u6587', en: 'English', ja: '\u65e5\u672c\u8a9e', ko: '\ud55c\uad6d\uc5b4', es: 'Espa\u00f1ol', ka: '\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8', vi: 'Ti\u1ebfng Vi\u1ec7t', th: '\u0e44\u0e17\u0e22' };
  const sel = document.createElement('select');
  sel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;width:auto;margin:0;padding:6px 10px;border:0;border-radius:16px;background:#2f6f73;color:#fff;font-size:13px;cursor:pointer;opacity:.9';
  sel.innerHTML = Object.keys(LN).map(k => '<option value="' + k + '"' + (k === lang ? ' selected' : '') + '>' + LN[k] + '</option>').join('');
  sel.onchange = () => { try { localStorage.setItem('lang', sel.value); } catch (e) {} location.reload(); };
  document.body.appendChild(sel);
})();
