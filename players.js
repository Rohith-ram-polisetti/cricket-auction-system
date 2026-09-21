const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const PLAYER_JOIN_SELECT = `
  SELECT p.*, c.category_name, t.team_name
  FROM players p
  LEFT JOIN categories c ON p.category_id = c.category_id
  LEFT JOIN teams t ON p.team_id = t.team_id
`;

// CREATE
router.post('/', async (req, res) => {
  try {
    const { name, country, role, experience, category_id, base_price } = req.body;
    if (!name || !country || !role || base_price == null) {
      return res.status(400).json({ error: 'name, country, role, base_price are required' });
    }
    const result = await pool.query(
      `INSERT INTO players (name, country, role, experience, category_id, base_price)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, country, role, experience || 0, category_id || null, base_price]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ALL (optional ?status=unsold filter)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status
      ? `${PLAYER_JOIN_SELECT} WHERE p.status = $1 ORDER BY p.player_id`
      : `${PLAYER_JOIN_SELECT} ORDER BY p.player_id`;
    const result = status ? await pool.query(query, [status]) : await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ONE
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`${PLAYER_JOIN_SELECT} WHERE p.player_id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put('/:id', async (req, res) => {
  try {
    const { name, country, role, experience, category_id, base_price } = req.body;
    const result = await pool.query(
      `UPDATE players SET
        name = COALESCE($1, name),
        country = COALESCE($2, country),
        role = COALESCE($3, role),
        experience = COALESCE($4, experience),
        category_id = COALESCE($5, category_id),
        base_price = COALESCE($6, base_price)
       WHERE player_id = $7 RETURNING *`,
      [name, country, role, experience, category_id, base_price, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM players WHERE player_id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
    res.json({ message: 'Player deleted', player: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset a player back to unsold (undo) - useful for demo/testing
router.post('/:id/reset', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const contractResult = await client.query('SELECT * FROM contracts WHERE player_id = $1', [req.params.id]);
      if (contractResult.rows.length > 0) {
        const contract = contractResult.rows[0];
        await client.query('UPDATE teams SET purse_remaining = purse_remaining + $1 WHERE team_id = $2',
          [contract.final_price, contract.team_id]);
        await client.query('DELETE FROM contracts WHERE player_id = $1', [req.params.id]);
      }
      const result = await client.query(
        `UPDATE players SET status = 'unsold', team_id = NULL WHERE player_id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
