#!/usr/bin/env node
/**
 * Course Page Generator
 *
 * Usage:
 *   node build.mjs <course-dir>            # auto-discover config + content
 *   node build.mjs <course-dir>/content.md  # explicit content path
 *
 * Config layering:
 *   1. config/global.yaml  (base — instructor, socials, footer, defaults)
 *   2. <course-dir>/config.yaml  (override — page, quotes, nav, etc.)
 *   Deep merge: course config wins on conflict, arrays are replaced not appended.
 *
 * Output: <course-dir>/index.html
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_HTML = resolve(__dirname, '../reference/base.html');

// ─── Deep merge (arrays replaced, objects merged) ───

function deepMerge(base, override) {
  if (!override) return base;
  if (!base) return override;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  if (Array.isArray(override)) return override;

  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (key in result && typeof result[key] === 'object' && typeof override[key] === 'object'
        && !Array.isArray(result[key]) && !Array.isArray(override[key])) {
      result[key] = deepMerge(result[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

// ─── Minimal YAML parser (handles our config structure without deps) ───

function unquote(s) {
  if (!s) return '';
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

function parseYamlFull(text) {
  const cleanLines = text.split('\n').map(l => l.replace(/\s+$/, ''));
  return parseYamlBlock(cleanLines, 0, cleanLines.length, -1);
}

function parseYamlBlock(lines, start, end, parentIndent) {
  const result = {};
  let i = start;

  while (i < end) {
    const line = lines[i];

    if (line.trim() === '' || /^\s*#/.test(line)) { i++; continue; }

    const indent = line.search(/\S/);
    if (indent <= parentIndent) break;

    if (line.trim().startsWith('- ')) { i++; continue; }

    const kvMatch = line.trim().match(/^([\w]+):\s*(.*)/);
    if (!kvMatch) { i++; continue; }

    const key = kvMatch[1];
    let val = kvMatch[2].trim();

    if (val === '>') {
      let mlVal = '';
      i++;
      while (i < end) {
        const nl = lines[i];
        if (nl.trim() === '' || /^\s*#/.test(nl)) { i++; continue; }
        const ni = nl.search(/\S/);
        if (ni <= indent) break;
        mlVal += (mlVal ? ' ' : '') + nl.trim();
        i++;
      }
      result[key] = mlVal;
      continue;
    }

    const nextNonEmpty = findNextNonEmpty(lines, i + 1, end);
    if (nextNonEmpty < end && lines[nextNonEmpty].trim().startsWith('- ')) {
      const nextIndent = lines[nextNonEmpty].search(/\S/);
      if (nextIndent > indent) {
        result[key] = parseYamlArray(lines, i + 1, end, indent);
        i = skipBlock(lines, i + 1, end, indent);
        continue;
      }
    }

    if (val === '') {
      const ni = findNextNonEmpty(lines, i + 1, end);
      if (ni < end && lines[ni].search(/\S/) > indent) {
        result[key] = parseYamlBlock(lines, i + 1, end, indent);
        i = skipBlock(lines, i + 1, end, indent);
        continue;
      }
    }

    result[key] = unquote(val);
    i++;
  }

  return result;
}

function parseYamlArray(lines, start, end, parentIndent) {
  const result = [];
  let i = start;

  while (i < end) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) { i++; continue; }

    const indent = line.search(/\S/);
    if (indent <= parentIndent) break;

    if (line.trim().startsWith('- ')) {
      const content = line.trim().slice(2).trim();
      const kvMatch = content.match(/^([\w]+):\s*(.*)/);

      if (kvMatch) {
        const obj = {};
        obj[kvMatch[1]] = kvMatch[2].trim() === '>'
          ? (() => { let v=''; i++; while(i<end){const l=lines[i];if(l.trim()===''||/^\s*#/.test(l)){i++;continue;}if(l.search(/\S/)<=indent+2)break;v+=(v?' ':'')+l.trim();i++;} return v; })()
          : unquote(kvMatch[2]);

        if (kvMatch[2].trim() !== '>') i++;

        while (i < end) {
          const nl = lines[i];
          if (nl.trim() === '' || /^\s*#/.test(nl)) { i++; continue; }
          const ni = nl.search(/\S/);
          if (ni <= indent) break;
          if (nl.trim().startsWith('- ')) break;
          const nkv = nl.trim().match(/^([\w]+):\s*(.*)/);
          if (nkv) {
            if (nkv[2].trim() === '>') {
              let v=''; i++;
              while(i<end){const l=lines[i];if(l.trim()===''||/^\s*#/.test(l)){i++;continue;}if(l.search(/\S/)<=ni)break;v+=(v?' ':'')+l.trim();i++;}
              obj[nkv[1]] = v;
            } else {
              obj[nkv[1]] = unquote(nkv[2]);
              i++;
            }
          } else {
            i++;
          }
        }
        result.push(obj);
      } else {
        result.push(unquote(content));
        i++;
      }
    } else {
      i++;
    }
  }

  return result;
}

function findNextNonEmpty(lines, start, end) {
  for (let i = start; i < end; i++) {
    if (lines[i].trim() !== '' && !/^\s*#/.test(lines[i])) return i;
  }
  return end;
}

function skipBlock(lines, start, end, parentIndent) {
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) { i++; continue; }
    if (line.search(/\S/) <= parentIndent) return i;
    i++;
  }
  return i;
}

// ─── Social SVG icons ───

const SOCIAL_SVGS = {
  Medium: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12zm7.42 0c0 3.54-1.51 6.42-3.38 6.42S14.2 15.54 14.2 12s1.51-6.42 3.38-6.42 3.38 2.88 3.38 6.42zm2.94 0c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75c.66 0 1.19 2.58 1.19 5.75z"/></svg>',
  Facebook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  Threads: '<svg width="16" height="16" viewBox="0 0 878 1000" fill="currentColor"><path d="M446.7,1000h-0.3c-149.2-1-263.9-50.2-341-146.2C36.9,768.3,1.5,649.4,0.3,500.4v-0.7c1.2-149.1,36.6-267.9,105.2-353.4C182.5,50.2,297.3,1,446.4,0h0.3h0.3c114.4,0.8,210.1,30.2,284.4,87.4c69.9,53.8,119.1,130.4,146.2,227.8l-85,23.7c-46-165-162.4-249.3-346-250.6c-121.2,0.9-212.9,39-272.5,113.2C118.4,271,89.6,371.4,88.5,500c1.1,128.6,29.9,229,85.7,298.5c59.6,74.3,151.3,112.4,272.5,113.2c109.3-0.8,181.6-26.3,241.7-85.2c68.6-67.2,67.4-149.7,45.4-199.9c-12.9-29.6-36.4-54.2-68.1-72.9c-8,56.3-25.9,101.9-53.5,136.3c-36.9,45.9-89.2,71-155.4,74.6c-50.1,2.7-98.4-9.1-135.8-33.4c-44.3-28.7-70.2-72.5-73-123.5c-2.7-49.6,17-95.2,55.4-128.4c36.7-31.7,88.3-50.3,149.3-53.8c44.9-2.5,87-0.5,125.8,5.9c-5.2-30.9-15.6-55.5-31.2-73.2c-21.4-24.4-54.5-36.8-98.3-37.1c-0.4,0-0.8,0-1.2,0c-35.2,0-83,9.7-113.4,55L261.2,327c40.8-60.6,107-94,186.6-94c0.6,0,1.2,0,1.8,0c133.1,0.8,212.4,82.3,220.3,224.5c4.5,1.9,9,3.9,13.4,5.9c62.1,29.2,107.5,73.4,131.4,127.9c33.2,75.9,36.3,199.6-64.5,298.3C673.1,965,579.6,999.1,447,1000L446.7,1000L446.7,1000z M488.5,512.9c-10.1,0-20.3,0.3-30.8,0.9c-76.5,4.3-124.2,39.4-121.5,89.3c2.8,52.3,60.5,76.6,116,73.6c51-2.7,117.4-22.6,128.6-154.6C552.6,516,521.7,512.9,488.5,512.9z"/></svg>',
  YouTube: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  GitHub: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>',
  LinkedIn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
  Email: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>',
};

function socialLink(platform, url) {
  const svg = SOCIAL_SVGS[platform] || '';
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${svg} ${esc(platform)}</a>`;
}

function esc(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function raw(s) { return typeof s === 'string' ? s : ''; }

// ─── Markdown parser ───

function parseContent(md) {
  const lines = md.split('\n');
  const sections = [];
  let current = null;
  let currentSub = null;
  let i = 0;
  let sectionNum = 0;
  let subNum = 0;
  const usedIds = new Set();

  function uniqueId(base) {
    const seed = base || 'section';
    let candidate = seed;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${seed}-${suffix}`;
      suffix++;
    }
    usedIds.add(candidate);
    return candidate;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^---\s*$/.test(line.trim())) { i++; continue; }

    if (/^# /.test(line)) {
      sectionNum++;
      const title = line.replace(/^# /, '').trim();
      let label, h2;
      const colonMatch = title.match(/^(.+?)[：:]\s*(.+)/);
      if (colonMatch) {
        label = colonMatch[1].trim();
        h2 = colonMatch[2].trim();
      } else {
        label = title;
        h2 = title;
      }

      const id = uniqueId(generateId(title) || `section-${sectionNum}`);
      current = { type: 'section', num: sectionNum, label, h2, id, lead: '', subs: [], blocks: [] };
      currentSub = null;
      sections.push(current);

      if (i + 1 < lines.length && /^> /.test(lines[i + 1]) && !/^> \*\*/.test(lines[i + 1])) {
        i++;
        let lead = lines[i].replace(/^> /, '');
        while (i + 1 < lines.length && /^> /.test(lines[i + 1]) && !/^> \*\*/.test(lines[i + 1])) {
          i++;
          lead += '\n' + lines[i].replace(/^> /, '');
        }
        current.lead = lead.trim();
      }
      i++; continue;
    }

    if (/^## /.test(line)) {
      const title = line.replace(/^## /, '').trim();
      subNum++;
      const subId = uniqueId('sub-' + (generateId(title) || `section-${subNum}`));
      currentSub = { title, id: subId };
      if (current) {
        current.subs.push(currentSub);
        current.blocks.push({ type: 'sub-title', title, id: subId });
      }
      i++; continue;
    }

    // ── youtube embed ──
    if (/^\[youtube/.test(line.trim())) {
      const idMatch = line.match(/id="([^"]+)"/);
      const titleMatch = line.match(/title="([^"]+)"/);
      const vid = idMatch ? idMatch[1] : '';
      let caption = titleMatch ? titleMatch[1] : '';
      const isSingleLineYoutube = /^\[youtube\b[^\]]*\]\s*$/.test(line.trim());
      // Block form only applies when the opening tag is not already a complete single-line embed.
      if (!isSingleLineYoutube) {
        i++;
        const captionLines = [];
        while (i < lines.length && !/^\[\/youtube\]/.test(lines[i].trim())) {
          if (lines[i].trim() !== '') captionLines.push(lines[i].trim());
          i++;
        }
        i++; // skip [/youtube]
        if (!caption && captionLines.length) caption = captionLines.join(' ');
      } else {
        i++;
      }
      if (current && vid) current.blocks.push({ type: 'youtube', id: vid, caption });
      continue;
    }

    // ── image-text block ──
    if (/^\[image-text/.test(line.trim())) {
      const posMatch = line.match(/position="(left|right)"/);
      const position = posMatch ? posMatch[1] : 'left';
      const widthMatch = line.match(/width="(\d+)%?"/);
      const imgWidth = widthMatch ? parseInt(widthMatch[1], 10) : 40;
      let imgSrc = '', imgAlt = '';
      const textLines = [];
      i++;
      while (i < lines.length && !/^\[\/image-text\]/.test(lines[i].trim())) {
        const imgMatch = lines[i].trim().match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (imgMatch && !imgSrc) {
          imgAlt = imgMatch[1];
          imgSrc = imgMatch[2];
        } else if (lines[i].trim() !== '') {
          textLines.push(lines[i]);
        }
        i++;
      }
      i++; // skip [/image-text]
      if (current) current.blocks.push({ type: 'image-text', position, imgWidth, imgSrc, imgAlt, textLines });
      continue;
    }

    // ── standalone image ──
    if (/^!\[([^\]]*)\]\(([^)]+)\)/.test(line.trim()) && current) {
      const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      current.blocks.push({ type: 'image', alt: imgMatch[1], src: imgMatch[2] });
      i++; continue;
    }

    if (isMarkdownTableHeader(line, lines[i + 1]) && current) {
      const headers = parseMarkdownTableRow(line);
      const aligns = parseMarkdownTableAlignments(lines[i + 1]);
      const rows = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i];
        if (rowLine.trim() === '' || !rowLine.includes('|')) break;
        rows.push(parseMarkdownTableRow(rowLine));
        i++;
      }
      current.blocks.push({ type: 'table', headers, aligns, rows });
      continue;
    }

    if (/^### /.test(line)) {
      const title = line.replace(/^### /, '').trim();
      const emojiMatch = title.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*(.*)/u);
      const icon = emojiMatch ? emojiMatch[1] : '';
      const cardTitle = emojiMatch ? emojiMatch[2] : title;
      const card = { type: 'card', icon, title: cardTitle, items: [] };

      i++;
      while (i < lines.length) {
        const cl = lines[i];
        if (/^#{1,3} /.test(cl) || /^---\s*$/.test(cl.trim())) break;
        if (/^```(prompt|terminal)/i.test(cl) || /^\[flow\]/.test(cl) || /^\[tags\]/.test(cl) || /^\[summary\]/.test(cl) || /^\[bonus/.test(cl) || /^> \*\*/.test(cl) || /^\[image-text/.test(cl) || /^\[youtube/.test(cl)) break;
        if (/^- \[x\]/.test(cl) || /^!\[/.test(cl)) break;
        if (isMarkdownTableHeader(cl, lines[i + 1])) break;

        // Blank line after content → end this card, let remaining lines parse independently
        if (cl.trim() === '' && card.items.length > 0) {
          i++;
          break;
        }

        if (/^- /.test(cl) && !/^- \[/.test(cl)) {
          card.items.push({ type: 'li', text: inlineFormat(cl.replace(/^- /, '').trim()) });
        } else if (cl.trim() !== '') {
          card.items.push({ type: 'p', text: inlineFormat(cl.trim()) });
        }
        i++;
      }
      if (current) current.blocks.push(card);
      continue;
    }

    if (/^#### /.test(line) && current) {
      const title = line.replace(/^#### /, '').trim();
      current.blocks.push({ type: 'minor-title', title });
      i++;
      continue;
    }

    if (/^```(prompt|terminal|Terminal|Prompt)/i.test(line)) {
      const langMatch = line.match(/^```(\w+)/);
      const lang = langMatch ? langMatch[1].toLowerCase() : 'prompt';
      const labelMatch = line.match(/\[label="([^"]+)"\]/);
      const label = labelMatch ? labelMatch[1] : '';
      let body = '';
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        body += (body ? '\n' : '') + lines[i];
        i++;
      }
      i++;
      let headerType;
      if (lang === 'terminal') {
        headerType = 'Terminal';
      } else if (lang === 'prompt') {
        const isTerminal = /^(npm |npx |openspec |git |docker |curl |brew |apt |pip |cargo |\/init)/.test(body.trim());
        headerType = isTerminal ? 'Terminal' : 'Prompt';
      } else {
        headerType = 'Prompt';
      }
      if (current) current.blocks.push({ type: 'prompt', label, body, headerType });
      continue;
    }

    if (/^\[flow\]/.test(line.trim())) {
      const steps = [];
      i++;
      while (i < lines.length && !/^\[\/flow\]/.test(lines[i].trim())) {
        const stepMatch = lines[i].trim().match(/^\d+\.\s+(.*)/);
        if (stepMatch) {
          const parts = stepMatch[1].split(/\s[—–-]\s/);
          steps.push({ title: parts[0].trim(), desc: parts[1] ? parts[1].trim() : '' });
        }
        i++;
      }
      i++;
      if (current) current.blocks.push({ type: 'flow', steps });
      continue;
    }

    if (/^\[tags\]/.test(line.trim())) {
      const tags = [];
      i++;
      while (i < lines.length && !/^\[\/tags\]/.test(lines[i].trim())) {
        const tagMatch = lines[i].trim().match(/^-\s+\[(green|orange|purple|blue)\]\s+(.*)/);
        if (tagMatch) {
          tags.push({ color: tagMatch[1], text: tagMatch[2] });
        }
        i++;
      }
      i++;
      if (current) current.blocks.push({ type: 'tags', tags });
      continue;
    }

    if (/^\[summary\]/.test(line.trim())) {
      const items = [];
      i++;
      while (i < lines.length && !/^\[\/summary\]/.test(lines[i].trim())) {
        const sumMatch = lines[i].trim().match(/^-\s+(\S+)\s+\*\*(.+?)\*\*\s*\|\s*(.*)/);
        if (sumMatch) {
          items.push({ icon: sumMatch[1], title: sumMatch[2], desc: sumMatch[3].trim() });
        }
        i++;
      }
      i++;
      if (current) current.blocks.push({ type: 'summary', items });
      continue;
    }

    if (/^\[bonus/.test(line.trim())) {
      const titleMatch = line.match(/title="([^"]+)"/);
      const title = titleMatch ? titleMatch[1] : 'Bonus';
      let content = '';
      i++;
      while (i < lines.length && !/^\[\/bonus\]/.test(lines[i].trim())) {
        content += (content ? '\n' : '') + lines[i];
        i++;
      }
      i++;
      if (current) current.blocks.push({ type: 'bonus', title, content });
      continue;
    }

    if (/^> \*\*/.test(line)) {
      const titleMatch = line.match(/^> \*\*(.+?)\*\*/);
      const insightTitle = titleMatch ? titleMatch[1] : '';
      const paragraphs = [];
      const bullets = [];
      let restOfLine = line.replace(/^> \*\*.+?\*\*\s*/, '').trim();

      let currentPara = restOfLine;
      i++;

      while (i < lines.length && /^>/.test(lines[i])) {
        const content = lines[i].replace(/^>\s?/, '').trim();
        if (content === '') {
          if (currentPara) paragraphs.push(currentPara);
          currentPara = '';
        } else if (/^- /.test(content)) {
          if (currentPara) {
            paragraphs.push(currentPara);
            currentPara = '';
          }
          bullets.push(inlineFormat(content.replace(/^- /, '').trim()));
        } else {
          currentPara += (currentPara ? '\n' : '') + content;
        }
        i++;
      }
      if (currentPara) paragraphs.push(currentPara);

      if (current) current.blocks.push({
        type: 'insight',
        title: insightTitle,
        paragraphs: paragraphs.map(inlineFormatWithBreaks),
        bullets,
      });
      continue;
    }

    if (/^> /.test(line) && !/^> \*\*/.test(line)) {
      const paragraphs = [];
      let currentPara = line.replace(/^>\s?/, '').trim();
      i++;
      while (i < lines.length && /^>/.test(lines[i])) {
        const content = lines[i].replace(/^>\s?/, '').trim();
        if (content === '') {
          if (currentPara) paragraphs.push(currentPara);
          currentPara = '';
        } else {
          currentPara += (currentPara ? '\n' : '') + content;
        }
        i++;
      }
      if (currentPara) paragraphs.push(currentPara);
      if (current) current.blocks.push({ type: 'insight', title: '', paragraphs: paragraphs.map(inlineFormatWithBreaks) });
      continue;
    }

    if (/^- \[x\]/.test(line)) {
      const items = [];
      while (i < lines.length && /^- \[x\]/.test(lines[i])) {
        items.push(lines[i].replace(/^- \[x\]\s*/, '').trim());
        i++;
      }
      if (current) current.blocks.push({ type: 'checklist', items });
      continue;
    }

    if (/^- /.test(line) && !/^- \[/.test(line) && current) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i]) && !/^- \[/.test(lines[i])) {
        items.push(inlineFormat(lines[i].replace(/^- /, '').trim()));
        i++;
      }
      current.blocks.push({ type: 'list', items });
      continue;
    }

    if (line.trim() !== '' && current && !/^#{1,4} /.test(line)) {
      current.blocks.push({ type: 'paragraph', text: inlineFormat(line.trim()) });
      i++; continue;
    }

    i++;
  }

  return sections;
}

function generateId(title) {
  const map = {
    '新專案': 'new-project', '舊專案': 'old-project', '導入測試': 'testing', '總結': 'summary',
    'OpenSpec 初始化': 'openspec-init', '從零建立專案': 'create-project', '建立專案規則': 'project-rules',
    'OpenSpec 迭代': 'openspec-iterate', '設定 Commit Skill': 'commit-skill', 'Commit Skill': 'commit-skill',
    '設定 PR Skill': 'pr-skill', 'PR Skill': 'pr-skill',
    'Git Worktree 並行開發': 'worktree', 'Worktree': 'worktree',
    'gen-test-cases': 'gen-test', 'GitHub Action 自動化': 'github-action', 'GitHub Action': 'github-action',
  };

  for (const [k, v] of Object.entries(map)) {
    if (title.includes(k)) return v;
  }

  return title
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function isMarkdownTableSeparator(line) {
  const trimmed = (line || '').trim();
  if (!trimmed.includes('|')) return false;
  const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableHeader(line, nextLine) {
  return !!line && !!nextLine && line.includes('|') && isMarkdownTableSeparator(nextLine);
}

function parseMarkdownTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function parseMarkdownTableAlignments(line) {
  return parseMarkdownTableRow(line).map(cell => {
    const isLeft = cell.startsWith(':');
    const isRight = cell.endsWith(':');
    if (isLeft && isRight) return 'center';
    if (isRight) return 'right';
    return 'left';
  });
}

function inlineFormat(text) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="inline-image">')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function inlineFormatWithBreaks(text) {
  return inlineFormat(text).replace(/\n/g, '<br>');
}

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

// ─── HTML generators ───

function buildTocItems(sections) {
  let html = '';
  html += `<li class="toc-group" data-section="instructor">
      <a href="#instructor" class="toc-group-title">
        <span class="toc-num">\u{1F464}</span> 講師簡介
      </a>
      <ul class="toc-sub"></ul>
    </li>\n`;

  for (const sec of sections) {
    const navLabel = sec.label.replace(/[：:].*/,'').trim();
    const numDisplay = sec.label === '總結' ? '★' : sec.num;
    html += `    <li class="toc-group" data-section="${sec.id}">
      <a href="#${sec.id}" class="toc-group-title">
        <span class="toc-num">${numDisplay}</span> ${esc(navLabel)}
      </a>
      <ul class="toc-sub">\n`;
    for (const sub of sec.subs) {
      html += `        <li><a href="#${sub.id}">${esc(stripInlineMarkdown(sub.title))}</a></li>\n`;
    }
    html += `      </ul>
    </li>\n`;
  }
  return html;
}

function buildInstructor(cfg) {
  const inst = cfg.instructor || {};
  const placeholderHtml = '<div class="instructor-avatar-placeholder">\u{1F464}</div>';
  const onerrorHtml = placeholderHtml.replace(/"/g, '&quot;').replace(/'/g, "\\'");
  const avatar = inst.avatar
    ? `<img class="instructor-avatar" src="${esc(inst.avatar)}" alt="${esc(inst.name)}" onerror="this.outerHTML='${onerrorHtml}';">`
    : placeholderHtml;

  const statsHtml = (inst.stats || []).map(s => {
    const label = s.value
      ? `${raw(s.icon)} ${esc(s.text)} <strong>${esc(s.value)}</strong> ${esc(s.unit)}`
      : inlineFormat(s.text || '');
    return `<a href="${esc(s.url)}" target="_blank" rel="noopener">${label}</a>`;
  }).join('\n          ');

  const socialsHtml = (inst.socials || []).map(s =>
    `          ${socialLink(s.platform, s.url)}`
  ).join('\n');

  return `<section class="section">
  <div class="reveal">
    <span class="section-label" id="instructor"><span class="num">\u{1F464}</span> 講師簡介</span>
    <h2>關於講師</h2>
  </div>
  <div class="reveal">
    <div class="instructor">
      ${avatar}
      <div class="instructor-info">
        <h3>${esc(inst.name)}</h3>
        <div class="tagline">${esc(inst.tagline)}</div>
        <p>${esc(inst.bio).replace(/&lt;br\s*\/?&gt;/gi, '<br>')}</p>
        <div class="instructor-stats">
          ${statsHtml}
        </div>
        <div class="social-links">
${socialsHtml}
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function buildQuote(quoteObj) {
  if (!quoteObj || !quoteObj.text) return '';
  const authorHtml = quoteObj.author
    ? `\n    <div class="quote-author">— ${esc(quoteObj.author)}</div>` : '';
  return `<section class="quote-page">
  <div class="reveal">
    <div class="quote-mark">\u201C</div>
    <blockquote>${raw(quoteObj.text)}</blockquote>${authorHtml}
    <div class="quote-line"></div>
  </div>
</section>`;
}

// Collect all blocks under a ### into a group (until next ### / sub-title / end)
function groupBlocks(blocks) {
  const result = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'card') {
      const group = { type: 'group', icon: b.icon, title: b.title, children: [] };
      if (b.items.length > 0) {
        group.children.push({ type: 'card-items', items: b.items });
      }
      i++;
      while (i < blocks.length) {
        const nb = blocks[i];
        if (nb.type === 'card' || nb.type === 'sub-title') break;
        group.children.push(nb);
        i++;
      }
      result.push(group);
    } else {
      result.push(b);
      i++;
    }
  }
  return result;
}

// Returns inner HTML for a block (no reveal wrapper) — used for both top-level and group children
function renderBlockBody(block) {
  switch (block.type) {
    case 'sub-title':
      return `<div class="sub-title" id="${block.id}"><span class="bar"></span>${inlineFormat(block.title)}</div>`;

    case 'minor-title':
      return `<h4 class="minor-title">${esc(block.title)}</h4>`;

    case 'card-items': {
      let s = '';
      let inList = false;
      for (const item of block.items) {
        if (item.type === 'li') {
          if (!inList) { s += `<ul>\n`; inList = true; }
          s += `  <li>${item.text}</li>\n`;
        } else {
          if (inList) { s += `</ul>\n`; inList = false; }
          s += `<p>${item.text}</p>\n`;
        }
      }
      if (inList) s += `</ul>`;
      return s.trimEnd();
    }

    case 'group': {
      const childrenHtml = block.children
        .map(c => `        ${renderBlockBody(c)}`)
        .join('\n');
      return `<div class="group-block">
      <div class="group-header">${block.icon ? `<span class="icon">${block.icon}</span> ` : ''}${inlineFormat(block.title)}</div>
      <div class="group-body">
${childrenHtml}
      </div>
    </div>`;
    }

    case 'prompt':
      return `<div class="prompt-block">
      <div class="prompt-header">
        <div class="dots"><span></span><span></span><span></span></div>
        ${block.headerType}
        <span class="label">${esc(block.label)}</span>
        <button class="copy-btn" aria-label="複製" onclick="copyPrompt(this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <div class="prompt-body">${esc(block.body)}</div>
    </div>`;

    case 'flow': {
      let s = `<div class="flow">\n`;
      block.steps.forEach((step, idx) => {
        s += `      <div class="flow-step">
        <div class="step-num">${idx + 1}</div>
        <div class="step-content">
          <div class="step-title">${inlineFormat(step.title)}</div>
          <div class="step-desc">${inlineFormat(step.desc)}</div>
        </div>
      </div>\n`;
      });
      s += `    </div>`;
      return s;
    }

    case 'tags': {
      let s = `<div class="tags">\n`;
      for (const t of block.tags) {
        s += `      <span class="tag ${t.color}">${esc(t.text)}</span>\n`;
      }
      s += `    </div>`;
      return s;
    }

    case 'insight': {
      let s = `<div class="insight">\n`;
      if (block.title) s += `      <div class="insight-title">${inlineFormat(block.title)}</div>\n`;
      block.paragraphs.forEach((p, idx) => {
        s += `      <p${idx > 0 ? ' style="margin-top:.5rem"' : ''}>${p}</p>\n`;
      });
      if (block.bullets && block.bullets.length) {
        s += `      <ul>\n`;
        for (const b of block.bullets) s += `        <li>${b}</li>\n`;
        s += `      </ul>\n`;
      }
      s += `    </div>`;
      return s;
    }

    case 'checklist': {
      let s = `<ul class="checklist">\n`;
      for (const item of block.items) s += `      <li>${inlineFormat(item)}</li>\n`;
      s += `    </ul>`;
      return s;
    }

    case 'summary': {
      let s = `<div class="summary-grid">\n`;
      for (const item of block.items) {
        s += `      <div class="summary-card">
        <div class="sc-icon">${item.icon}</div>
        <h4>${esc(item.title)}</h4>
        <p>${inlineFormat(item.desc)}</p>
      </div>\n`;
      }
      s += `    </div>`;
      return s;
    }

    case 'table': {
      let s = `<div class="table-wrap">\n      <table class="content-table">\n        <thead>\n          <tr>\n`;
      block.headers.forEach((header, idx) => {
        s += `            <th class="align-${block.aligns[idx] || 'left'}">${inlineFormat(header)}</th>\n`;
      });
      s += `          </tr>\n        </thead>\n        <tbody>\n`;
      block.rows.forEach((row) => {
        s += `          <tr>\n`;
        block.headers.forEach((_, idx) => {
          s += `            <td class="align-${block.aligns[idx] || 'left'}">${inlineFormat(row[idx] || '')}</td>\n`;
        });
        s += `          </tr>\n`;
      });
      s += `        </tbody>\n      </table>\n    </div>`;
      return s;
    }

    case 'list': {
      let s = `<ul class="loose-list">\n`;
      for (const item of block.items) s += `      <li>${item}</li>\n`;
      s += `    </ul>`;
      return s;
    }

    case 'bonus':
      return `<button class="bonus-btn" data-bonus-title="${esc(block.title)}" data-bonus-content="${esc(block.content)}">
      ${esc(block.title)}
    </button>`;

    case 'youtube':
      return `<div class="youtube-embed">
      <div class="youtube-wrapper" data-id="${esc(block.id)}">
        <iframe src="https://www.youtube.com/embed/${esc(block.id)}" title="${esc(block.caption || 'YouTube video')}" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
        <div class="youtube-local-notice">
          <p>本機直接開啟 HTML 時，YouTube 可能因缺少 HTTP referrer 而拒絕播放。請改用本機伺服器預覽，或直接前往 <a href="https://www.youtube.com/watch?v=${esc(block.id)}" target="_blank" rel="noopener">YouTube 觀看影片</a>。</p>
        </div>
      </div>
      ${block.caption ? `<p class="youtube-caption">${inlineFormat(block.caption)}</p>` : ''}
    </div>`;

    case 'image':
      return `<figure class="content-image">
      <img src="${esc(block.src)}" alt="${esc(block.alt)}" loading="lazy">
      ${block.alt ? `<figcaption>${esc(block.alt)}</figcaption>` : ''}
    </figure>`;

    case 'image-text': {
      const imgPos = block.position === 'right' ? 'image-text--img-right' : '';
      const widthStyle = block.imgWidth !== 40 ? ` style="--img-width:${block.imgWidth}%"` : '';
      let bodyHtml = '';
      for (const tl of block.textLines) {
        if (/^- /.test(tl)) {
          bodyHtml += `<li>${inlineFormat(tl.replace(/^- /, '').trim())}</li>\n`;
        } else {
          bodyHtml += `<p>${inlineFormat(tl.trim())}</p>\n`;
        }
      }
      bodyHtml = bodyHtml.replace(/((?:<li>.*<\/li>\n)+)/g, '<ul>\n$1</ul>\n');
      return `<div class="image-text ${imgPos}"${widthStyle}>
      <div class="image-text__img">
        <img src="${esc(block.imgSrc)}" alt="${esc(block.imgAlt)}" loading="lazy">
      </div>
      <div class="image-text__body">
        ${bodyHtml.trim()}
      </div>
    </div>`;
    }

    case 'paragraph':
      return `<p class="loose-text">${block.text}</p>`;

    default:
      return '';
  }
}

function buildContentSections(sections) {
  let html = '';

  for (const sec of sections) {
    html += `\n<hr class="divider">
<section class="section">
  <div class="reveal">
    <span class="section-label" id="${sec.id}"><span class="num">${sec.label === '總結' ? '★' : sec.num}</span> ${esc(sec.label.replace(/[：:].*/,'').trim())}</span>
    <h2>${esc(sec.h2)}</h2>
    ${sec.lead ? `<p class="lead">${inlineFormatWithBreaks(sec.lead)}</p>` : ''}
  </div>\n`;

    for (const block of groupBlocks(sec.blocks)) {
      const inner = renderBlockBody(block);
      if (!inner) continue;
      const extraClass = block.type === 'bonus' ? ' bonus-btn-wrap' : '';
      html += `\n  <div class="reveal${extraClass}">\n    ${inner}\n  </div>\n`;
    }

    html += `</section>\n`;
  }

  return html;
}

function buildFooterSocials(cfg) {
  if (!cfg.footer?.show_socials) return '';
  const socials = cfg.instructor?.socials || [];
  if (!socials.length) return '';

  let html = `<p style="font-size:.9rem;color:var(--text);margin-bottom:1rem">${esc(cfg.footer.cta || '')}</p>
  <div class="social-links" style="justify-content:center;margin-bottom:1.5rem">\n`;
  for (const s of socials) {
    html += `    ${socialLink(s.platform, s.url)}\n`;
  }
  html += `  </div>`;
  return html;
}

// ─── Config loading with layering ───

function findGlobalConfig(courseDir) {
  let dir = dirname(courseDir);
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'config/global.yaml');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadConfig(courseDir) {
  let cfg = {};
  let globalRoot = dirname(courseDir);

  const globalConfig = findGlobalConfig(courseDir);
  if (globalConfig) {
    const globalRaw = readFileSync(globalConfig, 'utf-8');
    cfg = parseYamlFull(globalRaw);
    globalRoot = dirname(dirname(globalConfig)); // dir containing config/
    console.log(`   Global config: ${globalConfig}`);
  }

  const courseConfig = join(courseDir, 'config.yaml');
  if (existsSync(courseConfig)) {
    const courseRaw = readFileSync(courseConfig, 'utf-8');
    const courseCfg = parseYamlFull(courseRaw);
    cfg = deepMerge(cfg, courseCfg);
    console.log(`   Course config: ${courseConfig}`);
  } else {
    console.log(`   Course config: (none, using global only)`);
  }

  return { cfg, globalRoot };
}

// ─── Embed local images as base64 data URIs ───

function embedLocalImages(html, courseDir) {
  return html.replace(/<img\s([^>]*?)src="([^"]+)"([^>]*?)>/g, (match, pre, src, post) => {
    if (src.startsWith('data:')) return match;
    if (/^https?:\/\//.test(src)) return match;
    const absPath = resolve(courseDir, src);
    if (!existsSync(absPath)) {
      console.warn(`   ⚠️  Image not found, skipping embed: ${absPath}`);
      return match;
    }
    const ext = absPath.split('.').pop().toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
    const mime = mimeMap[ext] || `image/${ext}`;
    const b64 = readFileSync(absPath).toString('base64');
    return `<img ${pre}src="data:${mime};base64,${b64}"${post}>`;
  });
}

// ─── Main build ───

function build(courseDir) {
  const contentPath = join(courseDir, 'content.md');
  const outputPath = join(courseDir, 'index.html');

  if (!existsSync(contentPath)) {
    console.error(`❌ Content file not found: ${contentPath}`);
    process.exit(1);
  }

  console.log(`\n🔨 Building: ${courseDir}`);

  const { cfg, globalRoot } = loadConfig(courseDir);

  if (cfg.instructor?.avatar) {
    let absAvatar = resolve(globalRoot, cfg.instructor.avatar);
    if (!existsSync(absAvatar)) {
      for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']) {
        const candidate = absAvatar + '.' + ext;
        if (existsSync(candidate)) { absAvatar = candidate; break; }
      }
    }
    if (existsSync(absAvatar)) {
      const ext = absAvatar.split('.').pop().toLowerCase();
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
      const mime = mimeMap[ext] || `image/${ext}`;
      const b64 = readFileSync(absAvatar).toString('base64');
      cfg.instructor.avatar = `data:${mime};base64,${b64}`;
    } else {
      cfg.instructor.avatar = relative(courseDir, absAvatar);
    }
  }

  const contentRaw = readFileSync(contentPath, 'utf-8');
  const templateRaw = readFileSync(BASE_HTML, 'utf-8');

  const sections = parseContent(contentRaw);

  const navSource = cfg.nav && cfg.nav.length
    ? cfg.nav
    : sections.map(sec => ({
        text: sec.label.replace(/[：:].*/,'').trim(),
        href: `#${sec.id}`,
      }));
  const navItems = navSource.map((n, i) =>
    `<a href="${esc(n.href)}">${esc(n.text)}</a>`
  ).join('\n    ');

  const sectionIds = ['instructor', ...sections.map(s => s.id)];
  const allAnchorIds = ['instructor'];
  for (const sec of sections) {
    allAnchorIds.push(sec.id);
    for (const sub of sec.subs) allAnchorIds.push(sub.id);
  }

  const instructorName = cfg.instructor?.name || '';
  const heroAuthor = `${instructorName} — ${cfg.instructor?.tagline || ''}`;
  const sidebarBrand = (cfg.page?.title || '').replace(/\s*[—–-]\s*/, '<br>');

  let html = templateRaw;
  html = html.replace(/<!--[\s\S]*?-->\n?/g, '');

  const og = {
    title: cfg.seo?.title || cfg.page?.title || '',
    description: cfg.seo?.description || cfg.page?.subtitle || '',
    image: cfg.seo?.image || cfg.seo?.default_image || '',
    url: cfg.seo?.url || '',
    type: cfg.seo?.type || 'article',
    siteName: cfg.seo?.site_name || cfg.instructor?.name || '',
  };

  const replacements = {
    '{{PAGE_LANG}}': cfg.page?.lang || 'zh-TW',
    '{{PAGE_MODE}}': cfg.page?.mode ? `data-mode="${cfg.page.mode}"` : '',
    '{{PAGE_TITLE}}': cfg.page?.title || '',
    '{{FAVICON}}': cfg.page?.favicon || '',
    '{{OG_TYPE}}': esc(og.type),
    '{{OG_TITLE}}': esc(og.title),
    '{{OG_DESCRIPTION}}': esc(og.description),
    '{{OG_IMAGE}}': og.image || '',
    '{{OG_URL}}': og.url || '',
    '{{OG_SITE_NAME}}': esc(og.siteName),
    '{{SIDEBAR_BRAND}}': sidebarBrand,
    '{{TOC_ITEMS}}': buildTocItems(sections),
    '{{HERO_BADGE}}': cfg.page?.badge || '',
    '{{HERO_TITLE}}': raw(cfg.page?.hero_title || cfg.page?.title || ''),
    '{{HERO_SUBTITLE}}': esc(cfg.page?.subtitle || ''),
    '{{HERO_AUTHOR}}': esc(heroAuthor),
    '{{HERO_NAV_ITEMS}}': navItems,
    '{{OPENING_QUOTE}}': buildQuote(cfg.quotes?.opening),
    '{{INSTRUCTOR_SECTION}}': buildInstructor(cfg),
    '{{CONTENT_SECTIONS}}': buildContentSections(sections),
    '{{CLOSING_QUOTE}}': buildQuote(cfg.quotes?.closing),
    '{{FOOTER_SOCIAL_LINKS}}': buildFooterSocials(cfg),
    '{{FOOTER_COPYRIGHT}}': esc(cfg.footer?.copyright || ''),
    '{{SECTION_IDS}}': JSON.stringify(sectionIds),
    '{{ALL_ANCHOR_IDS}}': JSON.stringify(allAnchorIds),
  };

  for (const [key, val] of Object.entries(replacements)) {
    // 容許 formatter 在 {{ }} 內加空格，e.g. {{ SECTION_IDS }}
    const name = key.replace(/^\{\{/, '').replace(/\}\}$/, '');
    const pattern = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g');
    html = html.replace(pattern, val);
  }

  html = embedLocalImages(html, courseDir);

  writeFileSync(outputPath, html, 'utf-8');
  console.log(`✅ Generated: ${outputPath}`);
  console.log(`   Sections: ${sections.length}, Sub-sections: ${sections.reduce((a, s) => a + s.subs.length, 0)}`);
}

// ─── CLI ───

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage:');
  console.log('  node build.mjs <course-dir>            # e.g. node build.mjs cake');
  console.log('  node build.mjs <course-dir>/content.md  # explicit content path');
  console.log('');
  console.log('Config layering:');
  console.log('  1. config/global.yaml     (base: instructor, socials, footer)');
  console.log('  2. <course-dir>/config.yaml  (override: page, quotes, nav)');
  process.exit(1);
}

let input = args[0];

// Resolve course directory from input
let courseDir;
const resolved = resolve(input);

if (existsSync(resolved) && statSync(resolved).isDirectory()) {
  courseDir = resolved;
} else if (input.endsWith('.md')) {
  courseDir = dirname(resolved);
} else {
  courseDir = resolved;
}

build(courseDir);
