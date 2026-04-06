import { ApifyClient } from 'apify-client';
import { normalizeIndeedJob } from './unified-schema.js';

/**
 * Indeed Jobs Scraper
 * Actor: valig/indeed-jobs-scraper (FREE, 5.0★, 3.4K users)
 */
export async function scrapeIndeed(token, searchQueries, onProgress) {
  const client = new ApifyClient({ token });
  const allJobs = [];

  for (let i = 0; i < searchQueries.length; i++) {
    const q = searchQueries[i];
    onProgress?.(`Indeed: Searching "${q.query}" in ${q.location}... (${i + 1}/${searchQueries.length})`);

    try {
      const input = {
        keyword: q.query,
        location: q.location || 'United States',
        maxItems: q.maxResults || 25,
        country: 'US',
        parseCompanyDetails: false,
      };

      const run = await client.actor('valig/indeed-jobs-scraper').call(input, {
        waitSecs: 120,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const normalized = items.map(item => normalizeIndeedJob(item, q.query));
      allJobs.push(...normalized);
      onProgress?.(`Indeed: Found ${items.length} jobs for "${q.query}"`);
    } catch (err) {
      onProgress?.(`Indeed: Error for "${q.query}": ${err.message}`);
      console.error(`Indeed scrape error for "${q.query}":`, err.message);
    }
  }

  return allJobs;
}
