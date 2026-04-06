/**
 * Unified Job Schema — normalizes data from LinkedIn, Indeed, Dice
 */
export function normalizeLinkedInJob(raw, searchQuery) {
  return {
    id: `linkedin_${raw.id || raw.jobId || raw.title?.replace(/\s+/g, '_')}_${Date.now()}`,
    title: raw.title || raw.jobTitle || 'N/A',
    company: raw.companyName || raw.company || raw.organizationName || 'N/A',
    location: raw.location || raw.jobLocation || raw.formattedLocation || 'N/A',
    salary: raw.salary || raw.salaryInfo || raw.compensationInfo || null,
    jobType: raw.employmentType || raw.contractType || raw.jobType || 'N/A',
    source: 'LinkedIn',
    applyUrl: raw.jobUrl || raw.link || raw.url || raw.applyLink || '#',
    description: raw.description || raw.jobDescription || '',
    postedDate: raw.postedAt || raw.publishedAt || raw.postedDate || raw.listedAt || null,
    skills: raw.skills || [],
    company_logo: raw.companyLogo || raw.organizationLogo || null,
    searchQuery: searchQuery,
    scrapedAt: new Date().toISOString()
  };
}

export function normalizeIndeedJob(raw, searchQuery) {
  let salaryStr = null;
  if (raw.salary) {
    if (typeof raw.salary === 'object') {
      const min = raw.salary.min || '';
      const max = raw.salary.max || '';
      const type = raw.salary.type || '';
      const curr = raw.salary.currencyCode || 'USD';
      salaryStr = min && max ? `${curr} ${min} - ${max} / ${type}` : null;
    } else {
      salaryStr = raw.salary;
    }
  }

  return {
    id: `indeed_${raw.id || raw.jobId || Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: raw.title || raw.jobTitle || 'N/A',
    company: raw.companyDetails?.name || raw.company || raw.companyName || 'N/A',
    location: raw.formattedLocation || raw.location?.formatted?.long || raw.location || 'N/A',
    salary: salaryStr,
    jobType: Array.isArray(raw.jobTypes) ? raw.jobTypes.join(', ') : (raw.jobType || 'N/A'),
    source: 'Indeed',
    applyUrl: raw.originalApplyUrl || (raw.viewJobLink ? `https://www.indeed.com${raw.viewJobLink}` : '#'),
    description: raw.jobDescription || raw.description || '',
    postedDate: raw.pubDate ? new Date(raw.pubDate).toISOString() : (raw.postedAt || null),
    skills: raw.attributes?.filter(a => a.label).map(a => a.label) || [],
    company_logo: raw.companyDetails?.logoUrl || null,
    searchQuery: searchQuery,
    scrapedAt: new Date().toISOString()
  };
}

export function normalizeDiceJob(raw, searchQuery) {
  return {
    id: `dice_${raw.id || raw.jobId || Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: raw.title || raw.jobTitle || 'N/A',
    company: raw.company || raw.companyName || raw.employerName || 'N/A',
    location: raw.location || raw.jobLocation || raw.formattedLocation || 'N/A',
    salary: raw.salary || raw.salaryRange || raw.compensationSummary || null,
    jobType: raw.employmentType || raw.positionType || raw.jobType || 'N/A',
    source: 'Dice',
    applyUrl: raw.jobUrl || raw.url || raw.detailsPageUrl || raw.applyUrl || '#',
    description: raw.description || raw.jobDescription || '',
    postedDate: raw.postedDate || raw.datePosted || raw.pubDate || null,
    skills: raw.skills || raw.requiredSkills || [],
    company_logo: raw.companyLogo || raw.companyLogoUrl || null,
    searchQuery: searchQuery,
    scrapedAt: new Date().toISOString()
  };
}
