// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const { nanoid } = require("nanoid");
const path = require("path");

const JWT_SECRET = "replace_this_with_a_secure_random_string"; // change before production
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// LowDB setup
const adapter = new JSONFile(path.join(__dirname, "db.json"));
const db = new Low(adapter);

(async () => {
  await db.read();
  db.data ||= { users: [] };
  await db.write();
})();

// Helper: authenticate middleware
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --- Routes ---

// Register
app.post("/api/register", async (req, res) => {
  await db.read();
  const { email, username, password, name, surname } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: "Missing fields" });

  const exists = db.data.users.find(u => u.username === username || u.email === email);
  if (exists) return res.status(400).json({ error: "Username or email already taken" });

  // password policy: 6-12 chars, at least one uppercase, one lowercase, one number, one special
  const pwRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,12}$/;
  if (!pwRegex.test(password)) return res.status(400).json({ error: "Password does not meet policy" });

  const hash = await bcrypt.hash(password, 10);
  const newUser = {
    id: nanoid(),
    email,
    username,
    passwordHash: hash,
    name: name || "",
    surname: surname || "",
    profile: {
      gender: "",
      age: null,
      height: null,
      weight: null,
      objective: "",
      daysPerWeek: null,
      selectedMuscles: [],
      routine: null // will hold generated routine object
    },
    createdAt: new Date().toISOString()
  };
  db.data.users.push(newUser);
  await db.write();
  return res.json({ success: true, message: "Registered" });
});

// Login -> returns JWT
app.post("/api/login", async (req, res) => {
  await db.read();
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) return res.status(400).json({ error: "Missing fields" });

  const user = db.data.users.find(u => u.username === usernameOrEmail || u.email === usernameOrEmail);
  if (!user) return res.status(401).json({ error: "Username or password incorrect" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Username or password incorrect" });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ success: true, token, username: user.username });
});

// Get profile (protected)
app.get("/api/profile", authenticate, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  // do not send passwordHash
  const safeUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    surname: user.surname,
    profile: user.profile
  };
  return res.json({ success: true, user: safeUser });
});

// Save/update profile data (gender, age, height, weight, objective, daysPerWeek, selectedMuscles)
app.post("/api/profile", authenticate, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });

  const { gender, age, height, weight, objective, daysPerWeek, selectedMuscles } = req.body;

  // basic validation
  if (age && (age < 16 || age > 120)) return res.status(400).json({ error: "Invalid age" });
  if (height && (height < 100 || height > 275)) return res.status(400).json({ error: "Invalid height" });
  if (weight && (weight < 30 || weight > 300)) return res.status(400).json({ error: "Invalid weight" });
  if (daysPerWeek && (daysPerWeek < 2 || daysPerWeek > 6)) return res.status(400).json({ error: "Invalid days" });

  user.profile.gender = gender || user.profile.gender;
  user.profile.age = age ?? user.profile.age;
  user.profile.height = height ?? user.profile.height;
  user.profile.weight = weight ?? user.profile.weight;
  user.profile.objective = objective || user.profile.objective;
  user.profile.daysPerWeek = daysPerWeek ?? user.profile.daysPerWeek;
  user.profile.selectedMuscles = Array.isArray(selectedMuscles) ? selectedMuscles : user.profile.selectedMuscles;

  await db.write();
  return res.json({ success: true, profile: user.profile });
});

// Generate routine (server-side): creates a 3-week plan using muscle picks and daysPerWeek
app.post("/api/generate", authenticate, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });

  const { objectiveOverride, daysOverride, musclesOverride } = req.body;

  const daysPerWeek = daysOverride ?? user.profile.daysPerWeek;
  const muscles = Array.isArray(musclesOverride) ? musclesOverride : user.profile.selectedMuscles;
  const gender = user.profile.gender;
  const objective = objectiveOverride ?? user.profile.objective;

  if (!daysPerWeek || !muscles || muscles.length === 0) return res.status(400).json({ error: "Insufficient data" });

  // Example exercise database (6 exercises per muscle) with description & GIF placeholder
  const exerciseDB = getExerciseDB();

  // Build 3-week plan: assign each training slot a muscle and 1-2 exercises
  const weeks = 3;
  const routine = { generatedAt: new Date().toISOString(), weeks: [] };

  // create schedule day names to fill (e.g., the user picks Monday, Wed, Fri etc on frontend — but server can simply assign muscle slots per week)
  // For simplicity: rotate through muscles across training slots
  const totalSlotsPerWeek = daysPerWeek;
  let idx = 0;
  for (let w = 1; w <= weeks; w++) {
    const weekObj = { week: w, days: [] };
    for (let slot = 0; slot < totalSlotsPerWeek; slot++) {
      const muscle = muscles[idx % muscles.length];
      const exercisesForMuscle = exerciseDB[muscle] || [];
      // choose 3 exercises (or up to 3) rotated for variety
      const exs = [];
      for (let e = 0; e < Math.min(3, exercisesForMuscle.length); e++) {
        exs.push(exercisesForMuscle[(slot + e + w) % exercisesForMuscle.length]);
      }
      weekObj.days.push({
        slot: slot + 1,
        muscle,
        exercises: exs,
        notes: `Focus on ${muscle}. Objective: ${objective}. Gender: ${gender || "N/A"}`
      });
      idx++;
    }
    routine.weeks.push(weekObj);
  }

  // store in user profile
  user.profile.routine = routine;
  await db.write();

  return res.json({ success: true, routine });
});

