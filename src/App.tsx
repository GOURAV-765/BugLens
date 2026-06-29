import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Globe, 
  Github, 
  History, 
  Terminal, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Search, 
  Trash2, 
  ArrowRight, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  HelpCircle,
  Code
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ShinyText } from './components/ReactBits/ShinyText';
import { DecayedCard } from './components/ReactBits/DecayedCard';
import { Magnet } from './components/ReactBits/Magnet';

interface Job {
  id: string;
  targetUrl: string | null;
  repoUrl: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStep: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface Bug {
  id: string;
  jobId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'security' | 'quality' | 'accessibility' | 'seo' | 'performance';
  title: string;
  message: string;
  details: string;
  location: string | null;
  solution: string;
  groupKey: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function App() {
  const [activeTab, setActiveTab] = useState<'scan' | 'history'>('scan');
  const [scanType, setScanType] = useState<'url' | 'repo'>('url');
  const [targetUrl, setTargetUrl] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobData, setActiveJobData] = useState<{ job: Job; bugs: Bug[] } | null>(null);
  const [expandedBugId, setExpandedBugId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs`);
      if (res.ok) {
        const data: Job[] = await res.json();
        const localJobIds = JSON.parse(localStorage.getItem('buglens_job_ids') || '[]');
        const myJobs = data.filter(job => localJobIds.includes(job.id));
        setJobs(myJobs);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  const fetchJobDetails = async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveJobData(data);
      } else {
        setActiveJobId(null);
        setActiveJobData(null);
      }
    } catch (err) {
      console.error('Error fetching job details:', err);
    }
  };

  // Start polling if a job is active and not finished
  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    // Initial fetch
    fetchJobDetails(activeJobId);

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${activeJobId}`);
        if (res.ok) {
          const data = await res.json();
          setActiveJobData(data);
          
          // Refresh list
          fetchJobs();

          if (data.job.status === 'completed' || data.job.status === 'failed') {
            clearInterval(interval);
          }
        } else {
          clearInterval(interval);
          setActiveJobId(null);
          setActiveJobData(null);
        }
      } catch (err) {
        console.error('Polling error:', err);
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJobId]);

  // Submit scan job
  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const body = scanType === 'url' 
      ? { url: targetUrl }
      : { repoUrl: repoUrl };

    try {
      const res = await fetch(`${API_BASE}/api/scan/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const job = await res.json();
        const localJobIds = JSON.parse(localStorage.getItem('buglens_job_ids') || '[]');
        localJobIds.push(job.id);
        localStorage.setItem('buglens_job_ids', JSON.stringify(localJobIds));

        setActiveJobId(job.id);
        setTargetUrl('');
        setRepoUrl('');
        fetchJobs();
      } else {
        const errData = await res.json();
        alert(errData.error || 'Failed to submit scan');
      }
    } catch (err) {
      console.error('Error submitting scan:', err);
      alert('Network error connecting to backend.');
    } finally {
      setLoading(false);
    }
  };

  // Delete scan job
  const handleDeleteJob = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this scan report?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const localJobIds = JSON.parse(localStorage.getItem('buglens_job_ids') || '[]');
        const updatedIds = localJobIds.filter((jobId: string) => jobId !== id);
        localStorage.setItem('buglens_job_ids', JSON.stringify(updatedIds));

        fetchJobs();
        if (activeJobId === id) {
          setActiveJobId(null);
          setActiveJobData(null);
        }
      }
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  // Cancel scan job
  const handleCancelJob = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this scan?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}/cancel`, { method: 'POST' });
      if (res.ok) {
        fetchJobDetails(id);
        fetchJobs();
      }
    } catch (err) {
      console.error('Cancel error:', err);
    }
  };

  // Calculate stats for current active job
  const getSeverityCount = (severity: string) => {
    if (!activeJobData) return 0;
    return activeJobData.bugs.filter(b => b.severity === severity).length;
  };

  const getHealthScore = () => {
    if (!activeJobData || activeJobData.job.status !== 'completed') return 100;
    const critical = getSeverityCount('critical');
    const high = getSeverityCount('high');
    const medium = getSeverityCount('medium');
    const low = getSeverityCount('low');
    
    // Weighted scoring
    const deduction = (critical * 25) + (high * 15) + (medium * 5) + (low * 1);
    const score = Math.max(0, 100 - deduction);
    return score;
  };

  const getHealthGrade = (score: number) => {
    if (score >= 90) return { grade: 'A', color: 'text-teal-400', desc: 'Secure & Clean' };
    if (score >= 75) return { grade: 'B', color: 'text-blue-400', desc: 'Fairly Healthy' };
    if (score >= 60) return { grade: 'C', color: 'text-yellow-400', desc: 'Needs Work' };
    if (score >= 40) return { grade: 'D', color: 'text-orange-400', desc: 'High Risk' };
    return { grade: 'F', color: 'text-red-500', desc: 'Critical Issues' };
  };

  // Filtered bugs
  const filteredBugs = activeJobData
    ? activeJobData.bugs.filter(bug => {
        const sevMatch = filterSeverity === 'all' || bug.severity === filterSeverity;
        const typeMatch = filterType === 'all' || bug.type === filterType;
        return sevMatch && typeMatch;
      })
    : [];

  const handleDownloadJSON = () => {
    if (!activeJobData) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeJobData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `bug-report-${activeJobData.job.id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Prepare chart data
  const getChartData = () => {
    if (!activeJobData) return [];
    return [
      { name: 'Critical', count: getSeverityCount('critical'), fill: '#ef4444' },
      { name: 'High', count: getSeverityCount('fuchsia'), fill: '#d946ef' }, // map high to fuchsia/purple
      { name: 'High', count: getSeverityCount('high'), fill: '#f97316' },
      { name: 'Medium', count: getSeverityCount('medium'), fill: '#eab308' },
      { name: 'Low', count: getSeverityCount('low'), fill: '#14b8a6' },
    ].filter(item => item.count > 0 || item.name !== 'High-Dummy');
  };

  return (
    <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto p-4 md:p-8">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Search className="h-8 w-8 text-purple-500 animate-pulse" />
            <h1 className="text-3xl font-extrabold tracking-tight">
              <ShinyText text="BUGLENS" className="font-black" />
            </h1>
            <span className="bg-purple-900/40 text-purple-400 border border-purple-800 text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-wider">
              V1.0
            </span>
          </div>
          <p className="text-neutral-400 text-sm mt-1">
            Automated Website & Repository Scanning Engine powered by Playwright + Gemini AI
          </p>
        </div>
        
        {/* TABS CONTROLLER */}
        <div className="flex bg-neutral-900/60 p-1 border border-neutral-800 rounded-lg max-w-[320px] self-start md:self-auto">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'scan' 
                ? 'bg-purple-600 text-white shadow-lg' 
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            Scan Console
          </button>
          <button
            onClick={() => {
              setActiveTab('history');
              fetchJobs();
            }}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'history' 
                ? 'bg-purple-600 text-white shadow-lg' 
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Scan History
          </button>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        
        {/* LEFT COLUMN: ACTIVE SCANS / INPUT CONSOLE */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <AnimatePresence mode="wait">
            {activeTab === 'scan' ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col gap-6"
              >
                {/* NEW SCAN CARD */}
                <DecayedCard className="border-neutral-800">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Terminal className="h-4.5 w-4.5 text-purple-400" />
                    Configure New Scan Target
                  </h3>
                  
                  {/* SCAN TYPE TABS */}
                  <div className="grid grid-cols-2 bg-neutral-950 p-1 rounded-lg border border-neutral-800 mb-5">
                    <button
                      onClick={() => setScanType('url')}
                      className={`py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                        scanType === 'url' ? 'bg-neutral-800 text-white border border-neutral-700' : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      Website URL
                    </button>
                    <button
                      onClick={() => setScanType('repo')}
                      className={`py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                        scanType === 'repo' ? 'bg-neutral-800 text-white border border-neutral-700' : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Github className="h-3.5 w-3.5" />
                      GitHub Repo
                    </button>
                  </div>

                  <form onSubmit={handleScanSubmit} className="space-y-4">
                    {scanType === 'url' ? (
                      <div>
                        <label className="block text-neutral-400 text-xs font-semibold mb-2">Target Website URL</label>
                        <input
                          type="url"
                          required
                          value={targetUrl}
                          onChange={(e) => setTargetUrl(e.target.value)}
                          placeholder="https://example.com"
                          className="w-full bg-neutral-950 text-white border border-neutral-800 focus:border-purple-500 focus:outline-none px-4 py-2.5 rounded-lg text-sm transition-all"
                        />
                        <p className="text-[10px] text-neutral-500 mt-1">Playwright will spin up a browser, capture logs, evaluate HTML, and audit metrics.</p>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-neutral-400 text-xs font-semibold mb-2">GitHub Public Repo URL</label>
                        <input
                          type="url"
                          required
                          value={repoUrl}
                          onChange={(e) => setRepoUrl(e.target.value)}
                          placeholder="https://github.com/username/project"
                          className="w-full bg-neutral-950 text-white border border-neutral-800 focus:border-purple-500 focus:outline-none px-4 py-2.5 rounded-lg text-sm transition-all"
                        />
                        <p className="text-[10px] text-neutral-500 mt-1">Scanner clones repo, checks dependencies (npm audit), scanning secrets, NaN errors, debugger statements, and TODOs.</p>
                      </div>
                    )}

                    <Magnet className="w-full">
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 px-4 rounded-lg text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg hover:shadow-purple-500/20 active:scale-98 transition-all disabled:opacity-50"
                      >
                        {loading ? 'Submitting...' : 'Launch Automated Audit'}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </Magnet>
                  </form>
                </DecayedCard>

                {/* CURRENT TRACKING STATE */}
                {activeJobId && activeJobData && (
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 flex flex-col">
                    <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Current Job Status</h4>
                      <span className="text-[10px] text-neutral-500 font-mono">ID: {activeJobData.job.id}</span>
                    </div>

                    <div className="flex items-center gap-3 mb-4">
                      {activeJobData.job.status === 'pending' && <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />}
                      {activeJobData.job.status === 'running' && <Terminal className="h-5 w-5 text-purple-400 animate-spin" />}
                      {activeJobData.job.status === 'completed' && <CheckCircle className="h-5 w-5 text-teal-400" />}
                      {activeJobData.job.status === 'failed' && <XCircle className="h-5 w-5 text-red-500" />}
                      <div>
                        <div className="text-sm font-semibold capitalize text-white">{activeJobData.job.status}</div>
                        <div className="text-xs text-neutral-400">{activeJobData.job.currentStep}</div>
                      </div>
                    </div>

                    {activeJobData.job.error && (
                      <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-red-400 text-xs mb-3 font-mono break-all">
                        {activeJobData.job.error}
                      </div>
                    )}

                    <div className="w-full bg-neutral-950 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${
                          activeJobData.job.status === 'failed' 
                            ? 'bg-red-500 w-full' 
                            : activeJobData.job.status === 'completed'
                            ? 'bg-teal-400 w-full'
                            : activeJobData.job.status === 'running'
                            ? 'bg-purple-500 w-[60%]'
                            : 'bg-yellow-500 w-[10%]'
                        }`}
                      />
                    </div>

                    {(activeJobData.job.status === 'pending' || activeJobData.job.status === 'running') && (
                      <button
                        onClick={() => handleCancelJob(activeJobData.job.id)}
                        className="mt-4 w-full bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-900/50 font-bold py-2 px-4 rounded-lg text-xs cursor-pointer active:scale-98 transition-all"
                      >
                        Cancel Running Scan
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto"
              >
                {/* HISTORICAL JOBS LIST */}
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <History className="h-4.5 w-4.5 text-purple-400" />
                  Past Audit Logs
                </h3>

                {jobs.length === 0 ? (
                  <div className="p-6 bg-neutral-900/20 border border-neutral-800 rounded-xl text-center text-neutral-500 text-sm">
                    No scans found. Start one in the Console tab!
                  </div>
                ) : (
                  jobs.map((j) => (
                    <div
                      key={j.id}
                      onClick={() => {
                        setActiveJobId(j.id);
                        fetchJobDetails(j.id);
                      }}
                      className={`p-4 border rounded-xl cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl ${
                        activeJobId === j.id 
                          ? 'bg-purple-950/20 border-purple-500/60 shadow-purple-500/5' 
                          : 'bg-neutral-900/40 border-neutral-800 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400 mb-1">
                          {j.targetUrl ? <Globe className="h-3.5 w-3.5" /> : <Github className="h-3.5 w-3.5" />}
                          <span className="truncate max-w-[140px] text-white">
                            {j.targetUrl || j.repoUrl}
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDeleteJob(j.id, e)}
                          className="text-neutral-500 hover:text-red-400 p-1 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex justify-between items-center mt-3 text-[10px] text-neutral-500">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(j.createdAt).toLocaleDateString()}
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider ${
                          j.status === 'completed' ? 'bg-teal-950/40 text-teal-400 border border-teal-900/60' :
                          j.status === 'failed' ? 'bg-red-950/40 text-red-400 border border-red-900/60' :
                          'bg-yellow-950/40 text-yellow-400 border border-yellow-900/60'
                        }`}>
                          {j.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT COLUMN: DETAILED REPORT VIEW */}
        <div className="lg:col-span-8 flex flex-col">
          <AnimatePresence mode="wait">
            {!activeJobData ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center p-12 bg-neutral-900/10 border border-dashed border-neutral-800 rounded-3xl text-center min-h-[500px]"
              >
                <div className="bg-neutral-900/80 p-4 rounded-full border border-neutral-800 mb-4 text-neutral-500">
                  <Search className="h-10 w-10 animate-bounce" />
                </div>
                <h3 className="text-xl font-bold text-white">No active report loaded</h3>
                <p className="text-neutral-400 text-sm max-w-sm mt-2">
                  Launch a new scan on a site/repo or choose an existing scan run from history.
                </p>
              </motion.div>
            ) : activeJobData.job.status === 'running' || activeJobData.job.status === 'pending' ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center p-12 bg-neutral-900/10 border border-dashed border-neutral-800 rounded-3xl text-center min-h-[500px]"
              >
                <div className="relative mb-6">
                  <div className="h-16 w-16 border-4 border-purple-500/20 border-t-purple-600 rounded-full animate-spin" />
                  <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-purple-400 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold text-white capitalize">{activeJobData.job.status} Audit</h3>
                <p className="text-purple-400 text-sm max-w-md mt-2 font-mono">
                  &gt; {activeJobData.job.currentStep}
                </p>
                <p className="text-neutral-500 text-xs mt-1">Please stand by as Playwright executes testing and AI models parse logs...</p>
              </motion.div>
            ) : activeJobData.job.status === 'failed' ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center p-12 bg-red-950/10 border border-dashed border-red-900/30 rounded-3xl text-center min-h-[500px]"
              >
                <XCircle className="h-14 w-14 text-red-500 mb-4" />
                <h3 className="text-xl font-bold text-white">Scan Execution Failed</h3>
                <p className="text-red-400 font-mono text-sm max-w-md mt-2 p-3 bg-neutral-900/80 rounded-lg border border-red-950/50 break-all text-left">
                  {activeJobData.job.error || 'Unknown runner engine failure occurred.'}
                </p>
                <p className="text-neutral-400 text-xs mt-3">Try checking target connectivity, CORS configurations, or verify the URL format.</p>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-6"
              >
                {/* REPORT DASHBOARD HEADER */}
                <div className="bg-[#121217] border border-neutral-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 px-2 py-0.5 bg-purple-950/40 rounded border border-purple-900/60">
                        {activeJobData.job.targetUrl ? 'Website Audit' : 'Repository Audit'}
                      </span>
                      <span className="text-xs text-neutral-400 font-mono">Job: {activeJobData.job.id}</span>
                    </div>
                    <h2 className="text-xl font-extrabold truncate text-white max-w-[400px]">
                      {activeJobData.job.targetUrl || activeJobData.job.repoUrl}
                    </h2>
                    <p className="text-neutral-400 text-xs mt-1">
                      Completed at {new Date(activeJobData.job.finishedAt || '').toLocaleString()}
                    </p>
                  </div>

                  {/* SCORE RADIAL & DOWNLOADS */}
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3 bg-neutral-950/80 border border-neutral-800 p-3 rounded-xl">
                      <div className="text-right">
                        <div className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">HEALTH SCORE</div>
                        <div className="text-xs font-semibold text-neutral-300">{getHealthGrade(getHealthScore()).desc}</div>
                      </div>
                      <div className={`text-4xl font-black ${getHealthGrade(getHealthScore()).color} border-l border-neutral-800 pl-3`}>
                        {getHealthGrade(getHealthScore()).grade}
                        <span className="text-xs text-neutral-500 font-normal">/{getHealthScore()}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={handleDownloadJSON}
                        className="flex items-center justify-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-white text-xs font-bold py-2 px-3 rounded-lg cursor-pointer transition-all"
                      >
                        <Download className="h-3.5 w-3.5" />
                        JSON
                      </button>
                    </div>
                  </div>
                </div>

                {/* GRAPH & METRICS GRID */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* CHART CARD */}
                  <div className="md:col-span-8 bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 min-h-[220px] flex flex-col justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-4">Issues Distribution</h4>
                    {activeJobData.bugs.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-neutral-500">
                        Zero bugs detected. Excellent health!
                      </div>
                    ) : (
                      <div className="h-[140px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={getChartData()} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                            <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                            <Tooltip 
                              cursor={{ fill: 'rgba(255,255,255,0.03)' }} 
                              contentStyle={{ background: '#121217', borderColor: '#22222a', borderRadius: 8, fontSize: 11 }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                              {getChartData().map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={entry.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  {/* COUNTERS CARD */}
                  <div className="md:col-span-4 grid grid-cols-2 gap-3">
                    <div className="bg-[#121217] border border-neutral-800 p-4 rounded-xl flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-red-400 tracking-wider uppercase">Critical</span>
                      <span className="text-3xl font-black text-white">{getSeverityCount('critical')}</span>
                    </div>
                    <div className="bg-[#121217] border border-neutral-800 p-4 rounded-xl flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-orange-400 tracking-wider uppercase">High</span>
                      <span className="text-3xl font-black text-white">{getSeverityCount('high')}</span>
                    </div>
                    <div className="bg-[#121217] border border-neutral-800 p-4 rounded-xl flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-yellow-400 tracking-wider uppercase">Medium</span>
                      <span className="text-3xl font-black text-white">{getSeverityCount('medium')}</span>
                    </div>
                    <div className="bg-[#121217] border border-neutral-800 p-4 rounded-xl flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-teal-400 tracking-wider uppercase">Low</span>
                      <span className="text-3xl font-black text-white">{getSeverityCount('low')}</span>
                    </div>
                  </div>
                </div>

                {/* FILTERS */}
                <div className="flex flex-wrap items-center gap-4 bg-neutral-900/30 border border-neutral-800/80 p-3 rounded-xl">
                  <span className="text-xs font-semibold text-neutral-400">Filter Reports:</span>
                  
                  <select 
                    value={filterSeverity} 
                    onChange={(e) => setFilterSeverity(e.target.value)}
                    className="bg-neutral-950 text-white text-xs border border-neutral-800 rounded px-2.5 py-1 focus:outline-none"
                  >
                    <option value="all">All Severities</option>
                    <option value="critical">Critical Only</option>
                    <option value="high">High Only</option>
                    <option value="medium">Medium Only</option>
                    <option value="low">Low Only</option>
                  </select>

                  <select 
                    value={filterType} 
                    onChange={(e) => setFilterType(e.target.value)}
                    className="bg-neutral-950 text-white text-xs border border-neutral-800 rounded px-2.5 py-1 focus:outline-none"
                  >
                    <option value="all">All Categories</option>
                    <option value="security">Security</option>
                    <option value="quality">Quality</option>
                    <option value="accessibility">Accessibility</option>
                    <option value="seo">SEO</option>
                    <option value="performance">Performance & Network</option>
                  </select>
                </div>

                {/* DETECTED BUGS ACCORDION */}
                <div className="space-y-4 mb-12">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <AlertTriangle className="h-4.5 w-4.5 text-purple-400 animate-pulse" />
                    Detected Issues & Diagnostics ({filteredBugs.length})
                  </h3>

                  {filteredBugs.length === 0 ? (
                    <div className="p-8 bg-neutral-900/10 border border-neutral-800 rounded-2xl text-center text-neutral-500 text-sm">
                      No issues match current filters. Good job!
                    </div>
                  ) : (
                    filteredBugs.map((bug) => {
                      const isExpanded = expandedBugId === bug.id;
                      const severityColors = {
                        critical: 'text-red-500 border-red-950 bg-red-950/20',
                        high: 'text-orange-500 border-orange-950 bg-orange-950/20',
                        medium: 'text-yellow-500 border-yellow-950 bg-yellow-950/20',
                        low: 'text-teal-400 border-teal-950 bg-teal-950/20'
                      };

                      const categoryIcons = {
                        security: <Shield className="h-4 w-4" />,
                        quality: <Code className="h-4 w-4" />,
                        accessibility: <HelpCircle className="h-4 w-4" />,
                        seo: <Search className="h-4 w-4" />,
                        performance: <Terminal className="h-4 w-4" />
                      };

                      return (
                        <div 
                          key={bug.id}
                          className="bg-[#121217] border border-neutral-800/80 rounded-xl overflow-hidden shadow transition-colors hover:border-neutral-700"
                        >
                          {/* Accordion header */}
                          <div 
                            onClick={() => setExpandedBugId(isExpanded ? null : bug.id)}
                            className="p-4 flex items-center justify-between cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <span className={`px-2 py-0.5 border text-[9px] font-bold rounded-full uppercase tracking-wider ${severityColors[bug.severity]}`}>
                                {bug.severity}
                              </span>
                              <div className="flex items-center gap-1.5 text-neutral-400 text-xs">
                                {categoryIcons[bug.type]}
                                <span className="capitalize">{bug.type}</span>
                              </div>
                              <span className="font-bold text-sm text-white truncate max-w-[280px] md:max-w-[420px] ml-1">
                                {bug.title}
                              </span>
                            </div>
                            <div className="text-neutral-500 ml-2">
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>

                          {/* Accordion body */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: 'auto' }}
                                exit={{ height: 0 }}
                                className="overflow-hidden border-t border-neutral-800/60"
                              >
                                <div className="p-4 bg-neutral-950/40 text-sm space-y-4 font-sans">
                                  <div>
                                    <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">Issue Context</h5>
                                    <p className="text-neutral-300 font-mono text-xs whitespace-pre-wrap">{bug.message}</p>
                                  </div>

                                  {bug.location && (
                                    <div>
                                      <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">Location</h5>
                                      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-neutral-900 border border-neutral-800 rounded font-mono text-[11px] text-purple-400">
                                        <Code className="h-3 w-3" />
                                        {bug.location}
                                      </div>
                                    </div>
                                  )}

                                  {/* AI RECOMMENDATION BLOCK */}
                                  <div className="bg-purple-950/10 border border-purple-900/30 rounded-xl p-4">
                                    <div className="flex items-center gap-1.5 text-purple-400 mb-2 font-bold text-xs uppercase tracking-wider">
                                      <Sparkles className="h-3.5 w-3.5" />
                                      AI Diagnosis & Resolution
                                    </div>
                                    <p className="text-neutral-300 text-xs leading-relaxed mb-3">
                                      {bug.details}
                                    </p>
                                    <h6 className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5">Suggested Fix:</h6>
                                    <div className="bg-neutral-950 border border-neutral-900 rounded-lg p-3 font-mono text-[11px] text-green-400 whitespace-pre-wrap overflow-x-auto">
                                      {bug.solution}
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
