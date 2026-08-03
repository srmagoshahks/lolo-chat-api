const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile';

const NEGOCIO = {
  nombre: 'LOLO Sobre Ruedas',
  tipo: 'Bazar, libreria, jugueteria, accesorios y mas',
  direccion: 'Leopoldo Herrera 1693',
  telefono: '3455-541097',
  whatsapp: '5493455541097',
  email: 'lolosobreruedas@gmail.com',
  horario: '9:00 a 12:00 / 16:00 a 19:30',
  logo: 'Una bolsa sobre una patineta'
};

let catalogoCache = null;
let catalogoLoadTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getCatalogo() {
  if (catalogoCache && (Date.now() - catalogoLoadTime) < CACHE_DURATION) return catalogoCache;
  try {
    const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://lolo-chat-api.vercel.app';
    const resp = await fetch(baseUrl + '/catalogo.json');
    catalogoCache = await resp.json();
    catalogoLoadTime = Date.now();
    return catalogoCache;
  } catch (err) { return catalogoCache || []; }
}

function buildSystemPrompt(catalogo) {
  const totalProductos = catalogo.length;
  const conStock = catalogo.filter(p => p.stock > 0).length;
  const proveedores = {};
  catalogo.forEach(p => {
    if (p.proveedor && p.proveedor !== 'nan' && p.proveedor.trim()) {
      const key = p.proveedor.trim();
      if (!proveedores[key]) proveedores[key] = [];
      proveedores[key].push(p.nombre);
    }
  });
  const catList = Object.entries(proveedores).map(([prov, prods]) => '  - ' + prov + ': ' + prods.slice(0, 5).join(', ') + (prods.length > 5 ? ' (+' + (prods.length - 5) + ' mas)' : '')).join('\n');
  const productosTexto = catalogo.filter(p => p.stock > 0).slice(0, 200).map(p => '- "' + p.nombre + '" | $' + p.precio + ' | stock: ' + p.stock + (p.fotos && p.fotos.length ? ' | tiene foto' : '')).join('\n');
  return 'Eres Lolo, el asistente virtual de "' + NEGOCIO.nombre + '". Tu logo es ' + NEGOCIO.logo + '.\n\nSOBRE EL NEGOCIO:\n- Tipo: ' + NEGOCIO.tipo + '\n- Direccion: ' + NEGOCIO.direccion + '\n- Telefono: ' + NEGOCIO.telefono + '\n- Horario: ' + NEGOCIO.horario + '\n- Email: ' + NEGOCIO.email + '\n\nCATALOGO ACTUAL:\n- Total de productos: ' + totalProductos + '\n- Con stock disponible: ' + conStock + '\n\nPrincipales rubros/proveedores:\n' + (catList || '  - Variedad general de bazar y libreria') + '\n\nPRODUCTOS DISPONIBLES (muestra):\n' + productosTexto + '\n\n---\n\nTUS REGLAS:\n1. Hablas en argentino, casual, amigable. Usas "vos", "che", "dale".\n2. NO sos una mascota. Sos un asistente de una tienda (bazar/libreria/jugueteria).\n3. Cuando preguntan por productos, buscas en el catalogo y sugeris los mas relevantes.\n4. Das precios en pesos argentinos (ej: $15.000).\n5. Para compras, dirigis a WhatsApp: ' + NEGOCIO.telefono + '\n6. Respondes de forma concisa, maximo 3-4 oraciones.\n7. Nunca inventas productos que no estan en el catalogo.\n\nFORMATO DE RESPUESTA JSON:\nResponde SIEMPRE con este JSON exacto (sin markdown, sin backticks):\n{"reply": "tu respuesta aqui", "product_ids": ["nombre exacto del producto"]}\n\n- "reply": lo que le decis al usuario\n- "product_ids": array con nombres EXACTOS del catalogo (maximo 3). Si no hay relevantes, [].\n\nIMPORTANTE: Tu respuesta DEBE ser un JSON valido, nada mas que el JSON.';
}

function findProducts(catalogo, nombres) {
  if (!nombres || !Array.isArray(nombres)) return [];
  const encontrados = [];
  for (const nombre of nombres) {
    const prod = catalogo.find(p => p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase() && p.stock > 0);
    if (prod && !encontrados.find(e => e.nombre === prod.nombre)) encontrados.push(prod);
    if (encontrados.length >= 3) break;
  }
  return encontrados;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) return res.status(400).json({ error: 'Mensaje vacio' });
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'API Key de Groq no configurada' });
    const catalogo = await getCatalogo();
    const systemPrompt = buildSystemPrompt(catalogo);
    const messages = [
      { role: 'system', content: systemPrompt + '\n\nResponde SOLO con JSON.' },
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
      { role: 'user', content: message }
    ];
    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 500 })
    });
    if (!groqResp.ok) {
      const errText = await groqResp.text();
      console.error('Groq error:', groqResp.status, errText);
      return res.status(500).json({ error: 'Groq error ' + groqResp.status, reply: 'Ups, tuve un problemita de conexion. Proba de nuevo en un ratito.' });
    }
    const data = await groqResp.json();
    const responseText = (data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    let parsed;
    try {
      let clean = responseText;
      if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error('Error parseando JSON:', parseErr.message);
      parsed = { reply: responseText, product_ids: [] };
    }
    const products = findProducts(catalogo, parsed.product_ids);
    return res.status(200).json({ reply: parsed.reply || 'No pude generar una respuesta.', products });
  } catch (err) {
    console.error('Error en handler:', err);
    return res.status(500).json({ error: err.message, reply: 'Ups, tuve un problemita. Probá de nuevo en un ratito.' });
  }
}