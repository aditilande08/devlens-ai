const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize SQLite database
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
const dbPath = path.join(dbDir, 'devlens.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Table 1: Scan History — stores every scan with timestamp
  db.run(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      pqs_score INTEGER DEFAULT 0,
      doc_score INTEGER DEFAULT 0,
      test_score INTEGER DEFAULT 0,
      commit_score INTEGER DEFAULT 0,
      collab_score INTEGER DEFAULT 0,
      repos_scanned INTEGER DEFAULT 0,
      languages TEXT DEFAULT '[]',
      tier TEXT DEFAULT '',
      scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table 2: Target Open-Source Repositories for Jaccard matching
  db.run(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      primary_language TEXT NOT NULL,
      secondary_languages TEXT,
      difficulty TEXT CHECK(difficulty IN ('Beginner', 'Intermediate', 'Advanced', 'Expert')),
      stars TEXT DEFAULT '0'
    )
  `);

  // Seed target repositories if empty
  db.get('SELECT count(*) as count FROM repositories', [], (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare(`INSERT INTO repositories (name, description, primary_language, secondary_languages, difficulty, stars) VALUES (?, ?, ?, ?, ?, ?)`);
      const repos = [
        ['facebook/react', 'Declarative UI library for building user interfaces', 'JavaScript', '["TypeScript","HTML","CSS"]', 'Advanced', '224k'],
        ['expressjs/express', 'Fast, minimalist web framework for Node.js', 'JavaScript', '["HTML"]', 'Intermediate', '62k'],
        ['django/django', 'High-level Python web framework', 'Python', '["HTML","CSS","JavaScript"]', 'Advanced', '78k'],
        ['rust-lang/rust', 'Systems programming language focused on safety', 'Rust', '["Python","Shell","JavaScript"]', 'Expert', '95k'],
        ['golang/go', 'The Go programming language', 'Go', '["Assembly","HTML","Shell"]', 'Expert', '121k'],
        ['vuejs/vue', 'Progressive JavaScript framework', 'JavaScript', '["TypeScript","HTML"]', 'Intermediate', '207k'],
        ['pallets/flask', 'Lightweight Python web framework', 'Python', '["HTML","CSS"]', 'Beginner', '67k'],
        ['rails/rails', 'Full-stack Ruby web framework', 'Ruby', '["JavaScript","HTML","CSS"]', 'Advanced', '55k']
      ];
      repos.forEach(r => stmt.run(...r));
      stmt.finalize();
    }
  });
});

// --- API Endpoints ---

// Save scan result to history
app.post('/api/scan', (req, res) => {
  const { username, pqs_score, doc_score, test_score, commit_score, collab_score, repos_scanned, languages, tier } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  
  db.run(`INSERT INTO scan_history (username, pqs_score, doc_score, test_score, commit_score, collab_score, repos_scanned, languages, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, pqs_score || 0, doc_score || 0, test_score || 0, commit_score || 0, collab_score || 0, repos_scanned || 0, JSON.stringify(languages || []), tier || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Scan saved' });
    }
  );
});

// Get scan history for a user (or all users)
app.get('/api/history', (req, res) => {
  const { username } = req.query;
  const query = username
    ? 'SELECT * FROM scan_history WHERE username = ? ORDER BY scanned_at DESC LIMIT 20'
    : 'SELECT * FROM scan_history ORDER BY scanned_at DESC LIMIT 50';
  const params = username ? [username] : [];
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({ ...r, languages: JSON.parse(r.languages || '[]') })));
  });
});

// Get all target repositories
app.get('/api/repositories', (req, res) => {
  db.all('SELECT * FROM repositories', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({ ...r, secondary_languages: JSON.parse(r.secondary_languages || '[]') })));
  });
});

// Get stats summary
app.get('/api/stats', (req, res) => {
  db.all('SELECT COUNT(*) as total_scans, COUNT(DISTINCT username) as unique_users, AVG(pqs_score) as avg_pqs FROM scan_history', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows[0]);
  });
});

app.listen(PORT, () => {
  console.log(`DevLens AI Server running on http://localhost:${PORT}`);
});
