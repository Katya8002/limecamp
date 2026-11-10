/* Адмінка табору Лайм: заявки на набір, відгуки, прайс, фото.
   Усе, що написали відвідувачі, виводиться лише через textContent (захист від XSS). */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");

  /* ---------- Дрібні помічники ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var toastTimer;
  function toast(msg, err) {
    toastEl.textContent = msg;
    toastEl.className = "toast" + (err ? " err" : "");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, err ? 6000 : 2600);
  }
  function fmtDate(s) {
    try { return new Date(s).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }); }
    catch (e) { return s; }
  }
  function fail(error) { toast((error && error.message) || "Щось пішло не так", true); }

  /* ---------- Запити до /api ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.method && opts.method !== "GET") headers["X-Lime-Admin"] = "1";
    var body;
    if (opts.form) body = opts.form;
    else if (opts.body) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
    return fetch("/api" + path, { method: opts.method || "GET", headers: headers, body: body, credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && path !== "/admin/login") { showLogin("Сесія завершилась. Увійдіть знову."); }
          if (!r.ok) { var e = new Error((data && data.error) || "HTTP " + r.status); e.status = r.status; throw e; }
          return data;
        });
      });
  }
  var state = { tab: "leads", leadFilter: "new", priceDirty: false };
  window.addEventListener("beforeunload", function (e) { if (state.priceDirty) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- Вхід ---------- */
  function showLogin(message) {
    clear(app);
    var pass = el("input", { type: "password", required: true, autocomplete: "current-password" });
    var msg = el("p", { class: "form-msg is-error", text: message || "" });
    var btn = el("button", { class: "btn btn-primary", type: "submit", text: "Увійти" });
    var form = el("form", { class: "adm-card adm-login" }, [
      el("h1", { text: "Адмінка табору Лайм" }),
      el("label", { class: "adm-field" }, ["Пароль", pass]),
      msg, btn
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true; msg.textContent = "";
      api("/admin/login", { method: "POST", body: { password: pass.value } })
        .then(function () { renderShell(); })
        .catch(function (err) {
          btn.disabled = false;
          msg.textContent = err.status === 503 ? "Адмінку ще не налаштовано: перевір секрети в Cloudflare (SETUP-uk.md)." : err.message;
        });
    });
    app.appendChild(form);
    pass.focus();
  }

  /* ---------- Каркас ---------- */
  var content, tabsEl, badges = {};

  function renderShell() {
    clear(app);
    var top = el("div", { class: "adm-top" }, [
      el("a", { class: "brand", href: "index.html" }, [
        el("img", { src: "images/brand/logo-mark.png", width: "44", height: "44", alt: "" }),
        el("span", {}, [el("span", { class: "brand-name", text: "Адмінка" }), el("span", { class: "brand-sub", text: "Табір Лайм" })])
      ]),
      el("a", { class: "btn btn-ghost adm-btn", href: "index.html", target: "_blank", rel: "noopener", text: "Відкрити сайт" }),
      el("button", {
        class: "btn btn-ghost adm-btn", type: "button", text: "Вийти",
        onclick: function () { api("/admin/logout", { method: "POST" }).then(function () { showLogin(); }, function () { showLogin(); }); }
      })
    ]);
    tabsEl = el("div", { class: "tabs", role: "tablist" });
    [["leads", "Заявки на 2027"], ["reviews", "Відгуки"], ["prices", "Прайс"], ["photos", "Фото"]].forEach(function (t) {
      var badge = el("span", { class: "badge", hidden: true });
      badges[t[0]] = badge;
      tabsEl.appendChild(el("button", {
        class: "tab", type: "button", role: "tab", "data-tab": t[0],
        "aria-selected": String(state.tab === t[0]),
        onclick: function () {
          if (state.priceDirty && state.tab === "prices" && t[0] !== "prices") {
            if (!confirm("Є незбережені зміни прайсу. Вийти без збереження?")) return;
            state.priceDirty = false;
          }
          state.tab = t[0]; markTabs(); load();
        }
      }, [t[1], badge]));
    });
    content = el("div");
    app.appendChild(top); app.appendChild(tabsEl); app.appendChild(content);
    load(); refreshBadges();
  }
  function markTabs() {
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)); });
  }
  function refreshBadges() {
    api("/admin/leads").then(function (rows) { setBadge("leads", rows.filter(function (x) { return x.status === "new"; }).length); }).catch(function () {});
    api("/admin/reviews").then(function (rows) { setBadge("reviews", rows.filter(function (x) { return x.status === "pending"; }).length); }).catch(function () {});
  }
  function setBadge(key, n) {
    if (!badges[key]) return;
    badges[key].textContent = n || 0;
    badges[key].hidden = !n;
  }
  function load() {
    clear(content);
    if (state.tab === "leads") loadLeads();
    else if (state.tab === "reviews") loadReviews();
    else if (state.tab === "prices") loadPricesTab();
    else loadPhotos();
  }

  /* ---------- Заявки ---------- */
  function contactLink(c) {
    var s = String(c).trim();
    if (/^@?[A-Za-z0-9_]{4,32}$/.test(s)) return "https://t.me/" + s.replace("@", "");
    if (/^\+?[\d\s()\-]{7,20}$/.test(s)) return "tel:" + s.replace(/[^\d+]/g, "");
    return null;
  }
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* захист від формул у Excel */
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv(rows) {
    var lines = [["Дата", "Ім'я", "Контакт", "Вік дитини", "Статус"].map(csvCell).join(",")];
    rows.forEach(function (r) {
      lines.push([fmtDate(r.created_at), r.name, r.contact, r.child_age, r.status === "done" ? "опрацьована" : "нова"].map(csvCell).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "zayavky-lime.csv" });
    document.body.appendChild(a); a.click(); a.remove();
  }

  function loadLeads() {
    content.appendChild(el("p", { class: "adm-muted", text: "Завантаження…" }));
    api("/admin/leads").then(function (all) {
      setBadge("leads", all.filter(function (x) { return x.status === "new"; }).length);
      clear(content);

      var seg = el("div", { class: "seg", role: "group", "aria-label": "Фільтр" });
      [["new", "Нові"], ["done", "Опрацьовані"], ["all", "Усі"]].forEach(function (f) {
        seg.appendChild(el("button", {
          type: "button", "aria-pressed": String(state.leadFilter === f[0]), text: f[1],
          onclick: function () { state.leadFilter = f[0]; clear(content); loadLeads(); }
        }));
      });
      content.appendChild(el("div", { class: "bar" }, [
        seg, el("span", { class: "grow adm-muted", text: "Усього заявок: " + all.length }),
        el("button", { class: "btn btn-ghost adm-btn", type: "button", text: "Завантажити CSV", onclick: function () { exportCsv(all); } })
      ]));

      var rows = all.filter(function (x) { return state.leadFilter === "all" || x.status === state.leadFilter; });
      if (!rows.length) content.appendChild(el("p", { class: "adm-card adm-muted", text: "Тут поки що порожньо." }));
      rows.forEach(function (x) {
        var link = contactLink(x.contact);
        var contact = link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: x.contact }) : el("span", { text: x.contact });
        var done = x.status === "done";
        content.appendChild(el("div", { class: "item" + (done ? "" : " is-new") }, [
          el("div", { class: "item-head" }, [
            el("strong", { text: x.name }), contact,
            el("span", { class: "pill" + (done ? " off" : " warn"), text: done ? "опрацьована" : "нова" })
          ]),
          el("div", { class: "item-meta", text: fmtDate(x.created_at) + (x.child_age ? " · вік дитини: " + x.child_age : "") }),
          el("div", { class: "item-actions" }, [
            el("button", {
              class: "btn btn-ghost adm-btn", type: "button", text: done ? "Повернути в нові" : "Позначити опрацьованою",
              onclick: function () {
                api("/admin/leads/" + x.id, { method: "PATCH", body: { status: done ? "new" : "done" } })
                  .then(function () { clear(content); loadLeads(); }, fail);
              }
            }),
            el("button", {
              class: "btn btn-danger adm-btn", type: "button", text: "Видалити",
              onclick: function () {
                if (!confirm("Видалити заявку від " + x.name + "?")) return;
                api("/admin/leads/" + x.id, { method: "DELETE" })
                  .then(function () { toast("Видалено"); clear(content); loadLeads(); }, fail);
              }
            })
          ])
        ]));
      });
    }, fail);
  }

  /* ---------- Відгуки ---------- */
  function loadReviews() {
    content.appendChild(el("p", { class: "adm-muted", text: "Завантаження…" }));
    api("/admin/reviews").then(function (all) {
      setBadge("reviews", all.filter(function (x) { return x.status === "pending"; }).length);
      clear(content);

      var nm = el("input", { maxlength: "60", required: true });
      var tx = el("textarea", { maxlength: "1200", required: true });
      var add = el("form", { class: "adm-card", style: "display:grid;gap:14px;margin-bottom:26px" }, [
        el("h3", { text: "Додати відгук вручну" }),
        el("label", { class: "adm-field" }, ["Ім'я", nm]),
        el("label", { class: "adm-field" }, ["Текст відгуку", tx]),
        el("button", { class: "btn btn-primary", type: "submit", text: "Додати й опублікувати", style: "justify-self:start" })
      ]);
      add.addEventListener("submit", function (e) {
        e.preventDefault();
        if (tx.value.trim().length < 10) { toast("Відгук закороткий", true); return; }
        api("/admin/reviews", { method: "POST", body: { name: nm.value.trim(), text: tx.value.trim() } })
          .then(function () { toast("Відгук опубліковано"); clear(content); loadReviews(); }, fail);
      });
      content.appendChild(add);

      [["pending", "Чекають перевірки"], ["approved", "Опубліковані"], ["hidden", "Приховані"]].forEach(function (g) {
        var rows = all.filter(function (x) { return x.status === g[0]; });
        content.appendChild(el("h3", { class: "group-title", text: g[1] + " (" + rows.length + ")" }));
        if (!rows.length) content.appendChild(el("p", { class: "adm-muted", text: "—" }));
        rows.forEach(function (x) {
          function setStatus(s) {
            api("/admin/reviews/" + x.id, { method: "PATCH", body: { status: s } })
              .then(function () { clear(content); loadReviews(); }, fail);
          }
          var actions = el("div", { class: "item-actions" });
          if (x.status !== "approved") actions.appendChild(el("button", { class: "btn btn-primary adm-btn", type: "button", text: "Опублікувати", onclick: function () { setStatus("approved"); } }));
          if (x.status !== "hidden") actions.appendChild(el("button", { class: "btn btn-ghost adm-btn", type: "button", text: "Сховати", onclick: function () { setStatus("hidden"); } }));
          actions.appendChild(el("button", {
            class: "btn btn-danger adm-btn", type: "button", text: "Видалити",
            onclick: function () {
              if (!confirm("Видалити відгук від " + x.name + "?")) return;
              api("/admin/reviews/" + x.id, { method: "DELETE" })
                .then(function () { toast("Видалено"); clear(content); loadReviews(); }, fail);
            }
          }));
          content.appendChild(el("div", { class: "item" + (x.status === "pending" ? " is-new" : "") }, [
            el("div", { class: "item-head" }, [el("strong", { text: x.name }), el("span", { class: "item-meta", text: fmtDate(x.created_at) })]),
            el("div", { class: "item-text", text: x.text }),
            actions
          ]));
        });
      });
    }, fail);
  }

  /* ---------- Фото ---------- */
  function encode(bmp, max, q) {
    var k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return new Promise(function (res) {
      c.toBlob(function (b) {
        if (b && b.type === "image/webp") return res({ blob: b, w: w, h: h });
        c.toBlob(function (j) { res({ blob: j, w: w, h: h }); }, "image/jpeg", q); /* Safari не вміє webp */
      }, "image/webp", q);
    });
  }

  function loadPhotos() {
    var year = el("select", {}, [el("option", { value: "2026", text: "2026" }), el("option", { value: "2025", text: "2025" })]);
    var shift = el("select", {}, [["1", "I зміна (Гоґвортс)"], ["2", "II зміна"], ["3", "III зміна (Гоґвортс)"], ["4", "IV зміна"]].map(function (o) {
      return el("option", { value: o[0], text: o[1] });
    }));
    var shiftWrap = el("label", { class: "adm-field" }, ["Зміна", shift]);
    year.addEventListener("change", function () { shiftWrap.hidden = year.value !== "2026"; });
    var files = el("input", { type: "file", accept: "image/*", multiple: true, required: true });
    var bar = el("i"); var prog = el("div", { class: "progress", hidden: true }, [bar]);
    var status = el("p", { class: "adm-muted" });
    var btn = el("button", { class: "btn btn-primary", type: "submit", text: "Завантажити фото" });
    var form = el("form", { class: "adm-card", style: "display:grid;gap:14px;margin-bottom:10px" }, [
      el("h3", { text: "Додати фото" }),
      el("div", { class: "adm-row" }, [el("label", { class: "adm-field" }, ["Рік", year]), shiftWrap]),
      el("label", { class: "adm-field" }, ["Файли (JPG, PNG, WebP; на iPhone краще експортувати як JPG)", files]),
      prog, status, btn
    ]);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var list = Array.prototype.slice.call(files.files);
      if (!list.length) return;
      btn.disabled = true; prog.hidden = false; bar.style.width = "0";
      var done = 0, failed = 0;

      function one(file) {
        return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
          return Promise.all([encode(bmp, 1600, 0.8), encode(bmp, 800, 0.76)]);
        }).then(function (v) {
          var fd = new FormData();
          fd.append("year", year.value);
          if (year.value === "2026") fd.append("shift", shift.value);
          fd.append("width", String(v[1].w)); fd.append("height", String(v[1].h));
          fd.append("full", v[0].blob, "full"); fd.append("thumb", v[1].blob, "thumb");
          return api("/admin/photos", { method: "POST", form: fd });
        }).then(function () { done++; }, function (err) {
          failed++; console.error(file.name, err);
          status.textContent = "Не вдалося додати " + file.name + ": " + (err && err.message || "помилка") + (/decode|HEIC|HEIF|InvalidState/i.test(String(err && err.message)) ? ". Збережіть фото як JPG." : "");
        }).then(function () {
          bar.style.width = Math.round(((done + failed) / list.length) * 100) + "%";
          if (!failed) status.textContent = "Завантажено " + done + " з " + list.length;
        });
      }

      list.reduce(function (p, f) { return p.then(function () { return one(f); }); }, Promise.resolve()).then(function () {
        btn.disabled = false;
        toast(failed ? "Готово, але є помилки (" + failed + ")" : "Фото додано", !!failed);
        files.value = "";
        loadPhotosList(listBox);
      });
    });

    var listBox = el("div");
    content.appendChild(form);
    content.appendChild(el("p", { class: "adm-muted", text: "Додані тут фото з'являться на сторінках «Фото змін» автоматично. Фото, що були на сайті раніше, видаляються лише вручну з папки сайту." }));
    content.appendChild(listBox);
    loadPhotosList(listBox);
  }

  function loadPhotosList(box) {
    clear(box);
    box.appendChild(el("p", { class: "adm-muted", text: "Завантаження…" }));
    api("/admin/photos").then(function (rows) {
      clear(box);
      if (!rows.length) { box.appendChild(el("p", { class: "adm-card adm-muted", text: "Через адмінку ще не додано жодного фото." })); return; }
      var groups = {};
      rows.forEach(function (p) {
        var key = p.year + (p.shift ? " · " + p.shift + " зміна" : "");
        (groups[key] = groups[key] || []).push(p);
      });
      Object.keys(groups).forEach(function (key) {
        box.appendChild(el("h3", { class: "group-title", text: key + " (" + groups[key].length + ")" }));
        var grid = el("div", { class: "grid-photos" });
        groups[key].forEach(function (p) {
          grid.appendChild(el("div", { class: "ph" }, [
            el("img", { src: "/api/img/" + p.id + "-t", alt: "", loading: "lazy" }),
            el("button", {
              type: "button", "aria-label": "Видалити фото", text: "×",
              onclick: function () {
                if (!confirm("Видалити це фото з сайту?")) return;
                api("/admin/photos/" + p.id, { method: "DELETE" })
                  .then(function () { toast("Фото видалено"); loadPhotosList(box); }, fail);
              }
            })
          ]));
        });
        box.appendChild(grid);
      });
    }, fail);
  }

  /* ---------- Прайс ---------- */
  var KIND_OPTS = [["", "без позначки"], ["lime", "Повернення в Лайм"], ["hog", "Гоґвортс"], ["jungle", "Lime Jungle"]];

  function loadPricesTab() {
    content.appendChild(el("p", { class: "adm-muted", text: "Завантаження…" }));
    api("/admin/prices").then(function (saved) {
      if (saved && saved.plans) return { doc: saved, custom: true };
      return fetch("/prices-default.json", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) { return { doc: d, custom: false }; });
    }).then(function (r) { clear(content); buildPriceEditor(r.doc, r.custom); }, fail);
  }

  function buildPriceEditor(doc, custom) {
    var body = el("div");
    var pvBox = el("div");
    var status = el("span", { class: "adm-muted", text: custom ? "На сайті зараз ваш збережений прайс." : "На сайті зараз стандартний прайс. Змініть і натисніть «Зберегти»." });
    var saveBtn = el("button", { class: "btn btn-primary", type: "button", text: "Зберегти прайс", disabled: true });
    var pvTimer;

    /* усі ціни завжди мають форму «зміни × колонки»; тут підтримуємо цю рівність */
    function align() {
      doc.shifts = Array.isArray(doc.shifts) ? doc.shifts : [];
      doc.plans = Array.isArray(doc.plans) ? doc.plans : [];
      doc.plans.forEach(function (p) {
        p.columns = Array.isArray(p.columns) && p.columns.length ? p.columns : ["Ціна"];
        p.extras = Array.isArray(p.extras) ? p.extras : [];
        var old = Array.isArray(p.prices) ? p.prices : [];
        p.prices = doc.shifts.map(function (_s, i) {
          return p.columns.map(function (_c, j) { return String((old[i] || [])[j] || ""); });
        });
        p.extras.forEach(function (e) {
          var o = Array.isArray(e.prices) ? e.prices : [];
          e.prices = p.columns.map(function (_c, j) { return String(o[j] || ""); });
        });
      });
    }
    align();

    function renderPreview() {
      clearTimeout(pvTimer);
      pvTimer = setTimeout(function () { if (window.LimePrices) window.LimePrices.mount(pvBox, doc); }, 120);
    }
    function changed() {
      state.priceDirty = true;
      saveBtn.disabled = false;
      status.textContent = "Є незбережені зміни";
      renderPreview();
    }

    function input(value, set, o) {
      var n = el(o.area ? "textarea" : "input", { maxlength: o.max, placeholder: o.ph, "aria-label": o.label, rows: o.area ? "3" : false });
      n.value = value || "";
      n.addEventListener("input", function () { set(n.value); changed(); });
      return n;
    }
    function iconBtn(text, label, enabled, fn) {
      return el("button", { class: "iconbtn", type: "button", text: text, title: label, "aria-label": label, disabled: !enabled, onclick: fn });
    }
    function swap(list, i, d) { var t = list[i]; list[i] = list[i + d]; list[i + d] = t; }

    /* --- тексти --- */
    function introCard() {
      return el("div", { class: "adm-card pr-card" }, [
        el("h3", { text: "Заголовок і тексти" }),
        el("div", { class: "adm-row" }, [
          el("label", { class: "adm-field" }, ["Заголовок блоку", input(doc.title, function (v) { doc.title = v; }, { max: 100, label: "Заголовок" })]),
          el("label", { class: "adm-field" }, ["Валюта (дописується до чисел)", input(doc.currency, function (v) { doc.currency = v; }, { max: 10, ph: "грн", label: "Валюта" })])
        ]),
        el("label", { class: "adm-field" }, ["Короткий опис під заголовком", input(doc.intro, function (v) { doc.intro = v; }, { max: 300, label: "Опис", area: true })]),
        el("label", { class: "adm-field" }, ["Примітка під таблицею", input(doc.note, function (v) { doc.note = v; }, { max: 500, label: "Примітка", area: true })]),
        el("label", { class: "adm-field" }, ["Посилання кнопок «Забронювати» (форма запису)", input(doc.bookUrl, function (v) { doc.bookUrl = v; }, { max: 300, ph: "https://forms.gle/…", label: "Посилання на форму" })]),
        el("p", { class: "adm-muted", text: "Посилання діє для всіх кнопок «Забронювати» на сайті. Має починатися з https://" })
      ]);
    }

    /* --- зміни --- */
    function shiftsCard() {
      var rows = el("div", { class: "pr-grid" });
      rows.appendChild(el("div", { class: "pr-row pr-head" }, ["Назва", "Тематика", "Колір позначки", "Дати", "Тривалість", ""].map(function (t) { return el("span", { text: t }); })));
      doc.shifts.forEach(function (sh, i) {
        var kind = el("select", { "aria-label": "Колір позначки" }, KIND_OPTS.map(function (k) { return el("option", { value: k[0], text: k[1], selected: sh.kind === k[0] }); }));
        kind.addEventListener("change", function () { sh.kind = kind.value; changed(); });
        rows.appendChild(el("div", { class: "pr-row" }, [
          input(sh.name, function (v) { sh.name = v; }, { max: 40, ph: "I зміна", label: "Назва зміни" }),
          input(sh.theme, function (v) { sh.theme = v; }, { max: 60, ph: "Lime Jungle", label: "Тематика" }),
          kind,
          input(sh.dates, function (v) { sh.dates = v; }, { max: 40, ph: "04.07 – 12.07", label: "Дати" }),
          input(sh.length, function (v) { sh.length = v; }, { max: 30, ph: "9 днів", label: "Тривалість" }),
          el("div", { class: "pr-ctl" }, [
            iconBtn("↑", "Підняти вгору", i > 0, function () {
              swap(doc.shifts, i, -1); doc.plans.forEach(function (p) { swap(p.prices, i, -1); }); changed(); draw();
            }),
            iconBtn("↓", "Опустити вниз", i < doc.shifts.length - 1, function () {
              swap(doc.shifts, i, 1); doc.plans.forEach(function (p) { swap(p.prices, i, 1); }); changed(); draw();
            }),
            iconBtn("×", "Видалити зміну", true, function () {
              if (!confirm("Видалити «" + (sh.name || "зміну") + "» з прайсу? Її ціни в усіх типах теж зникнуть.")) return;
              doc.shifts.splice(i, 1); doc.plans.forEach(function (p) { p.prices.splice(i, 1); }); changed(); draw();
            })
          ])
        ]));
      });
      var add = el("button", {
        class: "btn btn-ghost adm-btn", type: "button", text: "+ Додати зміну", disabled: doc.shifts.length >= 8,
        onclick: function () { doc.shifts.push({ name: "Нова зміна", theme: "", kind: "", dates: "", length: "" }); align(); changed(); draw(); }
      });
      return el("div", { class: "adm-card pr-card" }, [
        el("h3", { text: "Зміни" }),
        el("p", { class: "adm-muted", text: "Дати й тематика вводяться один раз і показуються в усіх типах цін." }),
        el("div", { class: "pr-scroll" }, [rows]),
        add
      ]);
    }

    /* --- один тип ціни --- */
    function planCard(p, pi) {
      var ncols = p.columns.length;
      var grid = el("div", { class: "pr-prices", style: "--cols:" + ncols });

      /* заголовок: назви колонок, їх можна змінювати й видаляти */
      grid.appendChild(el("span", { class: "pr-corner", text: "Зміна / рядок" }));
      p.columns.forEach(function (c, j) {
        grid.appendChild(el("div", { class: "pr-colhead" }, [
          input(c, function (v) { p.columns[j] = v; }, { max: 60, label: "Назва колонки " + (j + 1), ph: "Назва колонки" }),
          iconBtn("×", "Видалити колонку", ncols > 1, function () {
            if (!confirm("Видалити колонку «" + (p.columns[j] || j + 1) + "» разом з її цінами?")) return;
            p.columns.splice(j, 1);
            p.prices.forEach(function (r) { r.splice(j, 1); });
            p.extras.forEach(function (e) { e.prices.splice(j, 1); });
            changed(); draw();
          })
        ]));
      });
      grid.appendChild(el("span"));

      doc.shifts.forEach(function (sh, i) {
        grid.appendChild(el("div", { class: "pr-label" }, [el("strong", { text: sh.name || "—" }), el("small", { text: [sh.theme, sh.dates].filter(Boolean).join(" · ") })]));
        p.columns.forEach(function (c, j) {
          grid.appendChild(input(p.prices[i][j], function (v) { p.prices[i][j] = v; }, { max: 30, ph: "19 000", label: (sh.name || "Зміна") + ", " + (c || "колонка " + (j + 1)) }));
        });
        grid.appendChild(el("span"));
      });

      p.extras.forEach(function (e, ei) {
        grid.appendChild(el("div", { class: "pr-label pr-extra" }, [
          input(e.name, function (v) { e.name = v; }, { max: 60, ph: "Дві зміни", label: "Назва додаткового рядка" }),
          input(e.sub, function (v) { e.sub = v; }, { max: 80, ph: "будь-які дві", label: "Підпис додаткового рядка" })
        ]));
        p.columns.forEach(function (c, j) {
          grid.appendChild(input(e.prices[j], function (v) { e.prices[j] = v; }, { max: 30, ph: "32 000", label: (e.name || "Додатковий рядок") + ", " + (c || "колонка " + (j + 1)) }));
        });
        grid.appendChild(iconBtn("×", "Видалити рядок", true, function () {
          if (!confirm("Видалити рядок «" + (e.name || "") + "»?")) return;
          p.extras.splice(ei, 1); changed(); draw();
        }));
      });

      var bar = el("div", { class: "item-actions" }, [
        el("button", {
          class: "btn btn-ghost adm-btn", type: "button", text: "+ Колонка", disabled: ncols >= 6,
          onclick: function () { p.columns.push("Нова колонка"); align(); changed(); draw(); }
        }),
        el("button", {
          class: "btn btn-ghost adm-btn", type: "button", text: "+ Рядок (наприклад, «Дві зміни»)", disabled: p.extras.length >= 6,
          onclick: function () { p.extras.push({ name: "Новий рядок", sub: "", prices: [] }); align(); changed(); draw(); }
        })
      ]);

      return el("div", { class: "adm-card pr-card" }, [
        el("div", { class: "pr-planhead" }, [
          el("h3", { text: "Тип ціни " + (pi + 1) }),
          el("div", { class: "pr-ctl" }, [
            iconBtn("←", "Перенести ліворуч", pi > 0, function () { swap(doc.plans, pi, -1); changed(); draw(); }),
            iconBtn("→", "Перенести праворуч", pi < doc.plans.length - 1, function () { swap(doc.plans, pi, 1); changed(); draw(); }),
            el("button", {
              class: "btn btn-danger adm-btn", type: "button", text: "Видалити тип", disabled: doc.plans.length <= 1,
              onclick: function () {
                if (!confirm("Видалити тип ціни «" + (p.name || pi + 1) + "»?")) return;
                doc.plans.splice(pi, 1); changed(); draw();
              }
            })
          ])
        ]),
        el("div", { class: "adm-row" }, [
          el("label", { class: "adm-field" }, ["Назва вкладки", input(p.name, function (v) { p.name = v; }, { max: 40, label: "Назва типу ціни", ph: "Стандарт" })]),
          el("label", { class: "adm-field" }, ["Пояснення над таблицею", input(p.hint, function (v) { p.hint = v; }, { max: 200, label: "Пояснення", ph: "Для кого ця ціна" })])
        ]),
        el("div", { class: "pr-scroll" }, [grid]),
        bar
      ]);
    }

    function draw() {
      clear(body);
      body.appendChild(introCard());
      body.appendChild(shiftsCard());
      doc.plans.forEach(function (p, i) { body.appendChild(planCard(p, i)); });
      body.appendChild(el("button", {
        class: "btn btn-ghost", type: "button", text: "+ Додати тип ціни", disabled: doc.plans.length >= 4, style: "margin-top:4px",
        onclick: function () {
          var last = doc.plans[doc.plans.length - 1] || { columns: ["Ціна"] };
          doc.plans.push({ name: "Новий тип ціни", hint: "", columns: last.columns.slice(), prices: [], extras: [] });
          align(); changed(); draw();
        }
      }));
      renderPreview();
    }

    saveBtn.addEventListener("click", function () {
      saveBtn.disabled = true;
      api("/admin/prices", { method: "PUT", body: doc }).then(function (r) {
        state.priceDirty = false;
        if (r && r.doc) doc = r.doc;
        align();
        status.textContent = "Збережено. На сайті зміни з'являться протягом хвилини.";
        toast("Прайс збережено");
        draw();
      }, function (err) { saveBtn.disabled = false; fail(err); });
    });

    var resetBtn = el("button", {
      class: "btn btn-danger adm-btn", type: "button", text: "Скинути до стандартного",
      onclick: function () {
        if (!confirm("Повернути вбудований прайс сайту? Ваші збережені зміни прайсу буде втрачено.")) return;
        api("/admin/prices", { method: "DELETE" }).then(function () {
          state.priceDirty = false; toast("Повернуто стандартний прайс"); clear(content); loadPricesTab();
        }, fail);
      }
    });

    content.appendChild(el("p", { class: "adm-muted", text: "Тут можна змінити все: зміни, дати, тематики, колонки, ціни, тексти та посилання на бронювання. Нижче видно, як це виглядатиме на сайті." }));
    content.appendChild(body);
    content.appendChild(el("div", { class: "savebar" }, [saveBtn, status]));
    content.appendChild(el("div", { class: "item-actions", style: "margin-top:12px" }, [
      el("a", { class: "btn btn-ghost adm-btn", href: "/#price", target: "_blank", rel: "noopener", text: "Подивитись на сайті" }),
      resetBtn
    ]));
    content.appendChild(el("h3", { class: "group-title", text: "Попередній перегляд" }));
    content.appendChild(el("div", { class: "preview" }, [pvBox]));
    draw();
  }

  /* ---------- Старт ---------- */
  api("/ping").then(function (p) {
    if (!p.ok) { clear(app); app.appendChild(el("div", { class: "adm-card adm-login" }, [el("h1", { text: "Бекенд не підключено" }), el("p", { class: "adm-warn", text: "Не знайдено базу даних. Перевір прив'язки DB і PHOTOS у Cloudflare (SETUP-uk.md)." })])); return; }
    return api("/admin/me").then(function () { renderShell(); }, function () { showLogin(); });
  }, function () {
    clear(app);
    app.appendChild(el("div", { class: "adm-card adm-login" }, [el("h1", { text: "Адмінка недоступна" }), el("p", { class: "adm-warn", text: "Бекенд не відповідає. Адмінка працює лише на розгорнутому сайті (Cloudflare Pages), а не з файлу на диску." })]));
  });
})();
