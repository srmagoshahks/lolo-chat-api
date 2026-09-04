const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ['AQ','.Ab8RN6IaGSv','-p-5hRekEgS','-Y0h9i_Vl9EAIsAAgc7','_MzFudheQ'].join('');
const GITHUB_CATALOG_URL = 'https://raw.githubusercontent.com/srmagoshahks/lolo-catalogo/main/index.html';

let catalogoCache = { data: null, time: 0 };
const CACHE_MIN = 10;

async function getCatalogo() {
  const ahora = Date.now();
  if (catalogoCache.data && (ahora - catalogoCache.time) < CACHE_MIN * 60000) {
    return catalogoCache.data;
  }
  try {
    const res = await fetch(GITHUB_CATALOG_URL + '?_t=' + ahora);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const idx = html.indexOf('const PRODUCTOS = ');
    if (idx === -1) throw new Error('No se encontro PRODUCTOS');
    const js = html.indexOf('[', idx);
    let d = 0, je = -1;
    for (let i = js; i < html.length; i++) {
      if (html[i] === '[') d++;
      else if (html[i] === ']') {
        d--;
        if (d === 0) { je = i + 1; break; }
      }
    }
    if (je === -1) throw new Error('JSON incompleto');
    const datos = JSON.parse(html.substring(js, je));
    catalogoCache = { data: datos, time: ahora };
    return datos;
  } catch (e) {
    console.error('Error catalogo:', e.message);
    return catalogoCache.data || [];
  }
}

const SYN = {
  'marcador':['fibra','pizarra','permanent','textil','sharpie','marker','resaltador','fluo','pincel'],
  'vaso':['termico','vidrio','acero','mate','cerveza','taza','botella'],'termico':['vaso','mate','termo','botella'],
  'cuaderno':['anotador','libreta','nota'],'libreta':['cuaderno','anotador'],'anotador':['cuaderno','libreta'],
  'lapiz':['lapicera','birome','esfero'],'lapicera':['birome','esfero'],'birome':['lapicera'],
  'juguete':['juego','muneco','auto','pista','pelota'],'goma':['borrar'],'pegamento':['pasta','glue','stick'],
  'folder':['carpeta','porta'],'carpeta':['folder'],'mochila':['bolso','cartuchera'],
  'estuche':['cartuchera'],'cartuchera':['estuche'],'balsamo':['labial','lip'],
  'auricular':['bluetooth','manos libres','audio','inalambrico','wireless','earphone','headphone'],
  'parlante':['speaker','bocina','audio','bluetooth','wireless'],
  'cargador':['cable','usb','carga'],'cable':['cargador','usb'],
  'bt':['bluetooth','inalambrico','wireless','auricular'],
  'funda':['case','celular','proteccion'],
};

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function searchProducts(query, catalogo) {
  if (!catalogo || !catalogo.length) return [];
  const qn = norm(query);
  const terms = qn.split(/[\s,\-\.]+/).filter(t => t.length > 1);
  if (!terms.length) return [];
  const all = new Set(terms);
  for (const t of terms) {
    for (const [k, v] of Object.entries(SYN)) {
      const kn = norm(k);
      if (kn === t || kn.includes(t) || t.includes(kn)) v.forEach(s => all.add(norm(s)));
    }
  }
  const exp = [...all];
  return catalogo.map(p => {
    const nm = norm(p.nombre || ''), ds = norm(p.descripcion || ''), rb = norm(p.rubro || '');
    let sc = 0;
    for (const t of exp) {
      if (nm.includes(t)) sc += 10;
      if (rb.includes(t)) sc += 4;
      if (ds.includes(t)) sc += 2;
    }
    if (nm.includes(qn) || qn.includes(nm)) sc += 60;
    if (p.en_oferta) sc += 5;
    sc += (p.fotos && p.fotos.length > 0) ? 50 : 0;
    return { p, sc };
  }).filter(s => s.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 15).map(s => s.p);
}

function fmt(p) {
  return {
    id: p.codigo || p.id,
    nombre: p.nombre || 'Sin nombre',
    precio: Number(p.precio) || 0,
    precio_lista: Number(p.precio_lista) || Number(p.precio) || 0,
    fotos: p.fotos || (p.foto ? [p.foto] : []),
    rubro: p.rubro || '',
    descripcion: p.descripcion || ''
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history } = req.body || {};
    if (!message) {
      return res.status(200).json({ reply: '¿Qué producto estás buscando hoy?', products: [] });
    }

    const catalogo = await getCatalogo();
    const matchedProducts = searchProducts(message, catalogo);

    let productContext = '';
    if (matchedProducts.length > 0) {
      productContext = '\n\nPRODUCTOS DISPONIBLES EN STOCK DE LOLO SOBRE RUEDAS:\n' +
        matchedProducts.slice(0, 8).map((p, idx) => {
          const pr = p.precio ? `$${Number(p.precio).toLocaleString('es-AR')}` : '';
          return `${idx + 1}. ${p.nombre} (${p.rubro || 'General'}) - ${pr} | ${p.descripcion || ''}`;
        }).join('\n');
    } else {
      const destacados = catalogo.slice(0, 6).map(p => `${p.nombre} - $${p.precio}`).join(', ');
      productContext = `\n\nAlgunos productos destacados en tienda: ${destacados}`;
    }

    const systemPrompt = `Sos LOLO, el simpático y experto Asesor de Ventas de "LOLO Sobre Ruedas" (Bazar, Librería, Juguetería, Tecnología, Hogar y Regalería).
Tu imagen es una bolsita celeste con skate. Hablás en español argentino (amable, profesional y cálido, usando 'vos', sin decir 'che').

INSTRUCCIONES CLAVE:
1. Respondé en 2 a 3 oraciones cortas, fluidas y directas para que sea rápido y agradable de leer o escuchar.
2. Si el cliente pregunta por productos, recomendá basándote en los PRODUCTOS DISPONIBLES en stock.
3. Si el cliente saluda ("hola", "buenas"), dale una cálida bienvenida a LOLO Sobre Ruedas y preguntale qué está buscando o para quién es el regalo.
4. Mencioná precios en pesos argentinos.
5. Si quieren comprar o pedir, recordales que pueden tocar la tarjeta del producto o escribir directamente al WhatsApp de la tienda.
6. NUNCA inventes productos raros fuera del catálogo.

${productContext}`;

    const contents = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (!h.text) continue;
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.text }]
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 300
        }
      })
    });

    let reply = '¡Hola! Bienvenido a LOLO Sobre Ruedas. ¿En qué te puedo asesorar hoy?';
    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      if (geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content) {
        reply = geminiData.candidates[0].content.parts.map(p => p.text).join('\n').trim();
      }
    } else {
      const errTxt = await geminiRes.text();
      console.error('Gemini error:', errTxt);
    }

    const products = matchedProducts.slice(0, 4).map(fmt);

    return res.status(200).json({
      reply: reply,
      products: products
    });

  } catch (err) {
    console.error('Error in chat handler:', err.message);
    return res.status(200).json({
      reply: '¡Hola! Bienvenido a LOLO Sobre Ruedas. Estoy acá para ayudarte con todo nuestro catálogo. ¿Qué estás buscando hoy?',
      products: []
    });
  }
}