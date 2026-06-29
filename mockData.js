const INITIAL_WARDS = [
  { id: "ward-1", name: "Greenwood Ward", lat: 12.9716, lng: 77.5946, radiusM: 2500 },
  { id: "ward-2", name: "Metro Hub Ward", lat: 12.9780, lng: 77.6400, radiusM: 2500 },
  { id: "ward-3", name: "Lakeview Ward", lat: 12.9352, lng: 77.6245, radiusM: 2500 }
];

const INITIAL_USERS = [
  {
    id: "user-current",
    name: "Krishna Vishwakarma",
    email: "krishna@civic.com",
    password: "citizen123",
    role: "citizen",
    points: 150,
    trustScore: 92,
    badges: ["First Responder", "Local Watchdog"]
  },
  {
    id: "user-ramesh",
    name: "Officer Ramesh Kumar",
    email: "ramesh@civic.com",
    password: "officer123",
    role: "officer",
    department: "Roads & Traffic",
    points: 0,
    trustScore: 100,
    badges: []
  },
  {
    id: "user-sarah",
    name: "Admin Sarah Chen",
    email: "sarah@civic.com",
    password: "admin123",
    role: "admin",
    department: "Sanitation",
    points: 0,
    trustScore: 100,
    badges: []
  },
  {
    id: "user-aarav",
    name: "Aarav Mehta",
    email: "aarav@civic.com",
    password: "aarav123",
    role: "citizen",
    points: 80,
    trustScore: 85,
    badges: ["Vocal Local"]
  },
  {
    id: "user-priya",
    name: "Priya Patel",
    email: "priya@civic.com",
    password: "priya123",
    role: "citizen",
    points: 210,
    trustScore: 98,
    badges: ["Community Champion", "Eagle Eye"]
  }
];

const INITIAL_ISSUES = [
  {
    id: "issue-101",
    category: "pothole",
    description: "Deep pothole right in the middle of Greenwood Main Road lane. Hazardous for two-wheelers.",
    photoUrl: "pothole.jpg.jpg", // Pothole (local image)
    resolvedPhotoUrl: null,
    lat: 12.9716,
    lng: 77.5946,
    status: "Verified",
    severity: "High",
    createdBy: "Aarav Mehta",
    createdAt: "2026-06-25T10:00:00Z",
    assignedTo: null,
    wardId: "ward-1",
    votes: [
      { userId: "user-priya", voteType: "confirm" },
      { userId: "user-current", voteType: "confirm" }
    ],
    statusHistory: [
      { status: "Reported", changedBy: "Aarav Mehta", timestamp: "2026-06-25T10:00:00Z", notes: "Issue logged via mobile." },
      { status: "Verified", changedBy: "System", timestamp: "2026-06-25T14:30:00Z", notes: "Auto-verified via community threshold." }
    ],
    slaDeadline: "2026-06-27T10:00:00Z"
  },
  {
    id: "issue-102",
    category: "streetlight",
    description: "Streetlight flickering and going dark intermittently. Lane 4 near Metro station is pitch black.",
    photoUrl: "streetlight.jpg", // Streetlight (local image)
    resolvedPhotoUrl: null,
    lat: 12.9780,
    lng: 77.6400,
    status: "Assigned",
    severity: "Medium",
    createdBy: "Krishna Vishwakarma",
    createdAt: "2026-06-25T18:00:00Z",
    assignedTo: "user-ramesh",
    wardId: "ward-2",
    votes: [
      { userId: "user-aarav", voteType: "confirm" }
    ],
    statusHistory: [
      { status: "Reported", changedBy: "Krishna Vishwakarma", timestamp: "2026-06-25T18:00:00Z", notes: "Reported streetlight issue." },
      { status: "Verified", changedBy: "System", timestamp: "2026-06-25T20:00:00Z", notes: "Community verification complete." },
      { status: "Assigned", changedBy: "Admin Sarah Chen", timestamp: "2026-06-26T09:00:00Z", notes: "Assigned to Officer Ramesh." }
    ],
    slaDeadline: "2026-06-26T18:00:00Z"
  },
  {
    id: "issue-103",
    category: "garbage",
    description: "Garbage overflow bins neglected for three days. Strays scattering trash all over the sidewalk.",
    photoUrl: "garbage.jpg", // Garbage (local image)
    resolvedPhotoUrl: null,
    lat: 12.9352,
    lng: 77.6245,
    status: "Reported",
    severity: "Medium",
    createdBy: "Priya Patel",
    createdAt: "2026-06-26T08:00:00Z",
    assignedTo: null,
    wardId: "ward-3",
    votes: [],
    statusHistory: [
      { status: "Reported", changedBy: "Priya Patel", timestamp: "2026-06-26T08:00:00Z", notes: "Garbage overflow reported." }
    ],
    slaDeadline: "2026-06-26T20:00:00Z"
  },
  {
    id: "issue-104",
    category: "water leakage",
    description: "Major water pipeline leakage, flooding the main junction and causing traffic delays.",
    photoUrl: "water_leak.jpg.jpg", // Water/Leak (local image)
    resolvedPhotoUrl: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80", // Resolved (Construction/clean site)
    lat: 12.9850,
    lng: 77.6050,
    status: "Resolved",
    severity: "High",
    createdBy: "Krishna Vishwakarma",
    createdAt: "2026-06-24T12:00:00Z",
    assignedTo: "user-ramesh",
    wardId: "ward-2",
    votes: [
      { userId: "user-priya", voteType: "confirm" },
      { userId: "user-aarav", voteType: "confirm" }
    ],
    statusHistory: [
      { status: "Reported", changedBy: "Krishna Vishwakarma", timestamp: "2026-06-24T12:00:00Z", notes: "Water pipeline burst." },
      { status: "Verified", changedBy: "System", timestamp: "2026-06-24T13:00:00Z", notes: "Verified." },
      { status: "Assigned", changedBy: "Admin Sarah Chen", timestamp: "2026-06-24T14:00:00Z", notes: "Assigned to Ramesh." },
      { status: "In Progress", changedBy: "Officer Ramesh Kumar", timestamp: "2026-06-24T15:30:00Z", notes: "Digging and pipe weld in progress." },
      { status: "Resolved", changedBy: "Officer Ramesh Kumar", timestamp: "2026-06-25T11:00:00Z", notes: "Pipe welded and road surface cleaned. Proof photo uploaded." }
    ],
    slaDeadline: "2026-06-24T18:00:00Z"
  }
];

if (typeof window !== "undefined") {
  window.INITIAL_WARDS = INITIAL_WARDS;
  window.INITIAL_USERS = INITIAL_USERS;
  window.INITIAL_ISSUES = INITIAL_ISSUES;
}
