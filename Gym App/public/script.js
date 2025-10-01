document.addEventListener("DOMContentLoaded", () => {
  const loginPage = document.getElementById("loginPage");
  const infoPage = document.getElementById("infoPage");
  const musclePage = document.getElementById("musclePage");
  const routinePage = document.getElementById("routinePage");

  // LOGIN / REGISTER
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    const regexPass = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[\W_]).{6,12}$/;
    if (!regexPass.test(password)) {
      alert("Password must be 6–12 chars, include uppercase, lowercase, number & special char.");
      return;
    }

    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();

    if (data.success) {
      loginPage.classList.remove("active");
      infoPage.classList.add("active");
    } else {
      alert(data.message);
    }
  });

  // USER INFO
  document.getElementById("infoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    infoPage.classList.remove("active");
    musclePage.classList.add("active");
  });

  // MUSCLE SELECTION
  document.getElementById("muscleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    musclePage.classList.remove("active");
    routinePage.classList.add("active");
    generateRoutine();
  });

  function generateRoutine() {
    const container = document.getElementById("routineContainer");
    container.innerHTML = "";
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    days.forEach(day => {
      const div = document.createElement("div");
      div.classList.add("routine-day");
      div.innerHTML = `<h3>${day}</h3><p>Example exercises with gifs will go here.</p>`;
      container.appendChild(div);
    });
  }
});
