import cheerio from 'cheerio';
import fetch from 'node-fetch';
import { normalizeIndeedJob } from './unified-schema.js';

/**
 * Indeed Jobs — Direct HTTP Scraper (No API key needed)
 * Scrapes Indeed's public job search pages
 */
export async function scrapeIndeed(token, searchQueries, onProgress) {
  const allJobs = [];

  for (let i = 0; i < searchQueries.length; i++) {
    const q = searchQueries[i];
    onProgress?.(`Indeed: Searching "${q.query}" in ${q.location}... (${i + 1}/${searchQueries.length})`);

    try {
      const jobs = await fetchIndeedJobs(q.query, q.location, q.maxResults || 25);
      const normalized = jobs.map(item => normalizeIndeedJob(item, q.query));
      allJobs.push(...normalized);
      onProgress?.(`Indeed: Found ${jobs.length} jobs for "${q.query}"`);
    } catch (err) {
      onProgress?.(`Indeed: Error for "${q.query}": ${err.message}`);
      console.error(`Indeed scrape error for "${q.query}":`, err.message);
    }

    if (i < searchQueries.length - 1) await sleep(2000);
  }

  return allJobs;
}

async function fetchIndeedJobs(query, location, maxResults) {
  const jobs = [];
  const encodedQuery = encodeURIComponent(query);
  const encodedLocation = encodeURIComponent(location || '');

  for (let start = 0; start < maxResults; start += 10) {
    const url = `https://www.indeed.com/jobs?q=${encodedQuery}&l=${encodedLocation}&start=${start}&fromage=7&sort=date`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      });

      if (!res.ok) {
        console.log(`Indeed returned ${res.status} for start=${start}`);
        break;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      // Indeed uses multiple possible selectors
      const cards = $('[data-jk], .job_seen_beacon, .jobsearch-ResultsList > li, .resultContent');

      if (cards.length === 0) {
        // Try to extract from embedded JSON (Indeed often embeds job data in scripts)
        const scriptData = extractIndeedJsonFromScript(html);
        if (scriptData.length > 0) {
          jobs.push(...scriptData);
          if (jobs.length >= maxResults) break;
          await sleep(1500);
          continue;
        }
        break;
      }

      cards.each((_, el) => {
        const card = $(el);
        const title = card.find('h2.jobTitle span[title], h2.jobTitle a span, .jobTitle span').text().trim() ||
                      card.find('h2 a').text().trim() ||
                      card.find('.jobTitle').text().trim();
        const company = card.find('[data-testid="company-name"], .companyName, .company').text().trim();
        const loc = card.find('[data-testid="text-location"], .companyLocation, .job-snippet-location').text().trim();
        const jobKey = card.attr('data-jk') || card.find('a[data-jk]').attr('data-jk') || '';
        const link = jobKey ? `https://www.indeed.com/viewjob?jk=${jobKey}` : '';
        const salary = card.find('.salary-snippet-container, .metadata.salary-snippet-container, [class*="salary"]').text().trim();
        const dateText = card.find('.date, .myJobsStateDate').text().trim();

        if (title && title !== 'new') {
          jobs.push({
            title,
            company: company,
            formattedLocation: loc,
            viewJobLink: jobKey ? `/viewjob?jk=${jobKey}` : '',
            originalApplyUrl: link,
            salary: salary || null,
            id: jobKey || `indeed_${Date.now()}_${Math.random()}`,
            postedAt: dateText || null,
          });
        }
      });

      if (jobs.length >= maxResults) break;
      await sleep(1500);
    } catch (err) {
      console.error(`Indeed fetch error at start=${start}:`, err.message);
      break;
    }
  }

  return jobs.slice(0, maxResults);
}

function extractIndeedJsonFromScript(html) {
  const jobs = [];
  try {
    // Indeed often embeds job data in window.mosaic.providerData
    const match = html.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]*?\});/);
    if (match) {
      const data = JSON.parse(match[1]);
      const results = data?.metaData?.mosaicProviderJobCardsModel?.results || [];
      results.forEach(r => {
        if (r.title) {
          jobs.push({
            title: r.title,
            company: r.company,
            formattedLocation: r.formattedLocation || r.jobLocationCity,
            viewJobLink: `/viewjob?jk=${r.jobkey}`,
            originalApplyUrl: `https://www.indeed.com/viewjob?jk=${r.jobkey}`,
            salary: r.estimatedSalary?.formattedRange || r.extractedSalary?.max ? `$${r.extractedSalary.min}-$${r.extractedSalary.max}/${r.extractedSalary.type}` : null,
            id: r.jobkey,
            pubDate: r.pubDate,
          });
        }
      });
    }
  } catch (e) {
    // Silent fail - JSON extraction is best-effort
  }
  return jobs;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
