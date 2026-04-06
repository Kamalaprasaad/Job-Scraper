import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { scrapeLinkedIn } from './scrapers/linkedin.js';
import { scrapeIndeed } from './scrapers/indeed.js';
import { scrapeDice } from './scrapers/dice.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── In-Memory Store ──────────────────────────────────────────────
let jobCache = [];
let scrapeStatus = { running: false, progress: [], startedAt: null, completedAt: null };

// ─── Default Search Queries (based on resume) ────────────────────
const DEFAULT_QUERIES = [
  { query: 'Automation Engineer', location: 'Atlanta, GA' },
  { query: 'Automation Engineer', location: 'Remote' },
  { query: 'Production Support Engineer', location: 'Atlanta, GA' },
  { query: 'Production Support Engineer', location: 'New Jersey' },
  { query: 'DevOps Engineer', location: 'Atlanta, GA' },
  { query: 'DevOps Engineer', location: 'Remote' },
  { query: 'Cloud DevOps Engineer', location: 'Remote' },
  { query: 'Software Engineer', location: 'Atlanta, GA' },
  { query: 'RPA Support Engineer', location: 'Remote' },
  { query: 'RPA Consultant', location: 'Remote' },
  { query: 'UiPath Developer', location: 'Remote' },
  { query: 'Pega Developer', location: 'Remote' },
  { query: 'UiPath Consultant', location: 'Remote' },
  { query: 'Pega Consultant', location: 'Remote' },
  { query: 'Power Automate Developer', location: 'Remote' },
  { query: 'PowerApps Developer', location: 'Remote' },
  { query: 'SRE', location: 'Atlanta, GA' },
  { query: 'SRE', location: 'Remote' },
  { query: 'Automation Test Engineer', location: 'Atlanta, GA' },
  { query: 'Automation Test Engineer', location: 'Remote' },
  { query: 'DevOps Engineer observability', location: 'Remote' },
  { query: 'Agentic Automation Developer', location: 'Remote' },
];

// ─── Helper: Deduplicate jobs ────────────────────────────────────
function deduplicateJobs(jobs) {
  const seen = new Map();
  return jobs.filter(job => {
    const key = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}_${job.source}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

// ─── Helper: Progress tracker ────────────────────────────────────
function createProgressTracker() {
  return (msg) => {
    scrapeStatus.progress.push({ time: new Date().toISOString(), message: msg });
    console.log(`[SCRAPE] ${msg}`);
  };
}

// ─── API: Get current jobs ───────────────────────────────────────
app.get('/api/jobs', (req, res) => {
  res.json({
    total: jobCache.length,
    jobs: jobCache,
    status: scrapeStatus
  });
});

// ─── API: Get scrape status ──────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json(scrapeStatus);
});

// ─── API: Scrape from a single source ────────────────────────────
app.post('/api/scrape/:source', async (req, res) => {
  const { source } = req.params;
  const token = req.body.token || process.env.APIFY_API_TOKEN;
  const queries = req.body.queries || DEFAULT_QUERIES.slice(0, 3); // limit for single source
  const maxResults = req.body.maxResults || 15;

  if (!token) {
    return res.status(400).json({ error: 'Apify API token is required. Set it in the dashboard settings or .env file.' });
  }

  const queriesWithMax = queries.map(q => ({ ...q, maxResults }));
  const onProgress = createProgressTracker();

  scrapeStatus.running = true;
  scrapeStatus.progress = [];
  scrapeStatus.startedAt = new Date().toISOString();
  scrapeStatus.completedAt = null;

  // Return immediately, scrape in background
  res.json({ status: 'started', source, queryCount: queriesWithMax.length });

  try {
    let newJobs = [];
    switch (source) {
      case 'linkedin':
        newJobs = await scrapeLinkedIn(token, queriesWithMax, onProgress);
        break;
      case 'indeed':
        newJobs = await scrapeIndeed(token, queriesWithMax, onProgress);
        break;
      case 'dice':
        newJobs = await scrapeDice(token, queriesWithMax, onProgress);
        break;
      default:
        onProgress(`Unknown source: ${source}`);
    }

    jobCache = deduplicateJobs([...jobCache, ...newJobs]);
    onProgress(`✅ ${source} complete: ${newJobs.length} new jobs (Total: ${jobCache.length})`);
  } catch (err) {
    onProgress(`❌ ${source} failed: ${err.message}`);
  } finally {
    scrapeStatus.running = false;
    scrapeStatus.completedAt = new Date().toISOString();
  }
});

