# AI pretraga dokumenata

Web aplikacija za semantičku pretragu i preporuku dokumenata, razvijena kao dio diplomskog rada.

## Struktura

- `frontend` — React + Vite korisnički interfejs
- `backend` — Node.js + Express REST API
- `database` — PostgreSQL inicijalizacija sa `pgvector` ekstenzijom

## Pokretanje lokalno

Potrebni su Node.js (LTS) i Docker Desktop.

1. Pokreni bazu iz korijena projekta:

   ```bash
   docker compose up -d
   ```

2. U prvom terminalu pokreni backend:

   ```bash
   cd backend
   copy .env.example .env
   npm install
   npm run dev
   ```

3. U drugom terminalu pokreni frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

Otvori `http://localhost:5173`. Frontend provjerava API na `http://localhost:4000/api/health` preko Vite proxy-ja.

## Napomena

Podaci baze se čuvaju u Docker volume-u `postgres_data`. Za potpuno brisanje lokalne baze koristi se `docker compose down -v`.

