/* Tropa Club docs: theme toggle, search over page titles and headings, mobile nav. No dependencies. */
(function () {
  var root = document.documentElement;
  root.classList.add('js');

  /* ---- theme ---- */
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function effective() {
    var t = root.getAttribute('data-theme');
    return t ? t : systemDark() ? 'dark' : 'light';
  }
  function syncThemeLabel() {
    var next = effective() === 'dark' ? 'light' : 'dark';
    document.querySelectorAll('.theme-btn').forEach(function (b) {
      b.setAttribute('aria-label', 'Switch to ' + next + ' theme');
      b.setAttribute('title', 'Switch to ' + next + ' theme');
    });
  }
  document.querySelectorAll('.theme-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('tropa-docs-theme', next); } catch (e) {}
      syncThemeLabel();
    });
  });
  syncThemeLabel();

  /* ---- mobile nav ---- */
  var menuBtn = document.querySelector('.menu-btn');
  function setNav(open) {
    root.classList.toggle('nav-open', open);
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () { setNav(!root.classList.contains('nav-open')); });
    document.querySelectorAll('.sidebar a').forEach(function (a) {
      a.addEventListener('click', function () { setNav(false); });
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });
  }

  /* ---- search ---- */
  var index = window.DOCS_INDEX || [];
  function score(entry, terms) {
    var hay = (entry.t + ' ' + (entry.p || '')).toLowerCase();
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var at = hay.indexOf(terms[i]);
      if (at < 0) return 0;
      s += entry.h ? 2 : 6;
      if (entry.t.toLowerCase().indexOf(terms[i]) === 0) s += 3;
    }
    return s;
  }
  function initSearch(box) {
    var input = box.querySelector('input');
    var list = box.querySelector('.search-results');
    var active = -1;
    function render(items, q) {
      list.innerHTML = '';
      if (!items.length) {
        var li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No page or heading matches “' + q + '”.';
        list.appendChild(li);
      }
      items.forEach(function (it, i) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = it.u;
        a.setAttribute('role', 'option');
        a.id = box.id + '-r' + i;
        var t = document.createElement('span');
        t.textContent = it.t;
        a.appendChild(t);
        if (it.p) {
          var s = document.createElement('small');
          s.textContent = it.p;
          a.appendChild(s);
        }
        li.appendChild(a);
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function mark(n) {
      var links = list.querySelectorAll('a');
      if (!links.length) return;
      active = (n + links.length) % links.length;
      links.forEach(function (l, i) { l.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
      input.setAttribute('aria-activedescendant', links[active].id);
      links[active].scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) return close();
      var terms = q.split(/\s+/);
      var hits = index
        .map(function (e) { return { e: e, s: score(e, terms) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8)
        .map(function (x) { return x.e; });
      render(hits, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active - 1); }
      else if (e.key === 'Enter') {
        var links = list.querySelectorAll('a');
        var t = links[active >= 0 ? active : 0];
        if (t && !list.hidden) { e.preventDefault(); window.location.href = t.getAttribute('href'); }
      } else if (e.key === 'Escape') { input.value = ''; close(); }
    });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });
    return input;
  }
  var inputs = [];
  document.querySelectorAll('.search').forEach(function (box) { inputs.push(initSearch(box)); });
  window.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    var target = inputs.filter(function (i) { return i.offsetParent !== null; })[0];
    if (target) { e.preventDefault(); target.focus(); }
  });
})();
