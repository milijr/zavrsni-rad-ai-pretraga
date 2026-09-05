import { FormEvent, useEffect, useState } from "react";

type ApiHealth = {
  status: string;
  database: string;
};

type DocumentSummary = {
  id: string;
  title: string;
  author: string;
  documentType: string;
  institution: string | null;
  faculty: string | null;
  documentYear: number | null;
  keywords: string[];
  createdAt: string;
};

type DocumentDetails = DocumentSummary & {
  studyProgram: string | null;
  fieldOfStudy: string | null;
  mentor: string | null;
  defenseDate: string | null;
  languageCode: string;
  abstractLocal: string | null;
  abstractEnglish: string | null;
  originalFileName: string;
  fullText: string;
  updatedAt: string;
};

type DocumentForm = {
  title: string;
  author: string;
  documentType: string;
  institution: string;
  faculty: string;
  mentor: string;
  documentYear: string;
  keywords: string;
  abstractLocal: string;
  fullText: string;
};

const initialForm: DocumentForm = {
  title: "",
  author: "",
  documentType: "master_rad",
  institution: "Univerzitet Mediteran Podgorica",
  faculty: "Fakultet za informacione tehnologije",
  mentor: "",
  documentYear: new Date().getFullYear().toString(),
  keywords: "",
  abstractLocal: "",
  fullText: "",
};

