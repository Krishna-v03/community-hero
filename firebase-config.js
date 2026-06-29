// ════════════════════════════════════════════════════════════
//  firebase-config.js — CivicHero Firebase Configuration
// ════════════════════════════════════════════════════════════
//
//  SETUP INSTRUCTIONS (2 minutes):
//  1. Go to https://console.firebase.google.com/
//  2. Click "Add project" → name it "CivicHero"
//  3. In the project, click "Firestore Database" → Create in test mode
//  4. Click ⚙️ Project Settings → "Your apps" → </> Web App
//  5. Register the app and copy the firebaseConfig object
//  6. Replace the values below with your real config
//
// ════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Set to true ONLY after you have filled in real credentials above
const FIREBASE_ENABLED = false;
