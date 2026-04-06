import fetch from 'node-fetch';
import cheerio from 'cheerio';
import { normalizeDiceJob } from './unified-schema.js';

/**
 * Dice Jobs — Direct HTML Scraper
 * Scrapes Dice's public job pages, extracts data from RSC payload and HTML
 */
export async function scrapeDice(token, searchQueries, onProgress) {
  const allJobs = [];

  for (let i = 0; i < searchQueries.length; i++) {
    const q = searchQueries[i];
    onProgress?.(`Dice: Searching "${q.query}" in ${q.location}... (${i + 1}/${searchQueries.length})`);

    try {
      const jobs = await fetchDiceJobs(q.query, q.location, q.maxResults || 25);
      const normalized = jobs.map(item => normalizeDiceJob(item, q.query));
      allJobs.push(...normalized);
      onProgress?.(`Dice: Found ${jobs.length} jobs for "${q.query}"`);
    } catch (err) {
      onProgress?.(`Dice: Error for "${q.query}": ${err.message}`);
      console.error(`Dice scrape error for "${q.query}":`, err.message);
    }

    if (i < searchQueries.length - 1) await sleep(2000);
  }

  return allJobs;
}

async function fetchDiceJobs(query, location, maxResults) {
  const jobs = [];
  const params = new URLSearchParams({
    q: query,
    pageSize: String(Math.min(maxResults, 20)),
  });

  if (location && location.toLowerCase() !== 'remote') {
    params.set('location', location);
  }
  if (location?.toLowerCase() === 'remote') {
    params.set('filters.isRemote', 'true');
  }

  const url = `https://www.dice.com/jobs?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      console.log(`Dice returned ${res.status}`);
      return jobs;
    }

    const html = await res.text();

    // Method 1: Extract from RSC (React Server Components) payload — contains structured job data
    const rscScripts = html.match(/self\.__next_f\.push\(\[[\s\S]*?\]\)/g) || [];
    for (const script of rscScripts) {
      if (script.includes('jobList') && script.includes('"data"')) {
        // Extract the jobList data from the RSC chunk
        const jobListMatch = script.match(/"jobList":\{"data":\[([\s\S]*?)\],"meta"/);
        if (jobListMatch) {
          try {
            // The data is double-escaped JSON in RSC format — parse carefully
            const cleanJson = `[${jobListMatch[1]}]`
              .replace(/\\\\/g, '\\')
              .replace(/\\"/g, '"');
            const jobItems = JSON.parse(cleanJson);
            jobItems.forEach(job => {
              jobs.push({
                id: job.id || job.guid || `dice_${Date.now()}_${Math.random()}`,
                title: job.title || '',
                companyName: job.companyName || job.organizationName || '',
                location: job.jobLocation?.displayName || '',
                salary: job.salary || job.compensationSummary || null,
                employmentType: job.employmentType || '',
                jobUrl: job.detailsPageUrl
                  ? `https://www.dice.com${job.detailsPageUrl}`
                  : '',
                postedDate: job.postedDate || null,
                description: job.summary || '',
              });
            });
          } catch (e) {
            // RSC JSON parsing is tricky — fall through to HTML method
          }
        }
      }
    }

    // Method 2: Parse HTML for job detail links and their surrounding info
    if (jobs.length === 0) {
      const $ = cheerio.load(html);
      
      // Dice uses a[href*="/job-detail/"] for job cards
      $('a[href*="/job-detail/"]').each((_, el) => {
        const link = $(el);
        const href = link.attr('href') || '';
        const title = link.text().trim();
        
        // Get the parent card container
        const card = link.closest('[role="article"], [data-testid], .job-card') || link.parent().parent();
        
        // Try to extract company and location from nearby elements
        const cardText = card.text();
        const company = card.find('[data-cy="search-result-company-name"], [data-testid*="company"]').text().trim();
        const loc = card.find('[data-cy="search-result-location"], [data-testid*="location"]').text().trim();

        // Avoid duplicate links
        if (title && title.length > 3 && !jobs.some(j => j.jobUrl === `https://www.dice.com${href}`)) {
          jobs.push({
            id: href.split('/').pop() || `dice_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            title: title,
            companyName: company,
            location: loc,
            salary: null,
            employmentType: '',
            jobUrl: href.startsWith('http') ? href : `https://www.dice.com${href}`,
            postedDate: null,
            description: '',
          });
        }
      });
    }
  } catch (err) {
    console.error(`Dice fetch error:`, err.message);
  }

  return jobs.slice(0, maxResults);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
