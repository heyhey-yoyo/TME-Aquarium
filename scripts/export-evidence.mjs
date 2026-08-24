import fs from 'node:fs';
import { REFERENCES, MECHANISMS } from '../src/evidence.js';

const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = (rows) => `\ufeff${rows.map((row) => row.map(quote).join(',')).join('\n')}\n`;

const referenceRows = [
  ['reference_id', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'pubmed_url'],
  ...REFERENCES.map((reference) => [
    reference.id,
    reference.authors,
    reference.year,
    reference.title,
    reference.journal,
    reference.pmid,
    reference.doi,
    `https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}/`,
  ]),
];

const mechanismRows = [
  ['mechanism_id', 'title', 'evidence_level', 'evidence_basis', 'model_translation', 'caveat', 'reference_ids'],
  ...MECHANISMS.map((mechanism) => [
    mechanism.id,
    mechanism.title,
    mechanism.level,
    mechanism.evidence,
    mechanism.translation,
    mechanism.caveat,
    mechanism.refs.join(';'),
  ]),
];

const bibtex = REFERENCES.map((reference) => {
  const key = `${reference.authors.split(/[ ,]/)[0].replaceAll(/[^A-Za-z]/g, '').toLowerCase()}${reference.year}`;
  const fields = [
    `  title = {${reference.title}},`,
    `  author = {${reference.authors}},`,
    `  journal = {${reference.journal}},`,
    `  year = {${reference.year}},`,
    `  pmid = {${reference.pmid}},`,
    reference.doi ? `  doi = {${reference.doi}},` : '',
  ].filter(Boolean).join('\n');
  return `@article{${key},\n${fields}\n}`;
}).join('\n\n');

fs.writeFileSync(new URL('../docs/参考文献_v1.0.csv', import.meta.url), csv(referenceRows));
fs.writeFileSync(new URL('../docs/机制证据登记_v1.0.csv', import.meta.url), csv(mechanismRows));
fs.writeFileSync(new URL('../docs/references.bib', import.meta.url), `${bibtex}\n`);
console.log(`已导出 ${REFERENCES.length} 条参考文献与 ${MECHANISMS.length} 项机制登记。`);
