import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import fetch from 'node-fetch';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY || '';
let ai = null;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
}

// ----------------------------------------------------
// 1. Grouping Engine & Log Parser
// ----------------------------------------------------
function groupAndParseLogs(logs, networkErrors) {
  const groupedBugs = [];

  // Group console logs/errors
  const consoleGroups = {};
  logs.forEach(log => {
    // Sanitize log to create a good key
    const cleanedText = log.text.replace(/0x[0-9a-fA-F]+/g, 'HEX').replace(/\d+/g, 'NUM');
    const groupKey = `console_${log.type}_${Buffer.from(cleanedText.substring(0, 100)).toString('base64')}`;
    
    if (!consoleGroups[groupKey]) {
      consoleGroups[groupKey] = {
        type: 'quality',
        severity: log.type === 'error' ? 'high' : log.type === 'warning' ? 'medium' : 'low',
        title: `Console ${log.type}: ${log.text.substring(0, 60)}${log.text.length > 60 ? '...' : ''}`,
        message: log.text,
        occurrences: 0,
        locations: []
      };
    }
    
    consoleGroups[groupKey].occurrences += 1;
    if (log.location && !consoleGroups[groupKey].locations.includes(log.location)) {
      consoleGroups[groupKey].locations.push(log.location);
    }
  });

  Object.values(consoleGroups).forEach(group => {
    groupedBugs.push({
      severity: group.severity,
      type: 'quality',
      title: group.title,
      message: `${group.message}${group.occurrences > 1 ? ` (Occurred ${group.occurrences} times)` : ''}`,
      details: `Console logged stack indicators pointing to source locations: ${group.locations.join(', ')}`,
      location: group.locations[0] || 'Browser Console',
      groupKey: 'console'
    });
  });

  // Group network errors
  const networkGroups = {};
  networkErrors.forEach(err => {
    const cleanUrl = err.url.split('?')[0];
    const groupKey = `net_${err.status}_${Buffer.from(cleanUrl.substring(0, 100)).toString('base64')}`;
    if (!networkGroups[groupKey]) {
      networkGroups[groupKey] = {
        severity: err.status === 404 ? 'medium' : 'high',
        title: `Network Fail: HTTP ${err.status || 'ERR'} - ${path.basename(cleanUrl) || 'Request'}`,
        message: `Failed to load asset: ${err.url} with status ${err.status || 'failed'} (${err.errorText || 'Network Error'}).`,
        occurrences: 0,
        url: err.url
      };
    }
    networkGroups[groupKey].occurrences += 1;
  });

  Object.values(networkGroups).forEach(group => {
    groupedBugs.push({
      severity: group.severity,
      type: 'performance',
      title: group.title,
      message: `${group.message}${group.occurrences > 1 ? ` (Occurred ${group.occurrences} times)` : ''}`,
      details: `Network failed request. Loading this asset is blocked or returning an error status code.`,
      location: group.url,
      groupKey: 'network'
    });
  });

  return groupedBugs;
}

