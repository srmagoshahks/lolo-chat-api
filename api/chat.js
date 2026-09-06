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
  if (!texto || !FISH_API_KEY || !FISH_VOICE_ID) return { b64: '', error: null };
  try {
    const clean = texto
      .replace(/ID:\s*\d+/gi, '')
      .replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/\$([\d\.]+)/g, '$1 pesos')
      .replace(/[*_#`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return { b64: '', error: null };

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
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'online', model: 'gemini-flash-lite-latest', persona: 'LOLO Vendedor Estrella (Consultiva)' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }

  const msgClean = message.trim().toLowerCase().replace(/[^\w\s]/g, '');
  const saludos = ['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola lolo', 'hola que tal', 'holis', 'hey', 'hola buenas'];

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
    
    // Mapeo rápido de productos para búsqueda e IDs
    const prodsMap = {};
    const lineasPrompt = catalogo.map(p => {
      prodsMap[p.id] = p;
      return `ID:${p.id} | ${p.nombre} | ${p.rubro} | $${p.precio} | ${p.descripcion || ''}`;
    }).join('\n');

    const systemPrompt = `Eres LOLO, el Asesor de Ventas estrella de "LOLO Sobre Ruedas" (Bazar, Librería, Juguetería, Tecnología, Regalería, Estética, Hogar y Moda).
Tu imagen es una simpática bolsita celeste sonriente sobre un skate.

FILOSOFÍA COMERCIAL (INDAGACIÓN ACTIVA Y VENTA CONSULTIVA):
"Un vendedor estrella no adivina ni tira productos a ciegas: indaga amablemente la necesidad, el presupuesto, el uso y los gustos para recomendar con precisión y calidez".

TUS PAUTAS DE ACTUACIÓN:

1. CONSULTAS ABIERTAS O DE REGALO (ej: "busco un regalo", "que le puedo regalar a mi hermana", "para mi novio", "algo para la facu", "que me recomendas"):
   - INDAGÁ AMABLEMENTE Y CON TOTAL EMPATÍA antes de apresurarte a vender:
     * Celebrá la intención con calidez (ej: "¡Qué lindo detalle regalarle algo a tu hermana! 🎁").
     * Hacé las preguntas clave para asesorar como un verdadero experto:
       a) ¿Qué edad tiene aproximadamente?
       b) ¿Qué le gusta o qué hobbies tiene (mates, deco, tecnología, librería, deportes)?
       c) ¿Qué presupuesto aproximado tenías pensado gastar?
     * suggested_ids: [] (En esta primera etapa de indagación abierta NO pongas productos todavía, o poné máximo 1 o 2 como simple ejemplo general).

2. CONSULTAS ESPECÍFICAS (producto puntual, presupuesto o perfil claro):
   - Si fijan un PRESUPUESTO MÁXIMO (ej: "hasta $15.000"):
     * OBLIGATORIO: TODOS los productos recomendados en suggested_ids DEBEN costar IGUAL O MENOS que ese monto.
   - Recomienda de 2 a 4 productos variados y pertinentes del catálogo.
   - Explicá por qué es una buena opción de forma vendedora y atractiva.
   - suggested_ids: [IDs exactos de los productos que recomiendes].

3. SEGUIMIENTO, REFINAMIENTO Y MEMORIA:
   - Recordá todo el historial. Si el cliente dice "más barato", "algo en rosa", "más divertido", aplicá el filtro y sugerí opciones NUEVAS sin repetir.

4. VENTA POR SUSTITUCIÓN (MARCAS/STOCK):
   - Si piden marcas no comercializadas (Lumilagro, Stanley), explicá con calidez que no manejamos esa marca y ofrecé de inmediato nuestras mejores alternativas reales en stock.

5. CIERRE DE VENTA DIRECTO A WHATSAPP:
   - Cuando el cliente muestre interés en comprar o le guste algo, guialo:
     "¡Buenísimo! 🛹 Podés tocar la tarjeta del producto acá arriba para ver todas las fotos y especificaciones, o tocar el botón de WhatsApp para pedirlo directamente con nosotros y coordinar el envío o retiro."

6. TONO Y REGLAS:
   - Español argentino educado, cálido, profesional y cordial (usar "vos", "te cuento", "fijate", "con gusto te ayudo").
   - PROHIBIDO usar "che".
   - NUNCA inventar productos ni precios: usar exclusivamente los IDs del catálogo provisto abajo.

CATÁLOGO REAL EN STOCK DE LOLO SOBRE RUEDAS:
${lineasPrompt}

RESPONDE OBLIGATORIAMENTE EN ESTE FORMATO JSON PURO:
{
  "reply": "Tu respuesta como asesor comercial experto aquí...",
  "suggested_ids": [id1, id2]
}`;

    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history.slice(-8)) {
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.text || '' }]
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: `CONSULTA DEL CLIENTE: "${message}"` }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.5,
          maxOutputTokens: 600
        }
      })
    });

    let reply = '¡Hola! 🛹 En LOLO Sobre Ruedas tenemos de todo. ¿Qué estás buscando hoy?';
    let suggestedIds = [];

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      try {
        const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleanJson);
        if (parsed.reply) reply = parsed.reply;
        if (Array.isArray(parsed.suggested_ids)) suggestedIds = parsed.suggested_ids;
      } catch(pe) {
        console.error('Error parseando JSON de Gemini:', pe.message, rawText);
        reply = rawText;
      }
    } else {
      const errTxt = await geminiRes.text();
      console.error('Gemini error:', errTxt);
    }

    // Obtener las tarjetas de los productos sugeridos
    const products = [];
    suggestedIds.forEach(id => {
      const pid = parseInt(id);
      if (prodsMap[pid]) {
        products.push(fmt(prodsMap[pid]));
      }
    });

    // Generar voz clonada con Fish Audio
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
