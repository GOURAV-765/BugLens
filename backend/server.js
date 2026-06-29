import express from 'express';
import cors from 'cors';
import { db } from './database.js';
import { startQueueWorker } from './queue.js';

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

// API Endpoints

// Submit a new scan job
app.post('/api/scan/submit', (req, res) => {
  const { url, repoUrl } = req.body;
  if (!url && !repoUrl) {
    return res.status(400).json({ error: 'Please provide either a website URL or a GitHub Repository URL.' });
  }

  try {
    const job = db.createJob({ targetUrl: url, repoUrl: repoUrl });
    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all jobs
app.get('/api/jobs', (req, res) => {
  try {
    const jobs = db.getJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific job + bugs
app.get('/api/jobs/:id', (req, res) => {
  const { id } = req.params;
  try {
    const job = db.getJobById(id);
    if (!job) {
      return res.status(404).json({ error: 'Scan job not found.' });
    }
    const bugs = db.getBugsForJob(id);
    res.json({ job, bugs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete specific job + bugs
app.delete('/api/jobs/:id', (req, res) => {
  const { id } = req.params;
  try {
    const success = db.deleteJob(id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`[Server] Bug Analyzer backend running on http://localhost:${PORT}`);
  // Start job queue background worker
  startQueueWorker();
});
