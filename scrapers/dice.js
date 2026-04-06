import { ApifyClient } from 'apify-client';
import { normalizeDiceJob } from './unified-schema.js';

/**
 * Dice Jobs Scraper
 * Actor: worldunboxer/dice-jobs-scraper (FREE, 129 users)
 */
export async function scrapeDice(token, searchQueries, onProgress) {
  const client = new ApifyClient({ token });
  const allJobs = [];

  for (let i = 0; i < searchQueries.length; i++) {
    const q = searchQueries[i];
    onProgress?.(`Dice: Searching "${q.query}" in ${q.location}... (${i + 1}/${searchQueries.length})`);

    try {
      const searchUrl = buildDiceUrl(q.query, q.location);

      const input = {
        startUrls: [{ url: searchUrl }],
        maxItems: q.maxResults || 25,
      };

      const run = await client.actor('worldunboxer/dice-jobs-scraper').call(input, {
        waitSecs: 120,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const normalized = items.map(item => normalizeDiceJob(item, q.query));
      allJobs.push(...normalized);
      onProgress?.(`Dice: Found ${items.length} jobs for "${q.query}"`);
    } catch (err) {
      onProgress?.(`Dice: Error for "${q.query}": ${err.message}`);
      console.error(`Dice scrape error for "${q.query}":`, err.message);
    }
  }

  return allJobs;
}

function buildDiceUrl(query, location) {
  const params = new URLSearchParams();
  params.set('q', query);
  if (location && location.toLowerCase() !== 'remote') {
    params.set('location', location);
  }
  params.set('radius', '30');
  params.set('radiusUnit', 'mi');
  params.set('pageSize', '20');
  return `https://www.dice.com/jobs?${params.toString()}`;
}
