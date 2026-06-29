// State Management
let issues = [];
let users = [];
let currentUser = null;
let currentView = 'citizen';
let adminSubView = 'dashboard';
let selectedIssueId = null;

// Leaflet Map Variables
let mainMap = null;
let adminMap = null;
let officerMap = null;
let mainMapMarkers = [];
let adminMapMarkers = [];
let officerMapMarkers = [];
let modalMap = null;
let modalMarker = null;

// Chart.js Instances
let categoryChartInstance = null;
let slaChartInstance = null;

// Draft Location for New Reports
let draftCoords = { lat: 12.9716, lng: 77.5946 };
let userActualCoords = { lat: 12.9716, lng: 77.5946 };

// Default image fallbacks for categorizations
const CATEGORY_DEFAULT_IMAGES = {
  pothole: "pothole.jpg.jpg",
  streetlight: "streetlight.jpg",
  garbage: "garbage.jpg",
  "water leakage": "water_leak.jpg.jpg",
  spam: "spam.jpg",
  other: "garbage.jpg"
};

// Request browser geolocation to center mapping
function requestUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userActualCoords.lat = position.coords.latitude;
        userActualCoords.lng = position.coords.longitude;
        draftCoords.lat = position.coords.latitude;
        draftCoords.lng = position.coords.longitude;

        // Dynamically center any active maps to the user's location
        if (mainMap) mainMap.setView([draftCoords.lat, draftCoords.lng], 13);
        if (adminMap) adminMap.setView([draftCoords.lat, draftCoords.lng], 13);
        if (officerMap) officerMap.setView([draftCoords.lat, draftCoords.lng], 13);
        if (modalMap) {
          modalMap.setView([draftCoords.lat, draftCoords.lng], 14);
          if (modalMarker) modalMarker.setLatLng([draftCoords.lat, draftCoords.lng]);
        }
      },
      (error) => {
        console.warn("Geolocation access denied or failed. Reverting to default city coordinates.", error);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }
}

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isPublicShare = urlParams.get('public') === '1' && urlParams.get('issue');

  // 1. Boot Firebase (or fall back to localStorage silently)
  await initFirebase();

  // 2. Load persistent data (tries Firebase first, then localStorage)
  await loadAllData();
  requestUserLocation();

  // Public read-only share — no login required (handled by enhancements.js)
  if (isPublicShare) return;

  // 3. Check for an existing session
  const savedSession = localStorage.getItem("civic_session");
  if (savedSession) {
    const sessionUser = JSON.parse(savedSession);
    currentUser = users.find(u => u.id === sessionUser.id) || sessionUser;
    bootApp();
  } else {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("app-container").style.display = "none";
  }
});

// Load all data — tries Firebase Firestore first, falls back to localStorage
async function loadAllData() {
  let fbIssues = null;
  let fbUsers = null;

  // Try Firebase if configured
  if (isFirebaseReady()) {
    try {
      [fbIssues, fbUsers] = await Promise.all([fbLoadIssues(), fbLoadUsers()]);
    } catch (e) {
      console.warn("[App] Firebase load failed, using localStorage fallback.", e);
    }
  }

  // Use Firebase data if available, otherwise fall back to localStorage → mockData
  const savedIssues = localStorage.getItem("civic_issues");
  const savedUsers = localStorage.getItem("civic_users");

  issues = fbIssues || (savedIssues ? JSON.parse(savedIssues) : window.INITIAL_ISSUES);
  users = fbUsers || (savedUsers ? JSON.parse(savedUsers) : window.INITIAL_USERS);

  // Self-heal any corrupted or incomplete issues (e.g. from previous buggy versions or mock data syncs)
  issues.forEach(issue => {
    // 1. Heal wardId if missing or invalid
    if (!issue.wardId || issue.wardId === "Unknown Ward") {
      let best = INITIAL_WARDS[0];
      let bestDist = Infinity;
      INITIAL_WARDS.forEach(ward => {
        const d = getDistance(issue.lat || 12.9716, issue.lng || 77.5946, ward.lat, ward.lng);
        if (d < bestDist) { bestDist = d; best = ward; }
      });
      issue.wardId = best.id;
    }
    // 2. Heal createdBy
    if (!issue.createdBy || issue.createdBy === "undefined") {
      issue.createdBy = "Anonymous Citizen";
    }
    // 3. Heal photoUrl
    if (!issue.photoUrl || issue.photoUrl === "undefined") {
      const catLower = (issue.category || "other").toLowerCase();
      issue.photoUrl = CATEGORY_DEFAULT_IMAGES[catLower] || CATEGORY_DEFAULT_IMAGES.other;
    }
    // 4. Heal slaDeadline
    if (!issue.slaDeadline || isNaN(new Date(issue.slaDeadline).getTime())) {
      let slaHours = 24;
      const catLower = (issue.category || "other").toLowerCase();
      if (catLower === "water leakage") slaHours = 6;
      else if (catLower === "garbage") slaHours = 12;
      else if (catLower === "pothole") slaHours = 48;
      else if (catLower === "spam") slaHours = 0;
      const refTime = issue.createdAt ? new Date(issue.createdAt).getTime() : Date.now();
      issue.slaDeadline = new Date(refTime + slaHours * 60 * 60 * 1000).toISOString();
    }
  });

  // Always keep credentials in sync with INITIAL_USERS (merge: preserve XP/badges)
  users = users.map(savedUser => {
    const master = window.INITIAL_USERS.find(u => u.id === savedUser.id);
    return master ? { ...savedUser, email: master.email, password: master.password } : savedUser;
  });

  // Persist to localStorage as local cache
  localStorage.setItem("civic_issues", JSON.stringify(issues));
  localStorage.setItem("civic_users", JSON.stringify(users));

  // Start real-time Firestore listener to keep all clients in sync
  if (isFirebaseReady()) {
    fbSubscribeIssues((liveIssues) => {
      issues = liveIssues;
      localStorage.setItem("civic_issues", JSON.stringify(issues));
      // Refresh the active view live
      if (currentView === 'citizen') { renderFeedList(); applyFilters(); }
      if (currentView === 'authority') { renderQueueList(); updateDashboardMetrics(); updateCharts(); }
      if (currentView === 'officer') { renderOfficerQueue(); }
      console.info("[Firebase] 🔄 Real-time update received — UI refreshed.");
    });
  }
}

// Boot the main app after a successful login
function bootApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-container").style.display = "flex";

  updateUserHUD();
  applyRoleUI();         // Show/hide nav & buttons for this role
  initMaps();            // Only init maps relevant to this role

  if (currentUser.role === 'citizen') applyFilters();
  if (currentUser.role === 'admin') initCharts();

  // Route to the correct starting view based on role
  if (currentUser.role === "admin") {
    switchView("authority");
  } else if (currentUser.role === "officer") {
    switchView("officer");
  } else {
    switchView("citizen");
  }

  // SLA auto-escalation check
  checkAndEscalateSLAs();
  setInterval(checkAndEscalateSLAs, 30000);

  // Deep link sharing check
  const urlParams = new URLSearchParams(window.location.search);
  const shareIssueId = urlParams.get('issue');
  if (shareIssueId) {
    setTimeout(() => {
      openDetailDrawer(shareIssueId);
    }, 800);
  }

  // Live re-triage listener on description box input
  const descInput = document.getElementById("issue-desc");
  if (descInput) {
    descInput.addEventListener("input", () => {
      const aiPanel = document.getElementById("report-ai-panel");
      if (aiPanel && aiPanel.classList.contains("active")) {
        const descText = descInput.value.toLowerCase();
        const catTag = document.getElementById("ai-category-tag");
        const priTag = document.getElementById("ai-priority-tag");

        let suggested = "";
        if (descText.includes("hole") || descText.includes("road") || descText.includes("crack") || descText.includes("pothole")) suggested = "pothole";
        else if (descText.includes("light") || descText.includes("bulb") || descText.includes("lamp") || descText.includes("streetlight")) suggested = "streetlight";
        else if (descText.includes("trash") || descText.includes("garbage") || descText.includes("dump") || descText.includes("rubbish") || descText.includes("waste") || descText.includes("bin")) suggested = "garbage";
        else if (descText.includes("water") || descText.includes("leak") || descText.includes("pipe") || descText.includes("wet") || descText.includes("leakage")) suggested = "water leakage";
        else if (descText.includes("selfie") || descText.includes("dog") || descText.includes("spam")) suggested = "spam";
        else {
          return; // Keep existing categorization if no matching keywords are typed yet
        }

        let priority = "Medium";
        if (suggested === "water leakage" || suggested === "pothole") priority = "High";
        if (suggested === "spam") priority = "Low";

        catTag.innerText = suggested === "spam" ? "SPAM / UNRELATED" : suggested.toUpperCase();
        priTag.innerText = priority;

        if (priority === "High") {
          priTag.style.color = "var(--color-danger)";
        } else if (priority === "Low") {
          priTag.style.color = "var(--text-muted)";
        } else {
          priTag.style.color = "var(--color-warning)";
        }

        // SLA tag update
        const slaMap = { "water leakage": "6 hrs", "garbage": "12 hrs", "pothole": "48 hrs", "streetlight": "24 hrs", "spam": "N/A" };
        const slaTag = document.getElementById("ai-sla-tag");
        if (slaTag) slaTag.innerText = slaMap[suggested] || "24 hrs";

        // Risk dot update
        const riskDot = document.getElementById("ai-risk-dot");
        const riskLabel = document.getElementById("ai-risk-label");
        if (riskDot && riskLabel) {
          if (priority === "High") {
            riskDot.style.background = "var(--color-danger)";
            riskLabel.innerText = "High — Immediate attention";
          } else if (priority === "Low") {
            riskDot.style.background = "var(--text-muted)";
            riskLabel.innerText = "Low — Spam/Unrelated";
          } else {
            riskDot.style.background = "var(--color-warning)";
            riskLabel.innerText = "Medium — Standard queue";
          }
        }
      }
    });
  }
}

// ── Auth: Handle login form submit ──
function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  const errMsg = document.getElementById("login-error-msg");
  const submitBtn = document.getElementById("btn-login-submit");

  // Clear previous errors
  errBox.style.display = "none";
  document.getElementById("login-email").classList.remove("error");
  document.getElementById("login-password").classList.remove("error");

  // Find matching user
  const matched = users.find(
    u => u.email && u.email.toLowerCase() === email && u.password === password
  );

  if (!matched) {
    errMsg.textContent = "Incorrect email or password. Please try again.";
    errBox.style.display = "flex";
    document.getElementById("login-email").classList.add("error");
    document.getElementById("login-password").classList.add("error");
    // Re-trigger shake animation
    errBox.style.animation = "none";
    errBox.offsetHeight; // reflow
    errBox.style.animation = "";
    return;
  }

  // Success — save session and boot
  currentUser = matched;
  localStorage.setItem("civic_session", JSON.stringify({ id: matched.id }));

  // Animate login screen out
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
  submitBtn.disabled = true;

  const loginScreen = document.getElementById("login-screen");
  loginScreen.classList.add("fade-out");

  setTimeout(() => {
    loginScreen.style.display = "none";
    loginScreen.classList.remove("fade-out");
    bootApp();
  }, 500);
}

