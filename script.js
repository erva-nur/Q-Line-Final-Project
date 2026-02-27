const API_URL = "https://api.npoint.io/433d2b54b3c3bb324e23";

const LS_BACKUP = "backup_listings";
const LS_TASKS = "myTasks";
const LS_USER_POSTS = "user_posts";
const LS_THEME = "theme";

let dataStore = []; 
const filters = { category: "all", status: "all" }; 

let currentPostMode = "ihtiyac"; 
let editingPostId = null;        


const themeBtn = document.getElementById("theme-toggle");
const savedTheme = localStorage.getItem(LS_THEME) || "dark";
document.body.classList.toggle("light", savedTheme === "light");
themeBtn.textContent = savedTheme === "light" ? "☀️" : "🌙";

themeBtn.addEventListener("click", () => {
  document.body.classList.toggle("light");
  const isLight = document.body.classList.contains("light");
  localStorage.setItem(LS_THEME, isLight ? "light" : "dark");
  themeBtn.textContent = isLight ? "☀️" : "🌙";
});


function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function normalizeCategory(cat) {
  const s = String(cat || "").trim();
  const lower = s.toLowerCase();

  if (lower === "gida" || lower.includes("gida") || lower.includes("gıd")) return "Gıda";
  if (lower === "barinma" || lower.includes("barin") || lower.includes("barın")) return "Barınma";
  if (lower === "saglik" || lower.includes("sagl") || lower.includes("sağl")) return "Sağlık";
  if (lower.includes("loj")) return "Lojistik";
  return s || "Genel";
}

function detectDesc(item) {
  return pick(item, ["aciklama", "description", "detay", "icerik", "content", "text", "ihtiyac", "need"]) || "Açıklama yok";
}
function detectTitle(item) {
  return pick(item, ["baslik", "title", "ilanBasligi", "ilan_basligi", "ad", "isim", "name"]) || "Başlık yok";
}
function detectCategory(item) {
  const cat = pick(item, ["kategori", "category", "tip", "alan", "grup", "categoryName", "category_name"]);
  return normalizeCategory(cat);
}

function detectAcil(item, desc) {
  const acilField = pick(item, ["acil", "urgent", "isAcil", "is_urgent", "oncelik", "priority"]);
  if (acilField === true) return true;

  const t = String(acilField || "").toLowerCase();
  if (t.includes("acil") || t.includes("urgent") || t === "1" || t === "yüksek" || t === "high") return true;

  const d = String(desc || "").toLowerCase();
  return d.includes("acil") || d.includes("hemen") || d.includes("ivedi");
}

function detectTur(item, desc) {
  const raw = pick(item, ["tur", "ilanTuru", "ilan_turu", "type", "status", "etiket", "tag"]);
  const s = String(raw || "").toLowerCase();

  if (s.includes("iht")) return "ihtiyac";
  if (s.includes("des")) return "destek";

  const d = String(desc || "").toLowerCase();
  const needWords = ["ihtiyaç", "ihtiyac", "gerekiyor", "lazım", "talep", "acil"];
  const supportWords = ["destek", "sağlayabilirim", "temin edebilirim", "gönderebilirim", "yardım edebilirim", "var"];

  const needHit = needWords.some(w => d.includes(w));
  const supportHit = supportWords.some(w => d.includes(w));

  if (needHit && !supportHit) return "ihtiyac";
  if (supportHit && !needHit) return "destek";

  return "destek";
}

function normalizeApiItem(item, index) {
  const aciklama = detectDesc(item);
  const tur = detectTur(item, aciklama);
  const isAcil = detectAcil(item, aciklama);

  const id = pick(item, ["id", "_id", "uuid"]) ?? `idx_${index}`;
  const kategori = detectCategory(item);
  const baslik = detectTitle(item);

  const konum = pick(item, ["konum", "location", "adres", "address", "ilce", "sehir"]) || "";
  const email = pick(item, ["email", "mail", "eposta", "e_posta"]) || "";

  return { id: String(id), tur, isAcil, kategori, baslik, aciklama, konum, email, source: "api" };
}


function balanceHalfApi(list, key) {
  const api = list.filter(x => x.source === "api");
  if (api.length < 2) return list;

  if (key === "tur") {
    let d = api.filter(x => x.tur === "destek").length;
    let i = api.filter(x => x.tur === "ihtiyac").length;
    const target = Math.floor(api.length / 2);

    if (d > target) {
      let flip = d - target;
      for (const it of api) {
        if (flip <= 0) break;
        if (it.tur === "destek") { it.tur = "ihtiyac"; flip--; }
      }
    } else if (i > target) {
      let flip = i - target;
      for (const it of api) {
        if (flip <= 0) break;
        if (it.tur === "ihtiyac") { it.tur = "destek"; flip--; }
      }
    }
  }

  if (key === "isAcil") {
    let a = api.filter(x => x.isAcil === true).length;
    let n = api.filter(x => x.isAcil !== true).length;
    const target = Math.floor(api.length / 2);

    if (a > target) {
      let flip = a - target;
      for (const it of api) {
        if (flip <= 0) break;
        if (it.isAcil === true) { it.isAcil = false; flip--; }
      }
    } else if (n > target) {
      let flip = n - target;
      for (const it of api) {
        if (flip <= 0) break;
        if (it.isAcil !== true) { it.isAcil = true; flip--; }
      }
    }
  }

  return list;
}


