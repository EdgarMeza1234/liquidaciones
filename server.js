const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "liq-secret-2024-potosi";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===================== JSON STORAGE =====================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, "users.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const LIQS_FILE = path.join(DATA_DIR, "liquidaciones.json");

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

let users = loadJSON(USERS_FILE, []);
let config = loadJSON(CONFIG_FILE, null);
let liquidaciones = loadJSON(LIQS_FILE, []);

if (users.length === 0) {
  users = [
    { user: "admin", pass: "admin123" },
    { user: "operador", pass: "operador123" }
  ];
  saveJSON(USERS_FILE, users);
  console.log("  Usuarios por defecto creados: admin/admin123, operador/operador123");
}

if (!config) {
  config = {
    retenciones: {
      "CAJA": 1.8, "COMIBOL": 1.0, "FEDECOMIN": 0.7,
      "WISTERMAN": 0.3, "FENCOMIN": 0.4, "REGALIA Zn-Ag": 6.0
    },
    "PORCENTAJE": 30, "TRANSPORTE": 700, "DIESEL_BASE": 480,
    "DIESEL_BARRILES": 15, "DIESEL_PRECIO_BARRIL": 140,
    "FACTOR_LB": 2.2046223, "TC_OFICIAL": 6.96
  };
  saveJSON(CONFIG_FILE, config);
  console.log("  Configuracion por defecto creada.");
}

if (liquidaciones.length === 0) {
  const LIQS_JSON = path.join(DATA_DIR, "liquidaciones.json");
  const LIQS_LEGACY = path.join(DATA_DIR, "liquidaciones.json.old");
  if (fs.existsSync(LIQS_LEGACY)) {
    try { liquidaciones = JSON.parse(fs.readFileSync(LIQS_LEGACY, "utf-8")); saveJSON(LIQS_FILE, liquidaciones); console.log(`  Migradas ${liquidaciones.length} liquidaciones`); } catch {}
  }
}

// ===================== HELPERS =====================
function n(v) { return Number(v) || 0; }
function r2(v) { return Math.round(v * 100) / 100; }

// ===================== FORMULAS =====================
function calcularLiquidacion(datos) {
  const E7 = n(datos["PESO BRUTO"]);
  const E8 = n(datos["TARA"]);
  const E9 = E7 - E8;
  const E13 = n(datos["H2O (%)"]);

  const D10 = n(datos["PRECIO P/LEY [Pb]"]);
  const E10 = n(datos["LEY DE [Pb]"]);
  const D11 = n(datos["PRECIO P/LEY [Ag]"]);
  const E11 = n(datos["LEY DE [Ag]"]);
  const D12 = n(datos["PRECIO P/LEY [Zn]"]);
  const E12 = n(datos["LEY DE [Zn]"]);

  const E14 = (E11 * D11) + (E12 * D12) + (E10 * D10);
  const E15 = n(datos["ANTICIPOS"]);

  const H6 = config["TC_OFICIAL"];
  const H7 = n(datos["TIPO CAMBIO"]);
  const LEY_PCT = n(datos["LEY (%)"]);

  const C10 = E9;
  const E10_H = C10 - (C10 * E13 / 100);
  const F10 = LEY_PCT;
  const G10 = E10_H * (F10 / 100);
  const H10 = G10 * config["FACTOR_LB"];
  const I10 = E14;
  const J10 = I10 * E10_H / 1000;
  const K10 = J10 * H7;

  const retenciones = {};
  let K19 = 0;
  const retKeys = ["CAJA", "COMIBOL", "FEDECOMIN", "WISTERMAN", "FENCOMIN", "REGALIA Zn-Ag"];
  for (const key of retKeys) {
    const pctDecimal = (config.retenciones[key] || 0) / 100;
    const monto = K10 * pctDecimal;
    retenciones[key] = { porcentaje: config.retenciones[key], decimal: pctDecimal, monto: r2(monto) };
    K19 += monto;
  }

  const K20 = K10 - K19;
  const K21 = E15;
  const K22 = n(datos["TRANSPORTE"]) || config["TRANSPORTE"];
  const K23 = K20 * (config["PORCENTAJE"] / 100);
  const K24 = config["DIESEL_BASE"] + (config["DIESEL_BARRILES"] * config["DIESEL_PRECIO_BARRIL"]);
  const K25 = K10 - K19 - K21 - K23 - K22 - K24;

  return {
    id: datos.id || uuidv4(),
    "NUMERO DE LOTE": datos["NUMERO DE LOTE"] || "",
    "FECHA DE ENTREGA": datos["FECHA DE ENTREGA"] || "",
    "FECHA DE PAGO": datos["FECHA DE PAGO"] || "",
    "NOMBRE Y APELLIDO": datos["NOMBRE Y APELLIDO"] || "",
    "COOPERATIVA": datos["COOPERATIVA"] || "",
    "PRODUCTOR TIPO": datos["PRODUCTOR TIPO"] || "Particular",
    "PESO BRUTO": E7, "TARA": E8, "PESO NETO": r2(E9), "H2O (%)": n(datos["H2O (%)"]),
    "LEY DE [Pb]": E10, "PRECIO P/LEY [Pb]": D10,
    "LEY DE [Ag]": E11, "PRECIO P/LEY [Ag]": D11,
    "LEY DE [Zn]": E12, "PRECIO P/LEY [Zn]": D12,
    "ANTICIPOS": K21,
    "TC OFICIAL": H6, "TIPO CAMBIO": H7, "LEY (%)": LEY_PCT,
    "TMNS": r2(E10_H), "KLS FINOS": r2(G10), "LB FINAS": r2(H10),
    "PRECIO P/Tn [$us]": r2(I10), "VAL MIN $US": r2(J10), "VAL MIN BS": r2(K10),
    "RETENCIONES": retenciones, "TOTAL RETENCION": r2(K19),
    "SUB TOTAL Bs.": r2(K20), "TRANSPORTE": K22, "PORCENTAJE": r2(K23),
    "DIESEL Y TOPES": r2(K24), "LIQUIDO PAGABLE [Bs]": r2(K25),
    fecha_registro: new Date().toISOString()
  };
}