// ── Auth: Logout ──
function logout() {
  // Stop camera if open
  closeCamera();

  // Unsubscribe Firebase real-time listener & sign out
  fbUnsubscribe();
  firebaseSignOut();

  // Clear session
  localStorage.removeItem("civic_session");
  currentUser = null;

  // Reset maps so they reinit on next login
  if (mainMap) { mainMap.remove(); mainMap = null; }
  if (adminMap) { adminMap.remove(); adminMap = null; }
  if (officerMap) { officerMap.remove(); officerMap = null; }
  if (modalMap) { modalMap.remove(); modalMap = null; }
  modalMarker = null;
  mainMapMarkers = [];
  adminMapMarkers = [];
  officerMapMarkers = [];

  // Reset charts
  if (categoryChartInstance) { categoryChartInstance.destroy(); categoryChartInstance = null; }
  if (slaChartInstance) { slaChartInstance.destroy(); slaChartInstance = null; }

  // Reset login form
  document.getElementById("login-form").reset();
  document.getElementById("login-error").style.display = "none";
  document.getElementById("btn-login-submit").innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
  document.getElementById("btn-login-submit").disabled = false;
  document.getElementById("login-email").classList.remove("error");
  document.getElementById("login-password").classList.remove("error");

  // Show login, hide app
  document.getElementById("app-container").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
}

// ── Auth: Quick-fill demo credentials ──
function fillCredentials(email, password) {
  document.getElementById("login-email").value = email;
  document.getElementById("login-password").value = password;
  document.getElementById("login-email").classList.remove("error");
  document.getElementById("login-password").classList.remove("error");
  document.getElementById("login-error").style.display = "none";
  document.getElementById("login-email").focus();
}

// ── Auth: Toggle password visibility ──
function togglePasswordVisibility() {
  const input = document.getElementById("login-password");
  const icon = document.getElementById("pw-eye-icon");
  if (input.type === "password") {
    input.type = "text";
    icon.className = "fa-regular fa-eye-slash";
  } else {
    input.type = "password";
    icon.className = "fa-regular fa-eye";
  }
}

// Save current application state — writes to localStorage AND Firebase in parallel
function saveState() {
  localStorage.setItem("civic_issues", JSON.stringify(issues));
  localStorage.setItem("civic_users", JSON.stringify(users));
  if (currentUser) {
    localStorage.setItem("civic_session", JSON.stringify({ id: currentUser.id }));
  }

  // Mirror to Firestore (non-blocking — fire and forget)
  if (isFirebaseReady()) {
    fbSaveIssues(issues).catch(e => console.warn("[Firestore] Issues sync failed:", e));
    fbSaveUsers(users).catch(e => console.warn("[Firestore] Users sync failed:", e));
  }
}


// Switch between screens/views
function switchView(viewName) {
  currentView = viewName;

  // Update sidebar menu highlight
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });
  const activeNav = document.getElementById(`nav-${viewName}`);
  if (activeNav) activeNav.classList.add("active");

  // Show active view panel
  document.querySelectorAll(".app-view").forEach(panel => {
    panel.classList.remove("active");
    panel.style.display = 'none';
  });

  const activePanel = document.getElementById(`view-${viewName}`);
  if (activePanel) {
    activePanel.classList.add("active");
    activePanel.style.display = 'flex';
  }

  // Trigger recalculations/renders based on view
  if (viewName === 'citizen') {
    setTimeout(() => {
      if (mainMap) {
        mainMap.invalidateSize();
        mainMap.setView([draftCoords.lat, draftCoords.lng], 13);
      }
    }, 200);
    renderFeedList();
  } else if (viewName === 'authority') {
    toggleAdminView(adminSubView);
    updateDashboardMetrics();
    updateCharts();
  } else if (viewName === 'officer') {
    setTimeout(() => {
      if (officerMap) {
        officerMap.invalidateSize();
        officerMap.setView([draftCoords.lat, draftCoords.lng], 13);
      }
    }, 200);
    renderOfficerQueue();
  } else if (viewName === 'public') {
    renderLeaderboard();
  }
}

// Switch between dashboard widgets & operational queues in Admin
function toggleAdminView(subView) {
  adminSubView = subView;
  const analyticsView = document.getElementById("admin-analytics-view");
  const queueView = document.getElementById("admin-queue-view");

  if (subView === 'dashboard') {
    analyticsView.style.display = "flex";
    queueView.style.display = "none";
  } else {
    analyticsView.style.display = "none";
    queueView.style.display = "flex";
    setTimeout(() => {
      if (adminMap) {
        adminMap.invalidateSize();
        adminMap.setView([draftCoords.lat, draftCoords.lng], 13);
      }
    }, 200);
    renderQueueList();
  }
}

// User Profile HUD Update
function updateUserHUD() {
  if (!currentUser) return;
  const avatar = document.getElementById("user-avatar");
  const nameDisplay = document.getElementById("user-name-display");
  const roleDisplay = document.getElementById("user-role-display");
  const pointsDisplay = document.getElementById("user-points-display");
  const trustDisplay = document.getElementById("user-trust-display");

  // Initials avatar
  const initials = currentUser.name.split(" ").map(n => n[0]).join("");
  avatar.innerText = initials;
  nameDisplay.innerText = currentUser.name;

  const statsContainer = document.querySelector(".user-stats-mini");
  if (currentUser.role === "admin") {
    roleDisplay.innerText = "Admin Console";
    if (statsContainer) statsContainer.style.display = "none";
  } else if (currentUser.role === "officer") {
    roleDisplay.innerText = "Field Officer";
    if (statsContainer) statsContainer.style.display = "none";
  } else {
    roleDisplay.innerText = "Citizen Reporter";
    if (statsContainer) statsContainer.style.display = "flex";
    pointsDisplay.innerText = `${currentUser.points || 0} XP`;
    trustDisplay.innerText = `${currentUser.trustScore || 0}%`;
  }
}

// Apply role-based UI — show/hide nav items, header buttons, search bar
function applyRoleUI() {
  if (!currentUser) return;
  const role = currentUser.role;

  // Hide all nav items first, then reveal role-specific ones
  const navItems = {
    citizen: document.getElementById('nav-citizen'),
    authority: document.getElementById('nav-authority'),
    public: document.getElementById('nav-public'),
    officer: document.getElementById('nav-officer')
  };
  Object.values(navItems).forEach(el => { if (el) el.style.display = 'none'; });

  if (role === 'citizen') {
    if (navItems.citizen) navItems.citizen.style.display = 'block';
    if (navItems.public) navItems.public.style.display = 'block';
  } else if (role === 'officer') {
    if (navItems.officer) navItems.officer.style.display = 'block';
  } else if (role === 'admin') {
    if (navItems.authority) navItems.authority.style.display = 'block';
  }

  // "Report Issue" button — citizens only
  const reportBtn = document.getElementById('btn-report-header');
  if (reportBtn) reportBtn.style.display = role === 'citizen' ? 'flex' : 'none';

  // Search bar — hide for officers (they have their own queue view)
  const searchWrapper = document.getElementById('header-search-wrapper');
  if (searchWrapper) {
    searchWrapper.style.display = (role === 'citizen' || role === 'admin') ? 'flex' : 'none';
  }
}