const documentTypeLabels: Record<string, string> = {
  master_rad: "Master rad",
  specijalisticki_rad: "Specijalistički rad",
  diplomski_rad: "Diplomski rad",
  naucni_rad: "Naučni rad",
  ostalo: "Ostalo",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-ME", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

async function apiMessage(response: Response) {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? "Došlo je do neočekivane greške.";
}

function App() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetails | null>(null);
  const [form, setForm] = useState<DocumentForm>(initialForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [apiStatus, setApiStatus] = useState<"loading" | "connected" | "unavailable">("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadDocuments() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/documents");
      if (!response.ok) throw new Error(await apiMessage(response));
      const data = (await response.json()) as { documents: DocumentSummary[] };
      setDocuments(data.documents);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nije moguće učitati dokumente.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => {
        const data = (await response.json()) as ApiHealth;
        if (!response.ok || data.database !== "connected") throw new Error();
        setApiStatus("connected");
      })
      .catch(() => setApiStatus("unavailable"));

    void loadDocuments();
  }, []);

  async function selectDocument(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}`);
      if (!response.ok) throw new Error(await apiMessage(response));
      const data = (await response.json()) as { document: DocumentDetails };
      setSelectedDocument(data.document);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Nije moguće učitati dokument.");
    }
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const response = selectedFile
        ? await (() => {
            const uploadData = new FormData();
            uploadData.append("file", selectedFile);
            uploadData.append("title", form.title);
            uploadData.append("author", form.author);
            uploadData.append("documentType", form.documentType);
            uploadData.append("institution", form.institution);
            uploadData.append("faculty", form.faculty);
            uploadData.append("mentor", form.mentor);
            uploadData.append("documentYear", form.documentYear);
            uploadData.append("keywords", form.keywords);
            uploadData.append("abstractLocal", form.abstractLocal);
            return fetch("/api/documents/upload", { method: "POST", body: uploadData });
          })()
        : await fetch("/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...form,
              documentYear: form.documentYear ? Number(form.documentYear) : undefined,
              keywords: form.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
              originalFileName: "rucni-unos.txt",
            }),
          });

      if (!response.ok) throw new Error(await apiMessage(response));
      const data = (await response.json()) as { document: DocumentSummary };
      setForm(initialForm);
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      setSuccess("Dokument je uspješno sačuvan u bazi.");
      await loadDocuments();
      await selectDocument(data.document.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nije moguće sačuvati dokument.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateField(field: keyof DocumentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#vrh" aria-label="Početna stranica">
          <span className="brand-mark">AI</span>
          <span><strong>Dokumenta</strong><small>Semantička pretraga</small></span>
        </a>
        <div className={`connection ${apiStatus}`}>
          <span className="status-dot" />
          {apiStatus === "connected" && "Baza povezana"}
          {apiStatus === "loading" && "Provjera veze"}
          {apiStatus === "unavailable" && "Baza nedostupna"}
        </div>
      </header>

      <section className="hero" id="vrh">
        <div>
          <p className="eyebrow">Platforma za akademske radove</p>
          <h1>Pronađi znanje, <em>ne samo riječi.</em></h1>
          <p className="hero-copy">Unesi radove, sačuvaj njihove metapodatke i pripremi bazu za klasičnu i semantičku pretragu.</p>
        </div>

        <div className="hero-right">
          <div className="hero-stat"><strong>{documents.length}</strong><span>{documents.length === 1 ? "dokument" : "dokumenata"} u bazi</span></div>

          <div className="hero-cards" aria-hidden="true">
            <div className="hero-doc-card hc-1">
              <span className="hc-type">Master rad</span>
              <span className="hc-title">Semantička pretraga zasnovana na neuronskim mrežama</span>
              <span className="hc-meta">2024 · FIT</span>
              <span className="hc-bar" />
            </div>
            <div className="hero-doc-card hc-2">
              <span className="hc-type">Diplomski rad</span>
              <span className="hc-title">Primjena transformer arhitekture u obradi teksta</span>
              <span className="hc-meta">2023 · ETF</span>
              <span className="hc-bar" />
            </div>
            <div className="hero-doc-card hc-3">
              <span className="hc-type">Specijalistički rad</span>
              <span className="hc-title">Vektorske baze podataka i semantičko pretraživanje</span>
              <span className="hc-meta">2024 · PMF</span>
              <span className="hc-bar" />
            </div>
            <div className="hc-orb hc-orb-1" />
            <div className="hc-orb hc-orb-2" />
            <div className="hc-orb hc-orb-3" />
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Upravljanje dokumentima">
        <aside className="form-panel">
          <div className="panel-heading">
            <span className="panel-icon">+</span>
            <div><p className="eyebrow">Novi unos</p><h2>Dodaj dokument</h2></div>
          </div>

          <form onSubmit={submitDocument}>
            <label>Naslov rada <span>*</span>
              <input value={form.title} onChange={(event) => updateField("title", event.target.value)} placeholder="Unesite puni naslov rada" required />
            </label>
            <div className="form-grid">
              <label>Autor <span>*</span>
                <input value={form.author} onChange={(event) => updateField("author", event.target.value)} placeholder="Ime i prezime" required />
              </label>
              <label>Vrsta rada
                <select value={form.documentType} onChange={(event) => updateField("documentType", event.target.value)}>
                  {Object.entries(documentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>Godina
                <input type="number" min="1900" max="2100" value={form.documentYear} onChange={(event) => updateField("documentYear", event.target.value)} />
              </label>
              <label>Mentor
                <input value={form.mentor} onChange={(event) => updateField("mentor", event.target.value)} placeholder="Opcionalno" />
              </label>
            </div>
            <label>Fakultet
              <input value={form.faculty} onChange={(event) => updateField("faculty", event.target.value)} />
            </label>
            <label>Institucija
              <input value={form.institution} onChange={(event) => updateField("institution", event.target.value)} />
            </label>
            <label>Ključne riječi
              <input value={form.keywords} onChange={(event) => updateField("keywords", event.target.value)} placeholder="AI, NLP, pretraga (odvojite zarezom)" />
            </label>
            <label>Sažetak
              <textarea rows={4} value={form.abstractLocal} onChange={(event) => updateField("abstractLocal", event.target.value)} placeholder="Kratak opis rada" />
            </label>
            <label className="file-upload">
              <span>Fajl dokumenta</span>
              <span className="file-picker">
                <input
                  key={fileInputKey}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <span className="file-picker-icon">↑</span>
                <span>{selectedFile ? selectedFile.name : "Izaberi PDF ili DOCX fajl"}</span>
              </span>
              <small>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · tekst će se automatski izdvojiti` : "Maksimalna veličina fajla je 15 MB."}</small>
            </label>
            <label>Tekst dokumenta <span>*</span>
              <textarea rows={7} value={form.fullText} onChange={(event) => updateField("fullText", event.target.value)} placeholder="Zalijepite tekst ručno samo ako ne uploadujete fajl." required={!selectedFile} disabled={Boolean(selectedFile)} />
            </label>
            <button className="primary-button" disabled={isSubmitting} type="submit">
              <span>{isSubmitting ? "Čuvanje..." : "Sačuvaj dokument"}</span>
              {!isSubmitting && <span aria-hidden="true">→</span>}
            </button>
          </form>
        </aside>

        <section className="library-panel">
          <div className="library-heading">
            <div><p className="eyebrow">Kolekcija</p><h2>Dokumenti u bazi</h2></div>
            <button className="refresh-button" type="button" onClick={() => void loadDocuments()}>↻ Osvježi</button>
          </div>
          {error && <p className="notice error">{error}</p>}
          {success && <p className="notice success">✓ {success}</p>}

          {isLoading ? (
            <div className="empty-state"><span className="loader" /> Učitavanje dokumenata...</div>
          ) : documents.length === 0 ? (
            <div className="empty-state"><span className="empty-icon">▱</span><h3>Kolekcija je prazna</h3><p>Dodaj prvi dokument putem forme sa lijeve strane.</p></div>
          ) : (
            <div className="document-list">
              {documents.map((document) => (
                <button className={`document-card ${selectedDocument?.id === document.id ? "selected" : ""}`} key={document.id} type="button" onClick={() => void selectDocument(document.id)}>
                  <span className="document-index">{document.documentType.includes("master") ? "MR" : "DR"}</span>
                  <span className="document-card-content">
                    <span className="document-meta">{documentTypeLabels[document.documentType] ?? "Dokument"}{document.documentYear ? ` · ${document.documentYear}` : ""}</span>
                    <strong>{document.title}</strong>
                    <span className="document-author">{document.author}</span>
                    <span className="tag-row">{document.keywords.slice(0, 3).map((keyword) => <i key={keyword}>{keyword}</i>)}</span>
                  </span>
                  <span className="card-arrow">→</span>
                </button>
              ))}
            </div>
          )}

          {selectedDocument && (
            <article className="detail-card">
              <div className="detail-heading"><span>Pregled dokumenta</span><button type="button" onClick={() => setSelectedDocument(null)} aria-label="Zatvori pregled">×</button></div>
              <h3>{selectedDocument.title}</h3>
              <p className="detail-byline">{selectedDocument.author} · {selectedDocument.documentYear ?? "Godina nije unesena"}</p>
              {selectedDocument.abstractLocal && <p className="detail-abstract">{selectedDocument.abstractLocal}</p>}
              <div className="detail-footer"><span>{selectedDocument.mentor ? `Mentor: ${selectedDocument.mentor}` : "Mentor nije unesen"}</span><span>Dodato {formatDate(selectedDocument.createdAt)}</span></div>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
