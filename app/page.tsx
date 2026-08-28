"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type Role = "patient" | "aidant";
type Status = "confirmed" | "pending" | "upcoming" | "missed" | "refused";
type Dose = {
  id: string;
  time: string;
  label: string;
  detail: string;
  status: Status;
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
type Tab = "today" | "medications" | "treatments" | "history" | "pilot" | "prescription" | "profile";
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
  role: Role;
  ease: number;
  confidence: number;
  continueUse: boolean;
  note: string;
  createdAt: string;
};
type PilotIssue = { id: string; role: Role; note: string; createdAt: string };
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
  unitsPerBox: number;
  lowStockThreshold: number;
  stockUpdatedAt: string;
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
type MedicationResult = {
  cis: string; name: string; form: string; routes: string[]; status: string;
  substances: string[]; presentation: string;
};

async function searchMedicationDatabase(queryValue: string): Promise<MedicationResult[]> {
  const query = queryValue.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 '/.-]+/g, " ").trim().split(/\s+/).slice(0, 6).join(" ");
  const response = await fetch(`/api/medications?q=${encodeURIComponent(query)}`);
  if (response.ok) {
    const data = await response.json() as { results?: MedicationResult[] };
    return data.results ?? [];
  }
  const direct = await fetch(`https://medicaments-api.giygas.dev/v1/medicaments?search=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
  if (!direct.ok) throw new Error("La base ne répond pas. Réessayez dans quelques instants.");
  const raw = await direct.json() as Array<{ cis?: number | string; elementPharmaceutique?: string; formePharmaceutique?: string; voiesAdministration?: string[]; etatComercialisation?: string; composition?: Array<{ denominationSubstance?: string }>; presentation?: Array<{ libelle?: string }> }>;
  return (Array.isArray(raw) ? raw : []).filter((line) => line.cis && line.elementPharmaceutique).sort((a, b) => Number(b.etatComercialisation === "Commercialisée") - Number(a.etatComercialisation === "Commercialisée")).slice(0, 8).map((line) => ({ cis: String(line.cis), name: line.elementPharmaceutique ?? "", form: line.formePharmaceutique ?? "", routes: line.voiesAdministration ?? [], status: line.etatComercialisation ?? "", substances: [...new Set((line.composition ?? []).map((part) => part.denominationSubstance).filter((value): value is string => Boolean(value)))].slice(0, 6), presentation: line.presentation?.find((part) => part.libelle)?.libelle ?? "" }));
}
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

const initialDoses: Dose[] = [
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
const statusText = {
  confirmed: "Confirmée",
  pending: "À prendre",
  upcoming: "À venir",
  missed: "Oubliée",
  refused: "Refusée",
};
const statusColor = {
  confirmed: "bg-[#2e9b6c]",
  pending: "bg-[#e5a72e]",
  upcoming: "bg-[#cbd7d2]",
  missed: "bg-[#e5a72e]",
  refused: "bg-[#c76565]",
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const QUANTITY_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 20];
const quantityLabel = (quantity: number) =>
  quantity === 0.25
    ? "¼"
    : quantity === 0.5
      ? "½"
      : quantity === 0.75
        ? "¾"
      : String(quantity).replace(".", ",");
const officialNoticeUrl = (cis: string) =>
  `https://base-donnees-publique.medicaments.gouv.fr/affichageDoc.php?specid=${encodeURIComponent(cis)}&typedoc=N`;
const endDateFromDuration = (startDate: string, duration: string) => {
  const match = duration.match(/(?:pendant\s+)?(\d+)\s*(jour|semaine|mois)/i);
  if (!match) return new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const date = new Date(`${startDate}T12:00:00`);
  const amount = Number(match[1]);
  if (/jour/i.test(match[2])) date.setDate(date.getDate() + Math.max(0, amount - 1));
  else if (/semaine/i.test(match[2])) date.setDate(date.getDate() + amount * 7 - 1);
  else date.setMonth(date.getMonth() + amount);
  return date.toISOString().slice(0, 10);
};

function Brand({ role, patientName }: { role: Role; patientName: string }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-2xl shadow-sm" />
      <div>
        <p className="text-xl font-black tracking-[-.03em]">MedConnect</p>
        <p className="text-xs font-semibold text-[#60766e]">
          Bonjour {role === "patient" ? patientName : "Aidant"}
        </p>
      </div>
    </div>
  );
}

function DoseList({
  doses,
  onConfirm,
  onEdit,
  onDelete,
  onOutcome,
}: {
  doses: Dose[];
  onConfirm?: (id: string) => void;
  onEdit?: (dose: Dose) => void;
  onDelete?: (dose: Dose) => void;
  onOutcome?: (dose: Dose, outcome: "missed" | "refused" | "postponed") => void;
}) {
  return (
    <div className="rounded-3xl border border-[#dce7e2] bg-white p-2 shadow-sm">
      {doses.map((dose, index) => (
        <div
          key={dose.id}
          className={`flex items-center gap-4 p-4 ${index < doses.length - 1 ? "border-b border-[#edf2ef]" : ""}`}
        >
          <span
            className={`h-3 w-3 shrink-0 rounded-full ${statusColor[dose.status]}`}
          />
          <div className="w-14">
            <p className="text-lg font-black">{dose.time}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">{dose.label}</p>
            <p className="mt-0.5 break-words text-xs font-medium leading-relaxed text-[#71847d]">
              {dose.detail}
            </p>
            {onEdit && (
              <p
                className={`mt-1 text-xs font-bold ${dose.stock <= 3 ? "text-[#a84747]" : "text-[#71847d]"}`}
              >
                Stock : {dose.stock} prise{dose.stock > 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-[#61776f]">
              {statusText[dose.status]}
            </p>
            {onEdit && (
              <details className="relative">
                <summary
                  aria-label={`Actions pour ${dose.label}`}
                  className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full text-lg font-black tracking-widest text-[#71847d] transition hover:bg-[#edf5f1]"
                >
                  •••
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-2xl border border-[#dce7e2] bg-white p-2 text-left shadow-[0_14px_40px_rgba(23,54,45,.16)]">
                  {onConfirm && dose.status !== "confirmed" && (
                    <button
                      onClick={() => onConfirm(dose.id)}
                      className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-[#176b50] hover:bg-[#edf5f1]"
                    >
                      Marquer comme prise
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(dose)}
                    className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-[#37554b] hover:bg-[#edf5f1]"
                  >
                    Modifier la prise
                  </button>
                  {dose.status !== "confirmed" && onOutcome && (
                    <>
                      <button
                        onClick={() => onOutcome(dose, "postponed")}
                        className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-[#37554b] hover:bg-[#edf5f1]"
                      >
                        Reporter l’horaire
                      </button>
                      <button
                        onClick={() => onOutcome(dose, "missed")}
                        className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-[#865e19] hover:bg-[#fff5dd]"
                      >
                        Marquer comme oubliée
                      </button>
                      <button
                        onClick={() => onOutcome(dose, "refused")}
                        className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-[#a84747] hover:bg-[#fff0eb]"
                      >
                        Marquer comme refusée
                      </button>
                    </>
                  )}
                  <div className="my-1 border-t border-[#edf2ef]" />
                  <button
                    onClick={() => onDelete?.(dose)}
                    className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-[#a84747] hover:bg-[#fff0eb]"
                  >
                    Supprimer définitivement
                  </button>
                </div>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function MedicationVisual({ form, small = false }: { form: string; small?: boolean }) {
  const value = form.toLowerCase();
  const size = small ? "h-9 w-9" : "h-12 w-12";
  if (value.includes("gélule") || value.includes("capsule"))
    return <span aria-hidden className={`grid ${size} place-items-center rounded-2xl bg-[#edf5f1]`}><span className="h-4 w-7 rotate-[-25deg] rounded-full bg-[linear-gradient(90deg,#176b50_50%,#d8f36a_50%)] shadow-sm" /></span>;
  if (value.includes("solution") || value.includes("sirop") || value.includes("ml"))
    return <span aria-hidden className={`grid ${size} place-items-center rounded-2xl bg-[#e8f3fa] text-xl`}>💧</span>;
  if (value.includes("sachet") || value.includes("poudre"))
    return <span aria-hidden className={`grid ${size} place-items-center rounded-2xl bg-[#fff5dd] text-xl`}>▱</span>;
  return <span aria-hidden className={`grid ${size} place-items-center rounded-2xl bg-[#edf5f1]`}><span className="h-5 w-5 rounded-full border-2 border-[#176b50] bg-white shadow-sm" /></span>;
}

function VirtualPillbox({ doses, prescription }: { doses: Dose[]; prescription: Prescription }) {
  return (
    <div className="rounded-[2rem] bg-[#17362d] p-5 text-white shadow-[0_18px_45px_rgba(23,54,45,.16)]">
      <div className="flex items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[.14em] text-[#b9d6ca]">Pilulier virtuel</p><h2 className="mt-1 text-2xl font-black">Ma journée</h2></div>
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-black">{doses.length} compartiment{doses.length > 1 ? "s" : ""}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {doses.map((dose) => {
          const medicines = prescription?.items.filter((item) => !item.asNeeded && item.times.includes(dose.time)) ?? [];
          const tone = dose.status === "confirmed" ? "border-[#79c79f] bg-[#246c53]" : dose.status === "upcoming" ? "border-white/10 bg-white/5" : dose.status === "missed" || dose.status === "refused" ? "border-[#ef8d73] bg-[#6b3b32]" : "border-[#d8f36a] bg-white/10";
          return <details key={dose.id} className={`rounded-2xl border p-4 ${tone}`}>
            <summary className="cursor-pointer list-none">
              <span className="flex items-center justify-between"><span className="text-2xl font-black">{dose.time}</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-black">{statusText[dose.status]}</span></span>
              <span className="mt-2 block text-sm font-bold text-[#d5e4de]">{medicines.length || 1} médicament{medicines.length > 1 ? "s" : ""} · voir le contenu</span>
            </summary>
            <div className="mt-3 space-y-2 border-t border-white/15 pt-3">
              {medicines.length ? medicines.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-white/10 p-3"><MedicationVisual form={item.form} small /><div><p className="font-black">{item.name}</p><p className="text-xs font-bold text-[#d5e4de]">{quantityLabel(item.quantity)} {item.form} · {item.dosage}</p></div></div>) : <p className="text-sm font-medium text-[#d5e4de]">{dose.detail}</p>}
            </div>
          </details>;
        })}
      </div>
      <p className="mt-4 text-xs font-bold text-[#b9d6ca]">Représentation indicative du programme. Vérifiez toujours le nom et le dosage.</p>
    </div>
  );
}

function PatientView({
  doses,
  confirm,
  reminders,
  enableReminders,
  toggleReminders,
  help,
  requestHelp,
  prescription,
  patientName,
  readOnlyPreview,
  patientReminder,
}: {
  doses: Dose[];
  confirm: (id: string) => void;
  reminders: boolean;
  enableReminders: () => void;
  toggleReminders: () => void;
  help: HelpRequest;
  requestHelp: () => void;
  prescription: Prescription;
  patientName: string;
  readOnlyPreview: boolean;
  patientReminder: PatientReminder;
}) {
  const [showUpcoming, setShowUpcoming] = useState(false);
  const announcedReminder = useRef("");
  const next = doses.find((d) => ["pending", "upcoming"].includes(d.status));
  const upcomingDoses = doses.filter(
    (dose) => dose.status === "upcoming" && dose.id !== next?.id,
  );
  const done = doses.filter((d) => d.status === "confirmed").length;
  const exceptions = doses.filter((d) =>
    ["missed", "refused"].includes(d.status),
  ).length;
  const awaitingSchedule = prescription?.status === "draft";
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nextMinutes = next ? Number(next.time.slice(0, 2)) * 60 + Number(next.time.slice(3)) : 0;
  const canConfirmNow = Boolean(next && nowMinutes >= nextMinutes);
  const medicinesForNext = prescription?.items.filter(
    (item) => !item.asNeeded && item.times.includes(next?.time || ""),
  ) ?? [];
  useEffect(() => {
    if (!patientReminder || readOnlyPreview || announcedReminder.current === patientReminder.requestedAt) return;
    announcedReminder.current = patientReminder.requestedAt;
    if (typeof navigator !== "undefined" && "vibrate" in navigator)
      navigator.vibrate?.([500, 200, 500, 200, 800]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted")
      new Notification("MedConnect — Rappel de votre aidant", { body: patientReminder.message, icon: "/favicon.svg" });
  }, [patientReminder, readOnlyPreview]);
  return (
    <section className="mx-auto max-w-lg px-5 pb-40">
      {readOnlyPreview && (
        <div className="mb-4 rounded-2xl border border-[#90c8ae] bg-[#e2f5ea] p-4 text-sm font-bold text-[#176b50]">
          Aperçu Aidant : vous voyez exactement l’écran du patient. Les actions Patient sont désactivées dans cet aperçu.
        </div>
      )}
      {patientReminder && !readOnlyPreview && (
        <div className="mb-5 animate-pulse rounded-[2rem] border-2 border-[#ef8d73] bg-[#fff0eb] p-5 text-center shadow-[0_16px_40px_rgba(169,70,48,.16)]">
          <p className="text-sm font-black uppercase tracking-[.12em] text-[#a94630]">Rappel de votre aidant</p>
          <p className="mt-2 text-2xl font-black text-[#7d3524]">{patientReminder.message}</p>
          <p className="mt-2 text-sm font-bold text-[#9b5848]">Confirmez uniquement après avoir réellement pris vos médicaments.</p>
        </div>
      )}
      {awaitingSchedule ? (
        <div className="rounded-3xl bg-[#17362d] p-6 text-white shadow-[0_18px_50px_rgba(23,54,45,.16)]">
          <p className="text-sm font-black uppercase tracking-wide text-[#b9d6ca]">
            Traitement reçu
          </p>
          <h1 className="mt-1 text-2xl font-black">Horaires en préparation</h1>
          <p className="mt-2 text-sm font-medium text-[#d5e4de]">
            Votre aidant vérifie encore les horaires. Aucun bouton de prise n’est
            actif pour le moment.
          </p>
          <div className="mt-5 space-y-2 border-t border-white/15 pt-5">
            {prescription.items.map((item) => (
              <article key={item.id} className="rounded-2xl bg-white/10 p-4">
                <p className="font-black">{item.name}</p>
                <p className="mt-1 text-sm font-bold text-[#d5e4de]">
                  {item.dosage} · {item.quantity} {item.form}
                </p>
                <p className="mt-1 text-sm font-medium text-[#b9d6ca]">
                  {item.asNeeded
                    ? "Si besoin · aucun rappel automatique"
                    : [item.frequencyText, item.durationText]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
              </article>
            ))}
          </div>
          {prescription.notes && (
            <p className="mt-4 whitespace-pre-line rounded-xl bg-[#fff5dd] p-3 text-sm font-medium text-[#765b2b]">
              {prescription.notes}
            </p>
          )}
        </div>
      ) : next ? (
        <>
          <div className="relative mb-5 overflow-hidden rounded-[2rem] bg-[linear-gradient(145deg,#17362d,#176b50)] p-6 text-white shadow-[0_24px_60px_rgba(23,54,45,.22)]">
            <span className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-white/5" />
            <div className="mb-8 flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-[#b9d6ca]">
                  PROCHAINE PRISE
                </p>
                <p className="mt-1 text-5xl font-black tracking-tight">
                  {next.time}
                </p>
              </div>
              <span className="relative rounded-full bg-[#d8f36a] px-4 py-2 text-sm font-extrabold text-[#17362d] shadow-[0_8px_20px_rgba(216,243,106,.2)]">
                {next.label}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-white/15 pt-5">
              <div>
                <p className="text-xl font-extrabold">
                  Traitement de {next.label.toLowerCase()}
                </p>
                <p className="mt-1 text-base text-[#d5e4de]">{next.detail}</p>
              </div>
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-3xl">
                💊
              </div>
            </div>
            <details className="relative mt-5 rounded-2xl bg-white/10 p-4" open>
              <summary className="cursor-pointer list-none font-black text-white">
                Médicaments à prendre ({medicinesForNext.length || 1})
              </summary>
              <div className="mt-3 space-y-2 border-t border-white/15 pt-3">
                {medicinesForNext.length > 0 ? medicinesForNext.map((item) => (
                  <div key={item.id} className="rounded-xl bg-white/10 p-3">
                    <p className="font-black">{item.name} · {item.dosage}</p>
                    <p className="mt-1 text-sm font-medium text-[#d5e4de]">{quantityLabel(item.quantity)} {item.form}{item.quantity > 1 ? "s" : ""} par prise</p>
                  </div>
                )) : <p className="text-sm font-medium text-[#d5e4de]">{next.detail}</p>}
              </div>
            </details>
          </div>
          {readOnlyPreview ? (
            <div className="flex min-h-24 w-full items-center justify-center rounded-[2rem] border-2 border-dashed border-[#90c8ae] bg-white px-6 text-center text-lg font-black text-[#176b50]">
              Bouton de confirmation visible uniquement sur l’accès Patient
            </div>
          ) : canConfirmNow ? (
            <button onClick={() => confirm(next.id)} className="group flex min-h-32 w-full items-center justify-center gap-4 rounded-[2rem] border-4 border-[#17362d] bg-[#d8f36a] px-5 text-left text-[#17362d] shadow-[0_16px_36px_rgba(23,54,45,.24)] hover:-translate-y-0.5 hover:bg-[#e3fa84] active:translate-y-0 active:scale-[.98]">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#17362d] text-3xl text-white shadow-lg">✓</span>
              <span><span className="block text-sm font-black uppercase tracking-[.12em]">Appuyez ici</span><span className="mt-1 block text-2xl font-black leading-tight">Confirmer ma prise</span><span className="mt-1 block text-sm font-bold">J’ai pris tous les médicaments affichés</span></span>
            </button>
          ) : (
            <div className="rounded-[2rem] border-2 border-[#dce7e2] bg-white p-5 text-center">
              <p className="text-lg font-black text-[#37554b]">Confirmation disponible à {next.time}</p>
              <p className="mt-1 text-sm font-medium text-[#71847d]">La prise ne peut pas être validée avant l’heure prévue.</p>
            </div>
          )}
          {upcomingDoses.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-3xl border border-[#dce7e2] bg-white shadow-sm">
              <button
                type="button"
                aria-expanded={showUpcoming}
                onClick={() => setShowUpcoming((current) => !current)}
                className="flex w-full items-center justify-between gap-4 p-5 text-left"
              >
                <span>
                  <span className="block text-lg font-black">
                    Prochaines prises
                  </span>
                  <span className="mt-1 block text-sm font-bold text-[#60766e]">
                    Consulter sans confirmer · {upcomingDoses.length} prévue{upcomingDoses.length > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#edf5f1] text-xl font-black text-[#176b50]">
                  {showUpcoming ? "−" : "+"}
                </span>
              </button>
              {showUpcoming && (
                <div className="border-t border-[#edf2ef] px-5 pb-2">
                  {upcomingDoses.map((dose, index) => (
                    <article
                      key={dose.id}
                      className={`py-5 ${index < upcomingDoses.length - 1 ? "border-b border-[#edf2ef]" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="rounded-xl bg-[#17362d] px-3 py-2 text-lg font-black text-white">
                          {dose.time}
                        </span>
                        <div>
                          <p className="font-black">{dose.label}</p>
                          <p className="text-xs font-bold uppercase tracking-wide text-[#71847d]">
                            Consultation uniquement
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 text-base font-bold leading-relaxed text-[#37554b]">
                        {dose.detail}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-3xl border-2 border-[#90c8ae] bg-[#e2f5ea] p-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#176b50] text-3xl font-black text-white">
            ✓
          </div>
          <p className="mt-4 text-2xl font-black">
            {exceptions ? "Journée enregistrée" : "Journée terminée"}
          </p>
          <p className="mt-1 font-medium text-[#527066]">
            {exceptions
              ? `${exceptions} prise${exceptions > 1 ? "s" : ""} signalée${exceptions > 1 ? "s" : ""} à l’aidant.`
              : "Toutes les prises sont confirmées."}
          </p>
        </div>
      )}
      {!awaitingSchedule && (
        <details className="mt-5 rounded-2xl border border-[#dce7e2] bg-white p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between font-black">
            <span>Options</span><span className={reminders ? "text-[#176b50]" : "text-[#a84747]"}>Rappels {reminders ? "activés ✓" : "désactivés"}</span>
          </summary>
          <div className="mt-4 border-t border-[#edf2ef] pt-4">
            <button onClick={toggleReminders} className="w-full rounded-xl border border-[#d5e2dc] px-4 py-3 font-black text-[#37554b]">
              {reminders ? "Désactiver les rappels" : "Réactiver les rappels"}
            </button>
            {reminders && typeof Notification !== "undefined" && Notification.permission !== "granted" && (
              <button onClick={enableReminders} className="mt-2 w-full rounded-xl bg-[#176b50] px-4 py-3 font-black text-white">Autoriser les notifications du téléphone</button>
            )}
          </div>
        </details>
      )}
      <button
        onClick={requestHelp}
        disabled={!!help || readOnlyPreview}
        className={`mt-3 w-full rounded-2xl border-2 px-5 py-4 text-lg font-extrabold ${help ? "border-[#efc16d] bg-[#fff5dd] text-[#865e19]" : "border-[#d5e2dc] bg-white text-[#37554b]"}`}
      >
        {readOnlyPreview ? "Demande d’aide disponible côté Patient" : help ? "Votre aidant a été prévenu ✓" : "J’ai une question"}
      </button>
      {!awaitingSchedule && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black">Aujourd’hui</h2>
            <span className="text-sm font-bold text-[#608076]">
              {done} prise{done > 1 ? "s" : ""} sur {doses.length}
            </span>
          </div>
          <VirtualPillbox doses={doses} prescription={prescription} />
          <p className="mt-2 text-center text-xs font-bold text-[#71847d]">Le pilulier est informatif. Seul le grand bouton confirme une prise.</p>
        </div>
      )}
    </section>
  );
}

function AidantView({
  doses,
  save,
  confirm,
  share,
  copyPatientLink,
  patientUrl,
  copied,
  settings,
  updateDelay,
  help,
  acknowledgeHelp,
  markOutcome,
  patientName,
  patientReminder,
  sendPatientReminder,
  prescription,
}: {
  doses: Dose[];
  save: (doses: Dose[]) => void;
  confirm: (id: string) => void;
  share: () => void;
  copyPatientLink: () => void;
  patientUrl: string;
  copied: boolean;
  settings: Settings;
  updateDelay: (delay: 15 | 30 | 60) => void;
  help: HelpRequest;
  acknowledgeHelp: () => void;
  markOutcome: (
    dose: Dose,
    outcome: "missed" | "refused" | "postponed",
  ) => void;
  patientName: string;
  patientReminder: PatientReminder;
  sendPatientReminder: (dose: Dose) => void;
  prescription: Prescription;
}) {
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState("12:00");
  const [label, setLabel] = useState("Nouvelle prise");
  const [editing, setEditing] = useState<Dose | null>(null);
  const [stock, setStock] = useState(14);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const alertedLate = useRef(new Set<string>());
  const confirmed = doses.filter((d) => d.status === "confirmed").length;
  const late = doses.filter(
    (d) =>
      d.status !== "confirmed" &&
      !["missed", "refused"].includes(d.status) &&
      new Date().getHours() * 60 + new Date().getMinutes() >
        Number(d.time.slice(0, 2)) * 60 +
          Number(d.time.slice(3)) +
          settings.alertDelay,
  );
  const lowStockItems = prescription?.items.filter((item) => item.stock <= item.lowStockThreshold) ?? [];
  useEffect(() => {
    if (!shareOpen || !patientUrl) return;
    QRCode.toDataURL(patientUrl, { width: 320, margin: 2, errorCorrectionLevel: "M", color: { dark: "#17362d", light: "#ffffff" } }).then(setQrCode).catch(() => setQrCode(""));
  }, [shareOpen, patientUrl]);
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    late.forEach((dose) => {
      if (alertedLate.current.has(dose.id)) return;
      new Notification(`MedConnect — prise de ${dose.time} non confirmée`, {
        body: `${patientName} n’a pas encore confirmé ${dose.label}.`,
        icon: "/favicon.svg",
      });
      alertedLate.current.add(dose.id);
    });
  }, [late, patientName]);
  const addDose = () => {
    const next = [
      ...doses,
      {
        id: crypto.randomUUID(),
        time,
        label: label.trim() || "Nouvelle prise",
        detail: "Consigne à préciser avec l’aidant",
        status: "upcoming" as Status,
        stock,
      },
    ].sort((a, b) => a.time.localeCompare(b.time));
    save(next);
    setAdding(false);
  };
  const startEdit = (dose: Dose) => {
    setEditing(dose);
    setTime(dose.time);
    setLabel(dose.label);
    setStock(dose.stock);
    setAdding(false);
  };
  const applyEdit = () => {
    if (!editing) return;
    save(
      doses
        .map((d) =>
          d.id === editing.id
            ? { ...d, time, label: label.trim() || d.label, stock }
            : d,
        )
        .sort((a, b) => a.time.localeCompare(b.time)),
    );
    setEditing(null);
  };
  const removeDose = (dose: Dose) => {
    if (doses.length <= 1) {
      window.alert("Le programme doit conserver au moins une prise.");
      return;
    }
    if (
      window.confirm(
        `Suppression définitive\n\nVoulez-vous vraiment supprimer la prise « ${dose.label} » prévue à ${dose.time} ? Cette action est irréversible.`,
      )
    )
      save(doses.filter((d) => d.id !== dose.id));
  };
  const reset = () =>
    save(
      doses.map((dose, index) => ({
        ...dose,
        status: index === 0 ? "pending" : "upcoming",
      })),
    );
  return (
    <section className="mx-auto max-w-6xl px-5 pb-40">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[.14em] text-[#176b50]">Tableau de bord Aidant</p>
          <h1 className="mt-1 text-3xl font-black tracking-[-.035em] sm:text-4xl">Suivi de {patientName}</h1>
          <p className="mt-2 font-medium text-[#60766e]">Vue d’ensemble du traitement et des alertes du jour.</p>
        </div>
        <button onClick={() => setShareOpen(true)} className="rounded-2xl bg-[#17362d] px-5 py-3.5 font-black text-white shadow-[0_12px_28px_rgba(23,54,45,.16)]">
          Partager l’accès patient
        </button>
      </div>
      {shareOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#10271f]/60 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="share-patient-title">
        <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white p-6 shadow-2xl sm:rounded-[2rem] sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.14em] text-[#176b50]">Accès sécurisé Patient</p><h2 id="share-patient-title" className="mt-1 text-2xl font-black">Scanner ou envoyer le lien</h2></div><button type="button" onClick={() => setShareOpen(false)} aria-label="Fermer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#edf2ef] text-xl font-black">×</button></div>
          <p className="mt-3 text-sm font-medium text-[#60766e]">Ce lien ouvre uniquement l’espace Patient. Il ne contient jamais la clé d’accès Aidant.</p>
          <div className="mx-auto mt-5 flex aspect-square w-full max-w-[300px] items-center justify-center rounded-[2rem] border border-[#dce7e2] bg-white p-4 shadow-[0_12px_35px_rgba(35,72,60,.08)]">{qrCode ? <img src={qrCode} alt="QR code de l’accès Patient" className="h-full w-full" /> : <span className="font-bold text-[#71847d]">Création du QR code…</span>}</div>
          <p className="mt-3 text-center text-sm font-black text-[#37554b]">Le patient scanne ce code avec l’appareil photo de son téléphone.</p>
          <label className="mt-5 block text-xs font-black uppercase tracking-wider text-[#71847d]">Lien Patient uniquement<input readOnly value={patientUrl} onFocus={(event) => event.currentTarget.select()} className="mt-2 w-full rounded-xl border border-[#ccdcd5] bg-[#f7faf8] px-3 py-3 text-sm font-bold text-[#37554b]" /></label>
          <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={copyPatientLink} className="min-h-14 rounded-2xl border-2 border-[#90c8ae] bg-white px-4 font-black text-[#176b50]">{copied ? "Lien copié ✓" : "Copier le lien"}</button><button type="button" onClick={share} className="min-h-14 rounded-2xl bg-[#176b50] px-4 font-black text-white">Partager le lien</button></div>
          <p className="mt-4 rounded-xl bg-[#fff5dd] p-3 text-xs font-bold text-[#765b2b]">Toute personne possédant ce lien peut ouvrir l’espace Patient. Partagez-le uniquement avec le patient et les personnes de confiance.</p>
        </div>
      </div>}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-3xl border border-white bg-white p-5 shadow-[0_12px_35px_rgba(35,72,60,.07)]">
          <p className="text-xs font-black uppercase tracking-wider text-[#71847d]">Prises confirmées</p>
          <p className="mt-2 text-4xl font-black text-[#176b50]">{confirmed}<span className="text-lg text-[#71847d]"> / {doses.length}</span></p>
        </div>
        <div className="rounded-3xl border border-white bg-white p-5 shadow-[0_12px_35px_rgba(35,72,60,.07)]">
          <p className="text-xs font-black uppercase tracking-wider text-[#71847d]">Alertes actives</p>
          <p className={`mt-2 text-4xl font-black ${late.length ? "text-[#a66a12]" : "text-[#176b50]"}`}>{late.length}</p>
        </div>
        <div className="rounded-3xl bg-[#17362d] p-5 text-white shadow-[0_12px_35px_rgba(23,54,45,.14)]">
          <p className="text-xs font-black uppercase tracking-wider text-[#b9d6ca]">État du jour</p>
          <p className="mt-2 text-2xl font-black">{confirmed === doses.length ? "Journée terminée" : late.length ? "À surveiller" : "Tout va bien"}</p>
        </div>
      </div>
      {help && (
        <div className="mb-5 rounded-3xl border-2 border-[#ef8d73] bg-[#fff0eb] p-5">
          <p className="text-sm font-black uppercase tracking-wide text-[#a94630]">
            {patientName} a une question
          </p>
          <p className="mt-1 text-lg font-black">
            Demande reçue à{" "}
            {new Date(help.requestedAt).toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <button
            onClick={acknowledgeHelp}
            className="mt-3 rounded-xl bg-[#a94630] px-4 py-3 text-sm font-black text-white"
          >
            J’ai pris contact
          </button>
        </div>
      )}
      {late.length > 0 && (
        <div className="mb-5 rounded-3xl border-2 border-[#efc16d] bg-[#fff5dd] p-5">
          <p className="text-sm font-black uppercase tracking-wide text-[#9a6511]">
            Alerte de retard
          </p>
          <p className="mt-1 text-lg font-black">
            {late.length} prise{late.length > 1 ? "s" : ""} non confirmée
            {late.length > 1 ? "s" : ""}
          </p>
          <p className="mt-1 text-sm font-medium text-[#765b2b]">
            Vérifiez auprès de {patientName} avant toute action.
          </p>
          {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
            <button type="button" onClick={() => void Notification.requestPermission()} className="mt-3 rounded-xl border border-[#d4a64f] bg-white px-4 py-2.5 text-sm font-black text-[#865e19]">
              Autoriser les alertes sur cet appareil
            </button>
          )}
          <div className="mt-4 space-y-2">
            {late.map((dose) => (
              <div key={dose.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 p-3">
                <div><p className="font-black">{dose.time} · {dose.label}</p><p className="text-xs font-medium text-[#765b2b]">{dose.detail}</p></div>
                <button
                  type="button"
                  onClick={() => sendPatientReminder(dose)}
                  disabled={patientReminder?.doseId === dose.id}
                  className="shrink-0 rounded-xl bg-[#a66a12] px-4 py-3 text-sm font-black text-white disabled:bg-[#90c8ae]"
                >
                  {patientReminder?.doseId === dose.id ? "Rappel envoyé ✓" : "Envoyer un rappel"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {lowStockItems.length > 0 && (
        <div className="mb-5 rounded-3xl border border-[#d9b6b6] bg-[#fff7f5] p-5">
          <p className="text-sm font-black uppercase tracking-wide text-[#a84747]">
            Stock faible
          </p>
          <p className="mt-1 font-black">
            {lowStockItems.map((item) => `${item.name} (${item.stock} unité${item.stock > 1 ? "s" : ""})`).join(" · ")}
          </p>
          <p className="mt-1 text-sm font-medium text-[#765b5b]">
            Pensez à vérifier le renouvellement avec la pharmacie.
          </p>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black">Programme du jour</h2>
          <p className="text-sm font-medium text-[#6d817a]">
            Synchronisé avec le téléphone Patient
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-xl bg-[#176b50] px-4 py-3 text-sm font-extrabold text-white"
        >
          + Ajouter
        </button>
      </div>
      {(adding || editing) && (
        <div className="mb-4 grid gap-3 rounded-3xl border border-[#dce7e2] bg-white p-5 sm:grid-cols-[120px_1fr_110px_auto]">
          <label className="text-sm font-black">
            Horaire
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              type="time"
              className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3 text-base"
            />
          </label>
          <label className="text-sm font-black">
            Nom de la prise
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3 text-base"
            />
          </label>
          <label className="text-sm font-black">
            Stock
            <input
              value={stock}
              onChange={(e) =>
                setStock(Math.max(0, Math.min(999, Number(e.target.value))))
              }
              type="number"
              min="0"
              max="999"
              className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3 text-base"
            />
          </label>
          <button
            onClick={editing ? applyEdit : addDose}
            className="self-end rounded-xl bg-[#176b50] px-5 py-3 font-black text-white"
          >
            {editing ? "Mettre à jour" : "Enregistrer"}
          </button>
        </div>
      )}
      <DoseList
        doses={doses}
        onConfirm={confirm}
        onEdit={startEdit}
        onDelete={removeDose}
        onOutcome={markOutcome}
      />
      <div className="mt-7 rounded-3xl border border-[#dce7e2] bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-black">Délai avant alerte</p>
            <p className="mt-1 text-sm font-medium text-[#6d817a]">
              Prévenir après une prise non confirmée
            </p>
          </div>
          <select
            value={settings.alertDelay}
            onChange={(e) =>
              updateDelay(Number(e.target.value) as 15 | 30 | 60)
            }
            className="rounded-xl border-0 bg-[#edf5f1] px-4 py-3 font-black text-[#176b50]"
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
          </select>
        </div>
      </div>
      {confirmed > 0 && (
        <button
          onClick={reset}
          className="mt-5 w-full rounded-2xl border-2 border-[#d5e2dc] bg-white px-5 py-4 font-extrabold text-[#37554b]"
        >
          Réinitialiser la journée
        </button>
      )}
    </section>
  );
}

function HistoryView({ history }: { history: HistoryEvent[] }) {
  const outcomeLabel = {
    taken: "Prise confirmée",
    missed: "Prise oubliée",
    refused: "Prise refusée",
    postponed: "Prise reportée",
  };
  return (
    <section className="mx-auto max-w-lg px-5 pb-32">
      <div className="mb-5">
        <p className="text-sm font-black uppercase tracking-wide text-[#176b50]">
          Suivi partagé
        </p>
        <h1 className="mt-1 text-3xl font-black">Historique des prises</h1>
        <p className="mt-2 font-medium text-[#657a72]">
          Les confirmations effectuées pendant le pilote apparaissent ici.
        </p>
      </div>
      {history.length === 0 ? (
        <div className="rounded-3xl border border-[#dce7e2] bg-white p-8 text-center">
          <div className="text-4xl">🕘</div>
          <p className="mt-3 text-lg font-black">Aucune prise confirmée</p>
          <p className="mt-1 text-sm font-medium text-[#71847d]">
            L’historique se remplira automatiquement.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((event) => (
            <article
              key={event.id}
              className="flex items-center gap-4 rounded-3xl border border-[#dce7e2] bg-white p-5 shadow-sm"
            >
              <span
                className={`grid h-11 w-11 place-items-center rounded-full text-xl font-black ${event.outcome === "missed" ? "bg-[#fff5dd] text-[#865e19]" : event.outcome === "refused" ? "bg-[#fff0eb] text-[#a84747]" : "bg-[#e2f5ea] text-[#176b50]"}`}
              >
                {event.outcome === "missed"
                  ? "!"
                  : event.outcome === "refused"
                    ? "×"
                    : "✓"}
              </span>
              <div className="flex-1">
                <p className="font-black">
                  {outcomeLabel[event.outcome || "taken"]} ·{" "}
                  {event.label.toLowerCase()}
                </p>
                <p className="mt-1 text-sm font-medium text-[#71847d]">
                  Prévue à {event.scheduledTime}
                </p>
              </div>
              <time className="text-sm font-black text-[#176b50]">
                {new Date(event.confirmedAt).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </article>
          ))}
        </div>
      )}
      <div className="mt-6 rounded-2xl bg-[#edf5f1] p-4 text-sm font-medium text-[#547066]">
        Une confirmation indique une action déclarée dans l’application, pas une
        preuve médicale d’ingestion.
      </div>
    </section>
  );
}

function PrescriptionView({
  prescription,
  versions,
  currentDoses,
  onSave,
}: {
  prescription: Prescription;
  versions: NonNullable<Prescription>[];
  currentDoses: Dose[];
  onSave: (prescription: Prescription, doses?: Dose[]) => void;
}) {
  const [issuedAt, setIssuedAt] = useState(
    prescription?.issuedAt || new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState(
    prescription?.validUntil ||
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [prescriber, setPrescriber] = useState(prescription?.prescriber || "");
  const [notes, setNotes] = useState(prescription?.notes || "");
  const [items, setItems] = useState<PrescriptionItem[]>(
    prescription?.items || [
      {
        id: crypto.randomUUID(),
        name: "",
        dosage: "",
        quantity: 1,
        time: "08:00",
        stock: 14,
        unitsPerBox: 30,
        lowStockThreshold: 7,
        stockUpdatedAt: new Date().toISOString(),
        confidence: "medium",
        reviewed: false,
        form: "comprimé",
        mealTiming: "none",
        days: [0, 1, 2, 3, 4, 5, 6],
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        asNeeded: false,
        times: ["08:00"],
        frequencyText: "1 fois par jour",
        durationText: "",
        cis: "", officialName: "", activeSubstances: "", administrationRoute: "", commercialStatus: "", officialPresentation: "",
      },
    ],
  );
  const [proposedDoses, setProposedDoses] = useState<Dose[] | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanText, setScanText] = useState("");
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  const [scanError, setScanError] = useState("");
  const [scanCrop, setScanCrop] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [scanSuggestions, setScanSuggestions] = useState<
    {
      id: string;
      name: string;
      dosage: string;
      quantity: number;
      form: string;
      frequency: string;
      duration: string;
      times: string[];
      asNeeded: boolean;
      verified: boolean;
    }[]
  >([]);
  const scanInputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (scanPreview) URL.revokeObjectURL(scanPreview);
    },
    [scanPreview],
  );
  const chooseScan = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      window.alert("Choisissez une photo JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      window.alert("La photo ne doit pas dépasser 8 Mo.");
      return;
    }
    if (scanPreview) URL.revokeObjectURL(scanPreview);
    setScanFile(file);
    setScanPreview(URL.createObjectURL(file));
    setScanText("");
    setScanError("");
    setScanSuggestions([]);
    setScanCrop({ x: 0, y: 0, width: 100, height: 100 });
    setScanCrop(null);
  };
  const prepareScanImage = async (
    file: File,
    crop: NonNullable<typeof scanCrop>,
  ) => {
    const bitmap = await createImageBitmap(file);
    const paddingX = Math.min(3, crop.width * 0.12);
    const paddingY = Math.min(3, crop.height * 0.18);
    const paddedX = Math.max(0, crop.x - paddingX);
    const paddedY = Math.max(0, crop.y - paddingY);
    const paddedRight = Math.min(100, crop.x + crop.width + paddingX);
    const paddedBottom = Math.min(100, crop.y + crop.height + paddingY);
    const sourceX = Math.round((paddedX / 100) * bitmap.width);
    const sourceY = Math.round((paddedY / 100) * bitmap.height);
    const sourceWidth = Math.max(
      1,
      Math.round(((paddedRight - paddedX) / 100) * bitmap.width),
    );
    const sourceHeight = Math.max(
      1,
      Math.round(((paddedBottom - paddedY) / 100) * bitmap.height),
    );
    const scale = Math.min(3, Math.max(1.5, 2200 / sourceWidth));
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas indisponible");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.filter = "grayscale(1) contrast(165%) brightness(110%)";
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    bitmap.close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image invalide"))),
        "image/png",
      ),
    );
  };
  const runLocalOcr = async () => {
    if (!scanFile) return;
    setScanProgress(0);
    setScanError("");
    try {
      const prepared = await prepareScanImage(
        scanFile,
        scanCrop ?? { x: 0, y: 0, width: 100, height: 100 },
      );
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("fra", 1, {
        logger: (message) => {
          if (message.status === "recognizing text")
            setScanProgress(Math.round(message.progress * 100));
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(prepared);
      await worker.terminate();
      setScanText(result.data.text.trim());
      const rawText = result.data.text.trim();
      const dosagePattern = /\d+(?:[.,]\d+)?\s*(?:mg|g|ml|µg)\b/i;
      const parts: string[] = [];
      let currentMedication = "";
      rawText
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .forEach((line) => {
          if (dosagePattern.test(line)) {
            if (currentMedication) parts.push(currentMedication);
            currentMedication = line;
          } else if (currentMedication) {
            currentMedication += ` ${line}`;
          }
        });
      if (currentMedication) parts.push(currentMedication);
      setScanSuggestions(
        parts.slice(0, 12).map((part) => {
          const cleanStart = part.replace(/^\s*\d+[.)-]?\s*/, "");
          const dosageMatch = cleanStart.match(
            /\b\d+(?:[.,]\d+)?\s*(?:mg|g|ml|µg)\b/i,
          );
          const quantityMatch = cleanStart.match(
            /\b(\d+)\s*(gélule|comprimé|sachet|dose|ml)s?\b/i,
          );
          const frequency =
            cleanStart.match(
              /(?:\d+\s*fois\s*par\s*jour|toutes?\s+les?\s+\d+\s*heures?)/i,
            )?.[0] || "";
          const duration =
            cleanStart.match(
              /pendant\s+\d+\s*(?:jours?|semaines?|mois)/i,
            )?.[0] || "";
          const asNeeded = /si\s+(?:douleur|besoin)/i.test(cleanStart);
          const intervalHours = Number(
            frequency.match(/toutes?\s+les?\s+(\d+)\s*heures?/i)?.[1] || 0,
          );
          const dailyCount = intervalHours
            ? Math.min(4, Math.floor(24 / intervalHours))
            : Number(frequency.match(/(\d+)\s*fois\s*par\s*jour/i)?.[1] || 1);
          const times = asNeeded
            ? []
            : dailyCount >= 4
              ? ["08:00", "12:00", "16:00", "20:00"]
              : dailyCount === 3
                ? ["08:00", "13:00", "20:00"]
                : dailyCount === 2
                  ? ["08:00", "20:00"]
                  : ["08:00"];
          return {
            id: crypto.randomUUID(),
            name: dosageMatch
              ? cleanStart
                  .slice(0, dosageMatch.index)
                  .replace(/[^A-Za-zÀ-ÿ' -]/g, "")
                  .trim()
              : "",
            dosage: dosageMatch?.[0] || "",
            quantity: quantityMatch ? Number(quantityMatch[1]) : 1,
            form: quantityMatch?.[2]?.toLowerCase() || "comprimé",
            frequency,
            duration,
            times,
            asNeeded,
            verified: false,
          };
        }),
      );
      if (parts.length === 0)
        setScanError(
          "Aucun médicament n’a été reconnu. Essayez une photo plus nette.",
        );
      if (!result.data.text.trim())
        setScanError(
          "Aucun texte lisible détecté. Essayez une photo plus nette.",
        );
    } catch {
      setScanError(
        "La lecture locale a échoué. Vérifiez la connexion puis réessayez avec une photo nette.",
      );
    } finally {
      setScanProgress(null);
    }
  };
  const clearScan = () => {
    if (scanPreview) URL.revokeObjectURL(scanPreview);
    setScanFile(null);
    setScanPreview(null);
    setScanText("");
    setScanError("");
    setScanSuggestions([]);
    setScanCrop(null);
    if (scanInputRef.current) scanInputRef.current.value = "";
  };
  const resetScanResult = () => {
    setScanText("");
    setScanSuggestions([]);
    setScanError("");
  };
  const addScanSuggestions = () => {
    if (
      scanSuggestions.length === 0 ||
      scanSuggestions.some(
        (suggestion) =>
          !suggestion.verified ||
          !suggestion.name ||
          !suggestion.dosage ||
          (!suggestion.asNeeded &&
            (suggestion.times.length === 0 ||
              suggestion.times.some(
                (time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time),
              ))),
      )
    ) {
      window.alert(
        "Confirmez ou corrigez chaque médicament avant de continuer.",
      );
      return;
    }
    const treatmentStart = new Date().toISOString().slice(0, 10);
    const nextItems: PrescriptionItem[] = scanSuggestions.map((suggestion) => ({
      id: crypto.randomUUID(),
      name: suggestion.name,
      dosage: suggestion.dosage,
      quantity: suggestion.quantity,
      form: suggestion.form,
      time: suggestion.times[0] || "08:00",
      stock: 14,
      unitsPerBox: 30,
      lowStockThreshold: 7,
      stockUpdatedAt: new Date().toISOString(),
      confidence: "low",
      reviewed: false,
      mealTiming: "none",
      days: ALL_DAYS,
      startDate: treatmentStart,
      endDate: endDateFromDuration(treatmentStart, suggestion.duration),
      asNeeded: suggestion.asNeeded,
      times: suggestion.times,
      frequencyText: suggestion.frequency,
      durationText: suggestion.duration,
      cis: "", officialName: "", activeSubstances: "", administrationRoute: "", commercialStatus: "", officialPresentation: "",
    }));
    const emptyIndex = items.findIndex((item) => !item.name && !item.dosage);
    const combinedItems =
      emptyIndex < 0
        ? [...items, ...nextItems]
        : [...items.filter((_, index) => index !== emptyIndex), ...nextItems];
    const instructions = scanSuggestions
      .map((suggestion) => {
        const instruction = [suggestion.frequency, suggestion.duration]
          .filter(Boolean)
          .join(" · ");
        return instruction ? `${suggestion.name} : ${instruction}` : "";
      })
      .filter(Boolean)
      .join("\n");
    const nextNotes = [notes, instructions].filter(Boolean).join("\n");
    setItems(combinedItems);
    setNotes(nextNotes);
    onSave({
      id: prescription?.id || crypto.randomUUID(),
      status: "draft",
      issuedAt,
      validUntil,
      prescriber: prescriber.trim(),
      notes: nextNotes,
      items: combinedItems,
      updatedAt: new Date().toISOString(),
    });
    resetScanResult();
  };
  const updateItem = (id: string, changes: Partial<PrescriptionItem>) =>
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...changes,
              reviewed:
                Object.keys(changes).length === 1 && "reviewed" in changes
                  ? Boolean(changes.reviewed)
                  : false,
            }
          : item,
      ),
    );
  const build = (status: "draft" | "validated"): NonNullable<Prescription> => ({
    id: prescription?.id || crypto.randomUUID(),
    status,
    issuedAt,
    validUntil,
    prescriber: prescriber.trim(),
    notes: notes.trim(),
    items,
    updatedAt: new Date().toISOString(),
  });
  const saveDraft = () => onSave(build("draft"));
  const prepareValidation = () => {
    if (!items.every((item) => item.name.trim() && item.dosage.trim())) {
      window.alert("Vérifiez le nom et le dosage de chaque ligne.");
      return;
    }
    if (!items.every((item) => item.reviewed)) {
      window.alert(
        "Cochez « ligne vérifiée » pour chaque traitement avant de générer le calendrier.",
      );
      return;
    }
    if (
      !items.every(
        (item) =>
          item.days.length > 0 &&
          item.startDate &&
          item.endDate &&
          item.startDate <= item.endDate &&
          (item.asNeeded ||
            (item.times.length > 0 &&
              item.times.every((time) =>
                /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
              ))),
      )
    ) {
      window.alert(
        "Vérifiez les jours, la période et les horaires de chaque traitement.",
      );
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const weekday = new Date().getDay();
    const scheduledToday = items.filter(
      (item) =>
        !item.asNeeded &&
        item.days.includes(weekday) &&
        item.startDate <= today &&
        item.endDate >= today,
    );
    if (scheduledToday.length === 0) {
      window.alert(
        "Aucune prise planifiée aujourd’hui. Les traitements « si besoin » ne créent pas de rappel automatique.",
      );
      return;
    }
    const grouped = new Map<string, PrescriptionItem[]>();
    scheduledToday.forEach((item) =>
      item.times.forEach((time) =>
        grouped.set(time, [...(grouped.get(time) || []), item]),
      ),
    );
    const generated: Dose[] = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, lines]) => ({
        id: crypto.randomUUID(),
        time,
        label:
          Number(time.slice(0, 2)) < 11
            ? "Matin"
            : Number(time.slice(0, 2)) < 17
              ? "Après-midi"
              : "Soir",
        detail: lines
          .map(
            (line) =>
              `${line.quantity} × ${line.name} ${line.form} (${line.dosage})${line.mealTiming === "none" ? "" : ` · ${line.mealTiming === "before" ? "avant" : line.mealTiming === "during" ? "pendant" : "après"} le repas`}`,
          )
          .join(" · "),
        status: "upcoming",
        stock: Math.min(...lines.map((line) => line.stock)),
      }));
    setProposedDoses(generated);
  };
  const applyValidation = () => {
    if (!proposedDoses) return;
    onSave(build("validated"), proposedDoses);
    setProposedDoses(null);
  };
  return (
    <section className="mx-auto max-w-3xl px-5 pb-32">
      <div className="mb-5">
        <p className="text-sm font-black uppercase tracking-wide text-[#176b50]">
          Gestion du traitement
        </p>
        <h1 className="mt-1 text-3xl font-black">Ordonnance</h1>
        <p className="mt-2 font-medium text-[#657a72]">
          Saisissez et vérifiez chaque ligne avant de générer le calendrier.
        </p>
      </div>
      <div className="mb-5 rounded-2xl border border-[#efc16d] bg-[#fff5dd] p-4 text-sm font-medium text-[#765b2b]">
        <strong>Mode pilote :</strong> utilisez uniquement des données fictives.
        L’OCR local aide uniquement à lire le document : il ne remplit pas et ne
        valide jamais le traitement automatiquement.
      </div>
      <input
        ref={scanInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={(event) => chooseScan(event.target.files?.[0])}
        className="sr-only"
      />
      {!scanFile ? (
        <button
          onClick={() => scanInputRef.current?.click()}
          className="mb-5 w-full rounded-3xl border-2 border-dashed border-[#b8ccc3] bg-[#edf5f1] p-6 text-center text-[#176b50]"
        >
          <p className="text-3xl">📷</p>
          <p className="mt-2 font-black">Photographier un document fictif</p>
          <p className="mt-1 text-sm font-medium text-[#60766e]">
            JPG, PNG ou WebP · lecture effectuée sur cet appareil
          </p>
        </button>
      ) : (
        <div className="mb-5 overflow-hidden rounded-3xl border border-[#b8ccc3] bg-white">
          {scanPreview && (
            <div className="overflow-hidden bg-[#dce7e2]">
              <img
                src={scanPreview}
                alt="Ordonnance à analyser"
                draggable={false}
                className="block h-auto w-full"
              />
            </div>
          )}
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-black">
                {scanFile.name}
              </p>
              <button
                onClick={clearScan}
                className="shrink-0 rounded-xl px-3 py-2 text-sm font-bold text-[#a84747] hover:bg-[#fff0eb]"
              >
                Retirer
              </button>
            </div>
            <button
              onClick={runLocalOcr}
              disabled={scanProgress !== null}
              className="mt-3 w-full rounded-xl bg-[#176b50] px-4 py-3 font-black text-white disabled:opacity-70"
            >
              {scanProgress === null
                ? scanText
                  ? "Analyser à nouveau"
                  : "Analyser l’ordonnance"
                : `Lecture en cours… ${scanProgress}%`}
            </button>
          </div>
        </div>
      )}
      {scanError && (
        <div className="mb-5 rounded-2xl border border-[#d9b6b6] bg-[#fff7f5] p-4 text-sm font-bold text-[#a84747]">
          {scanError}
        </div>
      )}
      {scanSuggestions.length > 0 && (
        <div className="mb-5 rounded-3xl border-2 border-[#90c8ae] bg-white p-5">
          <h2 className="text-xl font-black">Médicaments détectés</h2>
          <p className="mt-1 text-sm font-medium text-[#60766e]">
            Vérifiez chaque carte avec la photo.
          </p>
          <div className="mt-4 space-y-4">
            {scanSuggestions.map((suggestion, index) => (
              <article
                key={suggestion.id}
                className={`rounded-2xl border-2 p-4 ${suggestion.verified ? "border-[#90c8ae] bg-[#e2f5ea]" : "border-[#dce7e2] bg-[#f8faf9]"}`}
              >
                <p className="mb-3 font-black">Médicament {index + 1}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Médicament", "name"],
                    ["Dosage", "dosage"],
                    ["Fréquence", "frequency"],
                    ["Durée", "duration"],
                  ].map(([label, field]) => (
                    <label key={field} className="text-sm font-black">
                      {label}
                      <input
                        value={String(
                          suggestion[field as keyof typeof suggestion],
                        )}
                        onChange={(event) =>
                          setScanSuggestions((current) =>
                            current.map((item) =>
                              item.id === suggestion.id
                                ? {
                                    ...item,
                                    [field]: event.target.value,
                                    verified: false,
                                  }
                                : item,
                            ),
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-[#ccdcd5] bg-white px-3 py-3"
                      />
                    </label>
                  ))}
                  <label className="text-sm font-black">
                    Quantité par prise
                    <select
                      value={suggestion.quantity}
                      onChange={(event) =>
                        setScanSuggestions((current) =>
                          current.map((item) =>
                            item.id === suggestion.id
                              ? { ...item, quantity: Number(event.target.value), verified: false }
                              : item,
                          ),
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-[#ccdcd5] bg-white px-3 py-3"
                    >
                      {QUANTITY_OPTIONS.map((quantity) => (
                        <option key={quantity} value={quantity}>{quantityLabel(quantity)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-black">
                    Forme
                    <select
                      value={suggestion.form}
                      onChange={(event) =>
                        setScanSuggestions((current) =>
                          current.map((item) =>
                            item.id === suggestion.id
                              ? { ...item, form: event.target.value, verified: false }
                              : item,
                          ),
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-[#ccdcd5] bg-white px-3 py-3"
                    >
                      <option value="comprimé">Comprimé</option>
                      <option value="gélule">Gélule</option>
                      <option value="sachet">Sachet</option>
                      <option value="dose">Dose</option>
                      <option value="ml">ml</option>
                    </select>
                  </label>
                </div>
                {suggestion.asNeeded ? (
                  <div className="mt-3 rounded-xl bg-[#fff5dd] p-3 text-sm font-black text-[#765b2b]">
                    Si besoin : aucun rappel automatique ne sera créé.
                  </div>
                ) : (
                  <label className="mt-3 block text-sm font-black">
                    Horaires proposés
                    <input
                      value={suggestion.times.join(", ")}
                      onChange={(event) =>
                        setScanSuggestions((current) =>
                          current.map((item) =>
                            item.id === suggestion.id
                              ? {
                                  ...item,
                                  times: event.target.value
                                    .split(",")
                                    .map((time) => time.trim())
                                    .filter(Boolean),
                                  verified: false,
                                }
                              : item,
                          ),
                        )
                      }
                      placeholder="08:00, 13:00, 20:00"
                      className="mt-2 w-full rounded-xl border border-[#ccdcd5] bg-white px-3 py-3"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setScanSuggestions((current) =>
                      current.map((item) =>
                        item.id === suggestion.id
                          ? { ...item, verified: !item.verified }
                          : item,
                      ),
                    )
                  }
                  className={`mt-3 w-full rounded-xl px-4 py-3 font-black ${suggestion.verified ? "bg-white text-[#176b50]" : "bg-[#176b50] text-white"}`}
                >
                  {suggestion.verified ? "Correct ✓" : "C’est correct"}
                </button>
              </article>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setScanCrop({ x: 0, y: 0, width: 100, height: 100 });
                resetScanResult();
              }}
              className="rounded-xl border-2 border-[#d5e2dc] px-4 py-3 font-black text-[#37554b]"
            >
              Refaire
            </button>
            <button
              type="button"
              onClick={addScanSuggestions}
              className="rounded-xl bg-[#176b50] px-4 py-3 font-black text-white"
            >
              Confirmer l’ordonnance
            </button>
          </div>
        </div>
      )}
      <div className="rounded-3xl border border-[#dce7e2] bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-black">
            Date de l’ordonnance
            <input
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              type="date"
              className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
            />
          </label>
          <label className="text-sm font-black">
            Fin du traitement
            <input
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              type="date"
              min={issuedAt}
              className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
            />
          </label>
          <label className="text-sm font-black">
            Prescripteur fictif
            <input
              value={prescriber}
              onChange={(e) => setPrescriber(e.target.value)}
              maxLength={80}
              className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
            />
          </label>
        </div>
        <label className="mt-4 block text-sm font-black">
          Note générale
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            className="mt-2 min-h-20 w-full rounded-xl border border-[#ccdcd5] p-3"
          />
        </label>
      </div>
      <div className="mt-5 space-y-3">
        {items.map((item, index) => (
          <article
            key={item.id}
            className="rounded-3xl border border-[#dce7e2] bg-white p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="font-black">Ligne {index + 1}</p>
                <span className="rounded-full bg-[#edf5f1] px-2.5 py-1 text-[11px] font-black text-[#176b50]">
                  Saisie manuelle
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() =>
                    setItems((current) => [
                      ...current.slice(0, index + 1),
                      { ...item, id: crypto.randomUUID(), reviewed: false },
                      ...current.slice(index + 1),
                    ])
                  }
                  className="rounded-full px-3 py-1 text-sm font-bold text-[#176b50] hover:bg-[#edf5f1]"
                >
                  Dupliquer
                </button>
                {items.length > 1 && (
                  <button
                    onClick={() =>
                      setItems((current) =>
                        current.filter((line) => line.id !== item.id),
                      )
                    }
                    className="rounded-full px-3 py-1 text-sm font-bold text-[#a84747] hover:bg-[#fff0eb]"
                  >
                    Retirer
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-black">
                Nom fictif
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateItem(item.id, { name: e.target.value })
                  }
                  maxLength={80}
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                />
              </label>
              <label className="text-sm font-black">
                Dosage
                <input
                  value={item.dosage}
                  onChange={(e) =>
                    updateItem(item.id, { dosage: e.target.value })
                  }
                  maxLength={80}
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                />
              </label>
              <label className="text-sm font-black">
                Forme
                <select
                  value={item.form}
                  onChange={(e) =>
                    updateItem(item.id, { form: e.target.value })
                  }
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                >
                  <option value="comprimé">Comprimé</option>
                  <option value="gélule">Gélule</option>
                  <option value="sachet">Sachet</option>
                  <option value="solution">Solution</option>
                  <option value="autre">Autre</option>
                </select>
              </label>
              <label className="text-sm font-black">
                Quantité par prise
                <select
                  value={item.quantity}
                  onChange={(e) =>
                    updateItem(item.id, { quantity: Number(e.target.value) })
                  }
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                >
                  {!QUANTITY_OPTIONS.includes(item.quantity) && (
                    <option value={item.quantity}>{quantityLabel(item.quantity)}</option>
                  )}
                  {QUANTITY_OPTIONS.map((quantity) => (
                    <option key={quantity} value={quantity}>{quantityLabel(quantity)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-black">
                Horaires proposés
                <input
                  value={item.times.join(", ")}
                  onChange={(e) => {
                    const times = e.target.value
                      .split(",")
                      .map((time) => time.trim())
                      .filter(Boolean);
                    updateItem(item.id, {
                      times,
                      time: times[0] || item.time,
                    });
                  }}
                  placeholder="08:00, 13:00, 20:00"
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                />
              </label>
              <label className="text-sm font-black">
                Stock initial
                <input
                  value={item.stock}
                  onChange={(e) =>
                    updateItem(item.id, {
                      stock: Math.max(0, Math.min(999, Number(e.target.value))),
                    })
                  }
                  type="number"
                  min="0"
                  step="0.25"
                  max="999"
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                />
              </label>
              <label className="text-sm font-black">
                Par rapport au repas
                <select
                  value={item.mealTiming}
                  onChange={(e) =>
                    updateItem(item.id, {
                      mealTiming: e.target
                        .value as PrescriptionItem["mealTiming"],
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                >
                  <option value="none">Non précisé</option>
                  <option value="before">Avant le repas</option>
                  <option value="during">Pendant le repas</option>
                  <option value="after">Après le repas</option>
                </select>
              </label>
              <label className="text-sm font-black">
                Début
                <input
                  value={item.startDate}
                  onChange={(e) =>
                    updateItem(item.id, { startDate: e.target.value })
                  }
                  type="date"
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                />
              </label>
              <label className="text-sm font-black">
                Fin
                <input
                  value={item.endDate}
                  onChange={(e) =>
                    updateItem(item.id, { endDate: e.target.value })
                  }
                  type="date"
                  min={item.startDate}
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                />
              </label>
            </div>
            <fieldset className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <legend className="text-sm font-black">Jours de prise</legend>
                <select
                  aria-label="Rythme des jours de prise"
                  value={item.days.length === 7 ? "all" : item.days.join(",") === "1,2,3,4,5" ? "week" : "custom"}
                  onChange={(event) => {
                    if (event.target.value === "all") updateItem(item.id, { days: ALL_DAYS });
                    if (event.target.value === "week") updateItem(item.id, { days: [1, 2, 3, 4, 5] });
                  }}
                  className="rounded-xl border border-[#ccdcd5] bg-white px-3 py-2 text-sm font-black text-[#176b50]"
                >
                  <option value="all">Tous les jours</option>
                  <option value="week">Du lundi au vendredi</option>
                  <option value="custom">Jours personnalisés</option>
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map(
                  (label, dayIndex) => (
                    <label
                      key={label}
                      className={`cursor-pointer rounded-xl border px-3 py-2 text-xs font-black ${item.days.includes(dayIndex) ? "border-[#90c8ae] bg-[#e2f5ea] text-[#176b50]" : "border-[#d5e2dc] bg-white text-[#60766e]"}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.days.includes(dayIndex)}
                        onChange={(e) =>
                          updateItem(item.id, {
                            days: e.target.checked
                              ? [...item.days, dayIndex].sort()
                              : item.days.filter((day) => day !== dayIndex),
                          })
                        }
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <label className="mt-4 flex items-center gap-3 rounded-xl bg-[#f3f7f4] p-4 text-sm font-black">
              <input
                type="checkbox"
                checked={item.asNeeded}
                onChange={(e) =>
                  updateItem(item.id, { asNeeded: e.target.checked })
                }
                className="h-5 w-5"
              />
              Traitement « si besoin » — aucun rappel automatique
            </label>
            <label
              className={`mt-4 flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 text-sm font-black ${item.reviewed ? "border-[#90c8ae] bg-[#e2f5ea] text-[#176b50]" : "border-[#d5e2dc] bg-white text-[#37554b]"}`}
            >
              <input
                checked={item.reviewed}
                onChange={(e) =>
                  updateItem(item.id, { reviewed: e.target.checked })
                }
                type="checkbox"
                className="h-5 w-5"
              />
              {item.reviewed
                ? "Ligne vérifiée par l’aidant ✓"
                : "J’ai vérifié cette ligne avec l’ordonnance"}
            </label>
          </article>
        ))}
      </div>
      <button
        onClick={() =>
          setItems((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              name: "",
              dosage: "",
              quantity: 1,
              time: "12:00",
              stock: 14,
              unitsPerBox: 30,
              lowStockThreshold: 7,
              stockUpdatedAt: new Date().toISOString(),
              confidence: "high",
              reviewed: false,
              form: "comprimé",
              mealTiming: "none",
              days: [0, 1, 2, 3, 4, 5, 6],
              startDate: new Date().toISOString().slice(0, 10),
              endDate: new Date(Date.now() + 30 * 86400000)
                .toISOString()
                .slice(0, 10),
              asNeeded: false,
              times: ["12:00"],
              frequencyText: "1 fois par jour",
              durationText: "",
              cis: "", officialName: "", activeSubstances: "", administrationRoute: "", commercialStatus: "", officialPresentation: "",
            },
          ])
        }
        className="mt-4 w-full rounded-2xl border-2 border-dashed border-[#b8ccc3] px-5 py-4 font-black text-[#176b50]"
      >
        + Ajouter une ligne
      </button>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={saveDraft}
          className="rounded-2xl border-2 border-[#d5e2dc] bg-white px-5 py-4 font-black text-[#37554b]"
        >
          Enregistrer le brouillon
        </button>
        <button
          onClick={prepareValidation}
          className="rounded-2xl bg-[#176b50] px-5 py-4 font-black text-white"
        >
          Prévisualiser le nouveau calendrier
        </button>
      </div>
      {proposedDoses && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="calendar-review-title"
          className="fixed inset-0 z-50 grid place-items-end bg-[#17362d]/55 p-3 sm:place-items-center"
        >
          <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-[#f3f7f4] p-5 shadow-2xl sm:p-7">
            <p className="text-sm font-black uppercase tracking-wide text-[#176b50]">
              Dernière vérification
            </p>
            <h2 id="calendar-review-title" className="mt-1 text-2xl font-black">
              Remplacer le programme actuel ?
            </h2>
            <p className="mt-2 text-sm font-medium text-[#657a72]">
              Comparez les horaires avant d’appliquer l’ordonnance. L’ancien
              programme sera conservé dans l’historique des versions.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#dce7e2] bg-white p-4">
                <p className="text-xs font-black uppercase text-[#71847d]">
                  Programme actuel · {currentDoses.length} prise
                  {currentDoses.length > 1 ? "s" : ""}
                </p>
                <div className="mt-3 space-y-2">
                  {currentDoses.map((dose) => (
                    <p
                      key={dose.id}
                      className="rounded-xl bg-[#f3f7f4] px-3 py-2 text-sm font-bold"
                    >
                      {dose.time} · {dose.label}
                    </p>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border-2 border-[#90c8ae] bg-white p-4">
                <p className="text-xs font-black uppercase text-[#176b50]">
                  Nouveau programme · {proposedDoses.length} prise
                  {proposedDoses.length > 1 ? "s" : ""}
                </p>
                <div className="mt-3 space-y-2">
                  {proposedDoses.map((dose) => (
                    <div
                      key={dose.id}
                      className="rounded-xl bg-[#e2f5ea] px-3 py-2"
                    >
                      <p className="text-sm font-black">
                        {dose.time} · {dose.label}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-[#527066]">
                        {dose.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-[#efc16d] bg-[#fff5dd] p-4 text-sm font-medium text-[#765b2b]">
              Cette validation organise les rappels. Elle ne remplace jamais la
              vérification d’un professionnel de santé.
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => setProposedDoses(null)}
                className="rounded-2xl border-2 border-[#d5e2dc] bg-white px-5 py-4 font-black text-[#37554b]"
              >
                Revenir corriger
              </button>
              <button
                onClick={applyValidation}
                className="rounded-2xl bg-[#176b50] px-5 py-4 font-black text-white"
              >
                Confirmer le remplacement
              </button>
            </div>
          </section>
        </div>
      )}
      {prescription && (
        <p className="mt-4 text-center text-sm font-bold text-[#6b8078]">
          Statut :{" "}
          {prescription.status === "validated" ? "Validée" : "Brouillon"} · mise
          à jour {new Date(prescription.updatedAt).toLocaleString("fr-FR")}
        </p>
      )}
    </section>
  );
}

function PrescriptionVersions({
  current,
  versions,
  onRestore,
}: {
  current: Prescription;
  versions: NonNullable<Prescription>[];
  onRestore: (prescription: NonNullable<Prescription>) => void;
}) {
  if (!current && versions.length === 0) return null;
  const daysLeft = current?.validUntil
    ? Math.ceil(
        (new Date(current.validUntil).getTime() - Date.now()) / 86400000,
      )
    : null;
  return (
    <section className="mx-auto -mt-24 max-w-3xl px-5 pb-32">
      {current?.status === "validated" &&
        daysLeft !== null &&
        daysLeft <= 7 && (
          <div className="mb-4 rounded-2xl border border-[#efc16d] bg-[#fff5dd] p-4">
            <p className="font-black text-[#865e19]">
              Renouvellement à vérifier
            </p>
            <p className="mt-1 text-sm font-medium text-[#765b2b]">
              Échéance estimée dans {Math.max(0, daysLeft)} jour
              {daysLeft > 1 ? "s" : ""}. Confirmez toujours cette date avec la
              pharmacie.
            </p>
          </div>
        )}
      <div className="rounded-3xl border border-[#dce7e2] bg-white p-5">
        <p className="text-sm font-black uppercase tracking-wide text-[#176b50]">
          Versions de l’ordonnance
        </p>
        <div className="mt-3 space-y-2">
          {current && (
            <div className="flex items-center justify-between rounded-xl bg-[#edf5f1] p-3">
              <div>
                <p className="font-black">Version actuelle</p>
                <p className="text-xs font-medium text-[#6d817a]">
                  Du {new Date(current.issuedAt).toLocaleDateString("fr-FR")} ·{" "}
                  {current.items.length} ligne
                  {current.items.length > 1 ? "s" : ""}
                </p>
              </div>
              <span className="text-xs font-black text-[#176b50]">
                {current.status === "validated" ? "VALIDÉE" : "BROUILLON"}
              </span>
            </div>
          )}
          {versions.map((version, index) => (
            <div
              key={`${version.id}-${version.updatedAt}`}
              className="flex items-center justify-between rounded-xl border border-[#e6eeea] p-3"
            >
              <div>
                <p className="font-bold">
                  Version précédente {versions.length - index}
                </p>
                <p className="text-xs font-medium text-[#6d817a]">
                  Du {new Date(version.issuedAt).toLocaleDateString("fr-FR")} ·
                  archivée{" "}
                  {new Date(version.updatedAt).toLocaleDateString("fr-FR")}
                </p>
              </div>
              <button
                onClick={() => onRestore(version)}
                className="rounded-xl bg-[#edf5f1] px-3 py-2 text-xs font-black text-[#176b50]"
              >
                Restaurer
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PilotView({
  pilot,
  role,
  doses,
  history,
  savePilot,
}: {
  pilot: Pilot;
  role: Role;
  doses: Dose[];
  history: HistoryEvent[];
  savePilot: (pilot: Pilot) => void;
}) {
  const [ease, setEase] = useState(4);
  const [confidence, setConfidence] = useState(4);
  const [continueUse, setContinueUse] = useState(true);
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState("");
  const day = pilot.startedAt
    ? Math.min(
        14,
        Math.max(
          1,
          Math.floor(
            (Date.now() - new Date(pilot.startedAt).getTime()) / 86400000,
          ) + 1,
        ),
      )
    : 0;
  const milestone: 1 | 7 | 14 = day >= 14 ? 14 : day >= 7 ? 7 : 1;
  const submitted = pilot.feedback.some(
    (item) => item.day === milestone && item.role === role,
  );
  const adherence = day
    ? Math.min(
        100,
        Math.round(
          (history.filter((item) => !item.outcome || item.outcome === "taken")
            .length /
            Math.max(1, day * doses.length)) *
            100,
        ),
      )
    : 0;
  const averageEase = pilot.feedback.length
    ? (
        pilot.feedback.reduce((sum, item) => sum + item.ease, 0) /
        pilot.feedback.length
      ).toFixed(1)
    : "—";
  const averageConfidence = pilot.feedback.length
    ? (
        pilot.feedback.reduce((sum, item) => sum + item.confidence, 0) /
        pilot.feedback.length
      ).toFixed(1)
    : "—";
  const wantsToContinue = pilot.feedback.filter(
    (item) => item.continueUse,
  ).length;
  const missedCount = history.filter(
    (item) => item.outcome === "missed",
  ).length;
  const refusedCount = history.filter(
    (item) => item.outcome === "refused",
  ).length;
  const submitFeedback = () => {
    const item: PilotFeedback = {
      id: crypto.randomUUID(),
      day: milestone,
      role,
      ease,
      confidence,
      continueUse,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };
    savePilot({
      ...pilot,
      feedback: [
        item,
        ...pilot.feedback.filter(
          (f) => !(f.day === milestone && f.role === role),
        ),
      ],
    });
    setNote("");
  };
  const submitIssue = () => {
    if (!issue.trim()) return;
    savePilot({
      ...pilot,
      issues: [
        {
          id: crypto.randomUUID(),
          role,
          note: issue.trim(),
          createdAt: new Date().toISOString(),
        },
        ...pilot.issues,
      ],
    });
    setIssue("");
  };
  if (!pilot.startedAt)
    return (
      <section className="mx-auto max-w-lg px-5 pb-32">
        <div className="rounded-[2rem] bg-[#17362d] p-7 text-white">
          <p className="text-sm font-black uppercase tracking-wide text-[#b9d6ca]">
            Phase 1
          </p>
          <h1 className="mt-2 text-3xl font-black">
            Pilote familial de 14 jours
          </h1>
          <p className="mt-3 leading-relaxed text-[#d5e4de]">
            Mesurez l’autonomie du patient, la fiabilité des alertes et
            l’utilité réelle pour l’aidant.
          </p>
          <button
            onClick={() =>
              savePilot({
                startedAt: new Date().toISOString(),
                feedback: [],
                issues: [],
              })
            }
            className="mt-6 w-full rounded-2xl bg-[#d8f36a] px-5 py-4 text-lg font-black text-[#17362d]"
          >
            Démarrer le pilote
          </button>
        </div>
        <div className="mt-5 rounded-3xl border border-[#dce7e2] bg-white p-5">
          <p className="font-black">Avant de commencer</p>
          <ul className="mt-3 space-y-2 text-sm font-medium text-[#62776f]">
            <li>✓ Utiliser des données fictives</li>
            <li>✓ Tester sur deux téléphones</li>
            <li>✓ Ne pas modifier une prescription</li>
            <li>✓ Noter chaque difficulté observée</li>
          </ul>
        </div>
      </section>
    );
  return (
    <section className="mx-auto max-w-3xl px-5 pb-32">
      <div className="mb-5 flex items-end justify-between rounded-3xl bg-[#17362d] p-6 text-white">
        <div>
          <p className="text-sm font-bold text-[#b9d6ca]">PILOTE EN COURS</p>
          <h1 className="mt-1 text-3xl font-black">Jour {day} sur 14</h1>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black text-[#d8f36a]">
            {Math.round((day / 14) * 100)}%
          </p>
          <p className="text-xs font-bold text-[#b9d6ca]">du test</p>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-black">{adherence}%</p>
          <p className="text-xs font-bold text-[#6d817a]">confirmations</p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-black">{averageEase}</p>
          <p className="text-xs font-bold text-[#6d817a]">facilité / 5</p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-black">{pilot.issues.length}</p>
          <p className="text-xs font-bold text-[#6d817a]">difficultés</p>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-3xl border border-[#dce7e2] bg-white p-5">
          <p className="text-sm font-black uppercase tracking-wide text-[#176b50]">
            Questionnaire J{milestone} ·{" "}
            {role === "patient" ? "Patient" : "Aidant"}
          </p>
          {submitted ? (
            <div className="py-8 text-center">
              <div className="text-3xl">✓</div>
              <p className="mt-2 font-black">Réponses enregistrées</p>
              <p className="mt-1 text-sm font-medium text-[#71847d]">
                Prochaine étape : J{milestone === 1 ? 7 : 14}.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-black">
                Facilité d’utilisation
                <select
                  value={ease}
                  onChange={(e) => setEase(Number(e.target.value))}
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                >
                  <option value={1}>1 — Très difficile</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5 — Très simple</option>
                </select>
              </label>
              <label className="block text-sm font-black">
                Confiance dans les informations
                <select
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"
                >
                  <option value={1}>1 — Aucune</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5 — Totale</option>
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm font-black">
                <input
                  checked={continueUse}
                  onChange={(e) => setContinueUse(e.target.checked)}
                  type="checkbox"
                  className="h-5 w-5"
                />
                Je souhaite continuer à utiliser MedConnect
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Votre remarque principale…"
                className="min-h-24 w-full rounded-xl border border-[#ccdcd5] p-3"
              />
              <button
                onClick={submitFeedback}
                className="w-full rounded-xl bg-[#176b50] px-4 py-3 font-black text-white"
              >
                Enregistrer mes réponses
              </button>
            </div>
          )}
        </div>
        <div className="rounded-3xl border border-[#dce7e2] bg-white p-5">
          <p className="text-sm font-black uppercase tracking-wide text-[#a84747]">
            Journal des difficultés
          </p>
          <textarea
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            maxLength={500}
            placeholder="Décrivez un oubli, une fausse alerte ou une confusion…"
            className="mt-4 min-h-28 w-full rounded-xl border border-[#ccdcd5] p-3"
          />
          <button
            onClick={submitIssue}
            className="mt-3 w-full rounded-xl border-2 border-[#d5e2dc] px-4 py-3 font-black text-[#37554b]"
          >
            Ajouter au journal
          </button>
          <div className="mt-4 max-h-44 space-y-2 overflow-auto">
            {pilot.issues.map((item) => (
              <div
                key={item.id}
                className="rounded-xl bg-[#fff7f5] p-3 text-sm"
              >
                <p className="font-bold">
                  {item.role === "patient" ? "Patient" : "Aidant"} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                </p>
                <p className="mt-1 text-[#6f5d58]">{item.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      {day >= 14 && (
        <div className="mt-5 rounded-3xl border-2 border-[#90c8ae] bg-[#e2f5ea] p-6">
          <p className="text-sm font-black uppercase tracking-wide text-[#176b50]">
            Bilan final · Phase 1
          </p>
          <h2 className="mt-1 text-2xl font-black">
            Résultats du pilote familial
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-white p-3 text-center">
              <p className="text-xl font-black">{adherence}%</p>
              <p className="text-xs font-bold text-[#6d817a]">
                prises confirmées
              </p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center">
              <p className="text-xl font-black">{averageConfidence}/5</p>
              <p className="text-xs font-bold text-[#6d817a]">confiance</p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center">
              <p className="text-xl font-black">{missedCount + refusedCount}</p>
              <p className="text-xs font-bold text-[#6d817a]">
                écarts déclarés
              </p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center">
              <p className="text-xl font-black">
                {wantsToContinue}/{pilot.feedback.length}
              </p>
              <p className="text-xs font-bold text-[#6d817a]">
                veulent continuer
              </p>
            </div>
          </div>
          <p className="mt-4 font-bold text-[#386553]">
            {adherence >= 80 && pilot.issues.length <= 5
              ? "Signal favorable : le pilote atteint les principaux critères de poursuite."
              : "Des ajustements sont recommandés avant d’élargir le test à d’autres familles."}
          </p>
        </div>
      )}
      <div className="mt-5 rounded-2xl bg-[#edf5f1] p-4 text-sm font-medium text-[#547066]">
        Critères visés : utilisation autonome, au moins 80 % des prises
        confirmées, peu de fausses alertes et volonté de continuer après 14
        jours.
      </div>
    </section>
  );
}

function PatientProfileView({
  profile,
  onSave,
}: {
  profile: PatientProfile;
  onSave: (profile: PatientProfile) => void;
}) {
  const [form, setForm] = useState(profile);
  const update = (field: keyof PatientProfile, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const saveProfile = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.birthDate) {
      window.alert("Renseignez le prénom, le nom et la date de naissance.");
      return;
    }
    onSave({
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      emergencyName: form.emergencyName.trim(),
      emergencyPhone: form.emergencyPhone.trim(),
      notes: form.notes.trim(),
      updatedAt: new Date().toISOString(),
    });
    window.alert("Fiche patient enregistrée.");
  };
  return (
    <section className="mx-auto max-w-3xl px-5 pb-32">
      <div className="mb-5 rounded-3xl bg-[#17362d] p-6 text-white">
        <p className="text-sm font-black uppercase tracking-wide text-[#b9d6ca]">
          Espace Aidant
        </p>
        <h1 className="mt-1 text-3xl font-black">Fiche patient</h1>
        <p className="mt-2 max-w-xl font-medium text-[#d5e4de]">
          Ces informations personnalisent le suivi familial. Pour ce pilote public, utilisez uniquement des données fictives.
        </p>
      </div>
      <div className="rounded-3xl border border-[#dce7e2] bg-white p-5">
        <h2 className="text-xl font-black">Identité</h2>
        <p className="mt-1 text-sm font-medium text-[#60766e]">Les champs marqués * sont nécessaires.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-black">Prénom *
            <input value={form.firstName} onChange={(e) => update("firstName", e.target.value)} maxLength={50} autoComplete="off" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" />
          </label>
          <label className="text-sm font-black">Nom *
            <input value={form.lastName} onChange={(e) => update("lastName", e.target.value)} maxLength={60} autoComplete="off" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" />
          </label>
          <label className="text-sm font-black">Date de naissance *
            <input value={form.birthDate} onChange={(e) => update("birthDate", e.target.value)} type="date" max={new Date().toISOString().slice(0, 10)} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" />
          </label>
          <label className="text-sm font-black">Téléphone
            <input value={form.phone} onChange={(e) => update("phone", e.target.value)} type="tel" inputMode="tel" maxLength={30} placeholder="06 00 00 00 00" autoComplete="off" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" />
          </label>
        </div>
      </div>
      <div className="mt-5 rounded-3xl border border-[#dce7e2] bg-white p-5">
        <h2 className="text-xl font-black">Personne à prévenir</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-black">Nom et lien avec le patient
            <input value={form.emergencyName} onChange={(e) => update("emergencyName", e.target.value)} maxLength={80} placeholder="Ex. Camille, sa fille" autoComplete="off" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" />
          </label>
          <label className="text-sm font-black">Téléphone
            <input value={form.emergencyPhone} onChange={(e) => update("emergencyPhone", e.target.value)} type="tel" inputMode="tel" maxLength={30} placeholder="06 00 00 00 00" autoComplete="off" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" />
          </label>
        </div>
        <label className="mt-4 block text-sm font-black">Note utile au suivi
          <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} maxLength={300} placeholder="Ex. préfère être appelée le matin" className="mt-2 min-h-24 w-full rounded-xl border border-[#ccdcd5] p-3" />
        </label>
      </div>
      <button onClick={saveProfile} className="mt-5 w-full rounded-2xl bg-[#176b50] px-5 py-4 text-lg font-black text-white">
        Enregistrer la fiche patient
      </button>
    </section>
  );
}

function MyMedicationsView({ prescription }: { prescription: Prescription }) {
  const dayNames = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const items = prescription?.items ?? [];
  return (
    <section className="mx-auto max-w-lg px-5 pb-40">
      <div className="mb-5">
        <p className="text-sm font-black uppercase tracking-[.14em] text-[#176b50]">Mon traitement</p>
        <h1 className="mt-1 text-3xl font-black tracking-[-.035em]">Mes médicaments</h1>
        <p className="mt-2 font-medium text-[#60766e]">Les informations validées par votre aidant à partir de l’ordonnance.</p>
      </div>
      {items.length === 0 ? (
        <div className="rounded-3xl border border-[#dce7e2] bg-white p-7 text-center">
          <p className="text-xl font-black">Aucun médicament enregistré</p>
          <p className="mt-2 text-sm font-medium text-[#60766e]">Votre aidant doit d’abord ajouter et vérifier l’ordonnance.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <details key={item.id} className="group rounded-3xl border border-white bg-white p-5 shadow-[0_12px_35px_rgba(35,72,60,.07)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <MedicationVisual form={item.form} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xl font-black">{item.name}</span>
                  <span className="mt-1 block font-bold text-[#176b50]">{item.dosage} · {quantityLabel(item.quantity)} {item.form}{item.quantity > 1 ? "s" : ""}</span>
                </span>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#edf5f1] text-xl font-black text-[#176b50] group-open:rotate-45">+</span>
              </summary>
              <div className="mt-4 grid gap-3 border-t border-[#edf2ef] pt-4 text-sm sm:grid-cols-2">
                <div className="rounded-2xl bg-[#f3f7f4] p-3"><p className="font-black">Horaires</p><p className="mt-1 font-medium text-[#60766e]">{item.asNeeded ? "Si besoin, sans rappel" : item.times.join(" · ")}</p></div>
                <div className="rounded-2xl bg-[#f3f7f4] p-3"><p className="font-black">Fréquence</p><p className="mt-1 font-medium text-[#60766e]">{item.frequencyText || (item.asNeeded ? "Selon le besoin" : "Selon les horaires")}</p></div>
                <div className="rounded-2xl bg-[#f3f7f4] p-3"><p className="font-black">Jours de prise</p><p className="mt-1 font-medium text-[#60766e]">{item.days.length === 7 ? "Tous les jours" : item.days.map((day) => dayNames[day]).join(" · ")}</p></div>
                <div className="rounded-2xl bg-[#f3f7f4] p-3"><p className="font-black">Durée</p><p className="mt-1 font-medium text-[#60766e]">{item.durationText || `Du ${item.startDate} au ${item.endDate}`}</p></div>
              </div>
              {item.cis && <div className="mt-3 rounded-2xl border border-[#dce7e2] bg-[#f7faf8] p-4 text-sm"><p className="font-black text-[#176b50]">Fiche officielle vérifiée · CIS {item.cis}</p><p className="mt-1 font-medium text-[#60766e]">{item.activeSubstances || "Substance non renseignée"}{item.administrationRoute ? ` · voie ${item.administrationRoute}` : ""}</p><p className="mt-1 text-xs font-bold text-[#71847d]">{item.commercialStatus}</p><a href={officialNoticeUrl(item.cis)} target="_blank" rel="noreferrer" className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-[#176b50] px-4 text-center font-black text-white">Consulter la notice officielle ↗</a><p className="mt-2 text-xs font-medium text-[#71847d]">La notice s’ouvre sur le site public officiel des médicaments.</p></div>}
            </details>
          ))}
        </div>
      )}
      <p className="mt-5 rounded-2xl bg-[#fff5dd] p-4 text-sm font-medium text-[#765b2b]">En cas de doute, ne modifiez pas votre traitement vous-même et contactez votre aidant ou un professionnel de santé.</p>
    </section>
  );
}

function TreatmentManager({
  prescription,
  onApply,
  openPrescription,
}: {
  prescription: Prescription;
  onApply: (items: PrescriptionItem[]) => void;
  openPrescription: () => void;
}) {
  const [items, setItems] = useState<PrescriptionItem[]>(prescription?.items ?? []);
  const [lookupId, setLookupId] = useState("");
  const [lookupResults, setLookupResults] = useState<MedicationResult[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<MedicationResult[]>([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [newItemId, setNewItemId] = useState("");
  const update = (id: string, changes: Partial<PrescriptionItem>) =>
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes, reviewed: false } : item));
  const addItem = (result?: MedicationResult) => {
    const today = new Date().toISOString().slice(0, 10);
    const id = crypto.randomUUID();
    const dosageMatch = result?.name.match(/\b(\d+(?:[,.]\d+)?\s*(?:mg|g|µg|ml))\b/i);
    const form = result ? result.form.toLowerCase().includes("gélule") ? "gélule" : result.form.toLowerCase().includes("comprimé") ? "comprimé" : result.form.toLowerCase().includes("sachet") ? "sachet" : result.form.toLowerCase().includes("solution") ? "ml" : "autre" : "comprimé";
    setItems((current) => [...current, {
      id, name: result?.name.split(",")[0].slice(0, 80) ?? "", dosage: dosageMatch?.[1] ?? "", quantity: 1, time: "08:00", times: ["08:00"],
      stock: 14, unitsPerBox: 30, lowStockThreshold: 7, stockUpdatedAt: new Date().toISOString(), confidence: "high", reviewed: false, form, mealTiming: "none",
      days: ALL_DAYS, startDate: today, endDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      asNeeded: false, frequencyText: "1 fois par jour", durationText: "",
      cis: result?.cis ?? "", officialName: result?.name.slice(0, 200) ?? "", activeSubstances: result?.substances.join(", ").slice(0, 300) ?? "", administrationRoute: result?.routes.join(", ").slice(0, 100) ?? "", commercialStatus: result?.status.slice(0, 80) ?? "", officialPresentation: result?.presentation.slice(0, 300) ?? "",
    }]);
    if (result) updateAfterAdd(id, form);
  };
  const updateAfterAdd = (id: string, form: string) => {
    void form;
    setNewItemId(id); setAddOpen(false); setAddQuery(""); setAddResults([]); setAddError("");
    window.setTimeout(() => document.getElementById(`treatment-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };
  const searchToAdd = async () => {
    if (addQuery.trim().length < 2) return setAddError("Saisissez au moins le nom du médicament.");
    setAddLoading(true); setAddError(""); setAddResults([]);
    try { const results = await searchMedicationDatabase(addQuery); setAddResults(results); if (!results.length) setAddError("Aucun résultat. Vérifiez l’orthographe ou essayez sans le dosage."); }
    catch (error) { setAddError(error instanceof Error ? error.message : "Recherche indisponible."); }
    finally { setAddLoading(false); }
  };
  const lookup = async (item: PrescriptionItem) => {
    if (item.name.trim().length < 2) return window.alert("Renseignez d’abord le nom du médicament.");
    setLookupId(item.id); setLookupLoading(true); setLookupResults([]); setLookupError("");
    try {
      const results = await searchMedicationDatabase(`${item.name} ${item.dosage}`);
      setLookupResults(results);
      if (!results.length) setLookupError("Aucune correspondance. Essayez avec le nom seul ou corrigez le dosage.");
    } catch (error) { setLookupError(error instanceof Error ? error.message : "Recherche indisponible."); }
    finally { setLookupLoading(false); }
  };
  const selectOfficial = (item: PrescriptionItem, result: MedicationResult) => {
    const simpleForm = result.form.toLowerCase().includes("gélule") ? "gélule" : result.form.toLowerCase().includes("comprimé") ? "comprimé" : result.form.toLowerCase().includes("sachet") ? "sachet" : result.form.toLowerCase().includes("solution") ? "ml" : item.form;
    update(item.id, { cis: result.cis, officialName: result.name, activeSubstances: result.substances.join(", "), administrationRoute: result.routes.join(", "), commercialStatus: result.status, officialPresentation: result.presentation, form: simpleForm });
    setLookupId(""); setLookupResults([]);
  };
  const save = () => {
    if (!items.length || items.some((item) => !item.name.trim() || !item.dosage.trim() || !item.days.length || item.startDate > item.endDate || (!item.asNeeded && !item.times.length))) {
      window.alert("Vérifiez le nom, le dosage, les jours, les dates et les horaires de chaque médicament.");
      return;
    }
    if (!window.confirm("Appliquer ces modifications au traitement en cours et recalculer le programme Patient ?")) return;
    onApply(items.map((item) => ({ ...item, name: item.name.trim(), dosage: item.dosage.trim(), reviewed: true })));
  };
  return (
    <section className="mx-auto max-w-6xl px-5 pb-40">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-black uppercase tracking-[.14em] text-[#176b50]">Administration</p><h1 className="mt-1 text-3xl font-black tracking-[-.035em] sm:text-4xl">Traitements en cours</h1><p className="mt-2 font-medium text-[#60766e]">Modifiez les informations réellement affichées et planifiées côté Patient.</p></div>
        <button onClick={openPrescription} className="rounded-2xl border border-[#d5e2dc] bg-white px-5 py-3.5 font-black text-[#176b50]">Scanner ou consulter l’ordonnance</button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-3xl border border-[#dce7e2] bg-white p-8 text-center"><p className="text-xl font-black">Aucun traitement enregistré</p><button onClick={openPrescription} className="mt-4 rounded-xl bg-[#176b50] px-5 py-3 font-black text-white">Ajouter une ordonnance</button></div>
      ) : (
        <div className="space-y-4">
          {items.map((item, index) => (
            <article id={`treatment-${item.id}`} key={item.id} className={`scroll-mt-24 rounded-3xl bg-white p-5 shadow-[0_12px_35px_rgba(35,72,60,.07)] ${newItemId === item.id ? "border-2 border-[#90c8ae]" : "border border-white"}`}>
              {newItemId === item.id && <div className="mb-5 rounded-2xl bg-[#e2f5ea] p-4"><p className="text-xs font-black uppercase tracking-[.14em] text-[#176b50]">Étape 2 sur 2</p><p className="mt-1 text-lg font-black">Complétez la prise</p><p className="mt-1 text-sm font-medium text-[#527066]">La référence officielle est sélectionnée. Vérifiez maintenant le dosage, la quantité, les horaires, les dates et le stock.</p></div>}
              <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-[#71847d]">Médicament {index + 1}</p><p className="mt-1 text-xl font-black">{item.name || "Nouveau médicament"}</p></div><button onClick={() => { if (window.confirm(`Retirer ${item.name || "ce médicament"} du traitement en cours ?`)) setItems((current) => current.filter((line) => line.id !== item.id)); }} className="rounded-xl px-3 py-2 text-sm font-black text-[#a84747] hover:bg-[#fff0eb]">Retirer</button></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-black">Nom<input value={item.name} onChange={(e) => update(item.id, { name: e.target.value })} maxLength={80} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" /></label>
                <label className="text-sm font-black">Dosage<input value={item.dosage} onChange={(e) => update(item.id, { dosage: e.target.value })} maxLength={80} placeholder="Ex. 500 mg" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" /></label>
                <label className="text-sm font-black">Quantité par prise<select value={item.quantity} onChange={(e) => update(item.id, { quantity: Number(e.target.value) })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3">{QUANTITY_OPTIONS.map((quantity) => <option key={quantity} value={quantity}>{quantityLabel(quantity)}</option>)}</select></label>
                <label className="text-sm font-black">Forme<select value={item.form} onChange={(e) => update(item.id, { form: e.target.value })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"><option value="comprimé">Comprimé</option><option value="gélule">Gélule</option><option value="sachet">Sachet</option><option value="dose">Dose</option><option value="ml">ml</option><option value="autre">Autre</option></select></label>
                <label className="text-sm font-black">Horaires<input value={item.times.join(", ")} disabled={item.asNeeded} onChange={(e) => { const times = e.target.value.split(",").map((time) => time.trim()).filter(Boolean); update(item.id, { times, time: times[0] || item.time }); }} placeholder="08:00, 20:00" className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3 disabled:bg-[#edf2ef]" /></label>
                <label className="text-sm font-black">Unités par boîte<input value={item.unitsPerBox} type="number" min="1" max="500" onChange={(e) => update(item.id, { unitsPerBox: Math.max(1, Math.min(500, Number(e.target.value))) })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" /></label>
                <label className="text-sm font-black">Alerte sous<input value={item.lowStockThreshold} type="number" min="0" max="500" onChange={(e) => update(item.id, { lowStockThreshold: Math.max(0, Math.min(500, Number(e.target.value))) })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" /></label>
                <label className="text-sm font-black">Début<input value={item.startDate} type="date" onChange={(e) => update(item.id, { startDate: e.target.value })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" /></label>
                <label className="text-sm font-black">Fin<input value={item.endDate} type="date" min={item.startDate} onChange={(e) => update(item.id, { endDate: e.target.value })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3" /></label>
                <label className="text-sm font-black">Par rapport au repas<select value={item.mealTiming} onChange={(e) => update(item.id, { mealTiming: e.target.value as PrescriptionItem["mealTiming"] })} className="mt-2 w-full rounded-xl border border-[#ccdcd5] px-3 py-3"><option value="none">Non précisé</option><option value="before">Avant</option><option value="during">Pendant</option><option value="after">Après</option></select></label>
                <label className="flex items-center gap-3 self-end rounded-xl bg-[#f3f7f4] p-3 text-sm font-black"><input type="checkbox" checked={item.asNeeded} onChange={(e) => update(item.id, { asNeeded: e.target.checked, times: e.target.checked ? [] : item.times.length ? item.times : ["08:00"] })} className="h-5 w-5" />Si besoin, sans rappel</label>
              </div>
              <div className="mt-4 rounded-2xl border border-[#cfe2d9] bg-[#f3f7f4] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3"><MedicationVisual form={item.form} /><div><p className="font-black">Fiche médicament française</p><p className="text-sm font-medium text-[#60766e]">{item.cis ? `Liée au CIS ${item.cis} · ${item.activeSubstances}` : "Retrouvez la référence exacte avant de l’associer."}</p></div></div>
                  <button type="button" onClick={() => lookup(item)} disabled={lookupLoading && lookupId === item.id} className="rounded-xl border border-[#90c8ae] bg-white px-4 py-3 text-sm font-black text-[#176b50] disabled:opacity-50">{lookupLoading && lookupId === item.id ? "Recherche…" : item.cis ? "Changer la référence" : "Rechercher la fiche"}</button>
                </div>
                {lookupId === item.id && <div className="mt-4 border-t border-[#dce7e2] pt-4">{lookupError && <p className="rounded-xl bg-[#fff0eb] p-3 text-sm font-bold text-[#a84747]">{lookupError}</p>}{lookupResults.length > 0 && <div className="space-y-2"><p className="text-xs font-black uppercase tracking-wider text-[#60766e]">Sélection obligatoire par l’aidant</p>{lookupResults.map((result) => <button type="button" key={result.cis} onClick={() => selectOfficial(item, result)} className="w-full rounded-xl border border-[#d5e2dc] bg-white p-3 text-left hover:border-[#90c8ae]"><span className="block font-black">{result.name}</span><span className="mt-1 block text-xs font-bold text-[#60766e]">{result.form} · {result.status} · CIS {result.cis}</span></button>)}</div>}<button type="button" onClick={() => { setLookupId(""); setLookupResults([]); }} className="mt-3 text-sm font-black text-[#60766e]">Fermer</button></div>}
                <p className="mt-3 text-xs font-medium text-[#71847d]">Source : Base de données publique des médicaments. L’illustration indique seulement la forme et ne permet pas d’identifier un comprimé.</p>
                {item.cis && <a href={officialNoticeUrl(item.cis)} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[#17362d] px-4 text-sm font-black text-white">Ouvrir la notice officielle ↗</a>}
              </div>
              <div className={`mt-4 rounded-2xl border p-4 ${item.stock <= item.lowStockThreshold ? "border-[#efc16d] bg-[#fff5dd]" : "border-[#dce7e2] bg-[#f3f7f4]"}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-[#71847d]">Stock disponible</p>
                    <p className="mt-1 text-3xl font-black">{item.stock} <span className="text-base text-[#60766e]">unité{item.stock > 1 ? "s" : ""}</span></p>
                    <p className="mt-1 text-sm font-bold text-[#60766e]">
                      {item.asNeeded || item.times.length === 0 ? "Autonomie non estimable pour un traitement si besoin" : `Environ ${Math.floor(item.stock / Math.max(.01, item.quantity * item.times.length * item.days.length / 7))} jour(s) d’autonomie`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => update(item.id, { stock: Math.min(999, item.stock + item.unitsPerBox), stockUpdatedAt: new Date().toISOString() })} className="rounded-xl bg-[#176b50] px-4 py-3 text-sm font-black text-white">+ Ajouter une boîte</button>
                    <button type="button" onClick={() => { const value = window.prompt("Nombre exact d’unités disponibles", String(item.stock)); const amount = Number(value?.replace(",", ".")); if (value !== null && Number.isFinite(amount) && amount >= 0) update(item.id, { stock: Math.min(999, Math.round(amount * 4) / 4), stockUpdatedAt: new Date().toISOString() }); }} className="rounded-xl border border-[#ccdcd5] bg-white px-4 py-3 text-sm font-black text-[#37554b]">Corriger le stock</button>
                  </div>
                </div>
              </div>
              <fieldset className="mt-4"><legend className="text-sm font-black">Jours de prise</legend><div className="mt-2 flex flex-wrap gap-2">{["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((label, day) => <label key={label} className={`cursor-pointer rounded-xl border px-3 py-2 text-xs font-black ${item.days.includes(day) ? "border-[#90c8ae] bg-[#e2f5ea] text-[#176b50]" : "border-[#d5e2dc] text-[#60766e]"}`}><input type="checkbox" className="sr-only" checked={item.days.includes(day)} onChange={(e) => update(item.id, { days: e.target.checked ? [...item.days, day].sort() : item.days.filter((value) => value !== day) })} />{label}</label>)}</div></fieldset>
            </article>
          ))}
        </div>
      )}
      <button onClick={() => { setAddOpen(true); setAddError(""); setAddResults([]); }} className="mt-4 w-full rounded-2xl border-2 border-dashed border-[#90c8ae] bg-[#f7faf8] px-5 py-5 text-lg font-black text-[#176b50]">+ Rechercher et ajouter un médicament</button>
      {items.length > 0 && <button onClick={save} className="mt-4 w-full rounded-2xl bg-[#176b50] px-5 py-4 text-lg font-black text-white shadow-[0_12px_28px_rgba(23,107,80,.2)]">Enregistrer et mettre à jour le programme Patient</button>}
      {addOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#10271f]/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="add-medication-title">
        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl sm:rounded-[2rem] sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.14em] text-[#176b50]">Étape 1 sur 2</p><h2 id="add-medication-title" className="mt-1 text-2xl font-black">Quel médicament ajouter ?</h2><p className="mt-2 text-sm font-medium text-[#60766e]">Commencez par la référence officielle. La posologie sera demandée juste après.</p></div><button type="button" onClick={() => setAddOpen(false)} aria-label="Fermer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#edf2ef] text-xl font-black">×</button></div>
          <form onSubmit={(event) => { event.preventDefault(); searchToAdd(); }} className="mt-6 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="medication-search">Nom du médicament</label><input id="medication-search" autoFocus value={addQuery} onChange={(event) => setAddQuery(event.target.value)} placeholder="Ex. Amoxicilline 500 mg" className="min-h-14 flex-1 rounded-2xl border-2 border-[#b8ccc3] px-4 text-lg font-bold outline-none focus:border-[#176b50]" /><button disabled={addLoading} className="min-h-14 rounded-2xl bg-[#176b50] px-6 font-black text-white disabled:opacity-50">{addLoading ? "Recherche…" : "Rechercher"}</button></form>
          <p className="mt-2 text-xs font-bold text-[#71847d]">Astuce : ajoutez le dosage pour obtenir des résultats plus précis.</p>
          {addError && <p className="mt-4 rounded-2xl bg-[#fff0eb] p-4 text-sm font-bold text-[#a84747]">{addError}</p>}
          {addResults.length > 0 && <div className="mt-5 space-y-3"><p className="text-xs font-black uppercase tracking-wider text-[#60766e]">Choisissez la ligne inscrite sur la boîte ou l’ordonnance</p>{addResults.map((result) => <button type="button" key={result.cis} onClick={() => addItem(result)} className="flex w-full items-center gap-3 rounded-2xl border-2 border-[#e0e9e5] p-4 text-left hover:border-[#90c8ae] hover:bg-[#f7faf8]"><MedicationVisual form={result.form} /><span className="min-w-0 flex-1"><span className="block font-black leading-snug">{result.name}</span><span className="mt-1 block text-xs font-bold text-[#60766e]">{result.form} · {result.status} · CIS {result.cis}</span></span><span className="text-2xl font-black text-[#176b50]">›</span></button>)}</div>}
          <p className="mt-5 border-t border-[#edf2ef] pt-4 text-xs font-medium text-[#71847d]">Données issues de la Base de données publique des médicaments. Vérifiez toujours la référence avant de continuer.</p>
        </div>
      </div>}
    </section>
  );
}

export default function Home() {
  const [role, setRole] = useState<Role>("patient");
  const [doses, setDoses] = useState<Dose[]>(initialDoses);
  const [token, setToken] = useState<string | null>(null);
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [appOrigin, setAppOrigin] = useState("");
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [tab, setTab] = useState<Tab>("today");
  const [reminders, setReminders] = useState(true);
  const [settings, setSettings] = useState<Settings>({ alertDelay: 30 });
  const [help, setHelp] = useState<HelpRequest>(null);
  const [patientReminder, setPatientReminder] = useState<PatientReminder>(null);
  const [pilot, setPilot] = useState<Pilot>({
    startedAt: null,
    feedback: [],
    issues: [],
  });
  const [prescription, setPrescription] = useState<Prescription>(null);
  const [prescriptionHistory, setPrescriptionHistory] = useState<
    NonNullable<Prescription>[]
  >([]);
  const [profile, setProfile] = useState<PatientProfile>({
    firstName: "",
    lastName: "",
    birthDate: "",
    phone: "",
    emergencyName: "",
    emergencyPhone: "",
    notes: "",
    updatedAt: "",
  });
  const notified = useRef(new Set<string>());
  const endpoint = useMemo(
    () =>
      token
        ? `/api/family?token=${encodeURIComponent(token)}${accessKey ? `&access=${encodeURIComponent(accessKey)}` : ""}`
        : "",
    [token, accessKey],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const family = params.get("family");
    let access = params.get("access");
    if (family && !access && params.get("role") === "aidant") {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      access = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      window.history.replaceState({}, "", `?family=${family}&access=${access}`);
    }
    setRole(access && params.get("view") === "patient" ? "patient" : access ? "aidant" : "patient");
    setAccessKey(access);
    setToken(family);
    setReady(true);
    setAppOrigin(window.location.origin);
    setReminders(window.localStorage.getItem("medconnect-reminders") !== "off");
  }, []);
  useEffect(() => {
    if (!endpoint) return;
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as {
            doses: Dose[];
            history: HistoryEvent[];
            settings: Settings;
            help: HelpRequest;
            pilot: Pilot;
            prescription: Prescription;
            prescriptionHistory: NonNullable<Prescription>[];
            profile: PatientProfile;
            patientReminder: PatientReminder;
          };
          setDoses(data.doses);
          setHistory(data.history ?? []);
          setSettings(data.settings ?? { alertDelay: 30 });
          setHelp(data.help ?? null);
          setPilot(data.pilot ?? { startedAt: null, feedback: [], issues: [] });
          setPrescription(data.prescription ?? null);
          setPrescriptionHistory(data.prescriptionHistory ?? []);
          setProfile(data.profile ?? {
            firstName: "", lastName: "", birthDate: "", phone: "",
            emergencyName: "", emergencyPhone: "", notes: "", updatedAt: "",
          });
          setPatientReminder(data.patientReminder ?? null);
        }
      } catch {}
    };
    refresh();
    const timer = window.setInterval(refresh, 3500);
    return () => clearInterval(timer);
  }, [endpoint]);
  useEffect(() => {
    if (!reminders || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const check = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      doses.forEach((dose) => {
        const scheduled =
          Number(dose.time.slice(0, 2)) * 60 + Number(dose.time.slice(3));
        if (
          dose.status !== "confirmed" &&
          minutes >= scheduled &&
          !notified.current.has(dose.id)
        ) {
          new Notification("MedConnect — C’est l’heure", {
            body: `${dose.label} : ${dose.detail}`,
            icon: "/favicon.svg",
          });
          notified.current.add(dose.id);
        }
      });
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [doses, reminders]);

  const createFamily = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const family = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const accessBytes = crypto.getRandomValues(new Uint8Array(24));
    const access = btoa(String.fromCharCode(...accessBytes))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    window.history.replaceState({}, "", `?family=${family}&access=${access}`);
    setToken(family);
    setAccessKey(access);
    setRole("aidant");
  };
  const changeRole = (next: Role) => {
    setRole(next);
    if (next === "patient" && ["prescription", "profile", "treatments"].includes(tab))
      setTab("today");
    if (next === "aidant" && tab === "medications") setTab("today");
    if (token && accessKey)
      window.history.replaceState({}, "", `?family=${token}&access=${accessKey}&view=${next}`);
  };
  const persist = async (
    nextDoses: Dose[],
    nextHistory: HistoryEvent[],
    nextSettings: Settings,
    nextHelp: HelpRequest,
    nextPilot = pilot,
    nextPrescription = prescription,
    nextPrescriptionHistory = prescriptionHistory,
    nextProfile = profile,
    nextPatientReminder = patientReminder,
  ) => {
    setDoses(nextDoses);
    setHistory(nextHistory);
    setSettings(nextSettings);
    setHelp(nextHelp);
    setPilot(nextPilot);
    setPrescription(nextPrescription);
    setPrescriptionHistory(nextPrescriptionHistory);
    setProfile(nextProfile);
    setPatientReminder(nextPatientReminder);
    if (!token) return;
    try {
      await fetch("/api/family", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          accessKey,
          doses: nextDoses,
          history: nextHistory,
          settings: nextSettings,
          help: nextHelp,
          pilot: nextPilot,
          prescription: nextPrescription,
          prescriptionHistory: nextPrescriptionHistory,
          profile: nextProfile,
          patientReminder: nextPatientReminder,
        }),
      });
    } catch {}
  };
  const save = (next: Dose[], nextHistory = history) =>
    persist(next, nextHistory, settings, help);
  const saveProfile = (nextProfile: PatientProfile) =>
    persist(doses, history, settings, help, pilot, prescription, prescriptionHistory, nextProfile);
  const saveTreatmentItems = (nextItems: PrescriptionItem[]) => {
    if (!prescription) return;
    const today = new Date().toISOString().slice(0, 10);
    const weekday = new Date().getDay();
    const active = nextItems.filter((item) => !item.asNeeded && item.days.includes(weekday) && item.startDate <= today && item.endDate >= today);
    const grouped = new Map<string, PrescriptionItem[]>();
    active.forEach((item) => item.times.forEach((time) => grouped.set(time, [...(grouped.get(time) || []), item])));
    const generated: Dose[] = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, lines]) => {
      const previous = doses.find((dose) => dose.time === time);
      return {
        id: previous?.id || crypto.randomUUID(), time,
        label: Number(time.slice(0, 2)) < 11 ? "Matin" : Number(time.slice(0, 2)) < 17 ? "Après-midi" : "Soir",
        detail: lines.map((line) => `${quantityLabel(line.quantity)} × ${line.name} ${line.form} (${line.dosage})${line.mealTiming === "none" ? "" : ` · ${line.mealTiming === "before" ? "avant" : line.mealTiming === "during" ? "pendant" : "après"} le repas`}`).join(" · "),
        status: previous?.status || "upcoming", stock: Math.min(...lines.map((line) => line.stock)),
      };
    });
    if (!generated.length) {
      window.alert("Aucune prise n’est planifiée aujourd’hui avec ces réglages.");
      return;
    }
    const updatedItems = nextItems.map((item) => ({ ...item, frequencyText: item.asNeeded ? "Si besoin" : `${item.times.length} fois par jour` }));
    const updatedPrescription = { ...prescription, status: "validated" as const, items: updatedItems, updatedAt: new Date().toISOString() };
    const archived = [prescription, ...prescriptionHistory].slice(0, 10);
    persist(generated, history, settings, help, pilot, updatedPrescription, archived, profile, patientReminder);
    window.alert("Traitement mis à jour et synchronisé avec l’écran Patient.");
  };
  const sendPatientReminder = (dose: Dose) => {
    const nextReminder: NonNullable<PatientReminder> = {
      doseId: dose.id,
      requestedAt: new Date().toISOString(),
      message: `La prise de ${dose.time} n’est pas encore confirmée.`,
    };
    persist(doses, history, settings, help, pilot, prescription, prescriptionHistory, profile, nextReminder);
  };
  const confirm = (id: string) => {
    const dose = doses.find((d) => d.id === id);
    if (!dose || dose.status === "confirmed") return;
    const current = new Date();
    const currentMinutes = current.getHours() * 60 + current.getMinutes();
    const scheduledMinutes = Number(dose.time.slice(0, 2)) * 60 + Number(dose.time.slice(3));
    if (currentMinutes < scheduledMinutes) {
      window.alert(`Cette prise pourra être confirmée à partir de ${dose.time}.`);
      return;
    }
    const next = doses.map((d) =>
      d.id === id
        ? {
            ...d,
            status: "confirmed" as Status,
            stock: Math.max(0, d.stock - 1),
          }
        : d,
    );
    const event: HistoryEvent = {
      id: crypto.randomUUID(),
      doseId: dose.id,
      label: dose.label,
      scheduledTime: dose.time,
      confirmedAt: new Date().toISOString(),
      outcome: "taken",
    };
    const nextHistory = [event, ...history].slice(0, 100);
    const adjustedPrescription = prescription
      ? {
          ...prescription,
          items: prescription.items.map((item) =>
            !item.asNeeded && item.times.includes(dose.time)
              ? { ...item, stock: Math.max(0, item.stock - item.quantity), stockUpdatedAt: new Date().toISOString() }
              : item,
          ),
          updatedAt: new Date().toISOString(),
        }
      : prescription;
    if (accessKey)
      persist(
        next,
        nextHistory,
        settings,
        help,
        pilot,
        adjustedPrescription,
        prescriptionHistory,
        profile,
        patientReminder?.doseId === id ? null : patientReminder,
      );
    else {
      setDoses(next);
      setHistory(nextHistory);
      if (patientReminder?.doseId === id) setPatientReminder(null);
      void fetch("/api/family", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, action: "confirm", doseId: id }),
      });
    }
  };
  const markOutcome = (
    dose: Dose,
    outcome: "missed" | "refused" | "postponed",
  ) => {
    if (outcome === "postponed") {
      const newTime = window.prompt(
        `Nouvel horaire pour « ${dose.label} » (HH:MM)`,
        dose.time,
      );
      if (!newTime) return;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime)) {
        window.alert("Saisissez un horaire valide, par exemple 14:30.");
        return;
      }
      const next = doses
        .map((item) =>
          item.id === dose.id
            ? { ...item, time: newTime, status: "pending" as Status }
            : item,
        )
        .sort((a, b) => a.time.localeCompare(b.time));
      const event: HistoryEvent = {
        id: crypto.randomUUID(),
        doseId: dose.id,
        label: dose.label,
        scheduledTime: dose.time,
        confirmedAt: new Date().toISOString(),
        outcome,
      };
      save(next, [event, ...history].slice(0, 100));
      return;
    }
    const wording = outcome === "missed" ? "oubliée" : "refusée";
    if (
      !window.confirm(`Marquer la prise « ${dose.label} » comme ${wording} ?`)
    )
      return;
    const next = doses.map((item) =>
      item.id === dose.id ? { ...item, status: outcome as Status } : item,
    );
    const event: HistoryEvent = {
      id: crypto.randomUUID(),
      doseId: dose.id,
      label: dose.label,
      scheduledTime: dose.time,
      confirmedAt: new Date().toISOString(),
      outcome,
    };
    save(next, [event, ...history].slice(0, 100));
  };
  const share = async () => {
    if (!token) return;
    const url = `${window.location.origin}?family=${token}`;
    if (navigator.share)
      await navigator.share({ url });
    else await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const copyPatientLink = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(`${window.location.origin}?family=${token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const enableReminders = async () => {
    if (typeof Notification === "undefined") {
      window.alert(
        "Les notifications ne sont pas disponibles sur ce navigateur.",
      );
      return;
    }
    const permission = await Notification.requestPermission();
    setReminders(permission === "granted");
    if (permission !== "granted")
      window.alert(
        "Autorisez les notifications dans les réglages du navigateur pour recevoir les rappels.",
      );
  };
  const toggleReminders = () =>
    setReminders((current) => {
      const next = !current;
      window.localStorage.setItem("medconnect-reminders", next ? "on" : "off");
      return next;
    });
  const requestHelp = () => {
    const nextHelp = { requestedAt: new Date().toISOString() };
    if (accessKey) persist(doses, history, settings, nextHelp);
    else {
      setHelp(nextHelp);
      void fetch("/api/family", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, action: "request_help" }),
      });
    }
  };
  const acknowledgeHelp = () => persist(doses, history, settings, null);
  const updateDelay = (alertDelay: 15 | 30 | 60) =>
    persist(doses, history, { alertDelay }, help);
  const savePilot = (nextPilot: Pilot) => {
    if (accessKey) persist(doses, history, settings, help, nextPilot);
    else {
      setPilot(nextPilot);
      void fetch("/api/family", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, action: "save_pilot", pilot: nextPilot }),
      });
    }
  };
  const savePrescription = (
    nextPrescription: Prescription,
    generated?: Dose[],
  ) => {
    const versions =
      generated && prescription?.status === "validated"
        ? [prescription, ...prescriptionHistory].slice(0, 10)
        : prescriptionHistory;
    persist(
      generated ?? doses,
      history,
      settings,
      help,
      pilot,
      nextPrescription,
      versions,
    );
    if (generated) setTab("today");
  };
  const restorePrescription = (version: NonNullable<Prescription>) => {
    if (
      !window.confirm(
        "Restaurer cette ordonnance et remplacer le programme actuel ? Une copie du programme actuel sera conservée.",
      )
    )
      return;
    const today = new Date().toISOString().slice(0, 10);
    const weekday = new Date().getDay();
    const restoredItems = version.items.filter(
      (item) =>
        !item.asNeeded &&
        item.days.includes(weekday) &&
        item.startDate <= today &&
        item.endDate >= today,
    );
    if (restoredItems.length === 0) {
      window.alert(
        "Cette version ne contient aucune prise planifiée aujourd’hui.",
      );
      return;
    }
    const grouped = new Map<string, PrescriptionItem[]>();
    restoredItems.forEach((item) =>
      item.times.forEach((time) =>
        grouped.set(time, [...(grouped.get(time) || []), item]),
      ),
    );
    const generated: Dose[] = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, lines]) => ({
        id: crypto.randomUUID(),
        time,
        label:
          Number(time.slice(0, 2)) < 11
            ? "Matin"
            : Number(time.slice(0, 2)) < 17
              ? "Après-midi"
              : "Soir",
        detail: lines
          .map(
            (line) =>
              `${line.quantity} × ${line.name} ${line.form} (${line.dosage})`,
          )
          .join(" · "),
        status: "upcoming" as Status,
        stock: Math.min(...lines.map((line) => line.stock)),
      }));
    const restored = {
      ...version,
      id: crypto.randomUUID(),
      status: "validated" as const,
      updatedAt: new Date().toISOString(),
    };
    const archived = prescription
      ? [
          prescription,
          ...prescriptionHistory.filter(
            (item) => item.updatedAt !== version.updatedAt,
          ),
        ].slice(0, 10)
      : prescriptionHistory;
    persist(generated, history, settings, help, pilot, restored, archived);
    setTab("today");
  };

  if (!ready)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f3f7f4] font-bold text-[#17362d]">
        Chargement…
      </main>
    );
  if (!token)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f3f7f4] px-5 text-[#17362d]">
        <section className="w-full max-w-md rounded-[2rem] bg-white p-8 text-center shadow-[0_20px_60px_rgba(23,54,45,.12)]">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#176b50] text-3xl font-black text-white">
            M
          </span>
          <h1 className="mt-5 text-3xl font-black">
            Créer votre espace familial
          </h1>
          <p className="mt-3 font-medium leading-relaxed text-[#60766e]">
            Un lien privé reliera le téléphone du patient à celui de l’aidant.
            Utilisez uniquement des données fictives pendant ce pilote.
          </p>
          <button
            onClick={createFamily}
            className="mt-7 w-full rounded-2xl bg-[#176b50] px-6 py-5 text-lg font-black text-white"
          >
            Créer l’espace MedConnect
          </button>
        </section>
      </main>
    );
  const navItems: { tab: Tab; label: string; icon: string }[] =
    role === "patient"
      ? [
          { tab: "today", label: "Accueil", icon: "⌂" },
          { tab: "medications", label: "Médicaments", icon: "✚" },
          { tab: "history", label: "Historique", icon: "◷" },
          { tab: "pilot", label: "Mon avis", icon: "◇" },
        ]
      : [
          { tab: "today", label: "Vue", icon: "⌂" },
          { tab: "profile", label: "Patient", icon: "◎" },
          { tab: "treatments", label: "Traitements", icon: "✚" },
          { tab: "history", label: "Historique", icon: "◷" },
          { tab: "pilot", label: "Pilote", icon: "◇" },
        ];
  return (
    <main className="min-h-screen text-[#17362d]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 pb-4 pt-6">
        <Brand role={role} patientName={profile.firstName || "Patient"} />
        <span className="rounded-full border border-[#dce7e2] bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-[#60766e] shadow-sm">
          Pilote familial
        </span>
      </header>
      {accessKey ? (
        <div className="mx-auto mb-7 flex max-w-sm rounded-full border border-white bg-[#e7eeea]/90 p-1.5 shadow-[0_8px_25px_rgba(35,72,60,.06)]">
          <button onClick={() => changeRole("aidant")} className={`flex-1 rounded-full px-4 py-2.5 text-sm font-black ${role === "aidant" ? "bg-white text-[#176b50] shadow-sm" : "text-[#687d75]"}`}>
            Administration
          </button>
          <button onClick={() => changeRole("patient")} className={`flex-1 rounded-full px-4 py-2.5 text-sm font-black ${role === "patient" ? "bg-white text-[#176b50] shadow-sm" : "text-[#687d75]"}`}>
            Voir comme Patient
          </button>
        </div>
      ) : (
        <div className="mx-auto mb-7 w-fit rounded-full bg-[#e2f5ea] px-4 py-2 text-sm font-black text-[#176b50]">
          Accès Patient
        </div>
      )}
      {role === "aidant" &&
        (!profile.firstName || !profile.lastName || !profile.birthDate) &&
        tab !== "profile" && (
          <button
            type="button"
            onClick={() => setTab("profile")}
            className="mx-auto mb-5 flex w-[calc(100%-2.5rem)] max-w-3xl items-center justify-between gap-4 rounded-2xl border-2 border-[#efc16d] bg-[#fff5dd] p-4 text-left text-[#765b2b]"
          >
            <span>
              <span className="block font-black">Fiche patient à compléter</span>
              <span className="mt-1 block text-sm font-medium">Ajoutez l’identité nécessaire avant de poursuivre le pilote.</span>
            </span>
            <span className="shrink-0 font-black">Compléter →</span>
          </button>
        )}
      {tab === "profile" && role === "aidant" ? (
        <PatientProfileView profile={profile} onSave={saveProfile} />
      ) : tab === "treatments" && role === "aidant" ? (
        <TreatmentManager
          key={prescription?.updatedAt || "empty"}
          prescription={prescription}
          onApply={saveTreatmentItems}
          openPrescription={() => setTab("prescription")}
        />
      ) : tab === "prescription" && role === "aidant" ? (
        <>
          <PrescriptionView
            key={prescription?.updatedAt || "new"}
            prescription={prescription}
            versions={prescriptionHistory}
            currentDoses={doses}
            onSave={savePrescription}
          />
          <PrescriptionVersions
            current={prescription}
            versions={prescriptionHistory}
            onRestore={restorePrescription}
          />
        </>
      ) : tab === "medications" && role === "patient" ? (
        <MyMedicationsView prescription={prescription} />
      ) : tab === "pilot" ? (
        <PilotView
          pilot={pilot}
          role={role}
          doses={doses}
          history={history}
          savePilot={savePilot}
        />
      ) : tab === "history" ? (
        <HistoryView history={history} />
      ) : role === "patient" ? (
        <PatientView
          doses={doses}
          confirm={confirm}
          reminders={reminders}
          enableReminders={enableReminders}
          toggleReminders={toggleReminders}
          help={help}
          requestHelp={requestHelp}
          prescription={prescription}
          patientName={profile.firstName || "Patient"}
          readOnlyPreview={Boolean(accessKey)}
          patientReminder={patientReminder}
        />
      ) : (
        <AidantView
          doses={doses}
          save={save}
          confirm={confirm}
          share={share}
          copyPatientLink={copyPatientLink}
          patientUrl={token && appOrigin ? `${appOrigin}?family=${token}` : ""}
          copied={copied}
          settings={settings}
          updateDelay={updateDelay}
          help={help}
          acknowledgeHelp={acknowledgeHelp}
          markOutcome={markOutcome}
          patientName={profile.firstName || "le patient"}
          patientReminder={patientReminder}
          sendPatientReminder={sendPatientReminder}
          prescription={prescription}
        />
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className={`mx-auto grid max-w-xl overflow-hidden rounded-[1.65rem] border border-white/80 bg-[#17362d]/95 p-1.5 shadow-[0_18px_55px_rgba(18,47,39,.28)] backdrop-blur-xl ${role === "patient" ? "grid-cols-4" : "grid-cols-5"}`}>
          {navItems.map((item) => {
            const active = tab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(item.tab)}
                className={`flex min-w-0 flex-col items-center justify-center rounded-[1.2rem] px-1 py-2.5 ${active ? "bg-white text-[#176b50] shadow-sm" : "text-[#c6d8d1] hover:bg-white/10 hover:text-white"}`}
              >
                <span className="text-xl font-black leading-none">{item.icon}</span>
                <span className={`mt-1 max-w-full truncate text-[10px] font-black ${role === "patient" ? "sm:text-xs" : "sm:text-[11px]"}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}
