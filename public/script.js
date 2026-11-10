/* Табір Лайм — скрипти сайту (без бібліотек) */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Хедер ---------- */
  var header = $(".site-header");
  var burger = $(".burger");
  var nav = $("#nav");
  var drop = $(".nav-drop");
  var dropBtn = drop && $("button", drop);

  function setMenu(open) {
    if (!nav || !burger) return;
    nav.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Закрити меню" : "Відкрити меню");
    document.body.style.overflow = open ? "hidden" : "";
  }
  function setDrop(open) {
    if (!drop || !dropBtn) return;
    drop.classList.toggle("is-open", open);
    dropBtn.setAttribute("aria-expanded", String(open));
  }

  if (burger) burger.addEventListener("click", function () {
    setMenu(burger.getAttribute("aria-expanded") !== "true");
  });
  if (nav) nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) { setMenu(false); setDrop(false); }
  });
  if (dropBtn) {
    var canHover = window.matchMedia("(hover: hover)").matches;
    dropBtn.addEventListener("click", function () {
      /* на пристроях з мишкою меню вже відкрилось по наведенню, тож клік його лишає відкритим */
      setDrop(canHover ? true : !drop.classList.contains("is-open"));
    });
    if (canHover) {
      drop.addEventListener("mouseenter", function () { setDrop(true); });
      drop.addEventListener("mouseleave", function () { setDrop(false); });
    }
  }
  document.addEventListener("click", function (e) {
    if (drop && !drop.contains(e.target)) setDrop(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { setDrop(false); setMenu(false); }
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 980) setMenu(false);
  });

  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Підсвітка розділу в меню (головна) ---------- */
  var sections = $$("main section[id]");
  var links = {};
  $$('.nav a[href^="#"], .nav a[href^="index.html#"]').forEach(function (a) {
    var id = a.getAttribute("href").split("#")[1];
    if (id) links[id] = a;
  });
  if ("IntersectionObserver" in window && sections.length && Object.keys(links).length && !document.body.dataset.page) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].removeAttribute("aria-current"); });
        var l = links[en.target.id];
        if (l) l.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ---------- Перемикач формату в герої ---------- */
  var stage = $(".stage");
  if (stage) {
    var tabs = $$(".switch button", stage);
    var note = $(".switch-note", stage);
    var notes = {
      lime: "Більше драйву та літнього руху: спорт, басейн, сцена, шоу й живі вечори.",
      hog: "Магія, сюжет і рольова атмосфера: загадки, квести та чарівна пригода.",
      jungle: "Атмосфера джунглів, пригоди просто неба й командний дух."
    };
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        var mode = b.dataset.mode;
        stage.dataset.mode = mode;
        tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === b)); });
        if (note) note.textContent = notes[mode];
      });
    });
  }

  /* ---------- Галерея: фільтр за змінами + перегляд ---------- */
  var gallery = $("[data-gallery]");
  if (gallery) {
    var chips = function () { return $$(".chip", document); };
    var shifts = function () { return $$(".shift", gallery); };

    function applyFilter(id, silent) {
      chips().forEach(function (c) { c.setAttribute("aria-pressed", String(c.dataset.filter === id)); });
      shifts().forEach(function (s) { s.hidden = !(id === "all" || s.id === id); });
      if (!silent && history.replaceState) history.replaceState(null, "", id === "all" ? location.pathname + location.search : "#" + id);
    }
    /* перераховує лічильники й застосовує #хеш (викликається і після підвантаження фото з адмінки) */
    function refresh() {
      var total = 0;
      shifts().forEach(function (s) {
        var n = $$("figure", s).length; total += n;
        var c = $("[data-count]", s); if (c) c.textContent = n;
        var chip = $('.chip[data-filter="' + s.id + '"] [data-chip-count]'); if (chip) chip.textContent = n;
      });
      var all = $('.chip[data-filter="all"] [data-chip-count]'); if (all) all.textContent = total;
      var h = location.hash.replace("#", "");
      if (h && shifts().some(function (s) { return s.id === h; })) applyFilter(h, true);
    }
    document.addEventListener("click", function (e) {
      var c = e.target.closest(".chip");
      if (c) applyFilter(c.dataset.filter);
    });
    window.LimeGallery = { refresh: refresh, applyFilter: applyFilter };
    refresh();

    /* Перегляд на весь екран */
    var lb = $(".lb");
    var lbImg = $(".lb-stage img", lb);
    var lbCount = $(".lb-count", lb);
    var lbClose = $(".lb-x", lb);
    var list = [];
    var idx = 0;
    var lastFocus = null;

    function visibleButtons() {
      return $$(".shift:not([hidden]) .gallery button", gallery);
    }
    function show(i) {
      idx = (i + list.length) % list.length;
      var b = list[idx];
      lbImg.src = b.dataset.full;
      lbImg.alt = b.dataset.alt || "";
      lbCount.textContent = (b.dataset.caption ? b.dataset.caption + " · " : "") + (idx + 1) + " з " + list.length;
      [idx + 1, idx - 1].forEach(function (n) {
        var nb = list[(n + list.length) % list.length];
        if (nb) { var p = new Image(); p.src = nb.dataset.full; }
      });
    }
    function open(btn) {
      list = visibleButtons();
      lastFocus = btn;
      lb.classList.add("is-open");
      document.body.style.overflow = "hidden";
      show(list.indexOf(btn));
      lbClose.focus();
    }
    function close() {
      lb.classList.remove("is-open");
      document.body.style.overflow = "";
      lbImg.removeAttribute("src");
      if (lastFocus) lastFocus.focus();
    }

    gallery.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-full]");
      if (b) open(b);
    });
    lbClose.addEventListener("click", close);
    $(".lb-prev", lb).addEventListener("click", function () { show(idx - 1); });
    $(".lb-next", lb).addEventListener("click", function () { show(idx + 1); });
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.classList.contains("lb-stage")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(idx - 1);
      if (e.key === "ArrowRight") show(idx + 1);
      if (e.key === "Tab") {
        var f = $$("button", lb);
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    var x0 = null, y0 = null;
    lb.addEventListener("touchstart", function (e) {
      x0 = e.changedTouches[0].clientX; y0 = e.changedTouches[0].clientY;
    }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      var dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) show(idx + (dx < 0 ? 1 : -1));
      x0 = null;
    }, { passive: true });
  }
})();
