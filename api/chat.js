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
  'balsamo': ['labial', 'carmex', 'protector', 'lip'],
  'cera': ['balsamo', 'labial', 'depilar'],
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
    const tieneFoto = (p.fotos && p.fotos.length > 0) ? 500 : 0;
    return { product: p, score: score + tieneFoto };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 15).map(s => s.product);
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
    const { message } = req.body;
    if (!message) return res.status(200).json({ reply: 'Decime que buscas y te ayudo.', products: [] });

    const catalogo = await getCatalogo();
    const matched = searchProducts(message, catalogo);
    console.log('Msg: "' + message + '" | Cat: ' + catalogo.length + ' | Found: ' + matched.length);

    let productInfo = '';
    if (matched.length > 0) {
      productInfo = matched.slice(0, 10).map((p, i) => {
        const precioStr = p.precio ? '$' + Number(p.precio).toLocaleString('es-AR') : 'sin precio';
        const fotoTag = (p.fotos && p.fotos.length > 0) ? '' : ' [SIN FOTO]';
        return (i + 1) + '. ' + (p.nombre || '') + ' - ' + precioStr + fotoTag;
      }).join('\n');
    } else {
      productInfo = 'Sin resultados para esta busqueda.';
    }

    const systemPrompt = 'Sos Lolo, asistente virtual de un bazar/libreria/jugueteria. Tu logo es una bolsita en monopatin. Hablas en español natural y cordial. Sos servicial pero profesional, NO uses slang excesivo (evita decir "che" en cada oracion).\n\n' +
      'REGLAS ESTRICTAS:\n' +
      '1. RESPONDE SOLO sobre productos de la tienda. Si preguntan algo fuera del bazar (fisica, ciencia, programacion, etc), responde: "Hola, soy Lolo el asistente de la libreria. De ese tema no puedo ayudarte, pero si buscas algo para el hogar, utiles o juguetes, consulta conmigo."\n' +
      '2. NUNCA digas "catalogo vacio". Siempre hay productos disponibles.\n' +
      '3. Mencioná SOLO productos que coincidan con lo que el cliente pide de la lista de abajo. No mencionar productos que no tengan relacion.\n' +
      '4. Si hay productos con foto, priorizar esos al mencionar. Los que dicen [SIN FOTO] mencionarlos solo si no hay opciones con foto.\n' +
      '5. Respuestas CORTAS: 2 a 3 lineas maximo.\n' +
      '6. NUNCA mostrar JSON, corchetes ni formato tecnico.\n' +
      '7. No repetir la misma frase en cada respuesta. Variá el vocabulario.\n\n' +
      'PRODUCTOS DISPONIBLES:\n' + productInfo;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        temperature: 0.5, max_tokens: 300
      })
    });

    if (!groqRes.ok) return res.status(200).json({ reply: 'Tuve un problema de conexion. Proba de nuevo en un momento. Si es urgente, contactanos por WhatsApp.', products: [] });
    const data = await groqRes.json();
    if (data.error) return res.status(200).json({ reply: 'Tuve un problema de conexion. Proba de nuevo en un momento.', products: [] });

    const reply = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : 'Proba de nuevo por favor.';

    const products = matched.slice(0, 5).map(p => fmt(p));
    return res.status(200).json({ reply, products });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).json({ reply: 'Tuve un problema de conexion. Proba de nuevo en un momento.', products: [] });
  }
}