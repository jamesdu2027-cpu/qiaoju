// Shared mini toolbar for standalone pages: Home link + language selector.
(function () {
  if (document.getElementById('subbar')) return;
  var cur = 'zh';
  try { var l = localStorage.getItem('lang'); if (l === 'en' || l === 'vi' || l === 'th') cur = l; } catch (e) {}
  var bar = document.createElement('div');
  bar.id = 'subbar';
  bar.className = 'notranslate';
  bar.setAttribute('translate', 'no');
  bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;gap:6px;align-items:center;font:13px system-ui,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif';
  var css = 'border:0;border-radius:16px;background:#2f6f73;color:#fff;font:inherit;padding:6px 12px;opacity:.92;cursor:pointer;text-decoration:none;margin:0;width:auto;line-height:1.4';
  var home = document.createElement('a');
  home.href = '/';
  home.textContent = '← Home / 首頁';
  home.style.cssText = css;
  var sel = document.createElement('select');
  sel.style.cssText = css;
  sel.title = 'Language / 語言 / Ngôn ngữ / ภาษา';
  [['zh', '中文'], ['en', 'English'], ['vi', 'Tiếng Việt'], ['th', 'ไทย']].forEach(function (p) {
    var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; sel.appendChild(o);
  });
  sel.value = cur;
  sel.onchange = function () {
    try { localStorage.setItem('lang', sel.value); } catch (e) {}
    location.reload();
  };
  bar.appendChild(home); bar.appendChild(sel);
  document.body.appendChild(bar);
})();
