import { Router } from 'express';
import { body } from 'express-validator';
import { registrar, login, perfil, actualizarPerfil } from '../controllers/auth.controller.js';
import { validarCampos } from '../middlewares/validar.middleware.js';
import { verificarToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post(
  '/registro',
  [
    body('nombre_completo').trim().notEmpty().withMessage('El nombre es obligatorio'),
    body('email').isEmail().withMessage('Correo inválido'),
    body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
    body('rol').optional().isIn(['cliente', 'negocio', 'admin']),
    validarCampos
  ],
  registrar
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Correo inválido'),
    body('password').notEmpty().withMessage('La contraseña es obligatoria'),
    validarCampos
  ],
  login
);

router.get('/perfil', verificarToken, perfil);
router.put('/perfil', verificarToken, actualizarPerfil);

export default router;
