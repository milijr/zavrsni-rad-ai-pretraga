import { useEffect, useState } from "react";

type ApiHealth = {
  status: string;
  database: string;
};

function App() {
  const [apiStatus, setApiStatus] = useState("Provjera veze sa serverom...");

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => {
        const data = (await response.json()) as ApiHealth;
        if (!response.ok) throw new Error(data.database);
        setApiStatus(`API: ${data.status} · Baza: ${data.database}`);
      })
      .catch(() => setApiStatus("API ili baza još nisu pokrenuti."));
  }, []);

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Diplomski rad</p>
        <h1>AI pretraga dokumenata</h1>
        <p className="description">
          Web aplikacija za semantičku pretragu i preporuku sadržajno srodnih dokumenata.
        </p>
        <p className="status">{apiStatus}</p>
      </section>
    </main>
  );
}

export default App;