// ===================== AUTH =====================
function authMiddleware(req, res, next) {
  next();
}

app.post("/api/login", (req, res) => {
  const { user, pass } = req.body;
  res.json({ ok: true, token: "no-auth", user: user || "admin" });
});

app.get("/api/verify", authMiddleware, (req, res) => res.json({ ok: true }));

app.get("/api/users", authMiddleware, (req, res) => {
  res.json(users.map(u => ({ user: u.user })));
});

app.post("/api/users", authMiddleware, (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) return res.status(400).json({ error: "user y pass requeridos" });
  if (users.find(u => u.user === user)) return res.status(409).json({ error: "Usuario ya existe" });
  users.push({ user, pass });
  saveJSON(USERS_FILE, users);
  res.status(201).json({ ok: true });
});

app.delete("/api/users/:user", authMiddleware, (req, res) => {
  const idx = users.findIndex(u => u.user === req.params.user);
  if (idx === -1) return res.status(404).json({ error: "No encontrado" });
  users.splice(idx, 1);
  saveJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// ===================== CONFIG =====================
app.get("/api/config", authMiddleware, (req, res) => res.json(config));
app.put("/api/config", authMiddleware, (req, res) => {
  config = req.body;
  saveJSON(CONFIG_FILE, config);
  res.json({ ok: true, config });
});

// ===================== LIQUIDACIONES =====================
app.get("/api/liquidaciones", authMiddleware, (req, res) => {
  const { busqueda, fecha_desde, fecha_hasta } = req.query;
  let items = [...liquidaciones];

  if (busqueda) {
    const q = busqueda.toLowerCase();
    items = items.filter(l =>
      (l["NOMBRE Y APELLIDO"]||"").toLowerCase().includes(q) ||
      (l["NUMERO DE LOTE"]||"").toLowerCase().includes(q) ||
      (l["COOPERATIVA"]||"").toLowerCase().includes(q)
    );
  }
  if (fecha_desde) items = items.filter(l => l["FECHA DE ENTREGA"] >= fecha_desde);
  if (fecha_hasta) items = items.filter(l => l["FECHA DE ENTREGA"] <= fecha_hasta);
  res.json(items.sort((a, b) => (b.fecha_registro || "").localeCompare(a.fecha_registro || "")));
});

app.get("/api/liquidaciones/:id", authMiddleware, (req, res) => {
  const l = liquidaciones.find(l => l.id === req.params.id);
  if (!l) return res.status(404).json({ error: "No encontrada" });
  res.json(l);
});

app.post("/api/liquidaciones", authMiddleware, (req, res) => {
  const r = calcularLiquidacion(req.body);
  liquidaciones.push(r);
  saveJSON(LIQS_FILE, liquidaciones);
  res.status(201).json(r);
});

app.put("/api/liquidaciones/:id", authMiddleware, (req, res) => {
  const idx = liquidaciones.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "No encontrada" });
  const r = calcularLiquidacion({ ...req.body, id: req.params.id });
  liquidaciones[idx] = r;
  saveJSON(LIQS_FILE, liquidaciones);
  res.json(r);
});

