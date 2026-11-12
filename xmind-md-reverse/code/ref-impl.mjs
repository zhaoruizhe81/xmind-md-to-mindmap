// 参考实现：严格按 XMind web 端 markdown_v3.chunk 的状态机还原 mdast -> topic 树
// 仅用于验证 / 演示转换规则，不依赖 XMind 内部类。
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
const N = {
  Root:'root', Paragraph:'paragraph', Heading:'heading', ThematicBreak:'thematicBreak',
  Blockquote:'blockquote', List:'list', ListItem:'listItem', Table:'table', TableRow:'tableRow',
  TableCell:'tableCell', HTML:'html', Code:'code', YAML:'yaml', Definition:'definition',
  Text:'text', Emphasis:'emphasis', Strong:'strong', Delete:'delete', InlineCode:'inlineCode',
  Break:'break', Link:'link', Image:'image', InlineMath:'inlineMath', Math:'math'
};
const FONT_WEIGHT='font-weight', FONT_STYLE='font-style', TEXT_DECORATION='text-decoration';
const ORDERED='ordered', UNORDERED='unordered';
const NL='\n', NL2='\n\n', SPREADSHEET='org.xmind.ui.spreadsheet';
let uid=0;
class Topic {
  constructor(){ this.id='t'+(++uid); this.title=''; this.attributedTitle=[];
    this.notes=null; this.href=''; this.image=null; this.style=null;
    this.children=[]; this.labels=[]; this.extensions=[]; this.structureClass=''; this.class='';
    this.parent=null; }
  addChild(t){ t.parent=this; this.children.push(t); return t; }
  addLabel(l){ this.labels.push(l); }
  addExtension(e){ this.extensions.push(e); }
}
class Sheet { constructor(){ this.rootTopic=new Topic(); } }

