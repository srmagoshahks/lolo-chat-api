let catalogoCache = { data: null, time: 0 };
const CACHE_MIN = 10;

async function getCatalogo() {
  const ahora = Date.now();
  if (catalogoCache.data && (ahora - catalogoCache.time) < CACHE_MIN * 60000) {
    return catalogoCache.data;
  }
  try {
    console.log('Actualizando catalogo desde GitHub Pages...');
    const res = await fetch('https://srmagoshahks.github.io/lolo-catalogo/');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const idx = html.indexOf('const PRODUCTOS = ');
    if (idx === -1) throw new Error('No se encontro PRODUCTOS');
    const jsonStart = html.indexOf('[', idx);
    let profundidad = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '[') profundidad++;
      else if (html[i] === ']') { profundidad--; if (profundidad === 0) { jsonEnd = i + 1; break; } }
    }
    if (jsonEnd === -1) throw new Error('JSON incompleto');
    const datos = JSON.parse(html.substring(jsonStart, jsonEnd));
    catalogoCache = { data: datos, time: ahora };
    console.log('Catalogo OK: ' + datos.length + ' productos');
    return datos;
  } catch (e) {
    console.error('Error cargando catalogo:', e.message);
    return catalogoCache.data || [];
  }
}

const SYNONYMS = {
  'marcador': ['fibra', 'pizarra', 'permanent', 'textil', 'sharpie', 'marker', 'pincel', 'resaltador', 'fluo'],
  'vaso': ['termico', 'vidrio', 'acero', 'mate', 'cerveza', 'taza', 'jarro'],
  'termico': ['vaso', 'mate', 'termo', 'botella'],
  'cuaderno': ['anotador', 'libreta', 'nota', 'kraft'],
  'libreta': ['cuaderno', 'anotador'],
  'anotador': ['cuaderno', 'libreta'],
  'lapiz': ['lapicera', 'birome', 'esfero', 'grafito'],
  'lapicera': ['birome', 'esfero'],
  'birome': ['lapicera', 'esfero'],
  'juguete': ['juego'],
  'tijera': ['corta'],
  'goma': ['borrar', 'borra'],
  'pegamento': ['pasta', 'glue', 'stick'],
  'folder': ['carpeta', 'porta'],
  'carpeta': ['folder', 'porta'],
  'mochila': ['bolso'],
  'estuche': ['portalapiz', 'cartuchera'],
  'cartuchera': ['estuche', 'portalapiz'],
};

function searchProducts(query, catalogo) {
  if (!catalogo || catalogo.length === 0) return [];
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = norm(query).split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return [];
  const allTerms = new Set(terms);
  for (const term of terms) {
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      if (norm(key).includes(term) || term.includes(norm(key))) {
        syns.forEach(s => allTerms.add(norm(s)));
      }
    }
  }
  const expanded = [...allTerms];
  const scored = catalogo.map(p => {
    const name = norm(p.nombre || '');
    const desc = norm(p.descripcion || '');
    let score = 0;
    for (const t of expanded) {
      if (name.includes(t)) score += 5;
      if (desc.includes(t)) score += 1;
    }
    return { product: p, score };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 25).map(s => s.product);
}

function fmt(p) {
  const nombre = p.nombre || 'Sin nombre';
  const precio = p.precio ? '$' + Number(p.precio).toLocaleString('es-AR') : '';
  const foto = (p.fotos && p.fotos.length > 0) ? p.fotos[0] : '';
  return { id: p.codigo || p.id, nombre, precio, foto };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { message } = req.body;
    if (!message) return res.status(200).json({ reply: 'Mandame un mensaje y te ayudo! Que buscas, che?', products: [] });

    const catalogo = await getCatalogo();
    console.log('Mensaje: "' + message + '" | Catalogo: ' + catalogo.length);

    const matched = searchProducts(message, catalogo);
    console.log('Encontrados: ' + matched.length);

    let productInfo = '';
    if (matched.length > 0) {
      productInfo = 'PRODUCTOS DEL CATALOGO:\n' +
        matched.map((p, i) => {
          const f = fmt(p);
          return (i + 1) + '. ' + f.nombre + (f.precio ? ' - ' + f.precio : '') + (f.foto ? ' [FOTO]' : '');
        }).join('\n');
    } else {
      productInfo = 'No hay productos que coincidan exactamente.';
    }

    const systemPrompt = 'Sos Lolo, el asistente de un bazar/libreria/jugueteria en Argentina. Tu logo es una bolsita en un monopatin. Hablas en argentino con "che", "vos", "re", "dale", "mira".\n\n' +
      'REGLAS:\n' +
      '1. RESPONDE SOLO sobre productos de la tienda. Si preguntan sobre fisica, matematica, ciencia, programacion o cualquier tema fuera del bazar, deci: "Che, yo soy Lolo de la libreria, de eso no se nada! Pero si necesitas algo para el hogar, utiles o juguetes, preguntame!"\n' +
      '2. NUNCA digas "catalogo vacio" ni "no tengo productos". Siempre hay productos.\n' +
      '3. Menciona hasta 5 productos por nombre y precio de la lista de PRODUCTOS DEL CATALOGO.\n' +
      '4. Si no hay coincidencias exactas, sugerir similares de la lista.\n' +
      '5. Respuestas CORTAS, 2-4 lineas maximo.\n' +
      '6. NUNCA muestres JSON ni formato tecnico. Habla como un vendedor.\n\n' +
      productInfo;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        temperature: 0.7, max_tokens: 400
      })
    });

    if (!groqRes.ok) return res.status(200).json({ reply: 'Ups, tuve un problemita de conexion. Proba de nuevo, che.', products: [] });
    const data = await groqRes.json();
    if (data.error) return res.status(200).json({ reply: 'Ups, tuve un problemita de conexion. Proba de nuevo, che.', products: [] });

    const reply = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : 'Proba de nuevo, che.';

    const products = matched.slice(0, 5).map(p => fmt(p));
    return res.status(200).json({ reply, products });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).json({ reply: 'Ups, tuve un problemita de conexion. Proba de nuevo, che.', products: [] });
  }
}