app.delete("/api/liquidaciones/:id", authMiddleware, (req, res) => {
  const idx = liquidaciones.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "No encontrada" });
  liquidaciones.splice(idx, 1);
  saveJSON(LIQS_FILE, liquidaciones);
  res.json({ ok: true });
});

app.get("/api/resumen", authMiddleware, (req, res) => {
  const t = liquidaciones.length;
  const pag = liquidaciones.reduce((s, l) => s + (l["LIQUIDO PAGABLE [Bs]"] || 0), 0);
  const ret = liquidaciones.reduce((s, l) => s + (l["TOTAL RETENCION"] || 0), 0);
  const min = liquidaciones.reduce((s, l) => s + (l["VAL MIN BS"] || 0), 0);
  const prod = [...new Set(liquidaciones.map(l => l["NOMBRE Y APELLIDO"]))];
  res.json({ total: t, pagable: r2(pag), retenciones: r2(ret), mineral: r2(min), productores: prod.length });
});

// ===================== IMPRESION =====================
app.get("/api/liquidaciones/:id/imprimir", authMiddleware, (req, res) => {
  const l = liquidaciones.find(l => l.id === req.params.id);
  if (!l) return res.status(404).send("No encontrada");
  res.type("text/html").send(htmlLiquidacion(l));
});

app.get("/api/liquidaciones/:id/texto", authMiddleware, (req, res) => {
  const l = liquidaciones.find(l => l.id === req.params.id);
  if (!l) return res.status(404).send("No encontrada");
  res.type("text/plain").send(textoPlano(l));
});