async function loadData() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("API hata");
    const raw = await res.json();

    const arr = Array.isArray(raw) ? raw
      : Array.isArray(raw?.data) ? raw.data
      : Array.isArray(raw?.ilanlar) ? raw.ilanlar
      : [];

    const apiItems = arr.map((it, idx) => normalizeApiItem(it, idx));
    balanceHalfApi(apiItems, "tur");
    balanceHalfApi(apiItems, "isAcil");

    const userPosts = getUserPosts();
    dataStore = [...userPosts, ...apiItems];

    localStorage.setItem(LS_BACKUP, JSON.stringify(dataStore));
    document.getElementById("offline-banner").classList.add("hidden");

    applyFiltersAndRender();
    renderMyPosts();
  } catch (e) {
    document.getElementById("offline-banner").classList.remove("hidden");
    dataStore = JSON.parse(localStorage.getItem(LS_BACKUP)) || [];
    applyFiltersAndRender();
    renderMyPosts();
  }
}


function applyFiltersAndRender() {
  let list = [...dataStore];

  if (filters.category !== "all") {
    list = list.filter(x => normalizeCategory(x.kategori) === normalizeCategory(filters.category));
  }
  if (filters.status === "acil") {
    list = list.filter(x => x.isAcil === true);
  }

  renderListings(list);
}

function makeCard(item, extraTopButtonsHtml = "") {
  const baseClass = item.tur === "ihtiyac" ? "ihtiyac" : "destek";
  const cardClass = item.isAcil ? `card ${baseClass} acil` : `card ${baseClass}`;
  const turText = item.tur === "ihtiyac" ? "ihtiyaç" : "destek";
  const acilTag = item.isAcil ? `<span class="tag acil">ACİL</span>` : "";

  const meta = [];
  if (item.konum) meta.push(`<div>Konum: ${item.konum}</div>`);
  if (item.email) meta.push(`<div>E-posta: ${item.email}</div>`);

  return `
    <div class="${cardClass}">
      ${extraTopButtonsHtml}
      ${acilTag}
      <span class="tag">${turText} • ${normalizeCategory(item.kategori)}</span>
      <h3>${item.baslik}</h3>
      <p>${item.aciklama}</p>
      ${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}
      <button class="btn-claim" onclick="claimTask('${item.id}')">Ben Üstleniyorum</button>
    </div>
  `;
}

function renderListings(list) {
  const container = document.getElementById("listing-container");
  if (!list.length) {
    container.innerHTML = `<p style="color:#cbd5e1">Gösterilecek ilan yok.</p>`;
    return;
  }
  container.innerHTML = list.map(item => makeCard(item)).join("");
}


function getUserPosts() {
  return JSON.parse(localStorage.getItem(LS_USER_POSTS)) || [];
}

function setUserPosts(arr) {
  localStorage.setItem(LS_USER_POSTS, JSON.stringify(arr));
}

function renderMyPosts() {
  const container = document.getElementById("my-posts-container");
  const myPosts = getUserPosts();

  if (!myPosts.length) {
    container.innerHTML = `<p style="color:#cbd5e1">Henüz ilan eklemedin.</p>`;
    return;
  }

  container.innerHTML = myPosts.map(item => {
    const topBtns = `
      <button class="btn-delete" onclick="deleteMyPost('${item.id}')"><i class="fas fa-times"></i></button>
      <button class="btn-edit" onclick="openEditPost('${item.id}')"><i class="fa-solid fa-pen"></i></button>
    `;
    return makeCard(item, topBtns);
  }).join("");
}

function deleteMyPost(id) {
  let myPosts = getUserPosts();
  myPosts = myPosts.filter(p => p.id !== String(id));
  setUserPosts(myPosts);

  // dataStore’dan da düş
  dataStore = dataStore.filter(p => p.id !== String(id));
  localStorage.setItem(LS_BACKUP, JSON.stringify(dataStore));

  applyFiltersAndRender();
  renderMyPosts();
}

function openEditPost(id) {
  const myPosts = getUserPosts();
  const post = myPosts.find(p => p.id === String(id));
  if (!post) return;

  editingPostId = post.id;
  currentPostMode = post.tur; // ihtiyac/destek

  formTitleEl.textContent = "İlanı Düzenle";
  document.getElementById("form-category").value = normalizeCategory(post.kategori);
  document.getElementById("form-title-input").value = post.baslik || "";
  document.getElementById("form-desc").value = post.aciklama || "";
  document.getElementById("form-location").value = post.konum || "";
  document.getElementById("form-email").value = post.email || "";

  panel.classList.remove("hidden");
}


function getTasks() {
  return JSON.parse(localStorage.getItem(LS_TASKS)) || [];
}
function saveTasks(tasks) {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
}

