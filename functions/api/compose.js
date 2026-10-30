// Cloudflare Pages Function: POST /api/compose
// 免费方案：用 Cloudflare Workers AI（每天 10,000 Neurons 免费额度，不需要密钥）。
// 需要在 Cloudflare Pages 后台：1) 添加绑定 Workers AI，变量名 AI；2) 环境变量 SUPABASE_URL, SUPABASE_KEY。
// 想改用 Claude：再设置环境变量 ANTHROPIC_API_KEY（设置后优先使用它，会产生费用）。可选 AI_MODEL。
// 流程：验证登录 → 调 AI → 程序检查句数/字数 → 不合格自动重写一次 → 返回

const SHI = { qijue: ['七言绝句', 7, 4], qilv: ['七言律诗', 7, 8], wujue: ['五言绝句', 5, 4], wulv: ['五言律诗', 5, 8] };
// 词牌：每个标点分隔的片段的字数（null 表示不检查，让 AI 按通行词谱写）
const CI = {
  '如梦令': [6, 6, 5, 6, 2, 2, 6],
  '忆秦娥': [3, 7, 3, 4, 4, 7, 7, 3, 4, 4],
  '沁园春': [4, 4, 4, 5, 4, 4, 4, 4, 4, 7, 3, 5, 4, 6, 8, 5, 4, 4, 4, 4, 4, 7, 3, 5, 4],
  '清平乐': [4, 5, 7, 6, 6, 6, 6, 6],
  '卜算子': [5, 5, 7, 5, 5, 5, 7, 5],
  '浣溪沙': [7, 7, 7, 7, 7, 7],
  '蝶恋花': [7, 4, 5, 7, 7, 7, 4, 5, 7, 7],
  '虞美人': [7, 5, 7, 9, 7, 5, 7, 9],
  '菩萨蛮': [7, 7, 5, 5, 5, 5, 5, 5],
  '西江月': [6, 6, 7, 6, 6, 6, 7, 6],
  '鹧鸪天': [7, 7, 7, 7, 3, 3, 7, 7, 7],
  '水调歌头': null, '念奴娇': null, '满江红': null, '声声慢': null, '雨霖铃': null,
  '定风波': null, '临江仙': null, '一剪梅': null, '江城子': null, '破阵子': null, '浪淘沙': null
};
const STYLES_POEM = ['随意', '豪放', '婉约', '田园', '怀古', '送别', '思乡', '咏物', '幽默（打油）', '励志'];
const STYLES_JOKE = ['随意', '冷笑话', '谐音梗', '职场', '生活', '小故事'];

const HAN = /[一-鿿]/g;
const segLens = t => String(t).split(/[，。！？、；：,.!?;:\n\r\s]+/).map(s => (s.match(HAN) || []).length).filter(n => n > 0);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function expected(form, cipai) {
  if (SHI[form]) { const [, n, lines] = SHI[form]; return Array(lines).fill(n); }
  if (form === 'ci') return CI[cipai] || null;
  return null;
}

function buildPrompt(p) {
  const topic = p.topic || '自选';
  const spec = p.lang === 'en' && p.form !== 'joke'
    ? '"en":"English translation, line by line, followed by one short sentence about the form"'
    : '"en":""';
  const out = `只输出一个 JSON 对象，不要任何其他文字：{"title":"标题","text":"正文（用 \\n 换行）",${spec}}`;
  if (p.form === 'joke') {
    if (p.lang === 'en') {
      return `Write an original joke in English. Topic: ${p.topicRaw || 'your choice'}. Type: ${p.style}. It should have a setup and a twist, 60-180 words, no politics, religion, or jokes at the expense of any group or a real named person. Output only one JSON object, nothing else: {"title":"short title","text":"the joke (use \\n for line breaks)","en":""}`;
    }
    return `请编一则原创笑话。主题：${topic}。类型：${p.style}。要求：中文，80～200字，有铺垫有反转，结尾有笑点；不涉及政治、宗教，不拿某个群体或真实的具体人物开玩笑。${out}`;
  }
  const common = `主题：${topic}。风格：${p.style}。必须是原创，不要抄袭或改写古人名篇。`;
  if (SHI[p.form]) {
    const [name, n, lines] = SHI[p.form];
    const lv = lines === 8 ? '颔联、颈联要对仗；' : '';
    return `请创作一首${name}。${common}要求：共${lines}句，每句${n}个字（不含标点）；偶数句押同一平声韵，不要出韵；${lv}用词典雅自然，意境完整；正文每两句为一行，使用中文逗号和句号。${out}`;
  }
  const pat = CI[p.cipai];
  const body = pat
    ? `每个由标点分隔的片段，字数必须依次为：${pat.join('、')}（共${pat.reduce((a, b) => a + b, 0)}字）；上下片之间空一行（\\n\\n）；押该词牌通用的韵，尽量合平仄。`
    : `按《${p.cipai}》通行词谱的句式、字数和韵位创作；分上下片的，上下片之间空一行（\\n\\n）；尽量合平仄。`;
  return `请依词牌《${p.cipai}》创作一首词。${common}${body}${out}`;
}

