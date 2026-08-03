const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile';
const CATALOGO_URL = 'https://raw.githubusercontent.com/srmagoshahks/lolo-chat-api/main/public/catalogo.json';

const NEGOCIO = {
  nombre: 'LOLO Sobre Ruedas',
  tipo: 'Bazar, libreria, jugueteria, accesorios y mas',
  direccion: 'Leopoldo Herrera 1693',
  telefono: '3455-541097',
  whatsapp: '5493455541097',
  email: 'lolosobreruedas@gmail.com',
  horario: '9:00 a 12:00 / 16:00 a 19:30'
};

let catalogoCache = null;
let catalogoLoadTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getCatalogo() {
  if (catalogoCache && (Date.now() - catalogoLoadTime) < CACHE_DURATION) return catalogoCache;
  try {
    const resp = await fetch(CATALOGO_URL);
    catalogoCache = await resp.json();
    catalogoLoadTime = Date.now();
    return catalogoCache;
  } catch (err) {
    console.error('Error cargando catalogo:', err.message);
    return catalogoCache || [];
  }
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
  const catList = Object.entries(proveedores).map(([prov, prods]) => '- ' + prov + ': ' + prods.slice(0, 5).join(', ') + (prods.length > 5 ? ' (+' + (prods.length - 5) + ' mas)' : '')).join('\n');
  const productosTexto = catalogo.filter(p => p.stock > 0).slice(0, 150).map(p => '- "' + p.nombre + '" | $' + p.precio + ' | stock: ' + p.stock).join('\n');

  return 'Eres Lolo, el asistente virtual de "' + NEGOCIO.nombre + '", un bazar/libreria/jugueteria en ' + NEGOCIO.direccion + '.\n\n' +
    'CATALOGO: ' + totalProductos + ' productos, ' + conStock + ' con stock.\n\n' +
    'Rubros principales:\n' + (catList || '- Bazar general') + '\n\n' +
    'Productos con stock (muestra):\n' + productosTexto + '\n\n' +
    'REGLAS:\n' +
    '1. Hablas en argentino casual: "vos", "che", "dale", "re". Amigable pero no ridculo.\n' +
    '2. Si preguntan por productos del catalogo, buscas y sugeris con precio.\n' +
    '3. Si no encontras exactamente, sugeris lo mas parecido del catalogo.\n' +
    '4. Precios en pesos argentinos con puntos de miles (ej: $15.000).\n' +
    '5. SOLO mencionas WhatsApp si el usuario quiere comprar o hacer un pedido. No por cualquier pregunta.\n' +
    '6. Si preguntan algo que no es del negocio (como formulas, chistes, etc), respondes normalmente como IA amigable. No menciones el negocio en esos casos.\n' +
    '7. Maximo 3 oraciones por respuesta.\n' +
    '8. NUNCA inventes productos que no estan en el catalogo.\n\n' +
    'RESPONDE UNICAMENTE CON JSON, sin texto adicional, sin markdown, sin backticks:\n' +
    '{"reply":"tu respuesta","product_ids":["nombre exacto del producto del catalogo"]}\n' +
    '- reply: tu respuesta al usuario\n' +
    '- product_ids: nombres EXACTOS del catalogo que sugeris (max 3). Vacio [] si no aplica.\n' +
    '- Los nombres deben coincidir EXACTAMENTE con los del catalogo.';
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
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Entendido. Respondo solo con JSON.' },
      { role: 'assistant', content: '{"reply":"Entendido.","product_ids":[]}' },
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
      return res.status(500).json({ error: 'Groq error ' + groqResp.status, reply: 'Ups, tuve un problemita de conexion.' });
    }
    const data = await groqResp.json();
    const responseText = (data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();

    let parsed;
    try {
      let clean = responseText;
      if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      clean = clean.replace(/^\u00ef\u00bb\u00bf/, '');
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) clean = jsonMatch[0];
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error('Error parseando JSON:', parseErr.message, 'Respuesta:', responseText);
      parsed = { reply: responseText.replace(/\{[\s\S]*\}/, '').trim() || responseText, product_ids: [] };
    }

    const products = findProducts(catalogo, parsed.product_ids);
    return res.status(200).json({ reply: parsed.reply || 'No pude generar una respuesta.', products });

  } catch (err) {
    console.error('Error en handler:', err);
    return res.status(500).json({ error: err.message, reply: 'Ups, tuve un problemita de conexion.' });
  }
}