// Initialize Leaflet Maps (role-aware — only init maps relevant to logged-in role)
function initMaps() {
  const role = currentUser ? currentUser.role : 'citizen';
  const startLoc = [draftCoords.lat, draftCoords.lng];

  if (role === 'citizen') {
    mainMap = L.map('map-element', { zoomControl: false }).setView(startLoc, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(mainMap);
    L.control.zoom({ position: 'bottomright' }).addTo(mainMap);
  }

  if (role === 'admin') {
    adminMap = L.map('admin-map-element', { zoomControl: false }).setView(startLoc, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(adminMap);
    L.control.zoom({ position: 'bottomright' }).addTo(adminMap);
  }

  if (role === 'officer') {
    officerMap = L.map('officer-map-element', { zoomControl: false }).setView(startLoc, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(officerMap);
    L.control.zoom({ position: 'bottomright' }).addTo(officerMap);
  }
}

// Render colored Leaflet markers based on issue details
function renderMapMarkers(filteredIssues, mapInstance, markerArray, clickCallback) {
  if (!mapInstance) return; // Guard: map may not be initialized for this role
  markerArray.forEach(m => mapInstance.removeLayer(m));
  markerArray.length = 0;

  // Custom Colored Pulse Markers
  filteredIssues.forEach(issue => {
    if (issue.status === "Closed") return;

    let markerColor = "#6366f1"; // default Indigo
    if (issue.status === "Reported") markerColor = "#ef4444";
    if (issue.status === "Verified") markerColor = "#34d399";
    if (issue.status === "Assigned") markerColor = "#22d3ee";
    if (issue.status === "In Progress") markerColor = "#fbbf24";
    if (issue.status === "Resolved") markerColor = "#10b981";

    const customIcon = L.divIcon({
      className: 'custom-map-pin',
      html: `<div style="background-color: ${markerColor}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 10px ${markerColor};"></div>`,
      iconSize: [14, 14]
    });

    const marker = L.marker([issue.lat, issue.lng], { icon: customIcon }).addTo(mapInstance);

    // Bind click events
    marker.on('click', () => {
      clickCallback(issue.id);
    });

    markerArray.push(marker);
  });
}

// Calculate simple geographical distance in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}

// Render issues in Citizen feed column
function renderFeedList() {
  const container = document.getElementById("citizen-feed-container");
  container.innerHTML = "";

  const filtered = getFilteredIssues();

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 32px 0;">No active issues match filters.</div>`;
    return;
  }

  filtered.forEach(issue => {
    const card = document.createElement("div");
    card.className = `glass-card ${issue.category}`;
    card.onclick = () => openDetailDrawer(issue.id);

    const isOverdue = new Date() > new Date(issue.slaDeadline) && issue.status !== "Resolved" && issue.status !== "Closed";

    card.innerHTML = `
      <div class="card-header">
        <span class="card-badge status-${issue.status.toLowerCase().replace(" ", "-")}">${issue.status}</span>
        ${isOverdue ? `<span class="card-badge" style="background: rgba(239, 68, 68, 0.15); color: var(--color-danger); border: 1px solid var(--color-danger);"><i class="fa-solid fa-clock"></i> Overdue</span>` : ''}
      </div>
      <h3 class="card-title">${issue.category}</h3>
      <p class="card-desc">${issue.description}</p>
      
      <div class="card-footer">
        <div class="card-meta">
          <span><i class="fa-regular fa-calendar"></i> ${new Date(issue.createdAt).toLocaleDateString()}</span>
          <span><i class="fa-solid fa-location-dot"></i> ${getWardName(issue.wardId)}</span>
        </div>
        <div class="card-votes">
          <i class="fa-solid fa-check-double"></i>
          <span>${issue.votes.filter(v => v.voteType === "confirm").length} confirms</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // Re-draw map pins
  renderMapMarkers(filtered, mainMap, mainMapMarkers, openDetailDrawer);
}

// Apply searches and active dropdown filters
function getFilteredIssues() {
  const categoryFilter = document.getElementById("filter-category").value;
  const statusFilter = document.getElementById("filter-status").value;
  const searchVal = document.getElementById("search-input").value.toLowerCase().trim();

  return issues.filter(issue => {
    // Resolved and Closed issues should vanish from citizen tab
    if (issue.status === "Resolved" || issue.status === "Closed") return false;

    const matchCategory = categoryFilter === "all" || issue.category === categoryFilter;
    const matchStatus = statusFilter === "all" || issue.status === statusFilter;
    const matchSearch = issue.description.toLowerCase().includes(searchVal) ||
      issue.category.toLowerCase().includes(searchVal) ||
      getWardName(issue.wardId).toLowerCase().includes(searchVal);
    return matchCategory && matchStatus && matchSearch;
  });
}

function applyFilters() {
  renderFeedList();
}

// Render issues in Admin queue
function renderQueueList() {
  const container = document.getElementById("admin-queue-container");
  container.innerHTML = "";

  const wardFilter = document.getElementById("queue-filter-ward").value;
  const filtered = issues.filter(issue => {
    if (issue.status === "Closed") return false;
    return wardFilter === "all" || issue.wardId === wardFilter;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 32px 0;">Queue clear! No open issues.</div>`;
    return;
  }

  filtered.forEach(issue => {
    const card = document.createElement("div");
    card.className = `glass-card ${issue.category}`;
    card.onclick = () => openDetailDrawer(issue.id);

    card.innerHTML = `
      <div class="card-header">
        <span class="card-badge status-${issue.status.toLowerCase().replace(" ", "-")}">${issue.status}</span>
        <span class="card-badge" style="background:rgba(255,255,255,0.05); color:#fff;">SLA: ${new Date(issue.slaDeadline).toLocaleDateString()}</span>
      </div>
      <h3 class="card-title">${issue.category}</h3>
      <p class="card-desc">${issue.description}</p>
      
      <div class="card-footer">
        <span>Ward: ${getWardName(issue.wardId)}</span>
        <span style="font-weight: 600; color: ${issue.severity === 'High' ? 'var(--color-danger)' : 'var(--color-warning)'}">${issue.severity} Priority</span>
      </div>
    `;
    container.appendChild(card);
  });

  renderMapMarkers(filtered, adminMap, adminMapMarkers, openDetailDrawer);
}

// Render issues assigned to the current field officer only
function renderOfficerQueue() {
  const container = document.getElementById("officer-queue-container");
  if (!container) return;
  container.innerHTML = "";

  // Only show active (not closed/resolved) issues assigned to this officer
  const myIssues = issues.filter(issue =>
    issue.assignedTo === currentUser.id &&
    issue.status !== "Closed" &&
    issue.status !== "Resolved"
  );

  if (myIssues.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; color:var(--text-muted); padding:48px 24px;">
        <i class="fa-solid fa-clipboard-check" style="font-size:48px; margin-bottom:16px; display:block; opacity:0.2;"></i>
        <div style="font-weight:600; font-size:15px; margin-bottom:6px;">No Active Assignments</div>
        <div style="font-size:13px;">You currently have no issues assigned to you.<br>Contact your admin for new task assignments.</div>
      </div>`;
    return;
  }

  myIssues.forEach(issue => {
    const card = document.createElement("div");
    card.className = `glass-card ${issue.category}`;
    card.onclick = () => openDetailDrawer(issue.id);

    const isOverdue = new Date() > new Date(issue.slaDeadline);
    const slaDate = new Date(issue.slaDeadline).toLocaleDateString();

    card.innerHTML = `
      <div class="card-header">
        <span class="card-badge status-${issue.status.toLowerCase().replace(" ", "-")}">${issue.status}</span>
        ${isOverdue ? `<span class="card-badge" style="background:rgba(239,68,68,0.15);color:var(--color-danger);border:1px solid var(--color-danger);"><i class="fa-solid fa-clock"></i> Overdue</span>` : ''}
      </div>
      <h3 class="card-title">${issue.category}</h3>
      <p class="card-desc">${issue.description}</p>
      <div class="card-footer">
        <span><i class="fa-solid fa-location-dot"></i> ${getWardName(issue.wardId)}</span>
        <span style="font-weight:600; color:${isOverdue ? 'var(--color-danger)' : 'var(--color-warning)'}">
          <i class="fa-regular fa-clock"></i> SLA: ${slaDate}
        </span>
      </div>
    `;
    container.appendChild(card);
  });

  if (officerMap) {
    renderMapMarkers(myIssues, officerMap, officerMapMarkers, openDetailDrawer);
  }
}

function applyQueueFilters() {
  renderQueueList();
}

// Helper to look up Ward Names
function getWardName(wardId) {
  const ward = INITIAL_WARDS.find(w => w.id === wardId);
  return ward ? ward.name : "Unknown Ward";
}

// Open Detail Drawer
function openDetailDrawer(issueId) {
  selectedIssueId = issueId;
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;

  const drawer = document.getElementById("issue-detail-drawer");
  drawer.classList.add("active");

  // Populate data
  document.getElementById("drawer-badge").className = `card-badge status-${issue.status.toLowerCase().replace(" ", "-")}`;
  document.getElementById("drawer-badge").innerText = issue.status;

  // Render photo or video evidence
  const drawerImg = document.getElementById("drawer-img");
  const drawerVid = document.getElementById("drawer-vid");
  const isVideoEvidence = issue.photoUrl && issue.photoUrl.startsWith('blob:');
  const fallbackImg = CATEGORY_DEFAULT_IMAGES[(issue.category || "other").toLowerCase()] || CATEGORY_DEFAULT_IMAGES.other;

  if (isVideoEvidence) {
    drawerImg.style.display = 'none';
    drawerVid.style.display = 'block';
    drawerVid.src = issue.photoUrl;
    drawerVid.onerror = () => {
      drawerVid.style.display = 'none';
      drawerImg.style.display = 'block';
      drawerImg.src = fallbackImg;
    };
  } else {
    drawerVid.style.display = 'none';
    drawerImg.style.display = 'block';
    drawerImg.src = issue.photoUrl || fallbackImg;
    drawerImg.onerror = () => {
      drawerImg.src = fallbackImg;
    };
  }

  document.getElementById("drawer-title").innerText = `${issue.category} Issue`;
  document.getElementById("drawer-description").innerText = issue.description;

  // Build meta details
  const metaContainer = document.getElementById("drawer-meta");
  metaContainer.innerHTML = `
    <span><i class="fa-solid fa-location-dot"></i> ${getWardName(issue.wardId)}</span>
    <span><i class="fa-regular fa-user"></i> Reported by ${issue.createdBy}</span>
    <span><i class="fa-solid fa-gauge-high"></i> ${issue.severity} Priority</span>
  `;

  // Render Duplicate Warnings for Admins
  const duplicateWidget = document.getElementById("drawer-duplicate-widget");
  const isDuplicateCandidate = issues.some(otherIssue =>
    otherIssue.id !== issue.id &&
    otherIssue.category === issue.category &&
    otherIssue.status !== "Closed" &&
    getDistance(issue.lat, issue.lng, otherIssue.lat, otherIssue.lng) < 60
  );

  if (currentUser.role === 'admin' && isDuplicateCandidate && issue.status !== "Closed") {
    duplicateWidget.style.display = "block";
  } else {
    duplicateWidget.style.display = "none";
  }

  // Verification Box Toggle
  const verifBox = document.getElementById("citizen-verification-box");
  const confirmCount = document.getElementById("verification-count");
  confirmCount.innerText = `${issue.votes.filter(v => v.voteType === "confirm").length} Confirmations`;

  const userVote = issue.votes.find(v => v.userId === currentUser.id);
  const btnConfirm = document.getElementById("btn-vote-confirm");
  const btnFlag = document.getElementById("btn-vote-flag");

  btnConfirm.classList.remove("active");
  btnFlag.classList.remove("active");

  if (userVote) {
    if (userVote.voteType === 'confirm') btnConfirm.classList.add("active");
    if (userVote.voteType === 'flag') btnFlag.classList.add("active");
  }

  if (currentUser.role === 'citizen') {
    verifBox.style.display = "block";
    document.getElementById("admin-operations-box").style.display = "none";
  } else {
    verifBox.style.display = "none";
    document.getElementById("admin-operations-box").style.display = "block";
    setupAdminOperations(issue);
  }

  // Populate timeline
  const timeline = document.getElementById("drawer-timeline-container");
  timeline.innerHTML = "";
  issue.statusHistory.forEach(history => {
    const step = document.createElement("div");
    step.className = "timeline-step completed";
    step.innerHTML = `
      <div class="timeline-step-title">${history.status}</div>
      <div class="timeline-step-time">${new Date(history.timestamp).toLocaleString()} by ${history.changedBy}</div>
      <div class="timeline-step-note">${history.notes || ''}</div>
    `;
    timeline.appendChild(step);
  });
}

function closeDetailDrawer() {
  document.getElementById("issue-detail-drawer").classList.remove("active");
  selectedIssueId = null;
}

// User community verification voting logic
function submitVote(voteType) {
  if (!selectedIssueId) return;
  const issue = issues.find(i => i.id === selectedIssueId);
  if (!issue) return;

  const existingVoteIndex = issue.votes.findIndex(v => v.userId === currentUser.id);

  if (existingVoteIndex > -1) {
    const existingVote = issue.votes[existingVoteIndex];
    if (existingVote.voteType === voteType) {
      // Toggle off
      issue.votes.splice(existingVoteIndex, 1);
    } else {
      // Swap vote
      existingVote.voteType = voteType;
    }
  } else {
    // Add new vote
    issue.votes.push({ userId: currentUser.id, voteType });
    // Add XP points to citizen for verifying
    currentUser.points += 10;

    // Check milestones for badges
    checkMilestones();
  }

  // Auto-verify logic: If >= 2 confirmations and currently "Reported", auto-update to "Verified"
  const confirms = issue.votes.filter(v => v.voteType === 'confirm').length;
  if (confirms >= 2 && issue.status === "Reported") {
    issue.status = "Verified";
    issue.statusHistory.push({
      status: "Verified",
      changedBy: "CivicHero Engine",
      timestamp: new Date().toISOString(),
      notes: "Auto-verified via community threshold."
    });
    // Notify if this is the current user's issue
    if (issue.createdBy === currentUser.name) {
      pushNotification("Issue Verified! ✅", `Your ${issue.category} report was community-verified.`, "success");
    } else {
      pushNotification("Community Verified", `A ${issue.category} report has been auto-verified by the community.`, "info");
    }
  }

  saveState();
  updateUserHUD();
  openDetailDrawer(selectedIssueId); // refresh
  renderFeedList();
}

// Check if user unlocked badges
function checkMilestones() {
  const reportingCount = issues.filter(i => i.createdBy === currentUser.name).length;

  if (reportingCount >= 1 && !currentUser.badges.includes("First Responder")) {
    currentUser.badges.push("First Responder");
  }
  if (currentUser.points >= 200 && !currentUser.badges.includes("Community Champion")) {
    currentUser.badges.push("Community Champion");
  }
}

// Admin panel dropdown assignment logic
// Admin/officer panel — show correct controls for each role
function setupAdminOperations(issue) {
  const assignSelect = document.getElementById("assign-officer-select");
  const actionsContainer = document.getElementById("officer-actions");
  const assignGroup = document.getElementById("assign-officer-group");

  // Officers cannot reassign tickets — hide the dropdown
  if (assignGroup) {
    assignGroup.style.display = currentUser.role === 'officer' ? 'none' : 'block';
  }

  // Update panel heading for officers
  const panelTitle = document.querySelector('#admin-operations-box h4');
  if (panelTitle) {
    panelTitle.innerHTML = currentUser.role === 'officer'
      ? '<i class="fa-solid fa-toolbox"></i> Field Operations'
      : '<i class="fa-solid fa-toolbox"></i> Officer Assignments';
  }

  assignSelect.value = issue.assignedTo || "none";
  actionsContainer.innerHTML = "";

  if (issue.status === "Closed" || issue.status === "Resolved") {
    actionsContainer.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">Issue is ${issue.status}. No operations needed.</p>`;
    return;
  }

  // Officers viewing issues not assigned to them — show info only
  if (currentUser.role === 'officer' && issue.assignedTo !== currentUser.id) {
    actionsContainer.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">This issue is not assigned to you.</p>`;
    return;
  }

  // If assigned to currently active officer, or is admin, display operational updates
  if (currentUser.role === 'admin' || issue.assignedTo === currentUser.id) {
    if (issue.status === "Verified" || issue.status === "Assigned") {
      actionsContainer.innerHTML = `
        <button class="btn-primary" onclick="updateIssueStatus('In Progress')">
          <i class="fa-solid fa-play"></i> Start Resolution Work
        </button>
      `;
    } else if (issue.status === "In Progress") {
      actionsContainer.innerHTML = `
        <button class="btn-primary" id="btn-resolve-work" onclick="updateIssueStatus('Resolved')" style="background:var(--color-success); margin-top:12px;">
          <i class="fa-solid fa-check"></i> Mark as Resolved
        </button>
      `;
    }
  }
}

function assignOfficer() {
  if (!selectedIssueId) return;
  const issue = issues.find(i => i.id === selectedIssueId);
  const officerId = document.getElementById("assign-officer-select").value;

  if (officerId === "none") {
    issue.assignedTo = null;
  } else {
    issue.assignedTo = officerId;
    const officer = users.find(u => u.id === officerId);
    issue.status = "Assigned";
    issue.statusHistory.push({
      status: "Assigned",
      changedBy: currentUser.name,
      timestamp: new Date().toISOString(),
      notes: `Ticket assigned to field officer ${officer.name}`
    });
  }

  saveState();
  openDetailDrawer(selectedIssueId);
  renderQueueList();
}

function simulateAfterPhotoUpload() {}

function updateIssueStatus(newStatus) {
  if (!selectedIssueId) return;
  const issue = issues.find(i => i.id === selectedIssueId);
  if (!issue) return;

  issue.status = newStatus;
  issue.statusHistory.push({
    status: newStatus,
    changedBy: currentUser.name,
    timestamp: new Date().toISOString(),
    notes: newStatus === "Resolved" ? "Work verified. Proof-of-work photo attached." : "Field operations started."
  });

  // Notify on status changes
  if (newStatus === "Resolved") {
    pushNotification("Issue Resolved ✅", `${issue.category} at ${getWardName(issue.wardId)} has been resolved.`, "success");
  } else if (newStatus === "In Progress") {
    pushNotification("Work Started", `Officer is working on the ${issue.category} report.`, "info");
  }

  saveState();
  openDetailDrawer(selectedIssueId);
  // Refresh the correct queue for the current role
  if (currentUser.role === 'officer') {
    renderOfficerQueue();
  } else {
    renderQueueList();
  }
}

// Merges duplicate tickets
function mergeDuplicateTicket() {
  if (!selectedIssueId) return;
  const issue = issues.find(i => i.id === selectedIssueId);
  if (!issue) return;

  // Find the duplicate candidate
  const parent = issues.find(other =>
    other.id !== issue.id &&
    other.category === issue.category &&
    other.status !== "Closed" &&
    getDistance(issue.lat, issue.lng, other.lat, other.lng) < 60
  );

  if (parent) {
    issue.status = "Closed";
    issue.statusHistory.push({
      status: "Closed",
      changedBy: currentUser.name,
      timestamp: new Date().toISOString(),
      notes: `Closed as duplicate. Merged into Ticket #${parent.id}`
    });

    saveState();
    closeDetailDrawer();
    renderQueueList();
    alert(`Ticket successfully merged into primary ticket #${parent.id}.`);
  }
}// Report Modal Flow
function openReportModal() {
  // Reset draft coordinates back to the user's actual location
  draftCoords.lat = userActualCoords.lat;
  draftCoords.lng = userActualCoords.lng;

  const modal = document.getElementById("report-modal");
  modal.classList.add("active");
  // Stage 1: wait for overlay transition
  // Stage 2: then initialize or invalidate the map inside the fully-visible modal
  setTimeout(() => {
    const currentLoc = [draftCoords.lat, draftCoords.lng];
    if (!modalMap) {
      modalMap = L.map('modal-map', {
        zoomControl: true,
        scrollWheelZoom: false  // prevent accidental zoom-out taking over the modal
      }).setView(currentLoc, 14);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(modalMap);

      modalMarker = L.marker(currentLoc, { draggable: true }).addTo(modalMap);
      modalMarker.on('dragend', () => {
        const position = modalMarker.getLatLng();
        draftCoords.lat = position.lat;
        draftCoords.lng = position.lng;
      });

      // Add click listener so user can click map to move marker
      modalMap.on('click', (e) => {
        modalMarker.setLatLng(e.latlng);
        draftCoords.lat = e.latlng.lat;
        draftCoords.lng = e.latlng.lng;
      });

      // Invalidate after another tick to let Leaflet compute the container size
      setTimeout(() => { modalMap.invalidateSize(); }, 50);
    } else {
      // Re-use existing map: reset to latest location and refresh tiles
      modalMarker.setLatLng(currentLoc);
      modalMap.setView(currentLoc, 14);
      setTimeout(() => { modalMap.invalidateSize(); }, 50);
    }
  }, 350);
}
function closeReportModal() {
  closeCamera(); // stop any active stream first
  document.getElementById("report-modal").classList.remove("active");
  document.getElementById("issue-report-form").reset();
  document.getElementById("report-ai-panel").classList.remove("active");
  // Reset camera UI
  resetCameraUI();
}

// ── Camera State ──
let cameraStream = null;
let capturedDataUrl = null;   // used for photos
let capturedVideoBlob = null;  // used for videos
let cameraMode = 'photo'; // 'photo' | 'video'
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimerInterval = null;
let recordingSeconds = 0;

// Switch between Photo and Video mode inside the live camera preview
function setCameraMode(mode) {
  cameraMode = mode;

  // Update toggle pill UI
  document.getElementById('mode-btn-photo').classList.toggle('active', mode === 'photo');
  document.getElementById('mode-btn-video').classList.toggle('active', mode === 'video');

  // Swap shutter ↔ record button
  document.getElementById('btn-shutter').style.display = mode === 'photo' ? 'flex' : 'none';
  document.getElementById('btn-record').style.display = mode === 'video' ? 'flex' : 'none';

  // Update label in form
  const lbl = document.getElementById('capture-mode-label');
  if (lbl) lbl.textContent = mode === 'photo' ? 'Photo' : 'Video';

  // If we switch away from video while recording, stop recording first
  if (mode === 'photo' && mediaRecorder && mediaRecorder.state === 'recording') {
    stopVideoRecording();
  }
}

// Reset everything to idle state
function resetCameraUI() {
  document.getElementById('camera-idle').style.display = 'block';
  document.getElementById('camera-preview-wrapper').style.display = 'none';
  document.getElementById('captured-preview-wrapper').style.display = 'none';

  const imgEl = document.getElementById('captured-img');
  const vidEl = document.getElementById('captured-video');
  if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
  if (vidEl) { vidEl.src = ''; vidEl.style.display = 'none'; }

  // Reset mode to photo
  cameraMode = 'photo';
  setCameraMode('photo');

  capturedDataUrl = null;
  capturedVideoBlob = null;
  recordedChunks = [];
  clearRecordingTimer();
}

// Open device camera
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera access is not supported by your browser or requires a secure connection (HTTPS or localhost). If you are accessing via IP address, please use http://localhost:3000 instead.');
    return;
  }

  try {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true   // needed for video recording
    };
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn('Failed to access camera with audio, retrying without audio...', err);
    // Fallback: Try video only (no audio)
    try {
      const constraintsVideoOnly = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      cameraStream = await navigator.mediaDevices.getUserMedia(constraintsVideoOnly);
      showToast('Camera Info', 'Camera accessed without audio (no microphone found or permitted).', 'warning');
    } catch (fallbackErr) {
      const msg = fallbackErr.name === 'NotAllowedError'
        ? 'Camera permission was denied. Please allow camera access and try again.'
        : `Unable to access camera on this device: ${fallbackErr.message || fallbackErr.name}`;
      alert(msg);
      return;
    }
  }

  try {
    const video = document.getElementById('camera-video');
    video.srcObject = cameraStream;
    video.muted = true; // keep preview silent; audio captured in MediaRecorder
    document.getElementById('camera-idle').style.display = 'none';
    document.getElementById('camera-preview-wrapper').style.display = 'block';
    // Default to photo mode
    setCameraMode('photo');
  } catch (err) {
    alert('Failed to initialize video element: ' + err.message);
  }
}

