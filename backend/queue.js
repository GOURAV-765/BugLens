import { db } from './database.js';
import { runPlaywrightScan, runGitScan } from './scanners.js';

let isWorkerRunning = false;

// Scan Queue Worker
export function startQueueWorker() {
  console.log('Starting scan job queue worker...');
  
  setInterval(async () => {
    if (isWorkerRunning) return;
    
    // Find next pending job
    const jobs = db.getJobs();
    const pendingJob = jobs.find(j => j.status === 'pending');
    
    if (!pendingJob) return;
    
    isWorkerRunning = true;
    const jobId = pendingJob.id;
    console.log(`[Queue Worker] Processing job ${jobId}`);
    
    try {
      db.updateJob(jobId, { status: 'running', currentStep: 'Configuring sandbox environment...' });
      
      const stepLogger = (stepMsg) => {
        const currentJob = db.getJobById(jobId);
        if (!currentJob || currentJob.status === 'failed') {
          throw new Error('Scan cancelled by user.');
        }
        console.log(`[Job ${jobId}] ${stepMsg}`);
        db.updateJob(jobId, { currentStep: stepMsg });
      };

      let bugs = [];
      if (pendingJob.targetUrl) {
        stepLogger('Initializing Playwright headless browser...');
        bugs = await runPlaywrightScan(pendingJob.targetUrl, stepLogger);
      } else if (pendingJob.repoUrl) {
        stepLogger('Preparing directory for Git clone...');
        bugs = await runGitScan(pendingJob.repoUrl, stepLogger, jobId);
      } else {
        throw new Error('Scan target URL or Git Repo URL must be specified.');
      }
      
      stepLogger('Storing results in SQLite database...');
      db.addBugs(jobId, bugs);
      
      db.updateJob(jobId, { 
        status: 'completed', 
        currentStep: 'Scan complete!',
        finishedAt: new Date().toISOString()
      });
      console.log(`[Queue Worker] Job ${jobId} finished successfully.`);
    } catch (error) {
      console.error(`[Queue Worker] Job ${jobId} failed:`, error);
      db.updateJob(jobId, { 
        status: 'failed', 
        currentStep: 'Failed',
        error: error.message,
        finishedAt: new Date().toISOString()
      });
    } finally {
      isWorkerRunning = false;
    }
  }, 3000);
}
