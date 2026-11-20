/* Cleaner reader for the full STEP application. Passage HTML, alignment,
   references, definitions and searches come from the STEP engine. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const storageKey = 'kjvish-reader-v1';
  const mainEditions = ['KJVish','KJV','BSB'];
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (_) { /* Storage is optional. */ }
  const hash = new URLSearchParams(location.hash.slice(1));
  const state = {
    reference: hash.get('ref') || saved.reference || 'Gen.1',
    translation: hash.get('version') || saved.translation || 'KJVish',
    language: hash.get('lang') || saved.language || 'both',
    extraEditions: saved.extraEditions===true || !mainEditions.includes(hash.get('version') || saved.translation || 'KJVish'),
    speakOnClick: saved.speakOnClick!==false,
    theme: saved.theme==='light'?'light':'dark', notesScope: 'verse',
    commentary: saved.commentaryUiVersion===2 ? saved.commentary || '' : '', layout: saved.layout || 'parallel',
    font: Math.min(34, Math.max(20, saved.typographyVersion===2 ? Number(saved.font) || 24 : 24)),
    study: saved.commentaryUiVersion===2 && saved.study===true, selected: saved.selected || '', tab: 'notes',
    data: null, word: null, modules: [], books: [], request: 0, studyRequest: 0,
    searchRequest: 0, chapterRequest: 0, position: saved.position || '', pinnedWord: null, previewWord: null
  };
  if (state.language !== 'english') state.language = 'both';
  const isOriginal = version => ['THOT','SBLG_th'].includes(version);
  const isNewTestament = ref => /^(Matt|Mark|Luke|John|Acts|Rom|1Cor|2Cor|Gal|Eph|Phil|Col|1Thess|2Thess|1Tim|2Tim|Titus|Phlm|Heb|Jas|1Pet|2Pet|1John|2John|3John|Jude|Rev)(\.|$)/.test(ref);
  const originalVersion = (ref=state.reference) => isNewTestament(ref) ? 'SBLG_th' : 'THOT';
  const isMobile = () => matchMedia('(max-width:1080px)').matches;
  const labelFor = id => state.modules.find(m => m.initials === id)?.name || id;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent; };
  function markup(html) {
    const template = document.createElement('template'); template.innerHTML = html || '';
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta,img,form').forEach(el => el.remove());
    template.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        if (/^on/i.test(a.name) || ['src','srcset','style'].includes(a.name) || (['href','xlink:href'].includes(a.name) && !a.value.startsWith('#'))) el.removeAttribute(a.name);
      });
    });
    return template.innerHTML;
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({speakOnClick:state.speakOnClick, theme:state.theme, reference:state.reference, translation:state.translation, language:state.language, commentary:state.commentary, commentaryUiVersion:2, layout:state.layout, font:state.font, extraEditions:state.extraEditions, typographyVersion:2, study:state.study, selected:state.selected, position:state.position})); } catch (_) { /* Private browsing can disable storage. */ }
    const params = new URLSearchParams({ref:state.reference,version:state.translation,lang:state.language});
    history.replaceState(null,'',`#${params}`);
  }
  async function api(controller, method, ...args) {
    const path = ['/rest',controller,method,...args.map(v => encodeURIComponent(String(v || ' ')))].join('/');
    const response = await fetch(path);
    if (!response.ok) throw new Error('The reader could not open that request. Try a book and chapter, such as John 3.');
    const text = await response.text();
    let value; try { value = text ? JSON.parse(text) : null; } catch (_) { throw new Error('The reader returned an unreadable response.'); }
    if (value?.errorMessage || value?.error){const error=new Error('The reader could not open that request. Check the passage or installed edition.');error.kind='engine-rejection';throw error;}
    return value;
  }
  function message(text = '') { $('message').textContent=text; $('message').hidden=!text; }
  function applyDisplay() {
    document.documentElement.style.setProperty('--font', `${state.font}px`);
    document.documentElement.dataset.theme=state.theme;
    const nextTheme=state.theme==='dark'?'light':'dark';
    $('themeToggle').setAttribute('aria-label',`Switch to ${nextTheme} theme`);
    $('themeToggle').title=`Switch to ${nextTheme} theme`;
    $('themeIcon').textContent=state.theme==='dark'?'☀':'☾';
    document.querySelector('meta[name=theme-color]').content=state.theme==='dark'?'#030712':'#ffffff';
    document.body.classList.toggle('parallel', state.layout !== 'stacked');
    document.body.classList.toggle('study-closed', !state.study);
    $('fontValue').textContent=state.font;
    $('layout').value=state.layout;
    $('extraEditions').checked=state.extraEditions;
    $('speakOnClick').checked=state.speakOnClick;
    $('studyVisible').checked=state.study;
    $('studyToggle').setAttribute('aria-expanded', String(state.study));
  }
  function openStudy() {
    state.focusOrigin=document.activeElement?.closest('#study') ? state.focusOrigin : document.activeElement;
    state.study=true; applyDisplay(); if(isMobile())document.body.classList.add('sheet-open');
    $('sheetHandle').setAttribute('aria-expanded','true'); persist();renderStudy();
  }
  function closeStudy() {
    document.body.classList.remove('sheet-open');
    if (!isMobile()) { state.study=false; applyDisplay(); }
    if (state.focusOrigin?.isConnected)state.focusOrigin.focus({preventScroll:true});
    $('sheetHandle').setAttribute('aria-expanded','false');updateStudyReference();persist();
  }
  function option(value, text) { const o=document.createElement('option');o.value=value;o.textContent=text;return o; }
  async function chapters(book, selected) {
    const token=++state.chapterRequest;
    const name=state.books.find(b=>b.osisID===book)?.fullName || book;
    const items=await api('bible','getBibleBookNames',name,state.translation);
    if (token!==state.chapterRequest) return;
    $('chapter').replaceChildren(...items.filter(b=>b.passage && b.osisID).map(b=>option(b.osisID,b.osisID.split('.')[1] || '1')));
    $('chapter').value=selected;
  }
  function verseReference(el) {
    const row=el.closest('.verseGrouping,.solo-verse');
    return row?.querySelector('a.verseLink[name]')?.getAttribute('name') || state.selected;
  }
  // Match native Strong tags, including STEP's augmented homograph suffixes.
  // BSB embeds a lemma identifier beside its base Strong number; parse tokens,
  // rather than comparing raw attribute strings or guessing from word order.
  // Suffix case distinguishes several TBESH name entries.
  function strongTags(value) {
    return [...String(value || '').matchAll(/(?:^|[\s:])([HG])(\d{1,5})([A-Za-z]*)!?\b/g)].map(m=>({
      base:m[1]+m[2].padStart(4,'0'), suffix:m[3],
      full:m[1]+m[2].padStart(4,'0')+m[3]
    })).filter(t=>t.base!=='H0000' && t.base!=='G0000');
  }
  function sameStrong(a,b) { return a.base===b.base && (!a.suffix || !b.suffix || a.suffix===b.suffix); }
  const addedWordLinks = new WeakMap();
  const reverseWordLinks = new WeakMap();
  const linkDescriptions = {
    both: 'Inferred phrase link from KJV and BSB',
    kjv: 'Inferred phrase link from KJV',
    bsb: 'Inferred phrase link from BSB',
    grammar: 'Link checked against the Hebrew text',
  };
  async function loadAkjvWordLinks(passage) {
    const chapters = new Set();
    for (const anchor of passage.querySelectorAll('.verse[lang=en] a.verseLink[name]')) {
      const chapter = chapterReference(anchor.getAttribute('name'));
      if (/^[1-3]?[A-Za-z]+(?:\.\d+)?$/.test(chapter)) chapters.add(chapter);
    }
    const blocks = await Promise.all([...chapters].map(async chapter => {
      try {
        const response = await fetch(`/reader/akjv-alignment/${chapter}.json`);
        if (response.ok) return await response.json();
      } catch (_) { /* Publisher tags work independently of these additions. */ }
      return {};
    }));
    return Object.assign({}, ...blocks);
  }
  function applyAkjvWordLinks(passage, verses, detachedOriginal) {
    for (const verse of passage.querySelectorAll('.verse[lang=en]')) {
      const ref = verse.querySelector('a.verseLink[name]')?.getAttribute('name');
      const entry = verses[ref];
      if (!entry) continue;
      const row = verse.closest('.verseGrouping');
      const sourceVerse = row?.querySelector('.singleVerse:not([lang=en]) .verse') || detachedOriginal.get(ref);
      const original = [...(sourceVerse?.querySelectorAll('[strong]') || [])];
      const walker = document.createTreeWalker(verse, NodeFilter.SHOW_TEXT);
      const words = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest('.verseLink,.verseNumber,.inlineNote,.note')) continue;
        for (const match of node.data.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu)) {
          words.push({node, start:match.index, text:match[0]});
        }
      }
      // Require the expected wording before trusting any saved positions.
      if (words.length !== entry.words.length || words.some((word, i) => word.text !== entry.words[i])) continue;
      const changes = new Map();
      for (const link of entry.links) {
        const word = words[link.word];
        if (!word || word.node.parentElement.closest('[strong]')) continue;
        const peers = link.targets.map(target => original[target.index]);
        if (sourceVerse && link.targets.some((target, i) =>
          peers[i]?.getAttribute('strong') !== target.strong || peers[i]?.textContent !== target.text)) continue;
        if (!changes.has(word.node)) changes.set(word.node, []);
        changes.get(word.node).push({ word, link, peers:peers.filter(Boolean) });
      }
      for (const [node, edits] of changes) {
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const {word, link, peers} of edits.sort((a,b) => a.word.start-b.word.start)) {
          fragment.append(node.data.slice(cursor,word.start));
          const span = document.createElement('span');
          span.textContent = word.text;
          span.setAttribute('strong', [...new Set(link.targets.map(t => t.strong))].join(' '));
          span.dataset.akjvLink = link.source;
          span.title = linkDescriptions[link.source];
          addedWordLinks.set(span, peers);
          for (const peer of peers) {
            if (!reverseWordLinks.has(peer)) reverseWordLinks.set(peer, []);
            reverseWordLinks.get(peer).push(span);
          }
          fragment.append(span);
          cursor = word.start + word.text.length;
        }
        fragment.append(node.data.slice(cursor));
        node.replaceWith(fragment);
      }
    }
  }
  function matchingWords(word) {
    const row=word?.closest('.verseGrouping,.solo-verse');
    if(!row)return [];
    if(addedWordLinks.has(word))return [word,...addedWordLinks.get(word).filter(peer=>peer.isConnected)];
    const tags=strongTags(word.getAttribute('strong'));
    const matches=[...row.querySelectorAll('[strong]:not([data-akjv-link])')]
      .filter(el=>strongTags(el.getAttribute('strong')).some(t=>tags.some(tag=>sameStrong(tag,t))));
    return [...matches,...(reverseWordLinks.get(word) || [])];
  }
  function wordVersion(word) {
    const version=word.closest('.singleVerse')?.querySelector('[data-version]')?.dataset.version;
    return version==='SBLG'?'SBLG_th':version || state.translation;
  }
  function lexicalTags(word) {
    const tags=strongTags(word.getAttribute('strong'));const peers=matchingWords(word).filter(el=>el!==word);
    return [...new Set(tags.flatMap(tag=>{
      if(tag.suffix)return [tag.full];
      const augmented=peers.flatMap(el=>strongTags(el.getAttribute('strong'))).filter(t=>t.suffix && sameStrong(tag,t));
      return augmented.length ? augmented.map(t=>t.full) : [tag.full];
    }))].join(' ');
  }
  const surfaceBySpan = new WeakMap();
  let sourceByReference = new Map();

  function originalVerses(passage) {
    return new Map([...passage.querySelectorAll('.verse[lang=hbo],.verse[lang=he],.verse[lang=grc],.verse[lang=el]')]
      .map(verse=>[verse.querySelector('a.verseLink[name]')?.getAttribute('name'),verse])
      .filter(([ref])=>ref));
  }

  function indexSourceForms(verses, book) {
    const result=new Map();
    if (!book) return result;
    const hebrew=book==='Gen';
    for (const [ref, verse] of verses) {
      let text='';
      const spans=[];
      const walker=document.createTreeWalker(verse,NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,{
        acceptNode(node) {
          return node.nodeType===Node.ELEMENT_NODE && node.matches('.verseLink,.verseNumber,.note,.inlineNote')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      for (let node=walker.nextNode();node;node=walker.nextNode()) {
        if(node.nodeType===Node.ELEMENT_NODE) {
          if(node.matches('br'))text+=' ';
          continue;
        }
        const span=node.parentElement.closest('[strong]');
        if(span)spans.push({span,start:text.length,end:text.length+node.data.length});
        text+=node.data;
      }
      const forms=[];
      for(const match of text.matchAll(/\p{L}[\p{L}\p{M}]*['’ʼ]?/gu)) {
        const peers=spans.filter(({start,end})=>start<match.index+match[0].length && end>match.index).map(({span})=>span);
        if(!peers.length)continue;
        let spelling=match[0].normalize('NFD');
        if(hebrew)spelling=spelling.replace(/[\u0591-\u05af\u05bd]/g,'');
        const form=spelling.toLowerCase().replace(/[’ʼ]/g,"'").normalize('NFC');
        const occurrence={form,tags:peers.flatMap(span=>strongTags(span.getAttribute('strong')))};
        for (const peer of peers) surfaceBySpan.set(peer,occurrence);
        forms.push(occurrence);
      }
      result.set(ref,forms);
    }
    return result;
  }

  function verseFormEntry(word) {
    if (isOriginal(wordVersion(word))) return surfaceBySpan.get(word)?.form;
    const linked=addedWordLinks.get(word);
    let candidates;
    if(linked?.length){
      candidates=linked.map(peer=>surfaceBySpan.get(peer));
    } else {
      const tags=strongTags(word.getAttribute('strong'));
      const lexical=tags.filter(tag=>!isGrammarTag(tag));
      const chosen=lexical.length ? lexical : tags;
      candidates=(sourceByReference.get(verseReference(word)) || []).filter(occurrence=>
        occurrence.tags.some(tag=>chosen.some(other=>sameStrong(other,tag))));
    }
    const [first]=candidates;
    if (first?.form && candidates.every(candidate=>candidate?.form===first.form)) return first.form;
  }

  function comparisonAudioEntry(word) {
    if (!word || !state.word) return null;
    const form=verseFormEntry(word);
    const book=state.reference.split('.')[0];
    return audioEntry(state.word.strong,state.word.preferLexical,form ? book : '',form);
  }

  const isGrammarTag = tag => tag.base==='G3588' || tag.base==='H0853' || /^H90/.test(tag.base);
  let audioRequest=0, audioTimer;
  const player=$('pronunciationPlayer');
  function audioStatus(text='') {
    clearTimeout(audioTimer);$('pronunciationStatus').textContent=text;$('pronunciationStatus').hidden=!text;
    if(text)audioTimer=setTimeout(()=>{$('pronunciationStatus').hidden=true;},3500);
  }
  function audioEntry(tags, preferLexical=false, book='', form='') {
    const candidates=strongTags(tags);
    const ordered=preferLexical
      ? [...candidates.filter(tag=>!isGrammarTag(tag)), ...candidates.filter(isGrammarTag)]
      : candidates;
    const first=ordered[0];
    if (!first && !form) return null;
    const params=new URLSearchParams({tags:ordered.map(tag=>tag.full).join(' ')});
    if (form) { params.set('book',book); params.set('form',form); }
    return {id:first?.full || form,url:'/listen?'+params,form:form || first.full,
      audioLanguage:(book==='John' || first?.full.startsWith('G')) ? 'greek' : 'hebrew',surface:!!form};
  }
  function resetAudioButtons() {
    document.querySelectorAll('[data-pronunciation]').forEach(el=>{el.textContent='▶ Play';el.setAttribute('aria-pressed','false');});
  }
  function stopPronunciation() { ++audioRequest;player.pause();resetAudioButtons();audioStatus(); }
  function playPronunciation(tags) { playAudioEntry(audioEntry(tags)); }
  function playAudioEntry(entry) {
    if(!entry){stopPronunciation();audioStatus('No pronunciation is available for this dictionary entry.');return;}
    const token=++audioRequest;player.pause();resetAudioButtons();audioStatus();
    player.src=entry.url;player.dataset.strong=entry.id;
    document.querySelectorAll('[data-pronunciation]').forEach(el=>{if(el.dataset.pronunciation===entry.id){el.textContent='Playing…';el.setAttribute('aria-pressed','true');}});
    player.play().catch(()=>{if(token===audioRequest){resetAudioButtons();audioStatus('Audio is unavailable right now. Try again in a moment.');}});
  }
  player.addEventListener('ended',resetAudioButtons);
  player.addEventListener('error',()=>{resetAudioButtons();if(player.getAttribute('src'))audioStatus('The pronunciation clip could not be opened.');});
  function pronunciationControl(vocab) {
    const entry=audioEntry(vocab.strongNumber);
    if(entry)return `<div class="word-pronunciation"><button data-pronunciation="${escape(entry.id)}" aria-label="Play dictionary pronunciation for ${escape(entry.form)}" aria-pressed="false">▶ Play</button><span>${entry.audioLanguage==='greek'?'Greek dictionary form · modern pronunciation':'Hebrew dictionary form'}</span></div>`;
    return /^[HG]/.test(String(vocab.strongNumber))?'<p class="audio-unavailable">No pronunciation is available for this entry.</p>':'';
  }
  function renderWordMatch() {
    const pinned=state.pinnedWord?.isConnected ? state.pinnedWord : null;
    const preview=state.previewWord?.isConnected ? state.previewWord : null;
    const active=pinned || preview;
    $('passage').querySelectorAll('.word-match,.word-origin,.word-preview').forEach(el=>el.classList.remove('word-match','word-origin','word-preview'));
    $('passage').querySelectorAll('[aria-pressed=true]').forEach(el=>el.setAttribute('aria-pressed','false'));
    const status=$('comparisonText');
    if(!active){
      $('comparisonBar').hidden=true;return;
    }
    const matches=matchingWords(active);matches.forEach(el=>el.classList.add('word-match'));
    active.classList.add('word-origin');
    if(pinned)pinned.setAttribute('aria-pressed','true');
    if(pinned && preview && preview!==pinned)matchingWords(preview).forEach(el=>el.classList.add('word-preview'));
    const english=matches.filter(el=>!isOriginal(wordVersion(el))).map(el=>el.textContent.trim()).filter(Boolean);
    const original=matches.filter(el=>isOriginal(wordVersion(el))).map(el=>el.textContent.trim()).filter(Boolean);
    const fragments=[];
    const addText=(values,dir)=>{const bdi=document.createElement('bdi');bdi.dir=dir;bdi.textContent=[...new Set(values)].join(' · ');fragments.push(bdi);};
    if(english.length)addText(english,'ltr');
    if(english.length && original.length)fragments.push(document.createTextNode(' ↔ '));
    if(original.length)addText(original,originalVersion()==='THOT'?'rtl':'ltr');
    if(!english.length || !original.length)fragments.push(document.createTextNode(state.language==='both' ? ' · No counterpart is tagged separately in this verse.' : ' · Choose English + original to compare.'));
    const addedLink=linkDescriptions[active.dataset.akjvLink];
    if(addedLink)fragments.push(document.createTextNode(' · '+addedLink));
    status.replaceChildren(...fragments);$('comparisonBar').hidden=false;
    $('comparisonDetails').hidden=!state.pinnedWord;
    $('comparisonClear').hidden=!state.pinnedWord;
    const play=$('comparisonPlay');const entry=comparisonAudioEntry(pinned);
    play.hidden=!pinned;play.disabled=!entry;play.setAttribute('aria-pressed','false');
    if(entry){
      play.dataset.pronunciation=entry.id;play.textContent='▶ Play';
      const label=entry.aramaicTrial ? 'Aramaic word with experimental Hebrew pronunciation'
        : entry.surface ? (entry.audioLanguage==='greek' ? 'Greek verse form with modern pronunciation' : 'Hebrew verse form')
        : (entry.audioLanguage==='greek' ? 'Greek dictionary form' : 'Hebrew dictionary form');
      play.setAttribute('aria-label',`Play ${label}: ${entry.form}`);
      play.title=`Play ${label}: ${entry.form}`;
      if(player.dataset.strong===entry.id && !player.paused){play.textContent='Playing…';play.setAttribute('aria-pressed','true');}
    } else {
      delete play.dataset.pronunciation;play.textContent='No audio yet';
      play.setAttribute('aria-label','No recording for this dictionary entry');play.title='No recording for this dictionary entry';
    }
  }
  function clearWordMatch() {
    state.pinnedWord=null;state.previewWord=null;renderWordMatch();
  }
  function selectVerse(ref, show=false, render=true, scope='verse') {
    if (!ref) return;
    if(ref!==state.selected){state.pinnedWord=null;state.previewWord=null;renderWordMatch();}
    state.selected=ref;state.notesScope=scope;
    updateStudyReference();
    document.querySelectorAll('.focused-verse').forEach(el=>el.classList.remove('focused-verse'));
    const anchor=[...$('passage').querySelectorAll('a.verseLink[name]')].find(a=>a.getAttribute('name')===ref);
    anchor?.closest('.verseGrouping,.solo-verse')?.classList.add('focused-verse');
    if (show) openStudy();
    persist(); if(render && !show)renderStudy();
  }
  async function read(reference=state.reference, selected='', scroll=true) {
    const token=++state.request;stopPronunciation();
    $('passage').setAttribute('aria-busy','true'); message();
    try {
      const normalized=await api('bible','getKeyInfo',reference,state.translation,state.translation);
      if (token!==state.request) return;
      if (!normalized?.osisKeyId) throw new Error('That passage is unavailable. Try a book and chapter, such as Genesis 1.');
      reference=normalized.osisKeyId;
      const isNT=isNewTestament(reference), original=isNT?'SBLG_th':'THOT';
      const name=isNT?'Greek':'Hebrew';
      const args=[state.translation,reference,'VNHUG'];
      if (state.language==='both') args.push(original,'INTERLEAVED');
      const book=reference.split('.')[0];
      const audioBook=['Gen','John'].includes(book) ? book : '';
      const data=await api('bible','getBibleText',...args);
      if (token!==state.request) return;
      if (!data?.value || !data.osisId) throw new Error('That passage is unavailable. Try a book and chapter, such as Genesis 1.');
      const template=document.createElement('template');
      template.innerHTML=markup(data.value);
      let detachedOriginal=new Map();
      if(audioBook && state.language==='english') {
        try {
          const source=await api('bible','getBibleText',original,reference,'VNHUG');
          const detached=document.createElement('template');
          detached.innerHTML=markup(source.value);
          detachedOriginal=originalVerses(detached.content);
        } catch (_) { /* Fall back to the dictionary if the original edition is unavailable. */ }
      }
      if (token!==state.request) return;
      if (state.translation==='AKJVPlus') {
        const links=await loadAkjvWordLinks(template.content);
        if (token!==state.request) return;
        applyAkjvWordLinks(template.content,links,detachedOriginal);
      }
      state.data=data;state.reference=data.osisId; state.word=null;state.pinnedWord=null;state.previewWord=null;
      sourceByReference=indexSourceForms(state.language==='english' ? detachedOriginal : originalVerses(template.content),audioBook);
      $('passage').replaceChildren(template.content);
      if (!$('passage').querySelector('.verseGrouping')) $('passage').querySelectorAll('span.verse,div.verse').forEach(el=>el.classList.add('solo-verse'));
      $('passage').querySelectorAll('[strong]').forEach(el=>{if(!el.textContent.trim())return;el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-pressed','false');el.setAttribute('aria-label',`Compare word: ${el.textContent}`);});
      $('passage').querySelectorAll('.verseGrouping > h4.heading,.solo-verse .verseNumber').forEach(el=>{el.classList.add('verse-heading');el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',`Open commentary for ${verseReference(el)}`);});
      $('chapterTitle').textContent=humanReference(data.osisId,data.reference);
      $('chapterCommentary').disabled=false;
      $('chapterCommentary').setAttribute('aria-label',`Open all commentary for ${humanReference(chapterReference(data.osisId),data.reference)}`);
      document.title=`${data.reference} · STEP Reader`;
      $('editionLabel').textContent=`${state.translation==='KJV'?'King James Version':state.translation==='BSB'?'Berean Standard Bible':labelFor(state.translation)}${state.language==='both' ? ' · '+name : ''}`;
      $('reference').value='';$('reference').placeholder=`Go to a passage…`;
      $('translation').value=state.translation;$('language').value=state.language;
      const osis=data.osisId.split('-')[0];const parts=osis.split('.');
      $('book').value=parts[0];await chapters(parts[0],chapterReference(osis));
      if (token!==state.request) return;
      ['previous','next'].forEach(dir=>{
        const key=data[`${dir}Chapter`]?.osisKeyId;
        $(dir).disabled=!key || key===data.osisId;
        $(`${dir}Bottom`).disabled=$(dir).disabled;
      });
      const originalCredit=isNT?'Greek: SBLGNT · SBL/Logos · STEP tagging':'Hebrew: THOT · STEP Bible · CC BY 4.0';
      const englishCredit=state.translation==='KJVish'?'KJV-ish · The Autodidact’s Translation':state.translation==='AKJVPlus'?'American King James Version (1999) · Strong’s links where available':state.translation==='BSB'?'Berean Standard Bible · Public domain':state.translation==='engweb2025peb'?'World English Bible · Public domain':'King James Version · Public domain in the USA';
      $('credits').textContent=englishCredit+(state.language==='both'?' · '+originalCredit:'');
      $('readingHint').textContent=isMobile() ? 'Tap words to compare · Tap verses for notes' : 'Select a word to compare · Select a verse for notes';
      renderWordMatch();
      const first=$('passage').querySelector('a.verseLink[name]')?.getAttribute('name');
      state.position=selected || first;
      selectVerse(selected || first || data.osisId,false,true,state.notesScope);
      if (scroll) window.scrollTo({top:$('reading').offsetTop-180,behavior:'instant'});
      if (selected) {
        const a=[...$('passage').querySelectorAll('a.verseLink[name]')].find(a=>a.getAttribute('name')===selected);
        if (a && selected!==first) a.scrollIntoView({block:'center'});
      }
      persist();
    } catch (error) { if (token===state.request) message(error.message); }
    finally { if (token===state.request) $('passage').setAttribute('aria-busy','false'); }
  }
  function setTab(tab, render=true) {
    state.tab=tab;
    updateStudyReference();
    document.querySelectorAll('[data-tab]').forEach(el=>{el.setAttribute('aria-selected',String(el.dataset.tab===tab));el.tabIndex=el.dataset.tab===tab ? 0 : -1;});
    $('studyBody').setAttribute('aria-labelledby',`tab-${tab}`);$('noteControls').hidden=tab!=='notes';
    if(render)renderStudy();
  }
  const noteCache=new Map();
  function studyIsOpen(){return isMobile()?document.body.classList.contains('sheet-open'):state.study;}
  function sourceNotice(id){
    const source=state.registry?.[id];
    const attribution=source?.attribution || (source?.license ? source.license+' edition. Notes reflect this author’s interpretation.' : 'Source notices are retained in the local library.');
    return `<p class="study-source">${escape(attribution)}${source?.licenseUrl ? ` <a href="${escape(source.licenseUrl)}" target="_blank" rel="noreferrer">${escape(source.license)}</a>` : ''}</p>`;
  }
  function noteFor(id,ref){
    const key=id+'|'+ref;
    if(!noteCache.has(key)){
      const promise=api('bible','getBibleText',id,ref,'VN').then(data=>{
        const html=markup(data?.value);const temp=document.createElement('div');temp.innerHTML=html;temp.querySelectorAll('.verseNumber,.heading,.xgen,.notesPane,.verseLink').forEach(el=>el.remove());
        return temp.textContent.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim()?{html}:null;
      }).catch(error=>{if(error.kind==='engine-rejection')return null;noteCache.delete(key);return {failed:true};});
      noteCache.set(key,promise);
      if(noteCache.size>400)noteCache.delete(noteCache.keys().next().value);
    }
    return noteCache.get(key);
  }
  function notesReference() {
    return state.notesScope==='chapter' ? chapterReference(state.data?.osisId || state.reference) : state.selected;
  }
  function updateStudyReference() {
    const ref=state.tab==='notes'?notesReference():state.tab==='word'?(state.word?.reference || state.selected):state.selected;
    $('selectedReference').textContent=humanReference(ref,ref.replaceAll('.', ' '));
    $('chapterCommentary').setAttribute('aria-expanded',String(state.tab==='notes' && state.notesScope==='chapter' && studyIsOpen()));
  }
  async function renderStudy() {
    const token=++state.studyRequest;const body=$('studyBody');
    updateStudyReference();
    if(!studyIsOpen())return;
    if(state.tab!=='notes')$('studyBody').setAttribute('aria-busy','false');
    $('studyLabel').textContent=state.tab==='notes'?(state.notesScope==='chapter'?'Chapter commentary':'Verse commentary'):state.tab==='word'?'Word study':'Footnotes';
    if (state.tab==='word') {
      if (!state.word) { body.innerHTML='<p class="study-empty">Select an English, Hebrew or Greek word in the passage to see its available original-language definition.</p>';return; }
      const word=state.word;body.textContent='Opening word details…';
      try {
        const info=await api('module','getInfo',word.version,word.reference || state.selected,word.strong || ' ',' ','en');
        if (token!==state.studyRequest) return;
        const cards=(info?.vocabInfos || []).map(v=>`<article class="word-card"><p class="word-tag">${escape(v.strongNumber)}</p><p class="word-title" dir="auto">${escape(v.accentedUnicode)}</p>${pronunciationControl(v)}<p class="translit">${escape(plain(v.stepTransliteration))}</p><p class="word-gloss">${escape(plain(v.stepGloss || v.shortDef))}</p><div class="definition">${markup(v.briefDef || v.mediumDef || v.shortDef)}</div>${v.mediumDef && v.mediumDef!==v.briefDef ? `<details><summary>Full definition</summary><div class="definition">${markup(v.mediumDef)}</div></details>` : ''}</article>`);
        body.innerHTML=cards.join('') || '<p class="study-empty">No linked definition is available for this word in the installed data.</p>';
        if(word.addedLink)body.insertAdjacentHTML('afterbegin',`<p class="study-empty">${escape(word.addedLink)}</p>`);
        body.insertAdjacentHTML('beforeend','<p class="study-source">Original-language definitions supplied by the STEP engine. <a href="https://www.stepbible.org" target="_blank" rel="noreferrer">STEP Bible ↗</a></p>');
      } catch (e) { if (token===state.studyRequest) body.textContent=e.message; }
    } else if (state.tab==='footnotes') {
      const anchor=[...$('passage').querySelectorAll('a.verseLink[name]')].find(a=>a.getAttribute('name')===state.selected);
      const row=anchor?.closest('.verseGrouping,.solo-verse');
      const notes=row?.querySelectorAll('.inlineNote') || [];
      body.innerHTML=notes.length ? [...notes].map(n=>`<p>${markup(n.innerHTML)}</p>`).join('') : '<p class="study-empty">No attached footnotes are available for this verse in the selected edition.</p>';
    } else {
      const ref=notesReference();const scope=state.notesScope;
      const sources=state.commentaryCatalog.filter(source=>source.available && (!state.commentary || source.id===state.commentary));
      body.setAttribute('aria-busy','true');
      body.innerHTML=`<p class="study-empty">Opening ${scope==='chapter'?'chapter':'verse'} commentary…</p>`;
      const results=new Array(sources.length);let index=0;
      async function worker(){
        while(index<sources.length && token===state.studyRequest){const i=index++;results[i]=await noteFor(sources[i].id,ref);}
      }
      await Promise.all(Array.from({length:Math.min(4,sources.length)},worker));
      if(token!==state.studyRequest)return;
      body.replaceChildren();body.dataset.scope=scope;body.setAttribute('aria-busy','false');
      let shown=0,failed=0;
      sources.forEach((source,i)=>{
        const result=results[i];if(result?.failed){failed++;return;}if(!result)return;
        const article=document.createElement('article');article.className='commentary-entry';article.dataset.source=source.id;
        article.innerHTML=`<h2>${escape(source.title)}</h2><div class="commentary-text">${result.html}</div>${sourceNotice(source.id)}`;
        body.append(article);shown++;
      });
      const summary=document.createElement('p');summary.className='commentary-summary';
      summary.textContent=shown ? `${shown} ${shown===1?'source has':'sources have'} notes for ${humanReference(ref,ref)}.` : `No notes are available for this ${scope} in the selected sources.`;
      body.prepend(summary);
      if(!shown && failed===sources.length && sources.length)summary.textContent='The reader could not open these notes. Try again.';
      else if(failed){const warning=document.createElement('p');warning.className='study-empty';warning.textContent=`${failed} ${failed===1?'source could':'sources could'} not be opened. Select the source again to retry.`;body.prepend(warning);}
    }
  }

  function chapterReference(ref) {
    const parts=ref.split('-')[0].split('.');
    return state.books.find(b=>b.osisID===parts[0])?.wholeBook===false ? parts[0] : parts.slice(0,2).join('.');
  }
  function humanReference(ref,fallback) {
    const parts=ref.split('.');const book=state.books.find(b=>b.osisID===parts[0]);
    return book && !ref.includes('-') ? `${book.fullName} ${parts[1] || '1'}${parts[2]?':'+parts[2]:''}` : fallback;
  }
  function switchLanguage() {
    state.language=$('language').value;
    return read(state.reference,state.selected);
  }
  async function switchTranslation() {
    const old=state.translation, next=$('translation').value;message();
    try {
      const mapped=await api('bible','convertReferenceForBook',state.selected || state.reference,state.data?.masterVersion || old,next);
      state.translation=next;
      await read(chapterReference(mapped.osisKeyId),mapped.osisKeyId);
    } catch(e) { $('translation').value=old;message(e.message); }
  }
  async function search(event) {
    event.preventDefault(); const query=$('searchQuery').value.trim();if(!query)return;
    const token=++state.searchRequest;const version=state.translation;
    $('searchResults').textContent='Searching the installed text…';
    try {
      // Encode the user's text as a single engine token, not a second STEP command.
      const data=await api('search','masterSearch',`version=${version}|text=${query.replaceAll('|',' ')}`);
      if (token!==state.searchRequest) return;
      const results=data?.results || [];
      $('searchResults').replaceChildren();
      const summary=document.createElement('p');summary.textContent=`${data.total || 0} matches in ${labelFor(version)}${data.total>results.length ? ` · Showing the first ${results.length}` : ''}`;$('searchResults').append(summary);
      for(const item of results) {
        const ref=item.osisId || item.key || item.reference;
        const button=document.createElement('button');button.className='result';
        button.innerHTML=`<b>${escape(item.reference || item.key || ref)}</b><span>${escape(plain(item.preview || item.value || item.text || ''))}</span>`;
        button.addEventListener('click',()=>{$('searchDialog').close();read(chapterReference(String(ref)),ref);});$('searchResults').append(button);
      }
      if (!data.total) $('searchResults').append(document.createTextNode('Try another word or phrase. Search uses the installed edition’s index.'));
    } catch(e) { if (token===state.searchRequest) $('searchResults').textContent=e.message; }
  }
  function wire() {
    const toolbar=document.querySelector('.reader-toolbar');
    new ResizeObserver(()=>document.documentElement.style.setProperty('--toolbar-height',`${toolbar.getBoundingClientRect().height}px`)).observe(toolbar);
    $('book').onchange=()=>read(chapterReference(`${$('book').value}.1`));
    $('chapter').onchange=()=>read($('chapter').value);
    for(const dir of ['previous','next']) for(const id of [dir,`${dir}Bottom`]) $(id).onclick=()=>read(state.data?.[`${dir}Chapter`]?.osisKeyId);
    $('referenceForm').onsubmit=e=>{e.preventDefault();if($('reference').value.trim())read($('reference').value.trim());};
    $('translation').onchange=switchTranslation;
    $('extraEditions').onchange=()=>{state.extraEditions=$('extraEditions').checked;const choices=fillTranslations();if(!choices.some(m=>m.initials===state.translation))switchTranslation();persist();};
    $('language').onchange=switchLanguage;
    $('speakOnClick').onchange=()=>{
      state.speakOnClick=$('speakOnClick').checked;
      if(!state.speakOnClick)stopPronunciation();
      persist();
    };
    $('layout').onchange=()=>{state.layout=$('layout').value;applyDisplay();persist();};
    $('fontUp').onclick=()=>{state.font=Math.min(34,state.font+1);applyDisplay();persist();};
    $('fontDown').onclick=()=>{state.font=Math.max(20,state.font-1);applyDisplay();persist();};
    $('commentary').onchange=()=>{state.commentary=$('commentary').value;persist();renderStudy();};
    $('studyToggle').onclick=()=>state.study ? closeStudy() : openStudy();
    $('themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyDisplay();persist();};
    $('chapterCommentary').onclick=()=>{state.notesScope='chapter';setTab('notes',false);openStudy();};
    $('studyVisible').onchange=()=>{if($('studyVisible').checked)openStudy();else{state.study=false;document.body.classList.remove('sheet-open');applyDisplay();persist();}};
    $('studyClose').onclick=closeStudy;
    $('sheetHandle').onclick=()=>document.body.classList.contains('sheet-open') ? closeStudy() : openStudy();
    document.querySelectorAll('[data-tab]').forEach(el=>{
      el.onclick=()=>setTab(el.dataset.tab);
      el.onkeydown=e=>{if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(el),next=tabs[(i+(e.key==='ArrowRight'?1:2))%3];setTab(next.dataset.tab);next.focus();}};
    });
    $('passage').addEventListener('click',e=>{
      const word=e.target.closest('[strong]');
      if(word){
        const version=wordVersion(word);
        state.word={
          strong:lexicalTags(word), version, reference:verseReference(word),
          preferLexical:!isOriginal(version), addedLink:linkDescriptions[word.dataset.akjvLink],
        };
        state.pinnedWord=word;state.previewWord=null;renderWordMatch();
        if(state.tab==='word')renderStudy();
        if(state.speakOnClick) {
          const entry=comparisonAudioEntry(word);
          if(entry)playAudioEntry(entry);
          else stopPronunciation();
        }
        return;
      }
      const heading=e.target.closest('.verse-heading,.verseNumber');
      if(!heading)return;
      const ref=verseReference(heading);if(!ref)return;
      setTab('notes',false);selectVerse(ref,false,false);openStudy();
    });
    $('passage').addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const word=e.target.closest('[strong]');if(word){state.previewWord=word;renderWordMatch();}});
    $('passage').addEventListener('pointerout',e=>{if(e.pointerType==='touch')return;const next=e.relatedTarget?.closest?.('[strong]');state.previewWord=next?.closest('#passage')?next:null;renderWordMatch();});
    $('passage').addEventListener('focusin',e=>{const word=e.target.closest('[strong]');if(word){state.previewWord=word;renderWordMatch();}});
    $('passage').addEventListener('focusout',e=>{const next=e.relatedTarget?.closest?.('[strong]');state.previewWord=next?.closest('#passage')?next:null;renderWordMatch();});
    $('comparisonClear').onclick=clearWordMatch;
    $('comparisonPlay').onclick=()=>playAudioEntry(comparisonAudioEntry(state.pinnedWord));
    $('comparisonDetails').onclick=()=>{setTab('word',false);openStudy();};
    $('passage').addEventListener('keydown',e=>{if((e.key==='Enter' || e.key===' ') && e.target.matches('[strong],.verse-heading')){e.preventDefault();e.target.click();}});
    $('studyBody').addEventListener('click',e=>{const play=e.target.closest('[data-pronunciation]');if(play){playPronunciation(play.dataset.pronunciation);return;}const link=e.target.closest('[xref]');if(link?.getAttribute('xref')){e.preventDefault();read(link.getAttribute('xref'));if(isMobile())closeStudy();}});
    $('searchOpen').onclick=()=>{$('searchScope').textContent=`Search scope: ${labelFor(state.translation)}. Use quotation marks for an exact phrase.`;$('searchDialog').showModal();$('searchQuery').focus();};
    $('sourceLink').onclick=async e=>{
      e.preventDefault();$('sourceDialog').showModal();$('sourceBody').textContent='Opening edition information…';
      try {
        const registry=await (await fetch('/reader/library.json')).json();
        const ids=[state.translation,...(state.language!=='english'?[originalVersion()]:[]),...(state.commentary?[state.commentary]:state.commentaryCatalog.filter(s=>s.available).map(s=>s.id))];
        $('sourceBody').innerHTML=[...new Set(ids)].map(id=>{const r=registry[id];return r?`<article class=word-card><h3>${escape(r.name)}</h3><p>Module: ${escape(id)}${r.version ? ` · Version ${escape(r.version)}` : ''}</p><p>${escape(r.license)}</p>${r.attribution ? `<p>${escape(r.attribution)}</p>` : ''}<a href="${escape(r.source)}" target=_blank rel=noreferrer>Original source ↗</a></article>`:'';}).join('')+'<p>Texts and notes retain their own terms. The KJV module’s encoding is GPL; KJV text is public domain in the USA. Linguistic definitions are provided by STEP Bible, with notices retained under About.</p>';
      }catch(_){$('sourceBody').textContent='Edition information could not be opened. Source notices are retained in the project content folder.';}
    };
    $('sourceClose').onclick=()=>$('sourceDialog').close();
    $('searchClose').onclick=()=>{$('searchDialog').close();++state.searchRequest;};
    $('searchForm').onsubmit=search;
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){stopPronunciation();clearWordMatch();closeStudy();document.querySelector('.text-menu').open=false;}});
    // Remember the verse nearest the top without changing the selected study verse.
    let timer;window.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>{
      const rows=[...$('passage').querySelectorAll('.verseGrouping,.solo-verse')];const row=rows.find(el=>el.getBoundingClientRect().bottom>190);
      const ref=row?.querySelector('a.verseLink[name]')?.getAttribute('name');
      if(ref){try{const data=JSON.parse(localStorage.getItem(storageKey)||'{}');state.position=ref;data.position=ref;localStorage.setItem(storageKey,JSON.stringify(data));}catch(_){}}
    },180);},{passive:true});
  }
  function fillTranslations() {
    const preference=mainEditions;
    const labels={KJVish:'KJV-ish',KJV:'KJV',AKJVPlus:'AKJV (1999) + Strong’s',BSB:'BSB',engweb2025peb:'WEB (extra)'};
    const english=state.modules.filter(m=>m.category==='BIBLE' && m.languageCode==='en' && (state.extraEditions || mainEditions.includes(m.initials)));
    english.sort((a,b)=>(preference.indexOf(a.initials)<0?99:preference.indexOf(a.initials))-(preference.indexOf(b.initials)<0?99:preference.indexOf(b.initials)));
    $('translation').replaceChildren(...english.map(m=>option(m.initials,labels[m.initials] || m.name)));
    $('translation').value=english.some(m=>m.initials===state.translation)?state.translation:english[0]?.initials;
    return english;
  }
  function commentaryOption(source) {
    const o=option(source.id,source.title+(source.reuse?' *':''));
    const hints=[];
    if(source.reuse){
      hints.push(source.reuse.note);
      o.setAttribute('aria-label',source.title+'. '+source.reuse.note);
    }
    o.disabled=!source.available;
    if(!source.available)hints.push(source.kind==='dictionary'?'Dictionary: keyword lookup is not yet connected.':'Not installed locally.');
    if(hints.length)o.title=hints.join(' ');
    return o;
  }
  async function init() {
    applyDisplay();wire();
    try {
      state.modules=await api('module','getAllModules');
      try{state.registry=await (await fetch('/reader/library.json')).json();}catch(_){state.registry={};}
      const english=fillTranslations();
      if(!english.some(m=>m.initials===state.translation))state.translation=english[0]?.initials;
      if(!state.translation)throw new Error('No English Bible is installed. Run the local library setup first.');
      const catalog=await (await fetch('/reader/commentaries.json')).json();
      state.commentaryCatalog=catalog.map(source=>{const installed=state.modules.find(m=>source.ids.includes(m.initials) && m.category==='COMMENTARY');return {...source,id:installed?.initials || source.ids[0],available:!!installed && source.kind!=='dictionary'};});
      $('commentary').replaceChildren(option('','All available commentaries'),...state.commentaryCatalog.map(commentaryOption));
      if(!state.commentaryCatalog.some(source=>source.available && source.id===state.commentary))state.commentary='';
      $('commentary').value=state.commentary;
      state.books=await api('bible','getBibleBookNames',' ',state.translation);
      $('book').replaceChildren(...state.books.filter(b=>b.sectionType==='BIBLE_BOOK').map(b=>option(b.osisID,b.fullName)));
      await read(state.reference,hash.has('ref') ? '' : saved.position || saved.selected,false);
    } catch(e) {message(`${e.message} Make sure the STEP engine is running.`);$('chapterTitle').textContent='KJV-ish';$('passage').setAttribute('aria-busy','false');}
  }
  init();
})();
