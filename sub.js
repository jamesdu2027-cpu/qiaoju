// Shared toolbar + language driver for standalone sub-pages.
// Reads localStorage.lang (zh/en/vi/th) set on the home page.
(function () {
  if (document.getElementById('subbar')) return;
  var cur = 'zh';
  try { var l = localStorage.getItem('lang'); if (/^(en|vi|th|ja|ko|es|ka)$/.test(l)) cur = l; } catch (e) {}

  // 1) hide the page's old zh/EN toggle (it conflicts with the unified switcher)
  var st = document.createElement('style');
  st.textContent = '#lang,.langbtn{display:none!important}.goog-te-banner-frame,.skiptranslate>iframe{display:none!important}body{top:0!important}';
  document.head.appendChild(st);

  // 2) machine translation fallback (Google) when the page has no native text for this language
  var native = !!(document.querySelector('[data-en]') || document.getElementById('lang'));
  var needGoogle = cur !== 'zh' && cur !== 'en' || (cur === 'en' && !native);
  if (needGoogle && !window.gtInit) {
    var g = document.createElement('div'); g.id = 'gt2'; g.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(g);
    window.gtInit = function () {
      new google.translate.TranslateElement({ pageLanguage: 'zh-TW', includedLanguages: 'en,vi,th,ja,ko,es,ka', autoDisplay: false }, 'gt2');
      var n = 0, t = setInterval(function () {
        var s = document.querySelector('.goog-te-combo');
        if (s) { s.value = cur; s.dispatchEvent(new Event('change')); clearInterval(t); }
        else if (++n > 40) clearInterval(t);
      }, 250);
    };
    var sc = document.createElement('script');
    sc.src = 'https://translate.google.com/translate_a/element.js?cb=gtInit';
    document.head.appendChild(sc);
  }

  // 3) toolbar
  var bar = document.createElement('div');
  bar.id = 'subbar';
  bar.className = 'notranslate';
  bar.setAttribute('translate', 'no');
  bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;gap:6px;align-items:center;font:13px system-ui,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif';
  var css = 'border:0;border-radius:16px;background:#2f6f73;color:#fff;font:inherit;padding:6px 12px;opacity:.92;cursor:pointer;text-decoration:none;margin:0;width:auto;line-height:1.4';
  var home = document.createElement('a');
  home.href = '/'; home.textContent = '← Home / 首頁'; home.style.cssText = css;
  var sel = document.createElement('select');
  sel.style.cssText = css;
  sel.title = 'Language / 語言 / Ngôn ngữ / ภาษา';
  [['zh', '中文'], ['en', 'English'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español'], ['ka', 'ქართული']].forEach(function (p) {
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
