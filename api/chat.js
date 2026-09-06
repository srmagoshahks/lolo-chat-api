const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ['AQ','.Ab8RN6IaGSv','-p-5hRekEgS','-Y0h9i_Vl9EAIsAAgc7','_MzFudheQ'].join('');
const FISH_API_KEY = process.env.FISH_API_KEY || 'sk-fish-hOkt-ygUcJA9d3fkmwhW6XS4tvX0eEAjvLhAdq6yG40';
const FISH_VOICE_ID = process.env.FISH_VOICE_ID || 'ee0b71b2b92343fa8792d3e34709e2c0';
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
  'bici':['bicicleta','playera','mountain','rodado'],
  'bicicleta':['bici','playera','mountain','rodado']
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
  }).filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .map(x => x.p);
}

function fmt(p) {
  let foto = '';
  if (p.fotos && p.fotos.length) foto = p.fotos[0];
  else if (p.foto) foto = p.foto;
  return {
    id: p.id,
    codigo: p.codigo || '',
    nombre: p.nombre,
    precio: p.precio,
    rubro: p.rubro,
    foto: foto,
    fotos: p.fotos || [],
    en_oferta: !!p.en_oferta,
    descuento_pct: p.descuento_pct || 0,
    descripcion: p.descripcion || ''
  };
}

async function generarAudioFish(texto) {
  if (!texto || !FISH_API_KEY || !FISH_VOICE_ID) return '';
  try {
    const clean = texto
      .replace(/ID:\s*\d+/gi, '')
      .replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/\$([\d\.]+)/g, '$1 pesos')
      .replace(/[*_#`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return '';

    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FISH_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: clean,
        reference_id: FISH_VOICE_ID,
        format: 'mp3'
      })
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return { b64: buffer.toString('base64'), error: null };
    } else {
      const errText = await res.text();
      return { b64: '', error: `HTTP ${res.status}: ${errText}` };
    }
  } catch (e) {
    return { b64: '', error: e.message };
  }
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'online', model: 'gemini-flash-lite-latest', voice: 'fish-audio-clon' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }

  const msgClean = message.trim().toLowerCase().replace(/[^\w\s]/g, '');
  const saludos = ['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola lolo', 'hola que tal', 'holis', 'hey'];

  if (saludos.includes(msgClean)) {
    const replyTxt = '¡Hola! 🛹 Bienvenido a LOLO Sobre Ruedas. Estoy acá para ayudarte a encontrar el regalo o producto ideal. Podés escribirme o tocar el micrófono 🎙️ para hablarme directo. ¿Qué estás buscando hoy?';
    const audioRes = await generarAudioFish(replyTxt);
    return res.status(200).json({
      reply: replyTxt,
      products: [],
      audio_b64: audioRes.b64,
      audio_error: audioRes.error
    });
  }

  try {
    const catalogo = await getCatalogo();
    const matchedProducts = searchProducts(message, catalogo);

    let prodsContext = '';
    if (matchedProducts.length > 0) {
      prodsContext = 'PRODUCTOS DISPONIBLES EN STOCK RELACIONADOS:\n' +
        matchedProducts.slice(0, 6).map(p =>
          `- ${p.nombre} | Rubro: ${p.rubro} | Precio: $${p.precio} | Desc: ${p.descripcion || 'Sin desc'}`
        ).join('\n');
    } else {
      prodsContext = 'No se encontraron productos exactos para esa búsqueda específica.';
    }

    const systemPrompt = `Eres LOLO, el Asesor de Ventas oficial de la tienda "LOLO Sobre Ruedas" (Bazar, Librería, Juguetería, Tecnología, Hogar y Rodados).
Tu misión es asesorar amablemente a los clientes con respuestas concisas, cálidas y comerciales (máximo 2 a 3 oraciones).
Usa español de Argentina educado (vos, te cuento, tenemos, mirá). No uses "che".

${prodsContext}

Si hay productos disponibles, menciónalos de forma natural y atractiva destacando su precio.
Si el cliente quiere comprar o consultar disponibilidad, invítalo a tocar el producto en pantalla o escribirnos por WhatsApp al 3455-541097.`;

    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history.slice(-6)) {
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.text || '' }]
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 250
        }
      })
    });

    let reply = '¡Hola! En LOLO Sobre Ruedas tenemos una gran variedad de productos. ¿Qué estás buscando hoy?';
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

    // Generar la voz clonada con Fish Audio
    const audioRes = await generarAudioFish(reply);

    return res.status(200).json({
      reply: reply,
      products: products,
      audio_b64: audioRes.b64,
      audio_error: audioRes.error
    });

  } catch (err) {
    console.error('Error in chat handler:', err.message);
    const fallbackTxt = 'Disculpame, tuve una pequeña demora de conexión. Si necesitás algo urgente, podés consultarnos directamente por WhatsApp.';
    const audioRes = await generarAudioFish(fallbackTxt);
    return res.status(200).json({
      reply: fallbackTxt,
      products: [],
      audio_b64: audioRes.b64,
      audio_error: audioRes.error
    });
  }
}
