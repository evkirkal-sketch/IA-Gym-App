// app.js - frontend logic (uses fetch to backend)
const API = "/api";
let token = null;
let currentProfile = null;

// --- Utility ---
function qs(id) { return document.getElementById(id); }
function setAuthToken(t){
  token = t;
  if (t) localStorage.setItem("authToken", t)
  else localStorage.removeItem("authToken")
}
function authFetch(url, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers["Content-Type"] = "application/json";
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  return fetch(url, opts);
}

// --- Auth elements
const loginPage = qs("loginPage");
const appDiv = qs("app");
const authMsg = qs("authMsg");

async function init(){
  const savedToken = localStorage.getItem("authToken");
  if (savedToken) {
    token = savedToken;
    const ok = await loadProfile();
    if (ok) showApp(); else { setAuthToken(null); showLogin(); }
  } else showLogin();
}
function showLogin(){ loginPage.style.display = "flex"; appDiv.classList.add("hidden"); }
function showApp(){ loginPage.style.display = "none"; appDiv.classList.remove("hidden"); loadProfileIntoForm(); }

// Register
qs("registerBtn").addEventListener("click", async () => {
  const email = qs("email").value.trim();
  const username = qs("username").value.trim();
  const password = qs("password").value;

  try {
    const res = await fetch(API + "/register", {
      method: "POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Register failed");
    authMsg.textContent = "Registered. Please login.";
  } catch (err) {
    authMsg.textContent = err.message;
  }
});

// Login
qs("loginBtn").addEventListener("click", async () => {
  const usernameOrEmail = qs("username").value.trim() || qs("email").value.trim();
  const password = qs("password").value;
  if (!usernameOrEmail || !password) { authMsg.textContent = "Enter credentials"; return; }
  const r = await fetch(API + "/login", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ usernameOrEmail, password })
  });
  const j = await r.json();
  if (!r.ok) { authMsg.textContent = j.error || "Login failed"; return; }
  setAuthToken(j.token);
  await loadProfile();
  showApp();
});

// Reset users (dev convenience)
qs("resetUsersBtn").addEventListener("click", async () => {
  if (!confirm("Delete all users?")) return;
  await fetch("/reset-users", { method: "POST" }).catch(()=>{});
  alert("Requested reset (if supported). Clear db.json if needed.");
});

// Logout
qs("logoutBtn").addEventListener("click", () => {
  setAuthToken(null);
  currentProfile = null;
  showLogin();
});

// Save profile
qs("saveProfileBtn").addEventListener("click", async () => {
  const gender = qs("gender").value.trim();
  const age = parseInt(qs("age").value);
  const height = parseInt(qs("height").value);
  const weight = parseInt(qs("weight").value);
  const objective = qs("objective").value;
  const daysPerWeek = parseInt(qs("daysPerWeek").value);
  // basic validation (front)
  if (!gender || (gender.toLowerCase() !== "male" && gender.toLowerCase() !== "female")) return alert("Gender must be Male/Female");
  if (!age || age < 16) return alert("Age must be 16+");
  if (!height || height < 100 || height > 275) return alert("Height must be valid cm");
  if (!weight) return alert("Weight required");
  if (!daysPerWeek || daysPerWeek < 2 || daysPerWeek > 6) return alert("Days must be 2-6");
  const payload = { gender, age, height, weight, objective, daysPerWeek };
  const r = await authFetch(API + "/profile", { method:"POST", body: JSON.stringify(payload) });
  const j = await r.json();
  if (!r.ok) return alert(j.error || "Save failed");
  currentProfile = j.profile;
  // go to muscle step
  showSection("muscleStep");
  loadMuscleTable();
});

// Back to profile
qs("backToProfileBtn").addEventListener("click", () => showSection("profileStep"));

// To week picker
qs("toWeekPickerBtn").addEventListener("click", () => {
  // ensure some muscles selected
  const checked = Array.from(document.querySelectorAll("input[name='muscle']:checked")).map(i=>i.value);
  if (checked.length === 0) { alert("Select at least 1 muscle"); return; }
  // save selected muscles to profile
  authFetch(API + "/profile", { method: "POST", body: JSON.stringify({ selectedMuscles: checked })})
    .then(r => r.json()).then(j => {
      currentProfile = j.profile;
      loadWeekGrid(currentProfile.daysPerWeek);
      showSection("weekStep");
    });
});

// generate routine
qs("generateRoutineBtn").addEventListener("click", async () => {
  const selectedDays = Array.from(document.querySelectorAll("input[name='trainDay']:checked")).map(i=>i.value);
  if (!currentProfile || selectedDays.length !== currentProfile.daysPerWeek) { alert("Select exact allowed days."); return; }
  // call generate
  const r = await authFetch(API + "/generate", { method: "POST", body: JSON.stringify({}) });
  const j = await r.json();
  if (!r.ok) return alert(j.error || "Failed to generate");
  currentProfile.routine = j.routine;
  renderRoutine();
  showSection("routineStep");
});

