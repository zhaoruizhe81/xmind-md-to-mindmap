import fs from 'fs';
import { markdown2xmind } from './ref-impl.mjs';

const md = fs.readFileSync(new URL('./sample.md', import.meta.url), 'utf8');
const { sheet, markdownSyntaxDetected } = markdown2xmind(md);

function clean(t){
  const o={ title:t.title };
  if(t.attributedTitle && t.attributedTitle.some(s=>Object.keys(s).length>1)) o.attributedTitle=t.attributedTitle;
  if(t.notes) o.notes=t.notes;
  if(t.href) o.href=t.href;
  if(t.image) o.image=t.image;
  if(t.labels && t.labels.length) o.labels=t.labels;
  if(t.structureClass) o.structureClass=t.structureClass;
  if(t.extensions && t.extensions.length) o.extensions=t.extensions;
  if(t.children && t.children.length) o.children=t.children.map(clean);
  return o;
}

function tree(t, d=0){
  let line='  '.repeat(d)+'• '+ (t.title||'(空)');
  const meta=[];
  if(t.notes) meta.push('notes');
  if(t.image) meta.push('image');
  if(t.href) meta.push('href');
  if(t.labels && t.labels.length) meta.push('labels='+JSON.stringify(t.labels));
  if(t.structureClass) meta.push('structure='+t.structureClass.split('.').pop());
  if(t.extensions && t.extensions.length) meta.push('ext='+t.extensions.map(e=>e.provider.split('.').pop()).join(','));
  if(t.attributedTitle && t.attributedTitle.some(s=>Object.keys(s).length>1)) meta.push('rich='+t.attributedTitle.map(s=>s.text+'['+Object.keys(s).filter(k=>k!=='text').join('+')+']').join('|'));
  if(meta.length) line+='   «'+meta.join('; ')+'»';
  console.log(line);
  (t.children||[]).forEach(c=>tree(c,d+1));
}

console.log('markdownSyntaxDetected =', markdownSyntaxDetected);
console.log('=== 树状结构 ===');
tree(sheet.rootTopic);
console.log('\n=== JSON ===');
console.log(JSON.stringify(clean(sheet.rootTopic), null, 2));
