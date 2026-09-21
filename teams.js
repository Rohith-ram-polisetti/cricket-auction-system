const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// CREATE
router.post('/', async (req, res) => {
  try {
    const { team_name, owner, purse_total } = req.body;
    if (!team_name || !purse_total) {
      return res.status(400).json({ error: 'team_name and purse_total are required' });
    }
    const result = await pool.query(
      `INSERT INTO teams (team_name, owner, purse_total, purse_remaining)
       VALUES ($1, $2, $3, $3) RETURNING *`,
      [team_name, owner || null, purse_total]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Team name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// READ ALL
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM teams ORDER BY team_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ONE
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM teams WHERE team_id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put('/:id', async (req, res) => {
  try {
    const { team_name, owner, purse_total, purse_remaining } = req.body;
    const result = await pool.query(
      `UPDATE teams SET
        team_name = COALESCE($1, team_name),
        owner = COALESCE($2, owner),
        purse_total = COALESCE($3, purse_total),
        purse_remaining = COALESCE($4, purse_remaining)
       WHERE team_id = $5 RETURNING *`,
      [team_name, owner, purse_total, purse_remaining, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM teams WHERE team_id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json({ message: 'Team deleted', team: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
