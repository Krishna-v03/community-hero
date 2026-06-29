// ═══════════════════════════════════════════════════════════════════════════
//  enhancements.js — Community Hero Tier 1–5 upgrades
//  Loaded after app.js; extends core platform without breaking existing flow.
// ═══════════════════════════════════════════════════════════════════════════

const VERIFY_RADIUS_M = 500;
const VERIFY_THRESHOLD = 2;
let publicWardChartInstance = null;
let aiTrendsCache = null;
let userStreak = parseInt(localStorage.getItem('civic_streak') || '0', 10);
let lastActiveDate = localStorage.getItem('civic_streak_date') || '';

// ── Ward auto-detection from GPS / map pin ───────────────────────────────────
function detectWardFromCoords(lat, lng) {
  let best = INITIAL_WARDS[0];
  let bestDist = Infinity;
  INITIAL_WARDS.forEach(ward => {
    const d = getDistance(lat, lng, ward.lat, ward.lng);
    if (d < bestDist) { bestDist = d; best = ward; }
  });
  return best.id;
}

function getWardLabel(wardId) {
  return getWardName(wardId);
}

// ── Sync issues to server for public share API ───────────────────────────────
async function syncIssuesToServer() {
  try {
    await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues })
    });
  } catch (e) {
    console.warn('[Sync] Server sync skipped:', e.message);
  }
}

// Wrap saveState to sync + streak
const _origSaveState = typeof saveState === 'function' ? saveState : () => {};
saveState = function enhancedSaveState() {
  _origSaveState();
  syncIssuesToServer();
};

// ── Live SLA weekly chart data ───────────────────────────────────────────────
function computeSLAWeeklyData() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const complied = [0, 0, 0, 0, 0, 0, 0];
  const breached = [0, 0, 0, 0, 0, 0, 0];
  const now = new Date();

  issues.forEach(issue => {
    if (!issue.slaDeadline || !issue.createdAt) return;
    const created = new Date(issue.createdAt);
    const deadline = new Date(issue.slaDeadline);
    const resolved = issue.statusHistory?.find(h => h.status === 'Resolved');
    const resolvedAt = resolved ? new Date(resolved.timestamp) : null;
    const dayIdx = created.getDay();

    if (issue.status === 'Resolved' && resolvedAt) {
      if (resolvedAt <= deadline) complied[dayIdx]++;
      else breached[dayIdx]++;
    } else if (issue.status !== 'Closed' && now > deadline) {
      breached[dayIdx]++;
    } else if (issue.status !== 'Closed' && issue.status !== 'Resolved') {
      complied[dayIdx]++;
    }
  });

  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(days[d.getDay()]);
  }
  const rotate = (arr) => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push(arr[d.getDay()]);
    }
    return out;
  };

  return { labels, complied: rotate(complied), breached: rotate(breached) };
}

const _origUpdateCharts = typeof updateCharts === 'function' ? updateCharts : () => {};
updateCharts = function enhancedUpdateCharts() {
  _origUpdateCharts();
  if (slaChartInstance) {
    const sla = computeSLAWeeklyData();
    slaChartInstance.data.labels = sla.labels;
    slaChartInstance.data.datasets[0].data = sla.complied;
    slaChartInstance.data.datasets[1].data = sla.breached;
    slaChartInstance.update();
  }
};

// ── Streak tracking ──────────────────────────────────────────────────────────
function updateStreak() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastActiveDate === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  userStreak = lastActiveDate === yStr ? userStreak + 1 : 1;
  lastActiveDate = today;
  localStorage.setItem('civic_streak', String(userStreak));
  localStorage.setItem('civic_streak_date', today);
}

