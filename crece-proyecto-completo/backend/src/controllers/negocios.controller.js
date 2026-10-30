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
             n.telefono_negocio, n.logo_url, n.formalizado, n.verificado, n.categoria_id,
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

export async function listarPendientesVerificacion(req, res, next) {
  try {
    const [filas] = await pool.query(
      `SELECT n.id, n.nombre_negocio, n.descripcion, n.direccion, n.telefono_negocio,
              n.email_negocio, n.logo_url, n.categoria_id, n.verificacion_estado,
              n.verificacion_observaciones, n.fecha_creacion, u.nombre_completo AS propietario,
              u.email AS email_propietario
       FROM negocios n
       JOIN usuarios u ON u.id = n.usuario_id
       WHERE n.verificacion_estado IN ('pendiente', 'en_revision', 'requiere_correcciones')
       ORDER BY n.fecha_creacion ASC`
    );
    res.json(filas.map((fila) => ({
      ...fila,
      logo_url: normalizarImagen(fila.logo_url, req)
    })));
  } catch (error) {
    next(error);
  }
}

export async function obtenerVerificacion(req, res, next) {
  try {
    const [negocios] = await pool.query(
      `SELECT n.*, c.nombre AS categoria_nombre, u.nombre_completo AS propietario,
              u.email AS email_propietario, u.telefono AS telefono_propietario
       FROM negocios n
       JOIN usuarios u ON u.id = n.usuario_id
       LEFT JOIN categorias c ON c.id = n.categoria_id
       WHERE n.id = ?`,
      [req.params.id]
    );
    if (!negocios.length) return res.status(404).json({ mensaje: 'Negocio no encontrado' });

    if (negocios[0].verificacion_estado === 'pendiente') {
      await pool.query(
        `UPDATE negocios
         SET verificacion_estado = 'en_revision'
         WHERE id = ? AND verificacion_estado = 'pendiente'`,
        [req.params.id]
      );
      negocios[0].verificacion_estado = 'en_revision';
    }

    const [requisitos] = await pool.query(
      `SELECT id, clave, nombre, obligatorio, orden
       FROM verificacion_requisitos
       WHERE activo = TRUE
       ORDER BY orden, id`
    );
    const [historial] = await pool.query(
      `SELECT r.id, r.decision, r.observaciones, r.fecha_creacion,
              u.nombre_completo AS administrador
       FROM verificacion_revisiones r
       JOIN usuarios u ON u.id = r.administrador_id
       WHERE r.negocio_id = ?
       ORDER BY r.fecha_creacion DESC`,
      [req.params.id]
    );

    res.json({
      negocio: { ...negocios[0], logo_url: normalizarImagen(negocios[0].logo_url, req) },
      requisitos,
      historial
    });
  } catch (error) {
    next(error);
  }
}

export async function historialVerificacion(req, res, next) {
  try {
    const [revisiones] = await pool.query(
      `SELECT r.id, r.decision, r.observaciones, r.fecha_creacion,
              u.nombre_completo AS administrador
       FROM verificacion_revisiones r
       JOIN usuarios u ON u.id = r.administrador_id
       WHERE r.negocio_id = ?
       ORDER BY r.fecha_creacion DESC`,
      [req.params.id]
    );
    for (const revision of revisiones) {
      const [items] = await pool.query(
        `SELECT i.requisito_id, q.clave, q.nombre, q.obligatorio,
                i.resultado, i.observacion
         FROM verificacion_revision_items i
         JOIN verificacion_requisitos q ON q.id = i.requisito_id
         WHERE i.revision_id = ?
         ORDER BY q.orden, q.id`,
        [revision.id]
      );
      revision.items = items;
    }
    res.json(revisiones);
  } catch (error) {
    next(error);
  }
}