// ----------------------------------------------------
// 2. Gemini AI Advisor Helper
// ----------------------------------------------------
async function getAIAnalysis(bugs) {
  if (!bugs || bugs.length === 0) return bugs;

  if (!ai) {
    return bugs.map(bug => {
      let solution = 'Review configuration settings and trace stack files.';
      let details = 'Detailed audit report flag indicating standard code quality or optimization checklist item.';
      
      if (bug.groupKey === 'console') {
        solution = `1. Trace JavaScript stack references at: ${bug.location}.\n2. Ensure all external variables are loaded before accessing them.\n3. Add defensive null checks around target elements.`;
        details = 'Client-side runtime error detected. Check console outputs and unhandled execution blocks.';
      } else if (bug.groupKey === 'network') {
        solution = `1. Verify file exists at resource target: ${bug.location}.\n2. Configure proper CORS (Cross-Origin Resource Sharing) headers on the host server.\n3. Check for correct asset relative/absolute paths.`;
        details = 'Network request failed. Browser block or broken resource location detected.';
      } else if (bug.type === 'accessibility') {
        solution = `Add correct labels, tags, and ARIA attributes matching WCAG standards to ensure screen-reader clarity and element focus.`;
        details = 'Accessibility checkpoint mismatch. Element fails WCAG 2.1 compliance specifications.';
      } else if (bug.type === 'security') {
        solution = `Rotate keys immediately. Add .env to .gitignore. Utilize environments managers or secure configuration storage vaults.`;
        details = 'Exposed configuration token, credentials, or security configuration warning found.';
      }
      
      return {
        ...bug,
        solution: bug.solution || solution,
        details: bug.details || details
      };
    });
  }

  try {
    const chunkedBugs = [];
    const size = 10; // Chunk into sets of 10 to fit context windows efficiently
    for (let i = 0; i < bugs.length; i += size) {
      chunkedBugs.push(bugs.slice(i, i + size));
    }

    const analyzedBugs = [];
    for (const chunk of chunkedBugs) {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an expert debugger and security analyst. Resolve software bugs and vulnerabilities. I will provide you with a JSON list of issues. For each issue, analyze the details and fill in the "details" (detailed root-cause breakdown) and "solution" (code snippets or clear markdown guide on how to fix it) fields.

Issues:
${JSON.stringify(chunk, null, 2)}

Return a raw JSON array matching the structure of input items. Do not put markdown blocks like \`\`\`json around the output.`
      });

      const text = response.text.trim();
      try {
        const parsed = JSON.parse(text);
        analyzedBugs.push(...parsed);
      } catch (parseErr) {
        console.error('Failed to parse AI output chunk. Falling back to default explanations.', parseErr);
        analyzedBugs.push(...chunk.map(b => ({
          ...b,
          details: b.details || 'Unable to fetch dynamic AI analysis.',
          solution: b.solution || 'Verify files manually.'
        })));
      }
    }

    return analyzedBugs;
  } catch (error) {
    console.error('Gemini AI call failed, falling back to simulated answers:', error);
    ai = null;
    return getAIAnalysis(bugs);
  }
}

