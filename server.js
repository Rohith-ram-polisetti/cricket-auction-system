const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const pool = require('./db/pool');
const teamsRouter = require('./routes/teams');
const playersRouter = require('./routes/players');
const categoriesRouter = require('./routes/categories');
const auctionsRouter = require('./routes/auctions');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check - also verifies DB connectivity
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

app.use('/api/teams', teamsRouter);
app.use('/api/players', playersRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/auctions', auctionsRouter);

app.listen(PORT, () => {
  console.log(`Cricket Auction server running at http://localhost:${PORT}`);
});
