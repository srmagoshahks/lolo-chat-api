let catalogoCache = { data: null, time: 0 };
const CACHE_MIN = 10;

async function getCatalogo() {
  const ahora = Date.now();
  if (catalogoCache.data && (ahora - catalogoCache.time) < CACHE_MIN * 60000) return catalogoCache.data;
  try {
    const res = await fetch('https://srmagoshahks.github.io/lolo-catalogo/');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const idx = html.indexOf('const PRODUCTOS = ');
    if (idx === -1) throw new Error('No se encontro PRODUCTOS');
    const js = html.indexOf('[', idx);
    let d = 0, je = -1;
    for (let i = js; i < html.length; i++) { if (html[i]==='[') d++; else if (html[i]===']') { d--; if (d===0) { je=i+1; break; } } }
    if (je===-1) throw new Error('JSON incompleto');
    const datos = JSON.parse(html.substring(js, je));
    catalogoCache = { data: datos, time: ahora };
    console.log('Catalogo OK: ' + datos.length);
    return datos;
  } catch (e) { console.error('Error catalogo:', e.message); return catalogoCache.data || []; }
}

const SYN = {
  'marcador':['fibra','pizarra','permanent','textil','sharpie','marker','resaltador','fluo','pincel'],
  'vaso':['termico','vidrio','acero','mate','cerveza','taza'],'termico':['vaso','mate','termo','botella'],
  'cuaderno':['anotador','libreta','nota'],'libreta':['cuaderno','anotador'],'anotador':['cuaderno','libreta'],
  'lapiz':['lapicera','birome','esfero'],'lapicera':['birome','esfero'],'birome':['lapicera'],
  'juguete':['juego'],'goma':['borrar'],'pegamento':['pasta','glue','stick'],
  'folder':['carpeta','porta'],'carpeta':['folder'],'mochila':['bolso'],
  'estuche':['cartuchera'],'cartuchera':['estuche'],'balsamo':['labial','lip'],
  'auricular':['bluetooth','manos libres','audio','inalambrico','wireless','earphone','headphone'],
  'parlante':['speaker','bocina','audio','bluetooth','wireless'],
  'cargador':['cable','usb','carga'],'cable':['cargador','usb'],
  'bt':['bluetooth','inalambrico','wireless','auricular'],
  'celular':['phone','smartphone','funda','case'],
  'funda':['case','celular','proteccion'],
};

function norm(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function searchProducts(query, catalogo) {
  if (!catalogo || !catalogo.length) return [];
  const qn = norm(query);
  const terms = qn.split(/[\s,\-\.]+/).filter(t => t.length > 1);
  if (!terms.length) return [];
  const all = new Set(terms);
  for (const t of terms) for (const [k,v] of Object.entries(SYN)) { const kn=norm(k); if (kn===t||kn.includes(t)||t.includes(kn)) v.forEach(s=>all.add(norm(s))); }
  const exp = [...all];
  return catalogo.map(p => {
    const nm = norm(p.nombre||''), ds = norm(p.descripcion||'');
    let sc = 0;
    for (const t of exp) { if (nm.includes(t)) sc+=5; if (ds.includes(t)) sc+=1; }
    if (nm.includes(qn)||qn.includes(nm)) sc+=50;
    sc += (p.fotos&&p.fotos.length>0)?500:0;
    return { p, sc };
  }).filter(s=>s.sc>0).sort((a,b)=>b.sc-a.sc).slice(0,20).map(s=>s.p);
}

function isFollowUp(msg, history) {
  if (!history||!history.length) return false;
  const m = msg.toLowerCase().trim();
  if (m.split(/\s+/).length <= 6) return true;
  const ind = ['recomend','caracteristic','especific','precio','calidad','stock','cual','cuanto',
    'tiene','como es','sobre ','ese','esa','otro','datos','info','detalle','ver','mostrar',
    'hay ','suger','compar','mejor','para que','sirve','funciona'];
  return ind.some(w => m.includes(w));
}

function isSpecsQuery(msg) {
  return /caracteristic|especific|detalle|como es|que tiene|que incluye|datos|info|para que sirve|funciona|descripcion/.test(norm(msg));
}

async function searchWeb(query) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 4000);
    const res = await fetch('https://api.duckduckgo.com/?q='+encodeURIComponent(query+' especificaciones caracteristicas')+'&format=json&no_html=1&skip_disambig=1', {signal:ctrl.signal});
    clearTimeout(t); const data = await res.json();
    let info = data.Abstract||'';
    if (data.RelatedTopics) info += ' ' + data.RelatedTopics.filter(r=>r.Text).map(r=>r.Text).slice(0,2).join(' ');
    return info.trim()||null;
  } catch(e) { return null; }
}

function pStr(p) {
  const pr = p.precio ? '$'+Number(p.precio).toLocaleString('es-AR') : '';
  return (p.nombre||'Sin nombre') + (pr?' - '+pr:'') + (p.descripcion?' | '+p.descripcion:'') + (p.stock!==undefined?' | stock:'+p.stock:'');
}