class Builder {
  constructor(sheet, minDepth){
    this.sheet=sheet; this.topicStack=[]; this.listTypeStack=[];
    this.parentTopicsOfSublists=new Set(); this.parentTopicsOfTables=new Set();
    this.topicPairsOfImages=[]; this.topicPairsOfMaths=[];
    this.topicPairsOfBlockquotes=[]; this.topicPairsOfTaskInfos=[];
    this.minimumHeadingDepth=minDepth; this.leadingParagraphParsed=false;
    this.currentHeadingInListTopic=null; this.blockquote=null;
    this.handlingTable=false; this.handlingTableHeader=false;
    this.currentTableHeaders=[]; this.currentTableColumnIndex=0;
    this.attributedTitle=[]; this.notesText=''; this.href=''; this.image=null;
    this.imageIsMathJax=false; this.topicExtensionContents=new Map();
    this.currentText=''; this.currentBold=false; this.currentItalic=false;
    this.currentStrikethrough=false; this.currentUnderline=null; this.markdownSyntaxDetected=false;
  }
  markDetected(node){ if(!this.markdownSyntaxDetected){ const t=node.type;
    if([N.Heading,N.Strong,N.Emphasis,N.Delete,N.List,N.Table,N.Blockquote,N.Link,N.Image,N.Code,N.InlineCode,N.ThematicBreak,N.Definition,N.HTML].includes(t)) this.markdownSyntaxDetected=true; } }
  push(t){ this.topicStack.push(t); }
  pop(){ return this.topicStack.pop(); }
  current(){ return this.topicStack[this.topicStack.length-1] || this.sheet.rootTopic; }
  parentOfCurrent(){ return this.current().parent || this.sheet.rootTopic; }
  listType(){ return this.listTypeStack[this.listTypeStack.length-1] || null; }
  inOrdered(){ return this.listType()===ORDERED; }
  inUnordered(){ return this.listType()===UNORDERED; }
  inAnyList(){ return this.listType()!==null; }
  inNestedList(){ return this.listTypeStack.length>1; }
  ensureRoot(){ if(this.topicStack.length===0) this.push(this.sheet.rootTopic); }
  commitTextSpan(){ const s={text:this.currentText};
    if(this.currentBold) s[FONT_WEIGHT]='700';
    if(this.currentItalic) s[FONT_STYLE]='italic';
    if(this.currentStrikethrough) s[TEXT_DECORATION]='line-through';
    if(this.currentUnderline) s[TEXT_DECORATION]=(s[TEXT_DECORATION]?s[TEXT_DECORATION]+' ':'')+'underline';
    this.attributedTitle.push(s); this.currentText=''; }
  commitTopic(){ const t=this.current();
    if(this.attributedTitle.length){
      t.attributedTitle=this.attributedTitle.map(s=>({...s}));
      t.title=t.attributedTitle.map(s=>s.text).join('');
      // 映射粗体/斜体到 style（简化）
      const b=this.attributedTitle.find(s=>s[FONT_WEIGHT]);
      if(b){ t.style=t.style||{}; t.style[FONT_WEIGHT]='700'; }
    }
    if(this.notesText){ const txt=this.notesText.replace(/\n$/,''); if(txt) t.notes=t.notes?t.notes+NL2+txt:txt; }
    if(this.href) t.href=this.href;
    if(this.image) t.image=this.image;
    if(this.topicExtensionContents.size){
      for(const [provider,content] of this.topicExtensionContents) t.addExtension({provider,content});
    }
  }
  commitDangling(){ if(this.topicStack.length>0){ if(this.currentText) this.commitTextSpan(); this.commitTopic(); }
    this.attributedTitle=[]; this.notesText=''; this.href=''; this.image=null; this.imageIsMathJax=false;
    this.topicExtensionContents=new Map(); this.currentText=''; this.currentBold=false; this.currentItalic=false;
    this.currentStrikethrough=false; this.currentUnderline=null; }
  createUnder(parent, detached=false){ const t=new Topic(); t.parent=parent; parent.children.push(t); return t; }
  createHeadingTopic(node){
    this.ensureRoot();
    const n=node.depth-this.minimumHeadingDepth, r=this.topicStack.length-2; let parent,t;
    if(n===r){ parent=this.parentOfCurrent(); t=this.createUnder(parent); this.pop(); this.push(t); }
    else if(n>r){ parent=this.current(); t=this.createUnder(parent); this.push(t); }
    else { while(node.depth-this.minimumHeadingDepth < this.topicStack.length-1) this.pop();
      parent=this.current(); t=this.createUnder(parent); this.push(t); }
    this.currentHeadingInListTopic = this.listTypeStack.length===1 ? t : null;
    return t;
  }
}

function calcMinDepth(node){ let m=6; if(node.type===N.Heading) m=Math.min(m,node.depth);
  if(Array.isArray(node.children)) for(const c of node.children) m=Math.min(m,calcMinDepth(c)); return m; }

