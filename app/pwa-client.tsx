"use client";
import { useEffect, useState } from "react";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export default function PwaClient() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone);
    setHidden(Boolean(standalone) || sessionStorage.getItem("medconnect-install-hidden") === "1");
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); setHidden(false); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(registration => {
      registration.update();
      registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", event => {
        const worker = event.currentTarget as ServiceWorker;
        if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
      }));
    }).catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", beforeInstall);
  }, []);
  const close = () => { sessionStorage.setItem("medconnect-install-hidden", "1"); setHidden(true); };
  const install = async () => { if (!prompt) return; await prompt.prompt(); await prompt.userChoice; setPrompt(null); setHidden(true); };
  return <>
    {!hidden && (prompt || ios) && <aside className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-3xl border border-[#90c8ae] bg-white p-4 text-[#17362d] shadow-[0_18px_55px_rgba(23,54,45,.2)]">
      <div className="flex items-start gap-3"><img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-2xl" /><div className="min-w-0 flex-1"><p className="font-black">Installer MedConnect</p><p className="mt-1 text-sm font-semibold text-[#60766e]">Accès rapide depuis l’écran d’accueil.</p></div><button onClick={close} aria-label="Fermer" className="grid h-9 w-9 place-items-center rounded-full bg-[#edf2ef] font-black">×</button></div>
      {prompt ? <button onClick={install} className="mt-3 min-h-12 w-full rounded-2xl bg-[#176b50] px-4 font-black text-white">Installer l’application</button> : <p className="mt-3 rounded-2xl bg-[#edf5f1] p-3 text-sm font-bold">Sur iPhone : touchez Partager, puis « Sur l’écran d’accueil ».</p>}
    </aside>}
    {updateReady && <aside className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#17362d] p-4 text-white shadow-xl"><p className="flex-1 text-sm font-bold">Une nouvelle version est disponible.</p><button onClick={() => window.location.reload()} className="rounded-xl bg-[#d8f36a] px-3 py-2 text-sm font-black text-[#17362d]">Actualiser</button></aside>}
  </>;
}
