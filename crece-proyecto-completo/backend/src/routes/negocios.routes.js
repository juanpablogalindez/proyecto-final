import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/negocios.controller.js';
import { verificarToken, permitirRoles } from '../middlewares/auth.middleware.js';
import { validarCampos } from '../middlewares/validar.middleware.js';

const router = Router();

router.get('/', ctrl.listar);
router.get('/mis-negocios', verificarToken, ctrl.miNegocio);
router.get('/:id', ctrl.obtener);

router.post(
  '/',
  verificarToken,
  permitirRoles('negocio', 'admin'),
  [body('nombre_negocio').trim().notEmpty().withMessage('El nombre del negocio es obligatorio'), validarCampos],
  ctrl.crear
);

router.put('/:id', verificarToken, ctrl.actualizar);
router.delete('/:id', verificarToken, ctrl.eliminar);

export default router;