// ─── API: Scrape from ALL sources ────────────────────────────────
app.post('/api/scrape/all', async (req, res) => {
  const token = req.body.token || process.env.APIFY_API_TOKEN;
  const queries = req.body.queries || DEFAULT_QUERIES;
  const maxResults = req.body.maxResults || 10;

  if (!token) {
    return res.status(400).json({ error: 'Apify API token is required.' });
  }

  const queriesWithMax = queries.map(q => ({ ...q, maxResults }));
  const onProgress = createProgressTracker();

  scrapeStatus.running = true;
  scrapeStatus.progress = [];
  scrapeStatus.startedAt = new Date().toISOString();
  scrapeStatus.completedAt = null;

  res.json({ status: 'started', sources: ['linkedin', 'indeed', 'dice'], queryCount: queriesWithMax.length });

  try {
    // Send top queries to each source for broad coverage
    const topQueries = queriesWithMax.slice(0, 7);

    onProgress('🚀 Starting parallel scrape across LinkedIn, Indeed, and Dice...');

    const [linkedInJobs, indeedJobs, diceJobs] = await Promise.allSettled([
      scrapeLinkedIn(token, topQueries, onProgress),
      scrapeIndeed(token, topQueries, onProgress),
      scrapeDice(token, topQueries, onProgress),
    ]);

    const allNewJobs = [
      ...(linkedInJobs.status === 'fulfilled' ? linkedInJobs.value : []),
      ...(indeedJobs.status === 'fulfilled' ? indeedJobs.value : []),
      ...(diceJobs.status === 'fulfilled' ? diceJobs.value : []),
    ];

    jobCache = deduplicateJobs([...jobCache, ...allNewJobs]);
    onProgress(`✅ All scrapers complete: ${allNewJobs.length} new jobs (Total: ${jobCache.length})`);
  } catch (err) {
    onProgress(`❌ Scrape all failed: ${err.message}`);
  } finally {
    scrapeStatus.running = false;
    scrapeStatus.completedAt = new Date().toISOString();
  }
});

// ─── API: Clear cache ────────────────────────────────────────────
app.delete('/api/jobs', (req, res) => {
  jobCache = [];
  scrapeStatus = { running: false, progress: [], startedAt: null, completedAt: null };
  res.json({ status: 'cleared' });
});

// ─── API: Export ─────────────────────────────────────────────────
app.get('/api/export/:format', (req, res) => {
  const { format } = req.params;

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=jobs_export.json');
    res.json(jobCache);
  } else if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=jobs_export.csv');

    const headers = ['Title', 'Company', 'Location', 'Salary', 'Job Type', 'Source', 'Apply URL', 'Posted Date', 'Search Query'];
    const csvRows = [headers.join(',')];
    jobCache.forEach(job => {
      const row = [
        `"${(job.title || '').replace(/"/g, '""')}"`,
        `"${(job.company || '').replace(/"/g, '""')}"`,
        `"${(job.location || '').replace(/"/g, '""')}"`,
        `"${(job.salary || 'N/A').replace(/"/g, '""')}"`,
        `"${(job.jobType || 'N/A').replace(/"/g, '""')}"`,
        `"${job.source}"`,
        `"${job.applyUrl || ''}"`,
        `"${job.postedDate || 'N/A'}"`,
        `"${(job.searchQuery || '').replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(','));
    });
    res.send(csvRows.join('\n'));
  } else {
    res.status(400).json({ error: 'Unsupported format. Use json or csv.' });
  }
});

// ─── API: Get default queries ────────────────────────────────────
app.get('/api/queries', (req, res) => {
  res.json(DEFAULT_QUERIES);
});

// ─── Start Server ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Job Scraper Dashboard running at http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔧 API: http://localhost:${PORT}/api/jobs\n`);
});
