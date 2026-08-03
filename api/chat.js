let catalogoCache = { data: null, time: 0 };
const CACHE_MIN = 10;

async function getCatalogo() {
  const ahora = Date.now();
  if (catalogoCache.data && (ahora - catalogoCache.time) < CACHE_MIN * 60000) {
    return catalogoCache.data;
  }
  try {
    console.log('Actualizando catalogo...');
    const res = await fetch('https://srmagoshahks.github.io/lolo-catalogo/');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const idx = html.indexOf('const PRODUCTOS = ');
    if (idx === -1) throw new Error('No se encontro PRODUCTOS');
    const jsonStart = html.indexOf('[', idx);
    let depth = 0, jsonEnd = -1;
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '[') depth++;
      else if (html[i] === ']') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
    }
    if (jsonEnd === -1) throw new Error('JSON incompleto');
    const datos = JSON.parse(html.substring(jsonStart, jsonEnd));
    catalogoCache = { data: datos, time: ahora };
    console.log('Catalogo OK: ' + datos.length + ' productos');
    return datos;
  } catch (e) {
    console.error('Error catalogo:', e.message);
    return catalogoCache.data || [];
  }
}

const SYNONYMS = {
  'marcador': ['fibra', 'pizarra', 'permanent', 'textil', 'sharpie', 'marker', 'resaltador', 'fluo'],
  'vaso': ['termico', 'vidrio', 'acero', 'mate', 'cerveza', 'taza'],
  'termico': ['vaso', 'mate', 'termo', 'botella'],
  'cuaderno': ['anotador', 'libreta', 'nota', 'kraft'],
  'libreta': ['cuaderno', 'anotador'],
  'anotador': ['cuaderno', 'libreta'],
  'lapiz': ['lapicera', 'birome', 'esfero', 'grafito'],
  'lapicera': ['birome', 'esfero'],
  'juguete': ['juego'],
  'goma': ['borrar', 'borra'],
  'pegamento': ['pasta', 'glue', 'stick'],
  'folder': ['carpeta', 'porta'],
  'carpeta': ['folder', 'porta'],
  'mochila': ['bolso'],
  'estuche': ['portalapiz', 'cartuchera'],
  'balsamo': ['labial', 'carmex', 'lip'],
  'auricular': ['manos libres', 'bluetooth', 'audio', 'speaker'],
  'cargador': ['carga', 'usb', 'cable'],
  'parlante': ['speaker', 'audio', 'bluetooth', 'bocina'],
};

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function searchProducts(query, catalogo) {
  if (!catalogo || catalogo.length === 0) return [];
  const queryNorm = norm(query);
  const terms = queryNorm.split(/[\s,\-\.]+/).filter(t => t.length > 2);
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
    if (name.includes(queryNorm) || queryNorm.includes(name)) score += 50;
    const tieneFoto = (p.fotos && p.fotos.length > 0) ? 500 : 0;
    return { product: p, score: score + tieneFoto };
  });

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 20).map(s => s.product);
}

function findProductByName(name, catalogo) {
  const nameNorm = norm(name);
  return catalogo.find(p => norm(p.nombre || '') === nameNorm) ||
         catalogo.find(p => norm(p.nombre || '').includes(nameNorm)) ||
         null;
}

function productToString(p) {
  const precio = p.precio ? '$' + Number(p.precio).toLocaleString('es-AR') : '';
  const foto = (p.fotos && p.fotos.length > 0) ? ' | foto: si' : ' | foto: no';
  return (p.nombre || 'Sin nombre') + (precio ? ' - ' + precio : '') + foto +
    (p.descripcion ? ' | ' + p.descripcion : '') +
    (p.stock !== undefined ? ' | stock: ' + p.stock : '');
}

function fmt(p) {
  return {
    id: p.codigo || p.id,
    nombre: p.nombre || 'Sin nombre',
    precio: Number(p.precio) || 0,
    fotos: p.fotos || []
  };
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
    const { message, history } = req.body;
    if (!message) return res.status(200).json({ reply: 'Decime que buscas y te ayudo.', products: [] });

    const catalogo = await getCatalogo();
    console.log('Msg: "' + message + '" | Cat: ' + catalogo.length + ' | History: ' + (history ? history.length : 0));

    if (catalogo.length === 0) {
      return res.status(200).json({ reply: 'El catalogo no esta disponible en este momento. Proba de nuevo en unos minutos.', products: [] });
    }

    const matched = searchProducts(message, catalogo);

    let allMatched = [...matched];
    const seenIds = new Set(matched.map(p => p.codigo || p.id));

    if (history && history.length > 0) {
      const recentTexts = history.slice(-6).map(m => m.text || '').join(' ');
      const historySearch = searchProducts(recentTexts, catalogo);
      for (const p of historySearch) {
        const id = p.codigo || p.id;
        if (!seenIds.has(id)) { allMatched.push(p); seenIds.add(id); }
      }
    }

    allMatched = allMatched.slice(0, 15);

    let productInfo = allMatched.slice(0, 12).map((p, i) =>
      (i + 1) + '. ' + productToString(p)
    ).join('\n');

    const groqMessages = [
      { role: 'system', content:
        'Sos Lolo, asistente virtual de un bazar/libreria/jugueteria en Argentina. Tu logo es una bolsita en monopatin.\n\n' +
        'Tu trabajo es AYUDAR al cliente como un vendedor real, NO como un buscador. Tenes memoria de la conversacion.\n\n' +
        'REGLAS:\n' +
        '1. Si el cliente pregunta sobre un producto especifico que ya salio en la conversacion, respondé sobre ESE producto usando sus datos de la lista. NO busques otros.\n' +
        '2. Si pregunta caracteristicas, precio, o stock de algo, busca ese producto en la lista y respondé con sus datos reales.\n' +
        '3. Si es una busqueda nueva, sugerí productos relevantes de la lista.\n' +
        '4. RESPONDE SOLO sobre productos de la tienda. Si preguntan algo fuera del bazar (ciencia, programacion, etc), deci que sos el asistente de la libreria y no podes ayudar con eso.\n' +
        '5. NUNCA digas "catalogo vacio". NUNCA inventes productos.\n' +
        '6. Si de la lista no hay datos de descripcion, deci lo que sepas del producto por su nombre.\n' +
        '7. Respuestas naturales, 2-4 lineas. Habla como un vendedor que atiende bien.\n' +
        '8. NUNCA muestres JSON ni formato tecnico.\n\n' +
        'PRODUCTOS DISPONIBLES:\n' + productInfo
      }
    ];

    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-8)) {
        if (!msg.text) continue;
        const role = msg.role === 'user' ? 'user' : 'assistant';
        groqMessages.push({ role, content: msg.text });
      }
    }

    groqMessages.push({ role: 'user', content: message });

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature: 0.5,
        max_tokens: 400
      })
    });

    if (!groqRes.ok) return res.status(200).json({ reply: 'Tuve un problema de conexion. Proba de nuevo.', products: [] });
    const data = await groqRes.json();
    if (data.error) return res.status(200).json({ reply: 'Tuve un problema de conexion. Proba de nuevo.', products: [] });

    const reply = (data.choices && data.choices[0] && data.choices[0].message)
      ? data.choices[0].message.content
      : 'Proba de nuevo por favor.';

    const products = allMatched.slice(0, 5).map(p => fmt(p));
    return res.status(200).json({ reply, products });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).json({ reply: 'Tuve un problema de conexion. Proba de nuevo.', products: [] });
  }
}