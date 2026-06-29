const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize SQLite database file in current workspace
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}
const dbPath = path.join(dbDir, 'devlens.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Table 1: Users/Developers
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      portfolio_quality_score INTEGER DEFAULT 0,
      collaboration_score INTEGER DEFAULT 0,
      test_ratio_percentage INTEGER DEFAULT 0,
      readme_length_percentage INTEGER DEFAULT 0,
      commit_hygiene_percentage INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table 2: Simulated Target Open-Source Projects
  db.run(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      primary_language TEXT NOT NULL,
      secondary_languages TEXT, -- JSON array of strings
      difficulty TEXT CHECK(difficulty IN ('Beginner', 'Intermediate', 'Advanced')),
      stars INTEGER DEFAULT 0
    )
  `);

  // Seed repositories if database is empty
  db.all('SELECT count(*) as count FROM repositories', [], (err, rows) => {
    if (rows && rows[0].count === 0) {
      const stmt = db.prepare(`
        INSERT INTO repositories (name, description, primary_language, secondary_languages, difficulty, stars)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        'axios/axios', 
        'Promise based HTTP client for the browser and node.js', 
        'JavaScript', 
        JSON.stringify(['TypeScript', 'HTML']), 
        'Beginner', 
        104000
      );
      stmt.run(
        'expressjs/express', 
        'Fast, unopinionated, minimalist web framework for node.', 
        'JavaScript', 
        JSON.stringify(['HTML', 'CSS']), 
        'Intermediate', 
        62000
      );
      stmt.run(
        'pandas-dev/pandas', 
        'Flexible and powerful data analysis / manipulation library for Python', 
        'Python', 
        JSON.stringify(['C', 'Cython', 'HTML']), 
        'Advanced', 
        41000
      );
      stmt.run(
        'facebook/react', 
        'A declarative, efficient, and flexible JavaScript library for building user interfaces.', 
        'JavaScript', 
        JSON.stringify(['TypeScript', 'HTML']), 
        'Advanced', 
        224000
      );
      stmt.finalize();
    }
  });
});

// --- API Endpoints ---

// Get all target repositories
app.get('/api/repositories', (req, res) => {
  db.all('SELECT * FROM repositories', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const repos = rows.map(r => ({
      ...r,
      secondary_languages: JSON.parse(r.secondary_languages || '[]')
    }));
    res.json(repos);
  });
});

// Run portfolio analysis simulation
app.post('/api/analyze', (req, res) => {
  const { username, readmeScore, testScore, commitScore, collabScore } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  // Portfolio Quality Score formula: 40% Readme + 30% Test + 30% Commit
  const pqs = Math.round((readmeScore * 0.4) + (testScore * 0.3) + (commitScore * 0.3));

  // Store user calculations in the database
  db.run(`
    INSERT INTO users (username, portfolio_quality_score, collaboration_score, test_ratio_percentage, readme_length_percentage, commit_hygiene_percentage)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      portfolio_quality_score = excluded.portfolio_quality_score,
      collaboration_score = excluded.collaboration_score,
      test_ratio_percentage = excluded.test_ratio_percentage,
      readme_length_percentage = excluded.readme_length_percentage,
      commit_hygiene_percentage = excluded.commit_hygiene_percentage
  `, [username, pqs, collabScore, testScore, readmeScore, commitScore], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Perform Matchmaking calculations based on Jaccard Similarity vectors
    db.all('SELECT * FROM repositories', [], (err, repos) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Developer stack profile
      const developerLanguages = ['JavaScript', 'HTML'];
      if (commitScore > 60) developerLanguages.push('TypeScript'); // Higher skill unlock
      if (testScore > 50) developerLanguages.push('Python');

      const matches = repos.map(repo => {
        const repoLanguages = [repo.primary_language, ...JSON.parse(repo.secondary_languages || '[]')];
        
        // Jaccard similarity index math
        const union = new Set([...developerLanguages, ...repoLanguages]);
        const intersection = developerLanguages.filter(l => repoLanguages.includes(l));
        const matchingRatio = intersection.length / union.size;
        const matchPercentage = Math.round(matchingRatio * 100);

        // Gap detection
        const missingSkills = repoLanguages.filter(l => !developerLanguages.includes(l));

        return {
          id: repo.id,
          name: repo.name,
          description: repo.description,
          matchPercentage,
          missingSkills,
          difficulty: repo.difficulty
        };
      }).sort((a, b) => b.matchPercentage - a.matchPercentage);

      res.json({
        username,
        portfolioQualityScore: pqs,
        collaborationScore: collabScore,
        recruiterVerdict: pqs >= 65 ? 'Auto-Pass' : (pqs >= 45 ? 'Manual Review' : 'Auto-Reject'),
        matches
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`DevLens Server running on http://localhost:${PORT}`);
});
