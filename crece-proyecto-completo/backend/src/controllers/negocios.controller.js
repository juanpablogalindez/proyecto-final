import { pool } from '../config/db.js';

function normalizarImagen(url, req) {
  if (!url) return url;
  const base = `${req.protocol}://${req.get('host')}`;
  if (url.startsWith('/uploads/')) return `${base}${url}`;
  if (url.includes('/uploads/')) return `${base}${new URL(url).pathname}`;
  return url.replace(/^https?:\/\/localhost(?::\d+)?/, base);
}

/**
 * Buscador de negocios. Soporta:
 *  - ?q=texto           búsqueda por nombre/descripción
 *  - ?categoria_id=3    filtro por categoría
 *  - ?lat=&lng=&radio=  búsqueda por cercanía (función distancia_km / Haversine)
 */
export async function listar(req, res, next) {
  try {
    const { q, categoria_id, lat, lng, radio = 5, limite = 20, pagina = 1 } = req.query;
    const offset = (Number(pagina) - 1) * Number(limite);

    const usaGeo = lat !== undefined && lng !== undefined;
    const campoDistancia = usaGeo
      ? 'distancia_km(?, ?, n.latitud, n.longitud) AS distancia_km'
      : 'NULL AS distancia_km';

    const params = [];
    if (usaGeo) params.push(Number(lat), Number(lng));

    let sql = `
      SELECT n.id, n.nombre_negocio, n.descripcion, n.direccion, n.latitud, n.longitud,
             n.telefono_negocio, n.logo_url, n.formalizado, n.categoria_id,
             c.nombre AS categoria_nombre,
             COALESCE(v.calificacion_promedio, 0) AS calificacion_promedio,
             COALESCE(v.total_resenas, 0)         AS total_resenas,
             ${campoDistancia}
      FROM negocios n
      LEFT JOIN categorias c ON c.id = n.categoria_id
      LEFT JOIN (
        SELECT negocio_id,
               ROUND(AVG(calificacion), 2) AS calificacion_promedio,
               COUNT(id) AS total_resenas
        FROM resenas
        GROUP BY negocio_id
      ) v ON v.negocio_id = n.id
      WHERE n.estado = 'activo'
    `;

    if (q) {
      sql += ' AND (n.nombre_negocio LIKE ? OR n.descripcion LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (categoria_id) {
      sql += ' AND n.categoria_id = ?';
      params.push(Number(categoria_id));
    }

    if (usaGeo) {
      sql += ' HAVING distancia_km IS NOT NULL AND distancia_km <= ? ORDER BY distancia_km ASC';
      params.push(Number(radio));
    } else {
      sql += ' ORDER BY calificacion_promedio DESC, n.fecha_creacion DESC';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(Number(limite), offset);

    const [filas] = await pool.query(sql, params);
    res.json(filas.map((fila) => ({
      ...fila,
      logo_url: normalizarImagen(fila.logo_url, req)
    })));
  } catch (error) {
    next(error);
  }
}

export async function obtener(req, res, next) {
  try {
    const [filas] = await pool.query(
      `SELECT n.*, c.nombre AS categoria_nombre,
              COALESCE(v.calificacion_promedio, 0) AS calificacion_promedio,
              COALESCE(v.total_resenas, 0)         AS total_resenas
       FROM negocios n
       LEFT JOIN categorias c ON c.id = n.categoria_id
      LEFT JOIN (
        SELECT negocio_id,
          ROUND(AVG(calificacion), 2) AS calificacion_promedio,
          COUNT(id) AS total_resenas
        FROM resenas
        GROUP BY negocio_id
      ) v ON v.negocio_id = n.id
       WHERE n.id = ?`,
      [req.params.id]
    );
    if (!filas.length) return res.status(404).json({ mensaje: 'Negocio no encontrado' });
    res.json({ ...filas[0], logo_url: normalizarImagen(filas[0].logo_url, req) });
  } catch (error) {
    next(error);
  }
}

/** Negocio del usuario autenticado (rol negocio) */
export async function miNegocio(req, res, next) {
  try {
    const [filas] = await pool.query(
      'SELECT * FROM negocios WHERE usuario_id = ? ORDER BY id ASC',
      [req.usuario.id]
    );
    res.json(filas.map((fila) => ({
      ...fila,
      logo_url: normalizarImagen(fila.logo_url, req)
    })));
  } catch (error) {
    next(error);
  }
}

export async function crear(req, res, next) {
  try {
    const {
      categoria_id, nombre_negocio, descripcion, direccion, latitud, longitud,
      telefono_negocio, email_negocio, horario_atencion, logo_url, formalizado = false
    } = req.body;

    const [resultado] = await pool.query(
      `INSERT INTO negocios
        (usuario_id, categoria_id, nombre_negocio, descripcion, direccion, latitud, longitud,
         telefono_negocio, email_negocio, horario_atencion, logo_url, formalizado, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo')`,
      [req.usuario.id, categoria_id || null, nombre_negocio, descripcion || null, direccion || null,
       latitud ?? null, longitud ?? null, telefono_negocio || null, email_negocio || null,
       horario_atencion || null, logo_url || null, !!formalizado]
    );

    res.status(201).json({ id: resultado.insertId, mensaje: 'Negocio registrado' });
  } catch (error) {
    next(error);
  }
}

/** Verifica que el negocio pertenezca al usuario autenticado (o sea admin) */
async function esPropietario(negocioId, usuario) {
  if (usuario.rol === 'admin') return true;
  const [filas] = await pool.query('SELECT usuario_id FROM negocios WHERE id = ?', [negocioId]);
  return filas.length > 0 && filas[0].usuario_id === usuario.id;
}

export async function actualizar(req, res, next) {
  try {
    const { id } = req.params;
    if (!(await esPropietario(id, req.usuario))) {
      return res.status(403).json({ mensaje: 'No puede modificar este negocio' });
    }

    const campos = ['categoria_id', 'nombre_negocio', 'descripcion', 'direccion', 'latitud',
      'longitud', 'telefono_negocio', 'email_negocio', 'horario_atencion', 'logo_url',
      'formalizado', 'estado'];

    const set = [];
    const valores = [];
    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        set.push(`${campo} = ?`);
        valores.push(req.body[campo]);
      }
    }
    if (!set.length) return res.status(400).json({ mensaje: 'No hay cambios para aplicar' });

    valores.push(id);
    await pool.query(`UPDATE negocios SET ${set.join(', ')} WHERE id = ?`, valores);
    res.json({ mensaje: 'Negocio actualizado' });
  } catch (error) {
    next(error);
  }
}

export async function eliminar(req, res, next) {
  try {
    const { id } = req.params;
    if (!(await esPropietario(id, req.usuario))) {
      return res.status(403).json({ mensaje: 'No puede eliminar este negocio' });
    }
    await pool.query('DELETE FROM negocios WHERE id = ?', [id]);
    res.json({ mensaje: 'Negocio eliminado' });
  } catch (error) {
    next(error);
  }
}