// Stop all camera/recording streams
function closeCamera() {
  // Stop recording if active
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  clearRecordingTimer();

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = document.getElementById('camera-video');
  if (video) video.srcObject = null;

  // Hide recording timer
  const timer = document.getElementById('recording-timer');
  if (timer) timer.style.display = 'none';
  const btn = document.getElementById('btn-record');
  if (btn) btn.classList.remove('recording');
}

// Snapshot the current video frame onto a canvas
function capturePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('capture-canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  capturedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  closeCamera();

  // Show photo preview, hide video preview
  const imgEl = document.getElementById('captured-img');
  const vidEl = document.getElementById('captured-video');
  imgEl.src = capturedDataUrl;
  imgEl.style.display = 'block';
  vidEl.style.display = 'none';

  document.getElementById('camera-preview-wrapper').style.display = 'none';
  document.getElementById('captured-preview-wrapper').style.display = 'block';

  // Update badge label
  const mediaTypeEl = document.getElementById('captured-media-type');
  if (mediaTypeEl) mediaTypeEl.textContent = 'Photo';

  simulateAIDiagnostics('captured_issue_photo.jpg');
}

// Toggle video recording on/off
function toggleVideoRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopVideoRecording();
  } else {
    startVideoRecording();
  }
}

// Start MediaRecorder
function startVideoRecording() {
  if (!cameraStream) return;
  recordedChunks = [];

  // Choose a supported MIME type
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4';

  try {
    mediaRecorder = new MediaRecorder(cameraStream, { mimeType });
  } catch (e) {
    mediaRecorder = new MediaRecorder(cameraStream);
  }

  mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const mType = mediaRecorder.mimeType || 'video/webm';
    capturedVideoBlob = new Blob(recordedChunks, { type: mType });
    const blobUrl = URL.createObjectURL(capturedVideoBlob);

    // Show video preview, hide photo preview
    const imgEl = document.getElementById('captured-img');
    const vidEl = document.getElementById('captured-video');
    imgEl.style.display = 'none';
    imgEl.src = '';
    vidEl.src = blobUrl;
    vidEl.style.display = 'block';

    document.getElementById('camera-preview-wrapper').style.display = 'none';
    document.getElementById('captured-preview-wrapper').style.display = 'block';

    const mediaTypeEl = document.getElementById('captured-media-type');
    if (mediaTypeEl) mediaTypeEl.textContent = 'Video';

    // AI triage still runs (filename-based fallback for video)
    simulateAIDiagnostics('captured_issue_video.mp4');
  };

  mediaRecorder.start(200); // collect a chunk every 200ms

  // Update record button UI
  const btn = document.getElementById('btn-record');
  if (btn) btn.classList.add('recording');

  // Show & start timer
  recordingSeconds = 0;
  const timerEl = document.getElementById('recording-timer');
  if (timerEl) timerEl.style.display = 'flex';
  updateRecTimerDisplay();
  recordingTimerInterval = setInterval(() => {
    recordingSeconds++;
    updateRecTimerDisplay();
    // Auto-stop at 2 minutes to prevent huge blobs
    if (recordingSeconds >= 120) stopVideoRecording();
  }, 1000);
}

