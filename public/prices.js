/* Табір Лайм — блок «Ціни».
   Одна функція render(дані) будує розмітку; її використовують і сайт (дані з /api/prices),
   і попередній перегляд в адмінці, і скрипт tools/build-prices.js, який вшиває стандартний прайс
   у index.html (щоб ціни було видно навіть без бекенду). Усі тексти екрануються. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* число з пробілами → «19 000 грн»; будь-який інший текст лишається як є */
  function money(v, cur) {
    v = String(v == null ? "" : v).trim();
    if (!v) return "—";
    return cur && /^[\d\s.,]+$/.test(v) ? v + " " + cur : v;
  }

  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : "";
  }

  function kindClass(k) { return k === "lime" || k === "hog" || k === "jungle" ? " kind-" + k : ""; }

  function render(d) {
    d = d || {};
    var cur = d.currency || "";
    var shifts = Array.isArray(d.shifts) ? d.shifts : [];
    var plans = Array.isArray(d.plans) ? d.plans : [];
    var hasDates = shifts.some(function (s) { return s && s.dates; });
    var hasLen = shifts.some(function (s) { return s && s.length; });
    var tabbed = plans.length > 1;

    var html = '<div class="section-head"><h2>' + esc(d.title || "Ціни") + "</h2>" +
      (d.intro ? "<p>" + esc(d.intro) + "</p>" : "") + "</div>";

    html += '<div class="price-panel">';

    if (tabbed) {
      html += '<div class="plan-tabs" role="tablist" aria-label="Тип ціни">';
      plans.forEach(function (p, i) {
        html += '<button type="button" role="tab" class="plan-tab" id="plan-tab-' + i + '" aria-controls="plan-' + i +
          '" aria-selected="' + (i === 0) + '" data-plan="' + i + '">' + esc(p.name) + "</button>";
      });
      html += "</div>";
    }

    plans.forEach(function (p, i) {
      var cols = Array.isArray(p.columns) ? p.columns : [];
      html += '<div class="plan" id="plan-' + i + '"' + (tabbed ? ' role="tabpanel" aria-labelledby="plan-tab-' + i + '"' : "") + ">";
      html += '<h3 class="plan-title">' + esc(p.name) + "</h3>";
      if (p.hint) html += '<p class="plan-hint">' + esc(p.hint) + "</p>";

      html += '<div class="table-scroll"><table class="price-table"><thead><tr><th>Зміна</th>';
      if (hasDates) html += "<th>Дати</th>";
      if (hasLen) html += "<th>Тривалість</th>";
      cols.forEach(function (c) { html += "<th>" + esc(c) + "</th>"; });
      html += "</tr></thead><tbody>";

      function priceCells(vals) {
        return cols.map(function (c, j) {
          return '<td class="' + (j > 0 ? "accent-cell" : "") + '" data-label="' + esc(c) + '">' + esc(money(vals && vals[j], cur)) + "</td>";
        }).join("");
      }

      shifts.forEach(function (s, k) {
        html += '<tr class="row-shift"><td class="shift-cell" data-label="Зміна"><strong>' + esc(s.name) + "</strong>" +
          (s.theme ? '<span class="theme' + kindClass(s.kind) + '">' + esc(s.theme) + "</span>" : "") + "</td>";
        if (hasDates) html += '<td class="muted-cell' + (s.dates ? "" : " is-empty") + '" data-label="Дати">' + esc(s.dates || "—") + "</td>";
        if (hasLen) html += '<td class="muted-cell' + (s.length ? "" : " is-empty") + '" data-label="Тривалість">' + esc(s.length || "—") + "</td>";
        html += priceCells((p.prices || [])[k]) + "</tr>";
      });

      (Array.isArray(p.extras) ? p.extras : []).forEach(function (e) {
        html += '<tr class="is-extra"><td class="shift-cell" data-label="Зміна"><strong>' + esc(e.name) + "</strong>" +
          (e.sub ? "<span>" + esc(e.sub) + "</span>" : "") + "</td>";
        if (hasDates) html += '<td class="muted-cell is-empty" data-label="Дати">—</td>';
        if (hasLen) html += '<td class="muted-cell is-empty" data-label="Тривалість">—</td>';
        html += priceCells(e.prices) + "</tr>";
      });

      html += "</tbody></table></div></div>";
    });

    if (d.note) html += '<p class="price-note">' + esc(d.note) + "</p>";
    html += '<div class="price-actions">' +
      '<a class="btn btn-primary" href="' + esc(safeUrl(d.bookUrl) || "#contact") + '" data-book target="_blank" rel="noopener">Забронювати</a>' +
      '<a class="btn btn-ghost" href="#contact">Зв’язатися з менеджером</a></div>';
    html += "</div>";
    return html;
  }

  /* Вкладки «Стандарт / Energy dance». Без скрипта всі типи цін просто йдуть один за одним. */
  function wire(root, start) {
    var panel = root.querySelector(".price-panel");
    var tabs = Array.prototype.slice.call(root.querySelectorAll(".plan-tab"));
    var plans = Array.prototype.slice.call(root.querySelectorAll(".plan"));
    if (!panel || tabs.length < 2) return;
    panel.classList.add("has-tabs");

    function select(i, focus) {
      tabs.forEach(function (t, k) {
        t.setAttribute("aria-selected", String(k === i));
        t.tabIndex = k === i ? 0 : -1;
      });
      plans.forEach(function (p, k) { p.hidden = k !== i; });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i); });
      t.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        select((i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length, true);
      });
    });
    select(Math.min(Math.max(start || 0, 0), tabs.length - 1));
  }

  /* Вставляє прайс у контейнер, зберігаючи обрану вкладку (важливо для живого перегляду в адмінці) */
  function mount(root, d) {
    var cur = root.querySelector('.plan-tab[aria-selected="true"]');
    var start = cur ? Number(cur.dataset.plan) || 0 : 0;
    root.innerHTML = render(d);
    wire(root, start);
  }

  var api = { render: render, mount: mount, wire: wire, esc: esc };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    window.LimePrices = api;
    var root = document.getElementById("priceRoot");
    if (root) wire(root, 0);
  }
})();
