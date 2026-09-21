-- ============================================================
-- Cricket Player Auction Management System - Database Schema
-- ============================================================

DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS bids CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS auctions CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS categories CASCADE;

-- ---------------------------------------------------------
-- CATEGORIES  (e.g. Marquee, Capped Indian, Uncapped, Overseas)
-- ---------------------------------------------------------
CREATE TABLE categories (
    category_id     SERIAL PRIMARY KEY,
    category_name   VARCHAR(50) NOT NULL UNIQUE,
    base_price      NUMERIC(12,2) NOT NULL CHECK (base_price >= 0)
);

-- ---------------------------------------------------------
-- TEAMS / FRANCHISES
-- ---------------------------------------------------------
CREATE TABLE teams (
    team_id         SERIAL PRIMARY KEY,
    team_name       VARCHAR(100) NOT NULL UNIQUE,
    owner           VARCHAR(100),
    purse_total     NUMERIC(12,2) NOT NULL CHECK (purse_total >= 0),
    purse_remaining NUMERIC(12,2) NOT NULL CHECK (purse_remaining >= 0)
);

-- ---------------------------------------------------------
-- PLAYERS
-- ---------------------------------------------------------
CREATE TABLE players (
    player_id       SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    country         VARCHAR(50) NOT NULL,
    role            VARCHAR(30) NOT NULL CHECK (role IN ('Batsman','Bowler','All-Rounder','Wicketkeeper')),
    experience      INT NOT NULL CHECK (experience >= 0),
    category_id     INT REFERENCES categories(category_id) ON DELETE SET NULL,
    base_price      NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
    status          VARCHAR(20) NOT NULL DEFAULT 'unsold' CHECK (status IN ('unsold','sold','in_auction')),
    team_id         INT REFERENCES teams(team_id) ON DELETE SET NULL   -- filled once sold
);

-- ---------------------------------------------------------
-- AUCTIONS  (a "session"/season of bidding)
-- ---------------------------------------------------------
CREATE TABLE auctions (
    auction_id      SERIAL PRIMARY KEY,
    season          VARCHAR(50) NOT NULL,
    auction_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing','completed'))
);

-- ---------------------------------------------------------
-- BIDS  (every bid placed, historical log)
-- ---------------------------------------------------------
CREATE TABLE bids (
    bid_id          SERIAL PRIMARY KEY,
    auction_id      INT NOT NULL REFERENCES auctions(auction_id) ON DELETE CASCADE,
    player_id       INT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    team_id         INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    bid_amount      NUMERIC(12,2) NOT NULL CHECK (bid_amount > 0),
    bid_time        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- CONTRACTS  (final record once a player is SOLD)
-- ---------------------------------------------------------
CREATE TABLE contracts (
    contract_id     SERIAL PRIMARY KEY,
    player_id       INT NOT NULL UNIQUE REFERENCES players(player_id) ON DELETE CASCADE,
    team_id         INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    auction_id      INT NOT NULL REFERENCES auctions(auction_id) ON DELETE CASCADE,
    final_price     NUMERIC(12,2) NOT NULL CHECK (final_price > 0),
    contract_date   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES for faster lookups
-- ============================================================
CREATE INDEX idx_bids_player ON bids(player_id);
CREATE INDEX idx_bids_auction ON bids(auction_id);
CREATE INDEX idx_players_status ON players(status);

-- ============================================================
-- SEED DATA (sample categories + teams so the app isn't empty)
-- ============================================================
INSERT INTO categories (category_name, base_price) VALUES
 ('Marquee', 200.00),
 ('Capped Indian', 100.00),
 ('Uncapped Indian', 30.00),
 ('Overseas', 150.00);

INSERT INTO teams (team_name, owner, purse_total, purse_remaining) VALUES
 ('Chennai Kings', 'N. Srinivasan', 10000.00, 10000.00),
 ('Mumbai Titans', 'Nita A.', 10000.00, 10000.00),
 ('Bangalore Royals', 'Vijay M.', 10000.00, 10000.00),
 ('Hyderabad Sunrisers', 'Kalanithi M.', 10000.00, 10000.00);

INSERT INTO players (name, country, role, experience, category_id, base_price) VALUES
 ('Rahul Sharma', 'India', 'Batsman', 8, 2, 100.00),
 ('James Cook', 'England', 'All-Rounder', 6, 4, 150.00),
 ('Arjun Verma', 'India', 'Bowler', 2, 3, 30.00),
 ('David Miles', 'Australia', 'Bowler', 10, 4, 200.00),
 ('Karan Patel', 'India', 'Wicketkeeper', 5, 2, 100.00);
