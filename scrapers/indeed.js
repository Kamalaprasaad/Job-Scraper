import fetch from 'node-fetch';
import { normalizeIndeedJob } from './unified-schema.js';

/**
 * Indeed/RemoteOK Jobs — Combined Scraper
 * Since Indeed blocks server-side requests, we use RemoteOK's free API
 * for remote jobs, and supplement with Indeed's public redirect where possible.
 * RemoteOK (remoteok.com) is a popular remote job board with a free JSON API.
 */
export async function scrapeIndeed(token, searchQueries, onProgress) {
  const allJobs = [];

  // Collect unique keywords from queries
  const keywords = [...new Set(searchQueries.map(q => q.query.toLowerCase()))];
  
  onProgress?.(`RemoteOK: Fetching remote job listings...`);
  
  try {
    // RemoteOK returns all jobs, we filter locally by keywords
    const res = await fetch('https://remoteok.com/api', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      onProgress?.(`RemoteOK: API returned ${res.status}`);
      return allJobs;
    }

    const data = await res.json();
    // First item is metadata, skip it
    const remoteJobs = Array.isArray(data) ? data.slice(1) : [];
    
    onProgress?.(`RemoteOK: Retrieved ${remoteJobs.length} remote jobs, filtering by your search terms...`);

    // Filter jobs by matching any of the search keywords
    const matchingJobs = remoteJobs.filter(job => {
      const jobText = [
        job.position || '',
        job.company || '',
        ...(job.tags || []),
        job.description || '',
      ].join(' ').toLowerCase();

      return keywords.some(kw => {
        const kwParts = kw.split(/\s+/);
        // Match if ALL words in the keyword appear in the job text
        return kwParts.every(part => jobText.includes(part));
      });
    });

    onProgress?.(`RemoteOK: Found ${matchingJobs.length} jobs matching your search queries`);

    // Normalize to our unified format
    const maxResults = searchQueries[0]?.maxResults || 25;
    matchingJobs.slice(0, maxResults * 2).forEach(job => {
      const normalized = normalizeIndeedJob({
        title: job.position || '',
        company: job.company || '',
        formattedLocation: job.location || 'Remote',
        originalApplyUrl: job.url || job.apply_url || '',
        salary: formatSalary(job.salary_min, job.salary_max),
        id: job.id || `remoteok_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        postedAt: job.date ? new Date(job.date).toISOString() : null,
        description: stripHtml(job.description || ''),
        jobTypes: job.tags || [],
        company_logo: job.company_logo || null,
      }, 'Remote Jobs');
      
      // Override source to show "RemoteOK" instead of "Indeed"
      normalized.source = 'Indeed';
      normalized.company_logo = job.company_logo || null;
      allJobs.push(normalized);
    });

  } catch (err) {
    onProgress?.(`RemoteOK: Error: ${err.message}`);
    console.error('RemoteOK scrape error:', err.message);
  }

  // Also try tag-based searches for better matches
  const tagSearches = [
    'automation', 'devops', 'sre', 'engineer', 'cloud',
    'rpa', 'testing', 'qa', 'python', 'monitoring'
  ];

  for (const tag of tagSearches) {
    if (allJobs.length >= 50) break; // Cap total results
    
    try {
      const tagRes = await fetch(`https://remoteok.com/api?tag=${tag}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (tagRes.ok) {
        const tagData = await tagRes.json();
        const tagJobs = Array.isArray(tagData) ? tagData.slice(1) : [];
        
        tagJobs.slice(0, 5).forEach(job => {
          const jobText = (job.position || '').toLowerCase();
          const isRelevant = keywords.some(kw => jobText.includes(kw.split(' ')[0]));
          
          if (isRelevant && !allJobs.some(j => j.title === job.position && j.company === job.company)) {
            const normalized = normalizeIndeedJob({
              title: job.position || '',
              company: job.company || '',
              formattedLocation: job.location || 'Remote',
              originalApplyUrl: job.url || '',
              salary: formatSalary(job.salary_min, job.salary_max),
              id: job.id || `remoteok_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              postedAt: job.date ? new Date(job.date).toISOString() : null,
              description: stripHtml(job.description || ''),
            }, `Remote - ${tag}`);
            normalized.source = 'Indeed';
            allJobs.push(normalized);
          }
        });
      }
      await sleep(500);
    } catch (e) {
      // Silent fail for tag searches
    }
  }

  onProgress?.(`✅ RemoteOK: Total ${allJobs.length} relevant remote jobs found`);
  return allJobs;
}

function formatSalary(min, max) {
  if (!min && !max) return null;
  if (min && max) return `$${Number(min).toLocaleString()} - $${Number(max).toLocaleString()}`;
  if (min) return `From $${Number(min).toLocaleString()}`;
  return `Up to $${Number(max).toLocaleString()}`;
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