// Stop MediaRecorder
function stopVideoRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  clearRecordingTimer();

  const btn = document.getElementById('btn-record');
  if (btn) btn.classList.remove('recording');

  const timerEl = document.getElementById('recording-timer');
  if (timerEl) timerEl.style.display = 'none';

  // Stop the camera stream after recording is complete
  closeCamera();
}

// Helper: clear recording timer
function clearRecordingTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
}

// Helper: format seconds as MM:SS
function updateRecTimerDisplay() {
  const mm = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
  const ss = String(recordingSeconds % 60).padStart(2, '0');
  const el = document.getElementById('rec-time');
  if (el) el.textContent = `${mm}:${ss}`;
}

// Retake — restart camera from scratch
function retakePhoto() {
  capturedDataUrl = null;
  capturedVideoBlob = null;
  recordedChunks = [];

  const imgEl = document.getElementById('captured-img');
  const vidEl = document.getElementById('captured-video');
  if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
  if (vidEl) { vidEl.src = ''; vidEl.style.display = 'none'; }

  document.getElementById('captured-preview-wrapper').style.display = 'none';
  document.getElementById('report-ai-panel').classList.remove('active');
  openCamera();
}

// Helper to simulate camera captures for testing different categories
function simulateCameraCapture(fileName) {
  closeCamera();

  let category = 'other';
  const nameLower = fileName.toLowerCase();
  if (nameLower.includes('hole')) category = 'pothole';
  else if (nameLower.includes('light')) category = 'streetlight';
  else if (nameLower.includes('garbage')) category = 'garbage';
  else if (nameLower.includes('leak')) category = 'water leakage';
  else if (nameLower.includes('selfie') || nameLower.includes('dog') || nameLower.includes('spam')) category = 'spam';

  capturedDataUrl = CATEGORY_DEFAULT_IMAGES[category] || CATEGORY_DEFAULT_IMAGES.other;
  capturedVideoBlob = null;

  // Show photo preview
  const imgEl = document.getElementById('captured-img');
  const vidEl = document.getElementById('captured-video');
  imgEl.src = capturedDataUrl;
  imgEl.style.display = 'block';
  if (vidEl) vidEl.style.display = 'none';

  document.getElementById('camera-idle').style.display = 'none';
  document.getElementById('camera-preview-wrapper').style.display = 'none';
  document.getElementById('captured-preview-wrapper').style.display = 'block';

  const mediaTypeEl = document.getElementById('captured-media-type');
  if (mediaTypeEl) mediaTypeEl.textContent = 'Photo';

  simulateAIDiagnostics(fileName);
}

async function simulateAIDiagnostics(fileName) {
  const aiPanel = document.getElementById("report-ai-panel");
  const catTag = document.getElementById("ai-category-tag");
  const confTag = document.getElementById("ai-confidence-tag");
  const priTag = document.getElementById("ai-priority-tag");
  const duplicateAlert = document.getElementById("ai-duplicate-warning");
  const spamAlert = document.getElementById("ai-spam-warning");

  const submitBtn = document.getElementById("btn-submit-report");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`;
  }

  aiPanel.classList.add("active");
  catTag.innerText = "Analyzing image...";
  confTag.innerText = "--";
  priTag.innerText = "--";
  duplicateAlert.style.display = "none";
  if (spamAlert) spamAlert.style.display = "none";

  let suggestedCat = "spam";
  let confidence = Math.floor(Math.random() * 10) + 85; // Default base confidence
  let geminiSuccess = false;

  const imgEl = document.getElementById("captured-img");

  // 1. Try secure Backend Gemini classification (keeps API Key fully hidden in server environment)
  if (imgEl && imgEl.src && imgEl.src.startsWith("data:image")) {
    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imgEl.src })
      });

      if (response.ok) {
        const result = await response.json();
        console.log("Backend Gemini API classification result:", result);

        const rawCat = (result.category || "").toLowerCase().trim();
        if (rawCat.includes("hole") || rawCat.includes("pothole")) {
          suggestedCat = "pothole";
        } else if (rawCat.includes("light") || rawCat.includes("bulb") || rawCat.includes("lamp") || rawCat.includes("streetlight")) {
          suggestedCat = "streetlight";
        } else if (rawCat.includes("garbage") || rawCat.includes("trash") || rawCat.includes("rubbish") || rawCat.includes("waste") || rawCat.includes("graffiti")) {
          suggestedCat = "garbage";
        } else if (rawCat.includes("water") || rawCat.includes("leak") || rawCat.includes("pipe") || rawCat.includes("leakage")) {
          suggestedCat = "water leakage";
        } else {
          suggestedCat = "spam";
        }

        confidence = 98;
        geminiSuccess = true;
        showToast("Gemini Vision 🤖", "Gemini 2.5 Flash (via backend) successfully categorized image.", "success");
      } else {
        console.warn("Backend classification returned status:", response.status);
      }
    } catch (err) {
      console.warn("Backend Gemini classification failed. Falling back to local MobileNet model:", err);
    }
  }

  // 2. Run Local MobileNet Image Recognition if Gemini was not used/failed
  if (!geminiSuccess && mobileNetModel && imgEl && imgEl.src && !imgEl.src.endsWith("/")) {
    try {
      const predictions = await mobileNetModel.classify(imgEl);
      console.log("MobileNet predictions:", predictions);

      // Check predictions for category matches
      for (const pred of predictions) {
        const label = pred.className.toLowerCase();
        const score = Math.round(pred.probability * 100);

        // Immediately categorize face/person/portrait/clothing as spam to prevent false-positives
        if (label.includes("person") || label.includes("man") || label.includes("woman") || label.includes("face") || label.includes("groom") || label.includes("selfie") || label.includes("portrait") || label.includes("eyeglasses") || label.includes("sunglass") || label.includes("lip") || label.includes("cheek") || label.includes("nose") || label.includes("chin") || label.includes("forehead") || label.includes("ear") || label.includes("hair") || label.includes("t-shirt") || label.includes("necktie") || label.includes("clothing") || label.includes("trousers") || label.includes("jacket")) {
          suggestedCat = "spam";
          confidence = score > confidence ? score : confidence;
          break;
        }

        const words = label.split(/[\s,]+/);
        if (label.includes("trash") || label.includes("garbage") || label.includes("dump") || label.includes("rubbish") || label.includes("waste") || label.includes("bottle") || label.includes("wrapper") || label.includes("plastic") || words.includes("bin") || words.includes("can") || label.includes("carton") || label.includes("litter") || label.includes("jug") || label.includes("cup") || label.includes("glass") || label.includes("flask") || label.includes("container")) {
          suggestedCat = "garbage";
          confidence = score > confidence ? score : confidence;
          break;
        }
        if (label.includes("streetlight") || label.includes("lamppost") || label.includes("street lamp") || label.includes("street-lamp")) {
          suggestedCat = "streetlight";
          confidence = score > confidence ? score : confidence;
          break;
        }
        if (words.includes("pothole") || words.includes("crater") || words.includes("pavement") || words.includes("crack") || words.includes("hole") || words.includes("asphalt") || words.includes("road") || words.includes("ditch") || label.includes("pothole") || label.includes("road crack")) {
          suggestedCat = "pothole";
          confidence = score > confidence ? score : confidence;
          break;
        }
        if (label.includes("puddle") || label.includes("leak") || label.includes("spill") ||
          (label.includes("water") && !label.includes("bottle") && !label.includes("jug") && !label.includes("cup") && !label.includes("glass") && !label.includes("flask")) ||
          label.includes("sprinkler") || label.includes("hose") || label.includes("gush") || label.includes("sink") ||
          label.split(/[\s,]+/).includes("tap") || label.split(/[\s,]+/).includes("faucet")) {
          suggestedCat = "water leakage";
          confidence = score > confidence ? score : confidence;
          break;
        }
      }
    } catch (err) {
      console.error("TensorFlow.js classification error:", err);
    }
  }

  // 2. Fallback to Description text box keywords
  if (suggestedCat === "spam") {
    const descText = document.getElementById("issue-desc") ? document.getElementById("issue-desc").value.toLowerCase() : "";
    if (descText.includes("hole") || descText.includes("road") || descText.includes("crack") || descText.includes("pothole")) {
      suggestedCat = "pothole";
    } else if (descText.includes("light") || descText.includes("bulb") || descText.includes("lamp") || descText.includes("streetlight")) {
      suggestedCat = "streetlight";
    } else if (descText.includes("trash") || descText.includes("garbage") || descText.includes("dump") || descText.includes("rubbish") || descText.includes("waste") || descText.includes("bin")) {
      suggestedCat = "garbage";
    } else if (descText.includes("water") || descText.includes("leak") || descText.includes("pipe") || descText.includes("wet") || descText.includes("leakage")) {
      suggestedCat = "water leakage";
    }
  }

  // 3. Fallback to filename keywords
  if (suggestedCat === "spam") {
    const nameLower = fileName.toLowerCase();
    if (nameLower.includes("hole") || nameLower.includes("road") || nameLower.includes("crack")) suggestedCat = "pothole";
    else if (nameLower.includes("light") || nameLower.includes("bulb") || nameLower.includes("lamp")) suggestedCat = "streetlight";
    else if (nameLower.includes("trash") || nameLower.includes("garbage") || nameLower.includes("dump") || nameLower.includes("rubbish")) suggestedCat = "garbage";
    else if (nameLower.includes("water") || nameLower.includes("leak") || nameLower.includes("pipe") || nameLower.includes("wet")) suggestedCat = "water leakage";
    else if (nameLower.includes("selfie") || nameLower.includes("dog") || nameLower.includes("spam")) suggestedCat = "spam";
  }

  // 4. Fallback to image URL keywords
  if (suggestedCat === "spam") {
    const imgUrl = capturedDataUrl ? capturedDataUrl.toLowerCase() : "";
    if (imgUrl.includes("hole") || imgUrl.includes("road") || imgUrl.includes("crack") || imgUrl.includes("pothole")) suggestedCat = "pothole";
    else if (imgUrl.includes("light") || imgUrl.includes("bulb") || imgUrl.includes("lamp") || imgUrl.includes("streetlight")) suggestedCat = "streetlight";
    else if (imgUrl.includes("trash") || imgUrl.includes("garbage") || imgUrl.includes("dump") || imgUrl.includes("rubbish") || imgUrl.includes("waste")) suggestedCat = "garbage";
    else if (imgUrl.includes("water") || imgUrl.includes("leak") || imgUrl.includes("pipe") || imgUrl.includes("wet") || imgUrl.includes("leakage")) suggestedCat = "water leakage";
  }

  // 5. Default for real user photos (camera/base64 uploads)
  if (suggestedCat === "spam") {
    const nameLower = fileName.toLowerCase();
    const imgUrl = capturedDataUrl ? capturedDataUrl.toLowerCase() : "";
    if (nameLower.includes("captured") || imgUrl.startsWith("data:image")) {
      suggestedCat = "garbage"; // default to garbage (most common report) rather than spam
    }
  }

  // Final UI display updates
  const confidencePercent = Math.max(82, Math.min(99, confidence));
  let priority = "Medium";
  if (suggestedCat === "water leakage" || suggestedCat === "pothole") priority = "High";
  if (suggestedCat === "spam") priority = "Low";

  catTag.innerText = suggestedCat === "spam" ? "SPAM / UNRELATED" : suggestedCat.toUpperCase();
  confTag.innerText = `${confidencePercent}%`;
  priTag.innerText = priority;

  if (priority === "High") {
    priTag.style.color = "var(--color-danger)";
  } else if (priority === "Low") {
    priTag.style.color = "var(--text-muted)";
  } else {
    priTag.style.color = "var(--color-warning)";
  }

  // SLA tag update
  const slaMap = { "water leakage": "6 hrs", "garbage": "12 hrs", "pothole": "48 hrs", "streetlight": "24 hrs", "spam": "N/A" };
  const slaTag = document.getElementById("ai-sla-tag");
  if (slaTag) slaTag.innerText = slaMap[suggestedCat] || "24 hrs";

  // Risk dot update
  const riskDot = document.getElementById("ai-risk-dot");
  const riskLabel = document.getElementById("ai-risk-label");
  if (riskDot && riskLabel) {
    if (priority === "High") {
      riskDot.style.background = "var(--color-danger)";
      riskLabel.innerText = "High — Immediate attention";
    } else if (priority === "Low") {
      riskDot.style.background = "var(--text-muted)";
      riskLabel.innerText = "Low — Spam/Unrelated";
    } else {
      riskDot.style.background = "var(--color-warning)";
      riskLabel.innerText = "Medium — Standard queue";
    }
  }

  // Animate confidence bar
  const bar = document.getElementById("ai-confidence-bar");
  if (bar) {
    bar.style.width = "0%";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { bar.style.width = `${confidencePercent}%`; });
    });
  }
  // Warn duplicate or spam
  if (suggestedCat === "spam") {
    if (spamAlert) spamAlert.style.display = "block";
  } else {
    const nearbyDuplicate = issues.some(issue =>
      issue.category === suggestedCat &&
      issue.status !== "Closed" &&
      getDistance(draftCoords.lat, draftCoords.lng, issue.lat, issue.lng) < 60
    );
    if (nearbyDuplicate) duplicateAlert.style.display = "block";
  }

  // Restore submit button state
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Submit Issue`;
  }
}