function fmt(p) { return { id:p.codigo||p.id, nombre:p.nombre||'Sin nombre', precio:Number(p.precio)||0, fotos:p.fotos||[] }; }

export default async function handler(req, res) {
  if (req.method==='OPTIONS') { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); return res.status(200).end(); }
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type');

  try {
    const { message, history } = req.body;
    if (!message) return res.status(200).json({reply:'Decime que buscas y te ayudo.',products:[]});
    const catalogo = await getCatalogo();
    if (!catalogo.length) return res.status(200).json({reply:'El catalogo no esta disponible ahora. Proba en unos minutos.',products:[]});

    const followUp = isFollowUp(message, history);
    let ctx = [];
    const seen = new Set();

    if (followUp && history) {
      const htxt = history.slice(-8).map(m=>m.text||'').join(' ');
      const hp = searchProducts(htxt, catalogo);
      hp.forEach(p=>{ if(!seen.has(p.codigo||p.id)){ctx.push(p);seen.add(p.codigo||p.id);} });
      const cm = searchProducts(message, catalogo);
      cm.forEach(p=>{ if(!seen.has(p.codigo||p.id)){ctx.push(p);seen.add(p.codigo||p.id);} });
    } else {
      const cm = searchProducts(message, catalogo);
      cm.forEach(p=>{ ctx.push(p); seen.add(p.codigo||p.id); });
      if (history) {
        const htxt = history.slice(-4).map(m=>m.text||'').join(' ');
        const hp = searchProducts(htxt, catalogo);
        hp.forEach(p=>{ if(!seen.has(p.codigo||p.id)){ctx.push(p);seen.add(p.codigo||p.id);} });
      }
    }
    ctx = ctx.slice(0,15);

    let webInfo = '';
    if (isSpecsQuery(message) && ctx.length > 0) {
      const wi = await searchWeb(ctx[0].nombre || message);
      if (wi) webInfo = '\n\nINFO DE INTERNET sobre "'+ctx[0].nombre+'":\n'+wi+'\n\nAclara que para datos exactos del modelo en stock consulte al vendedor.';
    }

    const prodList = ctx.slice(0,12).map((p,i)=>(i+1)+'. '+pStr(p)).join('\n');

    const sysPrompt = 'Sos Lolo, asistente virtual de una tienda que vende todo tipo de productos (bazar, libreria, jugueteria, electronica, hogar y mas). Ayudas a los clientes a encontrar lo que necesitan.\n\n' +
      'REGLAS:\n' +
      '1. La lista de PRODUCTOS DISPONIBLES tiene los productos en stock. Respondé sobre esos productos.\n' +
      '2. Si el cliente pregunta sobre algo que NO tiene NADA que ver con ningun producto de la tienda (ej: formulas de fisica, recetas de cocina, programacion), deci que sos el asistente de la tienda y no podes ayudar con eso. PERO si es un producto que la tienda podria tener (electronica, utiles, hogar, etc) y esta en la lista, respondé normalmente.\n' +
      '3. NUNCA digas "no tengo opciones" ni "catalogo vacio". NUNCA inventes productos fuera de la lista.\n' +
      '4. Si es una seguimiento de la conversacion (preguntan sobre algo que ya salio), respondé sobre esos productos.\n' +
      '5. Si preguntan por caracteristicas y hay INFO DE INTERNET, usala para responder. Si no la hay, usá tu conocimiento general sobre ese tipo de producto pero aclará que son caracteristicas generales y que para confirmar consulte al vendedor.\n' +
      '6. Si dan a elegir, recomendá segun lo que piden.\n' +
      '7. Respuestas naturales de 2-4 lineas. Profesional pero amable.\n' +
      '8. NUNCA muestres JSON ni formato tecnico al cliente.\n\n' +
      'PRODUCTOS DISPONIBLES:\n' + prodList + webInfo;

    const msgs = [{ role:'system', content:sysPrompt }];
    if (history && Array.isArray(history)) {
      for (const m of history.slice(-8)) {
        if (!m.text) continue;
        msgs.push({ role: m.role==='user'?'user':'assistant', content:m.text });
      }
    }
    msgs.push({ role:'user', content:message });

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({ model:'llama-3.3-70b-versatile', messages:msgs, temperature:0.5, max_tokens:500 })
    });
    if (!groqRes.ok) return res.status(200).json({reply:'Tuve un problema de conexion. Proba de nuevo.',products:[]});
    const data = await groqRes.json();
    if (data.error) return res.status(200).json({reply:'Tuve un problema de conexion. Proba de nuevo.',products:[]});
    const reply = (data.choices&&data.choices[0]&&data.choices[0].message)?data.choices[0].message.content:'Proba de nuevo.';

    const products = ctx.slice(0,5).map(p=>fmt(p));
    return res.status(200).json({ reply, products });
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).json({reply:'Tuve un problema de conexion. Proba de nuevo.',products:[]});
  }
}