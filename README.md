# Cricket Player Auction Management System

A full-stack DBMS project: **PostgreSQL** database + **Express (Node.js)** REST API backend + **vanilla JS** frontend, demonstrating live, working CRUD operations and a bidding/auction simulation — not screenshots, not raw SQL dumps.

Tested end-to-end before delivery: all CRUD routes, bid validation (must beat current highest / base price, can't exceed purse), atomic SOLD transaction (deducts purse + creates contract), UNSOLD flow, and duplicate-sale rejection all verified working against a live PostgreSQL instance.

---

## 1. Architecture

```
Frontend (public/*.html, app.js)  --fetch()-->  Express API (server.js, routes/*.js)  --pg-->  PostgreSQL (db/schema.sql)
```

- **Database**: 6 tables — `categories`, `teams`, `players`, `auctions`, `bids`, `contracts` — with PK/FK constraints, CHECK constraints, and indexes. See `db/schema.sql`.
- **Backend**: Express REST API. Bid placement and the sold-flow use real SQL transactions (`BEGIN`/`COMMIT`/`ROLLBACK` with row locks via `FOR UPDATE`) so purse deduction and contract creation are atomic — a failed bid never leaves the DB in a half-updated state.
- **Frontend**: Single-page vanilla JS app (no framework needed) with 4 views: Live Auction, Players, Teams, Squads/Contracts.

## 2. Prerequisites

- Node.js (v18+) — [nodejs.org](https://nodejs.org)
- PostgreSQL (v14+) — [postgresql.org/download](https://www.postgresql.org/download/)

## 3. Setup

### Step 1 — Create the database
```bash
psql -U postgres
CREATE DATABASE cricket_auction;
\q
```

### Step 2 — Load the schema (creates tables + seeds sample data)
```bash
psql -U postgres -d cricket_auction -f db/schema.sql
```

### Step 3 — Configure environment
```bash
cp .env.example .env
```
Edit `.env` and set your actual PostgreSQL password:
```
DB_USER=postgres
DB_PASSWORD=your_actual_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cricket_auction
PORT=3000
```

### Step 4 — Install dependencies
```bash
npm install
```

### Step 5 — Run
```bash
npm start
```
Open **http://localhost:3000** in your browser.

## 4. Demo Flow (for your evaluation)

1. **Teams tab** → Add a team, edit its purse inline, delete a team → shows CRUD on `teams`.
2. **Players tab** → Add a player, edit fields inline, delete → shows CRUD on `players`.
3. **Live Auction tab**:
   - Click **+ New Auction** to start a session (inserts into `auctions`).
   - Click **Bid** next to a player in the pool → scoreboard appears.
   - Pick a team + bid amount → **Place Bid** (inserts into `bids`, validates against current highest and team purse in real time).
   - Try bidding lower than the current highest — the API rejects it (shows the validation working, not just the UI).
   - Click **Mark SOLD** → creates a row in `contracts`, deducts the winning team's purse (`teams.purse_remaining`), updates `players.status`. Watch the purse strip below update live.
   - Click **Mark UNSOLD** on a player with no bids → updates status without a contract.
4. **Squads / Contracts tab** → shows the final joined view of who bought whom, for how much, and when — demonstrates a multi-table JOIN query rendered live from the DB.

## 5. Project Structure

```
cricket-auction/
├── db/
│   ├── schema.sql        # DDL: tables, constraints, indexes, seed data
│   └── pool.js           # PostgreSQL connection pool
├── routes/
│   ├── teams.js          # Teams CRUD
│   ├── players.js        # Players CRUD
│   ├── categories.js     # Categories CRUD
│   └── auctions.js       # Auctions, bids, sold/unsold, contracts
├── public/
│   ├── index.html        # SPA shell (4 views)
│   ├── app.js             # All frontend logic (fetch calls, rendering)
│   └── style.css          # Scoreboard-themed styling
├── server.js              # Express app entry point
├── package.json
└── .env.example
```

## 6. Key Queries You Can Point To (for your report/viva)

- **Highest bid per player**: `MAX(bid_amount)` grouped by `player_id` — see `GET /api/auctions/:auctionId/players/:playerId/bids` (ordered DESC, `LIMIT 1` for the sold transaction).
- **Purse remaining per team**: live column on `teams`, decremented transactionally on sale.
- **Team-wise squad with spend**: `GET /api/auctions/contracts/all` — 3-table JOIN (`contracts` ⋈ `players` ⋈ `teams`).
- **Unsold players**: `GET /api/players?status=unsold`.

## 7. Notes on Design Decisions (useful for your report)

- `bids` stores every bid ever placed (full audit trail), while `contracts` stores only the final, winning outcome — this is a deliberate denormalization: the winning price is derivable from `bids` but is also snapshotted into `contracts` for fast, simple querying of final squads.
- Row-level locking (`SELECT ... FOR UPDATE`) on `players` and `teams` during bid placement and the sold transaction prevents race conditions (e.g., two simultaneous bids, or purse going negative).
- CHECK constraints enforce data integrity at the DB layer (e.g., `purse_remaining >= 0`, `bid_amount > 0`) so invalid states can't be written even if the application layer had a bug.