function traverseNode(node, st, root, phase){
  const t=node.type;
  if(t===N.Root) return;
  if(t===N.Heading){
    if(phase==='enter'){
      if(st.inOrdered()){ const s=st.current(), c=st.parentOfCurrent(); c.children.splice(c.children.indexOf(s),1); st.pop(); }
      else if(st.inUnordered()){ st.currentText+='#'.repeat(node.depth)+' '; return; }
      else st.commitDangling();
      st.createHeadingTopic(node);
    }
    return;
  }
  if(t===N.Blockquote){
    if(phase==='enter'){ if(st.blockquote===null){ st.commitDangling(); st.leadingParagraphParsed=true; st.blockquote=node; } }
    else if(phase==='leave' && node===st.blockquote){
      const md=processor.stringify({type:'root',children:st.blockquote.children});
      const h=st.current(); const g=h.addChild(new Topic()); g.notes=md.trim();
      st.topicPairsOfBlockquotes.push([st.topicStack.length?st.topicStack[st.topicStack.length-1]:root.rootTopic, g]);
      st.commitDangling(); st.blockquote=null;
    }
    return;
  }
  if(t===N.Paragraph){
    if(phase==='enter'){
      if(st.topicStack.length===0 && !st.leadingParagraphParsed){ st.commitDangling(); st.ensureRoot(); st.leadingParagraphParsed=true; }
      else if(st.inAnyList()){ if(st.currentText) st.currentText+=NL2; }
      else { st.commitDangling(); const p=st.current(); const v=p.addChild(new Topic()); st.push(v); }
    } else { if(!st.inAnyList()){ st.commitDangling(); st.pop(); } }
    return;
  }
  if(t===N.List){
    if(phase==='enter'){ st.commitDangling(); st.currentHeadingInListTopic=null; st.listTypeStack.push(node.ordered?ORDERED:UNORDERED); }
    else st.listTypeStack.pop();
    return;
  }
  if(t===N.ListItem){
    if(phase==='enter'){
      const x=st.currentHeadingInListTopic||st.current();
      const S=x.addChild(new Topic());
      if(st.inOrdered()) st.topicExtensionContents.set('org.xmind.ui.numbering',{pattern:'numeral-arabic'});
      if(typeof node.checked==='boolean') st.topicExtensionContents.set('org.xmind.ui.task',{status:node.checked?'done':'todo'});
      if(st.inNestedList()) st.parentTopicsOfSublists.add(x);
      st.push(S);
    } else { st.commitDangling(); if(!st.currentHeadingInListTopic) st.pop(); }
    return;
  }
  if(t===N.Math){
    if(phase==='enter'){ st.commitDangling(); st.leadingParagraphParsed=true; const w=st.current();
      const T=w.addChild(new Topic()); st.topicPairsOfMaths.push([st.topicStack.length?st.topicStack[st.topicStack.length-1]:root.rootTopic,T]);
      st.push(T); st.image=null; st.imageIsMathJax=true;
      st.topicExtensionContents.set('org.xmind.ui.mathJax',{content:node.value.replace(/^\$\$\s*|\s*\$\$$/g,'').trim()});
      st.commitDangling(); st.pop(); }
    return;
  }
  if(t===N.InlineMath){ if(phase==='enter'){ if(st.currentText) st.commitTextSpan(); st.currentText+='$'+node.value+'$'; } return; }
  if(t===N.Image){
    if(phase==='enter'){ st.commitDangling(); const A=st.current(); const j=A.addChild(new Topic());
      st.topicPairsOfImages.push([st.topicStack.length?st.topicStack[st.topicStack.length-1]:root.rootTopic,j]);
      st.push(j); st.image=node.url; st.commitDangling(); st.pop(); }
    return;
  }
  if(t===N.Link){ if(phase==='enter') st.href=node.url; return; }
  if(t===N.Strong){ if(phase==='enter'){ if(st.currentText)st.commitTextSpan(); st.currentBold=true; } else { if(st.currentText)st.commitTextSpan(); st.currentBold=false; } return; }
  if(t===N.Emphasis){ if(phase==='enter'){ if(st.currentText)st.commitTextSpan(); st.currentItalic=true; } else { if(st.currentText)st.commitTextSpan(); st.currentItalic=false; } return; }
  if(t===N.Delete){ if(phase==='enter'){ if(st.currentText)st.commitTextSpan(); st.currentStrikethrough=true; } else { if(st.currentText)st.commitTextSpan(); st.currentStrikethrough=false; } return; }
  if(t===N.HTML){
    if(phase==='enter'){ const v=node.value;
      if(v==='<u>'||v==='<ins>'){ if(st.currentText)st.commitTextSpan(); st.currentUnderline=v; }
      else if(v==='</u>'||v==='</ins>'){ if(st.currentText)st.commitTextSpan(); st.currentUnderline=null; }
      else st.currentText+=v; }
    return;
  }
  if(t===N.Text){ if(phase==='enter') st.currentText+=node.value; return; }
  if(t===N.Break){ if(phase==='enter') st.currentText+=NL; return; }
  if(t===N.Code){
    if(phase==='enter'){
      if(node.lang==='xmind-task-info'){
        try{ st.commitDangling(); st.leadingParagraphParsed=true; const o=st.current(); const se=o.addChild(new Topic());
          st.topicPairsOfTaskInfos.push([st.topicStack.length?st.topicStack[st.topicStack.length-1]:root.rootTopic,se]);
          st.push(se); const U=JSON.parse(node.value); st.topicExtensionContents.set('org.xmind.ui.task',U);
          st.commitDangling(); st.pop(); }catch(e){}
      } else {
        st.commitDangling(); st.leadingParagraphParsed=true; const f=st.current(); const pe=f.addChild(new Topic());
        st.push(pe); st.currentText+='```'+(node.lang||'')+NL+node.value+NL+'```'; st.commitDangling(); st.pop();
      }
    }
    return;
  }
  if(t===N.InlineCode){ if(phase==='enter'){ if(st.currentText)st.commitTextSpan(); st.currentText+='`'+node.value+'`'; } return; }
  if(t===N.Table){
    if(phase==='enter'){ st.commitDangling(); st.leadingParagraphParsed=true; const he=st.current(); const ge=he.addChild(new Topic());
      ge.structureClass=SPREADSHEET; st.push(ge); st.parentTopicsOfTables.add(he); st.handlingTable=true; st.handlingTableHeader=true; }
    else { st.topicExtensionContents.set('org.xmind.ui.spreadsheet',[{name:'columns',content:st.currentTableHeaders.map((e,i)=>i===0?{name:'leading-column',content:e}:{name:'column',content:e})}]);
      st.commitDangling(); st.pop(); st.handlingTable=false; st.handlingTableHeader=false; st.currentTableHeaders=[]; st.currentTableColumnIndex=0; }
    return;
  }
  if(t===N.TableRow){
    if(phase==='enter'){ if(!st.handlingTableHeader) st.currentTableColumnIndex=0; }
    else { if(st.handlingTableHeader) st.handlingTableHeader=false; else { st.commitDangling(); st.pop(); } }
    return;
  }
  if(t===N.TableCell){
    if(phase==='enter'){ if(st.handlingTableHeader) st.push(new Topic()); else { const e=st.current(); const ve=e.addChild(new Topic()); st.push(ve); } }
    else {
      if(st.handlingTableHeader){ st.commitDangling(); const ye=st.current(); st.currentTableHeaders.push(ye.title||''); st.pop(); }
      else { st.commitDangling(); if(st.currentTableColumnIndex!==0){ const be=st.current(); be.addLabel(st.currentTableHeaders[st.currentTableColumnIndex]||''); st.pop(); } st.currentTableColumnIndex+=1; }
    }
    return;
  }
}

