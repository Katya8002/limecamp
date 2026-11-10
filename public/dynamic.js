/* Табір Лайм — частина сайту, що працює з бекендом (/api):
   форма «Повідомити мене», відгуки, фото, додані через адмінку.
   Якщо бекенд недоступний (наприклад, файл відкрито з диска), сайт лишається звичайним статичним.
   Усі тексти від відвідувачів вставляються через textContent, тож розмітка не виконається. */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function api(path, opts) {
    opts = opts || {};
    return fetch("/api" + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error((data && data.error) || "HTTP " + r.status); e.status = r.status; throw e; }
        return data;
      });
    });
  }

  /* Перевіряємо, чи бекенд підключено; якщо ні, нічого не міняємо */
  if (location.protocol === "file:") return;
  api("/ping").then(function (p) { if (p && p.ok === true) init(); }).catch(function () {});

  /* ---------- Прайс з адмінки (запит іде паралельно з перевіркою, щоб не було «стрибка») ---------- */
  var priceRoot = $("#priceRoot");
  if (priceRoot && window.LimePrices) {
    api("/prices").then(function (d) {
      if (!d || !Array.isArray(d.plans) || !d.plans.length) return; /* нічого не збережено: лишається вбудований прайс */
      window.LimePrices.mount(priceRoot, d);
      /* посилання «Забронювати» теж керується з адмінки */
      if (/^https:\/\/[^\s"'<>]+$/.test(d.bookUrl || "")) {
        $$("a[data-book]").forEach(function (a) { a.href = d.bookUrl; });
      }
    }).catch(function () {});
  }

  function init() {
    /* ---------- Вікна з формами ---------- */
    $$("[data-open]").forEach(function (btn) {
      var dlg = document.getElementById(btn.dataset.open);
      if (!dlg || typeof dlg.showModal !== "function") return;
      btn.hidden = false;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        dlg.showModal();
        var first = $("input[name=name]", dlg);
        if (first) first.focus();
      });
    });
    $$("dialog.modal").forEach(function (dlg) {
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
      });
    });

    /* ---------- Відправка форм ---------- */
    function throttled(type) {
      try { return Date.now() - Number(localStorage.getItem("lime_sent_" + type) || 0) < 30000; }
      catch (e) { return false; }
    }
    function markSent(type) {
      try { localStorage.setItem("lime_sent_" + type, String(Date.now())); } catch (e) {}
    }

    function setupForm(form) {
      var type = form.dataset.form;
      var msg = $(".form-msg", form);
      var submit = $('button[type="submit"]', form);
      var dlg = form.closest("dialog");

      function say(text, ok) {
        msg.textContent = text;
        msg.className = "form-msg " + (ok ? "is-ok" : "is-error");
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var name = String(fd.get("name") || "").trim();

        if (fd.get("website")) { say("Дякуємо!", true); return; }
        if (!name) { say("Вкажіть, будь ласка, ім'я.", false); return; }
        if (!fd.get("consent")) { say("Потрібна ваша згода, щоб продовжити.", false); return; }
        if (throttled(type)) { say("Зачекайте хвилинку перед повторною відправкою.", false); return; }

        var path, body;
        if (type === "lead") {
          var contact = String(fd.get("contact") || "").trim();
          if (!/^(@?[A-Za-z0-9_]{4,32}|\+?[\d\s()\-]{7,20})$/.test(contact)) {
            say("Вкажіть Telegram (@username) або номер телефону.", false); return;
          }
          path = "/leads";
          body = { name: name.slice(0, 80), contact: contact, child_age: fd.get("child_age") || null };
        } else {
          var text = String(fd.get("text") || "").trim();
          if (text.length < 10) { say("Напишіть відгук трохи довше (мінімум 10 символів).", false); return; }
          path = "/reviews";
          body = { name: name.slice(0, 60), text: text.slice(0, 1200) };
        }

        submit.disabled = true;
        say("Надсилаємо…", true);
        api(path, { method: "POST", body: body })
          .then(function () {
            markSent(type);
            form.reset();
            say(type === "lead"
              ? "Дякуємо! Ми напишемо вам, щойно відкриємо набір."
              : "Дякуємо за відгук! Він з'явиться на сайті після перевірки.", true);
            if (dlg) setTimeout(function () { if (dlg.open) dlg.close(); say("", true); submit.disabled = false; }, 2600);
            else submit.disabled = false;
          })
          .catch(function (err) {
            submit.disabled = false;
            say(err.status === 429 ? err.message : "Не вдалося надіслати. Спробуйте ще раз або напишіть нам у Telegram.", false);
          });
      });
    }
    $$("form[data-form]").forEach(setupForm);

    /* ---------- Відгуки (лише схвалені) ---------- */
    var list = $("#reviewsList");
    if (list) {
      api("/reviews").then(function (rows) {
        rows.forEach(function (r) {
          var fig = document.createElement("figure"); fig.className = "review";
          var bq = document.createElement("blockquote");
          String(r.text).split(/\n+/).forEach(function (para) {
            if (!para.trim()) return;
            var p = document.createElement("p"); p.textContent = para.trim(); bq.appendChild(p);
          });
          var cap = document.createElement("figcaption");
          var av = document.createElement("span"); av.className = "avatar"; av.textContent = (String(r.name).trim()[0] || "•").toUpperCase();
          var nm = document.createElement("span"); nm.textContent = r.name;
          cap.appendChild(av); cap.appendChild(nm);
          fig.appendChild(bq); fig.appendChild(cap);
          list.appendChild(fig);
        });
      }).catch(function () {});
    }

    /* ---------- Фото, додані через адмінку ---------- */
    var year = document.body.dataset.year;
    var gallery = $("[data-gallery]");
    if (year && gallery) {
      var SHIFTS = {
        1: { id: "s1", name: "I зміна", dates: "04.07–12.07", hog: true, chip: "I зміна · Гоґвортс" },
        2: { id: "s2", name: "II зміна", dates: "14.07–23.07", hog: false, chip: "II зміна" },
        3: { id: "s3", name: "III зміна", dates: "25.07–02.08", hog: true, chip: "III зміна · Гоґвортс" },
        4: { id: "s4", name: "IV зміна", dates: "04.08–13.08", hog: false, chip: "IV зміна" }
      };
      var ORDER = ["all", "s1", "s2", "s3", "s4"];

      var el = function (tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
      };

      var figure = function (row, label, n) {
        var fig = document.createElement("figure");
        var btn = el("button");
        btn.type = "button";
        btn.dataset.full = "/api/img/" + row.id;
        btn.dataset.alt = label + ", фото " + n;
        btn.dataset.caption = label;
        var img = new Image();
        img.src = "/api/img/" + row.id + "-t";
        img.alt = label + ", фото " + n;
        img.loading = "lazy"; img.decoding = "async";
        if (row.width && row.height) { img.width = row.width; img.height = row.height; }
        btn.appendChild(img); fig.appendChild(btn);
        return fig;
      };

      var ensureShift = function (key) {
        var info = SHIFTS[key];
        var sec = document.getElementById(info.id);
        if (sec) return sec;
        sec = el("section", "shift"); sec.id = info.id;
        var head = el("div", "shift-head");
        head.appendChild(el("h2", null, info.name));
        if (info.hog) head.appendChild(el("span", "tag", "Лайм у Гоґвортсі"));
        var p = el("p"); p.appendChild(document.createTextNode(info.dates + " · "));
        var c = el("span"); c.setAttribute("data-count", ""); c.textContent = "0"; p.appendChild(c);
        p.appendChild(document.createTextNode(" фото"));
        head.appendChild(p);
        sec.appendChild(head); sec.appendChild(el("div", "gallery"));
        var before = $$(".shift", gallery).filter(function (s) { return ORDER.indexOf(s.id) > ORDER.indexOf(info.id); })[0];
        var cta = $(".cta-row", gallery);
        if (before) gallery.insertBefore(sec, before);
        else if (cta) gallery.insertBefore(sec, cta);
        else gallery.appendChild(sec);

        var bar = $(".filters");
        if (bar) {
          var chip = el("button", "chip" + (info.hog ? " hog" : ""));
          chip.type = "button"; chip.dataset.filter = info.id; chip.setAttribute("aria-pressed", "false");
          chip.appendChild(document.createTextNode(info.chip + " "));
          var sm = el("small", null, "0"); sm.setAttribute("data-chip-count", ""); chip.appendChild(sm);
          var nextChip = $$(".chip", bar).filter(function (cc) { return ORDER.indexOf(cc.dataset.filter) > ORDER.indexOf(info.id); })[0];
          bar.insertBefore(chip, nextChip || null);
        }
        return sec;
      };

      api("/photos?year=" + encodeURIComponent(year)).then(function (rows) {
        if (!rows.length) return;
        rows.forEach(function (row) {
          var sec, label;
          if (year === "2026" && SHIFTS[row.shift]) { sec = ensureShift(row.shift); label = SHIFTS[row.shift].name; }
          else { sec = $(".shift", gallery); label = "Літо " + year; }
          if (!sec) return;
          var g = $(".gallery", sec);
          g.appendChild(figure(row, label, $$("figure", g).length + 1));
        });
        if (window.LimeGallery) window.LimeGallery.refresh();
      }).catch(function () {});
    }
  }
})();
