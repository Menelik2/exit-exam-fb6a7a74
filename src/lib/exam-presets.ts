export type BlueprintItem = {
  id: string;
  subject: string;
  objectives: string;
  weight: number;
};

export type BlueprintPreset = {
  id: string;
  label: string;
  description: string;
  items: Omit<BlueprintItem, "id">[];
};

export const DEFAULT_BLUEPRINT: BlueprintItem[] = [
  { id: "b1", subject: "Software Engineering", objectives: "SDLC models, requirements engineering, design patterns", weight: 40 },
  { id: "b2", subject: "Data Structures & Algorithms", objectives: "Trees, graphs, sorting, complexity analysis", weight: 35 },
  { id: "b3", subject: "Database Systems", objectives: "Normalization, SQL, transactions, indexing", weight: 25 },
];

export const BLUEPRINT_PRESETS: BlueprintPreset[] = [
  {
    id: "cs",
    label: "Computer Science",
    description: "EHEEE CS blueprint",
    items: [
      { subject: "Software Engineering", objectives: "SDLC, requirements, UML, design patterns, testing", weight: 20 },
      { subject: "Data Structures & Algorithms", objectives: "Lists, trees, graphs, sorting, complexity, recursion", weight: 20 },
      { subject: "Database Systems", objectives: "ER modeling, normalization, SQL, transactions, indexing", weight: 15 },
      { subject: "Operating Systems", objectives: "Processes, threads, scheduling, memory, file systems, deadlocks", weight: 15 },
      { subject: "Computer Networks", objectives: "OSI/TCP-IP, routing, addressing, protocols, security", weight: 15 },
      { subject: "Object-Oriented Programming", objectives: "Encapsulation, inheritance, polymorphism, Java/C++ idioms", weight: 15 },
    ],
  },
  {
    id: "swe",
    label: "Software Engineering",
    description: "EHEEE SWE blueprint",
    items: [
      { subject: "Requirements Engineering", objectives: "Elicitation, SRS, use cases, validation", weight: 15 },
      { subject: "Software Design & Architecture", objectives: "Design patterns, UML, SOLID, architectural styles", weight: 20 },
      { subject: "Software Testing & QA", objectives: "Unit/integration testing, TDD, coverage, defect management", weight: 15 },
      { subject: "Software Project Management", objectives: "Agile, Scrum, estimation, risk, configuration management", weight: 15 },
      { subject: "Web & Mobile Engineering", objectives: "HTTP, REST, frontend/backend, mobile lifecycles", weight: 20 },
      { subject: "Databases for SWE", objectives: "SQL, ORM, transactions, NoSQL basics", weight: 15 },
    ],
  },
  {
    id: "it",
    label: "Information Technology",
    description: "EHEEE IT blueprint",
    items: [
      { subject: "Computer Networks", objectives: "TCP/IP, subnetting, routing, wireless, security", weight: 20 },
      { subject: "System Administration", objectives: "Linux/Windows admin, services, scripting, backup", weight: 15 },
      { subject: "Database Management", objectives: "SQL, normalization, transactions, administration", weight: 15 },
      { subject: "Web Technologies", objectives: "HTML/CSS/JS, HTTP, REST, CMS, deployment", weight: 20 },
      { subject: "Information Security", objectives: "CIA triad, cryptography, threats, controls, policies", weight: 15 },
      { subject: "IT Project Management", objectives: "Project lifecycle, scope, risk, stakeholders", weight: 15 },
    ],
  },
  {
    id: "civil",
    label: "Civil Engineering",
    description: "EHEEE Civil blueprint",
    items: [
      { subject: "Structural Analysis & Design", objectives: "Beams, frames, RC design, steel design", weight: 25 },
      { subject: "Geotechnical Engineering", objectives: "Soil mechanics, foundations, bearing capacity, slopes", weight: 15 },
      { subject: "Hydraulics & Water Resources", objectives: "Flow, pipes, channels, hydrology, irrigation", weight: 15 },
      { subject: "Transportation Engineering", objectives: "Highway geometric design, pavement, traffic", weight: 15 },
      { subject: "Construction Management", objectives: "Scheduling, estimation, contracts, safety", weight: 15 },
      { subject: "Surveying & Geomatics", objectives: "Leveling, theodolite, GIS/GPS, mapping", weight: 15 },
    ],
  },
  {
    id: "ee",
    label: "Electrical Engineering",
    description: "EHEEE EE blueprint",
    items: [
      { subject: "Circuit Analysis", objectives: "DC/AC circuits, Kirchhoff, Thevenin/Norton, transients", weight: 20 },
      { subject: "Electrical Machines", objectives: "Transformers, DC/AC motors, generators", weight: 20 },
      { subject: "Power Systems", objectives: "Generation, transmission, distribution, faults, protection", weight: 20 },
      { subject: "Control Systems", objectives: "Transfer functions, stability, PID, root locus", weight: 15 },
      { subject: "Electronics", objectives: "Diodes, BJT/MOSFET, amplifiers, op-amps", weight: 15 },
      { subject: "Signals & Systems", objectives: "Fourier, Laplace, sampling, filters", weight: 10 },
    ],
  },
  {
    id: "mech",
    label: "Mechanical Engineering",
    description: "EHEEE Mech blueprint",
    items: [
      { subject: "Thermodynamics", objectives: "Laws, cycles, entropy, steam tables", weight: 20 },
      { subject: "Fluid Mechanics", objectives: "Statics, Bernoulli, viscous flow, pumps", weight: 15 },
      { subject: "Mechanics of Materials", objectives: "Stress, strain, beams, torsion, buckling", weight: 20 },
      { subject: "Machine Design", objectives: "Shafts, gears, bearings, fasteners, fatigue", weight: 15 },
      { subject: "Manufacturing Processes", objectives: "Casting, machining, welding, CNC", weight: 15 },
      { subject: "Heat Transfer", objectives: "Conduction, convection, radiation, exchangers", weight: 15 },
    ],
  },
  {
    id: "medicine",
    label: "Medicine (General)",
    description: "EHEEE Medicine blueprint",
    items: [
      { subject: "Internal Medicine", objectives: "Cardio, pulmo, GI, endocrine, infectious diseases", weight: 25 },
      { subject: "Surgery", objectives: "General, trauma, perioperative care, common procedures", weight: 20 },
      { subject: "Pediatrics", objectives: "Growth, nutrition, IMNCI, common childhood illnesses", weight: 15 },
      { subject: "Obstetrics & Gynecology", objectives: "Antenatal, labor, complications, family planning", weight: 15 },
      { subject: "Public Health", objectives: "Epidemiology, biostatistics, Ethiopian health system, EPI", weight: 15 },
      { subject: "Psychiatry & Neurology", objectives: "Common mental disorders, stroke, seizures", weight: 10 },
    ],
  },
  {
    id: "nursing",
    label: "Nursing",
    description: "EHEEE Nursing blueprint",
    items: [
      { subject: "Fundamentals of Nursing", objectives: "Nursing process, vital signs, infection control", weight: 20 },
      { subject: "Medical-Surgical Nursing", objectives: "Adult care across systems, pre/post-op", weight: 25 },
      { subject: "Maternal & Child Nursing", objectives: "Antenatal, intrapartum, newborn, IMNCI", weight: 20 },
      { subject: "Community Health Nursing", objectives: "Primary health care, EPI, health promotion", weight: 15 },
      { subject: "Mental Health Nursing", objectives: "Therapeutic communication, common disorders", weight: 10 },
      { subject: "Pharmacology for Nurses", objectives: "Drug classes, dosage, administration, safety", weight: 10 },
    ],
  },
  {
    id: "accounting",
    label: "Accounting & Finance",
    description: "EHEEE Accounting blueprint",
    items: [
      { subject: "Financial Accounting", objectives: "IFRS basics, journal/ledger, statements", weight: 25 },
      { subject: "Cost & Management Accounting", objectives: "Costing systems, CVP, budgeting, variances", weight: 20 },
      { subject: "Auditing", objectives: "Audit process, evidence, internal control, reports", weight: 15 },
      { subject: "Taxation (Ethiopia)", objectives: "Income tax, VAT, withholding, ERCA practice", weight: 15 },
      { subject: "Corporate Finance", objectives: "TVM, capital budgeting, cost of capital, ratios", weight: 15 },
      { subject: "Public Finance & Government Accounting", objectives: "Budgeting, IPSAS, Ethiopian public sector", weight: 10 },
    ],
  },
  {
    id: "management",
    label: "Management",
    description: "EHEEE Management blueprint",
    items: [
      { subject: "Principles of Management", objectives: "Planning, organizing, leading, controlling", weight: 20 },
      { subject: "Human Resource Management", objectives: "Recruitment, training, performance, labor law", weight: 15 },
      { subject: "Marketing Management", objectives: "STP, 4Ps, consumer behavior, digital marketing", weight: 15 },
      { subject: "Operations Management", objectives: "Process design, inventory, quality, supply chain", weight: 15 },
      { subject: "Strategic Management", objectives: "SWOT, Porter, BSC, strategy formulation", weight: 15 },
      { subject: "Entrepreneurship", objectives: "Opportunity, business plan, SME context in Ethiopia", weight: 20 },
    ],
  },
  {
    id: "economics",
    label: "Economics",
    description: "EHEEE Economics blueprint",
    items: [
      { subject: "Microeconomics", objectives: "Demand/supply, elasticity, market structures", weight: 25 },
      { subject: "Macroeconomics", objectives: "GDP, inflation, unemployment, IS-LM, monetary/fiscal policy", weight: 25 },
      { subject: "Development Economics", objectives: "Growth, poverty, inequality, Ethiopian context", weight: 15 },
      { subject: "International Economics", objectives: "Trade theories, BOP, exchange rates", weight: 15 },
      { subject: "Econometrics", objectives: "OLS, hypothesis testing, regression diagnostics", weight: 10 },
      { subject: "Public Economics", objectives: "Taxation, public goods, externalities", weight: 10 },
    ],
  },
  {
    id: "law",
    label: "Law (LLB)",
    description: "EHEEE Law blueprint",
    items: [
      { subject: "Constitutional Law (FDRE)", objectives: "FDRE constitution, federalism, rights", weight: 20 },
      { subject: "Civil & Family Law", objectives: "Contracts, property, family code", weight: 20 },
      { subject: "Criminal Law & Procedure", objectives: "Criminal Code, defenses, procedure", weight: 20 },
      { subject: "Commercial Law", objectives: "Business organizations, negotiable instruments, bankruptcy", weight: 15 },
      { subject: "Administrative & Public Law", objectives: "Administrative agencies, judicial review", weight: 15 },
      { subject: "International & Human Rights Law", objectives: "Treaties, UN system, African human rights", weight: 10 },
    ],
  },
];

export function newBlueprintId() {
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Distribute total questions across items by weight using largest-remainder. */
export function allocateCounts(items: BlueprintItem[], total: number): number[] {
  const totalWeight = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (totalWeight <= 0 || items.length === 0) return items.map(() => 0);
  const raw = items.map((i) => (Math.max(0, i.weight) / totalWeight) * total);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = total - floors.reduce((s, n) => s + n, 0);
  const order = raw
    .map((r, idx) => ({ idx, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remaining > 0; k++) {
    floors[order[k].idx] += 1;
    remaining--;
  }
  return floors;
}

export function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