// Shuffle routine (rearrange the week assignments)
app.post("/api/shuffle", authenticate, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user || !user.profile || !user.profile.routine) return res.status(400).json({ error: "No routine" });

  const routine = user.profile.routine;
  // very simple shuffle: shuffle muscles array then regenerate quickly
  const muscles = user.profile.selectedMuscles.slice();
  // simple Fisher-Yates
  for (let i = muscles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [muscles[i], muscles[j]] = [muscles[j], muscles[i]];
  }

  // regenerate using shuffled muscles but same daysPerWeek
  const newReqBody = { daysOverride: user.profile.daysPerWeek, musclesOverride: muscles };
  // reuse /api/generate logic by calling function locally:
  // Build new routine quickly (repeat same logic)
  const exerciseDB = getExerciseDB();
  const weeks = 3;
  const newRoutine = { generatedAt: new Date().toISOString(), weeks: [] };
  let idx = 0;
  for (let w = 1; w <= weeks; w++) {
    const weekObj = { week: w, days: [] };
    for (let slot = 0; slot < user.profile.daysPerWeek; slot++) {
      const muscle = muscles[idx % muscles.length];
      const exercisesForMuscle = exerciseDB[muscle] || [];
      const exs = [];
      for (let e = 0; e < Math.min(3, exercisesForMuscle.length); e++) {
        exs.push(exercisesForMuscle[(slot + e + w) % exercisesForMuscle.length]);
      }
      weekObj.days.push({ slot: slot + 1, muscle, exercises: exs });
      idx++;
    }
    newRoutine.weeks.push(weekObj);
  }

  user.profile.routine = newRoutine;
  await db.write();
  return res.json({ success: true, routine: newRoutine });
});

// Save edited routine (user can remove muscle or change daysPerWeek)
app.post("/api/saveEdited", authenticate, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });

  const { daysPerWeek, selectedMuscles } = req.body;
  if (daysPerWeek && (daysPerWeek < 2 || daysPerWeek > 6)) return res.status(400).json({ error: "Invalid days" });
  user.profile.daysPerWeek = daysPerWeek ?? user.profile.daysPerWeek;
  user.profile.selectedMuscles = Array.isArray(selectedMuscles) ? selectedMuscles : user.profile.selectedMuscles;

  await db.write();
  return res.json({ success: true, profile: user.profile });
});

