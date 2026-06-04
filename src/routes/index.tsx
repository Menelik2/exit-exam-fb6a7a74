import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateExam, type ExamQuestion } from "@/lib/exam.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  GraduationCap,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  Shuffle,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Info,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: ExamGeneratorPage,
  head: () => ({
    meta: [
      { title: "Exam Generator — Instant Multiple Choice Quizzes" },
      {
        name: "description",
        content:
          "Generate custom multiple-choice exams by topic and difficulty. Preview answers and explanations instantly.",
      },
    ],
  }),
});

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

function shuffle<T>(arr: T[], seed: number): T[] {
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

const LS_KEY = "exam-gen-settings";

type BlueprintItem = {
  id: string;
  subject: string;
  objectives: string;
  weight: number;
};

const DEFAULT_BLUEPRINT: BlueprintItem[] = [
  { id: "b1", subject: "Software Engineering", objectives: "SDLC models, requirements engineering, design patterns", weight: 40 },
  { id: "b2", subject: "Data Structures & Algorithms", objectives: "Trees, graphs, sorting, complexity analysis", weight: 35 },
  { id: "b3", subject: "Database Systems", objectives: "Normalization, SQL, transactions, indexing", weight: 25 },
];

type BlueprintPreset = {
  id: string;
  label: string;
  description: string;
  items: Omit<BlueprintItem, "id">[];
};

const BLUEPRINT_PRESETS: BlueprintPreset[] = [
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

function newBlueprintId() {
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Distribute total questions across items by weight using largest-remainder.
function allocateCounts(items: BlueprintItem[], total: number): number[] {
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

function loadSettings() {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const validDiff = (["Beginner", "Intermediate", "Advanced"] as Difficulty[]).includes(
      parsed.difficulty
    );
    return {
      topic: typeof parsed.topic === "string" ? parsed.topic : "",
      difficulty: validDiff ? (parsed.difficulty as Difficulty) : ("Intermediate" as Difficulty),
      numQuestions:
        typeof parsed.numQuestions === "number"
          ? Math.max(1, Math.min(30, parsed.numQuestions))
          : 5,
      autoGenerate: typeof parsed.autoGenerate === "boolean" ? parsed.autoGenerate : true,
      shuffleOptions: typeof parsed.shuffleOptions === "boolean" ? parsed.shuffleOptions : false,
      useBlueprint: typeof parsed.useBlueprint === "boolean" ? parsed.useBlueprint : false,
      blueprint: Array.isArray(parsed.blueprint)
        ? (parsed.blueprint as BlueprintItem[]).slice(0, 12).map((b) => ({
            id: typeof b.id === "string" ? b.id : newBlueprintId(),
            subject: typeof b.subject === "string" ? b.subject : "",
            objectives: typeof b.objectives === "string" ? b.objectives : "",
            weight: typeof b.weight === "number" ? Math.max(0, Math.min(100, b.weight)) : 0,
          }))
        : null,
    };
  } catch {
    return null;
  }
}

function ExamGeneratorPage() {
  const saved = loadSettings();
  const [topic, setTopic] = useState(saved?.topic ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(saved?.difficulty ?? "Intermediate");
  const [numQuestions, setNumQuestions] = useState(saved?.numQuestions ?? 5);
  const [autoGenerate, setAutoGenerate] = useState(saved?.autoGenerate ?? true);
  const [shuffleOptions, setShuffleOptions] = useState(saved?.shuffleOptions ?? false);
  const [useBlueprint, setUseBlueprint] = useState(saved?.useBlueprint ?? false);
  const [blueprint, setBlueprint] = useState<BlueprintItem[]>(
    saved?.blueprint && saved.blueprint.length > 0 ? saved.blueprint : DEFAULT_BLUEPRINT
  );
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [takingIndex, setTakingIndex] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          topic,
          difficulty,
          numQuestions,
          autoGenerate,
          shuffleOptions,
          useBlueprint,
          blueprint,
        })
      );
    } catch {
      // ignore
    }
  }, [topic, difficulty, numQuestions, autoGenerate, shuffleOptions, useBlueprint, blueprint]);

  const counts = useMemo(
    () => allocateCounts(blueprint, numQuestions || 0),
    [blueprint, numQuestions]
  );
  const totalWeight = useMemo(
    () => blueprint.reduce((s, b) => s + Math.max(0, b.weight), 0),
    [blueprint]
  );

  const generateFn = useServerFn(generateExam);
  const SEEN_LS_KEY = "exam-gen-seen-v1";
  const seenRef = useRef<Map<string, string[]>>(new Map());
  const seenKey = (t: string, d: Difficulty) => `${d}::${t.trim().toLowerCase()}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (parsed && typeof parsed === "object") {
        seenRef.current = new Map(Object.entries(parsed));
      }
    } catch {
      // ignore
    }
  }, []);

  const persistSeen = useCallback(() => {
    try {
      const obj: Record<string, string[]> = {};
      seenRef.current.forEach((v, k) => {
        obj[k] = v;
      });
      localStorage.setItem(SEEN_LS_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }, []);

  const mutation = useMutation({
    mutationFn: (vars: {
      topic: string;
      difficulty: Difficulty;
      numQuestions: number;
      nonce: string;
      avoid: string[];
      blueprint?: { subject: string; objectives: string; weight: number; count: number }[];
    }) => generateFn({ data: vars }),
    onSuccess: (res, vars) => {
      setAnswers({});
      setRevealed({});
      setReviewMode(false);
      setReviewIndex(0);
      setTakingIndex(0);
      setShuffleSeed((s) => s + 1);
      const key = seenKey(vars.topic, vars.difficulty);
      const prev = seenRef.current.get(key) ?? [];
      const next = [...prev, ...res.questions.map((q) => q.question)].slice(-500);
      seenRef.current.set(key, next);
      persistSeen();
    },
  });

  const run = useCallback(
    (overrideNum?: number) => {
      const n = overrideNum ?? numQuestions;
      if (!n || n < 1) return;

      // Build blueprint payload (only valid items with positive count)
      let blueprintPayload:
        | { subject: string; objectives: string; weight: number; count: number }[]
        | undefined;
      let effectiveTopic = topic.trim();

      if (useBlueprint) {
        const validItems = blueprint
          .map((b, i) => ({ ...b, count: counts[i] ?? 0 }))
          .filter((b) => b.subject.trim().length > 0 && b.count > 0);
        if (validItems.length === 0) return;
        blueprintPayload = validItems.map((b) => ({
          subject: b.subject.trim(),
          objectives: b.objectives.trim(),
          weight: b.weight,
          count: b.count,
        }));
        if (!effectiveTopic) {
          effectiveTopic = `Ethiopian Exit Exam — ${validItems
            .map((b) => b.subject.trim())
            .join(", ")}`;
        }
      }

      if (!effectiveTopic) return;

      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const avoid = seenRef.current.get(seenKey(effectiveTopic, difficulty)) ?? [];
      mutation.mutate({
        topic: effectiveTopic,
        difficulty,
        numQuestions: n,
        nonce,
        avoid,
        blueprint: blueprintPayload,
      });
    },
    [topic, difficulty, numQuestions, mutation, useBlueprint, blueprint, counts]
  );

  useEffect(() => {
    setAnswers({});
    setRevealed({});
    setReviewMode(false);
    setReviewIndex(0);
    setTakingIndex(0);
  }, [topic, difficulty, numQuestions]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);
  const blueprintKey = useMemo(
    () =>
      blueprint
        .map((b) => `${b.subject}|${b.objectives}|${b.weight}`)
        .join("¶"),
    [blueprint]
  );
  useEffect(() => {
    if (!autoGenerate) return;
    const hasTopic = topic.trim().length > 0;
    const hasBlueprint =
      useBlueprint &&
      blueprint.some((b) => b.subject.trim().length > 0 && b.weight > 0);
    if (!hasTopic && !hasBlueprint) return;
    if (!numQuestions || numQuestions < 1) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = firstRunRef.current ? 900 : 700;
    debounceRef.current = setTimeout(() => {
      firstRunRef.current = false;
      run();
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, difficulty, numQuestions, autoGenerate, useBlueprint, blueprintKey]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run();
  };

  const rawQuestions: ExamQuestion[] = mutation.data?.questions ?? [];

  const displayedQuestions = useMemo(() => {
    if (!shuffleOptions) return rawQuestions;
    return rawQuestions.map((q) => ({
      ...q,
      options: shuffle(q.options, shuffleSeed + q.question_number * 7919),
    }));
  }, [rawQuestions, shuffleOptions, shuffleSeed]);

  useEffect(() => {
    setAnswers({});
    setRevealed({});
    setReviewMode(false);
    setReviewIndex(0);
    setTakingIndex(0);
  }, [shuffleOptions, shuffleSeed]);

  useEffect(() => {
    if (reviewMode || displayedQuestions.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const total = displayedQuestions.length;
      const idx = Math.min(takingIndex, total - 1);
      const q = displayedQuestions[idx];
      if (!q) return;
      if (e.key === "ArrowRight" && idx < total - 1) {
        setTakingIndex(idx + 1);
      } else if (e.key === "ArrowLeft" && idx > 0) {
        setTakingIndex(idx - 1);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        const n = parseInt(e.key, 10) - 1;
        const opt = q.options[n];
        if (opt && !revealed[q.question_number]) {
          setAnswers((a) => ({ ...a, [q.question_number]: opt }));
          setRevealed((r) => ({ ...r, [q.question_number]: true }));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [reviewMode, displayedQuestions, takingIndex, revealed]);

  // Derived stats for sidebar
  const total = displayedQuestions.length;
  const answeredCount = displayedQuestions.filter(
    (q) => answers[q.question_number] !== undefined
  ).length;
  const correctCount = displayedQuestions.filter(
    (q) =>
      revealed[q.question_number] &&
      answers[q.question_number] === q.correct_answer
  ).length;
  const allRevealed = total > 0 && answeredCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const progressPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;

  return (
    <div className="min-h-screen w-full bg-background text-foreground p-3 sm:p-6 lg:p-8">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[380px_1fr] lg:gap-8">
        {/* ===== Sidebar ===== */}
        <aside className="flex h-fit flex-col gap-7 rounded-3xl border border-border bg-secondary/60 p-6 sm:p-7 lg:sticky lg:top-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-foreground">
                Exam Generator
              </h1>
              <p className="text-xs text-muted-foreground">AI-powered MCQ drafting</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="topic"
                className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                {useBlueprint ? "Course / Exam name (optional)" : "Topic"}
              </Label>
              <Input
                id="topic"
                placeholder={
                  useBlueprint
                    ? "e.g. Ethiopian Exit Exam — Computer Science"
                    : "e.g. Data Structures"
                }
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="h-11 rounded-xl border-border bg-card px-4 text-sm focus-visible:ring-primary/30"
                required={!useBlueprint}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label
                  htmlFor="difficulty"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Difficulty
                </Label>
                <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                  <SelectTrigger
                    id="difficulty"
                    className="h-11 w-full rounded-xl border-border bg-card px-3 text-sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Beginner">Beginner</SelectItem>
                    <SelectItem value="Intermediate">Intermediate</SelectItem>
                    <SelectItem value="Advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="num"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Questions
                </Label>
                <Input
                  id="num"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  step={1}
                  className="h-11 rounded-xl border-border bg-card px-4 text-sm"
                  value={numQuestions === 0 ? "" : numQuestions}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      setNumQuestions(0);
                      return;
                    }
                    const n = parseInt(raw, 10);
                    if (Number.isNaN(n)) return;
                    setNumQuestions(Math.min(30, Math.max(0, n)));
                  }}
                  onBlur={() => {
                    if (!numQuestions || numQuestions < 1) setNumQuestions(1);
                  }}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
              <label htmlFor="auto" className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Auto-generate
                </span>
                <Switch id="auto" checked={autoGenerate} onCheckedChange={setAutoGenerate} />
              </label>
              <label htmlFor="shuffle" className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Shuffle className="h-3.5 w-3.5 text-muted-foreground" />
                  Shuffle choices
                </span>
                <Switch
                  id="shuffle"
                  checked={shuffleOptions}
                  onCheckedChange={setShuffleOptions}
                />
              </label>
              <label htmlFor="blueprint" className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ListChecks className="h-3.5 w-3.5 text-primary" />
                  Use exam blueprint
                </span>
                <Switch
                  id="blueprint"
                  checked={useBlueprint}
                  onCheckedChange={setUseBlueprint}
                />
              </label>
            </div>

            {useBlueprint && (
              <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Blueprint
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Subjects · objectives · weights
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
                      totalWeight === 100
                        ? "bg-emerald-500/15 text-emerald-700"
                        : "bg-amber-500/15 text-amber-700"
                    )}
                    title="Weights are normalized automatically"
                  >
                    Σ {totalWeight}%
                  </span>
                </div>

                <Select
                  value=""
                  onValueChange={(id) => {
                    const preset = BLUEPRINT_PRESETS.find((p) => p.id === id);
                    if (!preset) return;
                    setBlueprint(
                      preset.items.map((it) => ({ ...it, id: newBlueprintId() }))
                    );
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-border bg-background px-3 text-xs">
                    <SelectValue placeholder="Load Ethiopian Exit Exam preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {BLUEPRINT_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-medium">{p.label}</span>
                        <span className="ml-2 text-muted-foreground">· {p.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>


                <div className="space-y-3">
                  {blueprint.map((b, i) => {
                    const pct =
                      totalWeight > 0
                        ? Math.round((Math.max(0, b.weight) / totalWeight) * 100)
                        : 0;
                    return (
                      <div
                        key={b.id}
                        className="space-y-2 rounded-xl border border-border bg-background p-3"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            value={b.subject}
                            onChange={(e) =>
                              setBlueprint((prev) =>
                                prev.map((x, k) =>
                                  k === i ? { ...x, subject: e.target.value } : x
                                )
                              )
                            }
                            placeholder="Subject (e.g. Operating Systems)"
                            className="h-9 flex-1 rounded-lg border-border bg-card text-sm"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={blueprint.length <= 1}
                            onClick={() =>
                              setBlueprint((prev) => prev.filter((_, k) => k !== i))
                            }
                            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
                            aria-label="Remove subject"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <Textarea
                          value={b.objectives}
                          onChange={(e) =>
                            setBlueprint((prev) =>
                              prev.map((x, k) =>
                                k === i ? { ...x, objectives: e.target.value } : x
                              )
                            )
                          }
                          placeholder="Learning objectives (comma separated)"
                          rows={2}
                          className="rounded-lg border-border bg-card text-xs"
                        />

                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={b.weight}
                              onChange={(e) =>
                                setBlueprint((prev) =>
                                  prev.map((x, k) =>
                                    k === i
                                      ? { ...x, weight: parseInt(e.target.value, 10) }
                                      : x
                                  )
                                )
                              }
                              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                              aria-label={`${b.subject || "Subject"} weight`}
                            />
                          </div>
                          <div className="flex w-28 shrink-0 items-center justify-end gap-2 text-[11px] font-semibold text-muted-foreground">
                            <span className="tabular-nums">{b.weight}%</span>
                            <span className="text-muted-foreground/60">→</span>
                            <span className="tabular-nums text-foreground">
                              {pct}% · {counts[i] ?? 0}q
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={blueprint.length >= 8}
                    onClick={() =>
                      setBlueprint((prev) => [
                        ...prev,
                        {
                          id: newBlueprintId(),
                          subject: "",
                          objectives: "",
                          weight: 10,
                        },
                      ])
                    }
                    className="h-8 rounded-lg text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add subject
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const n = blueprint.length;
                      if (n === 0) return;
                      const even = Math.floor(100 / n);
                      const rem = 100 - even * n;
                      setBlueprint((prev) =>
                        prev.map((x, k) => ({
                          ...x,
                          weight: even + (k === 0 ? rem : 0),
                        }))
                      );
                    }}
                    className="h-8 rounded-lg text-xs text-muted-foreground"
                  >
                    Even weights
                  </Button>
                </div>
              </div>
            )}

            <Button
              type={autoGenerate ? "button" : "submit"}
              onClick={autoGenerate ? () => run() : undefined}
              disabled={
                mutation.isPending ||
                (!useBlueprint && !topic.trim()) ||
                (useBlueprint &&
                  !blueprint.some(
                    (b) => b.subject.trim().length > 0 && b.weight > 0
                  ))
              }
              className="h-12 w-full rounded-2xl bg-primary font-display font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : mutation.data ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate exam
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate exam
                </>
              )}
            </Button>
          </form>

          {total > 0 && (
            <div className="mt-1 border-t border-border/70 pt-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {allRevealed ? "Score" : "Progress"}
                </span>
                <span className="text-sm font-bold text-primary">
                  {allRevealed ? `${pct}%` : `${answeredCount}/${total}`}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${allRevealed ? pct : progressPct}%` }}
                />
              </div>
              {allRevealed && (
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-lg text-[11px] font-bold uppercase tracking-widest"
                    onClick={() => {
                      setReviewMode((r) => !r);
                      setReviewIndex(0);
                    }}
                  >
                    {reviewMode ? "Exit review" : "Review"}
                  </Button>
                  {correctCount < total && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 rounded-lg text-[11px] font-bold uppercase tracking-widest"
                      disabled={mutation.isPending}
                      onClick={() => {
                        const wrong = total - correctCount;
                        run(Math.max(1, Math.min(30, wrong)));
                      }}
                    >
                      <RefreshCw
                        className={cn(
                          "mr-1.5 h-3 w-3",
                          mutation.isPending && "animate-spin"
                        )}
                      />
                      Retake wrong
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ===== Main workspace ===== */}
        <main className="flex flex-col gap-5">
          {mutation.isError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </div>
          )}

          {mutation.isPending && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border bg-card py-24 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm">Drafting your exam…</p>
            </div>
          )}

          {!mutation.isPending && total === 0 && !mutation.isError && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border bg-card py-24 text-center text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-sm">
                {autoGenerate
                  ? "Start typing a topic — your exam appears here."
                  : "Set a topic and click Generate exam."}
              </p>
            </div>
          )}

          {!mutation.isPending && total > 0 && (
            <>
              {/* Progress dots */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {displayedQuestions.map((qq, i) => {
                  const answered = answers[qq.question_number] !== undefined;
                  const correct =
                    answered && answers[qq.question_number] === qq.correct_answer;
                  const idx = reviewMode ? reviewIndex : takingIndex;
                  const isCurrent = i === idx;
                  return (
                    <button
                      key={qq.question_number}
                      type="button"
                      onClick={() =>
                        reviewMode ? setReviewIndex(i) : setTakingIndex(i)
                      }
                      className={cn(
                        "h-2.5 shrink-0 rounded-full transition-all",
                        isCurrent ? "w-6" : "w-2.5",
                        !answered && "bg-muted",
                        answered && !reviewMode && !allRevealed && "bg-primary",
                        answered && (reviewMode || allRevealed) && correct && "bg-emerald-500",
                        answered && (reviewMode || allRevealed) && !correct && "bg-destructive"
                      )}
                      aria-label={`Question ${qq.question_number}`}
                    />
                  );
                })}
                <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">
                  {reviewMode ? "Review" : `${answeredCount}/${total} answered`}
                </span>
              </div>

              {reviewMode
                ? renderReviewCard()
                : renderTakingCard()}
            </>
          )}
        </main>
      </div>
    </div>
  );

  // ---- Card renderers ----
  function renderTakingCard() {
    const safeIndex = Math.min(takingIndex, total - 1);
    const q = displayedQuestions[safeIndex];
    const selected = answers[q.question_number];
    const isRevealed = revealed[q.question_number];
    const isCorrect = selected === q.correct_answer;

    return (
      <div className="flex flex-1 flex-col gap-6 rounded-[28px] border border-border bg-card p-6 shadow-sm sm:p-10">
        <div>
          <span className="mb-3 block font-display text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Question {String(safeIndex + 1).padStart(2, "0")} of{" "}
            {String(total).padStart(2, "0")}
          </span>
          <p className="text-base leading-relaxed text-foreground">
            {q.question}
          </p>
        </div>

        <div className="space-y-3">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === opt;
            const isAnswer = opt === q.correct_answer;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  if (isRevealed) return;
                  setAnswers((a) => ({ ...a, [q.question_number]: opt }));
                  setRevealed((r) => ({ ...r, [q.question_number]: true }));
                }}
                disabled={isRevealed}
                className={cn(
                  "group flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all sm:p-5",
                  "border-border bg-card hover:border-primary/40 hover:bg-primary/5",
                  isRevealed && "cursor-default",
                  isRevealed && isAnswer && "border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/10",
                  isRevealed && isSelected && !isAnswer && "border-destructive bg-destructive/10 hover:bg-destructive/10",
                  isRevealed && !isAnswer && !isSelected && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold transition-colors",
                    "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                    isRevealed && isAnswer && "bg-emerald-500 text-white group-hover:bg-emerald-500 group-hover:text-white",
                    isRevealed && isSelected && !isAnswer && "bg-destructive text-white group-hover:bg-destructive group-hover:text-white"
                  )}
                >
                  {letter}
                </span>
                <span className="flex-1 text-sm font-medium text-foreground sm:text-base">
                  {opt}
                </span>
                {isRevealed && isAnswer && (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                )}
                {isRevealed && isSelected && !isAnswer && (
                  <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                )}
              </button>
            );
          })}
        </div>

        {isRevealed && (
          <div
            className={cn(
              "animate-in fade-in slide-in-from-bottom-2 rounded-2xl border p-5",
              isCorrect
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            )}
          >
            <div
              className={cn(
                "mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider",
                isCorrect ? "text-emerald-700" : "text-amber-700"
              )}
            >
              {isCorrect ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
              {isCorrect ? "Correct" : `Answer: ${q.correct_answer}`}
            </div>
            <p
              className={cn(
                "text-sm leading-relaxed",
                isCorrect ? "text-emerald-900" : "text-amber-900"
              )}
            >
              {q.explanation}
            </p>
          </div>
        )}

        {allRevealed && (
          <div
            className={cn(
              "flex items-center gap-4 rounded-2xl border-2 p-5",
              pct >= 70
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
            )}
          >
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                pct >= 70
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-amber-500/15 text-amber-700"
              )}
            >
              <Trophy className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="font-display text-sm font-bold text-foreground">
                {pct >= 70 ? "Congratulations!" : "Keep practicing!"}
              </p>
              <p className="text-xs text-muted-foreground">
                You scored {correctCount}/{total} ({pct}%).
              </p>
            </div>
            <div
              className={cn(
                "rounded-xl px-3 py-1.5 font-display text-sm font-bold",
                pct >= 70 ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
              )}
            >
              {pct}%
            </div>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            disabled={safeIndex === 0}
            onClick={() => setTakingIndex((i) => Math.max(0, i - 1))}
            className="rounded-xl"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            disabled={safeIndex === total - 1}
            onClick={() => setTakingIndex((i) => Math.min(total - 1, i + 1))}
            className="rounded-xl bg-foreground font-display font-semibold text-background hover:bg-foreground/90"
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  function renderReviewCard() {
    const q = displayedQuestions[reviewIndex];
    const selected = answers[q.question_number];
    const isCorrect = selected === q.correct_answer;

    return (
      <div className="flex flex-1 flex-col gap-6 rounded-[28px] border border-border bg-card p-6 shadow-sm sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <span className="mb-3 block font-display text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Review · Question {String(reviewIndex + 1).padStart(2, "0")} of{" "}
              {String(total).padStart(2, "0")}
            </span>
            <p className="text-base leading-relaxed text-foreground">
              {q.question}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold",
              isCorrect
                ? "bg-emerald-500/15 text-emerald-700"
                : "bg-destructive/15 text-destructive"
            )}
          >
            {isCorrect ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {isCorrect ? "Correct" : "Incorrect"}
          </span>
        </div>

        <div className="space-y-3">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === opt;
            const isAnswer = opt === q.correct_answer;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border-2 p-4 sm:p-5",
                  "border-border",
                  isAnswer && "border-emerald-500 bg-emerald-500/10",
                  isSelected && !isAnswer && "border-destructive bg-destructive/10",
                  !isAnswer && !isSelected && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold",
                    "bg-muted text-muted-foreground",
                    isAnswer && "bg-emerald-500 text-white",
                    isSelected && !isAnswer && "bg-destructive text-white"
                  )}
                >
                  {letter}
                </span>
                <span className="flex-1 text-sm font-medium text-foreground sm:text-base">
                  {opt}
                </span>
                {isAnswer && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                {isSelected && !isAnswer && (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-border bg-secondary/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Info className="h-4 w-4" />
            Explanation
          </div>
          <p className="text-sm leading-relaxed text-foreground">{q.explanation}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            disabled={reviewIndex === 0}
            onClick={() => setReviewIndex((i) => Math.max(0, i - 1))}
            className="rounded-xl"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="ghost"
            onClick={() => setReviewMode(false)}
            className="rounded-xl"
          >
            Exit review
          </Button>
          <Button
            disabled={reviewIndex === total - 1}
            onClick={() => setReviewIndex((i) => Math.min(total - 1, i + 1))}
            className="rounded-xl bg-foreground font-display font-semibold text-background hover:bg-foreground/90"
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
}
