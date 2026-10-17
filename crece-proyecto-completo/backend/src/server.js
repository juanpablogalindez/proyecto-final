import dotenv from 'dotenv';
import app from './app.js';
import { probarConexion } from './config/db.js';

dotenv.config();
const PORT = process.env.PORT || 3000;

try {
  await probarConexion();
  console.log('✅ Conexión a MySQL (crece_db) establecida');
  app.listen(PORT, () => console.log(`🚀 API Crece+ escuchando en http://localhost:${PORT}/api`));
} catch (error) {
  console.error('❌ No fue posible conectar a la base de datos:', error.message);
  process.exit(1);
}