// Fallback to serve index.html for SPA (optional)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// ------------------------------
// Example exercise DB function
function getExerciseDB() {
  // each muscle -> array of {name, desc, gif}
  return {
    "Upper Chest": [
      { name: "Incline Bench Press", desc: "Press bar at incline to target upper chest.", gif: "https://i.imgur.com/7I7Y2Qd.gif" },
      { name: "Incline Dumbbell Press", desc: "Press dumbbells on incline bench.", gif: "https://i.imgur.com/7I7Y2Qd.gif" },
      { name: "Incline Cable Fly", desc: "Cable flys on incline to feel contraction.", gif: "https://i.imgur.com/7I7Y2Qd.gif" },
      { name: "Smith Incline Press", desc: "Machine-assisted incline press.", gif: "https://i.imgur.com/7I7Y2Qd.gif" },
      { name: "Incline Push-ups", desc: "Push-ups with hands elevated.", gif: "https://i.imgur.com/7I7Y2Qd.gif" },
      { name: "Low-to-High Cable Fly", desc: "Cable fly from low to high to hit upper chest.", gif: "https://i.imgur.com/7I7Y2Qd.gif" }
    ],
    "Middle Chest": [
      { name: "Flat Bench Press", desc: "Classic barbell bench press.", gif: "https://i.imgur.com/3QXJ7wF.gif" },
      { name: "Dumbbell Chest Press", desc: "Press dumbbells flat to build chest.", gif: "https://i.imgur.com/3QXJ7wF.gif" },
      { name: "Cable Fly", desc: "Cable flys focusing on chest squeeze.", gif: "https://i.imgur.com/3QXJ7wF.gif" },
      { name: "Push-ups", desc: "Bodyweight push-ups.", gif: "https://i.imgur.com/3QXJ7wF.gif" },
      { name: "Machine Chest Press", desc: "Machine-assisted pressing.", gif: "https://i.imgur.com/3QXJ7wF.gif" },
      { name: "Chest Dips (lean forward)", desc: "Dips leaning forward to hit chest.", gif: "https://i.imgur.com/3QXJ7wF.gif" }
    ],
    "Lower Chest": [
      { name: "Decline Bench Press", desc: "Decline press for lower chest.", gif: "https://i.imgur.com/vmK5VgI.gif" },
      { name: "Decline Dumbbell Press", desc: "Decline DB press.", gif: "https://i.imgur.com/vmK5VgI.gif" },
      { name: "Decline Cable Fly", desc: "Cable fly on decline angle.", gif: "https://i.imgur.com/vmK5VgI.gif" },
      { name: "Parallel Bar Dips", desc: "Chest dips with forward lean.", gif: "https://i.imgur.com/vmK5VgI.gif" },
      { name: "Decline Push-ups", desc: "Feet-elevated push-ups.", gif: "https://i.imgur.com/vmK5VgI.gif" },
      { name: "Low Cable Flys", desc: "Low-angle cable flys.", gif: "https://i.imgur.com/vmK5VgI.gif" }
    ],
    // Add other muscles similarly...
    "Biceps Long Head": [
      { name: "Incline Dumbbell Curl", desc: "Curl lying back on incline bench.", gif: "https://i.imgur.com/8X3sY8V.gif" },
      { name: "Hammer Curl", desc: "Neutral-grip curl for brachialis.", gif: "https://i.imgur.com/8X3sY8V.gif" },
      { name: "EZ Bar Curl", desc: "Bar curl for overall mass.", gif: "https://i.imgur.com/8X3sY8V.gif" },
      { name: "Concentration Curl", desc: "Isolated curl for peak.", gif: "https://i.imgur.com/8X3sY8V.gif" },
      { name: "Cable Curl", desc: "Constant tension cable curl.", gif: "https://i.imgur.com/8X3sY8V.gif" },
      { name: "Chin-ups", desc: "Bodyweight movement for biceps.", gif: "https://i.imgur.com/8X3sY8V.gif" }
    ],
    // ... add entries for all muscle groups used in your app
    "Lats": [
      { name: "Pull-ups", desc: "Pull body up to bar focusing on lats.", gif: "https://i.imgur.com/4g0f7Qn.gif" },
      { name: "Lat Pulldown", desc: "Machine pulldown for lats.", gif: "https://i.imgur.com/4g0f7Qn.gif" },
      { name: "Single-arm Dumbbell Row", desc: "Row with one arm to target lats.", gif: "https://i.imgur.com/4g0f7Qn.gif" },
      { name: "Seated Cable Row", desc: "Row for mid-back and lats.", gif: "https://i.imgur.com/4g0f7Qn.gif" },
      { name: "Straight-arm Pulldown", desc: "Isolate lats with straight arms.", gif: "https://i.imgur.com/4g0f7Qn.gif" },
      { name: "T-Bar Row", desc: "Heavy row for thickness.", gif: "https://i.imgur.com/4g0f7Qn.gif" }
    ]
  };
}
const express = require("express");
const fs = require("fs");
const app1 = express();
app.use(express.json());

const DB_FILE = "db.json";

// Ensure db exists
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));

app.post("/api/login", (req, res) => {
  const { username, email, password } = req.body;
  const db = JSON.parse(fs.readFileSync(DB_FILE));

  let user = db.users.find(u => u.username === username || u.email === email);
  if (user) {
    if (user.password === password) {
      return res.json({ success: true, message: "Welcome back!" });
    } else {
      return res.json({ success: false, message: "Username or password incorrect" });
    }
  }

  // Register new user
  user = { username, email, password, data: {} };
  db.users.push(user);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  res.json({ success: true, message: "User registered!" });
});

app.listen(3000, () => console.log("✅ Server running at http://localhost:3000"));
