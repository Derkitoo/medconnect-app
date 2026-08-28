import { getDb } from "../../../db";

const validToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(value);
const validAccessKey = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(value);
const hashAccessKey = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const parisMinutesNow = () => {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
};
const doseMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

type Dose = {
  id: string;
  time: string;
  label: string;
  detail: string;
  status: "confirmed" | "pending" | "upcoming" | "missed" | "refused";
  stock: number;
  unitsPerBox: number;
  lowStockThreshold: number;
  stockUpdatedAt: string;
};
type HistoryEvent = {
  id: string;
  doseId: string;
  label: string;
  scheduledTime: string;
  confirmedAt: string;
  outcome?: "taken" | "missed" | "refused" | "postponed";
};
type Settings = { alertDelay: 15 | 30 | 60 };
type PatientProfile = {
  firstName: string;
  lastName: string;
  birthDate: string;
  phone: string;
  emergencyName: string;
  emergencyPhone: string;
  notes: string;
  updatedAt: string;
};
type HelpRequest = { requestedAt: string } | null;
type PatientReminder = { doseId: string; requestedAt: string; message: string } | null;
type PilotFeedback = {
  id: string;
  day: 1 | 7 | 14;
  role: "patient" | "aidant";
  ease: number;
  confidence: number;
  continueUse: boolean;
  note: string;
  createdAt: string;
};
type PilotIssue = {
  id: string;
  role: "patient" | "aidant";
  note: string;
  createdAt: string;
};
type Pilot = {
  startedAt: string | null;
  feedback: PilotFeedback[];
  issues: PilotIssue[];
};
type PrescriptionItem = {
  id: string;
  name: string;
  dosage: string;
  quantity: number;
  time: string;
  stock: number;
  confidence: "high" | "medium" | "low";
  reviewed: boolean;
  form: string;
  mealTiming: "none" | "before" | "during" | "after";
  days: number[];
  startDate: string;
  endDate: string;
  asNeeded: boolean;
  times: string[];
  frequencyText: string;
  durationText: string;
  cis: string;
  officialName: string;
  activeSubstances: string;
  administrationRoute: string;
  commercialStatus: string;
  officialPresentation: string;
};
type Prescription = {
  id: string;
  status: "draft" | "validated";
  issuedAt: string;
  validUntil: string;
  prescriber: string;
  notes: string;
  items: PrescriptionItem[];
  updatedAt: string;
} | null;
const defaults: Dose[] = [
  {
    id: "morning",
    time: "08:00",
    label: "Matin",
    detail: "2 médicaments · après le petit-déjeuner",
    status: "pending",
    stock: 14,
  },
  {
    id: "noon",
    time: "13:00",
    label: "Midi",
    detail: "1 médicament · pendant le repas",
    status: "upcoming",
    stock: 14,
  },
  {
    id: "evening",
    time: "20:00",
    label: "Soir",
    detail: "2 médicaments · après le dîner",
    status: "upcoming",
    stock: 14,
  },
];

function validDoses(value: unknown): value is Dose[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 12 &&
    value.every(
      (dose) =>
        dose &&
        typeof dose.id === "string" &&
        dose.id.length <= 64 &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(dose.time) &&
        typeof dose.label === "string" &&
        dose.label.length > 0 &&
        dose.label.length <= 40 &&
        typeof dose.detail === "string" &&
        dose.detail.length <= 100 &&
        ["confirmed", "pending", "upcoming", "missed", "refused"].includes(
          dose.status,
        ) &&
        typeof dose.stock === "number" && Number.isFinite(dose.stock) &&
        dose.stock >= 0 &&
        dose.stock <= 999,
    )
  );
}

function validHistory(value: unknown): value is HistoryEvent[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (event) =>
        event &&
        typeof event.id === "string" &&
        event.id.length <= 64 &&
        typeof event.doseId === "string" &&
        event.doseId.length <= 64 &&
        typeof event.label === "string" &&
        event.label.length <= 40 &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(event.scheduledTime) &&
        typeof event.confirmedAt === "string" &&
        event.confirmedAt.length <= 40 &&
        (event.outcome === undefined ||
          ["taken", "missed", "refused", "postponed"].includes(event.outcome)),
    )
  );
}

const validSettings = (value: unknown): value is Settings =>
  !!value &&
  typeof value === "object" &&
  [15, 30, 60].includes((value as Settings).alertDelay);
