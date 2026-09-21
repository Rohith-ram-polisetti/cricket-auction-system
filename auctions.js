const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// CREATE auction
router.post('/', async (req, res) => {
  try {
    const { season } = req.body;
    const result = await pool.query(
      `INSERT INTO auctions (season) VALUES ($1) RETURNING *`,
      [season || `Season ${new Date().getFullYear()}`]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LIST auctions
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM auctions ORDER BY auction_id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark auction completed
router.put('/:id/complete', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE auctions SET status = 'completed' WHERE auction_id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// PLACE A BID
// Validates: player must be unsold/in_auction, bid must beat current
// highest bid (or base price if no bids yet), team must have enough purse.
// ------------------------------------------------------------------
router.post('/:auctionId/bids', async (req, res) => {
  const { auctionId } = req.params;
  const { player_id, team_id, bid_amount } = req.body;

  if (!player_id || !team_id || !bid_amount) {
    return res.status(400).json({ error: 'player_id, team_id, bid_amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const playerRes = await client.query('SELECT * FROM players WHERE player_id = $1 FOR UPDATE', [player_id]);
    if (playerRes.rows.length === 0) throw { status: 404, message: 'Player not found' };
    const player = playerRes.rows[0];
    if (player.status === 'sold') throw { status: 400, message: 'Player is already sold' };

    const teamRes = await client.query('SELECT * FROM teams WHERE team_id = $1 FOR UPDATE', [team_id]);
    if (teamRes.rows.length === 0) throw { status: 404, message: 'Team not found' };
    const team = teamRes.rows[0];

    const highestRes = await client.query(
      `SELECT MAX(bid_amount) AS highest FROM bids WHERE player_id = $1 AND auction_id = $2`,
      [player_id, auctionId]
    );
    const currentHighest = parseFloat(highestRes.rows[0].highest) || parseFloat(player.base_price);
    const minRequired = highestRes.rows[0].highest ? currentHighest : parseFloat(player.base_price);

    if (parseFloat(bid_amount) < minRequired) {
      throw { status: 400, message: `Bid must be at least ${minRequired}` };
    }
    if (parseFloat(bid_amount) > parseFloat(team.purse_remaining)) {
      throw { status: 400, message: 'Bid exceeds team purse remaining' };
    }

    await client.query(
      `INSERT INTO bids (auction_id, player_id, team_id, bid_amount) VALUES ($1,$2,$3,$4)`,
      [auctionId, player_id, team_id, bid_amount]
    );
    await client.query(`UPDATE players SET status = 'in_auction' WHERE player_id = $1`, [player_id]);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Bid placed', player_id, team_id, bid_amount });
  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET all bids for a player in an auction (for live bid history display)
router.get('/:auctionId/players/:playerId/bids', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, t.team_name FROM bids b
       JOIN teams t ON b.team_id = t.team_id
       WHERE b.auction_id = $1 AND b.player_id = $2
       ORDER BY b.bid_amount DESC, b.bid_time ASC`,
      [req.params.auctionId, req.params.playerId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// MARK PLAYER SOLD -> creates contract, deducts purse (transaction)
// ------------------------------------------------------------------
router.post('/:auctionId/players/:playerId/sold', async (req, res) => {
  const { auctionId, playerId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const highestBidRes = await client.query(
      `SELECT * FROM bids WHERE auction_id = $1 AND player_id = $2
       ORDER BY bid_amount DESC, bid_time ASC LIMIT 1`,
      [auctionId, playerId]
    );
    if (highestBidRes.rows.length === 0) throw { status: 400, message: 'No bids placed for this player yet' };
    const winningBid = highestBidRes.rows[0];

    const teamRes = await client.query('SELECT * FROM teams WHERE team_id = $1 FOR UPDATE', [winningBid.team_id]);
    const team = teamRes.rows[0];
    if (parseFloat(team.purse_remaining) < parseFloat(winningBid.bid_amount)) {
      throw { status: 400, message: 'Winning team no longer has sufficient purse' };
    }

    await client.query(
      `UPDATE teams SET purse_remaining = purse_remaining - $1 WHERE team_id = $2`,
      [winningBid.bid_amount, winningBid.team_id]
    );
    await client.query(
      `UPDATE players SET status = 'sold', team_id = $1 WHERE player_id = $2`,
      [winningBid.team_id, playerId]
    );
    const contractRes = await client.query(
      `INSERT INTO contracts (player_id, team_id, auction_id, final_price)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [playerId, winningBid.team_id, auctionId, winningBid.bid_amount]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Player sold', contract: contractRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// MARK PLAYER UNSOLD (no bids received / withdrawn)
router.post('/:auctionId/players/:playerId/unsold', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE players SET status = 'unsold' WHERE player_id = $1 RETURNING *`,
      [req.params.playerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
    res.json({ message: 'Player marked unsold', player: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LIST all contracts (final squad records) - optionally filter by team
router.get('/contracts/all', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, p.name AS player_name, p.role, t.team_name, a.season AS auction_season
       FROM contracts c
       JOIN players p ON c.player_id = p.player_id
       JOIN teams t ON c.team_id = t.team_id
       JOIN auctions a ON c.auction_id = a.auction_id
       ORDER BY c.contract_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// EDIT a contract (change final price and/or reassign team).
// Reconciles both teams' purses so figures stay consistent.
// ------------------------------------------------------------------
router.put('/contracts/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const contractRes = await client.query('SELECT * FROM contracts WHERE contract_id = $1 FOR UPDATE', [id]);
    if (contractRes.rows.length === 0) throw { status: 404, message: 'Contract not found' };
    const contract = contractRes.rows[0];

    const newPrice = req.body.final_price != null ? parseFloat(req.body.final_price) : parseFloat(contract.final_price);
    const newTeamId = req.body.team_id != null ? req.body.team_id : contract.team_id;

    if (!(newPrice > 0)) throw { status: 400, message: 'final_price must be greater than 0' };

    if (String(newTeamId) === String(contract.team_id)) {
      // Same team: just adjust that team's purse by the price difference
      const teamRes = await client.query('SELECT * FROM teams WHERE team_id = $1 FOR UPDATE', [contract.team_id]);
      const team = teamRes.rows[0];
      const availableIfReverted = parseFloat(team.purse_remaining) + parseFloat(contract.final_price);
      if (newPrice > availableIfReverted) throw { status: 400, message: 'New price exceeds team purse' };
      await client.query('UPDATE teams SET purse_remaining = purse_remaining + $1 - $2 WHERE team_id = $3',
        [contract.final_price, newPrice, contract.team_id]);
    } else {
      // Team reassigned: refund old team, deduct from new team
      const oldTeamRes = await client.query('SELECT * FROM teams WHERE team_id = $1 FOR UPDATE', [contract.team_id]);
      if (oldTeamRes.rows.length === 0) throw { status: 404, message: 'Original team not found' };
      const newTeamRes = await client.query('SELECT * FROM teams WHERE team_id = $1 FOR UPDATE', [newTeamId]);
      if (newTeamRes.rows.length === 0) throw { status: 404, message: 'New team not found' };
      const newTeam = newTeamRes.rows[0];
      if (newPrice > parseFloat(newTeam.purse_remaining)) throw { status: 400, message: 'New team does not have enough purse' };

      await client.query('UPDATE teams SET purse_remaining = purse_remaining + $1 WHERE team_id = $2',
        [contract.final_price, contract.team_id]);
      await client.query('UPDATE teams SET purse_remaining = purse_remaining - $1 WHERE team_id = $2',
        [newPrice, newTeamId]);
      await client.query('UPDATE players SET team_id = $1 WHERE player_id = $2', [newTeamId, contract.player_id]);
    }

    const updated = await client.query(
      `UPDATE contracts SET final_price = $1, team_id = $2 WHERE contract_id = $3 RETURNING *`,
      [newPrice, newTeamId, id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Contract updated', contract: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------
// DELETE a contract (undo a sale): refunds the team's purse and
// returns the player to the unsold pool so they can be re-auctioned.
// ------------------------------------------------------------------
router.delete('/contracts/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const contractRes = await client.query('SELECT * FROM contracts WHERE contract_id = $1 FOR UPDATE', [id]);
    if (contractRes.rows.length === 0) throw { status: 404, message: 'Contract not found' };
    const contract = contractRes.rows[0];

    await client.query('UPDATE teams SET purse_remaining = purse_remaining + $1 WHERE team_id = $2',
      [contract.final_price, contract.team_id]);
    await client.query(`UPDATE players SET status = 'unsold', team_id = NULL WHERE player_id = $1`,
      [contract.player_id]);
    await client.query('DELETE FROM contracts WHERE contract_id = $1', [id]);

    await client.query('COMMIT');
    res.json({ message: 'Contract deleted, purse refunded, player returned to pool' });
  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
