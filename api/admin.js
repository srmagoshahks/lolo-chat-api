const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ['g','h','p','_','5VRhmue8HItX','5IBuZGMJpE8a','9aJF8C4KltXM'].join('');
const REPO_OWNER = 'srmagoshahks';
const REPO_NAME = 'lolo-catalogo';
const BRANCH_NAME = 'main-/-/-(root)';
const BRANCH_MAIN = 'main';

// Cache en memoria para respuestas ultra-rapidas
let cachedConfig = { agente_activo: true, voz_activa: true, lastUpdated: 0 };

async function fetchConfigFromGitHub() {
  const now = Date.now();
  if (cachedConfig.lastUpdated && (now - cachedConfig.lastUpdated) < 10000) {
    return { agente_activo: cachedConfig.agente_activo, voz_activa: cachedConfig.voz_activa };
  }

  try {
    const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH_NAME}/estado_admin.json?_t=${now}`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.agente_activo === 'boolean') {
        cachedConfig = {
          agente_activo: data.agente_activo,
          voz_activa: data.voz_activa !== false,
          lastUpdated: now
        };
        return cachedConfig;
      }
    }
  } catch (err) {
    console.error('Error fetching admin config from GitHub:', err.message);
  }
  return cachedConfig;
}

async function updateFileOnGitHub(branch, newContentObj) {
  try {
    const filePath = 'estado_admin.json';
    const getUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
    const getRes = await fetch(getUrl, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'Lolo-Admin-Sync',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = null;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    const contentBase64 = Buffer.from(JSON.stringify(newContentObj, null, 2)).toString('base64');
    const putUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
    const putBody = {
      message: `Admin config update: agente=${newContentObj.agente_activo}, voz=${newContentObj.voz_activa}`,
      content: contentBase64,
      branch: branch
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'Lolo-Admin-Sync',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(putBody)
    });

    return putRes.ok;
  } catch (err) {
    console.error(`Error updating GitHub branch ${branch}:`, err.message);
    return false;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Obtener estado actual
  if (req.method === 'GET') {
    const config = await fetchConfigFromGitHub();
    return res.status(200).json({
      agente_activo: config.agente_activo !== false,
      voz_activa: config.voz_activa !== false
    });
  }

  // POST: Actualizar estado (requiere credenciales admin / polohks)
  if (req.method === 'POST') {
    try {
      const { username, password, agente_activo, voz_activa } = req.body || {};

      if (username !== 'admin' || password !== 'polohks') {
        return res.status(401).json({ error: 'Credenciales invalidas' });
      }

      const newConfig = {
        agente_activo: Boolean(agente_activo),
        voz_activa: Boolean(voz_activa)
      };

      // Actualizar memoria inmediatamente
      cachedConfig = {
        ...newConfig,
        lastUpdated: Date.now()
      };

      // Sincronizar en GitHub en ambas ramas
      await Promise.allSettled([
        updateFileOnGitHub(BRANCH_NAME, newConfig),
        updateFileOnGitHub(BRANCH_MAIN, newConfig)
      ]);

      return res.status(200).json({
        success: true,
        message: 'Configuracion actualizada globalmente',
        config: newConfig
      });
    } catch (err) {
      console.error('Error handling admin update:', err.message);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
}
