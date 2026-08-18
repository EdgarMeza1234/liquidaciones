const { createApp, ref, reactive, computed, onMounted } = Vue;

createApp({
  setup() {
    const v = ref("dash");
    const sb = ref(false);
    const modal = ref(null);
    const busq = ref("");
    const fdesde = ref("");
    const fhasta = ref("");
    const toast = reactive({ show: false, message: "", type: "success" });
    function showToast(m, t = "success") { toast.message = m; toast.type = t; toast.show = true; setTimeout(() => toast.show = false, 3000); }

    // ===================== AUTH =====================
    const token = ref(localStorage.getItem("liq_token") || "");
    const currentUser = ref(localStorage.getItem("liq_user") || "");
    const authenticated = ref(false);
    const loginForm = reactive({ user: "", pass: "" });
    const loginError = ref("");
    const loggingIn = ref(false);

    function authHeaders() {
      return token.value ? { "Authorization": "Bearer " + token.value } : {};
    }

    async function authFetch(url, opts = {}) {
      opts.headers = { ...(opts.headers || {}), ...authHeaders() };
      const r = await fetch(url, opts);
      if (r.status === 401) { doLogout(); throw new Error("Sesion expirada"); }
      return r;
    }

    async function checkAuth() {
      if (!token.value) { authenticated.value = false; return false; }
      try {
        const r = await fetch("/api/verify", { headers: authHeaders() });
        if (r.ok) { authenticated.value = true; return true; }
      } catch {}
      doLogout();
      return false;
    }

    async function doLogin() {
      if (!loginForm.user || !loginForm.pass) { loginError.value = "Ingrese usuario y contraseña"; return; }
      loggingIn.value = true;
      loginError.value = "";
      try {
        const r = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: loginForm.user, pass: loginForm.pass })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) { loginError.value = d.error || "Credenciales incorrectas"; loggingIn.value = false; return; }
        token.value = d.token;
        currentUser.value = d.user;
        localStorage.setItem("liq_token", d.token);
        localStorage.setItem("liq_user", d.user);
        authenticated.value = true;
        loginForm.user = "";
        loginForm.pass = "";
        await cargarCfg();
        await cargarHistorial();
        await cargarRes();
      } catch (e) { loginError.value = "Error de conexion"; }
      loggingIn.value = false;
    }

    function doLogout() {
      token.value = "";
      currentUser.value = "";
      authenticated.value = false;
      localStorage.removeItem("liq_token");
      localStorage.removeItem("liq_user");
    }

    function printUrl(id) { return `/api/liquidaciones/${id}/imprimir?token=${encodeURIComponent(token.value)}`; }
    function txtUrl(id) { return `/api/liquidaciones/${id}/texto?token=${encodeURIComponent(token.value)}`; }

    // ===================== APP =====================
    const res = reactive({ total: 0, pagable: 0, retenciones: 0, mineral: 0, productores: 0 });
    const cfgData = reactive({ retenciones: {}, PORCENTAJE: 30, TRANSPORTE: 700, DIESEL_BASE: 480, DIESEL_BARRILES: 15, DIESEL_PRECIO_BARRIL: 140, FACTOR_LB: 2.2046223, TC_OFICIAL: 6.96 });
    const cfgF = reactive({ retenciones: {}, PORCENTAJE: 30, TRANSPORTE: 700, DIESEL_BASE: 480, DIESEL_BARRILES: 15, DIESEL_PRECIO_BARRIL: 140, FACTOR_LB: 2.2046223, TC_OFICIAL: 6.96 });

    const mkF = () => ({
      "NUMERO DE LOTE": "", "NOMBRE Y APELLIDO": "", "COOPERATIVA": "", "PRODUCTOR TIPO": "Particular",
      "FECHA DE ENTREGA": new Date().toISOString().split("T")[0], "FECHA DE PAGO": new Date().toISOString().split("T")[0],
      "PESO BRUTO": null, "TARA": null, "H2O (%)": null, "LEY (%)": null,
      "LEY DE [Pb]": 0, "PRECIO P/LEY [Pb]": 0,
      "LEY DE [Ag]": 0, "PRECIO P/LEY [Ag]": 0,
      "LEY DE [Zn]": 0, "PRECIO P/LEY [Zn]": 0,
      "TIPO CAMBIO": null, "ANTICIPOS": 0, "TRANSPORTE": cfgData.TRANSPORTE,
    });
    const f = reactive(mkF());

    const historial = ref([]);

    const pesoNeto = computed(() => (Number(f["PESO BRUTO"]) || 0) - (Number(f["TARA"]) || 0));
    const precioTn = computed(() => {
      return ((Number(f["LEY DE [Pb]"]) || 0) * (Number(f["PRECIO P/LEY [Pb]"]) || 0)) +
             ((Number(f["LEY DE [Ag]"]) || 0) * (Number(f["PRECIO P/LEY [Ag]"]) || 0)) +
             ((Number(f["LEY DE [Zn]"]) || 0) * (Number(f["PRECIO P/LEY [Zn]"]) || 0));
    });

    const previewVal = computed(() => {
      const pb = Number(f["PESO BRUTO"]) || 0, ta = Number(f["TARA"]) || 0;
      const h2o = Number(f["H2O (%)"]) || 0, lp = Number(f["LEY (%)"]) || 0;
      if (!pb || !ta || !h2o) return null;
      const tmnb = pb - ta;
      const tmns = tmnb - (tmnb * h2o / 100);
      const pt = precioTn.value;
      const tc = Number(f["TIPO CAMBIO"]) || 0;
      const klS = tmns * (lp / 100);
      const lbF = klS * cfgData.FACTOR_LB;
      const vUs = pt * tmns / 1000;
      const vBs = vUs * tc;
      const rets = {};
      let totalRet = 0;
      for (const [nombre, pct] of Object.entries(cfgData.retenciones)) {
        const monto = vBs * (pct / 100);
        rets[nombre] = { porcentaje: pct, monto: r2(monto) };
        totalRet += monto;
      }
      const sub = vBs - totalRet;
      const antic = Number(f["ANTICIPOS"]) || 0;
      const trans = Number(f["TRANSPORTE"]) || cfgData.TRANSPORTE;
      const porc = sub * (cfgData.PORCENTAJE / 100);
      const dies = cfgData.DIESEL_BASE + (cfgData.DIESEL_BARRILES * (cfgData.DIESEL_PRECIO_BARRIL || 140));
      return {
        TMNS: r2(tmns), KLS: r2(klS), LB: r2(lbF), usTmn: r2(pt),
        valUs: r2(vUs), valBs: r2(vBs),
        retenciones: rets, totalRet: r2(totalRet),
        sub: r2(sub), antic, trans, porc: r2(porc), diesel: r2(dies),
        liq: r2(sub - antic - trans - porc - dies)
      };
    });

    function r2(n) { return Math.round(n * 100) / 100; }
    function fmtN(n) { return Number(n || 0).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtBs(n) { return Number(n || 0).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    const histFiltrado = computed(() => {
      let r = historial.value;
      if (busq.value) { const q = busq.value.toLowerCase(); r = r.filter(l => (l["NOMBRE Y APELLIDO"]||"").toLowerCase().includes(q) || (l["NUMERO DE LOTE"]||"").toLowerCase().includes(q) || (l["COOPERATIVA"]||"").toLowerCase().includes(q)); }
      if (fdesde.value) r = r.filter(l => l["FECHA DE ENTREGA"] >= fdesde.value);
      if (fhasta.value) r = r.filter(l => l["FECHA DE ENTREGA"] <= fhasta.value);
      return r;
    });
    const totH = computed(() => ({
      valor: histFiltrado.value.reduce((s, l) => s + (l["VAL MIN BS"] || 0), 0),
      pagable: histFiltrado.value.reduce((s, l) => s + (l["LIQUIDO PAGABLE [Bs]"] || 0), 0),
    }));

    function go(who) { v.value = who; if (who === "nueva") Object.assign(f, mkF()); if (who === "hist") cargarHistorial(); if (who === "cfg") cargarCfg(); if (who === "dash") cargarRes(); }

    async function cargarRes() { try { Object.assign(res, await (await authFetch("/api/resumen")).json()); } catch(e){} }
    async function cargarCfg() {
      try { const d = await (await authFetch("/api/config")).json(); Object.assign(cfgData, d); Object.assign(cfgF, JSON.parse(JSON.stringify(d))); } catch(e){}
    }
    async function cargarHistorial() {
      try { historial.value = await (await authFetch("/api/liquidaciones")).json(); await cargarRes(); } catch(e){}
    }
    async function guardar() {
      try {
        const r = await authFetch("/api/liquidaciones", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({...f}) });
        if (!r.ok) throw 0;
        const res = await r.json();
        showToast("Liquidacion guardada correctamente");
        await cargarRes();
        modal.value = res;
      } catch(e) { showToast("Error al guardar", "error"); }
    }
    async function eliminar(l) {
      if (!confirm(`Eliminar lote ${l["NUMERO DE LOTE"]} (${l["NOMBRE Y APELLIDO"]})?`)) return;
      try { await authFetch(`/api/liquidaciones/${l.id}`, {method:"DELETE"}); showToast("Eliminada"); await cargarHistorial(); } catch(e) { showToast("Error", "error"); }
    }
    function ver(l) { modal.value = l; }
    function imprimir(l) { window.open(printUrl(l.id), "_blank"); }
    function descTxt(id) { window.open(txtUrl(id), "_blank"); }
    async function guardarCfg() {
      try { await authFetch("/api/config", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({...cfgF}) }); Object.assign(cfgData, JSON.parse(JSON.stringify(cfgF))); showToast("Configuracion guardada"); } catch(e) { showToast("Error", "error"); }
    }

    onMounted(async () => {
      const ok = await checkAuth();
      if (ok) { await cargarCfg(); await cargarHistorial(); await cargarRes(); }
    });

    return {
      v, sb, modal, busq, fdesde, fhasta, toast, res, cfgData, cfgF, f, historial,
      pesoNeto, precioTn, previewVal, histFiltrado, totH,
      go, fmtN, fmtBs, guardar, eliminar, ver, imprimir, descTxt, guardarCfg, cargarHistorial,
      authenticated, currentUser, loginForm, loginError, loggingIn, doLogin, doLogout,
    };
  },
}).mount("#app");