// ── Enhanced milestone / badge checks ────────────────────────────────────────
const _origCheckMilestones = typeof checkMilestones === 'function' ? checkMilestones : () => {};
checkMilestones = function enhancedCheckMilestones() {
  _origCheckMilestones();
  if (!currentUser || currentUser.role !== 'citizen') return;

  const verifyCount = issues.reduce((sum, issue) => {
    const v = issue.votes?.find(vt => vt.userId === currentUser.id && vt.voteType === 'confirm');
    return sum + (v ? 1 : 0);
  }, 0);

  if (verifyCount >= 3 && !currentUser.badges.includes('Local Watchdog')) {
    currentUser.badges.push('Local Watchdog');
    pushNotification('Badge Unlocked! 🏅', 'Local Watchdog — you verified 3 community issues.', 'success');
  }
  if (userStreak >= 5 && !currentUser.badges.includes('Daily Guardian')) {
    currentUser.badges.push('Daily Guardian');
    pushNotification('Badge Unlocked! 🔥', 'Daily Guardian — 5-day civic streak!', 'success');
  }
};

// ── Proximity-weighted verification ──────────────────────────────────────────
function canUserVerifyIssue(issue) {
  if (!currentUser || currentUser.role !== 'citizen') return { ok: false, reason: 'Only citizens can verify.' };
  if (issue.createdBy === currentUser.name) return { ok: false, reason: 'You cannot verify your own report.' };
  const dist = getDistance(userActualCoords.lat, userActualCoords.lng, issue.lat, issue.lng);
  if (dist > VERIFY_RADIUS_M) {
    return { ok: false, reason: `Must be within ${VERIFY_RADIUS_M}m (you are ~${Math.round(dist)}m away).` };
  }
  return { ok: true, dist };
}

function getWeightedConfirmCount(issue) {
  if (!issue.votes) return 0;
  return issue.votes
    .filter(v => v.voteType === 'confirm')
    .reduce((sum, v) => {
      const voter = users.find(u => u.id === v.userId);
      const weight = voter?.trustScore ? voter.trustScore / 100 : 1;
      return sum + weight;
    }, 0);
}

const _origSubmitVote = typeof submitVote === 'function' ? submitVote : () => {};
submitVote = function enhancedSubmitVote(voteType) {
  if (!selectedIssueId) return;
  const issue = issues.find(i => i.id === selectedIssueId);
  if (!issue) return;

  if (voteType === 'confirm') {
    const check = canUserVerifyIssue(issue);
    if (!check.ok) {
      showToast('Verification Blocked', check.reason, 'warning');
      return;
    }
  }

  _origSubmitVote(voteType);

  // Re-check with weighted threshold after original vote logic
  const issueRef = issues.find(i => i.id === selectedIssueId);
  if (!issueRef) return;
  const weighted = getWeightedConfirmCount(issueRef);
  if (weighted >= VERIFY_THRESHOLD && issueRef.status === 'Reported') {
    issueRef.status = 'Verified';
    if (!issueRef.statusHistory.some(h => h.status === 'Verified')) {
      issueRef.statusHistory.push({
        status: 'Verified',
        changedBy: 'Community Hero Engine',
        timestamp: new Date().toISOString(),
        notes: `Trust-weighted verification (${weighted.toFixed(1)} confirmations).`
      });
      saveState();
    }
  }
  updateVerificationUI(issueRef);
};

function updateVerificationUI(issue) {
  const bar = document.getElementById('verify-progress-bar');
  const label = document.getElementById('verify-progress-label');
  if (!bar || !label || !issue) return;
  const weighted = getWeightedConfirmCount(issue);
  const pct = Math.min(100, (weighted / VERIFY_THRESHOLD) * 100);
  bar.style.width = `${pct}%`;
  label.textContent = `${weighted.toFixed(1)} / ${VERIFY_THRESHOLD} weighted confirmations`;
}

// ── Duplicate detection before submit ────────────────────────────────────────
function findNearbyDuplicate(category, lat, lng) {
  return issues.find(issue =>
    issue.category === category &&
    issue.status !== 'Closed' &&
    issue.status !== 'Resolved' &&
    getDistance(lat, lng, issue.lat, issue.lng) < 60
  );
}

