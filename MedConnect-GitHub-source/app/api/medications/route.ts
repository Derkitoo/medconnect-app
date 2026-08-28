type ApiMedication = {
  cis?: number | string;
  elementPharmaceutique?: string;
  formePharmaceutique?: string;
  voiesAdministration?: string[];
  etatComercialisation?: string;
  composition?: Array<{ denominationSubstance?: string; dosage?: string }>;
  presentation?: Array<{ libelle?: string }>;
};

export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 '/.-]+/g, " ").trim().split(/\s+/).slice(0, 6).join(" ");
  if (query.length < 2 || query.length > 80)
    return Response.json({ error: "Saisissez au moins 2 caractères." }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(
      `https://medicaments-api.giygas.dev/v1/medicaments?search=${encodeURIComponent(query)}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    if (!response.ok) throw new Error("Medication API unavailable");
    const raw = (await response.json()) as ApiMedication[];
    const results = (Array.isArray(raw) ? raw : [])
      .filter((item) => item?.cis && item.elementPharmaceutique)
      .sort((a, b) => Number(b.etatComercialisation === "Commercialisée") - Number(a.etatComercialisation === "Commercialisée"))
      .slice(0, 8)
      .map((item) => ({
        cis: String(item.cis),
        name: item.elementPharmaceutique?.trim() ?? "",
        form: item.formePharmaceutique?.trim() ?? "",
        routes: (item.voiesAdministration ?? []).slice(0, 4),
        status: item.etatComercialisation?.trim() ?? "",
        substances: [...new Set((item.composition ?? []).map((line) => line.denominationSubstance?.trim()).filter(Boolean))].slice(0, 6),
        presentation: item.presentation?.find((line) => line.libelle)?.libelle?.trim() ?? "",
      }));
    return Response.json({ results, source: "Base de données publique des médicaments" }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return Response.json({ error: "Le relais MedConnect est temporairement indisponible.", directFallback: true }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