const validProfile = (value: unknown): value is PatientProfile => {
  if (!value || typeof value !== "object") return false;
  const profile = value as PatientProfile;
  return (
    typeof profile.firstName === "string" && profile.firstName.length <= 50 &&
    typeof profile.lastName === "string" && profile.lastName.length <= 60 &&
    typeof profile.birthDate === "string" && profile.birthDate.length <= 20 &&
    typeof profile.phone === "string" && profile.phone.length <= 30 &&
    typeof profile.emergencyName === "string" && profile.emergencyName.length <= 80 &&
    typeof profile.emergencyPhone === "string" && profile.emergencyPhone.length <= 30 &&
    typeof profile.notes === "string" && profile.notes.length <= 300 &&
    typeof profile.updatedAt === "string" && profile.updatedAt.length <= 40
  );
};
const validHelp = (value: unknown): value is HelpRequest =>
  value === null ||
  (!!value &&
    typeof value === "object" &&
    typeof (value as { requestedAt?: unknown }).requestedAt === "string" &&
    (value as { requestedAt: string }).requestedAt.length <= 40);
const validPatientReminder = (value: unknown): value is PatientReminder => {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const reminder = value as NonNullable<PatientReminder>;
  return typeof reminder.doseId === "string" && reminder.doseId.length <= 64 &&
    typeof reminder.requestedAt === "string" && reminder.requestedAt.length <= 40 &&
    typeof reminder.message === "string" && reminder.message.length <= 120;
};
const validPilot = (value: unknown): value is Pilot => {
  if (!value || typeof value !== "object") return false;
  const pilot = value as Pilot;
  const feedbackOk =
    Array.isArray(pilot.feedback) &&
    pilot.feedback.length <= 12 &&
    pilot.feedback.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        [1, 7, 14].includes(item.day) &&
        ["patient", "aidant"].includes(item.role) &&
        Number.isInteger(item.ease) &&
        item.ease >= 1 &&
        item.ease <= 5 &&
        Number.isInteger(item.confidence) &&
        item.confidence >= 1 &&
        item.confidence <= 5 &&
        typeof item.continueUse === "boolean" &&
        typeof item.note === "string" &&
        item.note.length <= 500 &&
        typeof item.createdAt === "string",
    );
  const issuesOk =
    Array.isArray(pilot.issues) &&
    pilot.issues.length <= 50 &&
    pilot.issues.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        ["patient", "aidant"].includes(item.role) &&
        typeof item.note === "string" &&
        item.note.length > 0 &&
        item.note.length <= 500 &&
        typeof item.createdAt === "string",
    );
  return (
    (pilot.startedAt === null || typeof pilot.startedAt === "string") &&
    feedbackOk &&
    issuesOk
  );
};
const validPrescription = (value: unknown): value is Prescription => {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const prescription = value as Prescription;
  return (
    typeof prescription.id === "string" &&
    ["draft", "validated"].includes(prescription.status) &&
    typeof prescription.issuedAt === "string" &&
    prescription.issuedAt.length <= 20 &&
    typeof prescription.validUntil === "string" &&
    prescription.validUntil.length <= 20 &&
    typeof prescription.prescriber === "string" &&
    prescription.prescriber.length <= 80 &&
    typeof prescription.notes === "string" &&
    prescription.notes.length <= 500 &&
    typeof prescription.updatedAt === "string" &&
    Array.isArray(prescription.items) &&
    prescription.items.length > 0 &&
    prescription.items.length <= 20 &&
    prescription.items.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        item.name.length > 0 &&
        item.name.length <= 80 &&
        typeof item.dosage === "string" &&
        item.dosage.length <= 80 &&
        typeof item.quantity === "number" &&
        Number.isFinite(item.quantity) &&
        item.quantity >= 0.25 &&
        item.quantity <= 20 &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) &&
        typeof item.stock === "number" && Number.isFinite(item.stock) &&
        item.stock >= 0 &&
        item.stock <= 999 &&
        Number.isInteger(item.unitsPerBox) && item.unitsPerBox >= 1 && item.unitsPerBox <= 500 &&
        Number.isInteger(item.lowStockThreshold) && item.lowStockThreshold >= 0 && item.lowStockThreshold <= 500 &&
        typeof item.stockUpdatedAt === "string" && item.stockUpdatedAt.length <= 40 &&
        ["high", "medium", "low"].includes(item.confidence) &&
        typeof item.reviewed === "boolean" &&
        typeof item.form === "string" &&
        item.form.length > 0 &&
        item.form.length <= 40 &&
        ["none", "before", "during", "after"].includes(item.mealTiming) &&
        Array.isArray(item.days) &&
        item.days.length > 0 &&
        item.days.length <= 7 &&
        item.days.every(
          (day) => Number.isInteger(day) && day >= 0 && day <= 6,
        ) &&
        typeof item.startDate === "string" &&
        item.startDate.length <= 20 &&
        typeof item.endDate === "string" &&
        item.endDate.length <= 20 &&
        typeof item.asNeeded === "boolean" &&
        Array.isArray(item.times) &&
        item.times.length <= 6 &&
        (item.asNeeded || item.times.length > 0) &&
        item.times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) &&
        typeof item.frequencyText === "string" &&
        item.frequencyText.length <= 100 &&
        typeof item.durationText === "string" &&
        item.durationText.length <= 100 &&
        typeof item.cis === "string" && item.cis.length <= 20 &&
        typeof item.officialName === "string" && item.officialName.length <= 200 &&
        typeof item.activeSubstances === "string" && item.activeSubstances.length <= 300 &&
        typeof item.administrationRoute === "string" && item.administrationRoute.length <= 100 &&
        typeof item.commercialStatus === "string" && item.commercialStatus.length <= 80 &&
        typeof item.officialPresentation === "string" && item.officialPresentation.length <= 300,
    )
  );
};

