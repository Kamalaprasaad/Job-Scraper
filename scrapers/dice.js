import fetch from 'node-fetch';
import { normalizeDiceJob } from './unified-schema.js';

/**
 * Dice Jobs — Direct HTTP Scraper (No API key needed)
 * Uses Dice's public search API endpoint
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

    if (i < searchQueries.length - 1) await sleep(1500);
  }

  return allJobs;
}

async function fetchDiceJobs(query, location, maxResults) {
  const jobs = [];
  const pageSize = Math.min(maxResults, 20);

  // Dice has a public JSON API for search
  for (let page = 1; jobs.length < maxResults; page++) {
    const params = new URLSearchParams({
      q: query,
      countryCode2: 'US',
      radius: '30',
      radiusUnit: 'mi',
      page: String(page),
      pageSize: String(pageSize),
      fields: 'id|jobId|summary|title|postedDate|modifiedDate|jobLocation.displayName|detailsPageUrl|salary|clientBrandId|companyPageUrl|companyName|employmentType|isRemote|guid',
      culture: 'en',
      recommendations: 'true',
      interactionId: '0',
      fj: 'true',
      includeRemote: 'true',
    });

    if (location && location.toLowerCase() !== 'remote') {
      params.set('location', location);
    }

    const url = `https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'x-api-key': 'JHB7yGXyBnGkEzZ4Io9Tun22sGpjOaFV', // Dice's public client-side API key
        },
      });

      if (!res.ok) {
        console.log(`Dice API returned ${res.status} for page ${page}`);
        break;
      }

      const data = await res.json();
      const results = data.data || [];

      if (results.length === 0) break;

      results.forEach(job => {
        jobs.push({
          id: job.id || job.guid,
          title: job.title,
          companyName: job.companyName,
          location: job.jobLocation?.displayName || (job.isRemote ? 'Remote' : ''),
          salary: job.salary || null,
          employmentType: job.employmentType || '',
          jobUrl: job.detailsPageUrl ? `https://www.dice.com${job.detailsPageUrl}` : '',
          postedDate: job.postedDate,
          description: job.summary || '',
          isRemote: job.isRemote,
        });
      });

      if (results.length < pageSize) break;
      await sleep(800);
    } catch (err) {
      console.error(`Dice fetch error page ${page}:`, err.message);
      break;
    }
  }

  return jobs.slice(0, maxResults);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