export async function reabrirVerificacion(req, res, next) {
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [negocios] = await conexion.query(
      `SELECT id, usuario_id, nombre_negocio, verificacion_estado
       FROM negocios
       WHERE id = ?
       FOR UPDATE`,
      [req.params.id]
    );
    if (!negocios.length) {
      await conexion.rollback();
      return res.status(404).json({ mensaje: 'Negocio no encontrado' });
    }

    await conexion.query(
      `UPDATE negocios
       SET verificado = FALSE,
           verificacion_estado = 'pendiente',
           verificacion_observaciones = NULL,
           verificacion_fecha = NULL
       WHERE id = ?`,
      [req.params.id]
    );
    await conexion.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
       VALUES (?, 'negocio-reabierto', 'Nueva revisión solicitada',
               ?, '/tabs/mi-negocio')`,
      [
        negocios[0].usuario_id,
        `El negocio ${negocios[0].nombre_negocio} fue habilitado para una nueva revisión administrativa.`
      ]
    );
    await conexion.commit();
    res.json({ mensaje: 'Negocio reabierto para revisión', estado: 'pendiente' });
  } catch (error) {
    if (conexion) await conexion.rollback();
    next(error);
  } finally {
    conexion?.release();
  }
}

export async function revisarVerificacion(req, res, next) {
  let conexion;
  try {
    const { decision, observaciones = '', requisitos = [] } = req.body;
    const decisionesValidas = ['verificado', 'requiere_correcciones', 'rechazado'];
    if (!decisionesValidas.includes(decision) || !Array.isArray(requisitos)) {
      return res.status(400).json({ mensaje: 'Decisión o requisitos inválidos' });
    }

    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [negocios] = await conexion.query(
      'SELECT id, usuario_id, nombre_negocio FROM negocios WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!negocios.length) {
      await conexion.rollback();
      return res.status(404).json({ mensaje: 'Negocio no encontrado' });
    }

    const [catalogo] = await conexion.query(
      'SELECT id, obligatorio FROM verificacion_requisitos WHERE activo = TRUE'
    );
    const resultados = new Map(requisitos.map((item) => [Number(item.requisito_id), item]));
    const resultadosValidos = ['cumple', 'no_cumple', 'no_verificable'];
    const incompletos = catalogo.filter((item) =>
      !resultadosValidos.includes(resultados.get(item.id)?.resultado)
    );
    if (incompletos.length) {
      await conexion.rollback();
      return res.status(422).json({
        mensaje: 'Debes evaluar todos los requisitos antes de guardar la revisión',
        requisitos: incompletos.map((item) => item.id)
      });
    }
    const faltantes = catalogo.filter((item) => {
      const resultado = resultados.get(item.id)?.resultado;
      return item.obligatorio && (!resultado || resultado === 'no_cumple' || resultado === 'no_verificable');
    });
    if (decision === 'verificado' && faltantes.length) {
      await conexion.rollback();
      return res.status(422).json({
        mensaje: 'No se puede verificar: hay requisitos obligatorios sin cumplir o pendientes',
        requisitos: faltantes.map((item) => item.id)
      });
    }
    const [revision] = await conexion.query(
      `INSERT INTO verificacion_revisiones
       (negocio_id, administrador_id, decision, observaciones)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, req.usuario.id, decision, observaciones || null]
    );
    for (const item of requisitos) {
      await conexion.query(
        `INSERT INTO verificacion_revision_items
         (revision_id, requisito_id, resultado, observacion)
         VALUES (?, ?, ?, ?)`,
        [revision.insertId, item.requisito_id, item.resultado, item.observacion || null]
      );
    }

    await conexion.query(
      `UPDATE negocios
       SET verificado = ?, verificacion_estado = ?, verificacion_observaciones = ?,
           verificacion_fecha = NOW()
       WHERE id = ?`,
      [decision === 'verificado', decision, observaciones || null, req.params.id]
    );
    const mensajes = {
      verificado: ['¡Negocio verificado!', `Tu negocio ${negocios[0].nombre_negocio} fue verificado.`],
      requiere_correcciones: ['Correcciones solicitadas', `Tu negocio ${negocios[0].nombre_negocio} requiere correcciones antes de ser verificado.`],
      rechazado: ['Negocio rechazado', `La revisión de ${negocios[0].nombre_negocio} terminó en rechazo.`]
    };
    await conexion.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
       VALUES (?, ?, ?, ?, '/tabs/mi-negocio')`,
      [negocios[0].usuario_id, `negocio-${decision}`, mensajes[decision][0], `${mensajes[decision][1]}${observaciones ? ` Observaciones: ${observaciones}` : ''}`]
    );
    await conexion.commit();
    res.json({ mensaje: 'Revisión guardada y propietario notificado', estado: decision });
  } catch (error) {
    if (conexion) await conexion.rollback();
    next(error);
  } finally {
    conexion?.release();
  }
}

export async function reenviarVerificacion(req, res, next) {
  try {
    const [resultado] = await pool.query(
      `UPDATE negocios
       SET verificacion_estado = 'en_revision', verificacion_observaciones = NULL,
           verificacion_fecha = NOW()
       WHERE id = ? AND usuario_id = ? AND verificacion_estado = 'requiere_correcciones'`,
      [req.params.id, req.usuario.id]
    );
    if (!resultado.affectedRows) {
      return res.status(409).json({ mensaje: 'El negocio no está disponible para reenviar' });
    }
    res.json({ mensaje: 'Negocio reenviado para revisión', estado: 'en_revision' });
  } catch (error) {
    next(error);
  }
}

export async function verificar(req, res, next) {
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();

    const [filas] = await conexion.query(
      `SELECT n.usuario_id, n.nombre_negocio, n.verificado
       FROM negocios n
       WHERE n.id = ?
       FOR UPDATE`,
      [req.params.id]
    );
    if (!filas.length) {
      await conexion.rollback();
      return res.status(404).json({ mensaje: 'Negocio no encontrado' });
    }
    if (filas[0].verificado) {
      await conexion.rollback();
      return res.status(409).json({ mensaje: 'El negocio ya está verificado' });
    }

    await conexion.query(
      `UPDATE negocios SET verificado = TRUE, verificacion_estado = 'verificado',
       verificacion_fecha = NOW() WHERE id = ?`,
      [req.params.id]
    );
    await conexion.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
       VALUES (?, 'negocio-verificado', '¡Negocio verificado!',
               CONCAT('Tu negocio ', ?, ' fue verificado y ya cuenta con el sello de confianza.'),
               '/tabs/mi-negocio')`,
      [filas[0].usuario_id, filas[0].nombre_negocio]
    );
    await conexion.commit();
    res.json({ mensaje: 'Negocio verificado y propietario notificado' });
  } catch (error) {
    if (conexion) await conexion.rollback();
    next(error);
  } finally {
    conexion?.release();
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
