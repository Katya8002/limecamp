/* Вшиває стандартний прайс (public/prices-default.json) у public/index.html між маркерами PRICES.
   Запуск з папки lime:  node tools/build-prices.js
   Потрібен лише якщо міняєте prices-default.json вручну; через адмінку ціни міняються без цього. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "public");
const prices = require(path.join(root, "prices.js"));
const data = JSON.parse(fs.readFileSync(path.join(root, "prices-default.json"), "utf8"));
const file = path.join(root, "index.html");
let html = fs.readFileSync(file, "utf8");
const re = /(<!--PRICES:START-->)[\s\S]*?(<!--PRICES:END-->)/;
if (!re.test(html)) throw new Error("Не знайдено маркери PRICES у index.html");
html = html.replace(re, (m, a, b) => a + "\n" + prices.render(data) + "\n" + b);
fs.writeFileSync(file, html);
console.log("Прайс вшито в index.html");