const normalizePrescription = (
  item: NonNullable<Prescription>,
): NonNullable<Prescription> => ({
  ...item,
  validUntil: item.validUntil ?? "",
  items: item.items.map((line) => ({
    ...line,
    confidence: line.confidence ?? "high",
    reviewed: line.reviewed ?? item.status === "validated",
    form: line.form ?? "comprimé",
    unitsPerBox: Number.isInteger(line.unitsPerBox) ? line.unitsPerBox : 30,
    lowStockThreshold: Number.isInteger(line.lowStockThreshold) ? line.lowStockThreshold : 7,
    stockUpdatedAt: line.stockUpdatedAt ?? new Date().toISOString(),
    mealTiming: line.mealTiming ?? "none",
    days:
      Array.isArray(line.days) && line.days.length > 0
        ? line.days
        : [0, 1, 2, 3, 4, 5, 6],
    startDate: line.startDate ?? item.issuedAt,
    endDate: line.endDate ?? item.validUntil,
    asNeeded: line.asNeeded ?? false,
    times:
      Array.isArray(line.times) && line.times.length > 0
        ? line.times
        : line.asNeeded
          ? []
          : [line.time],
    frequencyText: line.frequencyText ?? "",
    durationText: line.durationText ?? "",
    cis: line.cis ?? "",
    officialName: line.officialName ?? "",
    activeSubstances: line.activeSubstances ?? "",
    administrationRoute: line.administrationRoute ?? "",
    commercialStatus: line.commercialStatus ?? "",
    officialPresentation: line.officialPresentation ?? "",
  })),
});

