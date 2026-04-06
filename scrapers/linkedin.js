import cheerio from 'cheerio';
import fetch from 'node-fetch';
import { normalizeLinkedInJob } from './unified-schema.js';

/**
 * LinkedIn Jobs — Direct HTTP Scraper (No API key needed)
 * Scrapes LinkedIn's public job search pages
 */
export async function scrapeLinkedIn(token, searchQueries, onProgress) {
  const allJobs = [];

  for (let i = 0; i < searchQueries.length; i++) {
    const q = searchQueries[i];
    onProgress?.(`LinkedIn: Searching "${q.query}" in ${q.location}... (${i + 1}/${searchQueries.length})`);

    try {
      const jobs = await fetchLinkedInJobs(q.query, q.location, q.maxResults || 25);
      const normalized = jobs.map(item => normalizeLinkedInJob(item, q.query));
      allJobs.push(...normalized);
      onProgress?.(`LinkedIn: Found ${jobs.length} jobs for "${q.query}"`);
    } catch (err) {
      onProgress?.(`LinkedIn: Error for "${q.query}": ${err.message}`);
      console.error(`LinkedIn scrape error for "${q.query}":`, err.message);
    }

    // Rate limit between requests
    if (i < searchQueries.length - 1) await sleep(1500);
  }

  return allJobs;
}

async function fetchLinkedInJobs(query, location, maxResults) {
  const jobs = [];
  const encodedQuery = encodeURIComponent(query);
  const encodedLocation = encodeURIComponent(location || '');

  // LinkedIn public job search API (no auth needed)
  for (let start = 0; start < maxResults; start += 25) {
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodedQuery}&location=${encodedLocation}&start=${start}&f_TPR=r604800`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!res.ok) {
        console.log(`LinkedIn returned ${res.status} for start=${start}`);
        break;
      }

      const html = await res.text();
      if (!html.trim()) break;

      const $ = cheerio.load(html);
      const cards = $('li');

      if (cards.length === 0) break;

      cards.each((_, el) => {
        const card = $(el);
        const title = card.find('.base-search-card__title').text().trim();
        const company = card.find('.base-search-card__subtitle a').text().trim() ||
                       card.find('.base-search-card__subtitle').text().trim();
        const loc = card.find('.job-search-card__location').text().trim();
        const link = card.find('a.base-card__full-link').attr('href') ||
                    card.find('a').first().attr('href') || '';
        const dateEl = card.find('time');
        const postedDate = dateEl.attr('datetime') || dateEl.text().trim();
        const listDate = card.find('.job-search-card__listdate').attr('datetime') ||
                        card.find('.job-search-card__listdate--new').attr('datetime');

        if (title) {
          jobs.push({
            title,
            companyName: company,
            location: loc,
            jobUrl: link.split('?')[0], // Clean URL
            postedAt: listDate || postedDate || null,
            id: link.match(/(\d+)/)?.[1] || `${Date.now()}_${Math.random()}`,
          });
        }
      });

      if (jobs.length >= maxResults) break;
      await sleep(800);
    } catch (err) {
      console.error(`LinkedIn fetch error at start=${start}:`, err.message);
      break;
    }
  }

  return jobs.slice(0, maxResults);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