// shuffle
qs("shuffleBtn").addEventListener("click", async () => {
  const r = await authFetch(API + "/shuffle", { method: "POST" });
  const j = await r.json();
  if (!r.ok) return alert(j.error || "Shuffle failed");
  currentProfile.routine = j.routine;
  renderRoutine();
});

// edit routine -> go back to profile or muscles
qs("editRoutineBtn").addEventListener("click", ()=> showSection("muscleStep"));

// helpers
function showSection(id){
  ["profileStep","muscleStep","weekStep","routineStep"].forEach(s => qs(s).classList.add("hidden"));
  qs(id).classList.remove("hidden");
}

async function loadProfile(){
  try {
    const r = await authFetch(API + "/profile");
    const j = await r.json();
    if (!r.ok) { return false; }
    currentProfile = j.user.profile;
    // preload fields
    qs("name").value = j.user.name || "";
    qs("surname").value = j.user.surname || "";
    qs("gender").value = currentProfile.gender || "";
    qs("age").value = currentProfile.age || "";
    qs("height").value = currentProfile.height || "";
    qs("weight").value = currentProfile.weight || "";
    qs("objective").value = currentProfile.objective || "";
    qs("daysPerWeek").value = currentProfile.daysPerWeek || "";
    return true;
  } catch (err) { return false; }
}

function loadProfileIntoForm(){
  if (!currentProfile) return;
  qs("gender").value = currentProfile.gender || "";
  qs("age").value = currentProfile.age || "";
  qs("height").value = currentProfile.height || "";
  qs("weight").value = currentProfile.weight || "";
  qs("objective").value = currentProfile.objective || "";
  qs("daysPerWeek").value = currentProfile.daysPerWeek || "";
}

// muscle table population (uses same DB names as server)
const muscleList = [
  "Upper Chest","Middle Chest","Lower Chest",
  "Biceps Long Head","Biceps Short Head",
  "Triceps Long Head","Triceps Lateral Head","Triceps Medial Head",
  "Quads","Calves","Glutes","Hamstrings",
  "Trapezoids","Upper Back","Lats","Middle Back","Lower Back",
  "Abs","Shoulders","Forearms"
];

function loadMuscleTable(){
  const table = qs("muscleTable");
  table.innerHTML = "";
  muscleList.forEach(m=>{
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const right = document.createElement("td");
    td.innerHTML = `<div class="muscle-row"><input type="checkbox" name="muscle" value="${m}" ${currentProfile && currentProfile.selectedMuscles && currentProfile.selectedMuscles.includes(m) ? "checked": ""}> <strong>${m}</strong></div>`;
    // placeholder images; replace with your own
    right.innerHTML = `<img src="https://via.placeholder.com/120x80.png?text=${encodeURIComponent(m)}" alt="${m}" />`;
    tr.appendChild(td); tr.appendChild(right);
    table.appendChild(tr);
  });
}

// week grid
function loadWeekGrid(allowedDays){
  qs("allowedDays").textContent = allowedDays;
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const g = qs("weekGrid");
  g.innerHTML = "";
  days.forEach(d => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" name="trainDay" value="${d}" /> <span>${d}</span>`;
    g.appendChild(label);
  });
  // limit selection
  g.addEventListener("change", ()=>{
    const checked = g.querySelectorAll("input[name='trainDay']:checked");
    if (checked.length > allowedDays) {
      // uncheck last one
      const last = checked[checked.length-1];
      last.checked = false;
      alert(`You can only select ${allowedDays} days.`);
    }
  });
}

// render routine
function renderRoutine(){
  const area = qs("routineArea");
  area.innerHTML = "";
  if (!currentProfile || !currentProfile.routine) { area.innerHTML = "<p>No routine</p>"; return; }
  currentProfile.routine.weeks.forEach(w=>{
    const wk = document.createElement("div"); wk.className = "week";
    wk.innerHTML = `<h3>Week ${w.week}</h3>`;
    w.days.forEach(d=>{
      const exDiv = document.createElement("div"); exDiv.className = "exercise";
      const imgs = d.exercises[0] ? d.exercises[0].gif : "https://via.placeholder.com/96x64";
      const img = `<img src="${imgs}" alt="${d.muscle}" />`;
      const details = `<div><strong>${d.muscle}</strong><div class="muted">${d.notes || ""}</div>`;
      d.exercises.forEach(e=> details += `<div><em>${e.name}</em><div>${e.desc}</div></div>`);
      exDiv.innerHTML = img + details + "</div>";
      wk.appendChild(exDiv);
    });
    area.appendChild(wk);
  });
}

// initialize
init();
