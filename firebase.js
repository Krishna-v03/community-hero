// ════════════════════════════════════════════════════════════
//  firebase.js — CivicHero Firebase Service Layer
//  Provides real-time Firestore sync + Firebase Auth.
//  Falls back GRACEFULLY to localStorage if not configured.
// ════════════════════════════════════════════════════════════

let _db = null;
let _auth = null;
let _firebaseReady = false;
let _firestoreListener = null;

// ── Initialize Firebase ────────────────────────────────────
async function initFirebase() {
  if (typeof FIREBASE_ENABLED === 'undefined' || !FIREBASE_ENABLED) {
    console.info("[Firebase] Not configured — running in localStorage mode.");
    return false;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    _db   = firebase.firestore();
    _auth = firebase.auth();
    _firebaseReady = true;
    console.info("[Firebase] ✅ Connected to Firestore successfully.");
    showToast("☁️ Firebase Connected", "Real-time sync is active across all devices.", "success");
    return true;
  } catch (err) {
    console.warn("[Firebase] Initialization failed — falling back to localStorage:", err);
    return false;
  }
}

// ── Auth: Sign In ──────────────────────────────────────────
async function firebaseSignIn(email, password) {
  if (!_firebaseReady || !_auth) return null;
  try {
    const cred = await _auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  } catch (err) {
    console.warn("[Firebase Auth] Sign-in failed:", err.code);
    return null;
  }
}

// ── Auth: Create Account ───────────────────────────────────
async function firebaseCreateUser(email, password) {
  if (!_firebaseReady || !_auth) return null;
  try {
    const cred = await _auth.createUserWithEmailAndPassword(email, password);
    return cred.user;
  } catch (err) {
    console.warn("[Firebase Auth] Create user failed:", err.code);
    return null;
  }
}

// ── Auth: Sign Out ─────────────────────────────────────────
async function firebaseSignOut() {
  if (!_firebaseReady || !_auth) return;
  try {
    await _auth.signOut();
  } catch (err) {
    console.warn("[Firebase Auth] Sign-out failed:", err);
  }
}

// ── Firestore: Load Issues ─────────────────────────────────
async function fbLoadIssues() {
  if (!_firebaseReady || !_db) return null;
  try {
    const snap = await _db.collection("issues").orderBy("createdAt", "desc").get();
    if (snap.empty) return null;
    return snap.docs.map(doc => ({ ...doc.data(), _fbId: doc.id }));
  } catch (err) {
    console.warn("[Firestore] Load issues failed:", err);
    return null;
  }
}

// ── Firestore: Load Users ──────────────────────────────────
async function fbLoadUsers() {
  if (!_firebaseReady || !_db) return null;
  try {
    const snap = await _db.collection("users").get();
    if (snap.empty) return null;
    return snap.docs.map(doc => ({ ...doc.data(), _fbId: doc.id }));
  } catch (err) {
    console.warn("[Firestore] Load users failed:", err);
    return null;
  }
}

// ── Firestore: Save All Issues (batch write) ───────────────
async function fbSaveIssues(issuesArray) {
  if (!_firebaseReady || !_db) return;
  try {
    const batch = _db.batch();
    issuesArray.forEach(issue => {
      const ref = _db.collection("issues").doc(issue.id);
      batch.set(ref, issue, { merge: true });
    });
    await batch.commit();
  } catch (err) {
    console.warn("[Firestore] Save issues failed:", err);
  }
}

// ── Firestore: Save All Users (batch write) ────────────────
async function fbSaveUsers(usersArray) {
  if (!_firebaseReady || !_db) return;
  try {
    const batch = _db.batch();
    usersArray.forEach(user => {
      const ref = _db.collection("users").doc(user.id);
      batch.set(ref, user, { merge: true });
    });
    await batch.commit();
  } catch (err) {
    console.warn("[Firestore] Save users failed:", err);
  }
}

// ── Firestore: Real-Time Issues Listener ──────────────────
// Subscribes to live updates — any change by any user (or officer)
// on any device instantly updates the local state and re-renders.
function fbSubscribeIssues(onUpdate) {
  if (!_firebaseReady || !_db) return;

  // Unsubscribe previous listener if any
  if (_firestoreListener) _firestoreListener();

  _firestoreListener = _db.collection("issues")
    .orderBy("createdAt", "desc")
    .onSnapshot(snap => {
      if (snap.empty) return;
      const updated = snap.docs.map(doc => ({ ...doc.data(), _fbId: doc.id }));
      onUpdate(updated);
    }, err => {
      console.warn("[Firestore] Real-time listener error:", err);
    });

  console.info("[Firebase] 🔴 Real-time issues listener active.");
}

// ── Firestore: Unsubscribe Real-Time ──────────────────────
function fbUnsubscribe() {
  if (_firestoreListener) {
    _firestoreListener();
    _firestoreListener = null;
  }
}

// ── Status Check ───────────────────────────────────────────
function isFirebaseReady() {
  return _firebaseReady;
}