function confirmExistingIssue(duplicateId) {
  selectedIssueId = duplicateId;
  closeReportModal();
  openDetailDrawer(duplicateId);
  submitVote('confirm');
  showToast('Duplicate Avoided', 'You confirmed the existing nearby report instead of creating a duplicate.', 'success');
}

// ── Video frame extraction for AI on video captures ─────────────────────────
async function extractVideoFrame(blob) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.src = URL.createObjectURL(blob);
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d').drawImage(video, 0, 0);
      URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    video.onerror = reject;
  });
}

// ── AI assignment suggestion for admin ───────────────────────────────────────
async function fetchAssignmentSuggestion(issue) {
  const panel = document.getElementById('ai-assignment-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> CivicAI analyzing best officer...';

  const officers = users.filter(u => u.role === 'officer');
  const loads = {};
  officers.forEach(o => {
    loads[o.id] = issues.filter(i => i.assignedTo === o.id && i.status !== 'Resolved' && i.status !== 'Closed').length;
  });

  try {
    const res = await fetch('/api/suggest-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue, officers, officerLoads: loads })
    });
    const data = await res.json();
    const officer = users.find(u => u.id === data.officerId);
    panel.innerHTML = `
      <div class="ai-assignment-suggestion">
        <strong><i class="fa-solid fa-robot"></i> CivicAI Recommends:</strong>
        <span>${officer ? officer.name : 'Unassigned'}</span>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">${data.reason || ''} (${data.confidence || 0}% confidence)</p>
        ${officer ? `<button type="button" class="btn-secondary" style="padding:4px 10px;font-size:11px;margin-top:6px;" onclick="applySuggestedOfficer('${data.officerId}')">Apply Suggestion</button>` : ''}
      </div>`;
  } catch {
    panel.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Assignment suggestion unavailable offline.</span>';
  }
}

function applySuggestedOfficer(officerId) {
  const sel = document.getElementById('assign-officer-select');
  if (sel) {
    sel.value = officerId;
    assignOfficer();
    showToast('AI Assignment Applied', 'Officer assigned per CivicAI recommendation.', 'success');
  }
}

// ── Citizen-friendly AI status messages ───────────────────────────────────────
async function notifyCitizenStatusUpdate(issue, newStatus, changedBy) {
  try {
    const res = await fetch('/api/status-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue, newStatus, changedBy })
    });
    const data = await res.json();
    if (data.message) {
      pushNotification(`Update: ${newStatus}`, data.message, 'info');
    }
  } catch { /* non-fatal */ }
}

const _origUpdateIssueStatus = typeof updateIssueStatus === 'function' ? updateIssueStatus : () => {};
updateIssueStatus = function enhancedUpdateIssueStatus(newStatus) {
  const issue = issues.find(i => i.id === selectedIssueId);
  _origUpdateIssueStatus(newStatus);
  if (issue) notifyCitizenStatusUpdate(issue, newStatus, currentUser?.name);
};

// ── Officer GPS check-in ───────────────────────────────────────────────────────
function officerCheckIn() {
  if (!selectedIssueId || currentUser?.role !== 'officer') return;
  const issue = issues.find(i => i.id === selectedIssueId);
  if (!issue) return;

  const dist = getDistance(userActualCoords.lat, userActualCoords.lng, issue.lat, issue.lng);
  if (dist > 200) {
    showToast('Too Far', `You are ~${Math.round(dist)}m from the issue. Move closer to check in.`, 'warning');
    return;
  }

  issue.statusHistory.push({
    status: issue.status,
    changedBy: currentUser.name,
    timestamp: new Date().toISOString(),
    notes: `📍 Officer on-site check-in (${Math.round(dist)}m from pin).`
  });
  saveState();
  openDetailDrawer(selectedIssueId);
  showToast('Checked In 📍', 'Your on-site arrival was logged.', 'success');
}

// ── Proof photo uploading disabled by user request ───────────────────────────
function triggerProofPhotoUpload() {}
function handleProofPhotoSelected(event) {}
function showResolvedPhotoInDrawer(issue) {}

