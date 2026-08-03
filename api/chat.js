/**
 * LOLO SOBRE RUEDAS ÔÇö API de Chat con Gemini
 * Vercel Serverless Function
 * 
 * Esta funci├│n recibe un mensaje del usuario, lo procesa con Gemini 1.5 Flash
 * y devuelve la respuesta + productos sugeridos del cat├ílogo.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// --- CONFIGURACI├ôN ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.0-flash';

// Datos del negocio (se usan en el prompt del sistema)
const NEGOCIO = {
  nombre: 'LOLO Sobre Ruedas',
  tipo: 'Bazar, librer├¡a, jugueter├¡a, accesorios y m├ís',
  direccion: 'Leopoldo Herrera 1693',
  telefono: '3455-541097',
  whatsapp: '5493455541097',
  email: 'lolosobreruedas@gmail.com',
  horario: '9:00 a 12:00 / 16:00 a 19:30',
  logo: 'Una bolsa sobre una patineta ÔÇö ese es el logo de la marca'
};

// Cargar cat├ílogo via HTTP desde el propio despliegue
let catalogoCache = null;
let catalogoLoadTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getCatalogo() {
  if (catalogoCache && (Date.now() - catalogoLoadTime) < CACHE_DURATION) {
    return catalogoCache;
  }
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lolo-chat-api.vercel.app';
    const resp = await fetch(`${baseUrl}/catalogo.json`);
    catalogoCache = await resp.json();
    catalogoLoadTime = Date.now();
    return catalogoCache;
  } catch (err) {
    console.error('Error cargando cat├ílogo:', err.message);
    return catalogoCache || [];
  }
}

// --- PROMPT DEL SISTEMA ---
function buildSystemPrompt(catalogo) {
  // Resumen del cat├ílogo para contexto
  const totalProductos = catalogo.length;
  const conStock = catalogo.filter(p => p.stock > 0).length;
  
  // Categorias/proveedores principales
  const proveedores = {};
  catalogo.forEach(p => {
    if (p.proveedor && p.proveedor !== 'nan' && p.proveedor.trim()) {
      const key = p.proveedor.trim();
      if (!proveedores[key]) proveedores[key] = [];
      proveedores[key].push(p.nombre);
    }
  });
  
  const catList = Object.entries(proveedores)
    .map(([prov, prods]) => `  - ${prov}: ${prods.slice(0, 5).join(', ')}${prods.length > 5 ? ` (+${prods.length - 5} m├ís)` : ''}`)
    .join('\n');

  // Mapeo nombre -> producto (para b├║squeda r├ípida en el prompt)
  const productosTexto = catalogo
    .filter(p => p.stock > 0)
    .slice(0, 200) // Limitamos para no exceder tokens
    .map(p => `- "${p.nombre}" | $${p.precio} | stock: ${p.stock}${p.fotos && p.fotos.length ? ' | tiene foto' : ''}`)
    .join('\n');

  return `Eres Lolo, el asistente virtual de "${NEGOCIO.nombre}". Tu logo es ${NEGOCIO.logo}.

SOBRE EL NEGOCIO:
- Tipo: ${NEGOCIO.tipo}
- Direcci├│n: ${NEGOCIO.direccion}
- Tel├®fono: ${NEGOCIO.telefono}
- Horario: ${NEGOCIO.horario}
- Email: ${NEGOCIO.email}

CAT├üLOGO ACTUAL:
- Total de productos: ${totalProductos}
- Con stock disponible: ${conStock}

Principales rubros/proveedores:
${catList || '  - Variedad general de bazar y librer├¡a'}

PRODUCTOS DISPONIBLES (muestra):
${productosTexto}

---

TUS REGLAS DE COMPORTAMIENTO:
1. Habl├ís en argentino, casual, amigable pero respetuoso. Us├ís "vos", "che", "dale", "re", etc.
2. NO sos una mascota ni un perro. Sos un asistente que representa a una tienda (bazar/librer├¡a/jugueter├¡a).
3. Cuando te preguntan por productos, busc├ís en el cat├ílogo y suger├¡s los m├ís relevantes.
4. Si no encontr├ís exactamente lo que buscan, suger├¡s alternativas similares.
5. D├ís precios en pesos argentinos con formato legible (ej: $15.000).
6. Para compras, siempre dirig├¡s a WhatsApp: ${NEGOCIO.telefono}
7. Si te preguntan por el logo, explic├ís que es una bolsa sobre una patineta.
8. Si no sab├®s algo, dec├¡s la verdad y ofrec├®s ayudar por otro medio.
9. Respond├®s de forma concisa pero completa, m├íximo 3-4 oraciones por respuesta.
10. Nunca invent├ís productos que no est├ín en el cat├ílogo.

FORMATO DE RESPUESTA JSON:
Respond├® SIEMPRE con este JSON exacto (sin markdown, sin backticks):
{"reply": "tu respuesta de texto aqui", "product_ids": [lista de nombres exactos de productos sugeridos]}

- "reply": lo que le dec├¡s al usuario
- "product_ids": array con los nombres EXACTOS de productos del cat├ílogo que quieras sugerir (m├íximo 3). Si no hay productos relevantes, pon├® array vac├¡o [].
- Los nombres deben coincidir EXACTAMENTE con los del cat├ílogo para que el sistema los encuentre.

IMPORTANTE: Tu respuesta DEBE ser un JSON v├ílido, nada m├ís que el JSON.`;
}

// --- BUSCAR PRODUCTOS POR NOMBRE EXACTO ---
function findProducts(catalogo, nombres) {
  if (!nombres || !Array.isArray(nombres)) return [];
  const encontrados = [];
  for (const nombre of nombres) {
    const prod = catalogo.find(p => 
      p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase() && 
      p.stock > 0
    );
    if (prod && !encontrados.find(e => e.nombre === prod.nombre)) {
      encontrados.push(prod);
    }
    if (encontrados.length >= 3) break;
  }
  return encontrados;
}

// --- HANDLER PRINCIPAL ---
export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'M├®todo no permitido' });
  }

  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensaje vac├¡o' });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API Key de Gemini no configurada' });
    }

    // Cargar cat├ílogo
    const catalogo = await getCatalogo();

    // Inicializar Gemini
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 500,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    });

    // Construir conversaci├│n
    const systemPrompt = buildSystemPrompt(catalogo);
    
    const chatHistory = history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    }));

    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: 'INICIO. Respond├® SOLO con JSON.' }] },
        { role: 'model', parts: [{ text: '{"reply": "Entendido, respondere solo con JSON.", "product_ids": []}' }] }
      ]
    });

    // Enviar mensaje con contexto del sistema
    const fullPrompt = `${systemPrompt}\n\nCONVERSACION ANTERIOR:\n${chatHistory.map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}\n\nUSUARIO: ${message}`;
    
    const result = await chat.sendMessage(fullPrompt);
    const responseText = result.response.text().trim();

    // Parsear respuesta JSON
    let parsed;
    try {
      // Limpiar posible markdown
      let clean = responseText;
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      // Si no pudo parsear, usar todo como reply
      console.error('Error parseando JSON de Gemini:', parseErr.message);
      console.error('Respuesta original:', responseText);
      parsed = { reply: responseText, product_ids: [] };
    }

    // Buscar productos
    const products = findProducts(catalogo, parsed.product_ids);

    return res.status(200).json({
      reply: parsed.reply || 'No pude generar una respuesta.',
      products: products
    });

  } catch (err) {
    console.error('Error en handler:', err);
    return res.status(500).json({ 
      error: err.message,
      reply: 'Ups, tuve un problemita. Prob├í de nuevo en un ratito.'
    });
  }
}