// Form submit reporting handling
function handleFormSubmit(event) {
  event.preventDefault();

  // Require at least one captured media (photo or video)
  if (!capturedDataUrl && !capturedVideoBlob) {
    showToast('No Evidence', 'Please capture a photo or record a video before submitting.', 'warning');
    return;
  }

  const desc = document.getElementById("issue-desc").value;
  const aiCat = document.getElementById("ai-category-tag").innerText.toLowerCase();

  // Normalize category name
  let category = "other";
  if (aiCat.includes("spam") || aiCat.includes("unrelated")) {
    category = "spam";
  } else if (aiCat !== "scanning pixels..." && aiCat !== "analysing..." && !aiCat.includes("analyz") && !aiCat.includes("analys")) {
    category = aiCat;
  }

  const severity = document.getElementById("ai-priority-tag").innerText;

  // Use captured photo data URL, or a blob URL for video, or fallback image
  let photoUrl;
  if (capturedDataUrl) {
    photoUrl = capturedDataUrl;
  } else if (capturedVideoBlob) {
    photoUrl = URL.createObjectURL(capturedVideoBlob); // video blob URL for display
  } else {
    photoUrl = CATEGORY_DEFAULT_IMAGES[category] || CATEGORY_DEFAULT_IMAGES.other;
  }

  // SLA math: default 24h
  let slaHours = 24;
  if (category === "water leakage") slaHours = 6;
  if (category === "garbage") slaHours = 12;
  if (category === "pothole") slaHours = 48;
  if (category === "spam") slaHours = 0;

  const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

  // Spam reports are auto-closed immediately
  const initialStatus = category === "spam" ? "Closed" : "Reported";

  const isAnonymous = document.getElementById("report-anonymous-toggle") ? document.getElementById("report-anonymous-toggle").checked : false;

  const newIssue = {
    id: `issue-${Date.now()}`,
    category,
    description: desc,
    photoUrl,
    resolvedPhotoUrl: null,
    lat: draftCoords.lat,
    lng: draftCoords.lng,
    status: initialStatus,
    severity: severity === "--" ? "Medium" : severity,
    createdBy: isAnonymous ? "Anonymous Citizen" : (currentUser?.name || "Anonymous Citizen"),
    isAnonymous: isAnonymous,
    createdAt: new Date().toISOString(),
    assignedTo: null,
    wardId: typeof detectWardFromCoords === 'function'
      ? detectWardFromCoords(draftCoords.lat, draftCoords.lng)
      : (window.__detectedWard || 'ward-1'),
    votes: [],
    statusHistory: [
      {
        status: initialStatus,
        changedBy: isAnonymous ? "Anonymous Citizen" : (currentUser?.name || "Anonymous Citizen"),
        timestamp: new Date().toISOString(),
        notes: category === "spam"
          ? "Report auto-closed and flagged as spam by CivicAI."
          : "Issue reported with custom location and visual evidence."
      }
    ],
    slaDeadline
  };

  issues.unshift(newIssue);

  // Gamification credit or penalty
  if (category === "spam") {
    // Deduct 30 XP, clamp to 0
    currentUser.points = Math.max(0, (currentUser.points || 0) - 30);
    // Lower trust score by 15%, clamp to 0
    currentUser.trustScore = Math.max(0, (currentUser.trustScore || 0) - 15);
    alert("⚠️ Spam report detected! 30 XP was deducted and your trust score decreased by 15%.");
    pushNotification("Spam Detected", "Your report was flagged as spam. 30 XP deducted.", "danger");
  } else {
    currentUser.points += 20; // +20 points for filing valid report
    checkMilestones();
    pushNotification("Report Submitted!", `Your ${category} report is now live and visible to the community.`, "success");
  }

  saveState();
  closeReportModal();
  updateUserHUD();
  applyFilters();

  // Auto-center main map on the newly reported issue
  if (mainMap && newIssue.status !== "Closed") {
    setTimeout(() => {
      mainMap.invalidateSize();
      mainMap.setView([newIssue.lat, newIssue.lng], 13);
    }, 100);
  }
}

// Dashboard metric indicators calculation
function updateDashboardMetrics() {
  const openCount = issues.filter(i => i.status !== "Resolved" && i.status !== "Closed").length;
  const inProgress = issues.filter(i => i.status === "In Progress").length;
  const resolved = issues.filter(i => i.status === "Resolved").length;

  const overdueCount = issues.filter(i =>
    i.status !== "Resolved" && i.status !== "Closed" &&
    new Date() > new Date(i.slaDeadline)
  ).length;

  document.getElementById("stat-reported").innerText = openCount;
  document.getElementById("stat-progress").innerText = inProgress;
  document.getElementById("stat-resolved").innerText = resolved;
  document.getElementById("stat-overdue").innerText = overdueCount;

  // Update predictive insights panel
  renderPredictiveInsights();
}