// ── Admin bulk actions ─────────────────────────────────────────────────────────
function bulkAssignOverdue() {
  const overdue = issues.filter(i =>
    i.status !== 'Resolved' && i.status !== 'Closed' &&
    i.slaDeadline && new Date() > new Date(i.slaDeadline) && !i.assignedTo
  );
  const officer = users.find(u => u.role === 'officer');
  if (!officer || overdue.length === 0) {
    showToast('Nothing to Assign', 'No unassigned overdue tickets found.', 'info');
    return;
  }
  overdue.forEach(issue => {
    issue.assignedTo = officer.id;
    issue.status = 'Assigned';
    issue.statusHistory.push({
      status: 'Assigned',
      changedBy: currentUser.name,
      timestamp: new Date().toISOString(),
      notes: `Bulk-assigned overdue ticket to ${officer.name}.`
    });
  });
  saveState();
  renderQueueList();
  updateDashboardMetrics();
  showToast('Bulk Assigned', `${overdue.length} overdue ticket(s) assigned to ${officer.name}.`, 'success');
}

function filterQueueOverdue() {
  const sel = document.getElementById('queue-filter-status');
  if (sel) sel.value = 'overdue';
  applyEnhancedQueueFilters();
}

function filterQueueUnassigned() {
  const sel = document.getElementById('queue-filter-status');
  if (sel) sel.value = 'unassigned';
  applyEnhancedQueueFilters();
}

function applyEnhancedQueueFilters() {
  const container = document.getElementById('admin-queue-container');
  if (!container) return;
  const wardFilter = document.getElementById('queue-filter-ward')?.value || 'all';
  const statusFilter = document.getElementById('queue-filter-status')?.value || 'all';

  let filtered = issues.filter(i => i.status !== 'Closed');
  if (wardFilter !== 'all') filtered = filtered.filter(i => i.wardId === wardFilter);
  if (statusFilter === 'overdue') {
    filtered = filtered.filter(i => i.slaDeadline && new Date() > new Date(i.slaDeadline) && i.status !== 'Resolved');
  } else if (statusFilter === 'unassigned') {
    filtered = filtered.filter(i => !i.assignedTo && i.status !== 'Resolved');
  }

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No tickets match this filter.</p></div>';
    return;
  }
  filtered.forEach(issue => {
    const card = document.createElement('div');
    card.className = `glass-card ${issue.category}`;
    card.onclick = () => openDetailDrawer(issue.id);
    card.innerHTML = `
      <div class="card-header">
        <span class="card-badge status-${issue.status.toLowerCase().replace(' ', '-')}">${issue.status}</span>
      </div>
      <h3 class="card-title">${issue.category}</h3>
      <p class="card-desc">${issue.description}</p>
      <div class="card-footer"><span>${getWardName(issue.wardId)}</span></div>`;
    container.appendChild(card);
  });
  renderMapMarkers(filtered, adminMap, adminMapMarkers, openDetailDrawer);
}

// ── Public impact dashboard ───────────────────────────────────────────────────
function renderPublicImpact() {
  renderLeaderboard();
  updateStreak();

  const total = issues.length;
  const resolved = issues.filter(i => i.status === 'Resolved').length;
  const active = issues.filter(i => i.status !== 'Resolved' && i.status !== 'Closed').length;
  const avgMs = computeAvgResolutionMs();

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('impact-total', total);
  set('impact-resolved', resolved);
  set('impact-active', active);
  set('impact-avg', avgMs ? (avgMs < 86400000 ? `${Math.round(avgMs / 3600000)} hrs` : `${Math.round(avgMs / 86400000)} days`) : 'N/A');
  set('impact-streak', `${userStreak} day${userStreak !== 1 ? 's' : ''}`);

  const heroEl = document.getElementById('hero-of-week');
  if (heroEl) {
    const top = users.filter(u => u.role === 'citizen').sort((a, b) => (b.points || 0) - (a.points || 0))[0];
    heroEl.textContent = top ? `${top.name} — ${top.points} XP` : '—';
  }

  renderPublicWardChart();
  fetchAITrends();
}

