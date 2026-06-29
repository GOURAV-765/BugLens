import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.VERCEL 
  ? path.join(os.tmpdir(), 'db.json')
  : path.join(__dirname, 'data', 'db.json');

// Ensure database directory and file exist
function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ jobs: [], bugs: [] }, null, 2), 'utf-8');
  }
}

// Read database
function readDb() {
  initDb();
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading DB, resetting:', error);
    return { jobs: [], bugs: [] };
  }
}

// Write database
function writeDb(data) {
  initDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  // Jobs API
  createJob({ targetUrl, repoUrl }) {
    const data = readDb();
    const newJob = {
      id: 'job_' + Math.random().toString(36).substr(2, 9),
      targetUrl: targetUrl || null,
      repoUrl: repoUrl || null,
      status: 'pending', // pending, running, completed, failed
      currentStep: 'Initializing scan...',
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null
    };
    data.jobs.push(newJob);
    writeDb(data);
    return newJob;
  },

  getJobs() {
    const data = readDb();
    // Return jobs sorted by date desc
    return [...data.jobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getJobById(id) {
    const data = readDb();
    return data.jobs.find(j => j.id === id) || null;
  },

  updateJob(id, updates) {
    const data = readDb();
    const jobIndex = data.jobs.findIndex(j => j.id === id);
    if (jobIndex !== -1) {
      data.jobs[jobIndex] = { ...data.jobs[jobIndex], ...updates };
      writeDb(data);
      return data.jobs[jobIndex];
    }
    return null;
  },

  // Bugs API
  addBug(jobId, bug) {
    const data = readDb();
    const newBug = {
      id: 'bug_' + Math.random().toString(36).substr(2, 9),
      jobId,
      severity: bug.severity || 'medium', // critical, high, medium, low
      type: bug.type || 'quality', // security, quality, accessibility, seo, performance
      title: bug.title || 'Untitled Issue',
      message: bug.message || '',
      details: bug.details || '',
      location: bug.location || null, // { file, line, column, xpath, selector }
      solution: bug.solution || '',
      groupKey: bug.groupKey || 'general'
    };
    data.bugs.push(newBug);
    writeDb(data);
    return newBug;
  },

  addBugs(jobId, bugs) {
    const data = readDb();
    const createdBugs = bugs.map(bug => ({
      id: 'bug_' + Math.random().toString(36).substr(2, 9),
      jobId,
      severity: bug.severity || 'medium',
      type: bug.type || 'quality',
      title: bug.title || 'Untitled Issue',
      message: bug.message || '',
      details: bug.details || '',
      location: bug.location || null,
      solution: bug.solution || '',
      groupKey: bug.groupKey || 'general'
    }));
    data.bugs.push(...createdBugs);
    writeDb(data);
    return createdBugs;
  },

  getBugsForJob(jobId) {
    const data = readDb();
    return data.bugs.filter(b => b.jobId === jobId);
  },

  deleteJob(id) {
    const data = readDb();
    data.jobs = data.jobs.filter(j => j.id !== id);
    data.bugs = data.bugs.filter(b => b.jobId !== id);
    writeDb(data);
    return true;
  }
};
