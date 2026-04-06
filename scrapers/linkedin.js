import { ApifyClient } from 'apify-client';
import { normalizeLinkedInJob } from './unified-schema.js';

/**
 * LinkedIn Jobs Scraper
 * Actor: worldunboxer/rapid-linkedin-scraper (FREE, 4.7★, 3.8K users)
 */
export async function scrapeLinkedIn(token, searchQueries, onProgress) {
  const client = new ApifyClient({ token });
  const allJobs = [];

  for (let i = 0; i < searchQueries.length; i++) {
    const q = searchQueries[i];
    onProgress?.(`LinkedIn: Searching "${q.query}" in ${q.location}... (${i + 1}/${searchQueries.length})`);

    try {
      const input = {
        searchQueries: q.query,
        location: q.location || '',
        count: q.maxResults || 25,
      };

      const run = await client.actor('worldunboxer/rapid-linkedin-scraper').call(input, {
        waitSecs: 120,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const normalized = items.map(item => normalizeLinkedInJob(item, q.query));
      allJobs.push(...normalized);
      onProgress?.(`LinkedIn: Found ${items.length} jobs for "${q.query}"`);
    } catch (err) {
      onProgress?.(`LinkedIn: Error for "${q.query}": ${err.message}`);
      console.error(`LinkedIn scrape error for "${q.query}":`, err.message);
    }
  }

  return allJobs;
}