async function ensureFamily(token: string) {
  const db = getDb();
  await db
    .prepare(
      "INSERT OR IGNORE INTO families (token, morning_confirmed, updated_at) VALUES (?, 0, ?)",
    )
    .bind(token, Date.now())
    .run();
  return db;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const accessKey = url.searchParams.get("access");
  if (!validToken(token))
    return Response.json({ error: "Lien familial invalide." }, { status: 400 });
  try {
    const db = await ensureFamily(token);
    const row = await db
      .prepare(
        "SELECT morning_confirmed, state_json, updated_at FROM families WHERE token = ?",
      )
      .bind(token)
      .first<{
        morning_confirmed: number;
        state_json: string | null;
        updated_at: number;
      }>();
    let stored = row?.state_json ? JSON.parse(row.state_json) : null;
    if (accessKey) {
      if (!validAccessKey(accessKey))
        return Response.json({ error: "Accès Aidant invalide." }, { status: 403 });
      const accessHash = await hashAccessKey(accessKey);
      if (stored?.caregiverAccessHash && stored.caregiverAccessHash !== accessHash)
        return Response.json({ error: "Accès Aidant refusé." }, { status: 403 });
      if (!stored?.caregiverAccessHash) {
        stored = { ...(stored && !Array.isArray(stored) ? stored : {}), caregiverAccessHash: accessHash };
        await db.prepare("UPDATE families SET state_json = ?, updated_at = ? WHERE token = ?")
          .bind(JSON.stringify(stored), Date.now(), token).run();
      }
    }
    const rawDoses = Array.isArray(stored)
      ? stored
      : (stored?.doses ??
        defaults.map((dose, index) =>
          index === 0 && row?.morning_confirmed === 1
            ? { ...dose, status: "confirmed" }
            : dose,
        ));
    const doses = rawDoses.map((dose: Dose) => ({
      ...dose,
      stock: typeof dose.stock === "number" && Number.isFinite(dose.stock) ? dose.stock : 14,
    }));
    const history = Array.isArray(stored) ? [] : (stored?.history ?? []);
    const settings = Array.isArray(stored)
      ? { alertDelay: 30 }
      : (stored?.settings ?? { alertDelay: 30 });
    const help = Array.isArray(stored) ? null : (stored?.help ?? null);
    const pilot = Array.isArray(stored)
      ? { startedAt: null, feedback: [], issues: [] }
      : (stored?.pilot ?? { startedAt: null, feedback: [], issues: [] });
    const rawPrescription = Array.isArray(stored)
      ? null
      : (stored?.prescription ?? null);
    const prescription = rawPrescription
      ? normalizePrescription(rawPrescription)
      : null;
    const prescriptionHistory = Array.isArray(stored)
      ? []
      : (stored?.prescriptionHistory ?? []).map(
          (item: NonNullable<Prescription>) => normalizePrescription(item),
        );
    const profile = Array.isArray(stored)
      ? { firstName: "", lastName: "", birthDate: "", phone: "", emergencyName: "", emergencyPhone: "", notes: "", updatedAt: "" }
      : (stored?.profile ?? { firstName: "", lastName: "", birthDate: "", phone: "", emergencyName: "", emergencyPhone: "", notes: "", updatedAt: "" });
    const patientReminder = Array.isArray(stored) ? null : (stored?.patientReminder ?? null);
    return Response.json({
      doses,
      history,
      settings,
      help,
      pilot,
      prescription,
      prescriptionHistory: accessKey ? prescriptionHistory : [],
      profile: accessKey
        ? profile
        : { firstName: profile.firstName, lastName: "", birthDate: "", phone: "", emergencyName: "", emergencyPhone: "", notes: "", updatedAt: profile.updatedAt },
      access: accessKey ? "aidant" : "patient",
      patientReminder,
      updatedAt: row?.updated_at ?? Date.now(),
    });
  } catch {
    return Response.json(
      { error: "Synchronisation indisponible." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      doses?: Dose[];
      history?: HistoryEvent[];
      settings?: Settings;
      help?: HelpRequest;
      pilot?: Pilot;
      prescription?: Prescription;
      prescriptionHistory?: NonNullable<Prescription>[];
      profile?: PatientProfile;
      accessKey?: string;
      patientReminder?: PatientReminder;
    };
    if (
      !validToken(body.token) ||
      !validAccessKey(body.accessKey) ||
      !validDoses(body.doses) ||
      !validHistory(body.history) ||
      !validSettings(body.settings) ||
      !validHelp(body.help) ||
      !validPatientReminder(body.patientReminder) ||
      !validPilot(body.pilot) ||
      !validPrescription(body.prescription) ||
      !validProfile(body.profile) ||
      !Array.isArray(body.prescriptionHistory) ||
      body.prescriptionHistory.length > 10 ||
      !body.prescriptionHistory.every((item) => validPrescription(item))
    )
      return Response.json({ error: "Demande invalide." }, { status: 400 });
    const db = await ensureFamily(body.token);
    const current = await db.prepare("SELECT state_json FROM families WHERE token = ?")
      .bind(body.token).first<{ state_json: string | null }>();
    const currentState = current?.state_json ? JSON.parse(current.state_json) : {};
    if (!currentState?.caregiverAccessHash || currentState.caregiverAccessHash !== await hashAccessKey(body.accessKey))
      return Response.json({ error: "Accès Aidant refusé." }, { status: 403 });
    const currentDoses: Dose[] = Array.isArray(currentState.doses) ? currentState.doses : [];
    const earlyConfirmation = body.doses.some((dose) => {
      const previous = currentDoses.find((item) => item.id === dose.id);
      return dose.status === "confirmed" && previous?.status !== "confirmed" && doseMinutes(dose.time) > parisMinutesNow();
    });
    if (earlyConfirmation)
      return Response.json({ error: "Une prise ne peut pas être confirmée avant son horaire." }, { status: 409 });
    const updatedAt = Date.now();
    await db
      .prepare(
        "UPDATE families SET state_json = ?, morning_confirmed = ?, updated_at = ? WHERE token = ?",
      )
      .bind(
        JSON.stringify({
          doses: body.doses,
          history: body.history.slice(0, 100),
          settings: body.settings,
          help: body.help,
          pilot: body.pilot,
          prescription: body.prescription,
          prescriptionHistory: body.prescriptionHistory,
          profile: body.profile,
          caregiverAccessHash: currentState.caregiverAccessHash,
          patientReminder: body.patientReminder,
        }),
        body.doses[0]?.status === "confirmed" ? 1 : 0,
        updatedAt,
        body.token,
      )
      .run();
    return Response.json({
      doses: body.doses,
      history: body.history,
      settings: body.settings,
      help: body.help,
      pilot: body.pilot,
      prescription: body.prescription,
      prescriptionHistory: body.prescriptionHistory,
      profile: body.profile,
      patientReminder: body.patientReminder,
      updatedAt,
    });
  } catch {
    return Response.json(
      { error: "Synchronisation indisponible." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { token?: string; action?: string; doseId?: string; pilot?: Pilot };
    if (!validToken(body.token) || !["confirm", "request_help", "save_pilot"].includes(body.action || ""))
      return Response.json({ error: "Demande invalide." }, { status: 400 });
    const db = await ensureFamily(body.token);
    const row = await db.prepare("SELECT state_json FROM families WHERE token = ?")
      .bind(body.token).first<{ state_json: string | null }>();
    const state = row?.state_json ? JSON.parse(row.state_json) : null;
    if (!state || Array.isArray(state))
      return Response.json({ error: "Espace familial incomplet." }, { status: 409 });
    if (body.action === "request_help") state.help = { requestedAt: new Date().toISOString() };
    if (body.action === "save_pilot") {
      if (!validPilot(body.pilot))
        return Response.json({ error: "Retour pilote invalide." }, { status: 400 });
      const currentPilot: Pilot = state.pilot ?? { startedAt: null, feedback: [], issues: [] };
      state.pilot = {
        startedAt: currentPilot.startedAt ?? body.pilot.startedAt,
        feedback: [
          ...currentPilot.feedback.filter((item) => item.role === "aidant"),
          ...body.pilot.feedback.filter((item) => item.role === "patient"),
        ].slice(0, 12),
        issues: [
          ...currentPilot.issues.filter((item) => item.role === "aidant"),
          ...body.pilot.issues.filter((item) => item.role === "patient"),
        ].slice(0, 50),
      };
    }
    if (body.action === "confirm") {
      const dose = Array.isArray(state.doses) ? state.doses.find((item: Dose) => item.id === body.doseId) : null;
      if (!dose || dose.status === "confirmed")
        return Response.json({ error: "Prise introuvable." }, { status: 404 });
      if (doseMinutes(dose.time) > parisMinutesNow())
        return Response.json({ error: `Confirmation disponible à ${dose.time}.` }, { status: 409 });
      dose.status = "confirmed";
      if (state.prescription?.items) {
        state.prescription.items = state.prescription.items.map((item: PrescriptionItem) =>
          !item.asNeeded && item.times.includes(dose.time)
            ? { ...item, stock: Math.max(0, item.stock - item.quantity), stockUpdatedAt: new Date().toISOString() }
            : item,
        );
        const related = state.prescription.items.filter((item: PrescriptionItem) => !item.asNeeded && item.times.includes(dose.time));
        dose.stock = related.length ? Math.floor(Math.min(...related.map((item: PrescriptionItem) => item.stock))) : Math.max(0, dose.stock - 1);
      } else dose.stock = Math.max(0, dose.stock - 1);
      if (state.patientReminder?.doseId === dose.id) state.patientReminder = null;
      state.history = [{
        id: crypto.randomUUID(), doseId: dose.id, label: dose.label,
        scheduledTime: dose.time, confirmedAt: new Date().toISOString(), outcome: "taken",
      }, ...(Array.isArray(state.history) ? state.history : [])].slice(0, 100);
    }
    const updatedAt = Date.now();
    await db.prepare("UPDATE families SET state_json = ?, morning_confirmed = ?, updated_at = ? WHERE token = ?")
      .bind(JSON.stringify(state), state.doses?.[0]?.status === "confirmed" ? 1 : 0, updatedAt, body.token).run();
    return Response.json({ ok: true, updatedAt });
  } catch {
    return Response.json({ error: "Synchronisation indisponible." }, { status: 503 });
  }
}