function computeAvgResolutionMs() {
  const resolved = issues.filter(i => i.status === 'Resolved' && i.statusHistory?.length >= 2);
  if (!resolved.length) return null;
  const sum = resolved.reduce((acc, issue) => {
    const start = new Date(issue.statusHistory[0].timestamp).getTime();
    const end = new Date(issue.statusHistory[issue.statusHistory.length - 1].timestamp).getTime();
    return acc + (end - start);
  }, 0);
  return sum / resolved.length;
}

function renderPublicWardChart() {
  const canvas = document.getElementById('publicWardChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const wardData = INITIAL_WARDS.map(w => ({
    name: w.name.replace(' Ward', ''),
    count: issues.filter(i => i.wardId === w.id && i.status !== 'Closed').length
  }));

  if (publicWardChartInstance) publicWardChartInstance.destroy();
  publicWardChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: wardData.map(w => w.name),
      datasets: [{ label: 'Active Issues', data: wardData.map(w => w.count), backgroundColor: ['#966b9d', '#c98686', '#c67119'], borderRadius: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

async function fetchAITrends() {
  const panel = document.getElementById('ai-trends-panel');
  if (!panel) return;
  panel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> CivicAI generating city forecast...';
  try {
    const res = await fetch('/api/trends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues, wards: INITIAL_WARDS })
    });
    const data = await res.json();
    aiTrendsCache = data;
    panel.innerHTML = `
      <p><strong>Summary:</strong> ${data.summary || '—'}</p>
      <p><strong>7-Day Forecast:</strong> ${data.forecast || '—'}</p>
      <p><strong>Recommendation:</strong> ${data.recommendation || '—'}</p>`;
  } catch {
    panel.innerHTML = '<p style="color:var(--text-muted);">Trend analysis requires server connection.</p>';
  }
}

// ── Multilingual description ───────────────────────────────────────────────────
async function translateDescription() {
  const textarea = document.getElementById('issue-desc');
  const lang = document.getElementById('report-lang-select')?.value || 'hi';
  if (!textarea?.value.trim()) return;
  showToast('Translating…', 'CivicAI is translating your description.', 'info');
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textarea.value, targetLang: lang })
    });
    const data = await res.json();
    textarea.value = data.translated || textarea.value;
    showToast('Translated', `Description converted (${lang.toUpperCase()}).`, 'success');
  } catch {
    showToast('Translation Failed', 'Could not translate — try again.', 'warning');
  }
}

