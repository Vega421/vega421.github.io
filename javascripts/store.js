// Store page (overrides/store.html + docs/store/index.md): lists packages from the
// Tebex Headless API, keeps a cart, sends buyers through FiveM login and opens the
// Tebex checkout. Only the public token is used; the private key must never be here.
(function () {
  "use strict";

  var API = "https://headless.tebex.io/api";
  var TEBEX_JS = "https://js.tebex.io/v/1.js";
  var KEY_BASKET = "vega-store-basket";
  var KEY_PENDING = "vega-store-pending";

  var ICONS = {
    server: '<path d="M4 3h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 11h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zm3-8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>',
    support: '<path d="M12 2a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h2.9a3 3 0 0 1-2.9 2h-3v2h3a5 5 0 0 0 5-5v-7a9 9 0 0 0-9-9z"/>',
    script: '<path d="m8.6 16.6-4.6-4.6 4.6-4.6L7.2 6 1.2 12l6 6zm6.8 0 4.6-4.6-4.6-4.6L16.8 6l6 6-6 6zM13.9 3.5l1.9.6-5.7 16.4-1.9-.6z"/>'
  };
  var FRAMEWORKS = [["Qbox", /qbox|qbx/i], ["QBCore", /qbcore|\bqb\b/i], ["ESX", /\besx\b/i], ["vRP", /\bvrp\b/i]];

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
    } catch (e) {
      return Number(amount).toFixed(2) + " " + (currency || "");
    }
  }

  function plain(html) {
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }

  // Tebex returns media either as URLs or as {type, url}
  function firstImage(pkg) {
    var list = pkg.media || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (typeof m === "string") return m;
      if (m && m.url && m.type !== "video") return m.url;
    }
    return pkg.image || "";
  }

  function kindOf(pkg, cat) {
    var s = (pkg.name + " " + (cat ? cat.name : "")).toLowerCase();
    if (/support|help|setup/.test(s)) return "support";
    if (/server|pack/.test(s)) return "server";
    return "script";
  }

  // link name for a package: its Tebex slug, or one made from the name
  function slugOf(pkg) {
    return pkg.slug || String(pkg.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || String(pkg.id);
  }

  function ago(iso) {
    var t = Date.parse(iso);
    if (!t) return "";
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return m <= 1 ? "just now" : m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }

  function frameworks(pkg) {
    return FRAMEWORKS.filter(function (f) { return f[1].test(pkg.name); }).map(function (f) { return f[0]; });
  }

  // Card colours by framework ([glow, shadow]); scripts without one keep their kind's colours
  var PALETTE = {
    Qbox: ["#ff6b2c", "#8a2a08"], QBCore: ["#ff4d5e", "#6b0f1f"], ESX: ["#3b82f6", "#0f2a66"],
    vRP: ["#22c55e", "#0b4a2a"], Standalone: ["#14b8a6", "#0b4a52"]
  };

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function icon(kind) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = ICONS[kind];
    return svg;
  }

  function Store(root) {
    this.root = root;
    this.token = root.getAttribute("data-token");
    this.tabs = root.querySelector(".vs-tabs");
    this.grid = root.querySelector(".vs-grid");
    this.search = root.querySelector(".vs-search input");
    this.cartBtn = root.querySelector(".vs-cart-btn");
    this.cartCount = root.querySelector(".vs-cart-count");
    this.drawer = root.querySelector(".vs-drawer");
    this.overlay = root.querySelector(".vs-overlay");
    this.drawerBody = root.querySelector(".vs-drawer-body");
    this.drawerFoot = root.querySelector(".vs-drawer-foot");
    this.userEl = root.querySelector(".vs-user");
    this.dialog = root.querySelector(".vs-dialog");
    this.dialogBody = root.querySelector(".vs-dialog-body");
    this.categories = [];
    this.active = "all";
    this.query = "";
    this.sort = "featured";
    this.sortEl = root.querySelector(".vs-sort select");
    this.proof = root.querySelector(".vs-proof");
    this.basket = null;
    this.busy = false;
  }

  Store.prototype.api = function (path, opts, basketOnly) {
    var base = basketOnly ? API + "/baskets" : API + "/accounts/" + this.token;
    opts = opts || {};
    if (opts.body) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(base + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { /* not JSON */ }
        if (!r.ok) {
          var err = new Error((data && (data.detail || data.message || data.title)) || ("HTTP " + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  };

  Store.prototype.start = function () {
    var self = this;
    var params = new URLSearchParams(location.search);
    if (params.has("done")) {
      store(KEY_BASKET, null);
      this.toast("Thank you! Your purchase is on its way to your Cfx.re account.");
      history.replaceState(null, "", location.pathname);
    }

    this.cartBtn.addEventListener("click", function () { self.openCart(); });
    this.overlay.addEventListener("click", function () { self.closeCart(); });
    this.root.querySelector(".vs-drawer-close").addEventListener("click", function () { self.closeCart(); });
    this.root.querySelector(".vs-dialog-close").addEventListener("click", function () { self.dialog.close(); });
    this.dialog.addEventListener("click", function (e) { if (e.target === self.dialog) self.dialog.close(); });
    this.onKey = function (e) { if (e.key === "Escape") self.closeCart(); };
    document.addEventListener("keydown", this.onKey);
    this.sortEl.addEventListener("change", function () {
      self.sort = self.sortEl.value;
      self.renderGrid();
    });
    this.dialog.addEventListener("close", function () {
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    });
    // buttons outside the store (the featured script in the hero) open a product's details
    this.onOpen = function (e) {
      var a = e.target.closest && e.target.closest("[data-open]");
      if (!a || !self.categories.length) return;
      e.preventDefault();
      history.replaceState(null, "", "#" + a.getAttribute("data-open"));
      self.openFromHash();
    };
    document.addEventListener("click", this.onOpen);
    this.onHash = function () { self.openFromHash(); };
    window.addEventListener("hashchange", this.onHash);
    this.search.addEventListener("input", function () {
      self.query = self.search.value.trim().toLowerCase();
      self.renderGrid();
    });

    Promise.all([
      this.api("/categories?includePackages=1"),
      this.loadBasket()
    ]).then(function (res) {
      self.categories = self.withSoon(self.withFree(res[0].data || [])).filter(function (c) {
        return c.packages && c.packages.length > 0;
      });
      self.renderTabs();
      self.renderGrid();
      self.openFromHash();
      self.loadProof();
      return self.finishPendingAdd();
    }).catch(function (e) {
      self.grid.innerHTML = "";
      self.grid.appendChild(el("p", "vs-empty", "The store couldn't load (" + e.message + "). Please try again later."));
    });
  };

  // Free scripts (page settings) go into the Tebex category named "Free", or a new one
  Store.prototype.withFree = function (cats) {
    var list = [];
    try { list = JSON.parse(this.root.getAttribute("data-free") || "[]") || []; } catch (e) { list = []; }
    if (!list.length) return cats;
    var free = null;
    for (var i = 0; i < cats.length; i++) if (/^free$/i.test(cats[i].name)) free = cats[i];
    if (!free) { free = { id: "free", name: "Free", packages: [] }; cats.push(free); }
    list.forEach(function (f) {
      free.packages.push({
        id: "free-" + f.name, name: f.name, slug: String(f.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: f.text || "", total_price: 0, discount: 0, currency: "USD", free: f,
        media: f.image ? [{ type: "image", url: new URL("../" + f.image, location.href).href }] : []
      });
    });
    return cats;
  };

  // "Coming soon" scripts (page settings) get their own tab, kept out of "All"
  Store.prototype.withSoon = function (cats) {
    var list = [];
    try { list = JSON.parse(this.root.getAttribute("data-soon") || "[]") || []; } catch (e) { list = []; }
    if (!list.length) return cats;
    cats.push({
      id: "coming-soon", name: "Coming soon", soonTab: true,
      packages: list.map(function (s) {
        return {
          id: "soon-" + s.name, name: s.name, slug: String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          description: s.text || "", total_price: 0, discount: 0, currency: "USD", media: [], soon: s
        };
      })
    });
    return cats;
  };

  // ---------- Cart state ----------

  Store.prototype.loadBasket = function () {
    var self = this;
    var ident = store(KEY_BASKET);
    if (!ident) { this.setBasket(null); return Promise.resolve(null); }
    return this.api("/baskets/" + ident).then(function (res) {
      var b = res && res.data;
      if (!b || b.complete) { store(KEY_BASKET, null); b = null; }
      self.setBasket(b);
      return b;
    }).catch(function () {
      store(KEY_BASKET, null);
      self.setBasket(null);
      return null;
    });
  };

  Store.prototype.ensureBasket = function () {
    var self = this;
    if (this.basket) return Promise.resolve(this.basket);
    var here = location.origin + location.pathname;
    return this.api("/baskets", {
      method: "POST",
      body: { complete_url: here + "?done=1", cancel_url: here, complete_auto_redirect: true }
    }).then(function (res) {
      store(KEY_BASKET, res.data.ident);
      self.setBasket(res.data);
      return res.data;
    });
  };

  Store.prototype.setBasket = function (b) {
    this.basket = b;
    var items = (b && b.packages) || [];
    var n = items.reduce(function (sum, p) { return sum + ((p.in_basket && p.in_basket.quantity) || 1); }, 0);
    this.cartCount.textContent = String(n);
    this.cartCount.hidden = n === 0;
    this.renderCart();
    if (this.categories.length) this.renderGrid();
  };

  Store.prototype.inBasket = function (id) {
    var list = (this.basket && this.basket.packages) || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return true;
    }
    return false;
  };

  // ---------- Actions ----------

  Store.prototype.login = function (pendingPackageId) {
    var self = this;
    if (pendingPackageId) store(KEY_PENDING, String(pendingPackageId));
    return this.ensureBasket().then(function (b) {
      var back = encodeURIComponent(location.origin + location.pathname);
      return self.api("/baskets/" + b.ident + "/auth?returnUrl=" + back);
    }).then(function (links) {
      var link = (links || [])[0];
      if (!link || !link.url) throw new Error("No login link from Tebex.");
      location.href = link.url;
    });
  };

  Store.prototype.add = function (pkgId) {
    var self = this;
    if (!this.basket || !this.basket.username) return this.login(pkgId);
    return this.api("/" + this.basket.ident + "/packages", {
      method: "POST", body: { package_id: String(pkgId), quantity: 1 }
    }, true).then(function (res) {
      self.setBasket(res.data);
      if (self.dialog.open) self.dialog.close();
      self.openCart();
    });
  };

  Store.prototype.finishPendingAdd = function () {
    var pending = store(KEY_PENDING);
    if (!pending) return;
    store(KEY_PENDING, null);
    if (this.basket && this.basket.username) {
      var self = this;
      return this.add(pending).catch(function (e) { self.toast(e.message, true); });
    }
  };

  Store.prototype.remove = function (pkgId) {
    var self = this;
    return this.api("/" + this.basket.ident + "/packages/remove", {
      method: "POST", body: { package_id: String(pkgId) }
    }, true).then(function (res) { self.setBasket(res.data); });
  };

  Store.prototype.setQuantity = function (pkgId, qty) {
    var self = this;
    if (qty < 1) return this.remove(pkgId);
    return this.api("/" + this.basket.ident + "/packages/" + pkgId, {
      method: "PUT", body: { quantity: qty }
    }, true).then(function () { return self.loadBasket(); });
  };

  Store.prototype.coupon = function (code) {
    var self = this;
    return this.api("/baskets/" + this.basket.ident + "/coupons", {
      method: "POST", body: { coupon_code: code }
    }).then(function () {
      self.toast("Coupon applied.");
      return self.loadBasket();
    });
  };

  Store.prototype.logout = function () {
    store(KEY_BASKET, null);
    this.setBasket(null);
  };

  Store.prototype.checkout = function () {
    var self = this;
    var ident = this.basket.ident;
    return loadTebexJs().then(function (Tebex) {
      var dark = document.body.getAttribute("data-md-color-scheme") === "slate";
      self.closeCart();
      Tebex.checkout.init({
        ident: ident,
        theme: dark ? "dark" : "light",
        colors: [
          { name: "primary", color: "#ff6b2c" },
          { name: "secondary", color: dark ? "#151821" : "#ffffff" }
        ]
      });
      Tebex.checkout.on(Tebex.events.PAYMENT_COMPLETE, function () {
        store(KEY_BASKET, null);
        self.setBasket(null);
        self.toast("Thank you! Your purchase is on its way to your Cfx.re account.");
      });
      Tebex.checkout.launch();
    }).catch(function () {
      var link = self.basket && self.basket.links && self.basket.links.checkout;
      if (link) location.href = link;
      else throw new Error("Checkout couldn't open. Please try again.");
    });
  };

  // runs a button action: disables it, shows errors
  Store.prototype.run = function (btn, fn) {
    var self = this;
    if (this.busy) return;
    this.busy = true;
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    Promise.resolve().then(fn).catch(function (e) {
      self.toast(e.message || "Something went wrong.", true);
    }).then(function () {
      self.busy = false;
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    });
  };

  Store.prototype.openCart = function () {
    this.overlay.hidden = false;
    this.drawer.classList.add("is-open");
    this.drawer.setAttribute("aria-hidden", "false");
    this.cartBtn.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("vs-lock");
  };

  Store.prototype.closeCart = function () {
    this.overlay.hidden = true;
    this.drawer.classList.remove("is-open");
    this.drawer.setAttribute("aria-hidden", "true");
    this.cartBtn.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("vs-lock");
  };

  // ---------- Rendering ----------

  Store.prototype.renderTabs = function () {
    var self = this;
    this.tabs.innerHTML = "";
    var all = [{ id: "all", name: "All" }].concat(this.categories);
    all.forEach(function (c) {
      var on = String(c.id) === String(self.active);
      var b = el("button", "vs-tab" + (on ? " is-active" : ""), c.name);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.addEventListener("click", function () {
        self.active = c.id;
        self.renderTabs();
        self.renderGrid();
      });
      self.tabs.appendChild(b);
    });
  };

  Store.prototype.renderGrid = function () {
    var self = this;
    this.grid.innerHTML = "";
    var q = this.query;
    var list = [];
    this.categories.forEach(function (cat) {
      if (self.active === "all" ? cat.soonTab : String(cat.id) !== String(self.active)) return;
      cat.packages.forEach(function (p) {
        if (q && (p.name + " " + plain(p.description) + " " + cat.name).toLowerCase().indexOf(q) === -1) return;
        list.push({ p: p, cat: cat });
      });
    });
    if (this.sort === "price-asc") list.sort(function (a, b) { return a.p.total_price - b.p.total_price; });
    else if (this.sort === "price-desc") list.sort(function (a, b) { return b.p.total_price - a.p.total_price; });
    else if (this.sort === "name") list.sort(function (a, b) { return a.p.name.localeCompare(b.p.name); });
    list.forEach(function (x, i) {
      var c = self.card(x.p, x.cat);
      c.style.setProperty("--i", String(Math.min(i, 8)));
      self.grid.appendChild(c);
    });
    if (!list.length) {
      this.grid.appendChild(el("p", "vs-empty", q ? "Nothing matches “" + this.search.value + "”." : "Nothing for sale here yet. Check back soon."));
    }
  };

  Store.prototype.art = function (p, cat, big) {
    var kind = kindOf(p, cat);
    var tags = p.free ? (p.free.tags || []) : p.soon ? (p.soon.tags || []) : frameworks(p);
    var fw = tags.filter(function (t) { return PALETTE[t] && t !== "Standalone"; })[0] || (tags.indexOf("Standalone") !== -1 ? "Standalone" : null);
    var h = hash(p.name);
    var wrap = el("div", "vs-art vs-art-" + kind + " vs-pat-" + (h % 3) + (big ? " vs-art-big" : ""));
    if (fw) {
      wrap.style.setProperty("--a", PALETTE[fw][0]);
      wrap.style.setProperty("--b", PALETTE[fw][1]);
    }
    // move the glow a little per product so cards of the same kind don't look identical
    wrap.style.setProperty("--gx", (55 + (h % 35)) + "%");
    wrap.style.setProperty("--gy", (10 + (h >> 3) % 30) + "%");
    var img = firstImage(p);
    if (img) {
      // the whole image (logos and square pictures aren't cropped) on a blurred copy of itself
      wrap.classList.add("vs-has-img");
      var blur = el("div", "vs-art-blur");
      blur.style.backgroundImage = "url(\"" + img.replace(/"/g, "%22") + "\")";
      wrap.appendChild(blur);
      var i = el("img");
      // pictures already shaped like the card (about 16:9) fill it edge to edge
      i.addEventListener("load", function () {
        var r = i.naturalWidth / (i.naturalHeight || 1);
        if (r > 1.6 && r < 1.95) wrap.classList.add("vs-img-fill");
      });
      i.src = img; i.alt = ""; i.loading = "lazy";
      wrap.appendChild(i);
    } else {
      wrap.appendChild(icon(kind));
    }
    var tags = el("div", "vs-tags");
    if (cat) tags.appendChild(el("span", "vs-tag", cat.name));
    if (p.discount > 0) tags.appendChild(el("span", "vs-tag vs-tag-sale", "Sale"));
    wrap.appendChild(tags);
    return wrap;
  };

  Store.prototype.priceEl = function (p) {
    var wrap = el("div", "vs-price");
    if (p.soon) {
      wrap.appendChild(el("strong", "vs-soon-price", "Soon"));
      wrap.appendChild(el("span", "vs-per", "In testing now"));
      return wrap;
    }
    if (p.discount > 0) wrap.appendChild(el("del", "", money(p.total_price + p.discount, p.currency)));
    wrap.appendChild(el("strong", "", p.total_price > 0 ? money(p.total_price, p.currency) : "Free"));
    if (p.free && p.free.version) wrap.appendChild(el("span", "vs-per", p.free.version + " · open source"));
    if (p.type === "subscription") wrap.appendChild(el("span", "vs-per", "per period"));
    return wrap;
  };

  Store.prototype.buyButton = function (p) {
    var self = this;
    if (p.soon) {
      var soon = el("span", "vs-btn vs-btn-soft vs-btn-static", "Not out yet");
      soon.setAttribute("aria-disabled", "true");
      return soon;
    }
    if (p.free) {
      var dl = el("a", "vs-btn vs-btn-primary", "Download");
      dl.href = p.free.download;
      dl.rel = "noopener";
      dl.addEventListener("click", function (e) { e.stopPropagation(); });
      return dl;
    }
    var owned = this.inBasket(p.id);
    var b = el("button", "vs-btn " + (owned ? "vs-btn-soft" : "vs-btn-primary"), owned ? "In cart ✓" : "Add to cart");
    b.type = "button";
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      if (owned) { self.openCart(); return; }
      self.run(b, function () { return self.add(p.id); });
    });
    return b;
  };

  Store.prototype.chips = function (p) {
    var fws = p.free ? (p.free.tags || []) : p.soon ? (p.soon.tags || []) : frameworks(p);
    if (!fws.length && !p.free) return null;
    var chips = el("div", "vs-chips");
    fws.forEach(function (f) { chips.appendChild(el("span", "vs-chip", f)); });
    if (p.free) chips.appendChild(el("span", "vs-chip vs-chip-free", "Free"));
    return chips;
  };

  Store.prototype.card = function (p, cat) {
    var self = this;
    var card = el("article", "vs-card");
    card.tabIndex = 0;
    card.setAttribute("aria-label", p.name + ", details");
    card.addEventListener("click", function () { self.details(p, cat); });
    card.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); self.details(p, cat); }
    });
    card.appendChild(this.art(p, cat));

    var body = el("div", "vs-card-body");
    var chips = this.chips(p);
    if (chips) body.appendChild(chips);
    body.appendChild(el("h3", "vs-card-title", p.name));
    var desc = plain(p.description);
    if (desc) body.appendChild(el("p", "vs-card-desc", desc));
    var foot = el("div", "vs-card-foot");
    foot.appendChild(this.priceEl(p));
    foot.appendChild(this.buyButton(p));
    body.appendChild(foot);
    card.appendChild(body);
    return card;
  };

  Store.prototype.details = function (p, cat) {
    var body = this.dialogBody;
    body.innerHTML = "";
    body.appendChild(this.art(p, cat, true));
    var inner = el("div", "vs-dialog-inner");
    var chips = this.chips(p);
    if (chips) inner.appendChild(chips);
    inner.appendChild(el("h2", "vs-dialog-title", p.name));
    var d = el("div", "vs-dialog-desc");
    d.innerHTML = p.description || ""; // written by the store owner in the Tebex panel
    inner.appendChild(d);
    var foot = el("div", "vs-dialog-foot");
    foot.appendChild(this.priceEl(p));
    var actions = el("div", "vs-dialog-actions");
    var link = location.origin + location.pathname + "#" + slugOf(p);
    var copy = el("button", "vs-btn vs-btn-ghost", "Copy link");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Link copied ✓"; setTimeout(function () { copy.textContent = "Copy link"; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, function () { prompt("Copy this link:", link); });
      else prompt("Copy this link:", link);
    });
    actions.appendChild(copy);
    if (p.free && p.free.docs) {
      var docs = el("a", "vs-btn vs-btn-ghost", "Docs");
      docs.href = new URL("../" + p.free.docs, location.href).href;
      actions.appendChild(docs);
    }
    actions.appendChild(this.buyButton(p));
    foot.appendChild(actions);
    inner.appendChild(foot);
    history.replaceState(null, "", "#" + slugOf(p));
    body.appendChild(inner);
    if (typeof this.dialog.showModal === "function") this.dialog.showModal();
    else this.dialog.setAttribute("open", "");
  };

  // /store/#esx-server opens that package's details
  Store.prototype.openFromHash = function () {
    var want = decodeURIComponent(location.hash.slice(1));
    if (!want) return;
    for (var i = 0; i < this.categories.length; i++) {
      var cat = this.categories[i];
      for (var j = 0; j < cat.packages.length; j++) {
        var p = cat.packages[j];
        if (slugOf(p) === want || String(p.id) === want) {
          if (!this.dialog.open) this.details(p, cat);
          return;
        }
      }
    }
  };

  // "Recently bought" from the store's Tebex sidebar modules; hidden when there's nothing real to show
  Store.prototype.loadProof = function () {
    var self = this;
    this.api("/sidebar").then(function (res) {
      var mods = (res && res.data) || [];
      var list = self.proof.querySelector(".vs-proof-list");
      var top = self.proof.querySelector(".vs-proof-top");
      var shown = false;
      mods.forEach(function (m) {
        if (m.type === "recent_payments" && m.data && m.data.payments) {
          m.data.payments.slice(0, 6).forEach(function (pay) {
            if (!pay.username || !pay.package) return;
            var li = el("li", "vs-proof-item");
            li.appendChild(el("span", "vs-proof-avatar", pay.username.charAt(0).toUpperCase()));
            var txt = el("span", "vs-proof-text");
            txt.appendChild(el("strong", "", pay.username));
            txt.appendChild(document.createTextNode(" bought "));
            txt.appendChild(el("strong", "", pay.package.name));
            li.appendChild(txt);
            if (pay.created_at) li.appendChild(el("span", "vs-proof-time", ago(pay.created_at)));
            list.appendChild(li);
            shown = true;
          });
        }
        if (m.type === "top_customer" && m.data && m.data.username) {
          top.textContent = "Top supporter: " + m.data.username;
          top.hidden = false;
          shown = true;
        }
      });
      self.proof.hidden = !shown;
    }).catch(function () { /* optional, stays hidden */ });
  };

  Store.prototype.renderCart = function () {
    var self = this;
    var b = this.basket;
    var body = this.drawerBody;
    var foot = this.drawerFoot;
    body.innerHTML = "";
    foot.innerHTML = "";
    this.userEl.innerHTML = "";
    this.userEl.hidden = !(b && b.username);

    if (b && b.username) {
      this.userEl.appendChild(el("span", "vs-user-dot"));
      var who = el("span", "vs-user-name");
      who.appendChild(document.createTextNode("Logged in as "));
      who.appendChild(el("strong", "", b.username));
      this.userEl.appendChild(who);
      var out = el("button", "vs-link", "Log out");
      out.type = "button";
      out.addEventListener("click", function () { self.logout(); });
      this.userEl.appendChild(out);
    }

    var items = (b && b.packages) || [];
    if (!items.length) {
      var empty = el("div", "vs-cart-empty");
      var ic = el("div", "vs-cart-empty-icon");
      ic.appendChild(icon("script"));
      empty.appendChild(ic);
      empty.appendChild(el("p", "", "Your cart is empty"));
      empty.appendChild(el("span", "", "Add something from the store to get started."));
      body.appendChild(empty);
      if (!b || !b.username) {
        var login = el("button", "vs-btn vs-btn-ghost vs-btn-block", "Log in with FiveM");
        login.type = "button";
        login.addEventListener("click", function () { self.run(login, function () { return self.login(); }); });
        foot.appendChild(login);
        foot.appendChild(el("p", "vs-fine", "You'll be asked to log in the first time you add something."));
      }
      return;
    }

    var list = el("ul", "vs-items");
    items.forEach(function (p) {
      var qty = (p.in_basket && p.in_basket.quantity) || 1;
      var kind = kindOf(p, null);
      var li = el("li", "vs-item");
      var thumb = el("div", "vs-item-thumb vs-art-" + kind);
      thumb.appendChild(icon(kind));
      li.appendChild(thumb);

      var info = el("div", "vs-item-info");
      info.appendChild(el("span", "vs-item-name", p.name));
      info.appendChild(el("span", "vs-item-price", money((p.in_basket && p.in_basket.price) || 0, b.currency)));
      var q = el("div", "vs-qty");
      var minus = el("button", "", "−"); minus.type = "button"; minus.setAttribute("aria-label", "One less");
      var plus = el("button", "", "+"); plus.type = "button"; plus.setAttribute("aria-label", "One more");
      minus.addEventListener("click", function () { self.run(minus, function () { return self.setQuantity(p.id, qty - 1); }); });
      plus.addEventListener("click", function () { self.run(plus, function () { return self.setQuantity(p.id, qty + 1); }); });
      q.appendChild(minus); q.appendChild(el("span", "", String(qty))); q.appendChild(plus);
      info.appendChild(q);
      li.appendChild(info);

      var rm = el("button", "vs-icon-btn vs-remove", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove " + p.name);
      rm.addEventListener("click", function () { self.run(rm, function () { return self.remove(p.id); }); });
      li.appendChild(rm);
      list.appendChild(li);
    });
    body.appendChild(list);

    (b.coupons || []).forEach(function (c) {
      body.appendChild(el("p", "vs-fine vs-left", "Coupon applied: " + (c.code || c.coupon_code || "")));
    });
    var form = el("form", "vs-coupon");
    var input = el("input");
    input.type = "text"; input.placeholder = "Coupon code"; input.setAttribute("aria-label", "Coupon code");
    var apply = el("button", "vs-btn vs-btn-ghost", "Apply");
    apply.type = "submit";
    form.appendChild(input); form.appendChild(apply);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = input.value.trim();
      if (code) self.run(apply, function () { return self.coupon(code); });
    });
    body.appendChild(form);

    var total = el("div", "vs-total");
    total.appendChild(el("span", "", "Total"));
    total.appendChild(el("strong", "", money(b.total_price, b.currency)));
    foot.appendChild(total);
    if (b.sales_tax > 0) foot.appendChild(el("p", "vs-fine", "Includes " + money(b.sales_tax, b.currency) + " tax"));
    var pay = el("button", "vs-btn vs-btn-primary vs-btn-lg vs-btn-block", "Checkout");
    pay.type = "button";
    pay.addEventListener("click", function () { self.run(pay, function () { return self.checkout(); }); });
    foot.appendChild(pay);
    foot.appendChild(el("p", "vs-fine", "Secure payment by Tebex · delivered to your Cfx.re account"));
  };

  Store.prototype.toast = function (text, bad) {
    var old = document.querySelector(".vs-toast");
    if (old) old.remove();
    var t = el("div", "vs-toast" + (bad ? " vs-toast-bad" : ""), text);
    t.setAttribute("role", "status");
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  };

  var tebexJsPromise = null;
  function loadTebexJs() {
    if (window.Tebex) return Promise.resolve(window.Tebex);
    if (!tebexJsPromise) {
      tebexJsPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = TEBEX_JS;
        s.onload = function () { window.Tebex ? resolve(window.Tebex) : reject(new Error("Tebex.js missing")); };
        s.onerror = function () { tebexJsPromise = null; reject(new Error("Tebex.js failed to load")); };
        document.head.appendChild(s);
      });
    }
    return tebexJsPromise;
  }

  var current = null;
  function init() {
    // instant navigation left the store: drop the old page's listener and scroll lock
    if (current) {
      document.removeEventListener("keydown", current.onKey);
      window.removeEventListener("hashchange", current.onHash);
      document.removeEventListener("click", current.onOpen);
      document.documentElement.classList.remove("vs-lock");
      current = null;
    }
    var root = document.getElementById("vega-store");
    if (!root || root.getAttribute("data-ready")) return;
    root.setAttribute("data-ready", "1");
    current = new Store(root);
    current.start();
  }

  // Material's instant navigation swaps pages without reloading; document$ fires on each page
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(init);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