function f(n) { return Number(n || 0).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function textoPlano(l) {
  let t = "";
  t += "=================================================================\n";
  t += "          LIQUIDACION DE COMPLEJO DE MINERAL\n";
  t += "                  POTOSI - BOLIVIA\n";
  t += "=================================================================\n\n";
  t += `  LOTE: ${l["NUMERO DE LOTE"]}\n\n`;
  t += `  Productor: ${l["PRODUCTOR TIPO"]}\tCooperativa: ${l["COOPERATIVA"]}\n`;
  t += `  Fecha de entrega: ${l["FECHA DE ENTREGA"]}\tFecha de liquidacion: ${l["FECHA DE PAGO"]}\n`;
  t += `  Nombre y Apellido: ${l["NOMBRE Y APELLIDO"]}\n`;
  t += `  TC/Oficial: ${l["TC OFICIAL"]}\t\tTipo cambio: ${l["TIPO CAMBIO"]}\n`;
  t += `  Ley [Pb]: ${l["LEY DE [Pb]"]}\tLey [Ag]: ${l["LEY DE [Ag]"]}\tLey [Zn]: ${l["LEY DE [Zn]"]}\n\n`;
  t += "  TMB\t\tTARA\t\tTMNB\t\tH2O (%)\t\tTMNS\n";
  t += "  " + "-".repeat(60) + "\n";
  t += `  ${f(l["PESO BRUTO"])}\t${f(l["TARA"])}\t${f(l["PESO NETO"])}\t${f(l["H2O (%)"])}\t${f(l["TMNS"])}\n\n`;
  t += "  LEY (%)\tKLS FINOS\tLB FINAS\t$US/TMN\t\tVAL MIN $US\tVAL MIN BS\n";
  t += "  " + "-".repeat(60) + "\n";
  t += `  ${(l["LEY (%)"]/100).toFixed(2)}\t${f(l["KLS FINOS"])}\t${f(l["LB FINAS"])}\t${f(l["PRECIO P/Tn [$us]"])}\t${f(l["VAL MIN $US"])}\t${f(l["VAL MIN BS"])}\n\n`;
  t += "  RETENCIONES\n";
  for (const [n2, info] of Object.entries(l["RETENCIONES"])) {
    t += `  ${n2}\t\t${info.porcentaje}%\t${f(info.monto)} Bs\n`;
  }
  t += `  TOTAL RETENCION\t\t\t${f(l["TOTAL RETENCION"])} Bs\n`;
  t += `  SUB TOTAL Bs.\t\t\t\t${f(l["SUB TOTAL Bs."])} Bs\n`;
  t += `  (-) ANTICIPOS\t\t\t\t${f(l["ANTICIPOS"])} Bs\n`;
  t += `  (-) TRASNPORTE\t\t\t\t${f(l["TRANSPORTE"])} Bs\n`;
  t += `  (-) PORCENTAJE\t\t\t\t${f(l["PORCENTAJE"])} Bs\n`;
  t += `  (-) DIESEL Y TOPES\t\t\t${f(l["DIESEL Y TOPES"])} Bs\n`;
  t += "  " + "=".repeat(60) + "\n";
  t += `  LIQUIDO PAGABLE Bs.\t\t\t${f(l["LIQUIDO PAGABLE [Bs]"])} Bs\n`;
  t += "  " + "=".repeat(60) + "\n";
  t += `  INTERESETADO\t\tGERENTE\t\tCAJERO\n  ${l["NOMBRE Y APELLIDO"]}\n`;
  return t;
}

function htmlLiquidacion(l) {
  const F = v => Number(v||0).toLocaleString("es-BO", {minimumFractionDigits:2, maximumFractionDigits:2});
  let retRows = "";
  const retNames = ["CAJA","COMIBOL","FEDECOMIN","WISTERMAN","FENCOMIN","REGALIA Zn-Ag"];
  for (const rn of retNames) {
    const ri = l["RETENCIONES"][rn] || {porcentaje:0, monto:0};
    retRows += `<tr>
      <td class="cell-label">${rn}</td>
      <td class="cell-center">${ri.porcentaje/100}</td>
      <td class="cell-right">${F(ri.monto)}</td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Liquidacion ${l["NUMERO DE LOTE"]}</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, sans-serif; font-size: 10px; color: #000; background: #f5f5f5; }
.print-btn { text-align: center; padding: 12px; background: #fff; border-bottom: 1px solid #ccc; position: sticky; top: 0; z-index: 10; }
.print-btn button { padding: 8px 30px; font-size: 13px; cursor: pointer; background: #3b82f6; color: #fff; border: none; border-radius: 6px; }
.print-btn button:hover { background: #2563eb; }
.sheet { max-width: 900px; margin: 15px auto; background: #fff; border: 1px solid #999; padding: 20px 25px; }
.sheet-title { text-align: center; margin-bottom: 4px; font-size: 14px; font-weight: bold; }
.sheet-subtitle { text-align: center; margin-bottom: 10px; font-size: 12px; font-weight: bold; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 2px 15px; font-size: 10px; margin-bottom: 10px; padding: 0 5px; }
.info-grid .lbl { font-weight: bold; }
.main-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5px; }
.main-table th { background: #d9d9d9; border: 1px solid #000; padding: 3px 4px; text-align: center; font-size: 9px; font-weight: bold; }
.main-table td { border: 1px solid #000; padding: 3px 4px; text-align: center; }
.cell-right { text-align: right !important; }
.cell-center { text-align: center !important; }
.cell-label { text-align: left !important; font-weight: bold; }
.ret-title { font-weight: bold; font-size: 10px; padding: 4px 0; margin-bottom: 2px; }
.ret-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 9.5px; }
.ret-table th { background: #d9d9d9; border: 1px solid #000; padding: 3px 5px; text-align: left; }
.ret-table td { border: 1px solid #000; padding: 3px 5px; }
.ret-table .total-row td { font-weight: bold; background: #e8e8e8; }
.ded-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9.5px; }
.ded-table td { border: 1px solid #000; padding: 3px 6px; }
.ded-table .ded-marker { text-align: center; width: 30px; font-weight: bold; }
.ded-table .ded-label { text-align: left; }
.ded-table .ded-value { text-align: right; font-weight: bold; }
.total-box { margin-top: 10px; border: 2px solid #000; padding: 8px 15px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: bold; }
.firmas { margin-top: 25px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; text-align: center; font-size: 10px; }
.firmas div { padding-top: 5px; }
.firmas .sig-line { border-top: 1px solid #000; margin-bottom: 3px; }
.firmas .sig-name { font-size: 10px; }
@media print { body { background: #fff; } .print-btn { display: none; } .sheet { border: none; margin: 0; box-shadow: none; max-width: 100%; } }
</style>
</head>
<body>
<div class="print-btn"><button onclick="window.print()">&#128424; Imprimir / Guardar PDF</button></div>
<div class="sheet">
  <div class="sheet-title">POTOSI - BOLIVIA</div>
  <div class="sheet-subtitle">LIQUIDACION DE COMPLEJO DE MINERAL</div>
  <div class="info-grid">
    <div><span class="lbl">Productor:</span> ${l["PRODUCTOR TIPO"]}</div>
    <div></div>
    <div><span class="lbl">Cooperativa:</span> ${l["COOPERATIVA"]}</div>
    <div><span class="lbl">LOTE:</span> ${l["NUMERO DE LOTE"]}</div>
    <div><span class="lbl">Fecha de entrega</span></div>
    <div>${l["FECHA DE ENTREGA"]}</div>
    <div><span class="lbl">Fecha de liquidacion</span></div>
    <div>${l["FECHA DE PAGO"]}</div>
    <div><span class="lbl">Nombre y Apellido:</span></div>
    <div>${l["NOMBRE Y APELLIDO"]}</div>
    <div><span class="lbl">TC/Oficial</span></div>
    <div>${l["TC OFICIAL"]}</div>
    <div></div><div></div>
    <div><span class="lbl">Tipo cambio</span></div>
    <div>${l["TIPO CAMBIO"]}</div>
    <div></div><div></div>
    <div><span class="lbl">Ley [Pb]:</span> ${l["LEY DE [Pb]"]}</div>
    <div><span class="lbl">Ley [Ag]:</span> ${l["LEY DE [Ag]"]}</div>
    <div></div><div></div>
    <div><span class="lbl">Ley [Zn]:</span> ${l["LEY DE [Zn]"]}</div>
    <div></div>
  </div>
  <table class="main-table">
    <thead><tr><th>TMB</th><th>TARA</th><th>TMNB</th><th>H2O (%)</th><th>TMNS</th><th>LEY (%)</th><th>KLS FINOS</th><th>LB FINAS</th><th>$US/TMN</th><th>VAL MIN $US</th><th>VAL MIN BS</th></tr></thead>
    <tbody><tr>
      <td>${F(l["PESO BRUTO"])}</td><td>${F(l["TARA"])}</td><td>${F(l["PESO NETO"])}</td><td>${F(l["H2O (%)"])}</td><td>${F(l["TMNS"])}</td>
      <td>${(l["LEY (%)"]/100).toFixed(2)}</td><td>${F(l["KLS FINOS"])}</td><td>${F(l["LB FINAS"])}</td><td>${F(l["PRECIO P/Tn [$us]"])}</td>
      <td>${F(l["VAL MIN $US"])}</td><td>${F(l["VAL MIN BS"])}</td>
    </tr></tbody>
  </table>
  <div class="ret-title">RETENCIONES</div>
  <table class="ret-table">
    <thead><tr><th style="width:200px">Concepto</th><th style="width:100px">Factor</th><th>Monto (Bs)</th></tr></thead>
    <tbody>${retRows}
      <tr class="total-row"><td>TOTAL RETENCION</td><td></td><td class="cell-right">${F(l["TOTAL RETENCION"])}</td></tr>
    </tbody>
  </table>
  <table class="ded-table">
    <tr><td class="ded-label" style="padding-left:50%">SUB TOTAL Bs.</td><td class="ded-value" style="width:150px">${F(l["SUB TOTAL Bs."])}</td></tr>
    <tr><td class="ded-marker">(-)</td><td class="ded-label">ANTICIPOS</td><td class="ded-value">${F(l["ANTICIPOS"])}</td></tr>
    <tr><td class="ded-marker">(-)</td><td class="ded-label">TRASNPORTE</td><td class="ded-value">${F(l["TRANSPORTE"])}</td></tr>
    <tr><td class="ded-marker">(-)</td><td class="ded-label">PORCENTAJE</td><td class="ded-value">${F(l["PORCENTAJE"])}</td></tr>
    <tr><td class="ded-marker">(-)</td><td class="ded-label">DIESEL Y TOPES</td><td class="ded-value">${F(l["DIESEL Y TOPES"])}</td></tr>
  </table>
  <div class="total-box"><span>LIQUIDO PAGABLE Bs.</span><span>${F(l["LIQUIDO PAGABLE [Bs]"])}</span></div>
  <div class="firmas">
    <div><div class="sig-line"></div><div class="sig-name">INTERESADO</div></div>
    <div><div class="sig-line"></div><div class="sig-name">GERENTE</div></div>
    <div><div class="sig-line"></div><div class="sig-name">CAJERO</div></div>
  </div>
  <div style="text-align:center;margin-top:4px;font-size:10px">${l["NOMBRE Y APELLIDO"]}</div>
</div>
</body></html>`;
}

// ===================== SPA FALLBACK =====================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  Sistema de Liquidaciones corriendo en http://localhost:${PORT}\n`);
});