// Render Leaderboard & Achievements
function renderLeaderboard() {
  const tbody = document.getElementById("leaderboard-body");
  tbody.innerHTML = "";

  // Sort citizen users by points
  const sortedUsers = users
    .filter(u => u.role === "citizen")
    .sort((a, b) => (b.points || 0) - (a.points || 0));

  sortedUsers.forEach((user, idx) => {
    const tr = document.createElement("tr");

    // Badges visual list
    const badgesHtml = user.badges ? user.badges.map(b => `<span class="card-badge" style="background:rgba(99,102,241,0.1); color:#818cf8; margin-right:4px;">${b}</span>`).join("") : "";

    tr.innerHTML = `
      <td>
        <div class="rank-badge rank-${idx + 1}">${idx + 1}</div>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="avatar-circle" style="width:30px; height:30px; font-size:12px;">${user.name.split(" ").map(n => n[0]).join("")}</div>
          <span style="font-weight:600;">${user.name}</span>
        </div>
      </td>
      <td>${user.trustScore ? `${user.trustScore}%` : '--'}</td>
      <td style="font-weight:700; color:var(--color-primary);">${user.points} XP</td>
      <td>${badgesHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Render current user's progress cabinet
  document.getElementById("profile-xp-text").innerText = `${currentUser.points} / 300 XP`;
  const barPercent = Math.min((currentUser.points / 300) * 100, 100);
  document.getElementById("profile-xp-bar").style.width = `${barPercent}%`;

  const badgeBox = document.getElementById("profile-badges-container");
  badgeBox.innerHTML = "";

  const allAvailableBadges = [
    { title: "First Responder", desc: "Report 1 local issue" },
    { title: "Local Watchdog", desc: "Verify 3 nearby issues" },
    { title: "Community Champion", desc: "Reach 200 points" },
    { title: "Daily Guardian", desc: "5-day reporting streak" }
  ];

  allAvailableBadges.forEach(badge => {
    const isEarned = currentUser.badges && currentUser.badges.includes(badge.title);
    const badgeCard = document.createElement("div");
    badgeCard.className = `badge-card ${isEarned ? '' : 'unearned'}`;
    badgeCard.innerHTML = `
      <i class="fa-solid fa-award badge-icon" style="${isEarned ? '' : 'filter:none; background:none; color:var(--text-muted); -webkit-text-fill-color:initial;'}"></i>
      <div class="badge-title">${badge.title}</div>
      <div class="badge-desc">${badge.desc}</div>
    `;
    badgeBox.appendChild(badgeCard);
  });
}

// Initialise Dashboard Analytics (Chart.js)
function initCharts() {
  const categoryCtx = document.getElementById("categoryChart").getContext("2d");
  const slaCtx = document.getElementById("slaChart").getContext("2d");

  // Chart styling constants
  Chart.defaults.color = '#4a3835';
  Chart.defaults.font.family = "'Outfit', sans-serif";

  // Category Breakdown Chart (Doughnut)
  categoryChartInstance = new Chart(categoryCtx, {
    type: 'doughnut',
    data: {
      labels: ['Potholes', 'Streetlights', 'Garbage', 'Water Leaks', 'Spam/Unrelated'],
      datasets: [{
        data: [0, 0, 0, 0, 0],
        backgroundColor: [
          '#c62828', // Red
          '#c67119', // Amber/Orange
          '#966b9d', // Plum
          '#c98686', // Dusty Rose
          '#826e6a'  // Gray
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            padding: 15,
            boxWidth: 12
          }
        }
      }
    }
  });

  // SLA Performance Bar Chart
  slaChartInstance = new Chart(slaCtx, {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [
        {
          label: 'Complied',
          data: [0, 0, 0, 0, 0, 0, 0],
          backgroundColor: '#2e7d32',
          borderRadius: 4
        },
        {
          label: 'Breached',
          data: [0, 0, 0, 0, 0, 0, 0],
          backgroundColor: '#c62828',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: 'rgba(74,56,53,0.08)' } }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12 }
        }
      }
    }
  });
}

// Update charts with live state data
function updateCharts() {
  if (!categoryChartInstance) return;

  const potholeCount = issues.filter(i => i.category === 'pothole').length;
  const lightCount = issues.filter(i => i.category === ' streetlight' || i.category === 'streetlight').length;
  const garbageCount = issues.filter(i => i.category === 'garbage').length;
  const waterCount = issues.filter(i => i.category === 'water leakage').length;
  const spamCount = issues.filter(i => i.category === 'spam').length;

  categoryChartInstance.data.datasets[0].data = [potholeCount, lightCount, garbageCount, waterCount, spamCount];
  categoryChartInstance.update();
}

// ══════════════════════════════════════
//  NOTIFICATION SYSTEM
// ══════════════════════════════════════
let notifications = [];
let notifUnread = 0;

function pushNotification(title, message, type = "info") {
  const ts = new Date();
  const item = { title, message, type, ts };
  notifications.unshift(item);
  notifUnread++;

  // Update badge
  const badge = document.getElementById("notif-badge");
  if (badge) {
    badge.style.display = "flex";
    badge.innerText = notifUnread > 9 ? "9+" : notifUnread;
  }

  // Re-render list if dropdown is open
  const dropdown = document.getElementById("notif-dropdown");
  if (dropdown && dropdown.style.display !== "none") renderNotifList();

  // Show toast
  showToast(title, message, type);
}

function renderNotifList() {
  const list = document.getElementById("notif-list");
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty"><i class="fa-regular fa-bell-slash"></i><br>No notifications yet</div>`;
    return;
  }

  const iconMap = {
    success: "fa-circle-check",
    info: "fa-bell",
    warning: "fa-triangle-exclamation",
    danger: "fa-circle-exclamation"
  };

  list.innerHTML = notifications.slice(0, 20).map(n => `
    <div class="notif-item">
      <div class="notif-item-icon ${n.type}"><i class="fa-solid ${iconMap[n.type] || 'fa-bell'}"></i></div>
      <div class="notif-item-body">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-msg">${n.message}</div>
        <div class="notif-item-time">${n.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>
  `).join("");
}

function toggleNotifDropdown() {
  const dropdown = document.getElementById("notif-dropdown");
  if (!dropdown) return;
  const isOpen = dropdown.style.display !== "none";
  dropdown.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    renderNotifList();
    // Mark as read
    notifUnread = 0;
    const badge = document.getElementById("notif-badge");
    if (badge) badge.style.display = "none";
  }
}

function clearNotifications() {
  notifications = [];
  notifUnread = 0;
  const badge = document.getElementById("notif-badge");
  if (badge) badge.style.display = "none";
  renderNotifList();
}

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("notif-bell-wrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    const dropdown = document.getElementById("notif-dropdown");
    if (dropdown) dropdown.style.display = "none";
  }
});