const ENTER_ONLY=new Set([N.Heading]);
const SKIP_CHILDREN=new Set([N.Blockquote]);
const ENTER_LEAVE=new Set([N.Paragraph,N.List,N.ListItem,N.Strong,N.Emphasis,N.Delete,N.Link,N.Table,N.TableRow,N.TableCell]);

function traverseChildren(node,st,root){ if(Array.isArray(node.children)) for(const c of node.children) traverseRec(c,st,root); }
function traverseRec(node,st,root){ st.markDetected(node);
  if(ENTER_ONLY.has(node.type)){ traverseNode(node,st,root,'enter'); traverseChildren(node,st,root); }
  else if(SKIP_CHILDREN.has(node.type)){ traverseNode(node,st,root,'enter'); traverseNode(node,st,root,'leave'); }
  else if(ENTER_LEAVE.has(node.type)){ traverseNode(node,st,root,'enter'); traverseChildren(node,st,root); traverseNode(node,st,root,'leave'); }
  else { traverseNode(node,st,root,'enter'); if(Array.isArray(node.children)) traverseChildren(node,st,root); }
}

function hasTitle(t){ return !!(t.title || t.attributedTitle.some(s=>s.text.length>0)); }
function hasContent(t){ return !!(hasTitle(t)||t.class||t.structureClass||t.notes||t.href||t.image||t.labels.length||t.extensions.length||t.style); }