// ----------------------------------------------------
// 3. Playwright Web Scanner (High Quality Audits)
// ----------------------------------------------------
export async function runPlaywrightScan(url, jobLogger) {
  jobLogger('Launching headless browser sandbox...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const logs = [];
  const networkErrors = [];

  // Listeners
  page.on('console', msg => {
    const loc = msg.location();
    logs.push({
      type: msg.type(),
      text: msg.text(),
      location: loc ? `${loc.url || 'inline'}:${loc.lineNumber || 0}:${loc.columnNumber || 0}` : 'Unknown'
    });
  });

  page.on('pageerror', err => {
    logs.push({
      type: 'error',
      text: `${err.name}: ${err.message}\nStack: ${err.stack}`,
      location: 'Uncaught Exception'
    });
  });

  page.on('response', response => {
    const status = response.status();
    if (status >= 400) {
      networkErrors.push({
        url: response.url(),
        status,
        errorText: `HTTP ${status}`
      });
    }
  });

  page.on('requestfailed', request => {
    networkErrors.push({
      url: request.url(),
      status: null,
      errorText: request.failure()?.errorText || 'Unknown'
    });
  });

  try {
    jobLogger(`Connecting and navigating to URL: ${url}`);
    const response = await page.goto(url, { waitUntil: 'load', timeout: 35000 });
    
    await page.waitForTimeout(3000); // allow dynamic scripts to execute

    jobLogger('Inspecting HTTP response headers for security issues...');
    const headers = response.headers();
    const securityIssues = [];

    if (!url.startsWith('https://')) {
      securityIssues.push({
        severity: 'high',
        type: 'security',
        title: 'Site not using SSL (HTTPS)',
        message: 'The website is loaded over HTTP. Connection data is not encrypted.',
        location: 'Protocol Check',
        groupKey: 'ssl'
      });
    }

    const secureHeaders = [
      { name: 'content-security-policy', label: 'Content-Security-Policy (CSP)', severity: 'high', desc: 'Mitigates XSS and clickjacking attacks.' },
      { name: 'strict-transport-security', label: 'Strict-Transport-Security (HSTS)', severity: 'medium', desc: 'Enforces secure HTTPS connections.' },
      { name: 'x-frame-options', label: 'X-Frame-Options', severity: 'medium', desc: 'Protects website users against clickjacking.' },
      { name: 'x-content-type-options', label: 'X-Content-Type-Options', severity: 'low', desc: 'Prevents browser mime-type sniffing.' },
      { name: 'referrer-policy', label: 'Referrer-Policy', severity: 'low', desc: 'Controls referrer data sent in request headers.' }
    ];

    secureHeaders.forEach(sh => {
      if (!headers[sh.name]) {
        securityIssues.push({
          severity: sh.severity,
          type: 'security',
          title: `Missing security header: ${sh.label}`,
          message: `The server response does not contain the "${sh.label}" header. ${sh.desc}`,
          location: 'HTTP Response Headers',
          groupKey: 'headers'
        });
      }
    });

    jobLogger('Extracting CSS styles for compatibility audits...');
    const cssFiles = [];
    const cssIssues = [];
    
    // Find stylesheets in DOM
    const links = await page.$$eval('link[rel="stylesheet"]', elements => elements.map(el => el.href));
    for (const linkHref of links.slice(0, 5)) { // Limit to top 5 styles to preserve speed
      try {
        const cssRes = await fetch(linkHref);
        if (cssRes.ok) {
          const cssText = await cssRes.text();
          // Scan for deprecated properties / compatibility flags
          if (cssText.includes('-webkit-box-reflect') || cssText.includes('-webkit-background-clip: text')) {
            cssIssues.push({
              severity: 'low',
              type: 'quality',
              title: 'CSS vendor specific prefixed properties',
              message: `Style at "${linkHref}" contains webkit-only vendor prefixes. Use standard fallback.`,
              location: linkHref,
              groupKey: 'css_compat'
            });
          }
          if (cssText.includes('zoom:') && !cssText.includes('zoom: 1')) {
            cssIssues.push({
              severity: 'low',
              type: 'quality',
              title: 'CSS zoom property compatibility warning',
              message: 'Found use of the non-standard "zoom" property which is deprecated in modern Firefox engines.',
              location: linkHref,
              groupKey: 'css_compat'
            });
          }
        }
      } catch (err) {
        // ignore stylesheet fetching errors
      }
    }

    jobLogger('Parsing DOM for SEO, quality, and WCAG accessibility audits...');
    const htmlContent = await page.content();
    const $ = cheerio.load(htmlContent);
    const accessibilityIssues = [];
    const seoIssues = [];

    // SEO checks
    const title = $('title').text().trim();
    if (!title) {
      seoIssues.push({
        severity: 'medium',
        type: 'seo',
        title: 'Missing HTML page Title',
        message: 'The website page is missing a <title> tag in the HTML head.',
        location: 'HTML Head',
        groupKey: 'seo'
      });
    } else if (title.length < 10 || title.length > 70) {
      seoIssues.push({
        severity: 'low',
        type: 'seo',
        title: 'Improper title length',
        message: `Title length (${title.length} chars) is outside optimal range (10-70 characters) for search previews.`,
        location: `<title> tag: "${title}"`,
        groupKey: 'seo'
      });
    }

    const description = $('meta[name="description"]').attr('content')?.trim();
    if (!description) {
      seoIssues.push({
        severity: 'medium',
        type: 'seo',
        title: 'Missing SEO meta description',
        message: 'The website is missing a meta description in the HTML head.',
        location: 'HTML Head',
        groupKey: 'seo'
      });
    } else if (description.length < 50 || description.length > 160) {
      seoIssues.push({
        severity: 'low',
        type: 'seo',
        title: 'Improper meta description length',
        message: `Description length (${description.length} chars) is outside optimal range (50-160 chars).`,
        location: `<meta name="description">`,
        groupKey: 'seo'
      });
    }

    const h1 = $('h1');
    if (h1.length === 0) {
      seoIssues.push({
        severity: 'medium',
        type: 'seo',
        title: 'Missing H1 heading tag',
        message: 'The page lacks a main H1 heading tag, which harms SEO search algorithms.',
        location: 'Page Body',
        groupKey: 'seo'
      });
    } else if (h1.length > 1) {
      seoIssues.push({
        severity: 'low',
        type: 'seo',
        title: 'Multiple H1 heading tags',
        message: `Found ${h1.length} H1 headings. Only one primary H1 header should exist per page.`,
        location: 'Page Body',
        groupKey: 'seo'
      });
    }

    // Accessibility Checks
    $('img').each((idx, elem) => {
      const alt = $(elem).attr('alt');
      const src = $(elem).attr('src') || 'unknown';
      if (alt === undefined) {
        accessibilityIssues.push({
          severity: 'medium',
          type: 'accessibility',
          title: 'Image lacks Alt attribute',
          message: `Image source "${src.substring(0, 80)}" has no alt description. Fails WCAG screen reader check.`,
          location: `<img> element (src: ${src.substring(0, 80)})`,
          groupKey: 'alt_tag'
        });
      } else if (alt.trim() === '' && !$(elem).attr('role')) {
        accessibilityIssues.push({
          severity: 'low',
          type: 'accessibility',
          title: 'Empty alt tag without decorative role',
          message: 'If the image is purely decorative, add role="presentation" or role="none".',
          location: `<img> element`,
          groupKey: 'alt_tag'
        });
      }
    });

    $('button').each((idx, elem) => {
      const text = $(elem).text().trim();
      const aria = $(elem).attr('aria-label') || $(elem).attr('aria-labelledby');
      if (!text && !aria) {
        accessibilityIssues.push({
          severity: 'high',
          type: 'accessibility',
          title: 'Interactive button has no label',
          message: 'An interactive button is empty and has no ARIA fallback labels.',
          location: '<button> tag',
          groupKey: 'button_label'
        });
      }
    });

    // Check for duplicate element IDs in HTML (Standard Accessibility Issue)
    const seenIds = {};
    $('[id]').each((idx, elem) => {
      const id = $(elem).attr('id');
      if (id) {
        if (seenIds[id]) {
          accessibilityIssues.push({
            severity: 'medium',
            type: 'accessibility',
            title: `Duplicate HTML ID attribute: "${id}"`,
            message: `The ID value "${id}" is used multiple times in the DOM. Fails HTML/ARIA standards.`,
            location: `Element using ID="${id}"`,
            groupKey: 'duplicate_ids'
          });
        }
        seenIds[id] = true;
      }
    });

    // Inputs check
    $('input').each((idx, elem) => {
      const id = $(elem).attr('id');
      const name = $(elem).attr('name') || 'unnamed';
      const label = id ? $(`label[for="${id}"]`) : [];
      const aria = $(elem).attr('aria-label') || $(elem).attr('aria-labelledby') || $(elem).attr('placeholder');
      if (label.length === 0 && !aria) {
        accessibilityIssues.push({
          severity: 'medium',
          type: 'accessibility',
          title: 'Input field has no matching label',
          message: `The form input field (name: "${name}") does not have a linked label or ARIA identifier.`,
          location: `<input> tag (name: ${name})`,
          groupKey: 'input_label'
        });
      }
    });

    // Broken links scanner
    jobLogger('Auditing links on target page for broken connections...');
    const linkBugs = [];
    const linkUrls = [];
    $('a').each((idx, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith('http')) {
        linkUrls.push(href);
      }
    });

    // Test unique links asynchronously (Limit to top 15 links to stay within 20s runtimes)
    const uniqueLinks = [...new Set(linkUrls)].slice(0, 15);
    for (const testLink of uniqueLinks) {
      try {
        const linkRes = await fetch(testLink, { method: 'HEAD', timeout: 5000 }).catch(() => null);
        if (!linkRes || linkRes.status >= 400) {
          linkBugs.push({
            severity: 'medium',
            type: 'quality',
            title: `Broken Link detected`,
            message: `Hyperlink target "${testLink}" returned status code ${linkRes ? linkRes.status : 'FAILED/TIMEOUT'}.`,
            location: `<a href="${testLink}">`,
            groupKey: 'broken_links'
          });
        }
      } catch (err) {
        // network fetch fail is a broken link
      }
    }

    jobLogger('Structuring scan results, logs, and errors...');
    const parsedConsole = groupAndParseLogs(logs, networkErrors);

    const accumulatedBugs = [
      ...parsedConsole,
      ...securityIssues,
      ...cssIssues,
      ...accessibilityIssues,
      ...seoIssues,
      ...linkBugs
    ];

    jobLogger('Invoking Gemini AI Analysis for root cause diagnostic and code fixes...');
    const finalizedBugs = await getAIAnalysis(accumulatedBugs);

    await browser.close();
    jobLogger('Playwright website audit completed successfully.');
    return finalizedBugs;
  } catch (error) {
    await browser.close();
    throw new Error(`Website scanning failed: ${error.message}`);
  }
}