function claimTask(id) {
  const task = dataStore.find(t => t.id === String(id));
  if (!task) return;

  const myTasks = getTasks();
  if (!myTasks.find(t => t.id === String(id))) {
    myTasks.push(task);
    saveTasks(myTasks);
    renderMyTasks();
  }
}

function removeTask(id) {
  let myTasks = getTasks();
  myTasks = myTasks.filter(t => t.id !== String(id));
  saveTasks(myTasks);
  renderMyTasks();
}

function renderMyTasks() {
  const container = document.getElementById("task-container");
  const myTasks = getTasks();

  if (!myTasks.length) {
    container.innerHTML = `<p style="color:#cbd5e1">Henüz görev üstlenmedin.</p>`;
    return;
  }

  container.innerHTML = myTasks.map(item => {
    const baseClass = item.tur === "ihtiyac" ? "ihtiyac" : "destek";
    const cardClass = item.isAcil ? `card ${baseClass} acil` : `card ${baseClass}`;
    const turText = item.tur === "ihtiyac" ? "ihtiyaç" : "destek";
    const acilTag = item.isAcil ? `<span class="tag acil">ACİL</span>` : "";

    return `
      <div class="${cardClass}">
        <button class="btn-delete" onclick="removeTask('${item.id}')"><i class="fas fa-times"></i></button>
        ${acilTag}
        <span class="tag">${turText} • ${normalizeCategory(item.kategori)}</span>
        <h3>${item.baslik}</h3>
        <p>${item.aciklama}</p>
      </div>
    `;
  }).join("");
}


document.getElementById("filter-buttons").addEventListener("click", (e) => {
  if (!e.target.classList.contains("filter-btn")) return;

  const filterType = e.target.dataset.filter;
  const value = e.target.dataset.value;

  if (filterType === "status") {
    filters.status = (filters.status === value) ? "all" : value;
  } else {
    filters.category = value;
  }

  document.querySelectorAll('.filter-btn[data-filter="category"]').forEach(b => b.classList.remove("active"));
  document.querySelector(`.filter-btn[data-filter="category"][data-value="${filters.category}"]`)?.classList.add("active");

  document.querySelectorAll('.filter-btn[data-filter="status"]').forEach(b => b.classList.remove("active"));
  if (filters.status !== "all") {
    document.querySelector(`.filter-btn[data-filter="status"][data-value="${filters.status}"]`)?.classList.add("active");
  }

  applyFiltersAndRender();
});


const panel = document.getElementById("form-panel");
const formTitleEl = document.getElementById("form-title");
const postForm = document.getElementById("post-form");

document.getElementById("btn-open-ilan").addEventListener("click", () => {
  editingPostId = null;
  currentPostMode = "ihtiyac";
  formTitleEl.textContent = "İlan Ver (İhtiyaç)";
  postForm.reset();
  panel.classList.remove("hidden");
});

document.getElementById("btn-open-destek").addEventListener("click", () => {
  editingPostId = null;
  currentPostMode = "destek";
  formTitleEl.textContent = "Destek Ver";
  postForm.reset();
  panel.classList.remove("hidden");
});

document.getElementById("btn-close-form").addEventListener("click", () => {
  panel.classList.add("hidden");
  postForm.reset();
  editingPostId = null;
});

postForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const kategori = normalizeCategory(document.getElementById("form-category").value);
  const baslik = document.getElementById("form-title-input").value.trim();
  const aciklama = document.getElementById("form-desc").value.trim();
  const konum = document.getElementById("form-location").value.trim();
  const email = document.getElementById("form-email").value.trim();

  const isAcil = (currentPostMode === "ihtiyac") && aciklama.toLowerCase().includes("acil");

  let myPosts = getUserPosts();

  if (editingPostId) {
    // DÜZENLE
    myPosts = myPosts.map(p => {
      if (p.id !== String(editingPostId)) return p;
      return {
        ...p,
        tur: currentPostMode,
        isAcil,
        kategori,
        baslik,
        aciklama,
        konum,
        email
      };
    });
    setUserPosts(myPosts);

    // dataStore güncelle
    dataStore = dataStore.map(p => {
      if (p.id !== String(editingPostId)) return p;
      return {
        ...p,
        tur: currentPostMode,
        isAcil,
        kategori,
        baslik,
        aciklama,
        konum,
        email
      };
    });

  } else {
    // YENİ EKLE
    const newItem = {
      id: `user_${Date.now()}`,
      tur: currentPostMode,
      isAcil,
      kategori,
      baslik,
      aciklama,
      konum,
      email,
      source: "user"
    };
    myPosts.unshift(newItem);
    setUserPosts(myPosts);
    dataStore = [newItem, ...dataStore];
  }

  localStorage.setItem(LS_BACKUP, JSON.stringify(dataStore));

  postForm.reset();
  panel.classList.add("hidden");
  editingPostId = null;

  applyFiltersAndRender();
  renderMyPosts();
});


window.addEventListener("offline", () => {
  document.getElementById("offline-banner").classList.remove("hidden");
});
window.addEventListener("online", () => {
  document.getElementById("offline-banner").classList.add("hidden");
});


loadData();
renderMyTasks();

renderMyPosts();