function postProcess(sheet, st){
  const promote=(e)=>{ if(e.children.length===1 && !e.title && !e.notes && !e.image){ const i=e.children[0];
    e.class=i.class; e.structureClass=i.structureClass; e.children=[]; i.children.forEach(t=>{t.parent=e; e.children.push(t);});
    e.attributedTitle=i.attributedTitle; e.title=i.title; e.notes=i.notes; e.href=i.href; e.image=i.image; e.extensions=i.extensions.slice(); } };
  st.parentTopicsOfSublists.forEach(promote);
  st.parentTopicsOfTables.forEach(e=>{ if(e.children.length===1 && e.children[0].structureClass===SPREADSHEET){ const r=e.children[0];
    e.class=r.class; e.structureClass=r.structureClass; e.children=[]; r.children.forEach(t=>{t.parent=e;e.children.push(t);}); e.extensions=r.extensions.slice(); } });
  const removeFromParent=(h)=>{ const p=h.parent; if(!p)return; const i=p.children.indexOf(h); if(i!==-1)p.children.splice(i,1); };
  for(const [m,h] of st.topicPairsOfImages){ if(h.image && !m.image){ m.image=h.image; removeFromParent(h); } }
  for(const [m,h] of st.topicPairsOfMaths){ if(h.image && !m.image){ m.image=h.image; const c=h.extensions.find(e=>e.provider==='org.xmind.ui.mathJax'); if(c)m.addExtension(c); removeFromParent(h); } }
  for(const [m,h] of st.topicPairsOfBlockquotes){ if(h.notes){ m.notes=m.notes?m.notes+NL2+h.notes:h.notes; removeFromParent(h); } }
  for(const [m,P] of st.topicPairsOfTaskInfos){ const te=P.extensions.find(e=>e.provider==='org.xmind.ui.task'); if(te){ const ex=m.extensions.findIndex(e=>e.provider==='org.xmind.ui.task'); if(ex!==-1)m.extensions.splice(ex,1,te); else m.addExtension(te); removeFromParent(P); } }
  // 首个子节点图片上提
  (function walk(t,parent){ for(const c of t.children.slice()) walk(c,t);
    if(parent && parent.children[0]===t && !(t.title||t.notes||!t.image||parent.image)){ parent.image=t.image; removeFromParent(t); } })(sheet.rootTopic,null);
  // 根节点折叠
  if(sheet.rootTopic.children.length===1 && !hasContent(sheet.rootTopic)){ const z=sheet.rootTopic.children[0];
    sheet.rootTopic.class=z.class; sheet.rootTopic.structureClass=z.structureClass;
    sheet.rootTopic.children=[]; z.children.forEach(t=>{t.parent=sheet.rootTopic; sheet.rootTopic.children.push(t);});
    sheet.rootTopic.attributedTitle=z.attributedTitle; sheet.rootTopic.title=z.title; sheet.rootTopic.notes=z.notes;
    sheet.rootTopic.href=z.href; sheet.rootTopic.image=z.image; sheet.rootTopic.extensions=z.extensions.slice(); }
  // 根只有单标题但含换行 -> 拆成同级子主题
  if(sheet.rootTopic.title && sheet.rootTopic.attributedTitle.length===1 && sheet.rootTopic.children.length===0 && !sheet.rootTopic.notes && !sheet.rootTopic.image){
    const parts=sheet.rootTopic.title.split(NL);
    if(parts.length>1){ sheet.rootTopic.title=''; sheet.rootTopic.attributedTitle=[{text:''}];
      parts.forEach(p=>{ const n=new Topic(); n.title=p; n.attributedTitle=[{text:p}]; sheet.rootTopic.addChild(n); }); }
  }
}

export function markdown2xmind(md){
  const ast=processor.parse(md);
  const sheet=new Sheet();
  const minD=calcMinDepth(ast);
  const st=new Builder(sheet,minD);
  traverseChildren(ast,st,ast);
  if(st.topicStack.length>0){ if(st.currentText)st.commitTextSpan(); st.commitTopic(); }
  postProcess(sheet,st);
  // 根无标题但有内容 -> 占位 Central Topic
  if(!hasTitle(sheet.rootTopic) && (hasContent(sheet.rootTopic)||sheet.rootTopic.children.length)){
    sheet.rootTopic.title='Central Topic'; sheet.rootTopic.attributedTitle=[{text:'Central Topic'}];
  }
  return {sheet, markdownSyntaxDetected:st.markdownSyntaxDetected};
}