// ----------------------------------------------------
// 4. Git Repository Static Analyzer (Deep Analysis)
// ----------------------------------------------------
export async function runGitScan(repoUrl, jobLogger, jobId) {
  const tempDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'temp_clones', jobId)
    : path.join(__dirname, 'temp_clones', jobId);
  
  try {
    jobLogger(`Executing shallow git clone for: ${repoUrl}`);
    fs.mkdirSync(path.dirname(tempDir), { recursive: true });
    await execPromise(`git clone --depth 1 "${repoUrl}" "${tempDir}"`);

    const bugs = [];

    // Helper to recursively walk files
    function walkDir(dir, callback) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        if (stat.isDirectory()) {
          if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
            walkDir(filepath, callback);
          }
        } else {
          callback(filepath);
        }
      });
    }

    jobLogger('Scanning repository for exposed tokens, credentials, and API secrets...');
    const secretRegexes = [
      { name: 'AWS Access Key ID', regex: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|ASCA|ASIA)[A-Z0-9]{16}/, severity: 'critical' },
      { name: 'Generic Secret Token', regex: /(key|secret|token|password|passwd|auth)\s*[:=]\s*["'][A-Za-z0-9_\-+=]{16,80}["']/i, severity: 'critical' },
      { name: 'Slack Incoming Webhook URL', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9_]+\/B[A-Z0-9_]+\/[A-Za-z0-9_]{24}/, severity: 'critical' },
      { name: 'Stripe Secret API Key', regex: /sk_live_[0-9a-zA-Z]{24}/, severity: 'critical' },
      { name: 'GCP Service Account Credential', regex: /"type":\s*"service_account"/, severity: 'critical' },
      { name: 'Private Key Block', regex: /-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/, severity: 'critical' }
    ];

    walkDir(tempDir, (filepath) => {
      const relativePath = path.relative(tempDir, filepath);
      const filename = path.basename(filepath);
      
      // Skip locking / binary files
      if (['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(filename)) return;
      const ext = path.extname(filepath).toLowerCase();
      if (!['.js', '.jsx', '.ts', '.tsx', '.json', '.env', '.yml', '.yaml', '.py', '.go', '.sh', '.html', '.css', '.java', '.cs'].includes(ext)) return;

      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineIdx) => {
          // Secrets Scanner
          secretRegexes.forEach(rule => {
            const match = line.match(rule.regex);
            if (match) {
              // Exclude matches that are obviously comments in package.json or typical mocks
              if (line.includes('AKIAIOSFODNN7EXAMPLE') || line.includes('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')) return;
              bugs.push({
                severity: rule.severity,
                type: 'security',
                title: `Exposed Credential: ${rule.name}`,
                message: `Potential credential leakage found in file: "${line.trim().substring(0, 100)}"`,
                location: `${relativePath}:${lineIdx + 1}`,
                groupKey: 'secrets'
              });
            }
          });

          // Code Quality/Bugs Scanner
          if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
            // Check direct NaN check comparison
            if (line.includes('== NaN') || line.includes('=== NaN') || line.includes('!= NaN') || line.includes('!== NaN')) {
              bugs.push({
                severity: 'high',
                type: 'quality',
                title: 'Incorrect NaN comparison syntax',
                message: 'Do not compare variables directly to NaN. Use Number.isNaN() or isNaN() instead.',
                location: `${relativePath}:${lineIdx + 1}`,
                groupKey: 'js_bad_nan'
              });
            }

            // Check infinite loops
            if (line.match(/while\s*\(\s*true\s*\)/)) {
              bugs.push({
                severity: 'medium',
                type: 'quality',
                title: 'Potential infinite loop pattern',
                message: 'Found "while (true)" loop syntax. Ensure proper break limits or escape conditions are set.',
                location: `${relativePath}:${lineIdx + 1}`,
                groupKey: 'js_infinite_loop'
              });
            }

            // Check debugger statement
            if (line.includes('debugger;')) {
              bugs.push({
                severity: 'medium',
                type: 'quality',
                title: 'Active debugger breakpoint',
                message: 'A "debugger;" statement is left in the production source files.',
                location: `${relativePath}:${lineIdx + 1}`,
                groupKey: 'js_debugger'
              });
            }

            // Check unhandled empty catch block
            if (line.match(/catch\s*\(\s*[a-zA-Z0-9_]*\s*\)\s*\{\s*\}/)) {
              bugs.push({
                severity: 'low',
                type: 'quality',
                title: 'Empty catch block',
                message: 'Exception is caught but silently ignored without logging or re-throwing. This hides runtime bugs.',
                location: `${relativePath}:${lineIdx + 1}`,
                groupKey: 'js_empty_catch'
              });
            }

            // Todo comments
            if (line.includes('// TODO:') || line.includes('// FIXME:')) {
              bugs.push({
                severity: 'low',
                type: 'quality',
                title: line.includes('FIXME') ? 'Fixme comment' : 'Todo comment',
                message: `Unresolved development note: "${line.trim()}"`,
                location: `${relativePath}:${lineIdx + 1}`,
                groupKey: 'js_todos'
              });
            }
          }
        });
      } catch (err) {
        // Skip unreadable files
      }
    });

    // Check package.json for dependency vulnerabilities
    const pkgPath = path.join(tempDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      jobLogger('Found package.json. Executing npm audit to scan dependency tree...');
      try {
        const { stdout } = await execPromise('npm audit --json', { cwd: tempDir }).catch(err => {
          return { stdout: err.stdout };
        });

        if (stdout) {
          const auditJson = JSON.parse(stdout);
          const vulnerabilities = auditJson.vulnerabilities || {};
          
          Object.keys(vulnerabilities).forEach(pkgName => {
            const vuln = vulnerabilities[pkgName];
            const severityMap = {
              critical: 'critical',
              high: 'high',
              moderate: 'medium',
              low: 'low'
            };
            
            bugs.push({
              severity: severityMap[vuln.severity] || 'medium',
              type: 'security',
              title: `Dependency Vulnerability: "${pkgName}"`,
              message: `Package "${pkgName}" range ${vuln.range} contains vulnerability: "${vuln.via[0]?.title || 'Security alert'}".`,
              details: `Recommendation: Execute "npm audit fix" or upgrade to newer package releases. Affects: ${JSON.stringify(vuln.effects || [])}`,
              location: `package.json -> ${pkgName}`,
              groupKey: 'npm_audit'
            });
          });
        }
      } catch (auditErr) {
        jobLogger(`npm audit skipped: ${auditErr.message}`);
      }
    }

    jobLogger('Invoking Gemini AI code advisor for custom refactoring suggestions...');
    const analyzedBugs = await getAIAnalysis(bugs);

    jobLogger('Cleaning up temporary workspace clones...');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    jobLogger('GitHub Repository static audit completed.');
    return analyzedBugs;
  } catch (error) {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw new Error(`Repository scanning failed: ${error.message}`);
  }
}
