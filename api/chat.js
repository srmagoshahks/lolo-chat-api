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
  'marcador':['fibra','pizarra','permanent','textil','sharpie','marker','resaltador','fluo'],
  'vaso':['termico','vidrio','acero','mate','cerveza','taza'],'termico':['vaso','mate','termo','botella'],
  'cuaderno':['anotador','libreta','nota'],'libreta':['cuaderno','anotador'],'anotador':['cuaderno','libreta'],
  'lapiz':['lapicera','birome','esfero'],'lapicera':['birome','esfero'],'birome':['lapicera'],
  'juguete':['juego'],'goma':['borrar'],'pegamento':['pasta','glue','stick'],
  'folder':['carpeta','porta'],'carpeta':['folder'],'mochila':['bolso'],
  'estuche':['cartuchera'],'cartuchera':['estuche'],'balsamo':['labial','lip'],
  'auricular':['bluetooth','manos libres','audio'],'parlante':['speaker','bocina','audio'],
  'cargador':['cable','usb'],'cable':['cargador','usb'],
};

function norm(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function searchProducts(query, catalogo) {
  if (!catalogo || !catalogo.length) return [];
  const qn = norm(query);
  const terms = qn.split(/[\s,\-\.]+/).filter(t=>t.length>2);
  if (!terms.length) return [];
  const all = new Set(terms);
  for (const t of terms) for (const [k,v] of Object.entries(SYN)) { const kn=norm(k); if (kn.includes(t)||t.includes(kn)) v.forEach(s=>all.add(norm(s))); }
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
  const m = norm(msg);
  const pats = [/^cual/,/recomend/,/^que me/,/el primero/,/la primera/,/^otro/,/sobre (el|la|eso|ese)/,
    /caracteristic/,/especific/,/detalle/,/como es/,/que tiene/,/precio/,/calidad/,/^ver/,/^mostrar/,
    /^cuanto/,/^hay /,/stock/,/suger/,/compar/,/mejor/];
  return pats.some(p=>p.test(m));
}

function isSpecsQuery(msg) {
  const m = norm(msg);
  return /caracteristic|especific|detalle|funciona|como es|que tiene|que incluye|descripcion|info|para que sirve/.test(m);
}

async function searchWeb(query) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 4000);
    const res = await fetch('https://api.duckduckgo.com/?q='+encodeURIComponent(query)+' especificaciones&format=json&no_html=1&skip_disambig=1', {signal:ctrl.signal});
    clearTimeout(t);
    const data = await res.json();
    let info = '';
    if (data.Abstract) info = data.Abstract;
    if (data.RelatedTopics) info += ' ' + data.RelatedTopics.filter(r=>r.Text).map(r=>r.Text).slice(0,2).join(' ');
    return info.trim()||null;
  } catch(e) { return null; }
}

function pStr(p) {
  const pr = p.precio ? '$'+Number(p.precio).toLocaleString('es-AR') : '';
  const ft = (p.fotos&&p.fotos.length>0) ? '' : ' [SIN FOTO]';
  return (p.nombre||'Sin nombre') + (pr?' - '+pr:'') + ft + (p.descripcion?' | '+p.descripcion:'') + (p.stock!==undefined?' | stock:'+p.stock:'');
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
    let contextProducts;
    const seen = new Set();

    if (followUp && history) {
      const htxt = history.slice(-6).map(m=>m.text||'').join(' ');
      contextProducts = searchProducts(htxt, catalogo);
      contextProducts.forEach(p=>seen.add(p.codigo||p.id));
      const cm = searchProducts(message, catalogo);
      cm.forEach(p=>{ if(!seen.has(p.codigo||p.id)){contextProducts.push(p);seen.add(p.codigo||p.id);} });
    } else {
      contextProducts = searchProducts(message, catalogo);
      contextProducts.forEach(p=>seen.add(p.codigo||p.id));
      if (history) {
        const htxt = history.slice(-4).map(m=>m.text||'').join(' ');
        const hp = searchProducts(htxt, catalogo);
        hp.forEach(p=>{ if(!seen.has(p.codigo||p.id)){contextProducts.push(p);seen.add(p.codigo||p.id);} });
      }
    }
    contextProducts = contextProducts.slice(0,15);

    const specQ = isSpecsQuery(message);
    let webInfo = '';
    if (specQ && contextProducts.length > 0) {
      const topName = contextProducts[0].nombre || message;
      const wi = await searchWeb(topName);
      if (wi) webInfo = '\n\nINFORMACION DE INTERNET sobre "'+topName+'":\n'+wi+'\n\nNota: esta info es de internet. Siempre recomenda consultar al vendedor para datos exactos del producto que tienen en stock.';
    }

    const prodList = contextProducts.slice(0,12).map((p,i)=>(i+1)+'. '+pStr(p)).join('\n');

    const systemPrompt = 'Sos Lolo, asistente virtual de un bazar/libreria/jugueteria en Argentina.\n\n' +
      'REGLAS ESTRICTAS:\n' +
      '1. Si el cliente pregunta sobre algo que NO es del bazar (fisica, ciencia, programacion), responde que sos el asistente de la libreria y no podes ayudar con eso.\n' +
      '2. NUNCA digas "no tengo opciones" ni "catalogo vacio". Siempre hay productos.\n' +
      '3. NUNCA inventes productos que no esten en la lista de abajo.\n' +
      '4. Si preguntan sobre un producto especifico que ya salio en la conversacion, respondé sobre ESE producto usando los datos de la lista.\n' +
      '5. Si preguntan por caracteristicas o especificaciones y hay info de internet, usala pero siempre aclará que para datos exactos consulte al vendedor.\n' +
      '6. Si preguntan por caracteristicas y NO hay info de internet, usá tu conocimiento general sobre ese tipo de producto pero aclará que son caracteristicas generales y que consulte al vendedor para confirmar.\n' +
      '7. Si dan a elegir, recomendá el mejor segun lo que piden (precio, calidad, etc) basandote en los datos de la lista.\n' +
      '8. Respuestas naturales de 2-4 lineas. Habla como un vendedor que atiende bien.\n' +
      '9. NUNCA muestres JSON ni formato tecnico.\n\n' +
      'PRODUCTOS DISPONIBLES:\n' + prodList + webInfo;

    const groqMsgs = [{ role:'system', content:systemPrompt }];
    if (history && Array.isArray(history)) {
      for (const m of history.slice(-8)) {
        if (!m.text) continue;
        groqMsgs.push({ role: m.role==='user'?'user':'assistant', content:m.text });
      }
    }
    groqMsgs.push({ role:'user', content:message });

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({ model:'llama-3.3-70b-versatile', messages:groqMsgs, temperature:0.5, max_tokens:500 })
    });
    if (!groqRes.ok) return res.status(200).json({reply:'Tuve un problema de conexion. Proba de nuevo.',products:[]});
    const data = await groqRes.json();
    if (data.error) return res.status(200).json({reply:'Tuve un problema de conexion. Proba de nuevo.',products:[]});
    const reply = (data.choices&&data.choices[0]&&data.choices[0].message)?data.choices[0].message.content:'Proba de nuevo.';

    const products = contextProducts.slice(0,5).map(p=>fmt(p));
    return res.status(200).json({ reply, products });
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).json({reply:'Tuve un problema de conexion. Proba de nuevo.',products:[]});
  }
}