function showToast(title, message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const iconMap = {
    success: "fa-circle-check",
    info: "fa-bell",
    warning: "fa-triangle-exclamation",
    danger: "fa-circle-exclamation"
  };

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-icon ${type}"><i class="fa-solid ${iconMap[type] || 'fa-bell'}"></i></div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;
  container.appendChild(toast);

  // Auto-remove after 4s
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ══════════════════════════════════════
//  PREDICTIVE INSIGHTS
// ══════════════════════════════════════
function renderPredictiveInsights() {
  const panel = document.getElementById("predictive-insights-panel");
  if (!panel) return;

  const activeIssues = issues.filter(i => i.status !== "Closed");

  // 1. Hotspot zone — ward with most active issues
  const wardCounts = {};
  activeIssues.forEach(i => {
    wardCounts[i.wardId] = (wardCounts[i.wardId] || 0) + 1;
  });
  const hotWardId = Object.entries(wardCounts).sort((a, b) => b[1] - a[1])[0];
  if (hotWardId) {
    document.getElementById("insight-hotspot-val").innerText = getWardName(hotWardId[0]);
    document.getElementById("insight-hotspot-sub").innerText = `${hotWardId[1]} active report${hotWardId[1] > 1 ? 's' : ''}`;
  } else {
    document.getElementById("insight-hotspot-val").innerText = "None";
    document.getElementById("insight-hotspot-sub").innerText = "No active issues";
  }

  // 2. Top recurring category
  const catCounts = {};
  activeIssues.forEach(i => {
    if (i.category !== "spam") catCounts[i.category] = (catCounts[i.category] || 0) + 1;
  });
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  if (topCat) {
    const pct = Math.round((topCat[1] / activeIssues.filter(i => i.category !== 'spam').length) * 100);
    document.getElementById("insight-category-val").innerText =
      topCat[0].charAt(0).toUpperCase() + topCat[0].slice(1);
    document.getElementById("insight-category-sub").innerText =
      `${pct}% of all active reports`;
  } else {
    document.getElementById("insight-category-val").innerText = "None";
    document.getElementById("insight-category-sub").innerText = "No data yet";
  }

  // 3. Average resolution time from resolved issues
  const resolved = issues.filter(i => i.status === "Resolved" && i.statusHistory && i.statusHistory.length >= 2);
  if (resolved.length > 0) {
    const avgMs = resolved.reduce((sum, issue) => {
      const start = new Date(issue.statusHistory[0].timestamp).getTime();
      const end = new Date(issue.statusHistory[issue.statusHistory.length - 1].timestamp).getTime();
      return sum + (end - start);
    }, 0) / resolved.length;
    const avgHours = Math.round(avgMs / 3600000);
    document.getElementById("insight-avgtime-val").innerText =
      avgHours < 24 ? `${avgHours} hrs` : `${Math.round(avgHours / 24)} days`;
    document.getElementById("insight-avgtime-sub").innerText =
      `Based on ${resolved.length} resolved issue${resolved.length > 1 ? 's' : ''}`;
  } else {
    document.getElementById("insight-avgtime-val").innerText = "N/A";
    document.getElementById("insight-avgtime-sub").innerText = "No resolved issues yet";
  }

  // 4. At-risk prediction — ward where SLA will breach soonest
  const soonToBreachIssues = activeIssues
    .filter(i => i.slaDeadline && i.status !== "Resolved" && i.status !== "Closed")
    .map(i => ({ ...i, msLeft: new Date(i.slaDeadline).getTime() - Date.now() }))
    .filter(i => i.msLeft > 0)
    .sort((a, b) => a.msLeft - b.msLeft);

  const overdueNow = activeIssues.filter(i =>
    i.slaDeadline && new Date() > new Date(i.slaDeadline)
  );

  if (overdueNow.length > 0) {
    document.getElementById("insight-atrisk-val").innerText = `${overdueNow.length} SLA Breached`;
    document.getElementById("insight-atrisk-sub").innerText = "Immediate escalation needed";
    document.getElementById("insight-atrisk").querySelector(".insight-icon").style.color = "var(--color-danger)";
  } else if (soonToBreachIssues.length > 0) {
    const next = soonToBreachIssues[0];
    const hrsLeft = Math.round(next.msLeft / 3600000);
    document.getElementById("insight-atrisk-val").innerText = getWardName(next.wardId);
    document.getElementById("insight-atrisk-sub").innerText =
      `SLA breach in ~${hrsLeft < 1 ? '<1' : hrsLeft} hr${hrsLeft !== 1 ? 's' : ''}`;
  } else {
    document.getElementById("insight-atrisk-val").innerText = "All Clear";
    document.getElementById("insight-atrisk-sub").innerText = "No SLA risks detected";
    document.getElementById("insight-atrisk").querySelector(".insight-icon").style.color = "var(--color-success)";
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGENTIC SLA ESCALATION ENGINE
//  This runs every 30 seconds. When a breach is detected, CivicAI autonomously:
//  1. Detects the overdue issue
//  2. Calls Gemini to generate a professional escalation memo
//  3. Pushes the AI memo as an admin notification (no human trigger)
//  4. Updates issue state + audit history
// ══════════════════════════════════════════════════════════════════════════════
const _escalatedIssues = new Set(); // Track issues already escalated this session

async function checkAndEscalateSLAs() {
  if (!issues || issues.length === 0) return;

  let stateChanged = false;
  const now = new Date();
  const newlyBreached = [];

  issues.forEach(issue => {
    if (issue.status !== "Resolved" && issue.status !== "Closed" && issue.slaDeadline) {
      const deadline = new Date(issue.slaDeadline);
      if (now > deadline) {
        if (!issue.escalated && issue.severity !== "High") {
          issue.escalated = true;
          issue.severity = "High";

          issue.statusHistory.push({
            status: issue.status,
            changedBy: "CivicAI Escalation Engine",
            timestamp: now.toISOString(),
            notes: "⚠️ SLA Deadline Breached. Ticket auto-escalated to High Priority by CivicAI."
          });

          stateChanged = true;
          newlyBreached.push(issue);
        }
      }
    }
  });

  if (stateChanged) {
    saveState();
    if (currentView === "authority") {
      updateDashboardMetrics();
      updateCharts();
      renderQueueList();
    } else if (currentView === "citizen") {
      renderFeedList();
    }
  }

  // ── Agentic Gemini Memo Generation (fires async, non-blocking) ──────────────
  for (const issue of newlyBreached) {
    if (_escalatedIssues.has(issue.id)) continue;
    _escalatedIssues.add(issue.id);

    // Push an immediate notification while AI memo loads
    pushNotification(
      "⏰ SLA Breach Detected",
      `CivicAI is generating escalation memo for: ${issue.category} in ${getWardName(issue.wardId)}...`,
      "warning"
    );

    // Call Gemini asynchronously — the agentic action
    try {
      const overdueMs = now.getTime() - new Date(issue.slaDeadline).getTime();
      const overdueHours = Math.max(1, Math.round(overdueMs / 3600000));

      const response = await fetch("/api/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue, overdueHours })
      });

      if (response.ok) {
        const result = await response.json();
        const memo = result.memo || "";

        // Push the AI-generated memo as a rich admin notification
        pushNotification(
          `🤖 CivicAI Escalation — ${issue.category.toUpperCase()}`,
          memo,
          "danger"
        );

        // Log the AI memo into the issue's audit history
        const issueRef = issues.find(i => i.id === issue.id);
        if (issueRef) {
          issueRef.statusHistory.push({
            status: issueRef.status,
            changedBy: "CivicAI (Gemini)",
            timestamp: new Date().toISOString(),
            notes: `📋 AI Escalation Memo: ${memo}`
          });
          saveState();
        }

        console.log(`[CivicAI] ✅ Escalation memo injected for Ticket #${issue.id}`);
      }
    } catch (err) {
      console.warn(`[CivicAI] Escalation memo failed for Ticket #${issue.id}:`, err);
      // Non-fatal — the basic escalation already happened above
    }
  }
}


// ══════════════════════════════════════
//  SHARE ACTIVE ISSUE
// ══════════════════════════════════════
function shareActiveIssue() {
  if (!selectedIssueId) return;
  const shareUrl = window.location.origin + window.location.pathname + "?issue=" + selectedIssueId + "&public=1";

  navigator.clipboard.writeText(shareUrl).then(() => {
    showToast("Link Copied! 🔗", "Direct link to this report copied to clipboard.", "success");
  }).catch(() => {
    // Fallback if Clipboard API fails/is blocked
    const input = document.createElement("input");
    input.value = shareUrl;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand("copy");
      showToast("Link Copied! 🔗", "Direct link to this report copied to clipboard.", "success");
    } catch (err) {
      showToast("Failed to Copy", "Could not automatically copy. URL: " + shareUrl, "warning");
    }
    document.body.removeChild(input);
  });
}

// ══════════════════════════════════════
//  CSV / PDF DATA EXPORTS
// ══════════════════════════════════════
function exportIssuesCSV() {
  if (!issues || issues.length === 0) {
    showToast("No Data", "There are no issues to export.", "warning");
    return;
  }

  const headers = ["Ticket ID", "Category", "Description", "Status", "Priority", "Reporter", "Created At", "Ward", "SLA Deadline", "Confirms", "Escalated"];
  const rows = issues.map(i => [
    i.id,
    i.category,
    i.description.replace(/"/g, '""').replace(/\n/g, ' '),
    i.status,
    i.severity,
    i.createdBy,
    new Date(i.createdAt).toLocaleString(),
    getWardName(i.wardId),
    new Date(i.slaDeadline).toLocaleString(),
    i.votes ? i.votes.filter(v => v.voteType === "confirm").length : 0,
    i.escalated ? "YES" : "NO"
  ]);

  const csvContent = [headers.join(","), ...rows.map(r => r.map(val => `"${val}"`).join(","))].join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `civichero_issues_report_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast("CSV Exported! 📊", "Issues CSV has been downloaded successfully.", "success");
}

function exportIssuesPDF() {
  if (!issues || issues.length === 0) {
    showToast("No Data", "There are no issues to export.", "warning");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Popup Blocked", "Please allow popups to download PDF reports.", "warning");
    return;
  }

  const total = issues.length;
  const resolved = issues.filter(i => i.status === "Resolved").length;
  const inProgress = issues.filter(i => i.status === "In Progress").length;
  const reported = issues.filter(i => i.status === "Reported").length;
  const verified = issues.filter(i => i.status === "Verified").length;

  let rowsHtml = issues.map((i, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${i.id}</strong></td>
      <td style="text-transform: capitalize;">${i.category}</td>
      <td>${i.description}</td>
      <td>${getWardName(i.wardId)}</td>
      <td><span class="badge ${i.severity.toLowerCase()}">${i.severity}</span></td>
      <td><span class="badge status-${i.status.toLowerCase().replace(" ", "-")}">${i.status}</span></td>
      <td>${new Date(i.createdAt).toLocaleDateString()}</td>
    </tr>
  `).join("");

  printWindow.document.write(`
    <html>
    <head>
      <title>CivicHero - City Issues Report</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #2c2523; padding: 40px; background: #fff; line-height: 1.5; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #966b9d; padding-bottom: 20px; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: 800; color: #966b9d; }
        .title { font-size: 28px; font-weight: 800; margin: 0; color: #4a3835; }
        .meta-info { font-size: 13px; color: #6e5e5c; text-align: right; }
        .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 30px; }
        .stat-box { border: 1px solid #e7cfbc; padding: 12px; border-radius: 8px; text-align: center; background: #fffcfb; }
        .stat-box h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #6e5e5c; letter-spacing: 0.5px; }
        .stat-box p { margin: 0; font-size: 20px; font-weight: 800; color: #4a3835; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
        th, td { border: 1px solid #e7cfbc; padding: 10px 12px; text-align: left; }
        th { background-color: rgba(150, 107, 157, 0.08); color: #4a3835; font-weight: 700; }
        tr:nth-child(even) { background-color: #fffcfb; }
        .badge { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; display: inline-block; }
        .badge.high { background: #fee2e2; color: #ef4444; }
        .badge.medium { background: #fef3c7; color: #f59e0b; }
        .badge.low { background: #f3f4f6; color: #6b7280; }
        .badge.status-reported { background: #dbeafe; color: #2563eb; }
        .badge.status-verified { background: #e0e7ff; color: #4f46e5; }
        .badge.status-assigned { background: #fae8ff; color: #d946ef; }
        .badge.status-in-progress { background: #fef3c7; color: #d97706; }
        .badge.status-resolved { background: #dcfce7; color: #16a34a; }
        .badge.status-closed { background: #f3f4f6; color: #4b5563; }
        @media print {
          body { padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <div style="display: flex; justify-content: flex-end; margin-bottom: 20px;">
        <button onclick="window.print()" style="background: #966b9d; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: inherit;">Print / Save as PDF</button>
      </div>
      <div class="header">
        <div>
          <h1 class="title">City Operations Report</h1>
          <div class="logo">CivicHero Platform</div>
        </div>
        <div class="meta-info">
          <p>Generated: ${new Date().toLocaleString()}</p>
          <p>Scope: All Wards</p>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-box">
          <h4>Total Reports</h4>
          <p>${total}</p>
        </div>
        <div class="stat-box" style="border-left: 3px solid #3b82f6;">
          <h4>Reported</h4>
          <p>${reported}</p>
        </div>
        <div class="stat-box" style="border-left: 3px solid #8b5cf6;">
          <h4>Verified</h4>
          <p>${verified}</p>
        </div>
        <div class="stat-box" style="border-left: 3px solid #f59e0b;">
          <h4>In Progress</h4>
          <p>${inProgress}</p>
        </div>
        <div class="stat-box" style="border-left: 3px solid #10b981;">
          <h4>Resolved</h4>
          <p>${resolved}</p>
        </div>
      </div>

      <h3>Active Civic Issues Registry</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 4%;">#</th>
            <th style="width: 12%;">Ticket ID</th>
            <th style="width: 12%;">Category</th>
            <th style="width: 32%;">Description</th>
            <th style="width: 12%;">Ward</th>
            <th style="width: 10%;">Priority</th>
            <th style="width: 10%;">Status</th>
            <th style="width: 8%;">Date</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
  `);
  printWindow.document.close();
}

// ══════════════════════════════════════
//  VOICE DICTATION SYSTEM
// ══════════════════════════════════════
let recognitionInstance = null;
let isVoiceRecording = false;

function startVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Unsupported 🎙️", "Speech recognition is not supported in this browser. Try Chrome.", "warning");
    return;
  }

  const btn = document.getElementById("btn-voice-input");
  const icon = document.getElementById("voice-mic-icon");
  const text = document.getElementById("voice-status-text");
  const textarea = document.getElementById("issue-desc");

  if (isVoiceRecording) {
    // Stop recording
    if (recognitionInstance) recognitionInstance.stop();
    return;
  }

  try {
    recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = false;
    recognitionInstance.lang = "en-IN"; // Set language (English India/Standard)

    recognitionInstance.onstart = () => {
      isVoiceRecording = true;
      btn.classList.add("listening");
      text.innerText = "Listening...";
      showToast("Mic Active 🎙️", "Start speaking to dictate your description.", "info");
    };

    recognitionInstance.onresult = (event) => {
      const resultText = event.results[0][0].transcript;
      if (textarea) {
        const currentVal = textarea.value.trim();
        textarea.value = currentVal ? `${currentVal} ${resultText}` : resultText;
      }
      showToast("Speech Recorded! 📝", "Transcribed content added to description.", "success");
    };

    recognitionInstance.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        showToast("Mic Blocked 🔒", "Microphone access blocked. Simulating speech dictation fallback...", "warning");
        setTimeout(() => {
          const simText = prompt("Microphone Blocked 🔒\n\nYou can simulate voice input by typing test speech below:", "A large pothole right in the middle of the Greenwood road lane.");
          if (simText && textarea) {
            const currentVal = textarea.value.trim();
            textarea.value = currentVal ? `${currentVal} ${simText}` : simText;
            showToast("Speech Simulated! 📝", "Simulated text added to description.", "success");
          }
        }, 500);
      } else {
        showToast("Speech Error 🎙️", "Could not capture voice: " + event.error, "warning");
      }
    };

    recognitionInstance.onend = () => {
      isVoiceRecording = false;
      btn.classList.remove("listening");
      text.innerText = "Voice Input";
    };

    recognitionInstance.start();
  } catch (err) {
    console.error("Failed to start SpeechRecognition:", err);
  }
}

// ══════════════════════════════════════
//  TENSORFLOW.JS MOBILENET CLASSIFIER
// ══════════════════════════════════════
let mobileNetModel = null;

async function loadMobileNet() {
  if (typeof mobilenet === "undefined") {
    console.warn("MobileNet library not loaded from CDN.");
    return;
  }
  try {
    console.log("Loading TensorFlow.js MobileNet model...");
    mobileNetModel = await mobilenet.load();
    console.log("MobileNet Model Loaded successfully!");
  } catch (err) {
    console.error("Error loading MobileNet model:", err);
  }
}

// Automatically trigger load on script execution
loadMobileNet();