// ── Public read-only issue view (no login) ────────────────────────────────────
async function bootPublicView(issueId) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'none';

  let panel = document.getElementById('public-share-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'public-share-panel';
    panel.className = 'public-share-panel';
    document.body.appendChild(panel);
  }

  panel.style.display = 'flex';
  panel.innerHTML = '<div class="public-share-card"><i class="fa-solid fa-spinner fa-spin"></i> Loading issue...</div>';

  let issue = issues.find(i => i.id === issueId);
  if (!issue) {
    try {
      const res = await fetch(`/api/issues/${issueId}`);
      if (res.ok) issue = await res.json();
    } catch { /* ignore */ }
  }

  if (!issue) {
    panel.innerHTML = `<div class="public-share-card">
      <h2>Issue Not Found</h2>
      <p>This link may be expired or the issue was removed.</p>
      <a href="/" class="btn-primary" style="display:inline-block;margin-top:16px;text-decoration:none;">Go to Community Hero</a>
    </div>`;
    return;
  }

  panel.innerHTML = `<div class="public-share-card">
    <div class="public-share-brand"><i class="fa-solid fa-hands-holding-child"></i> Community Hero</div>
    <span class="card-badge status-${issue.status.toLowerCase().replace(' ', '-')}">${issue.status}</span>
    <h2 style="text-transform:capitalize;margin:12px 0;">${issue.category}</h2>
    <p style="color:var(--text-muted);line-height:1.6;">${issue.description}</p>
    <div class="card-meta" style="margin:16px 0;display:flex;flex-wrap:wrap;gap:12px;font-size:13px;">
      <span><i class="fa-solid fa-location-dot"></i> ${getWardName(issue.wardId)}</span>
      <span><i class="fa-regular fa-calendar"></i> ${new Date(issue.createdAt).toLocaleDateString()}</span>
    </div>
    ${issue.photoUrl && !issue.photoUrl.startsWith('blob:') ? `<img src="${issue.photoUrl}" onerror="this.src=window.CATEGORY_DEFAULT_IMAGES ? (window.CATEGORY_DEFAULT_IMAGES[(this.alt || '').toLowerCase()] || window.CATEGORY_DEFAULT_IMAGES.other) : ''" style="width:100%;border-radius:12px;margin-bottom:16px;" alt="${issue.category}">` : ''}
    <h3 style="font-size:14px;margin-bottom:8px;">Timeline</h3>
    <div>${(issue.statusHistory || []).map(h => `<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--border-color);"><strong>${h.status}</strong> — ${h.notes || ''} <span style="color:var(--text-muted);">${new Date(h.timestamp).toLocaleString()}</span></div>`).join('')}</div>
    <a href="/" class="btn-primary" style="display:inline-block;margin-top:20px;text-decoration:none;">Sign In to Report Issues</a>
  </div>`;
}

// ── Patch openDetailDrawer for enhancements ──────────────────────────────────
const _origOpenDetailDrawer = typeof openDetailDrawer === 'function' ? openDetailDrawer : () => {};
openDetailDrawer = function enhancedOpenDetailDrawer(issueId) {
  _origOpenDetailDrawer(issueId);
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;

  updateVerificationUI(issue);
  showResolvedPhotoInDrawer(issue);

  const checkInBtn = document.getElementById('btn-officer-checkin');
  if (checkInBtn) {
    checkInBtn.style.display = (currentUser?.role === 'officer' && issue.assignedTo === currentUser.id) ? 'inline-flex' : 'none';
  }

  if (currentUser?.role === 'admin' && issue.status !== 'Closed' && issue.status !== 'Resolved') {
    fetchAssignmentSuggestion(issue);
  } else {
    const ap = document.getElementById('ai-assignment-panel');
    if (ap) ap.style.display = 'none';
  }

  const translateBtn = document.getElementById('btn-translate-desc');
  if (translateBtn) {
    // Reset translation button label when opening drawer
    translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Translate to Hindi';
    translateBtn.onclick = async () => {
      const descEl = document.getElementById('drawer-description');
      const isCurrentlyTranslated = descEl.textContent !== issue.description;

      if (isCurrentlyTranslated) {
        descEl.textContent = issue.description;
        translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Translate to Hindi';
      } else {
        translateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Translating...';
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: issue.description, targetLang: 'hi' })
          });
          const data = await res.json();
          const translatedText = data.translated || issue.description;
          if (translatedText.trim().toLowerCase() === issue.description.trim().toLowerCase()) {
            showToast('Offline Fallback', 'Could not fetch live translation. Translation requiring Gemini key fell back to original.', 'warning');
            translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Translate to Hindi';
          } else {
            descEl.textContent = translatedText;
            translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Show English';
          }
        } catch {
          showToast('Translate Failed', 'Could not translate.', 'warning');
          translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Translate to Hindi';
        }
      }
    };
  }
};

// ── Navigation History Tracking & Back Button ───────────────────────────────
let navigationHistory = [];
let isNavigatingBack = false;

function getCurrentActiveViewName() {
  const views = ['citizen', 'authority', 'officer', 'public'];
  for (const v of views) {
    const el = document.getElementById(`view-${v}`);
    if (el && el.classList.contains('active')) {
      return v;
    }
  }
  return null;
}

function updateBackButtonVisibility(currentView) {
  const btn = document.getElementById('btn-back-navigation');
  if (!btn) return;

  const defaultViews = {
    citizen: 'citizen',
    admin: 'authority',
    officer: 'officer'
  };

  const userRole = currentUser?.role || 'citizen';
  const defaultView = defaultViews[userRole] || 'citizen';

  // If in admin view and current subview is Operational Queue, display back button
  if (currentView === 'authority' && typeof adminSubView !== 'undefined' && adminSubView === 'queue') {
    btn.style.display = 'flex';
  } else if (currentView !== defaultView) {
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}

function navigateBack() {
  const currentView = getCurrentActiveViewName();
  // If in admin Operational Queue, navigate back to stats dashboard
  if (currentView === 'authority' && typeof adminSubView !== 'undefined' && adminSubView === 'queue') {
    if (typeof toggleAdminView === 'function') {
      toggleAdminView('dashboard');
    }
    return;
  }

  if (navigationHistory.length > 0) {
    const prevView = navigationHistory.pop();
    isNavigatingBack = true;
    switchView(prevView);
    isNavigatingBack = false;
  } else {
    const defaultViews = {
      citizen: 'citizen',
      admin: 'authority',
      officer: 'officer'
    };
    const userRole = currentUser?.role || 'citizen';
    const defaultView = defaultViews[userRole] || 'citizen';
    isNavigatingBack = true;
    switchView(defaultView);
    isNavigatingBack = false;
  }
}

window.navigateBack = navigateBack;

// ── Patch switchView for public impact & back navigation ─────────────────────
const _origSwitchView = typeof switchView === 'function' ? switchView : () => {};
switchView = function enhancedSwitchView(viewName) {
  if (!isNavigatingBack) {
    const currentActiveView = getCurrentActiveViewName();
    if (currentActiveView && currentActiveView !== viewName) {
      const defaultViews = {
        citizen: 'citizen',
        admin: 'authority',
        officer: 'officer'
      };
      const userRole = currentUser?.role || 'citizen';
      const defaultView = defaultViews[userRole] || 'citizen';
      
      if (viewName === defaultView) {
        navigationHistory = [];
      } else {
        navigationHistory.push(currentActiveView);
      }
    }
  }

  _origSwitchView(viewName);
  if (viewName === 'public') renderPublicImpact();
  updateBackButtonVisibility(viewName);
};

// ── Patch toggleAdminView to update back button visibility ──────────────────
const _origToggleAdminView = typeof toggleAdminView === 'function' ? toggleAdminView : () => {};
toggleAdminView = function enhancedToggleAdminView(subView) {
  _origToggleAdminView(subView);
  const currentView = getCurrentActiveViewName();
  updateBackButtonVisibility(currentView);
};

// ── Patch handleFormSubmit for ward + duplicate confirm ────────────────────────
const _origHandleFormSubmit = typeof handleFormSubmit === 'function' ? handleFormSubmit : null;
if (_origHandleFormSubmit) {
  handleFormSubmit = function patchedHandleFormSubmit(event) {
    event.preventDefault();
    if (!capturedDataUrl && !capturedVideoBlob) {
      showToast('No Evidence', 'Please capture a photo or record a video.', 'warning');
      return;
    }

    const aiCat = document.getElementById('ai-category-tag')?.innerText.toLowerCase() || '';
    let category = 'other';
    if (aiCat.includes('spam')) category = 'spam';
    else if (!aiCat.includes('analy')) category = aiCat;

    const dup = category !== 'spam' ? findNearbyDuplicate(category, draftCoords.lat, draftCoords.lng) : null;
    if (dup) {
      const confirmDup = confirm(`A similar ${category} report exists ${Math.round(getDistance(draftCoords.lat, draftCoords.lng, dup.lat, dup.lng))}m away.\n\nClick OK to confirm that existing issue instead of creating a duplicate.`);
      if (confirmDup) {
        confirmExistingIssue(dup.id);
        return;
      }
    }

    // Patch ward before original submit runs — intercept via custom property
    window.__detectedWard = detectWardFromCoords(draftCoords.lat, draftCoords.lng);
    updateStreak();
    _origHandleFormSubmit(event);
  };
}

// Patch issue creation ward — hook after submit by wrapping the issue push
// We patch via MutationObserver alternative: override in handleFormSubmit post-call
// Simpler: patch in app.js wardId line via enhancements reading __detectedWard

// ── Patch simulateAIDiagnostics for reasoning + video ─────────────────────────
const _origSimulateAI = typeof simulateAIDiagnostics === 'function' ? simulateAIDiagnostics : null;
if (_origSimulateAI) {
  simulateAIDiagnostics = async function enhancedSimulateAI(fileName) {
    if (capturedVideoBlob && !capturedDataUrl) {
      try {
        capturedDataUrl = await extractVideoFrame(capturedVideoBlob);
        const imgEl = document.getElementById('captured-img');
        if (imgEl) { imgEl.src = capturedDataUrl; imgEl.style.display = 'block'; }
      } catch (e) {
        console.warn('Video frame extraction failed:', e);
      }
    }
    await _origSimulateAI(fileName);

    const reasoningEl = document.getElementById('ai-reasoning-text');
    if (reasoningEl && capturedDataUrl?.startsWith('data:image')) {
      try {
        const res = await fetch('/api/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: capturedDataUrl })
        });
        if (res.ok) {
          const data = await res.json();
          reasoningEl.style.display = 'block';
          reasoningEl.innerHTML = `<i class="fa-solid fa-lightbulb"></i> <strong>AI Reasoning:</strong> ${data.reasoning || 'Visual analysis complete.'}`;
          if (data.priority) {
            const priTag = document.getElementById('ai-priority-tag');
            if (priTag) priTag.innerText = data.priority;
          }
          if (data.confidence) {
            const confTag = document.getElementById('ai-confidence-tag');
            if (confTag) confTag.innerText = `${data.confidence}%`;
          }
        } else if (res.status === 503) {
          reasoningEl.style.display = 'block';
          reasoningEl.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Offline mode — using MobileNet on-device classification.';
        }
      } catch {
        if (reasoningEl) {
          reasoningEl.style.display = 'block';
          reasoningEl.innerHTML = '<i class="fa-solid fa-microchip"></i> On-device MobileNet classification active.';
        }
      }
    }
  };
}

// ── Fix ward on new issues (monkey-patch saveState timing) ─────────────────────
const _origSaveState2 = saveState;
saveState = function fixWardSaveState() {
  if (window.__detectedWard && issues.length > 0) {
    const latest = issues[0];
    if (latest && latest.id?.startsWith('issue-') && latest.wardId === 'ward-1') {
      const expected = detectWardFromCoords(latest.lat, latest.lng);
      if (expected) latest.wardId = expected;
    }
    window.__detectedWard = null;
  }
  _origSaveState2();
};

// ── PWA registration ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ── Boot: public view mode ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('public') === '1' && params.get('issue')) {
    setTimeout(() => bootPublicView(params.get('issue')), 400);
  }
});

// Empty state helper for citizen feed
const _origRenderFeedList = typeof renderFeedList === 'function' ? renderFeedList : null;
if (_origRenderFeedList) {
  renderFeedList = function enhancedRenderFeedList() {
    _origRenderFeedList();
    const container = document.getElementById('citizen-feed-container');
    if (container && container.textContent.includes('No active issues')) {
      container.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-seedling"></i>
        <h3>No issues in your area</h3>
        <p>Be the first to report a local problem and earn XP!</p>
        <button class="btn-primary" style="width:auto;padding:8px 20px;margin-top:12px;" onclick="openReportModal()">Report First Issue</button>
      </div>`;
    }
  };
}

// Notify reporter on status changes they care about
function watchMyIssuesNotifications() {
  if (!currentUser || currentUser.role !== 'citizen') return;
  issues.filter(i => i.createdBy === currentUser.name).forEach(issue => {
    const key = `notified_${issue.id}_${issue.status}`;
    if (!sessionStorage.getItem(key) && issue.status !== 'Reported') {
      sessionStorage.setItem(key, '1');
    }
  });
}

console.info('[Community Hero] All tier enhancements loaded ✅');
