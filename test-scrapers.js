import fetch from 'node-fetch';
import cheerio from 'cheerio';

// Test Dice HTML structure
async function testDice() {
  const url = 'https://www.dice.com/jobs?q=Automation+Engineer&location=Atlanta&pageSize=5';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  const html = await res.text();
  
  // Look for patterns with job data
  const patterns = [
    /window\.__NEXT_DATA__/,
    /window\.__data/,
    /window\.initialData/,
    /self\.__next_f\.push/,
    /"title".*?"company"/,
    /dhi-search-card/i,
    /search-card/i,
    /job-card/i,
    /jobTitle/i,
  ];
  
  patterns.forEach(p => {
    const match = html.match(p);
    if (match) {
      const idx = match.index;
      console.log(`Pattern "${p}" found at index ${idx}:`);
      console.log(html.substring(idx, idx + 200));
      console.log('---');
    }
  });

  // Check for Next.js RSC data
  const rscScripts = html.match(/self\.__next_f\.push\(\[[\s\S]*?\]\)/g);
  if (rscScripts) {
    console.log(`\nFound ${rscScripts.length} RSC script chunks`);
    // Look for job data in RSC chunks
    for (const script of rscScripts) {
      if (script.includes('title') && (script.includes('company') || script.includes('salary'))) {
        console.log('\nRSC chunk with job data:');
        console.log(script.substring(0, 500));
        console.log('---');
      }
    }
  }
  
  // Try custom elements
  const $ = cheerio.load(html);
  console.log('\nCustom elements search:');
  console.log('dhi-search-cards:', $('dhi-search-cards').length);
  console.log('dhi-search-card:', $('dhi-search-card').length); 
  console.log('search-card:', $('search-card').length);
  console.log('[data-testid]:', $('[data-testid]').length);
  console.log('a[href*="/job-detail/"]:', $('a[href*="/job-detail/"]').length);
  console.log('a[href*="jobs/detail"]:', $('a[href*="jobs/detail"]').length);
  
  // Look for any links that look like job links
  const jobLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('job') || href.includes('dice.com/job')) {
      jobLinks.push(href);
    }
  });
  console.log('\nJob-related links found:', jobLinks.length);
  jobLinks.slice(0, 5).forEach(l => console.log(' ', l));
}

// Test Google structure
async function testGoogle() {
  const url = `https://www.google.com/search?q=${encodeURIComponent('Automation Engineer jobs indeed.com Atlanta')}&num=10`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    },
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  
  // Try different selectors
  const selectors = ['div.g', '#search a', 'a[data-ved]', 'a[jsname]', '.tF2Cxc', '.yuRUbf a', '.DhN8Cf', 'div[data-snf]'];
  console.log('\nGoogle selectors:');
  selectors.forEach(s => console.log(`  "${s}": ${$(s).length}`));
  
  // Just find all links that point to indeed
  const indeedLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('indeed.com')) {
      indeedLinks.push({ href, text: $(el).text().trim().substring(0, 80) });
    }
  });
  console.log('\nIndeed links in Google results:', indeedLinks.length);
  indeedLinks.slice(0, 5).forEach(l => console.log(`  ${l.text} -> ${l.href.substring(0, 80)}`));
}

testDice().then(testGoogle).catch(e => console.error(e));