const SYSTEM = '你是精通中国古典诗词格律、也擅长写幽默短文的作者。严格按用户要求的体裁、字数和格式创作，只输出要求的 JSON。';
const CF_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

async function callAI(env, messages) {
  if (env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 1500, system: SYSTEM, messages })
    });
    if (!r.ok) throw new Error(r.status === 429 ? 'quota' : 'ai_' + r.status);
    const d = await r.json();
    return (d.content || []).map(c => c.text || '').join('');
  }
  // Cloudflare Workers AI（免费额度）：依次尝试几个模型，哪个能用就用哪个
  const msgs = [{ role: 'system', content: SYSTEM }, ...messages.map((m, i) => i === 0 ? { role: 'user', content: m.content + ' /no_think' } : m)];
  const models = [env.AI_MODEL, CF_MODEL, '@cf/meta/llama-3.3-70b-instruct-fp8-fast'].filter(Boolean);
  const errs = [];
  for (const m of models) {
    try {
      const d = await env.AI.run(m, { messages: msgs, max_tokens: 3000 });
      const t = typeof d === 'string' ? d : (d.response ?? (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) ?? '');
      const out = (typeof t === 'string' ? t : JSON.stringify(t)).replace(/<think>[\s\S]*?<\/think>/g, '');
      if (out.trim()) return out;
      errs.push(m + ': empty');
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/neuron|limit|quota|429|4006/i.test(msg)) throw new Error('quota');
      errs.push(m + ': ' + msg.slice(0, 160));
    }
  }
  const err = new Error('ai_failed'); err.detail = errs.join(' | '); throw err;
}

function parseOut(raw) {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    const o = JSON.parse(raw.slice(a, b + 1));
    if (!o || typeof o.text !== 'string' || !o.text.trim()) return null;
    return { title: String(o.title || '').slice(0, 60), text: o.text.trim(), en: String(o.en || '').trim() };
  } catch (e) { return null; }
}

export async function onRequestPost({ request, env }) {
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if ((!env.AI && !env.ANTHROPIC_API_KEY) || !env.SUPABASE_URL || !env.SUPABASE_KEY) return J({ error: 'server_not_configured' }, 500);

  // 1. 只允许已登录用户使用，避免被人刷光额度
  const tk = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tk) return J({ error: 'login' }, 401);
  try {
    const u = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: env.SUPABASE_KEY, authorization: 'Bearer ' + tk } });
    if (!u.ok) return J({ error: 'login' }, 401);
  } catch (e) { return J({ error: 'auth_check_failed' }, 502); }

  // 2. 参数白名单
  let b; try { b = await request.json(); } catch (e) { return J({ error: 'bad_request' }, 400); }
  const form = String(b.form || '');
  if (form !== 'joke' && form !== 'ci' && !SHI[form]) return J({ error: 'bad_request' }, 400);
  const cipai = String(b.cipai || '');
  if (form === 'ci' && !(cipai in CI)) return J({ error: 'bad_request' }, 400);
  const styles = form === 'joke' ? STYLES_JOKE : STYLES_POEM;
  const style = styles.includes(b.style) ? b.style : '随意';
  const topicRaw = String(b.topic || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
  const lang = b.lang === 'en' ? 'en' : 'zh';
  const p = { form, cipai, style, topicRaw, topic: topicRaw, lang };
  if (form === 'joke' && lang === 'en') p.style = { '随意': 'any', '冷笑话': 'dry pun', '谐音梗': 'wordplay', '职场': 'office life', '生活': 'everyday life', '小故事': 'short story' }[style];

  // 3. 生成并检查
  const exp = form === 'joke' ? null : expected(form, cipai);
  const messages = [{ role: 'user', content: buildPrompt(p) }];
  try {
    let raw = await callAI(env, messages), out = parseOut(raw);
    const bad = o => exp && !same(segLens(o.text), exp);
    if ((!out || bad(out))) {
      const why = !out ? '你上次的输出不是合规的 JSON。' : `你上次每个片段的字数是 ${segLens(out.text).join('、')}，要求是 ${exp.join('、')}，不符合。`;
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: why + '请逐句数字数后重写，仍然只输出 JSON。' });
      raw = await callAI(env, messages);
      const out2 = parseOut(raw);
      if (out2) out = out2;
    }
    if (!out) return J({ error: 'ai_failed', detail: 'unparsable: ' + String(raw).slice(0, 200) }, 502);
    return J({ ok: true, title: out.title, text: out.text, en: out.en, checked: !!exp, valid: exp ? same(segLens(out.text), exp) : null });
  } catch (e) {
    return J({ error: String(e.message || 'ai_failed'), detail: e.detail || '' }, 502);
  }
}

export async function onRequest({ request }) {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
}
